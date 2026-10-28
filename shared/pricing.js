const TAX_INCLUSIVE_PRICING_NOTE = "The listed price is the final price. Any applicable sales tax is included.";
const TAX_INCLUSIVE_PRICING_POLICY = Object.freeze({
  includedTaxTotalCents: null,
  pricingNote: TAX_INCLUSIVE_PRICING_NOTE,
  taxInclusive: true
});

const MAX_PWYW_AMOUNT_CENTS = 100000000;

function normalizePositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseDate(value) {
  if (!value) {
    return 0;
  }
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? 0 : stamp;
}

function isSaleActive(product, options = {}) {
  const salePriceCents = normalizePositiveInteger(product?.salePriceCents);
  if (!product?.saleEnabled || salePriceCents === null) {
    return false;
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const start = parseDate(product?.saleStart);
  const end = parseDate(product?.saleEnd);

  if (start && now < start) {
    return false;
  }
  const endBoundary = /^\d{4}-\d{2}-\d{2}$/.test(String(product?.saleEnd || "").trim()) ? end + 86400000 - 1 : end;
  if (endBoundary && now > endBoundary) {
    return false;
  }

  return true;
}

function getEffectivePriceDetails(product, options = {}) {
  const regularPriceCents = normalizePositiveInteger(product?.priceCents);
  const salePriceCents = normalizePositiveInteger(product?.salePriceCents);
  const currency = String(product?.currency || "USD").trim() || "USD";
  const saleActive = regularPriceCents !== null && salePriceCents !== null && isSaleActive(product, options);
  const effectivePriceCents = saleActive ? salePriceCents : regularPriceCents;

  return {
    currency,
    effectivePriceCents,
    regularPriceCents,
    saleActive,
    salePriceCents,
    valid: effectivePriceCents !== null
  };
}

function validateCartPrice(product, options = {}) {
  const details = getEffectivePriceDetails(product, options);
  if (!details.valid) {
    return {
      details,
      reason: "invalid_price",
      valid: false
    };
  }

  return {
    details,
    valid: true
  };
}

function isPayWhatYouWantProduct(product) {
  return product?.pricingModel === "pwyw"
    || product?.status === "pay-what-you-want"
    || product?.buyMode === "pay-what-you-want";
}

function resolvePayWhatYouWantPrice(product, amountCents) {
  const minimumPriceCents = Number.isInteger(product?.minimumPriceCents)
    ? product.minimumPriceCents
    : 0;
  const suggestedPriceCents = Number.isInteger(product?.suggestedPriceCents)
    ? product.suggestedPriceCents
    : Number.isInteger(product?.priceCents)
      ? product.priceCents
      : minimumPriceCents;
  const currency = String(product?.currency || "USD").trim().toUpperCase() || "USD";

  if (!Number.isInteger(minimumPriceCents) || minimumPriceCents < 0) {
    return { reason: "invalid_pwyw_minimum", valid: false };
  }
  if (!Number.isInteger(suggestedPriceCents) || suggestedPriceCents < minimumPriceCents) {
    return { reason: "invalid_pwyw_suggested", valid: false };
  }
  if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > MAX_PWYW_AMOUNT_CENTS) {
    return { reason: "invalid_pwyw_amount", valid: false };
  }
  if (amountCents < minimumPriceCents) {
    return { reason: "pwyw_below_minimum", valid: false };
  }

  return {
    details: {
      currency,
      effectivePriceCents: amountCents,
      minimumPriceCents,
      regularPriceCents: suggestedPriceCents,
      saleActive: false,
      suggestedPriceCents
    },
    valid: true
  };
}

function resolveCartPrice(product, requestedAmountCents, options = {}) {
  if (isPayWhatYouWantProduct(product)) {
    return resolvePayWhatYouWantPrice(product, requestedAmountCents);
  }
  if (product?.pricingModel === "free" || (product?.buyMode === "free-download" && Number(product?.priceCents) === 0)) {
    return {
      details: {
        currency: String(product?.currency || "USD").trim().toUpperCase() || "USD",
        effectivePriceCents: 0,
        regularPriceCents: 0,
        saleActive: false
      },
      valid: true
    };
  }
  return validateCartPrice(product, options);
}

module.exports = {
  TAX_INCLUSIVE_PRICING_NOTE,
  TAX_INCLUSIVE_PRICING_POLICY,
  getEffectivePriceDetails,
  isPayWhatYouWantProduct,
  isSaleActive,
  resolveCartPrice,
  resolvePayWhatYouWantPrice,
  validateCartPrice
};
