import { redis } from "../redis";

export interface StoredInvoice {
  invoice: string;
  paymentHash: string;
  amountMsats: number;
  description: string;
  expiresAt: number; // unix timestamp (seconds)
  network: string;
  nwcSecret: string; // merchant's NWC connection secret — used to look up settlement
}

export async function storeInvoice(invoice: StoredInvoice): Promise<void> {
  const ttl = invoice.expiresAt - Math.floor(Date.now() / 1000);
  if (ttl <= 0) return; // already expired before we even store it
  await redis.set(`invoice:${invoice.paymentHash}`, JSON.stringify(invoice), "EX", ttl);
}

export async function getInvoice(paymentHash: string): Promise<StoredInvoice | null> {
  const raw = await redis.get(`invoice:${paymentHash}`);
  return raw ? (JSON.parse(raw) as StoredInvoice) : null;
}

export async function deleteInvoice(paymentHash: string): Promise<void> {
  await redis.del(`invoice:${paymentHash}`);
}

// Atomic Redis lock to prevent concurrent settle attempts for the same invoice.
// Returns true if the lock was acquired, false if already being settled.
export async function acquireSettleLock(paymentHash: string): Promise<boolean> {
  const result = await redis.set(`settling:${paymentHash}`, "1", "EX", 30, "NX");
  return result === "OK";
}

export async function releaseSettleLock(paymentHash: string): Promise<void> {
  await redis.del(`settling:${paymentHash}`);
}
