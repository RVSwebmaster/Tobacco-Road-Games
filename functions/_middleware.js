import { handleOfficeMiddleware } from "./_lib/office-middleware.mjs";
import { isMarketplaceWriteDisabled, marketplaceWriteDisabledResponse } from "./_lib/preview-write-policy.mjs";
import { readStoreState } from "./_lib/store-state.mjs";
import { isPublicStorePage, maintenanceResponse } from "./_lib/store-maintenance.mjs";
import { attachOwnerSessionForDocument } from "./_lib/owner-session-bootstrap.mjs";
import { getCustomerSessionFromRequest } from "./_lib/account-auth.mjs";

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (isMarketplaceWriteDisabled(context.env, context.request)) {
    return marketplaceWriteDisabledResponse();
  }
  if (new URL(context.request.url).pathname.startsWith("/office")) {
    return handleOfficeMiddleware(context);
  }
  if (isCustomerStorefront(pathname) && !(await getCustomerSessionFromRequest(context.request, context.env)).valid) {
    return noStoreDocument(Response.redirect(new URL("/guest/", context.request.url), 302));
  }
  if (isMemberDashboard(pathname) && !(await getCustomerSessionFromRequest(context.request, context.env)).valid) {
    return noStoreDocument(Response.redirect(new URL("/account.html", context.request.url), 302));
  }
  if (isPublicStorePage(pathname)) {
    const storeState = await readStoreState(context.env);
    if (storeState.available && storeState.state === "MAINTENANCE") {
      return maintenanceResponse();
    }
  }
  if (pathname === "/owner/intake" || pathname === "/owner/intake/") {
    return ownerResponse(withOwnerBuildHeaders(Response.redirect(new URL("/owner/product-intake.html", context.request.url).toString(), 303), context.env), context);
  }
  const usesOwnerSessionBootstrap = pathname.startsWith("/owner") || pathname.startsWith("/creator");
  const response = usesOwnerSessionBootstrap
    ? withOwnerBuildHeaders(await context.next(), context.env)
    : await context.next();
  let documentResponse = usesOwnerSessionBootstrap ? ownerResponse(response, context) : response;
  if (requestsPublicBanner(pathname, response)) {
    documentResponse = new HTMLRewriter().on('header.site-header', { element(element) {
      element.after(`<aside class="marketplace-ad-banner" data-ad-banner data-ad-pool="public" hidden><a href="#"><span>Advertisement</span><img alt=""></a></aside><script src="/assets/js/ad-banner.js" defer></script>`, { html: true });
    }}).transform(documentResponse);
  }
  // The Pages Functions response for /creator is a live stream; wrapping that
  // response to rewrite cache headers drops its body. Asset URL versioning is
  // the cache boundary for Creator, while static public documents can use the
  // no-store wrapper safely.
  return shouldNeverReuseDocument(pathname) && !usesOwnerSessionBootstrap
    ? noStoreDocument(documentResponse)
    : documentResponse;
}
function ownerResponse(response, context) {
  return attachOwnerSessionForDocument(response, context.request, context.env);
}
function requestsPublicBanner(pathname,response){return pathname!=='/store/'&&!pathname.startsWith('/owner')&&!pathname.startsWith('/creator')&&!pathname.startsWith('/office')&&String(response.headers.get('content-type')||'').includes('text/html');}

function shouldNeverReuseDocument(pathname) {
  return pathname === "/" || pathname === "/index.html" || isCustomerStorefront(pathname) || isMemberDashboard(pathname) ||
    pathname === "/guest/" || pathname === "/guest/index.html" || pathname.startsWith("/creator");
}

function isCustomerStorefront(pathname) {
  return pathname === "/customer" || pathname === "/customer/" || pathname === "/customer.html";
}

function isMemberDashboard(pathname) {
  return pathname === "/dashboard" || pathname === "/dashboard/" || pathname === "/dashboard/index.html";
}

function noStoreDocument(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

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
