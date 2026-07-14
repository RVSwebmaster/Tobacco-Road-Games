import { STRIPE_API_VERSION } from "./stripe-api.mjs";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export class StripeCheckoutError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "StripeCheckoutError";
    this.classification = options.classification === "definitive" ? "definitive" : "indeterminate";
    this.code = String(options.code || "stripe_result_indeterminate");
    this.httpStatus = Number.isInteger(options.httpStatus) ? options.httpStatus : null;
  }
}

export async function createStripeHostedCheckoutSession(input, options = {}) {
  const secretKey = validateStripeSandboxKey(options.secretKey);
  const idempotencyKey = requiredString(options.idempotencyKey, "idempotencyKey");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new StripeCheckoutError("Stripe checkout fetch is unavailable.", {
      classification: "indeterminate",
      code: "stripe_transport_unavailable"
    });
  }

  const apiBase = String(options.apiBase || STRIPE_API_BASE).replace(/\/+$/g, "");
  let response;
  try {
    response = await fetchImpl(`${apiBase}/checkout/sessions`, {
      body: buildStripeCheckoutFormBody(input),
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idempotencyKey,
        "stripe-version": STRIPE_API_VERSION
      },
      method: "POST"
    });
  } catch (error) {
    throw new StripeCheckoutError("The Stripe result is uncertain because the request did not complete.", {
      cause: error,
      classification: "indeterminate",
      code: "stripe_connection_indeterminate"
    });
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    const httpStatus = Number(response.status || 0);
    const indeterminate = httpStatus >= 500 || [408, 409, 425, 429].includes(httpStatus);
    throw new StripeCheckoutError(
      indeterminate
        ? "The Stripe result is uncertain and may be retried."
        : "Stripe definitively rejected Checkout Session creation.",
      {
        classification: indeterminate ? "indeterminate" : "definitive",
        code: indeterminate ? "stripe_http_indeterminate" : classifyDefinitiveStripeCode(httpStatus),
        httpStatus
      }
    );
  }

  if (!payload || typeof payload.id !== "string" || typeof payload.url !== "string" || payload.livemode !== false) {
    throw new StripeCheckoutError("The Stripe response could not be safely confirmed.", {
      classification: "indeterminate",
      code: "stripe_response_indeterminate",
      httpStatus: Number(response.status || 0)
    });
  }

  return payload;
}

export function validateStripeSandboxKey(secretKey) {
  const normalizedKey = String(secretKey || "").trim();
  if (!normalizedKey) {
    throw new StripeCheckoutError("STRIPE_SECRET_KEY is not configured.", {
      classification: "definitive",
      code: "stripe_configuration_missing"
    });
  }
  if (!normalizedKey.startsWith("sk_test_")) {
    throw new StripeCheckoutError("STRIPE_SECRET_KEY must be a Stripe sandbox test key for this phase.", {
      classification: "definitive",
      code: "stripe_configuration_not_test_mode"
    });
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
  params.set("metadata[trg_order_id]", String(requiredPositiveInteger(input?.internalOrderId, "internalOrderId")));
  params.set("metadata[trg_order_public_id]", requiredString(input?.clientReferenceId, "clientReferenceId"));
  params.set("metadata[trg_checkout_attempt_id]", requiredString(input?.checkoutAttemptId, "checkoutAttemptId"));
  params.set("payment_intent_data[metadata][trg_order_id]", String(requiredPositiveInteger(input?.internalOrderId, "internalOrderId")));
  params.set("payment_intent_data[metadata][trg_order_public_id]", requiredString(input?.clientReferenceId, "clientReferenceId"));
  params.set("payment_intent_data[metadata][trg_checkout_attempt_id]", requiredString(input?.checkoutAttemptId, "checkoutAttemptId"));

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

function requiredPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function classifyDefinitiveStripeCode(httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) {
    return "stripe_authentication_rejected";
  }
  return "stripe_request_rejected";
}
