import type { SchemeNetworkFacilitator, FacilitatorContext } from "@x402/core/types";
import type { VerifyResponse, SettleResponse } from "@x402/core/types";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Network } from "@x402/core/types";
import { getInvoiceByInvoiceStr, deleteInvoice, acquireSettleLock, releaseSettleLock } from "./invoice-store";
import { lookupInvoice } from "./nwc-client";

export class LightningExactScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "bip122:*";

  getExtra(_network: Network): Record<string, unknown> | undefined {
    return undefined;
  }

  getSigners(_network: string): string[] {
    return [];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    // Step 2: verify x402Version is 2
    if (payload.x402Version !== 2) {
      return {
        isValid: false,
        invalidReason: "invalid_version",
        invalidMessage: `Unsupported x402Version: ${payload.x402Version}. Only version 2 is supported.`,
      };
    }

    // Step 3: verify network matches
    if (payload.accepted.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: "network_mismatch",
        invalidMessage: `Network in payload (${payload.accepted.network}) does not match requirements (${requirements.network})`,
      };
    }

    const { invoice: payloadInvoice } = payload.payload as { invoice?: string };
    const extra = requirements.extra as { invoice?: string; paymentMethod?: string };

    if (!payloadInvoice) {
      return {
        isValid: false,
        invalidReason: "missing_invoice",
        invalidMessage: "Payment payload must include the paid invoice",
      };
    }

    if (!extra.invoice) {
      return {
        isValid: false,
        invalidReason: "missing_invoice_in_requirements",
        invalidMessage: "Payment requirements must include invoice in extra",
      };
    }

    // Step 4: prevent invoice substitution attacks
    if (payloadInvoice !== extra.invoice) {
      return {
        isValid: false,
        invalidReason: "invoice_mismatch",
        invalidMessage: "Invoice in payload does not match invoice in requirements",
      };
    }

    // Verify invoice was issued by this server
    const stored = await getInvoiceByInvoiceStr(payloadInvoice);
    if (!stored) {
      return {
        isValid: false,
        invalidReason: "unknown_invoice",
        invalidMessage: "Invoice not found or already settled",
      };
    }

    // Check invoice has not expired
    const now = Math.floor(Date.now() / 1000);
    if (stored.expiresAt < now) {
      return {
        isValid: false,
        invalidReason: "expired",
        invalidMessage: "Invoice has expired",
      };
    }

    // Check amount — requirements.amount is in millisatoshis; spec requires exact match
    const amountStr = String(requirements.amount ?? "").trim();
    if (!/^\d+$/.test(amountStr)) {
      return {
        isValid: false,
        invalidReason: "invalid_amount",
        invalidMessage: `Invalid amount in requirements: ${requirements.amount}`,
      };
    }
    const requiredMsats = BigInt(amountStr);
    if (BigInt(stored.amountMsats) !== requiredMsats) {
      return {
        isValid: false,
        invalidReason: "amount_mismatch",
        invalidMessage: `Invoice amount ${stored.amountMsats} msats does not match required ${requiredMsats} msats`,
      };
    }

    // Query Lightning node to verify payment was received
    const result = await lookupInvoice(stored.nwcSecret, stored.paymentHash);
    if (!result.settledAt) {
      return {
        isValid: false,
        invalidReason: "payment_not_received",
        invalidMessage: "Invoice has not been paid yet",
      };
    }

    return { isValid: true, payer: "anonymous" };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const rawPayload = payload.payload as Record<string, unknown>;
    const payloadInvoice = typeof rawPayload?.invoice === "string" ? rawPayload.invoice : "";
    if (!payloadInvoice) {
      return {
        success: false,
        errorReason: "missing_invoice",
        errorMessage: "Payment payload must include the paid invoice",
        transaction: "",
        network: requirements.network,
      };
    }

    const extra = requirements.extra as { invoice?: string };
    if (extra.invoice && payloadInvoice !== extra.invoice) {
      return {
        success: false,
        errorReason: "invoice_mismatch",
        errorMessage: "Invoice in payload does not match invoice in requirements",
        transaction: "",
        network: requirements.network,
      };
    }

    const stored = await getInvoiceByInvoiceStr(payloadInvoice);
    if (!stored) {
      return {
        success: false,
        errorReason: "invoice_not_found",
        errorMessage: "Invoice not found or already settled",
        transaction: "",
        network: requirements.network,
      };
    }

    // Atomic lock: prevent double-settle for the same invoice
    const locked = await acquireSettleLock(stored.paymentHash);
    if (!locked) {
      return {
        success: false,
        errorReason: "settle_in_progress",
        errorMessage: "Settlement already in progress for this invoice",
        transaction: "",
        network: requirements.network,
      };
    }

    try {
      const result = await lookupInvoice(stored.nwcSecret, stored.paymentHash);
      if (!result.settledAt) {
        return {
          success: false,
          errorReason: "payment_not_received",
          errorMessage: "Invoice is not settled — payment has not been received",
          transaction: "",
          network: requirements.network,
        };
      }

      await deleteInvoice(stored.paymentHash);

      return {
        success: true,
        transaction: stored.paymentHash, // SHA-256 payment hash (hex-encoded) per spec
        network: requirements.network,
        payer: "anonymous",
        extensions: {
          invoice: payloadInvoice,
          settledAt: result.settledAt,
        },
      };
    } finally {
      await releaseSettleLock(stored.paymentHash);
    }
  }
}
