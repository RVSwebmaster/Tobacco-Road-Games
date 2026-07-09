import pricingModule from "../../shared/pricing.js";
import { createCustomerEmailHash, normalizeConfirmedCustomerEmail } from "./order-privacy.mjs";
import { createPendingOrder } from "./orders-d1.mjs";
import {
  getRuntimeCatalogMap,
  getRuntimeCatalogProducts,
  getRuntimePricingPolicy,
  normalizeSlug
} from "./runtime-catalog.mjs";

const { validateCartPrice } = pricingModule;

const MAX_BODY_BYTES = 16384;
const MAX_ORDER_ITEMS = 25;

export async function onRequestPost(context) {
  return handlePendingOrderRequest(context.request, context.env);
}

export async function handlePendingOrderRequest(request, env = {}, options = {}) {
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "POST") {
    return jsonResponse({
      error: "Pending order creation only accepts POST requests."
    }, 405);
  }

  const database = options.database || env.TRG_ORDERS || null;
  if (!database) {
    return jsonResponse({
      error: "The TRG_ORDERS database binding is missing. Add it in Cloudflare before using this temporary order endpoint."
    }, 503);
  }

  const emailHashSecret = String(options.emailHashSecret || env.ORDER_EMAIL_HASH_SECRET || "");
  if (!emailHashSecret) {
    return jsonResponse({
      error: "ORDER_EMAIL_HASH_SECRET is missing. Add it in Cloudflare before using this temporary order endpoint."
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
      ? buildCatalogMap(catalogProducts)
      : getRuntimeCatalogMap();
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const pricingPolicy = options.pricingPolicy || getRuntimePricingPolicy();

  const resolution = resolvePendingOrderItems(parsed.body.items, catalogMap, { now });
  if (resolution.unavailableItems.length) {
    return jsonResponse({
      error: "One or more cart items are not available for pending order creation.",
      unavailableItems: resolution.unavailableItems
    }, 400);
  }
  if (!resolution.items.length) {
    return jsonResponse({
      error: "At least one valid cart item is required."
    }, 400);
  }
  if (!resolution.currency) {
    return jsonResponse({
      error: "Pending orders require a valid currency."
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

  return jsonResponse({
    createdAt: order.created_at,
    currency: order.currency,
    items: resolution.responseItems,
    paymentStatus: order.payment_status,
    pricingNote: String(pricingPolicy.pricingNote || ""),
    publicOrderReference: order.public_id,
    subtotalCents: order.subtotal_cents,
    taxInclusive: pricingPolicy.taxInclusive === true,
    totalCents: order.total_cents
  }, 201);
}

export async function parsePendingOrderRequest(request) {
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return {
      error: "The pending order request body could not be read.",
      ok: false,
      status: 400
    };
  }

  const bodyBytes = new TextEncoder().encode(rawBody).length;
  if (bodyBytes > MAX_BODY_BYTES) {
    return {
      error: "The pending order request is too large.",
      ok: false,
      status: 413
    };
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return {
      error: "The pending order request must be valid JSON.",
      ok: false,
      status: 400
    };
  }

  if (!body || typeof body !== "object" || !Array.isArray(body.items)) {
    return {
      error: "The pending order request must include an items array.",
      ok: false,
      status: 400
    };
  }

  if (body.items.length > MAX_ORDER_ITEMS) {
    return {
      error: `The pending order request may contain at most ${MAX_ORDER_ITEMS} items.`,
      ok: false,
      status: 400
    };
  }

  return {
    body,
    ok: true
  };
}

export function resolvePendingOrderItems(requestItems, catalogMap, options = {}) {
  const seen = new Set();
  const unavailableItems = [];
  const resolvedItems = [];
  let subtotalCents = 0;
  let currency = null;

  for (const entry of requestItems) {
    if (!entry || typeof entry !== "object") {
      unavailableItems.push(buildUnavailableItem("", "invalid_item", "Each item must be an object with a product slug."));
      continue;
    }

    const slug = normalizeSlug(entry.slug);
    if (!slug) {
      unavailableItems.push(buildUnavailableItem("", "missing_slug", "Each item must include a product slug."));
      continue;
    }

    if (entry.quantity !== 1) {
      unavailableItems.push(buildUnavailableItem(slug, "invalid_quantity", "Each direct digital product can appear only once per order."));
      continue;
    }

    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    const product = catalogMap.get(slug);
    if (!product) {
      unavailableItems.push(buildUnavailableItem(slug, "unknown_slug", "This item is not available for pending order creation."));
      continue;
    }
    if (product.status !== "available-direct") {
      unavailableItems.push(buildUnavailableItem(slug, "inactive_product", "This item is not currently available for direct purchase."));
      continue;
    }
    if (product.buyMode !== "cart") {
      unavailableItems.push(buildUnavailableItem(slug, "not_cart_mode", "This item is not enabled for cart checkout."));
      continue;
    }

    const priceCheck = validateCartPrice(product, { now: options.now });
    if (!priceCheck.valid) {
      unavailableItems.push(buildUnavailableItem(slug, "invalid_price", "This item cannot be priced right now."));
      continue;
    }

    if (currency && currency !== priceCheck.details.currency) {
      unavailableItems.push(buildUnavailableItem(slug, "currency_mismatch", "All pending order items must use the same currency."));
      continue;
    }
    currency = currency || priceCheck.details.currency;

    subtotalCents += priceCheck.details.effectivePriceCents;
    resolvedItems.push({
      authorDisplay: String(product.authorDisplay || "").trim(),
      createdAt: new Date(options.now || Date.now()).toISOString(),
      currency: priceCheck.details.currency,
      effectiveUnitPriceCents: priceCheck.details.effectivePriceCents,
      lastUpdatedSnapshot: String(product.lastUpdated || "").trim(),
      lineTotalCents: priceCheck.details.effectivePriceCents,
      listPriceCents: priceCheck.details.regularPriceCents,
      primaryAuthorSlug: Array.isArray(product.authorSlugs) && product.authorSlugs.length ? String(product.authorSlugs[0]) : "unknown",
      productSlug: product.slug,
      productTitleSnapshot: product.title,
      quantity: 1,
      saleActive: priceCheck.details.saleActive,
      title: product.title,
      versionSnapshot: String(product.version || "").trim()
    });
  }

  return {
    currency,
    itemSnapshots: resolvedItems.map((item) => ({
      authorSlugsJson: JSON.stringify(collectAuthorSlugs(catalogMap.get(item.productSlug))),
      createdAt: item.createdAt,
      currency: item.currency,
      effectiveUnitPriceCents: item.effectiveUnitPriceCents,
      lastUpdatedSnapshot: item.lastUpdatedSnapshot,
      lineTotalCents: item.lineTotalCents,
      listPriceCents: item.listPriceCents,
      primaryAuthorSlug: item.primaryAuthorSlug,
      productSlug: item.productSlug,
      productTitleSnapshot: item.productTitleSnapshot,
      quantity: item.quantity,
      versionSnapshot: item.versionSnapshot
    })),
    items: resolvedItems,
    responseItems: resolvedItems.map((item) => ({
      authorDisplay: item.authorDisplay,
      currency: item.currency,
      effectiveUnitPriceCents: item.effectiveUnitPriceCents,
      lineTotalCents: item.lineTotalCents,
      quantity: item.quantity,
      regularPriceCents: item.listPriceCents,
      saleActive: item.saleActive,
      slug: item.productSlug,
      title: item.title
    })),
    subtotalCents,
    totalCents: subtotalCents,
    unavailableItems
  };
}

function buildCatalogMap(products) {
  return new Map(products.map((product) => [normalizeSlug(product.slug), product]));
}

function collectAuthorSlugs(product) {
  return Array.isArray(product?.authorSlugs)
    ? product.authorSlugs.map((slug) => String(slug || "").trim()).filter(Boolean)
    : [];
}

function buildUnavailableItem(slug, code, message) {
  return {
    code,
    message,
    quantity: 1,
    slug
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}

function safeErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  return message || fallback;
}
