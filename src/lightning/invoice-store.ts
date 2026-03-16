import { redis } from "../redis";

const SETTLE_LOCK_TTL_SECS = 30; // max time to hold a settle lock before auto-release

export interface StoredInvoice {
  invoice: string;
  paymentHash: string;
  amountMsats: number;
  description: string;
  expiresAt: number; // unix timestamp (seconds)
  network: string;
  nwcSecret: string; // merchant's NWC connection secret — used to look up settlement
}

export async function storeInvoice(inv: StoredInvoice): Promise<void> {
  const ttl = inv.expiresAt - Math.floor(Date.now() / 1000);
  if (ttl <= 0) return; // already expired before we even store it
  const pipeline = redis.pipeline();
  pipeline.set(`invoice:${inv.paymentHash}`, JSON.stringify(inv), "EX", ttl);
  // Secondary index: invoice string → paymentHash (for lookup by BOLT11 string)
  pipeline.set(`invoice_str:${inv.invoice}`, inv.paymentHash, "EX", ttl);
  await pipeline.exec();
}

export async function getInvoice(paymentHash: string): Promise<StoredInvoice | null> {
  const raw = await redis.get(`invoice:${paymentHash}`);
  return raw ? (JSON.parse(raw) as StoredInvoice) : null;
}

export async function getInvoiceByInvoiceStr(invoiceStr: string): Promise<StoredInvoice | null> {
  const paymentHash = await redis.get(`invoice_str:${invoiceStr}`);
  if (!paymentHash) return null;
  return getInvoice(paymentHash);
}

export async function deleteInvoice(paymentHash: string): Promise<void> {
  // Fetch first to clean up secondary index
  const stored = await getInvoice(paymentHash);
  const pipeline = redis.pipeline();
  pipeline.del(`invoice:${paymentHash}`);
  if (stored) pipeline.del(`invoice_str:${stored.invoice}`);
  await pipeline.exec();
}

// Atomic Redis lock to prevent concurrent settle attempts for the same invoice.
// Returns true if the lock was acquired, false if already being settled.
export async function acquireSettleLock(paymentHash: string): Promise<boolean> {
  const result = await redis.set(`settling:${paymentHash}`, "1", "EX", SETTLE_LOCK_TTL_SECS, "NX");
  return result === "OK";
}

export async function releaseSettleLock(paymentHash: string): Promise<void> {
  await redis.del(`settling:${paymentHash}`);
}
