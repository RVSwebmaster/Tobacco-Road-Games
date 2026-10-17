const SESSION_COOKIE_NAME = "trg_owner_session";
const CSRF_COOKIE_NAME = "trg_owner_csrf";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS
};

export async function createSessionToken(username, secret, nowMs = Date.now(), ttlSeconds = SESSION_TTL_SECONDS) {
  const payload = {
    exp: nowMs + (ttlSeconds * 1000),
    u: String(username || "")
  };
  return signStructuredPayload(payload, secret);
}

export async function verifySessionToken(token, secret, nowMs = Date.now()) {
  const parsed = await verifyStructuredPayload(token, secret);
  if (!parsed.valid) {
    return parsed;
  }

  if (!parsed.payload.u) {
    return { valid: false, reason: "missing_user" };
  }

  if (Number(parsed.payload.exp) <= nowMs) {
    return { valid: false, reason: "expired" };
  }

  return {
    valid: true,
    expiresAt: Number(parsed.payload.exp),
    username: String(parsed.payload.u)
  };
}

export async function createCsrfToken(username, secret, nowMs = Date.now(), ttlSeconds = SESSION_TTL_SECONDS) {
  const payload = {
    exp: nowMs + (ttlSeconds * 1000),
    n: toBase64Url(randomBytes(18)),
    u: String(username || "")
  };
  return signStructuredPayload(payload, secret);
}

export async function verifyCsrfToken(token, username, secret, nowMs = Date.now()) {
  const parsed = await verifyStructuredPayload(token, secret);
  if (!parsed.valid) {
    return parsed;
  }

  if (String(parsed.payload.u || "") !== String(username || "")) {
    return { valid: false, reason: "wrong_user" };
  }

  if (Number(parsed.payload.exp) <= nowMs) {
    return { valid: false, reason: "expired" };
  }

  if (!parsed.payload.n) {
    return { valid: false, reason: "missing_nonce" };
  }

  return {
    valid: true,
    expiresAt: Number(parsed.payload.exp),
    nonce: String(parsed.payload.n),
    username: String(parsed.payload.u)
  };
}

export function parseCookieHeader(headerValue) {
  const cookies = new Map();
  const raw = String(headerValue || "");
  for (const pair of raw.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function readCookie(request, name) {
  return parseCookieHeader(request.headers.get("cookie")).get(name) || "";
}

export function buildCookie(name, value, options = {}) {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path || "/"}`
  ];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure !== false) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearCookie(name, options = {}) {
  return buildCookie(name, "", {
    httpOnly: Boolean(options.httpOnly),
    maxAge: 0,
    path: options.path || "/",
    sameSite: options.sameSite || "Strict",
    secure: options.secure !== false
  });
}

export function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeFolderName(value) {
  return String(value || "").trim();
}

export function isSafeFolderName(value) {
  const folder = normalizeFolderName(value);
  return Boolean(folder)
    && !folder.includes("/")
    && !folder.includes("\\")
    && !folder.includes("..")
    && /^[A-Za-z0-9 _-]+$/.test(folder);
}

export function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

export function getOwnerSecrets(env) {
  return {
    csrfSecret: String(env.OWNER_CSRF_SECRET || env.OWNER_SESSION_SECRET || ""),
    sessionSecret: String(env.OWNER_SESSION_SECRET || "")
  };
}

export function getSafeOwnerNextPath(rawNextPath) {
  const nextPath = String(rawNextPath || "").trim();
  if (!nextPath.startsWith("/owner/")) {
    return "/owner/";
  }

  if (nextPath === "/owner/login" || nextPath === "/owner/logout") {
    return "/owner/";
  }

  return nextPath;
}

export function validateSameOriginRequest(request) {
  const requestUrl = new URL(request.url);
  const expectedOrigin = requestUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function signStructuredPayload(payload, secret) {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signValue(secret, body);
  return `${body}.${signature}`;
}

async function verifyStructuredPayload(token, secret) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = await signValue(secret, body);
  if (!constantTimeEqual(fromAscii(signature), fromAscii(expectedSignature))) {
    return { valid: false, reason: "bad_signature" };
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "bad_payload" };
  }
}

async function signValue(secret, value) {
  const secretBytes = new TextEncoder().encode(String(secret || ""));
  const valueBytes = new TextEncoder().encode(String(value || ""));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, valueBytes);
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function fromAscii(value) {
  return new TextEncoder().encode(String(value || ""));
}
