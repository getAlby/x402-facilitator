import { x402Facilitator } from "@x402/core/facilitator";
import { LightningExactScheme } from "./lightning/scheme";

export function createFacilitator(): x402Facilitator {
  return new x402Facilitator().register(
    "bip122:000000000019d6689c085ae165831e93",
    new LightningExactScheme(),
  );
}
