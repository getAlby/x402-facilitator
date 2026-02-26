import express, { Request, Response } from "express";
import { createFacilitator } from "./facilitator";
import { makeInvoice } from "./lightning/nwc-client";
import { storeInvoice, getInvoice } from "./lightning/invoice-store";

const app = express();
app.use(express.json());

const facilitator = createFacilitator();

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

// GET /supported — capability discovery
app.get("/supported", (_req: Request, res: Response) => {
  res.json(facilitator.getSupported());
});

// POST /invoice — Lightning-specific: generate a fresh BOLT11 invoice
// Called by the resource server's LightningSchemeNetworkServer.enhancePaymentRequirements()
app.post("/invoice", async (req: Request, res: Response) => {
  try {
    const {
      amount,
      description = "x402 payment",
      network = "lightning:mainnet",
    } = req.body as {
      amount: unknown;
      description?: string;
      network?: string;
    };

    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive integer (satoshis)" });
      return;
    }

    const result = await makeInvoice(amount, description);

    storeInvoice({
      invoice: result.invoice,
      paymentHash: result.paymentHash,
      amountMsats: amount * 1000,
      description,
      expiresAt: result.expiresAt,
      network,
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

// GET /invoice/:paymentHash — look up a stored invoice by paymentHash
// Used by the resource server to reuse an already-generated invoice when processing X-PAYMENT
app.get("/invoice/:paymentHash", (req: Request, res: Response) => {
  const stored = getInvoice(req.params.paymentHash);
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

export { app };
