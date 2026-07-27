import { verifyOfficeAccessRequest } from "./office-access.mjs";

const CSRF_COOKIE = "trg_office_csrf";
const encoder = new TextEncoder();

export { CSRF_COOKIE };

export async function authorizeOfficeRequest(request, env, options = {}) {
  const access = await verifyOfficeAccessRequest(request, env, options);
  if (!access.valid) return access;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return access;
  if (!sameOrigin(request)) {
    return denied("office_origin_rejected", "Office mutations must originate from this Office site.");
  }
  const headerToken = request.headers.get("x-csrf-token") || "";
  const cookieToken = readCookie(request.headers.get("cookie"), CSRF_COOKIE);
  if (!headerToken || headerToken !== cookieToken) {
    return denied("office_csrf_rejected", "The Office security token is missing or does not match.");
  }
  const verified = await verifyCsrf(headerToken, access.subject, env.OFFICE_CSRF_SECRET);
  return verified ? access : denied("office_csrf_invalid", "The Office security token is invalid or expired.");
}

export async function attachOfficeCsrf(response, access, env, nowMs = Date.now()) {
  if (!access?.valid || !env.OFFICE_CSRF_SECRET) return response;
  const token = await createCsrf(access.subject, env.OFFICE_CSRF_SECRET, nowMs);
  const headers = new Headers(response.headers);
  headers.append("set-cookie", `${CSRF_COOKIE}=${token}; Path=/office; Max-Age=28800; Secure; SameSite=Strict`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function createCsrf(subject, secret, nowMs = Date.now()) {
  if (!String(secret || "")) throw new Error("OFFICE_CSRF_SECRET is required.");
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    exp: nowMs + 8 * 60 * 60 * 1000,
    nonce: crypto.randomUUID(),
    sub: subject
  })));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function verifyCsrf(token, subject, secret, nowMs = Date.now()) {
  if (!String(secret || "")) return false;
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra || signature !== await hmac(payload, secret)) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return decoded.sub === subject && Number(decoded.exp) > nowMs && Boolean(decoded.nonce);
  } catch {
    return false;
  }
}

function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  try {
    return Boolean(referer) && new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function denied(code, message) {
  return { code, message, status: 403, valid: false };
}

