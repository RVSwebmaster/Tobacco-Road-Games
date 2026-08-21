import { SESSION_COOKIE_NAME, parseCookieHeader, verifySessionToken } from "./owner-auth.mjs";

export async function isAuthenticatedOwnerRequest(request, env = {}) {
  const token = parseCookieHeader(request.headers.get("cookie")).get(SESSION_COOKIE_NAME) || "";
  const secret = String(env.OWNER_SESSION_SECRET || env.OWNER_CSRF_SECRET || "");
  if (!token || !secret) return false;
  const result = await verifySessionToken(token, secret);
  return result.valid;
}
