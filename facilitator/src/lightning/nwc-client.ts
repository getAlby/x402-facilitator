import { NWCClient } from "@getalby/sdk";

let client: NWCClient | null = null;

function getClient(): NWCClient {
  if (!client) {
    const nwcUrl = process.env.NWC_URL;
    if (!nwcUrl) {
      throw new Error("NWC_URL environment variable is required");
    }
    client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
  }
  return client;
}

export interface MakeInvoiceResult {
  invoice: string;
  paymentHash: string;
  expiresAt: number;
}

export interface LookupInvoiceResult {
  settledAt?: number;
  preimage?: string;
}

export async function makeInvoice(
  amountSats: number,
  description: string = "x402 payment",
): Promise<MakeInvoiceResult> {
  const c = getClient();
  const result = await c.makeInvoice({
    amount: amountSats * 1000, // NWC amounts are in millisatoshis
    description,
  });
  return {
    invoice: result.invoice!,
    paymentHash: result.payment_hash,
    expiresAt: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function lookupInvoice(paymentHash: string): Promise<LookupInvoiceResult> {
  const c = getClient();
  const result = await c.lookupInvoice({ payment_hash: paymentHash });
  return {
    settledAt: result.settled_at,
    preimage: result.preimage,
  };
}
