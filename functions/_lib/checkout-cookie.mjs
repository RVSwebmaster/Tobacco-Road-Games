const COOKIE_NAME = "trg_checkout_access";
const DEFAULT_MAX_AGE_SECONDS = 2 * 60 * 60;

export async function createCheckoutAccessCookie(payload, secret, options = {}) {
  const maxAgeSeconds = Number.isInteger(options.maxAgeSeconds) ? options.maxAgeSeconds : DEFAULT_MAX_AGE_SECONDS;
  const normalizedPayload = {
    createdAt: String(payload?.createdAt || new Date().toISOString()),
    publicOrderReference: requiredString(payload?.publicOrderReference, "publicOrderReference"),
    stripeCheckoutSessionId: requiredString(payload?.stripeCheckoutSessionId, "stripeCheckoutSessionId")
  };
  const encodedPayload = base64urlEncode(JSON.stringify(normalizedPayload));
  const signature = await signValue(encodedPayload, secret);
  const cookieValue = `${encodedPayload}.${signature}`;
  return serializeCookie(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAgeSeconds,
    path: "/store/checkout/",
    sameSite: "Lax",
    secure: true
  });
}

export async function readCheckoutAccessCookie(request, secret) {
  const rawCookie = readCookieValue(request, COOKIE_NAME);
  if (!rawCookie) {
    return null;
  }

  const separator = rawCookie.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const encodedPayload = rawCookie.slice(0, separator);
  const providedSignature = rawCookie.slice(separator + 1);
  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    return JSON.parse(base64urlDecode(encodedPayload));
  } catch {
    return null;
  }
}

export function clearCheckoutAccessCookie() {
  return serializeCookie(COOKIE_NAME, "", {
    httpOnly: true,
    maxAgeSeconds: 0,
    path: "/store/checkout/",
    sameSite: "Lax",
    secure: true
  });
}

async function signValue(value, secret) {
  const normalizedSecret = requiredString(secret, "CHECKOUT_ACCESS_COOKIE_SECRET");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedSecret),
    {
      hash: "SHA-256",
      name: "HMAC"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value || "")));
  return bytesToHex(new Uint8Array(signature));
}

function readCookieValue(request, name) {
  const cookieHeader = request?.headers?.get?.("cookie") || "";
  const entries = String(cookieHeader).split(";").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (entry.slice(0, separator) === name) {
      return entry.slice(separator + 1);
    }
  }
  return "";
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path || "/"}`);
  if (Number.isInteger(options.maxAgeSeconds)) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function base64urlEncode(value) {
  return btoa(String(value || ""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
}

function requiredString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function timingSafeEqual(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (leftValue.length !== rightValue.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    result |= leftValue.charCodeAt(index) ^ rightValue.charCodeAt(index);
  }
  return result === 0;
}
