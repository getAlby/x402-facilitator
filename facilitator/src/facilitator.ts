import { x402Facilitator } from "@x402/core/facilitator";
import { LightningExactScheme } from "./lightning/scheme";

export function createFacilitator(): x402Facilitator {
  return new x402Facilitator().register(
    ["lightning:mainnet", "lightning:testnet"],
    new LightningExactScheme(),
  );
}
