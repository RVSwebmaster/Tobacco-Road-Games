import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  CSRF_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  buildCookie,
  createCsrfToken,
  getOwnerSecrets,
  htmlResponse,
  jsonResponse
} from "./owner-auth.mjs";

const ACCESS_JWKS_CACHE = new Map();

export function getOwnerAccessConfig(env) {
  const teamDomain = normalizeAccessDomain(env.OWNER_ACCESS_TEAM_DOMAIN || "");
  const audience = String(env.OWNER_ACCESS_AUD || "").trim();
  const allowedEmail = normalizeEmail(env.OWNER_ACCESS_EMAIL || "");
  const hasAnyAccessSetting = Boolean(teamDomain || audience || allowedEmail);

  return {
    allowedEmail,
    audience,
    enabled: hasAnyAccessSetting,
    hasAnyAccessSetting,
    ready: Boolean(teamDomain && audience),
    teamDomain
  };
}

export function isOwnerAccessConfigured(env) {
  return getOwnerAccessConfig(env).enabled;
}

export async function verifyOwnerAccessRequest(request, env) {
  const config = getOwnerAccessConfig(env);
  if (!config.enabled) {
    return {
      valid: false,
      reason: "not_configured",
      userMessage: "Owner access is not configured for Cloudflare Access yet."
    };
  }

  if (!config.ready) {
    return {
      valid: false,
      reason: "config_incomplete",
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    };
  }

  const token = request.headers.get("cf-access-jwt-assertion") || "";
  if (!token) {
    return {
      valid: false,
      reason: "missing_token",
      userMessage: "Owner access requires Cloudflare Access authentication."
    };
  }

  try {
    const jwks = getOwnerAccessJwks(config.teamDomain);
    const { payload } = await jwtVerify(token, jwks, {
      audience: config.audience,
      issuer: config.teamDomain
    });

    const email = normalizeEmail(payload.email);
    if (config.allowedEmail && email !== config.allowedEmail) {
      return {
        valid: false,
        reason: "wrong_identity",
        userMessage: "This Cloudflare Access identity is not approved for the owner tools."
      };
    }

    const csrfSubject = resolveOwnerAccessSubject(payload);
    if (!csrfSubject) {
      return {
        valid: false,
        reason: "missing_subject",
        userMessage: "The Cloudflare Access identity token is missing a stable owner identifier."
      };
    }

    return {
      csrfSubject,
      email,
      payload,
      valid: true
    };
  } catch {
    return {
      valid: false,
      reason: "invalid_token",
      userMessage: "The Cloudflare Access session could not be verified."
    };
  }
}

export function buildOwnerAccessDeniedResponse(request, accessState, asJson = false) {
  const message = accessState?.userMessage || "Owner access requires Cloudflare Access authentication.";
  if (asJson) {
    return jsonResponse({
      error: message
    }, accessState?.reason === "config_incomplete" ? 503 : 403);
  }

  return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Owner Access Required</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #140f0c;
      color: #f4e2bf;
      font-family: "Trebuchet MS", "Segoe UI", Arial, sans-serif;
    }

    main {
      width: min(460px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid rgba(244, 226, 191, 0.18);
      border-radius: 18px;
      background: rgba(12, 8, 6, 0.92);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }

    h1 {
      margin-top: 0;
      font-size: 1.6rem;
    }

    p {
      line-height: 1.6;
    }

    a {
      color: #f4c66c;
    }
  </style>
</head>
<body>
  <main>
    <h1>Owner Access Required</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="${escapeHtml(new URL("/owner/", request.url).toString())}">Try the owner route again</a> after Cloudflare Access sign-in completes.</p>
  </main>
</body>
</html>`, accessState?.reason === "config_incomplete" ? 503 : 403);
}

export function buildOwnerAccessLogoutUrl(request) {
  return new URL("/cdn-cgi/access/logout", request.url).toString();
}

export async function attachOwnerAccessCsrfCookie(response, request, env, accessState) {
  if (!accessState?.valid) {
    return response;
  }

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return response;
  }

  const { csrfSecret } = getOwnerSecrets(env);
  if (!csrfSecret) {
    return response;
  }

  const csrfToken = await createCsrfToken(accessState.csrfSubject, csrfSecret);
  const headers = new Headers(response.headers);
  headers.append("set-cookie", buildCookie(CSRF_COOKIE_NAME, csrfToken, {
    maxAge: SESSION_TTL_SECONDS,
    path: "/owner",
    sameSite: "Strict"
  }));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

function getOwnerAccessJwks(teamDomain) {
  const key = `${teamDomain}/cdn-cgi/access/certs`;
  if (!ACCESS_JWKS_CACHE.has(key)) {
    ACCESS_JWKS_CACHE.set(key, createRemoteJWKSet(new URL(key)));
  }
  return ACCESS_JWKS_CACHE.get(key);
}

function resolveOwnerAccessSubject(payload) {
  return normalizeEmail(payload?.email) || String(payload?.sub || "").trim();
}

function normalizeAccessDomain(value) {
  const raw = String(value || "").trim().replace(/\/+$/g, "");
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return "";
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
