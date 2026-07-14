const TOKEN_VERSION = "oa1";
const SIGNING_CONTEXT = "trg-order-access-v1";
const MINIMUM_SECRET_LENGTH = 32;

export class OrderAccessError extends Error {
  constructor(code) {
    super("Order access authorization failed.");
    this.name = "OrderAccessError";
    this.code = code;
  }
}

export function isOrderAccessSecretConfigured(secret) {
  return String(secret || "").length >= MINIMUM_SECRET_LENGTH;
}

export async function ensureActiveOrderAccessCredential(database, order, secret, options = {}) {
  assertSecret(secret);
  const orderId = positiveInteger(order?.id);
  if (!orderId || order?.payment_status !== "paid") {
    throw new OrderAccessError("order_not_paid");
  }

  let credential = await getActiveOrderAccessCredential(database, orderId);
  if (!credential) {
    const generationRow = await database.prepare(`
      SELECT COALESCE(MAX(generation), 0) + 1 AS next_generation
      FROM order_access_credentials
      WHERE order_id = ?
    `).bind(orderId).first();
    const generation = positiveInteger(generationRow?.next_generation) || 1;
    const nonce = randomToken(24);
    const token = await buildOrderAccessToken({ generation, nonce, orderId }, secret);
    const tokenHash = await sha256Hex(token);
    const createdAt = nowIso(options.nowMs);
    try {
      await database.prepare(`
        INSERT INTO order_access_credentials (
          order_id, generation, token_nonce, token_hash, status, created_at
        ) VALUES (?, ?, ?, ?, 'active', ?)
      `).bind(orderId, generation, nonce, tokenHash, createdAt).run();
    } catch (error) {
      credential = await getActiveOrderAccessCredential(database, orderId);
      if (!credential) {
        throw error;
      }
    }
    credential ||= await getActiveOrderAccessCredential(database, orderId);
  }

  return {
    credential,
    token: await reconstructOrderAccessToken(credential, secret)
  };
}

export async function regenerateOrderAccessCredential(database, order, secret, options = {}) {
  assertSecret(secret);
  const orderId = positiveInteger(order?.id);
  if (!orderId || order?.payment_status !== "paid") {
    throw new OrderAccessError("order_not_paid");
  }
  const revokedAt = nowIso(options.nowMs);
  await database.prepare(`
    UPDATE order_access_credentials
    SET status = 'revoked', revoked_at = ?
    WHERE order_id = ? AND status = 'active'
  `).bind(revokedAt, orderId).run();
  return ensureActiveOrderAccessCredential(database, order, secret, options);
}

export async function revokeOrderAccessCredentials(database, orderId, options = {}) {
  const normalizedOrderId = positiveInteger(orderId);
  if (!normalizedOrderId) {
    return 0;
  }
  const result = await database.prepare(`
    UPDATE order_access_credentials
    SET status = 'revoked', revoked_at = ?
    WHERE order_id = ? AND status = 'active'
  `).bind(nowIso(options.nowMs), normalizedOrderId).run();
  return Number(result?.meta?.changes || 0);
}

export async function verifyOrderAccessToken(database, token, secret, options = {}) {
  assertSecret(secret);
  const parts = String(token || "").split(".");
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) {
    throw new OrderAccessError("credential_malformed");
  }
  const orderId = positiveInteger(parts[1]);
  const generation = positiveInteger(parts[2]);
  const nonce = String(parts[3] || "");
  const suppliedSignature = String(parts[4] || "");
  if (!orderId || !generation || !/^[A-Za-z0-9_-]{32}$/.test(nonce) || !suppliedSignature) {
    throw new OrderAccessError("credential_malformed");
  }

  const expectedToken = await buildOrderAccessToken({ generation, nonce, orderId }, secret);
  if (!constantTimeEqual(new TextEncoder().encode(token), new TextEncoder().encode(expectedToken))) {
    throw new OrderAccessError("credential_altered");
  }
  const tokenHash = await sha256Hex(token);
  const credential = await database.prepare(`
    SELECT * FROM order_access_credentials
    WHERE order_id = ? AND generation = ?
  `).bind(orderId, generation).first();
  if (!credential
    || credential.status !== "active"
    || credential.token_nonce !== nonce
    || !constantTimeEqual(
      new TextEncoder().encode(String(credential.token_hash || "")),
      new TextEncoder().encode(tokenHash)
    )) {
    throw new OrderAccessError("credential_revoked_or_unknown");
  }

  await database.prepare(`
    UPDATE order_access_credentials SET last_used_at = ?
    WHERE id = ? AND status = 'active'
  `).bind(nowIso(options.nowMs), Number(credential.id)).run();
  return credential;
}

export async function getActiveOrderAccessCredential(database, orderId) {
  const normalizedOrderId = positiveInteger(orderId);
  if (!normalizedOrderId) {
    return null;
  }
  return database.prepare(`
    SELECT * FROM order_access_credentials
    WHERE order_id = ? AND status = 'active'
    ORDER BY generation DESC LIMIT 1
  `).bind(normalizedOrderId).first();
}

export async function reconstructOrderAccessToken(credential, secret) {
  assertSecret(secret);
  if (!credential || credential.status !== "active") {
    throw new OrderAccessError("credential_revoked_or_unknown");
  }
  const token = await buildOrderAccessToken({
    generation: positiveInteger(credential.generation),
    nonce: String(credential.token_nonce || ""),
    orderId: positiveInteger(credential.order_id)
  }, secret);
  const tokenHash = await sha256Hex(token);
  if (tokenHash !== String(credential.token_hash || "")) {
    throw new OrderAccessError("credential_hash_mismatch");
  }
  return token;
}

async function buildOrderAccessToken({ orderId, generation, nonce }, secret) {
  if (!orderId || !generation || !nonce) {
    throw new OrderAccessError("credential_malformed");
  }
  const unsigned = `${TOKEN_VERSION}.${orderId}.${generation}.${nonce}`;
  const signature = await hmacBase64Url(`${SIGNING_CONTEXT}:${unsigned}`, secret);
  return `${unsigned}.${signature}`;
}

async function hmacBase64Url(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(value))
  )));
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function assertSecret(secret) {
  if (!isOrderAccessSecretConfigured(secret)) {
    throw new OrderAccessError("signing_secret_unavailable");
  }
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}
