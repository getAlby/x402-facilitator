import express, { Request, Response, NextFunction } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { x402Facilitator } from "@x402/core/facilitator";
import { LightningSchemeNetworkServer } from "./lightning-server";
import { requestContext } from "./request-context";
import { lightningPaywallProvider } from "./paywall";

const BITCOIN_MAINNET = "bip122:000000000019d6689c085ae165831e93";

export function createDemoRouter(facilitatorUrl: string, merchantId: string, facilitator: x402Facilitator) {
  const resourceServer = new x402ResourceServer(facilitator as never)
    .register(BITCOIN_MAINNET, new LightningSchemeNetworkServer(facilitatorUrl));

  const routes = {
    "GET /quote": {
      accepts: {
        scheme: "exact",
        price: "$0.01",
        network: BITCOIN_MAINNET as `${string}:${string}`,
        payTo: "anonymous",
        maxTimeoutSeconds: 300,
        extra: { merchantId },
      },
      description: "Pay 1 sat to unlock a random Satoshi Nakamoto quote",
      mimeType: "application/json",
    },
  };

  const router = express.Router();

  // Extract invoice from payment-signature header for invoice reuse
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const xPayment = req.headers["payment-signature"] as string | undefined;
    if (xPayment) {
      try {
        const payload = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8"));
        const invoice = (payload?.payload?.invoice ?? payload?.accepted?.extra?.invoice) as string | undefined;
        if (invoice) {
          requestContext.run({ existingInvoice: invoice }, next);
          return;
        }
      } catch {
        // malformed header — fall through
      }
    }
    requestContext.run({}, next);
  });

  router.use(paymentMiddleware(routes, resourceServer, undefined, lightningPaywallProvider));

  const SATOSHI_QUOTES = [
    "The root problem with conventional currency is all the trust that's required to make it work.",
    "If you don't believe me or don't get it, I don't have time to try to convince you, sorry.",
    "Lost coins only make everyone else's coins worth slightly more. Think of it as a donation to everyone.",
    "It might make sense just to get some in case it catches on.",
    "Writing a description for this thing for general audiences is bloody hard. There's nothing to relate it to.",
  ];

  router.get("/quote", (_req: Request, res: Response) => {
    const quote = SATOSHI_QUOTES[Math.floor(Math.random() * SATOSHI_QUOTES.length)];
    res.json({
      quote,
      attribution: "Satoshi Nakamoto",
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
