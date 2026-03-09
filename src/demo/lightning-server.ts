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
 * for Lightning Network payments. Its key responsibility is enhancePaymentRequirements(),
 * which is called per-request to generate a fresh BOLT11 invoice and inject it into
 * the PaymentRequirements.extra field of each 402 response.
 *
 * Multi-tenant: the merchant's opaque merchantId is read from requirements.extra.merchantId
 * and forwarded to the facilitator's POST /invoice endpoint, which looks up the NWC
 * connection secret server-side without exposing it to clients.
 */
export class LightningSchemeNetworkServer implements SchemeNetworkServer {
  readonly scheme = "exact";

  constructor(private readonly facilitatorUrl: string) {}

  async parsePrice(price: Price, _network: Network): Promise<AssetAmount> {
    // Accept AssetAmount directly: { amount: "100", asset: "sat" }
    if (typeof price === "object" && "amount" in price && "asset" in price) {
      return { amount: String(price.amount), asset: String(price.asset) };
    }

    // Numeric: treat as satoshis
    if (typeof price === "number") {
      return { amount: String(Math.round(price)), asset: "sat" };
    }

    // String "$X.XX" style — fetch live BTC/USD rate via @getalby/lightning-tools
    if (typeof price === "string" && price.startsWith("$")) {
      const usd = parseFloat(price.slice(1));
      if (isNaN(usd)) throw new Error(`Cannot parse USD price: ${price}`);
      const sats = await getSatoshiValue({ amount: usd, currency: "USD" });
      return { amount: String(sats), asset: "sat" };
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

    // When processing an X-PAYMENT submission, the middleware calls this again to rebuild
    // requirements for matching. Reuse the already-generated invoice so deepEqual matching succeeds.
    const { paymentHash: existingHash } = requestContext.getStore() ?? {};
    if (existingHash) {
      const response = await fetch(`${this.facilitatorUrl}/invoice/${existingHash}`);
      if (response.ok) {
        const stored = (await response.json()) as InvoiceResponse;
        return {
          ...requirements,
          extra: {
            ...extra,
            invoice: stored.invoice,
            paymentHash: stored.paymentHash,
            expiresAt: stored.expiresAt,
          },
        };
      }
    }

    // No existing invoice — generate a fresh BOLT11 invoice via the facilitator.
    // requirements.amount may be an AssetAmount object or a string/number scalar —
    // extract the numeric satoshi value defensively.
    const rawAmount = requirements.amount as unknown;
    const amountSats =
      typeof rawAmount === "object" && rawAmount !== null && "amount" in rawAmount
        ? Number((rawAmount as { amount: unknown }).amount)
        : Number(rawAmount);

    const response = await fetch(`${this.facilitatorUrl}/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountSats,
        merchantId,
        description: "x402 payment",
        network: requirements.network,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to generate Lightning invoice from facilitator: ${err}`);
    }

    const { invoice, paymentHash, expiresAt } = (await response.json()) as InvoiceResponse;

    return {
      ...requirements,
      extra: {
        ...extra,
        invoice,
        paymentHash,
        expiresAt,
      },
    };
  }
}
