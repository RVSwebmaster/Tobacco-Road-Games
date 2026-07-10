import { dispatchPublishWorkflow } from "./github-dispatch.mjs";
import { jsonResponse, normalizeSlug } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";

export async function handleOwnerPricingPublishRequest(request, env, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({
      error: "Pricing updates only accept POST requests."
    }, 405);
  }

  const authState = await verifyAuthenticatedOwnerMutationRequest(request, env, {
    csrfExpiredMessage: "The pricing editor security token has expired. Reload the page and try again.",
    csrfMismatchMessage: "The pricing editor security token did not match. Reload the page and try again.",
    missingCsrfSecretMessage: "Owner pricing is missing OWNER_CSRF_SECRET in Cloudflare.",
    sameOriginMessage: "Pricing updates must come from the Tobacco Road Games owner site."
  });
  if (!authState.valid) {
    return jsonResponse({
      error: authState.userMessage
    }, authState.status);
  }

  const parsed = await parsePricingRequest(request);
  if (!parsed.valid) {
    return jsonResponse({
      error: parsed.userMessage
    }, 400);
  }

  const dispatchPayload = {
    metadata: parsed.metadata,
    operation: "pricing_update",
    pricingConfirmation: parsed.pricingConfirmation,
    publish_id: `price-${Date.now()}-${crypto.randomUUID()}`,
    ref: String(env.GITHUB_PUBLISH_REF || "main"),
    requested_by: authState.username
  };

  const dispatchResult = await dispatchPublishWorkflow(dispatchPayload, env, options.dispatchOptions);
  if (!dispatchResult.ok) {
    return jsonResponse({
      error: `The pricing update could not be published. ${dispatchResult.userMessage}`,
      runUrl: dispatchResult.runUrl || ""
    }, dispatchResult.reason === "workflow_timeout" ? 504 : 502);
  }

  return jsonResponse({
    message: "Pricing update published successfully.",
    ok: true,
    runUrl: dispatchResult.runUrl || ""
  });
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
