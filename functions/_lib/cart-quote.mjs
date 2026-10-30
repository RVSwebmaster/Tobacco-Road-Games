import pricingModule from "../../shared/pricing.js";
import { resolveHybridCartCatalog } from "./cart-catalog.mjs";
import {
  getRuntimePricingPolicy,
  normalizeSlug
} from "./runtime-catalog.mjs";

const { isPayWhatYouWantProduct, resolveCartPrice } = pricingModule;

const MAX_BODY_BYTES = 8192;
const MAX_CART_ITEMS = 25;

export async function onRequestPost(context) {
  return handleCartQuoteRequest(context.request, {
    allowedProductSlug: context.env?.STAGING_CHECKOUT_PRODUCT_SLUG,
    database: context.env?.TRG_ORDERS
  });
}

export async function handleCartQuoteRequest(request, options = {}) {
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "POST") {
    return jsonResponse({
      error: "Cart quote only accepts POST requests."
    }, 405);
  }

  const parsed = await parseQuoteRequest(request);
  if (!parsed.ok) {
    return jsonResponse({
      error: parsed.error
    }, parsed.status);
  }

  const allowedProductSlug = normalizeSlug(options.allowedProductSlug);
  let quoteCatalogMap;
  try {
    ({ catalogMap: quoteCatalogMap } = await resolveHybridCartCatalog(
      options.database,
      parsed.items.map(item => item.slug),
      { ...options, allowedProductSlug }
    ));
  } catch (error) {
    console.error(JSON.stringify({ event: "cart_catalog_resolution_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "Verified catalog pricing is temporarily unavailable." }, 503);
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const policy = options.pricingPolicy || getRuntimePricingPolicy();

  const quotedItems = [];
  const unavailableItems = [];
  let subtotalCents = 0;
  let hasLegacy = false;
  let hasNative = false;

  for (const item of parsed.items) {
    const product = quoteCatalogMap.get(item.slug);
    if (!product) {
      unavailableItems.push(buildUnavailableItem(item.slug, "unknown_slug", "This item is not available for checkout."));
      continue;
    }

    if (product.nativeAvailabilityCode) {
      const messages = {
        ineligible_creator: "This product's Creator is not currently eligible for marketplace sales.",
        paused_product: "This product is currently paused.",
        unpublished_product: "This product has not been published for sale."
      };
      unavailableItems.push(buildUnavailableItem(item.slug, product.nativeAvailabilityCode,
        messages[product.nativeAvailabilityCode] || "This product is not currently available for checkout."));
      continue;
    }

    if (!["available-direct", "pay-what-you-want", "free-download"].includes(product.status)) {
      unavailableItems.push(buildUnavailableItem(item.slug, "inactive_product", "This item is not currently available for direct purchase."));
      continue;
    }

    if (product.buyMode !== "cart" && !(product.buyMode==='free-download'&&Number(product.priceCents)===0)) {
      unavailableItems.push(buildUnavailableItem(item.slug, "not_cart_mode", "This item is not available through the cart yet."));
      continue;
    }

    if (options.database) {
      const held = await options.database.prepare("SELECT l.owner_review_hold FROM creator_listings l WHERE l.source_product_slug=? OR l.public_product_slug=? LIMIT 1").bind(item.slug, item.slug).first();
      const bundleHeld = await options.database.prepare("SELECT 1 FROM creator_bundles b JOIN creator_bundle_items bi ON bi.bundle_id=b.id JOIN creator_listings l ON l.id=bi.listing_id WHERE b.public_bundle_slug=? AND l.owner_review_hold=1 LIMIT 1").bind(item.slug).first();
      if (Number(held?.owner_review_hold) === 1 || bundleHeld) {
        unavailableItems.push(buildUnavailableItem(item.slug, "owner_review_hold", "This item is not currently available for checkout."));
        continue;
      }
    }

    const priceCheck = resolveCartPrice(product, item.amountCents, { now });
    if (!priceCheck.valid) {
      const minimum = Number(product.minimumPriceCents || 0);
      const message = priceCheck.reason === "pwyw_below_minimum"
        ? `Choose an amount of at least ${(minimum / 100).toFixed(2)} for this Pay What You Want product.`
        : isPayWhatYouWantProduct(product)
          ? "Choose a valid Pay What You Want amount in whole cents."
          : "This item cannot be quoted right now.";
      unavailableItems.push(buildUnavailableItem(item.slug, priceCheck.reason || "invalid_price", message));
      continue;
    }

    const lineTotalCents = priceCheck.details.effectivePriceCents;
    subtotalCents += lineTotalCents;
    if (product.catalogSource === "native-d1") hasNative = true;
    else hasLegacy = true;
    quotedItems.push({
      authorDisplay: String(product.authorDisplay || "").trim(),
      coverUrl: String(product.coverUrl || "").trim(),
      currency: priceCheck.details.currency,
      catalogRevision: Number.isInteger(product.catalogRevision) ? product.catalogRevision : null,
      catalogSource: product.catalogSource || "legacy",
      detailUrl: String(product.url || "").trim(),
      effectivePriceCents: priceCheck.details.effectivePriceCents,
      lineTotalCents,
      quantity: 1,
      regularPriceCents: priceCheck.details.regularPriceCents,
      pricingModel: isPayWhatYouWantProduct(product) ? "pwyw" : String(product.pricingModel || "fixed"),
      minimumPriceCents: priceCheck.details.minimumPriceCents ?? null,
      suggestedPriceCents: priceCheck.details.suggestedPriceCents ?? null,
      saleActive: priceCheck.details.saleActive,
      slug: product.slug,
      title: product.title
    });
  }

  const nativeFreeAcquisition = hasNative && !hasLegacy && quotedItems.length > 0
    && unavailableItems.length === 0 && subtotalCents === 0;
  const checkoutAllowed = !hasNative || nativeFreeAcquisition;
  return jsonResponse({
    checkoutAllowed,
    checkoutBlockReason: checkoutAllowed ? "" : "Paid native catalog checkout remains unavailable through the cart.",
    checkoutMode: nativeFreeAcquisition ? "native-free" : "legacy",
    includedTaxTotalCents: policy.includedTaxTotalCents ?? null,
    items: quotedItems,
    pricingNote: String(policy.pricingNote || ""),
    quotedAt: new Date(now).toISOString(),
    subtotalCents,
    taxInclusive: policy.taxInclusive === true,
    totalCents: subtotalCents,
    unavailableItems
  });
}

async function parseQuoteRequest(request) {
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return {
      error: "The quote request body could not be read.",
      ok: false,
      status: 400
    };
  }

  const bodyBytes = new TextEncoder().encode(rawBody).length;
  if (bodyBytes > MAX_BODY_BYTES) {
    return {
      error: "The quote request is too large.",
      ok: false,
      status: 413
    };
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody || "{}");
  } catch {
    return {
      error: "The quote request must be valid JSON.",
      ok: false,
      status: 400
    };
  }

  if (!parsedBody || typeof parsedBody !== "object" || !Array.isArray(parsedBody.items)) {
    return {
      error: "The quote request must include an items array.",
      ok: false,
      status: 400
    };
  }

  if (parsedBody.items.length > MAX_CART_ITEMS) {
    return {
      error: `The cart may contain at most ${MAX_CART_ITEMS} items per quote request.`,
      ok: false,
      status: 400
    };
  }

  const seen = new Set();
  const items = [];
  for (const entry of parsedBody.items) {
    if (!entry || typeof entry !== "object") {
      return {
        error: "Each cart item must be an object with a product slug.",
        ok: false,
        status: 400
      };
    }

    const slug = normalizeSlug(entry.slug);
    if (!slug) {
      return {
        error: "Each cart item must include a product slug.",
        ok: false,
        status: 400
      };
    }

    if (entry.quantity !== 1) {
      return {
        error: "Cart quantities must be exactly 1 for direct digital products.",
        ok: false,
        status: 400
      };
    }

    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    items.push({
      amountCents: Object.prototype.hasOwnProperty.call(entry, "amountCents") ? entry.amountCents : undefined,
      quantity: 1,
      slug
    });
  }

  return {
    items,
    ok: true
  };
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
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}
