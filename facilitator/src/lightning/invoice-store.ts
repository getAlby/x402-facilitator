export interface StoredInvoice {
  invoice: string;
  paymentHash: string;
  amountMsats: number;
  description: string;
  expiresAt: number; // unix timestamp (seconds)
  network: string;
}

const store = new Map<string, StoredInvoice>();

// Clean up expired invoices every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [hash, inv] of store) {
    if (inv.expiresAt < now) {
      store.delete(hash);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function storeInvoice(invoice: StoredInvoice): void {
  store.set(invoice.paymentHash, invoice);
}

export function getInvoice(paymentHash: string): StoredInvoice | undefined {
  return store.get(paymentHash);
}

export function deleteInvoice(paymentHash: string): void {
  store.delete(paymentHash);
}
