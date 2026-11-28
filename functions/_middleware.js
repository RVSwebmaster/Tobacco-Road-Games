import { handleOfficeMiddleware } from "./_lib/office-middleware.mjs";
import { isMarketplaceWriteDisabled, marketplaceWriteDisabledResponse } from "./_lib/preview-write-policy.mjs";
import { readStoreState } from "./_lib/store-state.mjs";
import { isPublicStorePage, maintenanceResponse } from "./_lib/store-maintenance.mjs";
import { attachOwnerSessionForDocument } from "./_lib/owner-session-bootstrap.mjs";
import { getCustomerSessionFromRequest } from "./_lib/account-auth.mjs";
import { resolveMemberProfileAccess } from "./_lib/member-profile-access.mjs";

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
  if (isCustomerMembershipDashboard(pathname)) {
    const session = await getCustomerSessionFromRequest(context.request, context.env);
    if (!session.valid) return noStoreDocument(Response.redirect(new URL("/account.html", context.request.url), 302));
    const membership = await resolveMemberProfileAccess(context.env.TRG_ORDERS, session.user);
    if (membership.accountClass !== "customer") {
      const profileRoutes = {
        creator: "/creator/",
        premiumCreator: "/premium-creator-profile/",
        founding25: "/founding-25-profile/",
        admin: "/admin-profile/",
        owner: "/owner-profile/"
      };
      return noStoreDocument(Response.redirect(new URL(profileRoutes[membership.accountClass] || "/account.html", context.request.url), 302));
    }
  }
  if (isMemberDashboard(pathname)) {
    const session = await getCustomerSessionFromRequest(context.request, context.env);
    if (!session.valid) return noStoreDocument(Response.redirect(new URL("/account.html", context.request.url), 302));
    const membership = await resolveMemberProfileAccess(context.env.TRG_ORDERS, session.user);
    if (isLegacyCreatorDashboard(pathname)) {
      if (!dashboardTierAtLeast(membership.accountClass, "creator")) return dashboardForbidden();
      return noStoreDocument(Response.redirect(new URL("/dashboard/?page=creator", context.request.url), 302));
    }
    if (!dashboardTierAtLeast(membership.accountClass, "customer")) return dashboardForbidden();
    const page = new URL(context.request.url).searchParams.get("page") || "membership";
    const pageTiers = { membership: "customer", creator: "creator", premier: "premiumCreator", "founding-25": "founding25", owner: "owner" };
    if (!Object.hasOwn(pageTiers, page) || !dashboardTierAtLeast(membership.accountClass, pageTiers[page])) return dashboardForbidden();
  }
  if (isCreatorTools(pathname)) {
    const session = await getCustomerSessionFromRequest(context.request, context.env);
    if (!session.valid) return noStoreDocument(Response.redirect(new URL("/account.html", context.request.url), 302));
    const membership = await resolveMemberProfileAccess(context.env.TRG_ORDERS, session.user);
    if (membership.creatorDashboardAvailable !== true) return dashboardForbidden();
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
function requestsPublicBanner(pathname,response){return pathname!=='/store/'&&!isCustomerMembershipDashboard(pathname)&&!isMemberDashboard(pathname)&&!isCreatorTools(pathname)&&!pathname.startsWith('/owner')&&!pathname.startsWith('/creator')&&!pathname.startsWith('/office')&&String(response.headers.get('content-type')||'').includes('text/html');}

function shouldNeverReuseDocument(pathname) {
  return pathname === "/" || pathname === "/index.html" || isCustomerStorefront(pathname) || isMemberDashboard(pathname) || isCreatorTools(pathname) || isCustomerMembershipDashboard(pathname) ||
    pathname === "/guest/" || pathname === "/guest/index.html" || pathname.startsWith("/creator");
}

function isCustomerStorefront(pathname) {
  return pathname === "/customer" || pathname === "/customer/" || pathname === "/customer.html";
}

function isMemberDashboard(pathname) {
  return pathname === "/dashboard" || pathname === "/dashboard/" || pathname === "/dashboard/index.html" || isLegacyCreatorDashboard(pathname);
}

function isLegacyCreatorDashboard(pathname) {
  return pathname === "/creator-dashboard" || pathname === "/creator-dashboard/" || pathname === "/creator-dashboard/index.html";
}

function isCreatorTools(pathname) {
  return pathname === "/creator-tools" || pathname === "/creator-tools/" || pathname === "/creator-tools/index.html";
}

function dashboardTierAtLeast(accountClass, required) {
  const tiers = ["customer", "creator", "premiumCreator", "founding25", "owner"];
  return tiers.indexOf(accountClass) >= tiers.indexOf(required) && tiers.includes(accountClass);
}

function dashboardForbidden() {
  return new Response("Dashboard page not available for this membership tier.", {
    status: 403,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }
  });
}

function isCustomerMembershipDashboard(pathname) {
  return pathname === "/customer-profile" || pathname === "/customer-profile/" || pathname === "/customer-profile/index.html";
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
