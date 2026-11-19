import { createNativeOrderRequestHash, normalizeCheckoutAttemptId } from "./checkout-attempt.mjs";
import { resolveHybridCartCatalog } from "./cart-catalog.mjs";
import { getSessionFromRequest } from "./account-auth.mjs";
import { isNativeGuestCheckoutEnabled } from "./native-guest-purchase-policy.mjs";
import { createCustomerEmailHash, normalizeConfirmedCustomerEmail } from "./order-privacy.mjs";
import { parsePendingOrderRequest, resolvePendingOrderItems } from "./orders-pending.mjs";
import {
  createOrGetNativePendingOrder,
  getNativeOrderItemSnapshots
} from "./native-orders-d1.mjs";
import { getRuntimePricingPolicy } from "./runtime-catalog.mjs";
import { readStoreState, storeClosedResponse } from "./store-state.mjs";
import { getEffectiveFeePolicy } from "./creator-finance.mjs";
import { resolveSalePolicy } from "./marketplace-policy.mjs";
import {
  assertNotFraudBlocked,
  assertVerifiedPurchaseIdentity,
  findDuplicateDigitalOwnership
} from "./transaction-policy.mjs";

export async function onRequestPost(context) {
  return handleNativeOrderPreparationRequest(context.request, context.env);
}

export async function handleNativeOrderPreparationRequest(request, env = {}, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({ error: "Native order preparation only accepts POST requests." }, 405);
  }
  const database = options.database || env.TRG_ORDERS;
  if (!database) return jsonResponse({ error: "Native order preparation is temporarily unavailable." }, 503);
  const storeState = await readStoreState(env, { database: options.storeStateDatabase || database });
  if (!storeState.available || storeState.state !== "OPEN") return storeClosedResponse(storeState.state);
  const emailHashSecret = String(options.emailHashSecret || env.ORDER_EMAIL_HASH_SECRET || "");
  if (!emailHashSecret) return jsonResponse({ error: "Native order preparation is temporarily unavailable." }, 503);

  const parsed = await parsePendingOrderRequest(request);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  let checkoutAttemptId;
  let email;
  try {
    checkoutAttemptId = normalizeCheckoutAttemptId(parsed.body.checkoutAttemptId);
    email = normalizeConfirmedCustomerEmail(parsed.body.email, parsed.body.emailConfirmation);
  } catch (error) {
    return jsonResponse({ error: safeMessage(error, "Valid order preparation details are required.") }, 400);
  }

  let catalogMap;
  try {
    ({ catalogMap } = await resolveHybridCartCatalog(
      database,
      parsed.body.items.map(item => item?.slug),
      options
    ));
  } catch (error) {
    console.error(JSON.stringify({ event: "native_order_catalog_resolution_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "Verified catalog pricing is temporarily unavailable." }, 503);
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const resolution = resolvePendingOrderItems(parsed.body.items, catalogMap, { now });
  if (resolution.unavailableItems.length || !resolution.items.length) {
    return jsonResponse({
      error: "One or more cart items cannot be prepared as a native order.",
      unavailableItems: resolution.unavailableItems
    }, 400);
  }
  const nativeItems = resolution.items.filter(item => item.catalogSource === "native-d1");
  if (!nativeItems.length) {
    return jsonResponse({
      code: "legacy_order_preparation_not_supported",
      error: "Legacy products must continue through the existing checkout path."
    }, 409);
  }
  if (nativeItems.length !== resolution.items.length) {
    return jsonResponse({
      code: "mixed_order_preparation_not_supported",
      error: "Legacy and native products cannot yet be prepared in the same order. No order was created."
    }, 409);
  }
  const incomplete = nativeItems.filter(item => !item.deliveryR2Key || !item.deliveryFilename || !item.deliveryContentType);
  if (incomplete.length) {
    return jsonResponse({
      error: "One or more native products does not have a complete private delivery snapshot.",
      unavailableItems: incomplete.map(item => ({
        code: "delivery_snapshot_incomplete", quantity: item.quantity, slug: item.productSlug
      }))
    }, 409);
  }

  const customerEmailHash = await createCustomerEmailHash(email.normalized, emailHashSecret);
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
      if (session?.user && String(session.user.email || session.user.email_normalized || "").toLowerCase() !== email.normalized) {
        const error = new Error("Use the verified email address on your signed-in account.");
        error.code = "account_email_mismatch";
        throw error;
      }
      await assertVerifiedPurchaseIdentity(database, { session, emailHash: customerEmailHash, nowMs: now });
      await assertNotFraudBlocked(database, { emailHash: customerEmailHash, userId: session?.user?.id || null });
      const duplicates = await findDuplicateDigitalOwnership(database, {
        emailHash: customerEmailHash,
        productSlugs: nativeItems.map(item => item.productSlug),
        userId: session?.user?.id || null
      });
      if (duplicates.length) {
        return jsonResponse({
          code: "digital_product_already_owned",
          error: "You already own one or more digital products in this cart.",
          ownedProductSlugs: duplicates
        }, 409);
      }
    } catch (error) {
      return jsonResponse({ error: safeMessage(error, "Purchase verification failed."), code: error?.code || "purchase_verification_failed" }, 403);
    }
  }

  const feePolicy = await getEffectiveFeePolicy(database, env, now);
  const snapshots = await Promise.all(nativeItems.map(async item => {
    const salePolicy = await resolveSalePolicy(database, {
      creatorId: item.nativeCreatorId,
      firstPublishedAt: item.firstPublishedAt,
      nowMs: now
    });
    return ({
    authorSlugsJson: JSON.stringify(catalogMap.get(item.productSlug)?.authorSlugs || []),
    catalogRevision: item.catalogRevision,
    createdAt: new Date(now).toISOString(),
    creatorFeeBasisPoints: salePolicy.basisPoints,
    creatorFeePolicyId: null,
    creatorFeePolicyReason: salePolicy.reason,
    creatorFeePolicyEffectiveAt: salePolicy.effectiveAt,
    creatorFirstPublishedAt: item.firstPublishedAt,
    creatorFixedFeeCents: 0,
    creatorReserveDays: feePolicy.reserveDays,
    currency: item.currency,
    creatorCommissionCategory: salePolicy.category,
    creatorCommissionPolicyVersion: salePolicy.policyVersion,
    deliveryContentType: item.deliveryContentType,
    deliveryFilename: item.deliveryFilename,
    deliveryR2Key: item.deliveryR2Key,
    effectiveUnitPriceCents: item.effectiveUnitPriceCents,
    lastUpdatedSnapshot: item.lastUpdatedSnapshot,
    lineTotalCents: item.lineTotalCents,
    listPriceCents: item.listPriceCents,
    minimumPriceCents: item.minimumPriceCents,
    nativeCreatorId: item.nativeCreatorId,
    nativeProductId: item.productId,
    pricingModel: item.pricingModel,
    primaryAuthorSlug: item.primaryAuthorSlug,
    productSlug: item.productSlug,
    productStatus: item.productStatus,
    productTitleSnapshot: item.productTitleSnapshot,
    publicationState: item.publicationState,
    quantity: item.quantity,
    suggestedPriceCents: item.suggestedPriceCents,
    versionSnapshot: item.versionSnapshot
    });
  }));
  const checkoutRequestHash = await createNativeOrderRequestHash({
    currency: resolution.currency,
    customerEmailNormalized: email.normalized,
    items: snapshots,
    subtotalCents: resolution.subtotalCents,
    totalCents: resolution.totalCents
  }, emailHashSecret);
  const createdAt = new Date(now).toISOString();
  let result;
  try {
    result = await createOrGetNativePendingOrder(database, {
      checkoutAttemptId,
      checkoutRequestHash,
      createdAt,
      currency: resolution.currency,
      customerEmail: email.entered,
      customerEmailHash,
      customerEmailNormalized: email.normalized,
      subtotalCents: resolution.subtotalCents,
      totalCents: resolution.totalCents,
      userId: session?.user?.id || null
    }, snapshots, options);
  } catch (error) {
    console.error(JSON.stringify({ event: "native_order_preparation_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "The native pending order could not be recorded right now." }, 500);
  }
  const order = result.order;
  if (order.catalog_source !== "native_d1" || order.checkout_request_hash !== checkoutRequestHash) {
    return jsonResponse({
      code: "checkout_attempt_conflict",
      error: "This checkout attempt identifier was already used for different order details. Start a new attempt.",
      retryable: false
    }, 409);
  }
  const storedItems = await getNativeOrderItemSnapshots(database, Number(order.id));
  if (!storedItems.length) return jsonResponse({ error: "The native order snapshot could not be confirmed." }, 500);
  const pricingPolicy = options.pricingPolicy || getRuntimePricingPolicy();
  return jsonResponse({
    checkoutAttemptId,
    createdAt: order.created_at,
    currency: order.currency,
    fulfillmentStatus: order.fulfillment_status,
    items: storedItems.map(publicItem),
    nativeOrderState: order.native_order_state,
    paymentActivation: false,
    paymentStatus: order.payment_status,
    pricingNote: String(pricingPolicy.pricingNote || ""),
    publicOrderReference: order.public_id,
    reusedCheckoutAttempt: result.created !== true,
    subtotalCents: Number(order.subtotal_cents),
    taxInclusive: pricingPolicy.taxInclusive === true,
    totalCents: Number(order.total_cents)
  }, result.created ? 201 : 200);
}

function publicItem(item) {
  return {
    catalogRevision: Number(item.catalog_revision),
    currency: item.currency,
    effectiveUnitPriceCents: Number(item.effective_unit_price_cents),
    lineTotalCents: Number(item.line_total_cents),
    pricingModel: item.pricing_model_snapshot,
    quantity: Number(item.quantity),
    regularPriceCents: Number(item.list_price_cents),
    slug: item.product_slug,
    title: item.product_title_snapshot
  };
}

async function optionalAccountSession(request, env, options) {
  try {
    const session = await getSessionFromRequest(request, env, options.accountSessionOptions || {});
    return session.valid ? session : null;
  } catch {
    return null;
  }
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    status
  });
}

function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
