const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCustomerEmail(value) {
  const entered = String(value || "").trim();
  if (!entered || entered.length > 320 || !EMAIL_PATTERN.test(entered)) {
    throw new Error("A valid email address is required.");
  }

  return {
    entered,
    normalized: entered.toLowerCase()
  };
}

export function normalizeConfirmedCustomerEmail(emailValue, confirmationValue) {
  const email = normalizeCustomerEmail(emailValue);
  const confirmation = normalizeCustomerEmail(confirmationValue);

  if (email.normalized !== confirmation.normalized) {
    throw new Error("Email confirmation must match.");
  }

  return email;
}

export async function createCustomerEmailHash(normalizedEmail, secret) {
  const normalizedSecret = String(secret || "");
  if (!normalizedSecret) {
    throw new Error("ORDER_EMAIL_HASH_SECRET is not configured.");
  }

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
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(normalizedEmail || "")));
  return bytesToHex(new Uint8Array(signature));
}

export function generatePublicOrderReference() {
  const random = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `TRG-${random.slice(0, 12)}-${random.slice(12, 20)}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
