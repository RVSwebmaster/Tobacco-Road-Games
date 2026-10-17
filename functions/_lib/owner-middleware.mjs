import {
  attachOwnerAccessCsrfCookie,
  buildOwnerAccessDeniedResponse,
  buildOwnerAccessLogoutUrl,
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";
import { getLocalOwnerAccessState } from "./owner-local-access.mjs";

const RETIRED_AUTH_MESSAGE = "Internal Owner login is retired. Owner tools remain unavailable until an approved external authentication replacement is configured.";

export async function handleOwnerMiddleware(context) {
  const request = context.request;
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const ownerIntakeAliases = new Set(["/owner/intake", "/owner/intake/"]);
  const apiPath = pathname.startsWith("/owner/api/");
  const finish = (response) => withOwnerBuildHeaders(response, context.env);

  if (!pathname.startsWith("/owner")) {
    return context.next();
  }

  let accessState = getLocalOwnerAccessState(request, context.env);
  if (!accessState.valid) {
    const accessConfig = getOwnerAccessConfig(context.env);
    if (!accessConfig.enabled) {
      return finish(buildOwnerAccessDeniedResponse(request, {
        reason: "config_incomplete",
        userMessage: RETIRED_AUTH_MESSAGE
      }, apiPath));
    }

    if (!accessConfig.ready) {
      return finish(buildOwnerAccessDeniedResponse(request, {
        reason: "config_incomplete",
        userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
      }, apiPath));
    }

    accessState = await verifyOwnerAccessRequest(request, context.env);
    if (!accessState.valid) {
      return finish(buildOwnerAccessDeniedResponse(request, accessState, apiPath));
    }
  }

  if (pathname === "/owner" || pathname === "/owner/" || pathname === "/owner/login") {
    if (pathname === "/owner/login") {
      return finish(Response.redirect(new URL("/owner/", request.url).toString(), 303));
    }
    return finish(await context.next());
  }

  if (ownerIntakeAliases.has(pathname)) {
    return finish(Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303));
  }

  if (pathname === "/owner/logout") {
    if (accessState.localBypass) {
      return finish(Response.redirect(new URL("/owner/", request.url).toString(), 303));
    }
    return finish(Response.redirect(buildOwnerAccessLogoutUrl(request), 303));
  }

  const response = await context.next();
  return finish(await attachOwnerAccessCsrfCookie(response, request, context.env, accessState));
}

function withOwnerBuildHeaders(response, env) {
  const headers = new Headers(response.headers);
  const commit = String(env.CF_PAGES_COMMIT_SHA || "").trim();
  const branch = String(env.CF_PAGES_BRANCH || "").trim();
  const deploymentUrl = String(env.CF_PAGES_URL || "").trim();
  const buildMarker = [branch || "unknown-branch", commit ? commit.slice(0, 12) : "unknown-commit"].join("@");

  headers.set("x-trg-owner-build", buildMarker);
  headers.set("x-trg-owner-branch", branch || "unknown");
  if (deploymentUrl) {
    headers.set("x-trg-owner-deployment-url", deploymentUrl);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}
