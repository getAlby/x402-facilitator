import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  paymentHash?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
