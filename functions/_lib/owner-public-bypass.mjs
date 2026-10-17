import { SESSION_COOKIE_NAME, parseCookieHeader, verifySessionToken } from "./owner-auth.mjs";
import { getOwnerAccessConfig } from "./owner-access.mjs";
import { isLocalOwnerAccessRequest } from "./owner-local-access.mjs";

export async function isAuthenticatedOwnerRequest(request, env = {}) {
  if (isLocalOwnerAccessRequest(request, env)) return true;
  if (!getOwnerAccessConfig(env).ready) return false;
  const token = parseCookieHeader(request.headers.get("cookie")).get(SESSION_COOKIE_NAME) || "";
  const secret = String(env.OWNER_SESSION_SECRET || env.OWNER_CSRF_SECRET || "");
  if (!token || !secret) return false;
  const result = await verifySessionToken(token, secret);
  return result.valid;
}
