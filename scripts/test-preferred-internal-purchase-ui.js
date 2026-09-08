const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const cartPage = read("store/cart/index.html");
  const cart = read("assets/js/creator-balance-checkout.js");
  const cartModel = read("assets/js/cart.js");
  const dashboardPage = read("creator/index.html");
  const dashboard = read("assets/js/creator-dashboard.js");
  const account = read("assets/js/account.js");
  const balanceRoute = read("functions/_lib/creator-balance-route.mjs");
  const preferredRoute = read("functions/_lib/creator-operations.mjs");
  const advertisingRoute = read("functions/_lib/creator-advertising-route.mjs");
  const registrationRoute = read("functions/_lib/creator-registration.mjs");
  const balanceSettlement = read("functions/_lib/creator-balance.mjs");
  const serviceSettlement = read("functions/_lib/creator-service-purchases.mjs");
  const policy = await load(
    "functions/_lib/creator-internal-purchase-policy.mjs",
  );

  // A-C: external checkout is always present; Balance requires both the
  // server-granted privilege and an entirely eligible digital cart.
  assert.match(cartPage, /data-cart-checkout-submit/);
  assert.match(cartPage, /data-creator-balance\s+hidden/);
  assert.match(cart, /capability\.canUseBalance/);
  assert.match(cart, /capability\.allProductsEligible/);
  assert.match(cart, /!currentCheckoutReady/);
  assert.match(cart, /button\.textContent = sufficient\s*\? `Use \$\{money\(currentTotalCents\)\} from Creator Balance`/);
  assert.match(cart, /The full \$\{money\(currentTotalCents\)\} is required/);
  assert.match(cart, /Balance and card payment cannot be combined/);
  assert.match(cart, /paymentSource: "creator_balance"/);
  assert.match(balanceRoute, /getCreatorInternalPurchasePrivilege/);
  assert.match(balanceRoute, /getEligibleCreatorProductListing/);
  assert.match(balanceRoute, /allProductsEligible/);
  assert.match(balanceRoute, /TRG_PRODUCTS\?\.head/);
  assert.match(cartModel, /trg:cart-rendered/);

  const listing = { id: "listing", creator_id: "seller" };
  const db = listingDb(listing);
  const digital = {
    slug: "digital-product",
    creatorId: "seller",
    mediaType: "digital",
    fulfillmentEligible: true,
  };
  const delivery = {
    r2ObjectKey: "creator/digital-product.pdf",
    customerFilename: "digital-product.pdf",
    contentType: "application/pdf",
  };
  assert.equal(
    await policy.getEligibleCreatorProductListing(db, {
      product: digital,
      deliveryMapping: delivery,
    }),
    listing,
  );
  for (const product of [
    { ...digital, mediaType: "physical" },
    { ...digital, mediaType: "hybrid" },
    { ...digital, outsideVendor: true },
    { ...digital, externalFulfillment: true },
  ])
    await assert.rejects(
      policy.getEligibleCreatorProductListing(db, {
        product,
        deliveryMapping: delivery,
      }),
      /internally fulfilled digital Creator products/,
    );

  // D-F: initial activation remains Stripe-only. Server-derived current-tier
  // capability controls monthly and annual renewal Balance presentation.
  assert.match(dashboardPage, /id="creator-preferred-monthly-stripe"/);
  assert.match(dashboardPage, /id="creator-preferred-annual-stripe"/);
  assert.equal(
    (dashboardPage.match(/data-preferred-balance-plan="[^"]+"\s+hidden/g) || [])
      .length,
    2,
  );
  assert.match(preferredRoute, /getPreferredBalancePaymentEligibility/);
  assert.match(preferredRoute, /monthlyEligible/);
  assert.match(preferredRoute, /annualRenewalEligible/);
  assert.match(dashboard, /currentPreferred = Boolean\(balancePrivilege\.preferred\)/);
  assert.match(dashboard, /Initial Preferred activation requires external payment/);
  assert.match(dashboard, /button\.hidden = !eligible/);
  assert.match(dashboard, /button\.disabled = !eligible \|\| preferred\.balance\.availableCents < required/);
  assert.match(dashboard, /Balance and card payment cannot be combined/);

  // G-H: Ad Credits and additional identities retain their external action,
  // while their Balance action is emitted only from a server capability.
  assert.match(dashboardPage, /id="creator-buy-ad-credits"/);
  assert.match(dashboardPage, /id="creator-buy-ad-credits-balance"\s+hidden/);
  assert.match(advertisingRoute, /getCreatorInternalPurchasePrivilege/);
  assert.match(advertisingRoute, /internalPurchase:\s*\{ canUseBalance/);
  assert.match(dashboard, /balanceButton\.hidden = !balanceAllowed/);
  assert.match(dashboard, /The full \$5\.00 is required/);
  assert.match(account, /actions\.append\(stripe\)/);
  assert.match(account, /if \(creator\.internalPurchase\?\.canUseBalance\)/);
  assert.match(account, /actions\.append\(balance\)/);
  assert.match(account, /Split tender is not offered/);
  assert.match(registrationRoute, /getCreatorInternalPurchasePrivilege/);
  assert.match(registrationRoute, /internalPurchase:\s*\{/);

  // I-J: stale decisions are revalidated after server rejection. The client
  // receives only a boolean capability and never exposes owner authorization.
  assert.match(cart, /await refresh\(\{[\s\S]*checkoutReady: currentCheckoutReady,[\s\S]*totalCents: currentTotalCents/);
  assert.match(dashboard, /catch \(error\) \{\s*output\.textContent = error\.message;\s*await load\(\)/);
  assert.match(account, /await refreshRegistrationPanels\(\);\s*creatorRegistrationStatus\.textContent = message/);
  for (const client of [cart, dashboard, account]) {
    assert.doesNotMatch(client, /owner\s*(override|exception)/i);
    assert.doesNotMatch(client, /creator-rv-sawyer/i);
  }

  // K: Stage 1 transaction paths remain authoritative and are not duplicated
  // in presentation code.
  assert.match(balanceSettlement, /assertCreatorInternalPurchasePrivilege/);
  assert.match(balanceSettlement, /assertDigitalCreatorProduct/);
  assert.match(serviceSettlement, /assertPreferredBalancePaymentEligibility/);
  assert.match(serviceSettlement, /assertCreatorInternalPurchasePrivilege/);
  assert.doesNotMatch(cart, /getCreatorTier|term_ends_at|creator-rv-sawyer/);
  assert.doesNotMatch(dashboard, /term_ends_at\s*[<>]=?|creator-rv-sawyer/);
  assert.doesNotMatch(account, /getCreatorTier|term_ends_at\s*[<>]=?|creator-rv-sawyer/);

  console.log("Preferred Creator internal purchasing UI tests passed.");
}

function listingDb(result) {
  return {
    prepare(sql) {
      assert.match(sql, /creator_listings/);
      return {
        bind(creatorId, sourceSlug, publicSlug) {
          assert.equal(creatorId, "seller");
          assert.equal(sourceSlug, "digital-product");
          assert.equal(publicSlug, "digital-product");
          return this;
        },
        async first() {
          return result;
        },
      };
    },
  };
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function load(file) {
  return import(pathToFileURL(path.join(ROOT, file)).href + `?${Math.random()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
