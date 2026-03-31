/**
 * End-to-end test for the x402 Lightning facilitator (with embedded demo)
 *
 * Requires:
 *   - .env              — REDIS_URL, DEMO_NWC_SECRET, SENDER_NWC_SECRET
 *                         (copy .env.example → .env and fill in your values)
 *   - Facilitator running on http://localhost:3000  (npm run dev)
 *
 * Run: npm run test:e2e
 */

import dotenv from "dotenv";
import { NWCClient } from "@getalby/sdk";

dotenv.config({ path: ".env" });

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";
// After merging the demo into the facilitator, the demo app lives at /demo
const APP_URL = process.env.APP_URL || `${FACILITATOR_URL}/demo`;
const SENDER_NWC_SECRET = process.env.SENDER_NWC_SECRET;

if (!SENDER_NWC_SECRET) {
  console.error("✗ SENDER_NWC_SECRET is not set.");
  console.error("  Copy .env.example → .env and fill in SENDER_NWC_SECRET.");
  process.exit(1);
}

function ok(label: string, value: unknown) {
  console.log(`  ✓ ${label}: ${JSON.stringify(value)}`);
}

function fail(label: string, reason: string): never {
  console.error(`  ✗ ${label}: ${reason}`);
  process.exit(1);
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

function b64encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

async function main() {
  // ─────────────────────────────────────────────
  // 1. Facilitator /supported
  // ─────────────────────────────────────────────
  section("1. Facilitator /supported");

  const supportedRes = await fetch(`${FACILITATOR_URL}/supported`);
  if (!supportedRes.ok) fail("/supported", `HTTP ${supportedRes.status}`);
  const supported = (await supportedRes.json()) as any;

  if (!supported.kinds?.length) fail("kinds", "empty");
  ok("x402Version", supported.kinds[0].x402Version);
  ok("scheme", supported.kinds[0].scheme);
  ok("networks", supported.kinds.map((k: any) => k.network).join(", "));

  // ─────────────────────────────────────────────
  // 2. Demo GET /resource → 402 with Lightning invoice
  // ─────────────────────────────────────────────
  section("2. Demo GET /quote → 402 Payment Required");

  const resourceRes = await fetch(`${APP_URL}/quote`);
  if (resourceRes.status !== 402) fail("status", `expected 402, got ${resourceRes.status}`);
  ok("status", 402);

  const paymentRequiredHeader = resourceRes.headers.get("payment-required");
  if (!paymentRequiredHeader) fail("PAYMENT-REQUIRED header", "missing");

  const paymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader!, "base64").toString("utf8"),
  ) as any;

  ok("x402Version", paymentRequired.x402Version);
  ok("resource.url", paymentRequired.resource.url);

  const accepted = paymentRequired.accepts[0];
  ok("scheme", accepted.scheme);
  ok("network", accepted.network);
  ok("amount (msats)", `${accepted.amount} ${accepted.asset}`);
  ok("paymentMethod", accepted.extra.paymentMethod);

  const { invoice } = accepted.extra as { invoice: string };
  if (!invoice?.startsWith("lnbc")) fail("invoice", "expected BOLT11 starting with lnbc");
  ok("invoice", invoice.slice(0, 50) + "...");

  // ─────────────────────────────────────────────
  // 3. /verify — wrong invoice (expect rejection)
  // ─────────────────────────────────────────────
  section("3. Facilitator /verify — mismatched invoice (expect rejection)");

  // Tamper the invoice to trigger invoice_mismatch
  const wrongInvoice = invoice.slice(0, -4) + "0000";
  const verifyBadRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted,
        payload: { invoice: wrongInvoice },
      },
      paymentRequirements: accepted,
    }),
  });
  const verifyBad = (await verifyBadRes.json()) as any;
  if (verifyBad.isValid) fail("verify wrong invoice", "should be invalid");
  ok("isValid", verifyBad.isValid);
  ok("invalidReason", verifyBad.invalidReason);

  // ─────────────────────────────────────────────
  // 4. Pay the invoice with the sender NWC wallet
  // ─────────────────────────────────────────────
  section("4. Paying invoice via sender NWC wallet");

  console.log(`  Invoice: ${invoice.slice(0, 60)}...`);

  const senderClient = new NWCClient({ nostrWalletConnectUrl: SENDER_NWC_SECRET! });

  try {
    await senderClient.payInvoice({ invoice });
    ok("payment", "sent");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("payInvoice", msg);
  } finally {
    senderClient.close();
  }

  // ─────────────────────────────────────────────
  // 5. /verify — correct invoice after payment (expect success)
  // ─────────────────────────────────────────────
  section("5. Facilitator /verify — correct invoice after payment (expect success)");

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted,
        payload: { invoice },
      },
      paymentRequirements: accepted,
    }),
  });
  const verifyResult = (await verifyRes.json()) as any;
  if (!verifyResult.isValid) {
    fail("verify real invoice", `${verifyResult.invalidReason}: ${verifyResult.invalidMessage}`);
  }
  ok("isValid", verifyResult.isValid);

  // ─────────────────────────────────────────────
  // 6. Demo GET /resource with payment-signature → 200
  // ─────────────────────────────────────────────
  section("6. Demo GET /quote with payment-signature → 200");

  const paymentSignatureHeader = b64encode({
    x402Version: 2,
    resource: paymentRequired.resource,
    payload: { invoice },
    accepted,
  });

  const paidRes = await fetch(`${APP_URL}/quote`, {
    headers: { "payment-signature": paymentSignatureHeader },
  });

  if (paidRes.status !== 200) {
    const body = await paidRes.text();
    fail("GET /quote with payment", `expected 200, got ${paidRes.status}: ${body}`);
  }

  const paidBody = (await paidRes.json()) as any;
  ok("status", 200);
  ok("quote", paidBody.quote);

  section("All tests passed! ✓");
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
