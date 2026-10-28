const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const TAX_NOTE = "The listed price is the final price. Any applicable sales tax is included.";

async function main() {
  const pricing = require(path.join(ROOT, "shared", "pricing.js"));
  const { buildRuntimeCatalog } = await importModule("scripts/build-runtime-catalog.mjs");
  const cartQuote = await importModule("functions/_lib/cart-quote.mjs");

  await testRuntimeCatalogGeneration(buildRuntimeCatalog);
  testPricingRules(pricing);
  await testQuoteEndpoint(cartQuote);
  testQuoteRouting();

  console.log("Cart quote tests passed.");
}

async function testRuntimeCatalogGeneration(buildRuntimeCatalog) {
  const tempRoot = createTempRepo([
    "data/products.json",
    "scripts/build-runtime-catalog.mjs",
    "shared/pricing.js"
  ]);
  const productsPath = path.join(tempRoot, "data", "products.json");
  const products = [
    {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      buyMode: "cart",
      coverImage: "/product-assets/agency/cover.webp",
      currency: "USD",
      libraryEligible: true,
      priceCents: 499,
      saleEnabled: true,
      saleEnd: "2027-12-31",
      salePriceCents: 399,
      saleStart: "2026-01-01",
      slug: "agency",
      status: "available-direct",
      title: "Agency",
      updateEligible: true,
      version: "2026.1"
    },
    {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      buyMode: "preview-only",
      coverImage: "/product-assets/preview/cover.webp",
      currency: "USD",
      libraryEligible: false,
      priceCents: null,
      saleEnabled: false,
      slug: "preview-only",
      status: "preview-available",
      title: "Preview Only",
      updateEligible: false,
      version: "test"
    },
    {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      buyMode: "cart",
      coverImage: "/product-assets/native-pwyw/cover.webp",
      currency: "USD",
      libraryEligible: true,
      minimumPriceCents: 0,
      priceCents: 1295,
      pricingModel: "pwyw",
      saleEnabled: false,
      slug: "native-pwyw",
      status: "pay-what-you-want",
      suggestedPriceCents: 1295,
      title: "Native PWYW",
      updateEligible: true,
      version: "1.0"
    }
  ];
  fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);

  const result = await buildRuntimeCatalog(tempRoot);
  assert.ok(fs.existsSync(result.outputPath), "Runtime catalog builds should write the generated module.");

  const generated = fs.readFileSync(result.outputPath, "utf8");
  assert.match(generated, /Generated from data\/products\.json/, "Runtime catalog modules should advertise their source of truth.");
  assert.match(generated, /Do not hand-edit this file\./, "Runtime catalog modules should be clearly marked generated.");

  const runtimeModule = await import(`${pathToFileURL(result.outputPath).href}?cacheBust=${Date.now()}`);
  assert.equal(runtimeModule.RUNTIME_PRICING_POLICY.taxInclusive, true, "Runtime catalog modules should export the tax-inclusive pricing policy.");
  assert.equal(runtimeModule.RUNTIME_PRICING_POLICY.pricingNote, TAX_NOTE, "Runtime catalog modules should carry the exact customer-facing pricing note.");

  const agency = runtimeModule.RUNTIME_CATALOG_PRODUCTS.find((product) => product.slug === "agency");
  assert.ok(agency, "Runtime catalog modules should include cart products.");
  assert.equal(agency.effectivePriceCents, 399, "Runtime catalog modules should precompute the effective sale price.");
  assert.equal(agency.authorDisplay, "RV Sawyer", "Runtime catalog modules should retain safe author display data.");
  assert.equal("shortDescription" in agency, false, "Runtime catalog modules should avoid becoming a second hand-edited marketing catalog.");
  const nativePwyw = runtimeModule.RUNTIME_CATALOG_PRODUCTS.find((product) => product.slug === "native-pwyw");
  assert.equal(nativePwyw.pricingModel, "pwyw", "Runtime catalogs should retain native PWYW pricing metadata.");
  assert.equal(nativePwyw.suggestedPriceCents, 1295, "Runtime catalogs should retain PWYW suggested prices in integer cents.");
  assert.equal(nativePwyw.minimumPriceCents, 0, "Runtime catalogs should retain a zero PWYW minimum.");
}

function testPricingRules(pricing) {
  const now = Date.parse("2026-07-09T12:00:00Z");

  const regular = pricing.getEffectivePriceDetails({
    currency: "USD",
    priceCents: 599,
    saleEnabled: false,
    salePriceCents: null
  }, { now });
  assert.equal(regular.effectivePriceCents, 599, "Regular prices should remain unchanged without an active sale.");

  const saleActive = pricing.getEffectivePriceDetails({
    currency: "USD",
    priceCents: 599,
    saleEnabled: true,
    saleEnd: "2026-07-31",
    salePriceCents: 399,
    saleStart: "2026-07-01"
  }, { now });
  assert.equal(saleActive.effectivePriceCents, 399, "Active sales should use the sale price.");
  assert.equal(saleActive.saleActive, true, "Active sales should be flagged.");

  const futureSale = pricing.getEffectivePriceDetails({
    currency: "USD",
    priceCents: 599,
    saleEnabled: true,
    saleEnd: "2026-08-31",
    salePriceCents: 399,
    saleStart: "2026-08-01"
  }, { now });
  assert.equal(futureSale.effectivePriceCents, 599, "Future sales should not apply early.");
  assert.equal(futureSale.saleActive, false, "Future sales should remain inactive.");

  const expiredSale = pricing.getEffectivePriceDetails({
    currency: "USD",
    priceCents: 599,
    saleEnabled: true,
    saleEnd: "2026-06-30",
    salePriceCents: 399,
    saleStart: "2026-06-01"
  }, { now });
  assert.equal(expiredSale.effectivePriceCents, 599, "Expired sales should fall back to the regular price.");
  assert.equal(expiredSale.saleActive, false, "Expired sales should remain inactive.");

  const invalid = pricing.validateCartPrice({
    currency: "USD",
    priceCents: 0,
    saleEnabled: false
  }, { now });
  assert.equal(invalid.valid, false, "Missing, zero, or negative cart prices should be rejected.");

  const pwyw = {
    buyMode: "cart",
    currency: "USD",
    minimumPriceCents: 250,
    priceCents: 1295,
    pricingModel: "pwyw",
    status: "pay-what-you-want",
    suggestedPriceCents: 1295
  };
  assert.equal(pricing.resolveCartPrice(pwyw, 1295).details.effectivePriceCents, 1295, "PWYW should accept the suggested amount as integer cents.");
  assert.equal(pricing.resolveCartPrice(pwyw, 250).details.effectivePriceCents, 250, "PWYW should accept its exact configured minimum.");
  assert.equal(pricing.resolveCartPrice(pwyw, 249).reason, "pwyw_below_minimum", "PWYW should reject one cent below its minimum.");
  assert.equal(pricing.resolveCartPrice(pwyw, "12.95").reason, "invalid_pwyw_amount", "The server must reject client amount strings instead of reparsing ambiguous money.");
  assert.equal(pricing.resolveCartPrice({ ...pwyw, minimumPriceCents: 0 }, 0).details.effectivePriceCents, 0, "A zero-minimum PWYW product should permit a zero-dollar acquisition.");
}

async function testQuoteEndpoint(cartQuote) {
  const now = Date.parse("2026-07-09T12:00:00Z");
  const catalogProducts = [
    {
      authorDisplay: "RV Sawyer",
      buyMode: "cart",
      coverUrl: "/product-assets/agency/cover.webp",
      currency: "USD",
      priceCents: 500,
      saleEnabled: true,
      saleEnd: "2026-07-31",
      salePriceCents: 400,
      saleStart: "2026-07-01",
      slug: "agency",
      status: "available-direct",
      title: "Agency"
    },
    {
      authorDisplay: "RV Sawyer",
      buyMode: "fixed-price",
      coverUrl: "/product-assets/fixed/cover.webp",
      currency: "USD",
      priceCents: 299,
      saleEnabled: false,
      salePriceCents: null,
      slug: "fixed-mode",
      status: "available-direct",
      title: "Fixed Mode"
    },
    {
      authorDisplay: "RV Sawyer",
      buyMode: "cart",
      coverUrl: "/product-assets/coming/cover.webp",
      currency: "USD",
      priceCents: 299,
      saleEnabled: false,
      salePriceCents: null,
      slug: "coming-soon",
      status: "coming-soon",
      title: "Coming Soon"
    },
    {
      authorDisplay: "RV Sawyer",
      buyMode: "cart",
      coverUrl: "/product-assets/bad/cover.webp",
      currency: "USD",
      priceCents: 0,
      saleEnabled: false,
      salePriceCents: null,
      slug: "bad-price",
      status: "available-direct",
      title: "Bad Price"
    }
  ];

  const successResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({
      items: [
        { quantity: 1, slug: "agency" },
        { quantity: 1, slug: "agency" },
        { quantity: 1, slug: "unknown" },
        { quantity: 1, slug: "coming-soon" },
        { quantity: 1, slug: "fixed-mode" },
        { quantity: 1, slug: "bad-price" }
      ]
    }),
    method: "POST"
  }), {
    catalogProducts,
    now
  });
  assert.equal(successResponse.status, 200, "Quote requests should succeed when the request itself is valid.");
  const successPayload = await successResponse.json();
  assert.equal(successPayload.items.length, 1, "Duplicate slugs should normalize to one quoted item.");
  assert.equal(successPayload.items[0].effectivePriceCents, 400, "Quoted items should use the effective sale price.");
  assert.equal(successPayload.items[0].lineTotalCents, 400, "Line totals should remain integer cents.");
  assert.equal(successPayload.subtotalCents, 400, "Subtotal should remain integer cents.");
  assert.equal(successPayload.totalCents, 400, "Total should remain integer cents.");
  assert.equal(successPayload.taxInclusive, true, "Quotes should be explicitly tax-inclusive.");
  assert.equal(successPayload.includedTaxTotalCents, null, "Quotes should reserve included-tax reporting for later phases.");
  assert.equal(successPayload.pricingNote, TAX_NOTE, "Quotes should include the exact customer-facing pricing note.");
  assert.equal(successPayload.unavailableItems.length, 4, "Unknown, inactive, non-cart, and invalid-price products should be reported as unavailable.");
  assert.deepEqual(successPayload.unavailableItems.map((item) => item.code), [
    "unknown_slug",
    "inactive_product",
    "not_cart_mode",
    "invalid_price"
  ], "Unavailable items should distinguish each rejection reason.");
  assert.match(successPayload.quotedAt, /^\d{4}-\d{2}-\d{2}T/, "Quotes should include a generation timestamp.");

  const nativePwyw = {
    authorDisplay: "RV Sawyer",
    buyMode: "cart",
    coverUrl: "/product-assets/native-pwyw/cover.webp",
    currency: "USD",
    minimumPriceCents: 250,
    priceCents: 1295,
    pricingModel: "pwyw",
    slug: "native-pwyw",
    status: "pay-what-you-want",
    suggestedPriceCents: 1295,
    title: "Native PWYW"
  };
  const pwywResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({ items: [
      { amountCents: 875, quantity: 1, slug: "native-pwyw" },
      { quantity: 1, slug: "agency" }
    ] }),
    method: "POST"
  }), { catalogProducts: [...catalogProducts, nativePwyw], now });
  const pwywPayload = await pwywResponse.json();
  assert.equal(pwywResponse.status, 200, "Mixed fixed-price and PWYW carts should quote normally.");
  assert.equal(pwywPayload.items.find((item) => item.slug === "native-pwyw").effectivePriceCents, 875, "Quotes must preserve the customer's accepted PWYW amount.");
  assert.equal(pwywPayload.totalCents, 1275, "Mixed-cart totals must use the chosen PWYW amount and the server-authoritative fixed price.");

  const belowMinimumResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({ items: [{ amountCents: 249, quantity: 1, slug: "native-pwyw" }] }),
    method: "POST"
  }), { catalogProducts: [...catalogProducts, nativePwyw], now });
  const belowMinimumPayload = await belowMinimumResponse.json();
  assert.equal(belowMinimumPayload.items.length, 0, "A below-minimum PWYW item must not enter the quoted cart.");
  assert.equal(belowMinimumPayload.unavailableItems[0].code, "pwyw_below_minimum", "The quote API should expose the precise minimum failure.");

  const malformedResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: "{not-json",
    method: "POST"
  }), { catalogProducts, now });
  assert.equal(malformedResponse.status, 400, "Malformed JSON should be rejected.");

  const quantityResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({
      items: [
        { quantity: 2, slug: "agency" }
      ]
    }),
    method: "POST"
  }), { catalogProducts, now });
  assert.equal(quantityResponse.status, 400, "Quantities greater than one should be rejected.");

  const stagingRestrictionResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({
      items: [
        { quantity: 1, slug: "agency" },
        { quantity: 1, slug: "fixed-mode" }
      ]
    }),
    method: "POST"
  }), {
    allowedProductSlug: "agency",
    catalogProducts: catalogProducts.map((product) => product.slug === "fixed-mode"
      ? { ...product, buyMode: "cart" }
      : product),
    now
  });
  const stagingRestrictionPayload = await stagingRestrictionResponse.json();
  assert.deepEqual(
    stagingRestrictionPayload.items.map((item) => item.slug),
    ["agency"],
    "Staging quotes should allow Agency as the sole pipeline test product."
  );
  assert.deepEqual(
    stagingRestrictionPayload.unavailableItems.map((item) => item.slug),
    ["fixed-mode"],
    "Staging quotes should reject otherwise purchasable products outside the Agency gate."
  );

  const oversizedItems = Array.from({ length: 26 }, (_, index) => ({
    quantity: 1,
    slug: `item-${index}`
  }));
  const excessiveResponse = await cartQuote.handleCartQuoteRequest(new Request("https://example.com/api/cart/quote", {
    body: JSON.stringify({ items: oversizedItems }),
    method: "POST"
  }), { catalogProducts, now });
  assert.equal(excessiveResponse.status, 400, "Excessive cart sizes should be rejected.");
}

function testQuoteRouting() {
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/cart/quote"), "Cloudflare routing should include the cart quote endpoint.");
  assert.ok(routes.include.includes("/owner/*"), "Cloudflare routing should preserve owner routes.");
  assert.ok(routes.include.includes("/product-assets/*"), "Cloudflare routing should preserve product asset routes.");
}

function createTempRepo(relativePaths) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trg-cart-quote-"));
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(ROOT, relativePath);
    const destinationPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return tempRoot;
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
