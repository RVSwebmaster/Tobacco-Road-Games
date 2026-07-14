import { createCheckoutAccessCookie } from "./checkout-cookie.mjs";
import {
  buildStripeIdempotencyKey,
  createCheckoutRequestHash,
  normalizeCheckoutAttemptId
} from "./checkout-attempt.mjs";
import { createCustomerEmailHash, normalizeConfirmedCustomerEmail } from "./order-privacy.mjs";
import {
  attachStripeCheckoutSession,
  createOrGetPendingOrderByCheckoutAttempt,
  markCheckoutAttemptRetryable,
  markCheckoutAttemptTerminalFailure
} from "./orders-d1.mjs";
import { parsePendingOrderRequest, resolvePendingOrderItems } from "./orders-pending.mjs";
import {
  getRuntimeCatalogMap,
  getRuntimeCatalogProducts,
  getRuntimePricingPolicy,
  normalizeSlug
} from "./runtime-catalog.mjs";
import { createStripeHostedCheckoutSession, StripeCheckoutError } from "./stripe-checkout.mjs";

export async function onRequestPost(context) {
  return handleCartCheckoutRequest(context.request, context.env);
}

export async function handleCartCheckoutRequest(request, env = {}, options = {}) {
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "POST") {
    return jsonResponse({
      error: "Checkout only accepts POST requests."
    }, 405);
  }

  const database = options.database || env.TRG_ORDERS || null;
  if (!database) {
    return jsonResponse({
      error: "The TRG_ORDERS database binding is missing. Add it in Cloudflare before using checkout."
    }, 503);
  }

  const emailHashSecret = String(options.emailHashSecret || env.ORDER_EMAIL_HASH_SECRET || "");
  if (!emailHashSecret) {
    return jsonResponse({
      error: "ORDER_EMAIL_HASH_SECRET is missing. Add it in Cloudflare before using checkout."
    }, 503);
  }

  const checkoutCookieSecret = String(options.checkoutCookieSecret || env.CHECKOUT_ACCESS_COOKIE_SECRET || "");
  if (!checkoutCookieSecret) {
    return jsonResponse({
      error: "CHECKOUT_ACCESS_COOKIE_SECRET is missing. Add it in Cloudflare before using checkout."
    }, 503);
  }

  const parsed = await parsePendingOrderRequest(request);
  if (!parsed.ok) {
    return jsonResponse({
      error: parsed.error,
      unavailableItems: parsed.unavailableItems || []
    }, parsed.status);
  }

  let checkoutAttemptId;
  try {
    checkoutAttemptId = normalizeCheckoutAttemptId(parsed.body.checkoutAttemptId);
  } catch (error) {
    return jsonResponse({
      error: safeErrorMessage(error, "A valid checkout attempt identifier is required.")
    }, 400);
  }

  let email;
  try {
    email = normalizeConfirmedCustomerEmail(parsed.body.email, parsed.body.emailConfirmation);
  } catch (error) {
    return jsonResponse({
      error: safeErrorMessage(error, "A valid confirmed email address is required.")
    }, 400);
  }

  const catalogProducts = Array.isArray(options.catalogProducts) ? options.catalogProducts : getRuntimeCatalogProducts();
  const catalogMap = options.catalogMap instanceof Map
    ? options.catalogMap
    : Array.isArray(options.catalogProducts)
      ? new Map(catalogProducts.map((product) => [String(product.slug || "").trim().toLowerCase(), product]))
      : getRuntimeCatalogMap();
  const allowedProductSlug = normalizeSlug(options.allowedProductSlug || env.STAGING_CHECKOUT_PRODUCT_SLUG);
  const checkoutCatalogMap = allowedProductSlug
    ? new Map(catalogMap.has(allowedProductSlug) ? [[allowedProductSlug, catalogMap.get(allowedProductSlug)]] : [])
    : catalogMap;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const pricingPolicy = options.pricingPolicy || getRuntimePricingPolicy();
  const resolution = resolvePendingOrderItems(parsed.body.items, checkoutCatalogMap, { now });

  if (resolution.unavailableItems.length) {
    return jsonResponse({
      error: "One or more cart items are not available for checkout.",
      unavailableItems: resolution.unavailableItems
    }, 400);
  }
  if (!resolution.items.length) {
    return jsonResponse({
      error: "At least one valid cart item is required for checkout."
    }, 400);
  }
  if (!resolution.currency) {
    return jsonResponse({
      error: "Checkout requires a valid order currency."
    }, 400);
  }

  const customerEmailHash = await createCustomerEmailHash(email.normalized, emailHashSecret);
  const createdAt = new Date(now).toISOString();
  const checkoutRequestHash = await createCheckoutRequestHash({
    currency: resolution.currency,
    customerEmailNormalized: email.normalized,
    items: resolution.itemSnapshots,
    subtotalCents: resolution.subtotalCents,
    totalCents: resolution.totalCents
  }, emailHashSecret);

  let orderResult;
  try {
    orderResult = await createOrGetPendingOrderByCheckoutAttempt(database, {
      checkoutAttemptId,
      checkoutRequestHash,
      checkoutSessionStatus: "creating",
      checkoutUpdatedAt: createdAt,
      createdAt,
      currency: resolution.currency,
      customerEmail: email.entered,
      customerEmailHash,
      customerEmailNormalized: email.normalized,
      emailStatus: "pending",
      fulfillmentStatus: "pending",
      includedTaxCents: null,
      netProceedsCents: null,
      paymentStatus: "pending",
      processorFeeCents: null,
      subtotalCents: resolution.subtotalCents,
      totalCents: resolution.totalCents
    }, resolution.itemSnapshots);
  } catch {
    return jsonResponse({
      error: "The pending order could not be recorded right now."
    }, 500);
  }

  let order = orderResult.order;
  if (order.checkout_request_hash !== checkoutRequestHash) {
    return jsonResponse({
      error: "This checkout attempt identifier was already used for different checkout details. Start a new checkout attempt.",
      retryable: false
    }, 409);
  }

  if (order.checkout_session_status === "failed_terminal" || order.payment_status === "failed") {
    return jsonResponse({
      checkoutAttemptId,
      error: "This checkout attempt was definitively rejected and cannot be reused. Start a new checkout attempt.",
      failureClassification: order.checkout_failure_code || "stripe_request_rejected",
      retryable: false
    }, 409);
  }

  if (order.checkout_session_status === "active"
    && order.stripe_checkout_session_id
    && order.stripe_checkout_session_url) {
    return createSuccessfulCheckoutResponse({
      checkoutAttemptId,
      checkoutCookieSecret,
      checkoutSession: {
        id: order.stripe_checkout_session_id,
        url: order.stripe_checkout_session_url
      },
      order,
      pricingPolicy,
      resolution,
      reused: true,
      status: 200
    });
  }

  const origin = new URL(request.url).origin;
  let checkoutSession;
  try {
    checkoutSession = await createStripeHostedCheckoutSession({
      cancelUrl: `${origin}/store/checkout/canceled`,
      checkoutAttemptId,
      clientReferenceId: order.public_id,
      customerEmail: email.normalized,
      internalOrderId: Number(order.id),
      lineItems: resolution.items.map((item) => ({
        currency: item.currency,
        description: item.authorDisplay ? `By ${item.authorDisplay}` : "",
        name: item.title,
        unitAmount: item.effectiveUnitPriceCents
      })),
      successUrl: `${origin}/store/checkout/complete?session_id={CHECKOUT_SESSION_ID}`
    }, {
      apiBase: options.stripeApiBase,
      fetchImpl: options.stripeFetchImpl,
      idempotencyKey: buildStripeIdempotencyKey(checkoutAttemptId),
      secretKey: options.stripeSecretKey || env.STRIPE_SECRET_KEY
    });
  } catch (error) {
    const stripeError = error instanceof StripeCheckoutError
      ? error
      : new StripeCheckoutError("The Stripe result could not be safely determined.", {
        classification: "indeterminate",
        code: "stripe_result_indeterminate"
      });
    try {
      order = stripeError.classification === "definitive"
        ? await markCheckoutAttemptTerminalFailure(database, Number(order.id), stripeError.code, { updatedAt: createdAt })
        : await markCheckoutAttemptRetryable(database, Number(order.id), stripeError.code, { updatedAt: createdAt });
    } catch {
      return jsonResponse({
        checkoutAttemptId,
        error: "Checkout could not be completed and its recovery state could not be confirmed.",
        retryable: true
      }, 503);
    }

    return jsonResponse({
      checkoutAttemptId,
      error: stripeError.classification === "definitive"
        ? "Stripe definitively rejected this checkout attempt. Start a new checkout attempt."
        : "The Stripe result is uncertain. Retry this same checkout attempt.",
      failureClassification: order?.checkout_failure_code || stripeError.code,
      retryable: stripeError.classification !== "definitive"
    }, stripeError.classification === "definitive" ? 502 : 503);
  }

  try {
    order = await attachStripeCheckoutSession(database, Number(order.id), checkoutSession, { updatedAt: createdAt });
  } catch {
    try {
      await markCheckoutAttemptRetryable(database, Number(order.id), "stripe_session_attachment_indeterminate", {
        updatedAt: createdAt
      });
    } catch {
      // The durable attempt identifier and request hash still preserve recovery.
    }
    return jsonResponse({
      checkoutAttemptId,
      error: "Stripe created or recovered the Session, but its order attachment is not confirmed. Retry this same checkout attempt.",
      failureClassification: "stripe_session_attachment_indeterminate",
      retryable: true
    }, 503);
  }

  return createSuccessfulCheckoutResponse({
    checkoutAttemptId,
    checkoutCookieSecret,
    checkoutSession,
    order,
    pricingPolicy,
    resolution,
    reused: orderResult.created !== true,
    status: orderResult.created === true ? 201 : 200
  });
}

async function createSuccessfulCheckoutResponse({
  checkoutAttemptId,
  checkoutCookieSecret,
  checkoutSession,
  order,
  pricingPolicy,
  resolution,
  reused,
  status
}) {
  const checkoutCookie = await createCheckoutAccessCookie({
    createdAt: order.created_at,
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: checkoutSession.id
  }, checkoutCookieSecret);

  return jsonResponse({
    checkoutAttemptId,
    checkoutUrl: checkoutSession.url,
    createdAt: order.created_at,
    currency: order.currency,
    items: resolution.responseItems,
    paymentStatus: order.payment_status,
    pricingNote: String(pricingPolicy.pricingNote || ""),
    publicOrderReference: order.public_id,
    reusedCheckoutAttempt: reused === true,
    subtotalCents: order.subtotal_cents,
    taxInclusive: pricingPolicy.taxInclusive === true,
    totalCents: order.total_cents
  }, status, {
    "set-cookie": checkoutCookie
  });
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    },
    status
  });
}

function safeErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return message || fallback;
}
