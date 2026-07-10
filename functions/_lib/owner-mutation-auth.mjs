import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  parseCookieHeader,
  readCookie,
  validateSameOriginRequest,
  verifyCsrfToken,
  verifySessionToken
} from "./owner-auth.mjs";
import {
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";

export async function verifyAuthenticatedOwnerMutationRequest(request, env, options = {}) {
  if (!validateSameOriginRequest(request)) {
    return {
      valid: false,
      status: 403,
      userMessage: options.sameOriginMessage || "Owner requests must come from the Tobacco Road Games owner site."
    };
  }

  const accessConfig = getOwnerAccessConfig(env);
  if (accessConfig.enabled) {
    return verifyAccessProtectedOwnerMutationRequest(request, env, accessConfig, options);
  }

  const secrets = getOwnerSecrets(env);
  const sessionToken = readCookie(request, SESSION_COOKIE_NAME);
  if (!secrets.sessionSecret || !sessionToken) {
    return {
      valid: false,
      status: 401,
      userMessage: options.missingSessionMessage || "Your owner session is missing. Please sign in again."
    };
  }

  const sessionState = await verifySessionToken(sessionToken, secrets.sessionSecret);
  if (!sessionState.valid) {
    return {
      valid: false,
      status: 401,
      userMessage: options.invalidSessionMessage || "Your owner session is no longer valid. Please sign in again."
    };
  }

  const csrfState = await verifyOwnerCsrf(request, sessionState.username, secrets.csrfSecret, options);
  if (!csrfState.valid) {
    return csrfState;
  }

  return {
    valid: true,
    username: sessionState.username
  };
}

async function verifyAccessProtectedOwnerMutationRequest(request, env, accessConfig, options) {
  if (!accessConfig.ready) {
    return {
      valid: false,
      status: 503,
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    };
  }

  const accessState = await verifyOwnerAccessRequest(request, env);
  if (!accessState.valid) {
    return {
      valid: false,
      status: accessState.reason === "config_incomplete" ? 503 : 403,
      userMessage: accessState.userMessage
    };
  }

  const secrets = getOwnerSecrets(env);
  if (!secrets.csrfSecret) {
    return {
      valid: false,
      status: 503,
      userMessage: options.missingCsrfSecretMessage || "Owner publish is missing OWNER_CSRF_SECRET in Cloudflare."
    };
  }

  const csrfState = await verifyOwnerCsrf(request, accessState.csrfSubject, secrets.csrfSecret, options);
  if (!csrfState.valid) {
    return csrfState;
  }

  return {
    valid: true,
    username: accessState.email || accessState.csrfSubject
  };
}

async function verifyOwnerCsrf(request, subject, csrfSecret, options) {
  const csrfToken = request.headers.get("x-csrf-token") || "";
  const csrfCookie = parseCookieHeader(request.headers.get("cookie")).get(CSRF_COOKIE_NAME) || "";
  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie || !csrfSecret) {
    return {
      valid: false,
      status: 403,
      userMessage: options.csrfMismatchMessage || "The owner form security token did not match. Reload the page and try again."
    };
  }

  const csrfState = await verifyCsrfToken(csrfToken, subject, csrfSecret);
  if (!csrfState.valid) {
    return {
      valid: false,
      status: 403,
      userMessage: options.csrfExpiredMessage || "The owner form security token has expired. Reload the page and try again."
    };
  }

  return { valid: true };
}
