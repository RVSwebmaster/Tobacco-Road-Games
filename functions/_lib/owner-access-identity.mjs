import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_CACHE = new Map();

export async function verifyOwnerAccessIdentity(request, env = {}, options = {}) {
  const teamDomain = normalizeOrigin(env.OWNER_ACCESS_TEAM_DOMAIN);
  const audience = String(env.OWNER_ACCESS_AUD || "").trim();
  const allowedEmail = normalizeEmail(env.OWNER_ACCESS_EMAIL);
  if (!teamDomain || !audience || !allowedEmail) return { valid: false, reason: "not_configured" };

  const token = request.headers.get("cf-access-jwt-assertion") || readCookie(request, "CF_Authorization");
  if (!token) return { valid: false, reason: "missing" };
  try {
    const verifier = options.jwtVerify || jwtVerify;
    const jwks = options.jwks || getJwks(teamDomain);
    const { payload } = await verifier(token, jwks, { audience, issuer: teamDomain });
    const email = normalizeEmail(payload.email);
    if (!email || email !== allowedEmail || !String(payload.sub || "").trim()) {
      return { valid: false, reason: "identity_rejected" };
    }
    return { valid: true, email };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}

function getJwks(teamDomain) {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  if (!JWKS_CACHE.has(url)) JWKS_CACHE.set(url, createRemoteJWKSet(new URL(url)));
  return JWKS_CACHE.get(url);
}

function readCookie(request, name) {
  for (const part of String(request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
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
