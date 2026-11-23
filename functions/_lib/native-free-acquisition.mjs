import pricingModule from "../../shared/pricing.js";
import { getSessionFromRequest, validateSameOriginRequest } from "./account-auth.mjs";
import { normalizeCheckoutAttemptId } from "./checkout-attempt.mjs";
import { handleCartQuoteRequest } from "./cart-quote.mjs";
import { toNativeCartProduct } from "./cart-catalog.mjs";
import { grantNativeFreeOrderEntitlements } from "./native-entitlements-d1.mjs";
import { handleNativeOrderPreparationRequest } from "./native-order-preparation.mjs";
import { getNativeOrderItemSnapshots, getPreparedOrderByCheckoutAttempt } from "./native-orders-d1.mjs";
import { getProductById } from "./product-catalog-d1.mjs";
import { readStoreState, storeClosedResponse } from "./store-state.mjs";

const { resolveCartPrice } = pricingModule;
const MAX_BODY_BYTES = 8192;

export async function onRequestPost(context) {
  return handleNativeFreeAcquisitionRequest(context.request, context.env);
}

export async function handleNativeFreeAcquisitionRequest(request, env = {}, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({ error: "Native free acquisition only accepts POST requests." }, 405);
  }
  if (!validateSameOriginRequest(request)) {
    return jsonResponse({ code: "csrf_rejected", error: "This acquisition request could not be verified." }, 403);
  }
  const database = options.database || env.TRG_ORDERS;
  if (!database?.prepare || typeof database.batch !== "function") {
    return jsonResponse({ error: "Native free acquisition is temporarily unavailable." }, 503);
  }
  const storeState = await readStoreState(env, { database: options.storeStateDatabase || database });
  if (!storeState.available || storeState.state !== "OPEN") return storeClosedResponse(storeState.state);

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ error: "The acquisition request body could not be read." }, 400);
  }
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "The acquisition request is too large." }, 413);
  }
  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return jsonResponse({ error: "The acquisition request must be valid JSON." }, 400);
  }
  let checkoutAttemptId;
  try {
    checkoutAttemptId = normalizeCheckoutAttemptId(body?.checkoutAttemptId);
  } catch (error) {
    return jsonResponse({ error: safeMessage(error, "A valid acquisition attempt is required.") }, 400);
  }
  const session = options.accountSession === undefined
    ? await getSessionFromRequest(request, env, options.accountSessionOptions || {})
    : options.accountSession;
  if (!session?.valid || !session.user?.id) {
    return jsonResponse({ code: "authenticated_account_required", error: "Sign in to acquire this product." }, 403);
  }

  let order = await getPreparedOrderByCheckoutAttempt(database, checkoutAttemptId);
  if (order && order.user_id !== session.user.id) {
    return jsonResponse({ code: "order_account_mismatch", error: "Sign in with the account that prepared this acquisition." }, 403);
  }
  if (isCompletedFreeOrder(order)) {
    const items = await getNativeOrderItemSnapshots(database, Number(order.id));
    return successfulResponse(order, items, true, 200);
  }
  if (order && (order.native_order_state !== "pending" || order.payment_status !== "pending")) {
    return jsonResponse({ code: "native_free_order_ineligible", error: "This acquisition attempt cannot be completed." }, 409);
  }

  const replay = () => new Request(request.url, { method: "POST", headers: request.headers, body: rawBody });
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const quoteResponse = await handleCartQuoteRequest(replay(), {
    database,
    includeNative: true,
    now,
    pricingPolicy: options.pricingPolicy
  });
  const quote = await quoteResponse.json();
  if (!quoteResponse.ok) return jsonResponse(quote, quoteResponse.status);
  if (quote.unavailableItems?.length || !quote.items?.length) {
    return jsonResponse({
      code: "native_free_product_unavailable",
      error: "One or more products are not available for acquisition.",
      unavailableItems: quote.unavailableItems || []
    }, 400);
  }
  if (quote.items.some(item => item.catalogSource !== "native-d1")) {
    return jsonResponse({ code: "native_free_only", error: "This endpoint accepts native free products only." }, 409);
  }
  if (Number(quote.totalCents) !== 0) {
    return jsonResponse({ code: "native_zero_value_required", error: "This native product requires payment and cannot use free acquisition." }, 409);
  }

  const preparedResponse = await handleNativeOrderPreparationRequest(replay(), env, {
    ...options,
    accountSession: session,
    database,
    now
  });
  const prepared = await preparedResponse.json();
  if (!preparedResponse.ok) {
    const concurrent = await getPreparedOrderByCheckoutAttempt(database, checkoutAttemptId);
    if (concurrent?.user_id === session.user.id && isCompletedFreeOrder(concurrent)) {
      const concurrentItems = await getNativeOrderItemSnapshots(database, Number(concurrent.id));
      return successfulResponse(concurrent, concurrentItems, true, 200);
    }
    return jsonResponse(prepared, preparedResponse.status);
  }
  order = await getPreparedOrderByCheckoutAttempt(database, checkoutAttemptId);
  if (!order || order.user_id !== session.user.id || Number(order.total_cents) !== 0) {
    return jsonResponse({ code: "native_free_order_invalid", error: "The zero-value order could not be confirmed." }, 409);
  }
  const items = await getNativeOrderItemSnapshots(database, Number(order.id));
  const snapshotError = validateFreeSnapshots(order, items);
  if (snapshotError) return jsonResponse({ code: snapshotError, error: "The zero-value order snapshot is invalid." }, 409);
  const catalogError = await validateCurrentFreeCatalog(database, items, now);
  if (catalogError) {
    return jsonResponse({ code: catalogError, error: "The product changed or is no longer available. Prepare a new acquisition." }, 409);
  }
  const objectError = await verifyDeliveryObjects(env.TRG_PRODUCTS, items);
  if (objectError) return jsonResponse({ code: objectError, error: "The free product file is temporarily unavailable." }, 503);

  let granted;
  try {
    granted = await grantNativeFreeOrderEntitlements(
      options.entitlementDatabase || database,
      Number(order.id),
      { nowMs: now }
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "native_free_entitlement_failed", message: String(error?.message || error) }));
    return jsonResponse({
      code: "native_free_entitlement_processing_failed",
      error: "The acquisition could not be finalized. Retry this same acquisition attempt.",
      retryable: true
    }, 503);
  }
  if (!granted.ready) {
    return jsonResponse({ code: granted.result || "native_free_entitlement_incomplete", error: "The acquisition could not be finalized." }, 409);
  }
  return successfulResponse(granted.order, items, granted.result === "already_entitled", 201);
}

function validateFreeSnapshots(order, items) {
  if (!items.length || Number(order.total_cents) !== 0 || order.catalog_source !== "native_d1") {
    return "native_free_snapshot_invalid";
  }
  for (const item of items) {
    if (item.catalog_source !== "native_d1" || Number(item.quantity) !== 1
      || Number(item.selected_price_cents) !== 0
      || Number(item.effective_unit_price_cents) !== 0
      || Number(item.line_total_cents) !== 0
      || !["fixed", "free", "pwyw"].includes(item.pricing_model_snapshot)
      || (item.pricing_model_snapshot === "pwyw" && Number(item.minimum_price_cents_snapshot || 0) !== 0)) {
      return "native_free_snapshot_invalid";
    }
  }
  return "";
}

async function validateCurrentFreeCatalog(database, items, now) {
  for (const item of items) {
    const product = await getProductById(database, item.native_product_id);
    if (!product || product.slug !== item.product_slug || product.creatorId !== item.native_creator_id) {
      return "native_product_identity_changed";
    }
    if (Number(product.revision) !== Number(item.catalog_revision)) return "native_catalog_revision_stale";
    const current = await toNativeCartProduct(database, product);
    if (current.nativeAvailabilityCode) return current.nativeAvailabilityCode;
    if (!["available-direct", "pay-what-you-want", "free-download"].includes(current.status)) {
      return "native_product_unavailable";
    }
    if (current.deliveryR2Key !== item.delivery_r2_key_snapshot
      || current.deliveryFilename !== item.delivery_filename_snapshot
      || current.deliveryContentType !== item.delivery_content_type_snapshot) {
      return "native_delivery_snapshot_stale";
    }
    const price = resolveCartPrice(current, 0, { now });
    if (!price.valid || Number(price.details?.effectivePriceCents) !== 0) return "native_zero_value_no_longer_available";
  }
  return "";
}

async function verifyDeliveryObjects(bucket, items) {
  if (!bucket?.head) return "native_delivery_binding_unavailable";
  for (const item of items) {
    let object;
    try {
      object = await bucket.head(item.delivery_r2_key_snapshot);
    } catch {
      return "native_delivery_read_failed";
    }
    if (!object || String(object.httpMetadata?.contentType || "").toLowerCase() !== "application/pdf") {
      return "native_delivery_object_unavailable";
    }
  }
  return "";
}

function isCompletedFreeOrder(order) {
  return Boolean(order
    && order.catalog_source === "native_d1"
    && order.payment_status === "paid"
    && order.native_order_state === "free_acquired"
    && order.native_entitlement_status === "ready"
    && Number(order.total_cents) === 0
    && order.payment_source === "none"
    && order.settlement_method === "no_payment"
    && !order.stripe_checkout_session_id
    && !order.stripe_payment_intent_id);
}

function successfulResponse(order, items, reused, status) {
  return jsonResponse({
    accessUrl: "/account.html",
    acquisitionComplete: true,
    checkoutAttemptId: order.checkout_attempt_id,
    currency: order.currency,
    items: items.map(publicItem),
    nativeOrderState: order.native_order_state,
    paymentProvider: "none",
    paymentStatus: order.payment_status,
    publicOrderReference: order.public_id,
    reusedCheckoutAttempt: reused,
    stripeCheckoutSessionCreated: false,
    subtotalCents: 0,
    totalCents: 0
  }, status);
}

function publicItem(item) {
  return {
    catalogRevision: Number(item.catalog_revision),
    currency: item.currency,
    effectiveUnitPriceCents: Number(item.effective_unit_price_cents),
    pricingModel: item.pricing_model_snapshot,
    quantity: Number(item.quantity),
    slug: item.product_slug,
    title: item.product_title_snapshot
  };
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" }
  });
}
function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
