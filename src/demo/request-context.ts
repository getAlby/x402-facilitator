import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  existingInvoice?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
