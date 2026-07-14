import { repairPaidOrderFulfillment } from "./order-fulfillment.mjs";
import { getOrderByStripeCheckoutSessionId } from "./orders-d1.mjs";
import { STRIPE_API_VERSION } from "./stripe-api.mjs";
import { validateStripeSandboxKey } from "./stripe-checkout.mjs";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const MAX_BODY_BYTES = 2048;

export async function handleFulfillmentRepairRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (String(env.PAYMENT_PIPELINE_STAGE || "").toLowerCase() !== "staging") {
    return jsonResponse({ error: "repair_unavailable" }, 404);
  }
  if (!env.TRG_ORDERS || !env.TRG_PRODUCTS) {
    return jsonResponse({ error: "repair_unavailable" }, 503);
  }
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") !== requestOrigin) {
    return jsonResponse({ error: "request_origin_rejected" }, 403);
  }

  const parsed = await parseRequest(request);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, parsed.status);
  }
  const order = await getOrderByStripeCheckoutSessionId(env.TRG_ORDERS, parsed.sessionId);
  if (!order) {
    return jsonResponse({ error: "order_not_found" }, 404);
  }
  if (order.payment_status !== "paid") {
    return jsonResponse({ error: "order_not_paid" }, 409);
  }

  let session;
  try {
    session = await retrieveStripeSession(parsed.sessionId, {
      fetchImpl: options.fetchImpl,
      secretKey: env.STRIPE_SECRET_KEY
    });
  } catch {
    return jsonResponse({ error: "stripe_verification_unavailable" }, 503);
  }
  if (!isMatchingPaidSession(order, session)) {
    return jsonResponse({ error: "stripe_order_mismatch" }, 409);
  }

  const fulfillment = await repairPaidOrderFulfillment(
    env.TRG_ORDERS,
    env.TRG_PRODUCTS,
    Number(order.id),
    { nowMs: options.nowMs }
  );
  if (!fulfillment.ready) {
    return jsonResponse({
      error: "fulfillment_not_ready",
      result: fulfillment.result
    }, 503);
  }
  return jsonResponse({
    entitlementCount: fulfillment.entitlements.length,
    fulfillmentStatus: fulfillment.order.fulfillment_status,
    ok: true,
    publicOrderReference: fulfillment.order.public_id
  }, 200);
}

async function retrieveStripeSession(sessionId, options = {}) {
  const secretKey = validateStripeSandboxKey(options.secretKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Stripe fetch is unavailable.");
  }
  const response = await fetchImpl(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      authorization: `Bearer ${secretKey}`,
      "stripe-version": STRIPE_API_VERSION
    },
    method: "GET"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error("Stripe Session retrieval failed.");
  }
  return payload;
}

function isMatchingPaidSession(order, session) {
  const paymentIntentId = typeof session?.payment_intent === "string"
    ? session.payment_intent
    : session?.payment_intent?.id;
  return Boolean(
    session?.object === "checkout.session"
      && session.id === order.stripe_checkout_session_id
      && session.livemode === false
      && session.status === "complete"
      && session.payment_status === "paid"
      && String(session?.metadata?.trg_order_id || "") === String(order.id)
      && String(session?.metadata?.trg_order_public_id || "") === order.public_id
      && String(session?.metadata?.trg_checkout_attempt_id || "") === order.checkout_attempt_id
      && Number(session.amount_total) === Number(order.total_cents)
      && String(session.currency || "").toUpperCase() === String(order.currency || "").toUpperCase()
      && paymentIntentId === order.stripe_payment_intent_id
  );
}

async function parseRequest(request) {
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return { error: "invalid_request", ok: false, status: 400 };
  }
  if (!rawBody || new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return { error: "invalid_request", ok: false, status: 400 };
  }
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { error: "invalid_request", ok: false, status: 400 };
  }
  const sessionId = String(body?.sessionId || "").trim();
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) {
    return { error: "invalid_session_id", ok: false, status: 400 };
  }
  return { ok: true, sessionId };
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    },
    status
  });
}
