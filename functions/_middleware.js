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
  if (pathname === "/owner/intake" || pathname === "/owner/intake/") {
    return withOwnerBuildHeaders(Response.redirect(new URL("/owner/product-intake.html", context.request.url).toString(), 303), context.env);
  }
  const response = pathname.startsWith("/owner")
    ? withOwnerBuildHeaders(await context.next(), context.env)
    : await context.next();
  if(requestsPublicBanner(pathname,response))return new HTMLRewriter().on('header.site-header',{element(element){element.after(`<aside class="marketplace-ad-banner" data-ad-banner data-ad-pool="public" hidden><a href="#"><span>Advertisement</span><img alt=""></a></aside><script src="/assets/js/ad-banner.js" defer></script>`,{html:true});}}).transform(response);
  return response;
}
function requestsPublicBanner(pathname,response){return pathname!=='/store/'&&!pathname.startsWith('/owner')&&!pathname.startsWith('/creator')&&!pathname.startsWith('/office')&&String(response.headers.get('content-type')||'').includes('text/html');}

function withOwnerBuildHeaders(response, env) {
  const headers = new Headers(response.headers);
  const commit = String(env.CF_PAGES_COMMIT_SHA || "").trim();
  const branch = String(env.CF_PAGES_BRANCH || "").trim();
  const deploymentUrl = String(env.CF_PAGES_URL || "").trim();
  headers.set("x-trg-owner-build", [branch || "unknown-branch", commit ? commit.slice(0, 12) : "unknown-commit"].join("@"));
  headers.set("x-trg-owner-branch", branch || "unknown");
  if (deploymentUrl) headers.set("x-trg-owner-deployment-url", deploymentUrl);
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}
