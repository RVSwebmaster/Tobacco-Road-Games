import { handleOwnerMiddleware } from "./_lib/owner-middleware.mjs";
import { handleOfficeMiddleware } from "./_lib/office-middleware.mjs";

export function onRequest(context) {
  if (new URL(context.request.url).pathname.startsWith("/office")) {
    return handleOfficeMiddleware(context);
  }
  return handleOwnerMiddleware(context);
}
