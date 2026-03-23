import { x402Facilitator } from "@x402/core/facilitator";
import { LightningExactScheme } from "./lightning/scheme";
import { BITCOIN_MAINNET } from "./constants";

export function createFacilitator(): x402Facilitator {
  return new x402Facilitator().register(BITCOIN_MAINNET, new LightningExactScheme());
}
