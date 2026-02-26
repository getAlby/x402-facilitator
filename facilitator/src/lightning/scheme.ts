import { createHash } from "crypto";
import type { SchemeNetworkFacilitator, FacilitatorContext } from "@x402/core/types";
import type { VerifyResponse, SettleResponse } from "@x402/core/types";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Network } from "@x402/core/types";
import { getInvoice, deleteInvoice } from "./invoice-store";
import { lookupInvoice } from "./nwc-client";

export class LightningExactScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "lightning:*";

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
    const { preimage } = payload.payload as { preimage?: string };
    const extra = requirements.extra as { paymentHash?: string };

    if (!preimage) {
      return {
        isValid: false,
        invalidReason: "missing_preimage",
        invalidMessage: "Payment payload must include a preimage",
      };
    }

    if (!extra.paymentHash) {
      return {
        isValid: false,
        invalidReason: "missing_payment_hash",
        invalidMessage: "Payment requirements must include a paymentHash in extra",
      };
    }

    // Verify cryptographically: sha256(preimage) == paymentHash (no network call)
    let computedHash: string;
    try {
      computedHash = createHash("sha256")
        .update(Buffer.from(preimage, "hex"))
        .digest("hex");
    } catch {
      return {
        isValid: false,
        invalidReason: "invalid_preimage",
        invalidMessage: "Preimage must be a valid hex string",
      };
    }

    if (computedHash !== extra.paymentHash) {
      return {
        isValid: false,
        invalidReason: "invalid_preimage",
        invalidMessage: "Preimage does not match payment hash",
      };
    }

    // Check invoice exists in store
    const stored = getInvoice(extra.paymentHash);
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

    // Check amount — allow overpayment, reject underpayment
    const requiredMsats = Number(requirements.amount) * 1000;
    if (stored.amountMsats < requiredMsats) {
      return {
        isValid: false,
        invalidReason: "amount_too_low",
        invalidMessage: `Invoice amount ${stored.amountMsats} msats is less than required ${requiredMsats} msats`,
      };
    }

    return { isValid: true };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const { preimage } = payload.payload as { preimage: string };
    const extra = requirements.extra as { paymentHash: string };

    // Confirm the invoice is paid via NWC
    const result = await lookupInvoice(extra.paymentHash);
    if (!result.settledAt) {
      throw new Error("Invoice is not settled — payment has not been received");
    }

    // Remove from the invoice store
    deleteInvoice(extra.paymentHash);

    return {
      success: true,
      transaction: preimage, // preimage is the canonical proof of payment in Lightning
      network: requirements.network,
    };
  }
}
