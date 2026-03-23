import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { redis } from "./redis";
import { createFacilitator } from "./facilitator";
import { makeInvoice, lookupInvoice } from "./lightning/nwc-client";
import { storeInvoice, getInvoice, getInvoiceByInvoiceStr } from "./lightning/invoice-store";
import { createDemoRouter } from "./demo/routes";

const MSATS_PER_SAT = 1000;

// Plausible server-side event tracking for facilitator API calls.
// Only active when PLAUSIBLE_ID is set (the script ID from the Plausible snippet).
// Domain and URL are derived from the request so BASE_URL is not needed here.
function trackEvent(req: Request, eventName: string) {
  if (!process.env.PLAUSIBLE_ID) return;
  const url = `${req.protocol}://${req.get("host")}${req.path}`;
  fetch("https://plausible.io/api/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": req.headers["user-agent"] ?? "x402-facilitator",
      "X-Forwarded-For": (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? "",
    },
    body: JSON.stringify({ name: eventName, url, domain: req.hostname }),
  }).catch(() => {});
}

// Returns the Plausible <script> tags if PLAUSIBLE_ID is set, otherwise empty string.
// PLAUSIBLE_ID is the unique script ID from the tracking snippet, e.g. "pa-hlfQoAHvmRYP5Iz9zBD3Y".
function plausibleSnippet(): string {
  const id = process.env.PLAUSIBLE_ID;
  if (!id) return "";
  return [
    `  <script async src="https://plausible.io/js/${id}.js"></script>`,
    `  <script>`,
    `    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};`,
    `    plausible.init()`,
    `  </script>`,
  ].join("\n");
}
import { BITCOIN_MAINNET } from "./constants";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  const app = express();
  app.use(express.json());

  const facilitator = createFacilitator();

  // GET / — landing page
  app.get("/", (_req: Request, res: Response) => {
    const html = readFileSync(join(__dirname, "landing.html"), "utf8").replace(
      "</head>",
      `${plausibleSnippet()}\n</head>`
    );
    res.type("html").send(html);
  });

  // GET /alby-logo.svg — static asset
  app.get("/alby-logo.svg", (_req: Request, res: Response) => {
    res.sendFile(join(__dirname, "alby-logo.svg"));
  });

  // GET /health — liveness probe
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // GET /.well-known/x402 — machine-readable protocol description for agents and LLMs.
  // Explains the Lightning-specific payment flow including the invoice pre-generation
  // step and the polling endpoint that bridges mobile QR payments to the x402 protocol.
  app.get("/.well-known/x402", (req: Request, res: Response) => {
    trackEvent(req, "well-known");
    const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    res.json({
      protocol: "x402",
      version: 2,
      transport: "lightning",
      description:
        "This server implements the x402 HTTP payment protocol over Bitcoin Lightning Network " +
        "using the 'exact' scheme on CAIP-2 Bitcoin networks. " +
        "The resource server generates a BOLT11 invoice and embeds it in the 402 response under " +
        "accepts[0].extra.invoice. The client pays the invoice out-of-band, then proves payment " +
        "by resending the request with the paid invoice string in payload.invoice of the " +
        "payment-signature header. No preimage is required — the server verifies payment by " +
        "querying its Lightning wallet.",
      facilitator: {
        supported: `${base}/supported`,
        verify: `${base}/verify`,
        settle: `${base}/settle`,
      },
      lightningExtensions: {
        invoiceStatus: {
          endpoint: `${base}/invoice/status?invoice=<bolt11>`,
          method: "GET",
          description:
            "Poll this endpoint after instructing the user (or your wallet) to pay the BOLT11 invoice. " +
            "Pass the full invoice string as the `invoice` query parameter. " +
            "Returns { paid: false } while unpaid, { paid: true } once the Lightning payment settles.",
          responseSchema: {
            paid: "boolean",
          },
        },
      },
      paymentFlow: [
        {
          step: 1,
          action: "GET <resource-url>",
          description: "Request the protected resource without any payment header.",
          expectedResponse: "HTTP 402 with PAYMENT-REQUIRED header (base64-encoded JSON).",
          extract:
            "Decode the header: JSON.parse(atob(response.headers.get('PAYMENT-REQUIRED'))). " +
            "Save the full accepts[0] object as `requirements`. " +
            "The BOLT11 invoice is at requirements.extra.invoice.",
        },
        {
          step: 2,
          action: "Pay requirements.extra.invoice",
          description:
            "Pay the BOLT11 invoice using any Lightning wallet or NWC client. " +
            "Example with @getalby/sdk: await nwcClient.payInvoice({ invoice }). " +
            "If you cannot pay directly (e.g. browser without wallet access), display the invoice " +
            "as a QR code and poll GET /invoice/status?invoice=<bolt11> until paid: true.",
        },
        {
          step: 3,
          action: "GET <resource-url> with payment-signature header",
          description: "Retry the request with the paid invoice as proof of payment.",
          headerConstruction:
            "Build a PaymentPayload object: { x402Version: 2, scheme: requirements.scheme, " +
            "network: requirements.network, payload: { invoice: '<the bolt11 invoice string>' }, " +
            "accepted: requirements }. " +
            "Base64-encode the JSON: btoa(JSON.stringify(payloadObj)). " +
            "Set as the payment-signature request header.",
          expectedResponse: "HTTP 200 with the protected resource body.",
        },
      ],
      demo: process.env.DEMO_NWC_SECRET
        ? {
            resource: `${base}/demo/quote`,
            description: "Pay ~$0.01 in sats to receive a random Satoshi Nakamoto quote.",
          }
        : undefined,
    });
  });

  // GET /supported — capability discovery
  app.get("/supported", (req: Request, res: Response) => {
    trackEvent(req, "supported");
    res.json(facilitator.getSupported());
  });

  // POST /register — public: merchant submits their NWC connection secret, receives a
  // stable merchantId (UUID). The secret is stored server-side in Redis; clients only
  // ever see the opaque UUID.
  app.post("/register", async (req: Request, res: Response) => {
    trackEvent(req, "register");
    const { nwcSecret } = req.body as { nwcSecret: unknown };

    if (typeof nwcSecret !== "string" || !nwcSecret.startsWith("nostr+walletconnect://")) {
      res.status(400).json({
        error: "nwcSecret must be a valid NWC connection secret (nostr+walletconnect://...)",
      });
      return;
    }

    const merchantId = randomUUID();
    await redis.set(`merchant:${merchantId}`, nwcSecret);
    res.json({ merchantId });
  });

  // POST /verify — standard x402 verify endpoint
  app.post("/verify", async (req: Request, res: Response) => {
    trackEvent(req, "verify");
    try {
      const { paymentPayload, paymentRequirements } = req.body;
      const result = await facilitator.verify(paymentPayload, paymentRequirements);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      res.status(400).json({
        isValid: false,
        invalidReason: "verify_error",
        invalidMessage: message,
      });
    }
  });

  // POST /settle — standard x402 settle endpoint
  app.post("/settle", async (req: Request, res: Response) => {
    trackEvent(req, "settle");
    try {
      const { paymentPayload, paymentRequirements } = req.body;
      const result = await facilitator.settle(paymentPayload, paymentRequirements);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Settlement failed";
      res.status(400).json({
        success: false,
        errorReason: "settle_error",
        errorMessage: message,
        transaction: "",
        network: "",
      });
    }
  });

  // POST /invoice — Lightning-specific: generate a fresh BOLT11 invoice for a merchant.
  // Accepts a merchantId; looks up the NWC connection secret from Redis server-side.
  app.post("/invoice", async (req: Request, res: Response) => {
    trackEvent(req, "invoice");
    try {
      const {
        amount,
        merchantId,
        description = "x402 payment",
        network = BITCOIN_MAINNET,
      } = req.body as {
        amount: unknown;
        merchantId: unknown;
        description?: string;
        network?: string;
      };

      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
        res.status(400).json({ error: "amount must be a positive safe integer (millisatoshis)" });
        return;
      }

      if (typeof merchantId !== "string" || !merchantId) {
        res.status(400).json({ error: "merchantId is required" });
        return;
      }

      const nwcSecret = await redis.get(`merchant:${merchantId}`);
      if (!nwcSecret) {
        res.status(404).json({ error: "merchant not found" });
        return;
      }

      const result = await makeInvoice(nwcSecret, amount, description);

      await storeInvoice({
        invoice: result.invoice,
        paymentHash: result.paymentHash,
        amountMsats: amount, // amount is already in millisatoshis
        description,
        expiresAt: result.expiresAt,
        network,
        nwcSecret,
      });

      res.json({
        invoice: result.invoice,
        paymentHash: result.paymentHash,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invoice creation failed";
      res.status(500).json({ error: message });
    }
  });

  // GET /invoice/status?invoice=<bolt11> — poll payment status by invoice string.
  // Used by the paywall page after the user scans the QR code on their mobile wallet.
  app.get("/invoice/status", async (req: Request, res: Response) => {
    const invoiceParam = req.query.invoice;
    if (typeof invoiceParam !== "string" || !invoiceParam) {
      res.status(400).json({ error: "invoice query parameter is required" });
      return;
    }
    try {
      const stored = await getInvoiceByInvoiceStr(invoiceParam);
      if (!stored) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      const result = await lookupInvoice(stored.nwcSecret, stored.paymentHash);
      res.json({ paid: !!result.settledAt });
    } catch {
      res.json({ paid: false });
    }
  });

  // GET /invoice/:paymentHash — look up a stored invoice (used by demo to reuse invoices)
  app.get("/invoice/:paymentHash", async (req: Request, res: Response) => {
    try {
      const stored = await getInvoice(req.params.paymentHash);
      if (!stored) {
        res.status(404).json({ error: "Invoice not found or expired" });
        return;
      }
      res.json({
        invoice: stored.invoice,
        paymentHash: stored.paymentHash,
        expiresAt: stored.expiresAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lookup failed";
      res.status(500).json({ error: message });
    }
  });

  // Mount demo routes if DEMO_NWC_SECRET is configured.
  // The demo merchant is registered at startup so its merchantId is stable for the
  // lifetime of this process.
  const DEMO_NWC_SECRET = process.env.DEMO_NWC_SECRET;
  if (DEMO_NWC_SECRET) {
    const demoMerchantId = randomUUID();
    await redis.set(`merchant:${demoMerchantId}`, DEMO_NWC_SECRET);
    app.use("/demo", createDemoRouter(process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`, demoMerchantId, facilitator));
  }

  return app;
}
