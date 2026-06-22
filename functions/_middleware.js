import { handleOwnerMiddleware } from "./_lib/owner-middleware.mjs";

export function onRequest(context) {
  return handleOwnerMiddleware(context);
}
