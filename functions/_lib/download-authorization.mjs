export const DOWNLOAD_CREDENTIAL_TTL_SECONDS = 15 * 60;
const MINIMUM_SECRET_LENGTH = 32;

export class DownloadAuthorizationError extends Error {
  constructor(code) {
    super("Download authorization failed.");
    this.name = "DownloadAuthorizationError";
    this.code = code;
  }
}

export function isDownloadSigningSecretConfigured(secret) {
  return String(secret || "").length >= MINIMUM_SECRET_LENGTH;
}

export async function createDownloadCredential(entitlement, secret, options = {}) {
  assertSecret(secret);
  const nowSeconds = Math.floor((Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()) / 1000);
  const ttlSeconds = Number.isInteger(options.ttlSeconds)
    ? Math.max(1, options.ttlSeconds)
    : DOWNLOAD_CREDENTIAL_TTL_SECONDS;
  const payload = {
    entitlementId: positiveInteger(entitlement?.id),
    expiresAt: nowSeconds + ttlSeconds,
    issuedAt: nowSeconds,
    orderId: positiveInteger(entitlement?.order_id),
    orderItemId: positiveInteger(entitlement?.order_item_id),
    productSlug: String(entitlement?.product_slug || ""),
    version: 1
  };
  if (!payload.entitlementId || !payload.orderId || !payload.orderItemId || !payload.productSlug) {
    throw new DownloadAuthorizationError("invalid_entitlement");
  }
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${base64urlEncode(signature)}`;
}

export async function verifyDownloadCredential(credential, secret, options = {}) {
  assertSecret(secret);
  const parts = String(credential || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DownloadAuthorizationError("credential_malformed");
  }
  let providedSignature;
  try {
    providedSignature = base64urlDecode(parts[1]);
  } catch {
    throw new DownloadAuthorizationError("credential_malformed");
  }
  const key = await importSigningKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    providedSignature,
    new TextEncoder().encode(parts[0])
  );
  if (!valid) {
    throw new DownloadAuthorizationError("credential_altered");
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
  } catch {
    throw new DownloadAuthorizationError("credential_malformed");
  }
  if (payload?.version !== 1
    || !positiveInteger(payload.entitlementId)
    || !positiveInteger(payload.orderId)
    || !positiveInteger(payload.orderItemId)
    || typeof payload.productSlug !== "string"
    || !Number.isInteger(payload.issuedAt)
    || !Number.isInteger(payload.expiresAt)) {
    throw new DownloadAuthorizationError("credential_malformed");
  }
  const nowSeconds = Math.floor((Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()) / 1000);
  if (payload.issuedAt > nowSeconds + 60) {
    throw new DownloadAuthorizationError("credential_not_yet_valid");
  }
  if (payload.expiresAt <= nowSeconds) {
    throw new DownloadAuthorizationError("credential_expired");
  }
  return payload;
}

function assertSecret(secret) {
  if (!isDownloadSigningSecretConfigured(secret)) {
    throw new DownloadAuthorizationError("signing_secret_unavailable");
  }
}

async function sign(value, secret) {
  const key = await importSigningKey(secret, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(value || ""))
  ));
}

function importSigningKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages
  );
}

function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
