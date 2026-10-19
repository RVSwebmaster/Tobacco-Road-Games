const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");

async function createOwnerAuthFixture({
  ownerAuth,
  ownerId,
  nowMs,
  sessionSecret = "mock-owner-session-secret-32-bytes",
  csrfSecret = "mock-owner-csrf-secret-32-bytes",
  origin = "https://example.com"
}) {
  const mutationAuth = await import(
    `${pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-mutation-auth.mjs")).href}?owner-test=${Math.random()}`
  );
  const accessMode =
    typeof mutationAuth.verifyAuthenticatedOwnerReadRequest === "function";
  const accessToken = `mock-owner-access-${ownerId}`;
  const environment = {
    OWNER_CSRF_SECRET: csrfSecret,
    OWNER_SESSION_SECRET: sessionSecret
  };
  const options = {};

  if (accessMode) {
    Object.assign(environment, {
      OWNER_ACCESS_AUD: "mock-owner-audience",
      OWNER_ACCESS_EMAIL: ownerId,
      OWNER_ACCESS_TEAM_DOMAIN: "https://access.example.invalid"
    });
    options.verifyOwnerAccessRequest = async (request) => {
      if (request.headers.get("cf-access-jwt-assertion") !== accessToken) {
        return {
          valid: false,
          reason: "missing_token",
          userMessage: "Owner access was not authorized."
        };
      }
      return { valid: true, csrfSubject: ownerId, email: ownerId };
    };
  }

  const session = await ownerAuth.createSessionToken(
    ownerId,
    sessionSecret,
    nowMs
  );
  const csrf = await ownerAuth.createCsrfToken(ownerId, csrfSecret, nowMs);
  const authenticatedHeaders = {
    ...(accessMode ? { "cf-access-jwt-assertion": accessToken } : {}),
    cookie: `${ownerAuth.SESSION_COOKIE_NAME}=${session}; ${ownerAuth.CSRF_COOKIE_NAME}=${csrf}`
  };

  return {
    environment,
    mode: accessMode ? "access" : "signed_session",
    options,
    unauthorizedStatus: accessMode ? 403 : 401,
    readRequest(route) {
      return new Request(new URL(route, origin), {
        headers: authenticatedHeaders
      });
    },
    jsonRequest(route, body) {
      return new Request(new URL(route, origin), {
        method: "POST",
        headers: {
          ...authenticatedHeaders,
          origin,
          "x-csrf-token": csrf,
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    }
  };
}

module.exports = { createOwnerAuthFixture };
