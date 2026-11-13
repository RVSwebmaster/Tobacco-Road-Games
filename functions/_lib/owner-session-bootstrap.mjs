import {
  establishAccessOwnerSession,
  getSessionFromRequest,
} from "./account-auth.mjs";
import { verifyOwnerAccessIdentity } from "./owner-access-identity.mjs";

// A page under the already-protected /owner/* Access application establishes
// the existing D1 session before its page scripts call session-protected APIs.
export async function attachOwnerSessionForDocument(
  response,
  request,
  env = {},
  options = {},
) {
  if (
    request.method !== "GET" ||
    !String(request.headers.get("accept") || "").includes("text/html") ||
    !String(response.headers.get("content-type") || "").includes("text/html")
  ) {
    return response;
  }
  try {
    const getSession = options.getSession || getSessionFromRequest;
    if ((await getSession(request, env)).valid) return response;
    const verifyAccess = options.verifyAccess || verifyOwnerAccessIdentity;
    const identity = await verifyAccess(request, env);
    if (!identity.valid) return response;
    const establishSession =
      options.establishSession || establishAccessOwnerSession;
    const owner = await establishSession(env, identity.email);
    const headers = new Headers(response.headers);
    for (const cookie of owner.cookieHeaders || [])
      headers.append("set-cookie", cookie);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch {
    // Keep the page available; its protected API calls remain fail-closed.
    return response;
  }
}
