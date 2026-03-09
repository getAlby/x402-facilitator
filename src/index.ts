import "dotenv/config";
import { createApp } from "./server";

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const app = await createApp();

  app.listen(PORT, () => {
    console.log(`x402 Lightning facilitator listening on http://localhost:${PORT}`);
    console.log(`  GET  /health    — liveness probe`);
    console.log(`  GET  /supported — capability discovery`);
    console.log(`  POST /register  — register a merchant NWC connection secret`);
    console.log(`  POST /verify    — verify payment preimage`);
    console.log(`  POST /settle    — confirm payment via NWC`);
    console.log(`  POST /invoice   — generate a Lightning invoice`);
    console.log(`  GET  /invoice/:paymentHash — look up a stored invoice`);
    if (process.env.DEMO_NWC_SECRET) {
      console.log(`  GET  /demo/echo     — x402 echo demo (requires $0.01)`);
      console.log(`  GET  /invoice/status/:paymentHash — poll payment status`);
    }
    console.log(`Supported networks: lightning:mainnet`);
  });
}

main().catch(err => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
