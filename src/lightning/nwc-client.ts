import { NWCClient } from "@getalby/sdk";

// Cache NWC clients by connection secret to avoid creating a new connection per request
const clientCache = new Map<string, NWCClient>();

function getClient(nwcSecret: string): NWCClient {
  let client = clientCache.get(nwcSecret);
  if (!client) {
    client = new NWCClient({ nostrWalletConnectUrl: nwcSecret });
    clientCache.set(nwcSecret, client);
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
  nwcSecret: string,
  amountSats: number,
  description: string = "x402 payment",
): Promise<MakeInvoiceResult> {
  const c = getClient(nwcSecret);
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

export async function lookupInvoice(
  nwcSecret: string,
  paymentHash: string,
): Promise<LookupInvoiceResult> {
  const c = getClient(nwcSecret);
  const result = await c.lookupInvoice({ payment_hash: paymentHash });
  return {
    settledAt: result.settled_at,
    preimage: result.preimage,
  };
}
