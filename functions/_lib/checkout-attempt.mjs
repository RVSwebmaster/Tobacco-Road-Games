const CHECKOUT_ATTEMPT_PATTERN = /^trgca_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCheckoutAttemptId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!CHECKOUT_ATTEMPT_PATTERN.test(normalized)) {
    throw new Error("A valid checkout attempt identifier is required.");
  }
  return normalized;
}

export function buildStripeIdempotencyKey(checkoutAttemptId) {
  return `trg-checkout-${normalizeCheckoutAttemptId(checkoutAttemptId)}`;
}

export async function createCheckoutRequestHash(input, secret) {
  const normalizedSecret = String(secret || "");
  if (!normalizedSecret) {
    throw new Error("ORDER_EMAIL_HASH_SECRET is not configured.");
  }

  const canonicalRequest = JSON.stringify({
    currency: String(input?.currency || "").trim().toUpperCase(),
    customerEmailNormalized: String(input?.customerEmailNormalized || "").trim().toLowerCase(),
    items: normalizeHashItems(input?.items),
    subtotalCents: requiredInteger(input?.subtotalCents, "subtotalCents"),
    totalCents: requiredInteger(input?.totalCents, "totalCents")
  });

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`trg-checkout-request-v1:${canonicalRequest}`)
  );
  return bytesToHex(new Uint8Array(signature));
}

function normalizeHashItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    currency: String(item?.currency || "").trim().toUpperCase(),
    effectiveUnitPriceCents: requiredInteger(item?.effectiveUnitPriceCents, "effectiveUnitPriceCents"),
    lineTotalCents: requiredInteger(item?.lineTotalCents, "lineTotalCents"),
    listPriceCents: requiredInteger(item?.listPriceCents, "listPriceCents"),
    productSlug: String(item?.productSlug || "").trim().toLowerCase(),
    quantity: requiredInteger(item?.quantity, "quantity"),
    versionSnapshot: String(item?.versionSnapshot || "").trim()
  })).sort((left, right) => left.productSlug.localeCompare(right.productSlug));
}

function requiredInteger(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return value;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
