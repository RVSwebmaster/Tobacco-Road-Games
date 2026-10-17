import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  getSafeOwnerNextPath
} from "./owner-auth.mjs";
import {
  buildOwnerAccessDeniedResponse,
  buildOwnerAccessLogoutUrl,
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";
import { getLocalOwnerAccessState } from "./owner-local-access.mjs";

const RETIRED_AUTH_MESSAGE = "Internal Owner login is retired. Owner tools remain unavailable until an approved external authentication replacement is configured.";

export async function handleOwnerLoginRequest(request, env) {
  const localAccessState = getLocalOwnerAccessState(request, env);
  if (localAccessState.valid) {
    const url = new URL(request.url);
    const nextPath = getSafeOwnerNextPath(url.searchParams.get("next"));
    return Response.redirect(new URL(nextPath, request.url).toString(), 303);
  }

  const accessConfig = getOwnerAccessConfig(env);
  if (!accessConfig.enabled) {
    return buildOwnerAccessDeniedResponse(request, {
      reason: "config_incomplete",
      userMessage: RETIRED_AUTH_MESSAGE
    });
  }

  if (!accessConfig.ready) {
    return buildOwnerAccessDeniedResponse(request, {
      reason: "config_incomplete",
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    });
  }

  const accessState = await verifyOwnerAccessRequest(request, env);
  if (!accessState.valid) {
    return buildOwnerAccessDeniedResponse(request, accessState);
  }

  const url = new URL(request.url);
  const nextPath = getSafeOwnerNextPath(url.searchParams.get("next"));
  return Response.redirect(new URL(nextPath, request.url).toString(), 303);
}

export async function handleOwnerLogoutRequest(request, env) {
  if (getLocalOwnerAccessState(request, env).valid) {
    return clearOwnerCookies(Response.redirect(new URL("/owner/", request.url).toString(), 303));
  }

  const accessConfig = getOwnerAccessConfig(env);
  const response = accessConfig.ready
    ? Response.redirect(buildOwnerAccessLogoutUrl(request), 303)
    : buildOwnerAccessDeniedResponse(request, {
        reason: "config_incomplete",
        userMessage: RETIRED_AUTH_MESSAGE
      });

  return clearOwnerCookies(response);
}

function clearOwnerCookies(response) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "Strict"
  }));
  headers.append("set-cookie", clearCookie(CSRF_COOKIE_NAME, {
    path: "/owner",
    sameSite: "Strict"
  }));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}
