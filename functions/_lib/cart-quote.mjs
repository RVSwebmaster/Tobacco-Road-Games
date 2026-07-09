import pricingModule from "../../shared/pricing.js";
import {
  getRuntimeCatalogMap,
  getRuntimeCatalogProducts,
  getRuntimePricingPolicy,
  normalizeSlug
} from "./runtime-catalog.mjs";

const { validateCartPrice } = pricingModule;

const MAX_BODY_BYTES = 8192;
const MAX_CART_ITEMS = 25;

export async function onRequestPost(context) {
  return handleCartQuoteRequest(context.request);
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

  const catalogProducts = Array.isArray(options.catalogProducts) ? options.catalogProducts : getRuntimeCatalogProducts();
  const catalogMap = options.catalogMap instanceof Map
    ? options.catalogMap
    : Array.isArray(options.catalogProducts)
      ? buildCatalogMap(catalogProducts)
      : getRuntimeCatalogMap();
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const policy = options.pricingPolicy || getRuntimePricingPolicy();

  const quotedItems = [];
  const unavailableItems = [];
  let subtotalCents = 0;

  for (const item of parsed.items) {
    const product = catalogMap.get(item.slug);
    if (!product) {
      unavailableItems.push(buildUnavailableItem(item.slug, "unknown_slug", "This item is not available for checkout."));
      continue;
    }

    if (product.status !== "available-direct") {
      unavailableItems.push(buildUnavailableItem(item.slug, "inactive_product", "This item is not currently available for direct purchase."));
      continue;
    }

    if (product.buyMode !== "cart") {
      unavailableItems.push(buildUnavailableItem(item.slug, "not_cart_mode", "This item is not available through the cart yet."));
      continue;
    }

    const priceCheck = validateCartPrice(product, { now });
    if (!priceCheck.valid) {
      unavailableItems.push(buildUnavailableItem(item.slug, "invalid_price", "This item cannot be quoted right now."));
      continue;
    }

    const lineTotalCents = priceCheck.details.effectivePriceCents;
    subtotalCents += lineTotalCents;
    quotedItems.push({
      authorDisplay: String(product.authorDisplay || "").trim(),
      coverUrl: String(product.coverUrl || "").trim(),
      currency: priceCheck.details.currency,
      effectivePriceCents: priceCheck.details.effectivePriceCents,
      lineTotalCents,
      quantity: 1,
      regularPriceCents: priceCheck.details.regularPriceCents,
      saleActive: priceCheck.details.saleActive,
      slug: product.slug,
      title: product.title
    });
  }

  return jsonResponse({
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
    items.push({ quantity: 1, slug });
  }

  return {
    items,
    ok: true
  };
}

function buildCatalogMap(products) {
  return new Map(products.map((product) => [normalizeSlug(product.slug), product]));
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
