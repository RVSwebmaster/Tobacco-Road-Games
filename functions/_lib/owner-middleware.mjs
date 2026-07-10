import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  buildOwnerLoginLocation,
  clearCookie,
  verifySessionToken
} from "./owner-auth.mjs";
import {
  attachOwnerAccessCsrfCookie,
  buildOwnerAccessDeniedResponse,
  buildOwnerAccessLogoutUrl,
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";

export async function handleOwnerMiddleware(context) {
  const request = context.request;
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const ownerIntakeAliases = new Set(["/owner/intake", "/owner/intake/"]);
  const finish = (response) => withOwnerBuildHeaders(response, context.env);

  if (!pathname.startsWith("/owner")) {
    return context.next();
  }

  const accessConfig = getOwnerAccessConfig(context.env);
  if (accessConfig.enabled) {
    return handleOwnerAccessMiddleware(context, accessConfig);
  }

  if (pathname === "/owner" || pathname === "/owner/") {
    const hasSession = await hasValidOwnerSession(request, context.env);
    if (hasSession) {
      return finish(Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303));
    }
    return finish(redirectToOwnerLogin(request));
  }

  if (ownerIntakeAliases.has(pathname)) {
    const session = await readOwnerSession(request, context.env);
    if (session.valid) {
      return finish(Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303));
    }
    return finish(redirectToOwnerLogin(request, session.reason === "expired" || session.reason === "bad_signature"));
  }

  if (pathname === "/owner/login" || pathname === "/owner/logout" || pathname.startsWith("/owner/api/")) {
    return finish(await context.next());
  }

  const session = await readOwnerSession(request, context.env);
  if (session.valid) {
    return finish(await context.next());
  }

  return finish(redirectToOwnerLogin(request, session.reason === "expired" || session.reason === "bad_signature"));
}

async function handleOwnerAccessMiddleware(context, accessConfig) {
  const request = context.request;
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const apiPath = pathname.startsWith("/owner/api/");
  const ownerIntakeAliases = new Set(["/owner/intake", "/owner/intake/"]);
  const finish = (response) => withOwnerBuildHeaders(response, context.env);

  if (!accessConfig.ready) {
    return finish(buildOwnerAccessDeniedResponse(request, {
      reason: "config_incomplete",
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    }, apiPath));
  }

  const accessState = await verifyOwnerAccessRequest(request, context.env);
  if (!accessState.valid) {
    return finish(buildOwnerAccessDeniedResponse(request, accessState, apiPath));
  }

  if (pathname === "/owner" || pathname === "/owner/" || pathname === "/owner/login") {
    return finish(Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303));
  }

  if (ownerIntakeAliases.has(pathname)) {
    return finish(Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303));
  }

  if (pathname === "/owner/logout") {
    return finish(Response.redirect(buildOwnerAccessLogoutUrl(request), 303));
  }

  const response = await context.next();
  return finish(await attachOwnerAccessCsrfCookie(response, request, context.env, accessState));
}

export async function readOwnerSession(request, env) {
  const secret = String(env.OWNER_SESSION_SECRET || "");
  const token = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!secret || !token) {
    return { valid: false, reason: "missing" };
  }
  return verifySessionToken(token, secret);
}

async function hasValidOwnerSession(request, env) {
  const session = await readOwnerSession(request, env);
  return session.valid;
}

function redirectToOwnerLogin(request, clearInvalidCookies = false) {
  const requestUrl = new URL(request.url);
  const nextPath = requestUrl.pathname + requestUrl.search;
  const headers = new Headers({
    location: buildOwnerLoginLocation(requestUrl.toString(), nextPath)
  });

  if (clearInvalidCookies) {
    headers.append("set-cookie", clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/owner",
      sameSite: "Strict"
    }));
    headers.append("set-cookie", clearCookie(CSRF_COOKIE_NAME, {
      path: "/owner",
      sameSite: "Strict"
    }));
  }

  return new Response(null, {
    status: 303,
    headers
  });
}

function getCookie(cookieHeader, name) {
  const raw = String(cookieHeader || "");
  for (const part of raw.split(";")) {
    const [cookieName, ...cookieValue] = part.trim().split("=");
    if (cookieName === name) {
      return cookieValue.join("=");
    }
  }
  return "";
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
