import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { redis } from "./redis";
import { createFacilitator } from "./facilitator";
import { makeInvoice, lookupInvoice } from "./lightning/nwc-client";
import { storeInvoice, getInvoice } from "./lightning/invoice-store";
import { createDemoRouter } from "./demo/routes";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  const app = express();
  app.use(express.json());

  const facilitator = createFacilitator();

  // GET / — landing page
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(join(__dirname, "landing.html"));
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
  app.get("/.well-known/x402", (_req: Request, res: Response) => {
    const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    res.json({
      protocol: "x402",
      version: 2,
      transport: "lightning",
      description:
        "This server implements the x402 HTTP payment protocol over Bitcoin Lightning Network. " +
        "Unlike EVM-based x402 where the client submits a signed transaction, Lightning requires " +
        "a BOLT11 invoice to be generated server-side before the client pays. " +
        "The invoice and its payment hash are embedded in the 402 response's PAYMENT-REQUIRED header " +
        "under accepts[0].extra. The client pays the invoice, then proves payment by providing the " +
        "preimage (sha256 preimage of the payment hash) in the payment-signature header.",
      facilitator: {
        supported: `${base}/supported`,
        verify: `${base}/verify`,
        settle: `${base}/settle`,
      },
      lightningExtensions: {
        invoiceStatus: {
          endpoint: `${base}/invoice/status/:paymentHash`,
          method: "GET",
          description:
            "Poll this endpoint after instructing the user (or your wallet) to pay the BOLT11 invoice. " +
            "Returns { paid: false } while unpaid. Returns { paid: true, preimage: '<hex>' } once the " +
            "Lightning payment settles. Use the preimage as payload.preimage in the payment-signature header.",
          responseSchema: {
            paid: "boolean",
            preimage: "string (hex, 64 chars) — only present when paid: true",
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
            "The BOLT11 invoice is at requirements.extra.invoice. " +
            "The payment hash is at requirements.extra.paymentHash.",
        },
        {
          step: 2,
          action: "Pay requirements.extra.invoice",
          description:
            "Pay the BOLT11 invoice using any Lightning wallet or NWC client. " +
            "Example with @getalby/sdk: const { preimage } = await nwcClient.payInvoice({ invoice }). " +
            "If you cannot pay directly (e.g. browser without wallet access), display the invoice " +
            "as a QR code and poll /invoice/status/:paymentHash until paid: true.",
        },
        {
          step: 3,
          action: "GET <resource-url> with payment-signature header",
          description: "Retry the request with cryptographic proof of payment.",
          headerConstruction:
            "Build a PaymentPayload object: { x402Version: 2, scheme: requirements.scheme, " +
            "network: requirements.network, payload: { preimage: '<hex preimage from step 2>' }, " +
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
  app.get("/supported", (_req: Request, res: Response) => {
    res.json(facilitator.getSupported());
  });

  // POST /register — public: merchant submits their NWC connection secret, receives a
  // stable merchantId (UUID). The secret is stored server-side in Redis; clients only
  // ever see the opaque UUID.
  app.post("/register", async (req: Request, res: Response) => {
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
    try {
      const {
        amount,
        merchantId,
        description = "x402 payment",
        network = "lightning:mainnet",
      } = req.body as {
        amount: unknown;
        merchantId: unknown;
        description?: string;
        network?: string;
      };

      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ error: "amount must be a positive integer (satoshis)" });
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
        amountMsats: amount * 1000,
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

  // GET /invoice/status/:paymentHash — poll payment status; returns preimage when paid.
  // Used by the paywall page after the user scans the QR code on their mobile wallet.
  app.get("/invoice/status/:paymentHash", async (req: Request, res: Response) => {
    const stored = await getInvoice(req.params.paymentHash);
    if (!stored) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    try {
      const result = await lookupInvoice(stored.nwcSecret, req.params.paymentHash);
      if (result.settledAt && result.preimage) {
        res.json({ paid: true, preimage: result.preimage });
      } else {
        res.json({ paid: false });
      }
    } catch {
      res.json({ paid: false });
    }
  });

  // GET /invoice/:paymentHash — look up a stored invoice (used by demo to reuse invoices)
  app.get("/invoice/:paymentHash", async (req: Request, res: Response) => {
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
  });

  // Mount demo routes if DEMO_NWC_SECRET is configured.
  // The demo merchant is registered at startup so its merchantId is stable for the
  // lifetime of this process.
  const DEMO_NWC_SECRET = process.env.DEMO_NWC_SECRET;
  if (DEMO_NWC_SECRET) {
    const demoMerchantId = randomUUID();
    await redis.set(`merchant:${demoMerchantId}`, DEMO_NWC_SECRET);
    const port = process.env.PORT || "3000";
    app.use("/demo", createDemoRouter(`http://localhost:${port}`, demoMerchantId, facilitator));
  }

  return app;
}
