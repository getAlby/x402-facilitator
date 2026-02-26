import "dotenv/config";
import { app } from "./server";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`x402 Lightning facilitator listening on http://localhost:${PORT}`);
  console.log(`  GET  /supported  — capability discovery`);
  console.log(`  POST /verify     — verify payment preimage`);
  console.log(`  POST /settle     — confirm payment via NWC`);
  console.log(`  POST /invoice    — generate a Lightning invoice (Lightning-specific)`);
  console.log(`Supported networks: lightning:mainnet, lightning:testnet`);
});
