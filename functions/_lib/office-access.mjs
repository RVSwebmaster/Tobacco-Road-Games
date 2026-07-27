import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_CACHE = new Map();

export function getOfficeAccessConfig(env = {}) {
  const teamDomain = normalizeOrigin(env.OFFICE_ACCESS_TEAM_DOMAIN);
  const audience = String(env.OFFICE_ACCESS_AUD || "").trim();
  const allowedEmail = normalizeEmail(env.OFFICE_ACCESS_EMAIL);
  return {
    allowedEmail,
    audience,
    ready: Boolean(teamDomain && audience && allowedEmail),
    teamDomain
  };
}

export async function verifyOfficeAccessRequest(request, env, options = {}) {
  const config = getOfficeAccessConfig(env);
  if (!config.ready) {
    return denied(503, "office_access_not_configured", "Office Access is not completely configured.");
  }
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  if (!token) {
    return denied(403, "office_access_missing", "Cloudflare Access authentication is required.");
  }
  try {
    const verifier = options.jwtVerify || jwtVerify;
    const jwks = options.jwks || getJwks(config.teamDomain);
    const { payload } = await verifier(token, jwks, {
      audience: config.audience,
      issuer: config.teamDomain
    });
    const email = normalizeEmail(payload.email);
    const subject = String(payload.sub || "").trim();
    if (!email || email !== config.allowedEmail || !subject) {
      return denied(403, "office_access_identity_rejected", "This identity is not authorized for TRG Office.");
    }
    return { email, subject, valid: true };
  } catch {
    return denied(403, "office_access_invalid", "The Cloudflare Access assertion is invalid or expired.");
  }
}

function getJwks(teamDomain) {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  if (!JWKS_CACHE.has(url)) JWKS_CACHE.set(url, createRemoteJWKSet(new URL(url)));
  return JWKS_CACHE.get(url);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function denied(status, code, message) {
  return { code, message, status, valid: false };
}

