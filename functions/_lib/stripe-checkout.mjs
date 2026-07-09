const STRIPE_API_BASE = "https://api.stripe.com/v1";

export async function createStripeHostedCheckoutSession(input, options = {}) {
  const secretKey = validateStripeSandboxKey(options.secretKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Stripe checkout fetch is unavailable.");
  }

  const apiBase = String(options.apiBase || STRIPE_API_BASE).replace(/\/+$/g, "");
  const response = await fetchImpl(`${apiBase}/checkout/sessions`, {
    body: buildStripeCheckoutFormBody(input),
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Stripe Checkout Session creation failed.");
  }

  if (!payload || typeof payload.id !== "string" || typeof payload.url !== "string" || payload.livemode !== false) {
    throw new Error("Stripe Checkout Session response was not valid for sandbox checkout.");
  }

  return payload;
}

export function validateStripeSandboxKey(secretKey) {
  const normalizedKey = String(secretKey || "").trim();
  if (!normalizedKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!normalizedKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe sandbox test key for this phase.");
  }
  return normalizedKey;
}

function buildStripeCheckoutFormBody(input) {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", requiredString(input?.successUrl, "successUrl"));
  params.set("cancel_url", requiredString(input?.cancelUrl, "cancelUrl"));
  params.set("client_reference_id", requiredString(input?.clientReferenceId, "clientReferenceId"));
  params.set("customer_email", requiredString(input?.customerEmail, "customerEmail"));
  params.set("payment_method_types[0]", "card");
  params.set("metadata[trg_order_public_id]", requiredString(input?.clientReferenceId, "clientReferenceId"));
  params.set("payment_intent_data[metadata][trg_order_public_id]", requiredString(input?.clientReferenceId, "clientReferenceId"));

  const lineItems = Array.isArray(input?.lineItems) ? input.lineItems : [];
  lineItems.forEach((item, index) => {
    params.set(`line_items[${index}][quantity]`, "1");
    params.set(`line_items[${index}][price_data][currency]`, requiredString(item.currency, "currency").toLowerCase());
    params.set(`line_items[${index}][price_data][unit_amount]`, String(requiredInteger(item.unitAmount, "unitAmount")));
    params.set(`line_items[${index}][price_data][tax_behavior]`, "inclusive");
    params.set(`line_items[${index}][price_data][product_data][name]`, requiredString(item.name, "name"));

    if (item.description) {
      params.set(`line_items[${index}][price_data][product_data][description]`, String(item.description));
    }
  });

  return params.toString();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function requiredString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function requiredInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}
