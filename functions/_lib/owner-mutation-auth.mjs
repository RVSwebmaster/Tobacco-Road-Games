import {
  CSRF_COOKIE_NAME,
  getOwnerSecrets,
  parseCookieHeader,
  validateSameOriginRequest,
  verifyCsrfToken
} from "./owner-auth.mjs";
import {
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";
import { getLocalOwnerAccessState } from "./owner-local-access.mjs";

const RETIRED_AUTH_MESSAGE = "Internal Owner login is retired. Owner tools remain unavailable until an approved external authentication replacement is configured.";

export async function verifyAuthenticatedOwnerReadRequest(request, env, options = {}) {
  const localAccessState = getLocalOwnerAccessState(request, env);
  if (localAccessState.valid) {
    return {
      valid: true,
      csrfSubject: localAccessState.csrfSubject,
      username: localAccessState.username
    };
  }

  const accessConfig = getOwnerAccessConfig(env);
  if (!accessConfig.enabled) {
    return {
      valid: false,
      status: 503,
      userMessage: RETIRED_AUTH_MESSAGE
    };
  }

  if (!accessConfig.ready) {
    return {
      valid: false,
      status: 503,
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    };
  }

  const accessVerifier = options.verifyOwnerAccessRequest || verifyOwnerAccessRequest;
  const accessState = await accessVerifier(request, env);
  if (!accessState.valid) {
    return {
      valid: false,
      status: accessState.reason === "config_incomplete" ? 503 : 403,
      userMessage: accessState.userMessage || "Owner access was not authorized."
    };
  }

  return {
    valid: true,
    csrfSubject: accessState.csrfSubject,
    username: accessState.email || accessState.csrfSubject
  };
}

export async function verifyAuthenticatedOwnerMutationRequest(request, env, options = {}) {
  if (!validateSameOriginRequest(request)) {
    return {
      valid: false,
      status: 403,
      userMessage: options.sameOriginMessage || "Owner requests must come from the Tobacco Road Games owner site."
    };
  }

  const ownerState = await verifyAuthenticatedOwnerReadRequest(request, env, options);
  if (!ownerState.valid) {
    return ownerState;
  }

  const secrets = getOwnerSecrets(env);
  if (!secrets.csrfSecret) {
    return {
      valid: false,
      status: 503,
      userMessage: options.missingCsrfSecretMessage || "Owner access is missing OWNER_CSRF_SECRET in Cloudflare."
    };
  }

  const csrfState = await verifyOwnerCsrf(request, ownerState.csrfSubject, secrets.csrfSecret, options);
  if (!csrfState.valid) {
    return csrfState;
  }

  return {
    valid: true,
    username: ownerState.username
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

  const csrfState = await verifyCsrfToken(csrfToken, subject, csrfSecret, options.nowMs);
  if (!csrfState.valid) {
    return {
      valid: false,
      status: 403,
      userMessage: options.csrfExpiredMessage || "The owner form security token has expired. Reload the page and try again."
    };
  }

  return { valid: true };
}
