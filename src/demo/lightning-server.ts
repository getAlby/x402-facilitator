import type { SchemeNetworkServer } from "@x402/core/types";
import type { PaymentRequirements, Network, Price, AssetAmount } from "@x402/core/types";
import { getSatoshiValue } from "@getalby/lightning-tools";
import { requestContext } from "./request-context";

interface InvoiceResponse {
  invoice: string;
  paymentHash: string;
  expiresAt: number;
}

/**
 * LightningSchemeNetworkServer implements the server-side scheme registration
 * for Lightning Network payments on CAIP-2 Bitcoin networks. Its key responsibility
 * is enhancePaymentRequirements(), which is called per-request to generate a fresh
 * BOLT11 invoice and inject it into the PaymentRequirements.extra field of each 402 response.
 *
 * Multi-tenant: the merchant's opaque merchantId is read from requirements.extra.merchantId
 * and forwarded to the facilitator's POST /invoice endpoint, which looks up the NWC
 * connection secret server-side without exposing it to clients.
 */
export class LightningSchemeNetworkServer implements SchemeNetworkServer {
  readonly scheme = "exact";

  constructor(private readonly facilitatorUrl: string) {}

  async parsePrice(price: Price, _network: Network): Promise<AssetAmount> {
    // Accept AssetAmount with asset "BTC" — amount must already be in millisatoshis per spec
    if (typeof price === "object" && "amount" in price && "asset" in price) {
      if (String(price.asset).toUpperCase() !== "BTC") {
        throw new Error(`Unsupported asset "${price.asset}" — only "BTC" (amount in millisatoshis) is supported`);
      }
      return { amount: String(price.amount), asset: "BTC" };
    }

    // Numeric: treat as satoshis, convert to msats
    if (typeof price === "number") {
      return { amount: String(Math.round(price) * 1000), asset: "BTC" };
    }

    // String "$X.XX" style — fetch live BTC/USD rate via @getalby/lightning-tools
    if (typeof price === "string" && price.startsWith("$")) {
      const usd = parseFloat(price.slice(1));
      if (isNaN(usd)) throw new Error(`Cannot parse USD price: ${price}`);
      const sats = await getSatoshiValue({ amount: usd, currency: "USD" });
      return { amount: String(sats * 1000), asset: "BTC" };
    }

    throw new Error(`Cannot parse price: ${JSON.stringify(price)}`);
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _supportedKind: { x402Version: number; scheme: string; network: Network; extra?: Record<string, unknown> },
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    const extra = (requirements.extra ?? {}) as Record<string, unknown>;

    const merchantId = extra.merchantId as string | undefined;
    if (!merchantId) {
      throw new Error(
        "requirements.extra.merchantId is required for Lightning payments — " +
          "set it in the route configuration to the merchant's ID from POST /register",
      );
    }

    // When processing a payment-signature submission, reuse the invoice from the payload
    // so deepEqual matching against the client's accepted requirements succeeds.
    const { existingInvoice } = requestContext.getStore() ?? {};
    if (existingInvoice) {
      return {
        ...requirements,
        payTo: requirements.payTo || "anonymous",
        extra: {
          paymentMethod: "lightning",
          invoice: existingInvoice,
        },
      };
    }

    // No existing invoice — generate a fresh BOLT11 invoice via the facilitator.
    // requirements.amount is in millisatoshis (as set by parsePrice).
    const amountMsats = Number(requirements.amount);

    const response = await fetch(`${this.facilitatorUrl}/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountMsats,
        merchantId,
        description: "x402 payment",
        network: requirements.network,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to generate Lightning invoice from facilitator: ${err}`);
    }

    const { invoice } = (await response.json()) as InvoiceResponse;

    return {
      ...requirements,
      payTo: requirements.payTo || "anonymous",
      extra: {
        paymentMethod: "lightning",
        invoice,
      },
    };
  }
}
