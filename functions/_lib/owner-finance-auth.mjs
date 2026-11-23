import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";

const FINANCE_ROLES = new Set(["owner", "admin"]);

export async function authorizeOwnerFinanceRequest(request, env = {}, options = {}) {
  let session;
  try {
    session = await (options.getSession || getSessionFromRequest)(request, env, options);
  } catch {
    return failure("session_unavailable", "The finance session could not be verified.", 503);
  }
  if (!session?.valid) {
    return failure("authentication_required", "Sign in with an authorized administrative account.", 401);
  }
  if (session.user?.status !== "active" || !FINANCE_ROLES.has(session.user?.role)) {
    return failure("admin_required", "Only an active Admin or Owner may access finance operations.", 403);
  }
  if (String(request.method || "GET").toUpperCase() === "POST") {
    const validOrigin = (options.validateOrigin || validateSameOriginRequest)(request);
    const csrf = await (options.validateCsrf || validateSessionCsrf)(request, session);
    if (!validOrigin || !csrf?.valid) {
      return failure("csrf_rejected", "The finance request could not be verified.", 403);
    }
  }
  return { session };
}

function failure(code, message, status) {
  return {
    response: new Response(JSON.stringify({ code, error: message }), {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    }),
  };
}
