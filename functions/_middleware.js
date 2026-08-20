import { handleOwnerMiddleware } from "./_lib/owner-middleware.mjs";
import { handleOfficeMiddleware } from "./_lib/office-middleware.mjs";
import { readStoreState } from "./_lib/store-state.mjs";
import { isPublicStorePage, maintenanceResponse } from "./_lib/store-maintenance.mjs";

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (new URL(context.request.url).pathname.startsWith("/office")) {
    return handleOfficeMiddleware(context);
  }
  if (isPublicStorePage(pathname)) {
    const storeState = await readStoreState(context.env);
    if (storeState.available && storeState.state === "MAINTENANCE") {
      return maintenanceResponse();
    }
  }
  return handleOwnerMiddleware(context);
}
