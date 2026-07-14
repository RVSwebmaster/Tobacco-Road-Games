import { createCheckoutAccessCookie } from "./checkout-cookie.mjs";
import { createCustomerEmailHash, normalizeConfirmedCustomerEmail } from "./order-privacy.mjs";
import { createPendingOrder, attachStripeCheckoutSessionId } from "./orders-d1.mjs";
import { parsePendingOrderRequest, resolvePendingOrderItems } from "./orders-pending.mjs";
import {
  getRuntimeCatalogMap,
  getRuntimeCatalogProducts,
  getRuntimePricingPolicy,
  normalizeSlug
} from "./runtime-catalog.mjs";
import { createStripeHostedCheckoutSession } from "./stripe-checkout.mjs";

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

  let order;
  try {
    order = await createPendingOrder(database, {
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

  const origin = new URL(request.url).origin;
  let checkoutSession;
  try {
    checkoutSession = await createStripeHostedCheckoutSession({
      cancelUrl: `${origin}/store/checkout/canceled`,
      clientReferenceId: order.public_id,
      customerEmail: email.entered,
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
      secretKey: options.stripeSecretKey || env.STRIPE_SECRET_KEY
    });
  } catch {
    return jsonResponse({
      error: "Stripe checkout could not be created right now."
    }, 502);
  }

  try {
    order = await attachStripeCheckoutSessionId(database, Number(order.id), checkoutSession.id);
  } catch {
    return jsonResponse({
      error: "The checkout session was created, but the order could not be finalized for checkout."
    }, 500);
  }

  const checkoutCookie = await createCheckoutAccessCookie({
    createdAt,
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: checkoutSession.id
  }, checkoutCookieSecret);

  return jsonResponse({
    checkoutUrl: checkoutSession.url,
    createdAt: order.created_at,
    currency: order.currency,
    items: resolution.responseItems,
    paymentStatus: order.payment_status,
    pricingNote: String(pricingPolicy.pricingNote || ""),
    publicOrderReference: order.public_id,
    subtotalCents: order.subtotal_cents,
    taxInclusive: pricingPolicy.taxInclusive === true,
    totalCents: order.total_cents
  }, 201, {
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
