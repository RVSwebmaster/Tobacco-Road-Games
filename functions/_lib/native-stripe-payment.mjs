import { getSessionFromRequest } from "./account-auth.mjs";
import { isNativeGuestCheckoutEnabled } from "./native-guest-purchase-policy.mjs";
import { createCheckoutAccessCookie } from "./checkout-cookie.mjs";
import { buildStripeIdempotencyKey, normalizeCheckoutAttemptId } from "./checkout-attempt.mjs";
import { toNativeCartProduct } from "./cart-catalog.mjs";
import {
  attachNativeStripeCheckoutSession,
  cancelNativePendingOrder,
  failNativePaymentAttempt,
  getNativeOrderItemSnapshots,
  getPreparedOrderByCheckoutAttempt,
  markNativePaymentRetryable
} from "./native-orders-d1.mjs";
import { createCustomerEmailHash, normalizeConfirmedCustomerEmail } from "./order-privacy.mjs";
import { getProductById } from "./product-catalog-d1.mjs";
import { createStripeHostedCheckoutSession, StripeCheckoutError, validateStripeKey } from "./stripe-checkout.mjs";
import { readStoreState, storeClosedResponse } from "./store-state.mjs";
import { assertNotFraudBlocked, assertVerifiedPurchaseIdentity } from "./transaction-policy.mjs";

const MAX_BODY_BYTES = 8192;

export async function onRequestPost(context) {
  return handleNativeStripePaymentRequest(context.request, context.env);
}

export async function handleNativeStripePaymentRequest(request, env = {}, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({ error: "Native payment only accepts POST requests." }, 405);
  }
  const database = options.database || env.TRG_ORDERS;
  if (!database) return jsonResponse({ error: "Native payment is temporarily unavailable." }, 503);
  const storeState = await readStoreState(env, { database: options.storeStateDatabase || database });
  if (!storeState.available || storeState.state !== "OPEN") return storeClosedResponse(storeState.state);
  const pipelineStage = String(options.pipelineStage || env.PAYMENT_PIPELINE_STAGE || "").trim().toLowerCase();
  const stripeSecretKey = String(options.stripeSecretKey || env.STRIPE_SECRET_KEY || "").trim();
  if (!["staging", "production"].includes(pipelineStage)) {
    return jsonResponse({ code: "stripe_pipeline_stage_invalid", error: "Native Stripe payment configuration is unavailable." }, 503);
  }
  if (pipelineStage === "production"
    && String(options.liveCheckoutMode || env.NATIVE_LIVE_CHECKOUT_MODE || "").trim().toLowerCase() !== "production-enabled") {
    return jsonResponse({ code: "native_live_checkout_disabled", error: "Native live checkout is not enabled." }, 503);
  }
  try {
    validateStripeKey(stripeSecretKey, pipelineStage);
  } catch (error) {
    const code = error instanceof StripeCheckoutError ? error.code : "stripe_configuration_invalid";
    return jsonResponse({ code, error: "Native Stripe payment configuration is unavailable." }, 503);
  }
  const emailHashSecret = String(options.emailHashSecret || env.ORDER_EMAIL_HASH_SECRET || "");
  const checkoutCookieSecret = String(options.checkoutCookieSecret || env.CHECKOUT_ACCESS_COOKIE_SECRET || "");
  if (!emailHashSecret || !checkoutCookieSecret) {
    return jsonResponse({ error: "Native payment is temporarily unavailable." }, 503);
  }

  const parsed = await parseRequest(request);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  let checkoutAttemptId;
  let email;
  try {
    checkoutAttemptId = normalizeCheckoutAttemptId(parsed.body.checkoutAttemptId);
    email = normalizeConfirmedCustomerEmail(parsed.body.email, parsed.body.emailConfirmation);
  } catch (error) {
    return jsonResponse({ error: safeMessage(error, "Valid payment details are required.") }, 400);
  }
  const publicOrderReference = String(parsed.body.publicOrderReference || "").trim().toUpperCase();
  if (!publicOrderReference) return jsonResponse({ error: "A public order reference is required." }, 400);
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const order = await getPreparedOrderByCheckoutAttempt(database, checkoutAttemptId);
  if (!order || order.public_id !== publicOrderReference || order.catalog_source !== "native_d1") {
    return jsonResponse({ code: "native_order_not_found", error: "The native pending order was not found." }, 404);
  }
  const customerEmailHash = await createCustomerEmailHash(email.normalized, emailHashSecret);
  if (customerEmailHash !== order.customer_email_hash) {
    return jsonResponse({ code: "order_identity_mismatch", error: "The signed-in customer identity does not match this order." }, 403);
  }
  const session = options.accountSession === undefined
    ? await optionalAccountSession(request, env, options)
    : options.accountSession;
  if (!session?.user && !isNativeGuestCheckoutEnabled(env, options)) {
    return jsonResponse({
      code: "native_guest_checkout_unavailable",
      error: "Native guest checkout is temporarily unavailable while purchase claiming is completed."
    }, 503);
  }
  if (!options.skipIdentityChecks) {
    try {
      if (order.user_id && session?.user?.id !== order.user_id) {
        const error = new Error("Sign in with the account that prepared this order.");
        error.code = "order_account_mismatch";
        throw error;
      }
      if (session?.user && String(session.user.email || session.user.email_normalized || "").toLowerCase() !== email.normalized) {
        const error = new Error("Use the email address on your signed-in account.");
        error.code = "account_email_mismatch";
        throw error;
      }
      await assertVerifiedPurchaseIdentity(database, { session, emailHash: customerEmailHash, nowMs: now });
      await assertNotFraudBlocked(database, { emailHash: customerEmailHash, userId: session?.user?.id || null });
    } catch (error) {
      return jsonResponse({ error: safeMessage(error, "Purchase verification failed."), code: error?.code || "purchase_verification_failed" }, 403);
    }
  }

  const stateError = nativeOrderStateError(order);
  if (stateError) return jsonResponse(stateError, 409);
  if (Number(order.total_cents) <= 0) {
    return jsonResponse({
      code: "native_free_payment_unavailable",
      error: "Free native acquisitions are not part of Stripe payment integration."
    }, 409);
  }
  if (order.checkout_session_status === "active" && order.stripe_checkout_session_id && order.stripe_checkout_session_url) {
    return successfulResponse(order, checkoutCookieSecret, true);
  }
  if (!order.native_payment_expires_at || Date.parse(order.native_payment_expires_at) <= now) {
    await cancelNativePendingOrder(database, Number(order.id), "native_order_expired", { updatedAt: new Date(now).toISOString() });
    return jsonResponse({ code: "native_order_expired", error: "This native order is stale. Prepare a new order." }, 409);
  }

  const items = await getNativeOrderItemSnapshots(database, Number(order.id));
  const snapshotError = validateStoredSnapshots(order, items);
  if (snapshotError) {
    await cancelNativePendingOrder(database, Number(order.id), snapshotError, { updatedAt: new Date(now).toISOString() });
    return jsonResponse({ code: snapshotError, error: "The native order snapshot is not eligible for payment." }, 409);
  }
  const catalogError = await validateCurrentCatalog(database, items);
  if (catalogError) {
    await cancelNativePendingOrder(database, Number(order.id), catalogError, { updatedAt: new Date(now).toISOString() });
    return jsonResponse({ code: catalogError, error: "The native order is stale or no longer available. Prepare a new order." }, 409);
  }

  const createdAt = new Date(now).toISOString();
  const origin = resolveCheckoutOrigin(request, env, options, pipelineStage);
  if (!origin) {
    return jsonResponse({ code: "native_checkout_origin_invalid", error: "Native Stripe payment configuration is unavailable." }, 503);
  }
  let checkoutSession;
  try {
    checkoutSession = await createStripeHostedCheckoutSession({
      cancelUrl: `${origin}/store/checkout/canceled`,
      checkoutAttemptId,
      clientReferenceId: order.public_id,
      customerEmail: order.customer_email_normalized,
      expiresAt: Math.floor(Date.parse(order.native_payment_expires_at) / 1000),
      internalOrderId: Number(order.id),
      lineItems: items.map(item => ({
        currency: item.currency,
        name: item.product_title_snapshot,
        unitAmount: Number(item.effective_unit_price_cents)
      })),
      orderSource: "native_d1",
      successUrl: `${origin}/store/checkout/complete?session_id={CHECKOUT_SESSION_ID}`
    }, {
      apiBase: options.stripeApiBase,
      fetchImpl: options.stripeFetchImpl,
      idempotencyKey: buildStripeIdempotencyKey(checkoutAttemptId),
      pipelineStage,
      secretKey: stripeSecretKey
    });
  } catch (error) {
    const stripeError = error instanceof StripeCheckoutError
      ? error
      : new StripeCheckoutError("The Stripe result could not be safely determined.", { code: "stripe_result_indeterminate" });
    if (stripeError.classification === "definitive") {
      await failNativePaymentAttempt(database, Number(order.id), stripeError.code, { updatedAt: createdAt });
    } else {
      await markNativePaymentRetryable(database, Number(order.id), stripeError.code, { updatedAt: createdAt });
    }
    return jsonResponse({
      code: stripeError.code,
      error: stripeError.classification === "definitive"
        ? "Stripe rejected this native payment attempt. Prepare a new order."
        : "The Stripe result is uncertain. Retry this same order and attempt.",
      retryable: stripeError.classification !== "definitive"
    }, stripeError.classification === "definitive" ? 502 : 503);
  }

  let attached;
  try {
    attached = await attachNativeStripeCheckoutSession(database, Number(order.id), checkoutSession, { updatedAt: createdAt });
  } catch {
    await markNativePaymentRetryable(database, Number(order.id), "stripe_session_attachment_indeterminate", { updatedAt: createdAt }).catch(() => {});
    return jsonResponse({
      code: "stripe_session_attachment_indeterminate",
      error: "Stripe created or recovered the Session, but its order attachment is not confirmed. Retry this same order and attempt.",
      retryable: true
    }, 503);
  }
  return successfulResponse(attached, checkoutCookieSecret, false, 201);
}

function resolveCheckoutOrigin(request, env, options, pipelineStage) {
  const requestOrigin = new URL(request.url).origin;
  const configured = String(options.publicSiteOrigin || env.PUBLIC_SITE_ORIGIN || "").trim();
  if (pipelineStage !== "production") return configured ? safeHttpsOrigin(configured) || requestOrigin : requestOrigin;
  const configuredOrigin = safeHttpsOrigin(configured);
  return configuredOrigin && configuredOrigin === requestOrigin ? configuredOrigin : "";
}

function safeHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === String(value).replace(/\/$/, "") ? parsed.origin : "";
  } catch {
    return "";
  }
}

async function validateCurrentCatalog(database, items) {
  for (const item of items) {
    const product = await getProductById(database, item.native_product_id);
    if (!product || product.slug !== item.product_slug || product.creatorId !== item.native_creator_id) return "native_product_identity_changed";
    if (Number(product.revision) !== Number(item.catalog_revision)) return "native_catalog_revision_stale";
    const current = await toNativeCartProduct(database, product);
    if (current.nativeAvailabilityCode || !["available-direct", "pay-what-you-want"].includes(current.status)) return "native_product_unavailable";
    if (current.buyMode !== "cart" || !["fixed", "pwyw"].includes(current.pricingModel)) return "native_product_not_payable";
    if (current.deliveryR2Key !== item.delivery_r2_key_snapshot
      || current.deliveryFilename !== item.delivery_filename_snapshot
      || current.deliveryContentType !== item.delivery_content_type_snapshot) return "native_delivery_snapshot_stale";
  }
  return "";
}

function validateStoredSnapshots(order, items) {
  if (!items.length) return "native_order_items_missing";
  let total = 0;
  for (const item of items) {
    if (item.catalog_source !== "native_d1" || Number(item.quantity) !== 1) return "native_order_snapshot_invalid";
    if (!["fixed", "pwyw"].includes(item.pricing_model_snapshot)) return "native_order_contains_free_or_unsupported_item";
    if (Number(item.effective_unit_price_cents) <= 0
      || Number(item.selected_price_cents) !== Number(item.effective_unit_price_cents)
      || Number(item.line_total_cents) !== Number(item.effective_unit_price_cents)) return "native_order_price_snapshot_invalid";
    if (String(item.currency).toUpperCase() !== String(order.currency).toUpperCase()) return "native_order_currency_snapshot_invalid";
    total += Number(item.line_total_cents);
  }
  return total === Number(order.total_cents) ? "" : "native_order_total_snapshot_invalid";
}

function nativeOrderStateError(order) {
  if (order.payment_status === "paid" || order.native_order_state === "paid") {
    return { code: "native_order_already_paid", error: "This native order is already paid." };
  }
  if (order.native_order_state === "canceled" || order.payment_status === "expired") {
    return { code: "native_order_canceled", error: "This native order is canceled or expired." };
  }
  if (order.native_order_state === "failed" || order.payment_status === "failed" || order.checkout_session_status === "failed_terminal") {
    return { code: "native_order_failed", error: "This native order cannot start another payment." };
  }
  if (order.native_order_state !== "pending" || order.payment_status !== "pending" || order.fulfillment_status !== "pending") {
    return { code: "native_order_ineligible", error: "This native order is not eligible for payment." };
  }
  return null;
}

async function successfulResponse(order, checkoutCookieSecret, reused, status = 200) {
  const checkoutCookie = await createCheckoutAccessCookie({
    createdAt: order.created_at,
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: order.stripe_checkout_session_id
  }, checkoutCookieSecret);
  return jsonResponse({
    checkoutAttemptId: order.checkout_attempt_id,
    checkoutUrl: order.stripe_checkout_session_url,
    currency: order.currency,
    nativeOrderState: order.native_order_state,
    paymentStatus: order.payment_status,
    publicOrderReference: order.public_id,
    reusedCheckoutAttempt: reused,
    totalCents: Number(order.total_cents)
  }, status, { "set-cookie": checkoutCookie });
}

async function parseRequest(request) {
  let raw;
  try { raw = await request.text(); } catch { return { error: "The payment request could not be read.", ok: false, status: 400 }; }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { error: "The payment request is too large.", ok: false, status: 413 };
  try {
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { body, ok: true };
  } catch {
    return { error: "The payment request must be valid JSON.", ok: false, status: 400 };
  }
}

async function optionalAccountSession(request, env, options) {
  try {
    const session = await getSessionFromRequest(request, env, options.accountSessionOptions || {});
    return session.valid ? session : null;
  } catch { return null; }
}

function jsonResponse(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", ...extraHeaders },
    status
  });
}

function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
