import "dotenv/config";
import { app } from "./server";

const PORT = Number(process.env.PORT) || 4000;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";

app.listen(PORT, () => {
  console.log(`x402 Lightning demo app listening on http://localhost:${PORT}`);
  console.log(`  GET /resource  — protected, requires 100 sat Lightning payment`);
  console.log(`  GET /health    — health check`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
});
