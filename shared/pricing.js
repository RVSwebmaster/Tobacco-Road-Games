const TAX_INCLUSIVE_PRICING_NOTE = "The listed price is the final price. Any applicable sales tax is included.";
const TAX_INCLUSIVE_PRICING_POLICY = Object.freeze({
  includedTaxTotalCents: null,
  pricingNote: TAX_INCLUSIVE_PRICING_NOTE,
  taxInclusive: true
});

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
  if (end && now > end + 86400000 - 1) {
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

module.exports = {
  TAX_INCLUSIVE_PRICING_NOTE,
  TAX_INCLUSIVE_PRICING_POLICY,
  getEffectivePriceDetails,
  isSaleActive,
  validateCartPrice
};
