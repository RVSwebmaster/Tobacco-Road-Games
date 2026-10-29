import { PUBLICATION_UNAVAILABLE } from "./publication-unavailable.mjs";
import { jsonResponse, normalizeSlug } from "./owner-runtime.mjs";

export async function handleOwnerPricingPublishRequest(request, env, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({
      error: "Pricing updates only accept POST requests."
    }, 405);
  }

  try {
    const parsed = await parsePricingRequest(request);
    if (!parsed.valid) {
      return jsonResponse({
        error: parsed.userMessage
      }, 400);
    }

    return jsonResponse({ error: PUBLICATION_UNAVAILABLE }, 503);
  } catch (error) {
    logOwnerPricingPublishException(request, error);
    return jsonResponse({
      error: "Owner pricing publish could not be completed."
    }, 500);
  }
}

async function parsePricingRequest(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return {
      valid: false,
      userMessage: "Pricing updates must be valid JSON."
    };
  }

  const metadata = {
    currency: normalizeCurrency(payload?.currency),
    price: normalizeMoneyText(payload?.price),
    priceCents: normalizeInteger(payload?.priceCents),
    saleEnabled: Boolean(payload?.saleEnabled),
    saleEnd: normalizeDateText(payload?.saleEnd),
    saleLabel: String(payload?.saleLabel || "").trim(),
    salePrice: normalizeMoneyText(payload?.salePrice),
    salePriceCents: normalizeNullableInteger(payload?.salePriceCents),
    saleStart: normalizeDateText(payload?.saleStart),
    slug: normalizeSlug(payload?.slug)
  };

  const errors = [];
  if (!metadata.slug) {
    errors.push("Product slug is required.");
  }
  if (!metadata.price) {
    errors.push("Regular price is required.");
  }
  if (!metadata.currency) {
    errors.push("Currency is required.");
  }
  if (metadata.priceCents === null) {
    errors.push("Regular price cents are required.");
  }
  if (metadata.salePrice && metadata.salePriceCents === null) {
    errors.push("Sale price cents are required when a sale price is entered.");
  }
  if (!isMoneyLike(metadata.price)) {
    errors.push("Regular price must be a valid dollar amount.");
  }
  if (metadata.salePrice && !isMoneyLike(metadata.salePrice)) {
    errors.push("Sale price must be a valid dollar amount.");
  }
  if (metadata.price && metadata.priceCents !== deriveMoneyCents(metadata.price)) {
    errors.push("Regular price display and cents must match.");
  }
  if (metadata.salePrice && metadata.salePriceCents !== deriveMoneyCents(metadata.salePrice)) {
    errors.push("Sale price display and cents must match.");
  }
  if (errors.length) {
    return {
      valid: false,
      userMessage: errors.join(" ")
    };
  }

  return {
    valid: true,
    metadata,
    pricingConfirmation: {
      nonPurchasableSaleConfirmed: Boolean(payload?.nonPurchasableSaleConfirmed)
    }
  };
}

function normalizeCurrency(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function normalizeMoneyText(value) {
  return String(value || "")
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "");
}

function deriveMoneyCents(value) {
  const numeric = Number(normalizeMoneyText(value));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function normalizeInteger(value) {
  return Number.isInteger(value) ? value : null;
}

function normalizeNullableInteger(value) {
  return value === null || value === undefined || value === "" ? null : normalizeInteger(value);
}

function normalizeDateText(value) {
  return String(value || "").trim();
}

function isMoneyLike(value) {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value || ""));
}

function logOwnerPricingPublishException(request, error) {
  const payload = {
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
    event: "owner_pricing_publish_exception",
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get("cf-ray") || ""
  };

  console.error(JSON.stringify(payload));
}
