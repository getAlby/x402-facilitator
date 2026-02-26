/**
 * End-to-end test for the x402 Lightning facilitator + app
 *
 * Requires:
 *   - facilitator/.env  — NWC_URL for the receiver wallet (used by the facilitator server)
 *   - .env.sender       — SENDER_NWC_URL for the sender wallet (pays the invoice)
 *   - Facilitator running on http://localhost:3000  (cd facilitator && npm run dev)
 *   - App running on http://localhost:4000          (cd app && npm run dev)
 *
 * Run: npm run e2e
 */

import dotenv from "dotenv";
import { NWCClient } from "@getalby/sdk";
import { createHash } from "crypto";

dotenv.config({ path: ".env.sender" });

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";
const APP_URL = process.env.APP_URL || "http://localhost:4000";
const SENDER_NWC_URL = process.env.SENDER_NWC_URL;

if (!SENDER_NWC_URL) {
  console.error("✗ SENDER_NWC_URL is not set.");
  console.error("  Copy .env.sender.example → .env.sender and fill in your sender wallet.");
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
  // 2. App GET /resource → 402 with Lightning invoice
  // ─────────────────────────────────────────────
  section("2. App GET /resource → 402 Payment Required");

  const resourceRes = await fetch(`${APP_URL}/resource`);
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
  ok("amount", `${accepted.amount} ${accepted.asset}`);

  const { invoice, paymentHash } = accepted.extra as { invoice: string; paymentHash: string };
  if (!invoice?.startsWith("lnbc")) fail("invoice", "expected BOLT11 starting with lnbc");
  ok("invoice", invoice.slice(0, 50) + "...");
  ok("paymentHash", paymentHash);

  // ─────────────────────────────────────────────
  // 3. /verify — wrong preimage (expect rejection)
  // ─────────────────────────────────────────────
  section("3. Facilitator /verify — wrong preimage (expect rejection)");

  const badPreimage = "deadbeef".repeat(8);
  const verifyBadRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted,
        payload: { preimage: badPreimage },
      },
      paymentRequirements: accepted,
    }),
  });
  const verifyBad = (await verifyBadRes.json()) as any;
  if (verifyBad.isValid) fail("verify bad preimage", "should be invalid");
  ok("isValid", verifyBad.isValid);
  ok("invalidReason", verifyBad.invalidReason);

  // ─────────────────────────────────────────────
  // 4. Pay the invoice with the sender NWC wallet
  // ─────────────────────────────────────────────
  section("4. Paying invoice via sender NWC wallet");

  console.log(`  Invoice: ${invoice.slice(0, 60)}...`);

  const senderClient = new NWCClient({ nostrWalletConnectUrl: SENDER_NWC_URL! });
  let preimage!: string;

  try {
    const payResult = await senderClient.payInvoice({ invoice });
    preimage = payResult.preimage;
    ok("preimage", preimage.slice(0, 16) + "...");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("payInvoice", msg);
  } finally {
    senderClient.close();
  }

  // Sanity-check: sha256(preimage) must equal paymentHash
  const computedHash = createHash("sha256")
    .update(Buffer.from(preimage, "hex"))
    .digest("hex");
  if (computedHash !== paymentHash) {
    fail(
      "preimage hash check",
      `sha256(preimage)=${computedHash} ≠ paymentHash=${paymentHash}`,
    );
  }
  ok("sha256(preimage) == paymentHash", true);

  // ─────────────────────────────────────────────
  // 5. /verify — real preimage (expect success)
  // ─────────────────────────────────────────────
  section("5. Facilitator /verify — real preimage (expect success)");

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted,
        payload: { preimage },
      },
      paymentRequirements: accepted,
    }),
  });
  const verifyResult = (await verifyRes.json()) as any;
  if (!verifyResult.isValid) {
    fail("verify real preimage", `${verifyResult.invalidReason}: ${verifyResult.invalidMessage}`);
  }
  ok("isValid", verifyResult.isValid);

  // ─────────────────────────────────────────────
  // 6. App GET /resource with X-PAYMENT → 200
  // ─────────────────────────────────────────────
  section("6. App GET /resource with payment-signature → 200");

  const paymentSignatureHeader = b64encode({
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: { preimage },
  });

  const paidRes = await fetch(`${APP_URL}/resource`, {
    headers: { "payment-signature": paymentSignatureHeader },
  });

  if (paidRes.status !== 200) {
    const body = await paidRes.text();
    fail("GET /resource with payment", `expected 200, got ${paidRes.status}: ${body}`);
  }

  const paidBody = (await paidRes.json()) as any;
  ok("status", 200);
  ok("message", paidBody.message);

  section("All tests passed! ✓");
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
