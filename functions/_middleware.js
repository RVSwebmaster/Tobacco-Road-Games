import { handleOwnerMiddleware } from "./_lib/owner-middleware.mjs";
import { handleOfficeMiddleware } from "./_lib/office-middleware.mjs";
import { readStoreState } from "./_lib/store-state.mjs";
import { isPublicStorePage, maintenanceResponse } from "./_lib/store-maintenance.mjs";
import { isAuthenticatedOwnerRequest } from "./_lib/owner-public-bypass.mjs";

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (new URL(context.request.url).pathname.startsWith("/office")) {
    return handleOfficeMiddleware(context);
  }
  if (isPublicStorePage(pathname)) {
    const storeState = await readStoreState(context.env);
    const ownerBypass = await isAuthenticatedOwnerRequest(context.request, context.env);
    if (!ownerBypass && storeState.available && storeState.state === "MAINTENANCE") {
      return maintenanceResponse();
    }
  }
  const response=await handleOwnerMiddleware(context);
  if(requestsPublicBanner(pathname,response))return new HTMLRewriter().on('header.site-header',{element(element){element.after(`<aside class="marketplace-ad-banner" data-ad-banner data-ad-pool="public" hidden><a href="#"><span>Advertisement</span><img alt=""></a></aside><script src="/assets/js/ad-banner.js" defer></script>`,{html:true});}}).transform(response);
  return response;
}
function requestsPublicBanner(pathname,response){return !pathname.startsWith('/owner')&&!pathname.startsWith('/creator')&&!pathname.startsWith('/office')&&String(response.headers.get('content-type')||'').includes('text/html');}
