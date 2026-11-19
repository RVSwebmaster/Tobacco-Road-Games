const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATHS = [
  path.join(ROOT, "migrations", "001_direct_storefront.sql"),
  path.join(ROOT, "migrations", "003_checkout_attempt_idempotency.sql"),
  path.join(ROOT, "migrations", "004_verified_stripe_webhooks.sql"),
  path.join(ROOT, "migrations", "005_secure_download_entitlements.sql"),
  path.join(ROOT, "migrations", "015_store_state.sql"),
  path.join(ROOT, "migrations", "007_shared_accounts.sql"),
  path.join(ROOT, "migrations", "016_order_account_ownership.sql")
];
const TAX_NOTE = "The listed price is the final price. Any applicable sales tax is included.";

async function main() {
  const cartCheckout = await importModule("functions/_lib/cart-checkout.mjs");
  const completePage = await importModule("functions/_lib/checkout-pages.mjs");
  const cookieHelpers = await importModule("functions/_lib/checkout-cookie.mjs");
  const pendingRoute = await importModule("functions/_lib/orders-pending-route.mjs");

  await testCheckoutEndpoint(cartCheckout, cookieHelpers);
  await testNativePwywCheckout(cartCheckout);
  await testCheckoutValidation(cartCheckout);
  await testCheckoutAccessCookie(cookieHelpers);
  await testCheckoutReturnPages(completePage, cookieHelpers);
  await testPendingRouteDisabled(pendingRoute);

  console.log("Cart checkout tests passed.");
}

async function testCheckoutEndpoint(cartCheckout, cookieHelpers) {
  const { d1 } = createD1Database();
  const catalogProducts = [
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "cart",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: true,
      saleEnd: "2026-07-31",
      salePriceCents: 400,
      saleStart: "2026-07-01",
      slug: "agency",
      status: "available-direct",
      title: "Agency",
      version: "2026.1"
    }
  ];

  let stripeCalled = false;
  const stripeFetchImpl = async (url, options = {}) => {
    stripeCalled = true;
    throw new Error("Retired legacy paid checkout must never call Stripe.");
  };

  const response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000001",
      email: " Buyer@Example.com ",
      emailConfirmation: "buyer@example.com",
      items: [
        { priceCents: 1, quantity: 1, slug: "agency" }
      ]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: d1
  }, {
    catalogProducts,
    now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl
  });

  assert.equal(response.status, 410, "A legacy catalog fixture cannot initiate a new paid purchase.");
  const payload = await response.json();
  assert.equal(payload.code, "legacy_paid_checkout_retired");
  assert.equal(stripeCalled, false);
  assert.equal(await countRows(d1, "orders"), 0, "Retired paid checkout must not create a pending legacy order.");
  assert.equal(await countRows(d1, "order_items"), 0, "Retired paid checkout must not create legacy order items.");

  const inFlightDb = createD1Database().d1;
  const { resolvePendingOrderItems } = await importModule("functions/_lib/orders-pending.mjs");
  const { createCheckoutRequestHash } = await importModule("functions/_lib/checkout-attempt.mjs");
  const orders = await importModule("functions/_lib/orders-d1.mjs");
  const resolution = resolvePendingOrderItems([{ quantity: 1, slug: "agency" }], new Map([["agency", catalogProducts[0]]]), {
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  const attempt = "trgca_00000000-0000-4000-8000-000000000099";
  const hash = await createCheckoutRequestHash({ currency: "USD", customerEmailNormalized: "buyer@example.com",
    items: resolution.itemSnapshots, subtotalCents: resolution.subtotalCents, totalCents: resolution.totalCents }, "email-secret");
  const createdAt = "2026-07-09T12:00:00.000Z";
  const oldOrder = await orders.createPendingOrder(inFlightDb, { checkoutAttemptId: attempt,
    checkoutRequestHash: hash, checkoutSessionStatus: "active", checkoutUpdatedAt: createdAt,
    createdAt, currency: "USD", customerEmail: "buyer@example.com", customerEmailHash: "historical-hash",
    customerEmailNormalized: "buyer@example.com", emailStatus: "pending", fulfillmentStatus: "pending",
    paymentStatus: "pending", subtotalCents: resolution.subtotalCents, totalCents: resolution.totalCents,
    stripeCheckoutSessionId: "cs_test_historical_legacy", stripeCheckoutSessionUrl: "https://checkout.stripe.test/existing" }, resolution.itemSnapshots);
  let resumedStripeCalls = 0;
  const resumed = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    method: "POST", body: JSON.stringify({ checkoutAttemptId: attempt, email: "buyer@example.com",
      emailConfirmation: "buyer@example.com", items: [{ quantity: 1, slug: "agency" }] })
  }), { CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret", ORDER_EMAIL_HASH_SECRET: "email-secret", TRG_ORDERS: inFlightDb }, {
    catalogProducts, now: Date.parse("2026-07-09T12:05:00.000Z"),
    stripeFetchImpl: async () => { resumedStripeCalls += 1; throw new Error("An existing Session must be resumed, not recreated."); }
  });
  assert.equal(resumed.status, 200, "A previously initiated legacy Session remains resumable.");
  assert.equal((await resumed.json()).checkoutUrl, "https://checkout.stripe.test/existing");
  assert.equal(resumedStripeCalls, 0);
  assert.equal(await countRows(inFlightDb, "orders"), 1, "Session recovery does not create another order.");
  assert.equal(oldOrder.checkout_session_status, "active");
}

async function testCheckoutValidation(cartCheckout) {
  const validCatalog = [{ authorDisplay: "RV Sawyer", authorSlugs: ["rv-sawyer"], buyMode: "cart", currency: "USD",
    lastUpdated: "2026-07-01", priceCents: 500, saleEnabled: false, salePriceCents: null, slug: "agency",
    status: "available-direct", title: "Agency", version: "2026.1" }];
  const env = () => ({ CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret", ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked", TRG_ORDERS: createD1Database().d1 });
  const request = (attempt, emailConfirmation, slug = "agency") => new Request("https://example.com/api/cart/checkout", {
    method: "POST", body: JSON.stringify({ checkoutAttemptId: `trgca_00000000-0000-4000-8000-${attempt}`,
      email: "buyer@example.com", emailConfirmation, items: [{ quantity: 1, slug }] }) });
  let response = await cartCheckout.handleCartCheckoutRequest(request("000000000002", "different@example.com"), env(), { catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z"), stripeFetchImpl: async () => { throw new Error("Stripe should not be called."); } });
  assert.equal(response.status, 400, "Checkout should reject mismatched email confirmation.");
  response = await cartCheckout.handleCartCheckoutRequest(request("000000000003", "buyer@example.com", "unknown"), env(), {
    catalogProducts: validCatalog, now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl: async () => { throw new Error("Stripe should not be called."); } });
  assert.equal(response.status, 400, "Checkout should reject unknown products before deciding the payment route.");
  const stagingDb = createD1Database().d1;
  response = await cartCheckout.handleCartCheckoutRequest(request("000000000004", "buyer@example.com", "janni"), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret", ORDER_EMAIL_HASH_SECRET: "email-secret", STAGING_CHECKOUT_PRODUCT_SLUG: "agency",
    STRIPE_SECRET_KEY: "sk_test_mocked", TRG_ORDERS: stagingDb }, {
      catalogProducts: [...validCatalog, { ...validCatalog[0], slug: "janni", title: "Janni" }], now: Date.parse("2026-07-09T12:00:00.000Z"),
      stripeFetchImpl: async () => { throw new Error("Stripe should not be called."); } });
  assert.equal(response.status, 400, "Staging checkout should reject products outside the Agency-only gate.");
  assert.equal(await countRows(stagingDb, "orders"), 0);
}
async function testNativePwywCheckout(cartCheckout) {
  const now = Date.parse("2026-07-09T12:00:00.000Z");
  const product = {
    authorDisplay: "RV Sawyer",
    authorSlugs: ["rv-sawyer"],
    buyMode: "cart",
    currency: "USD",
    lastUpdated: "2026-07-01",
    minimumPriceCents: 0,
    priceCents: 1295,
    pricingModel: "pwyw",
    slug: "native-pwyw",
    status: "pay-what-you-want",
    suggestedPriceCents: 1295,
    title: "Native PWYW",
    version: "1.0"
  };
  const paidDatabase = createD1Database().d1;
  let paidStripeAmount = null;
  const paidResponse = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000001295",
      email: "buyer@example.com",
      emailConfirmation: "buyer@example.com",
      items: [{ amountCents: 875, quantity: 1, slug: "native-pwyw" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: paidDatabase
  }, {
    catalogProducts: [product],
    now,
    stripeFetchImpl: async (url, options = {}) => {
      const body = new URLSearchParams(String(options.body || ""));
      paidStripeAmount = body.get("line_items[0][price_data][unit_amount]");
      return createJsonResponse({
        id: "cs_test_native_pwyw",
        livemode: false,
        ui_mode: "hosted_page",
        url: "https://checkout.stripe.com/c/pay/cs_test_native_pwyw"
      });
    }
  });
  const paidPayload = await paidResponse.json();
  assert.equal(paidResponse.status, 410, "A paid legacy PWYW fixture cannot initiate checkout through the retired route.");
  assert.equal(paidPayload.code, "legacy_paid_checkout_retired");
  assert.equal(paidStripeAmount, null, "Retired legacy checkout must not send a customer-selected amount to Stripe.");
  assert.equal(await countRows(paidDatabase, "orders"), 0);

  const freeDatabase = createD1Database().d1;
  let freeStripeCalls = 0;
  const freeResponse = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000000",
      email: "free@example.com",
      emailConfirmation: "free@example.com",
      items: [{ amountCents: 0, quantity: 1, slug: "native-pwyw" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: freeDatabase,
    TRG_PRODUCTS: {
      async head(key) {
        return key === "native-pwyw/product.pdf" ? { size: 4096 } : null;
      }
    }
  }, {
    catalogProducts: [product],
    deliveryProducts: {
      "native-pwyw": {
        contentType: "application/pdf",
        customerFilename: "Native PWYW.pdf",
        productSlug: "native-pwyw",
        r2ObjectKey: "native-pwyw/product.pdf"
      }
    },
    now,
    stripeFetchImpl: async () => {
      freeStripeCalls += 1;
      throw new Error("Stripe must not be called for a zero-dollar PWYW acquisition.");
    }
  });
  const freePayload = await freeResponse.json();
  assert.equal(freeResponse.status, 201, "A zero-minimum PWYW selection should complete through secure fulfillment.");
  assert.equal(freePayload.acquisitionComplete, true, "Zero-dollar PWYW should report acquisition completion without a payment session.");
  assert.equal(freePayload.paymentProvider, "none", "Zero-dollar PWYW should explicitly avoid a payment provider.");
  assert.equal(freeStripeCalls, 0, "Zero-dollar PWYW must never create an invalid Stripe charge.");
  const freeOrder = await findSingleRow(freeDatabase, "SELECT * FROM orders");
  assert.equal(freeOrder.payment_status, "paid", "Zero-dollar PWYW should record the completed acquisition for fulfillment and receipts.");
  assert.equal(freeOrder.total_cents, 0, "Zero-dollar PWYW should conserve the selected zero-cent total.");
  assert.equal(await countRows(freeDatabase, "download_entitlements"), 1, "Zero-dollar PWYW should create the same secure entitlement as a completed paid order.");
}

async function testCheckoutAccessCookie(cookieHelpers) {
  const secret = "cookie-secret";
  const nowMs = Date.parse("2026-07-09T12:00:00.000Z");
  const basePayload = {
    createdAt: "2026-07-09T11:00:00.000Z",
    publicOrderReference: "TRG-COOKIE123456-1234ABCD",
    stripeCheckoutSessionId: "cs_test_cookie"
  };

  const validCookie = await cookieHelpers.createCheckoutAccessCookie(basePayload, secret);
  const validRequest = new Request("https://example.com/store/checkout/complete", {
    headers: {
      cookie: validCookie
    }
  });
  const parsed = await cookieHelpers.readCheckoutAccessCookie(validRequest, secret, { nowMs });
  assert.deepEqual(parsed, basePayload, "Valid unexpired checkout cookies should round-trip.");
  assert.equal(cookieHelpers.CHECKOUT_ACCESS_COOKIE_MAX_AGE_SECONDS, 7200, "Checkout cookies should use the shared two-hour lifetime.");

  const expiredCookie = await cookieHelpers.createCheckoutAccessCookie({
    ...basePayload,
    createdAt: "2026-07-09T09:59:59.000Z"
  }, secret);
  const expired = await cookieHelpers.readCheckoutAccessCookie(new Request("https://example.com/store/checkout/complete", {
    headers: {
      cookie: expiredCookie
    }
  }), secret, { nowMs });
  assert.equal(expired, null, "Expired checkout cookies should be rejected server-side.");

  const malformedTimestampCookie = await cookieHelpers.createCheckoutAccessCookie({
    ...basePayload,
    createdAt: "not-a-timestamp"
  }, secret);
  const malformed = await cookieHelpers.readCheckoutAccessCookie(new Request("https://example.com/store/checkout/complete", {
    headers: {
      cookie: malformedTimestampCookie
    }
  }), secret, { nowMs });
  assert.equal(malformed, null, "Malformed checkout cookie timestamps should be rejected.");

  const tooFutureCookie = await cookieHelpers.createCheckoutAccessCookie({
    ...basePayload,
    createdAt: "2026-07-09T12:05:01.000Z"
  }, secret);
  const tooFuture = await cookieHelpers.readCheckoutAccessCookie(new Request("https://example.com/store/checkout/complete", {
    headers: {
      cookie: tooFutureCookie
    }
  }), secret, { nowMs });
  assert.equal(tooFuture, null, "Checkout cookies too far in the future should be rejected.");

  const altered = await cookieHelpers.readCheckoutAccessCookie(new Request("https://example.com/store/checkout/complete", {
    headers: {
      cookie: tamperCheckoutCookie(validCookie)
    }
  }), secret, { nowMs });
  assert.equal(altered, null, "Altered checkout cookie signatures should be rejected.");
}

async function testCheckoutReturnPages(completePage, cookieHelpers) {
  const { d1 } = createD1Database();
  const ordersD1 = await importModule("functions/_lib/orders-d1.mjs");
  const order = await ordersD1.createPendingOrder(d1, {
    currency: "USD",
    customerEmail: "buyer@example.com",
    customerEmailHash: "hash",
    customerEmailNormalized: "buyer@example.com",
    subtotalCents: 400,
    totalCents: 400
  }, [
    {
      authorSlugsJson: JSON.stringify(["rv-sawyer"]),
      currency: "USD",
      effectiveUnitPriceCents: 400,
      lastUpdatedSnapshot: "2026-07-01",
      lineTotalCents: 400,
      listPriceCents: 500,
      primaryAuthorSlug: "rv-sawyer",
      productSlug: "agency",
      productTitleSnapshot: "Agency",
      quantity: 1,
      versionSnapshot: "2026.1"
    }
  ]);
  await ordersD1.attachStripeCheckoutSessionId(d1, Number(order.id), "cs_test_cookie");

  const cookie = await cookieHelpers.createCheckoutAccessCookie({
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: "cs_test_cookie"
  }, "cookie-secret");

  let response = await completePage.handleCheckoutCompletePage(new Request("https://example.com/store/checkout/complete?session_id=cs_test_cookie", {
    headers: {
      cookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  assert.equal(response.status, 200, "Completion page should render.");
  let body = await response.text();
  assert.match(body, new RegExp(order.public_id), "Completion page should show the public order reference when cookie and session match.");
  assert.match(body, /Payment processing/i, "Completion page should report the server-recorded pending state.");
  assert.match(body, /not yet received verified webhook confirmation/i, "Completion page should not treat the browser return as proof of payment.");
  assert.equal(response.headers.get("set-cookie"), null, "Pending completion pages should retain the signed cookie so status can be refreshed.");
  assert.equal(response.headers.get("cache-control"), "no-store", "Completion responses should not be cacheable.");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer", "Completion responses should prevent referrer leakage.");

  await ordersD1.updateOrderPaymentStatus(d1, Number(order.id), {
    paidAt: "2026-07-14T15:00:00.000Z",
    paymentStatus: "paid",
    stripePaymentIntentId: "pi_test_cookie"
  });
  response = await completePage.handleCheckoutCompletePage(new Request("https://example.com/store/checkout/complete?session_id=cs_test_cookie", {
    headers: { cookie }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.match(body, /Payment confirmed/i, "Completion page should report the server-recorded paid state.");
  assert.match(body, /verified payment confirmation from Stripe/i, "Paid completion pages should identify the verified server confirmation.");
  assert.match(body, /download is being prepared/i, "Paid orders without a ready entitlement should show the preparation state.");
  assert.doesNotMatch(body, /Download Agency PDF/i, "Paid orders without an entitlement must not offer a download.");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/, "Paid completion pages should clear the checkout cookie.");

  response = await completePage.handleCheckoutCompletePage(new Request("https://example.com/store/checkout/complete?session_id=wrong-session", {
    headers: {
      cookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.doesNotMatch(body, new RegExp(order.public_id), "Completion page should not reveal order data when the session ID does not match the signed cookie.");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/, "Mismatched completion states should still clear the checkout cookie.");

  const expiredCookie = await cookieHelpers.createCheckoutAccessCookie({
    createdAt: "2000-01-01T00:00:00.000Z",
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: "cs_test_cookie"
  }, "cookie-secret");
  response = await completePage.handleCheckoutCompletePage(new Request("https://example.com/store/checkout/complete?session_id=cs_test_cookie", {
    headers: {
      cookie: expiredCookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.doesNotMatch(body, new RegExp(order.public_id), "Expired checkout cookies should not reveal order context.");
  assert.match(body, /start a fresh checkout attempt/i, "Expired checkout cookies should fall back to the safe checkout state.");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/, "Expired checkout cookies should be cleared.");

  const malformedTimestampCookie = await cookieHelpers.createCheckoutAccessCookie({
    createdAt: "not-a-timestamp",
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: "cs_test_cookie"
  }, "cookie-secret");
  response = await completePage.handleCheckoutCanceledPage(new Request("https://example.com/store/checkout/canceled", {
    headers: {
      cookie: malformedTimestampCookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.doesNotMatch(body, new RegExp(order.public_id), "Canceled checkout pages should not reveal order context for malformed cookies.");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/, "Canceled checkout pages should clear malformed cookies.");
  assert.equal(response.headers.get("cache-control"), "no-store", "Canceled responses should not be cacheable.");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer", "Canceled responses should prevent referrer leakage.");

  const futureCookie = await cookieHelpers.createCheckoutAccessCookie({
    createdAt: "2099-01-01T00:00:00.000Z",
    publicOrderReference: order.public_id,
    stripeCheckoutSessionId: "cs_test_cookie"
  }, "cookie-secret");
  response = await completePage.handleCheckoutCanceledPage(new Request("https://example.com/store/checkout/canceled", {
    headers: {
      cookie: futureCookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.doesNotMatch(body, new RegExp(order.public_id), "Future-dated checkout cookies should not reveal order context.");

  const tamperedCookie = tamperCheckoutCookie(cookie);
  response = await completePage.handleCheckoutCanceledPage(new Request("https://example.com/store/checkout/canceled", {
    headers: {
      cookie: tamperedCookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.doesNotMatch(body, new RegExp(order.public_id), "Tampered checkout cookies should not reveal order context.");

  response = await completePage.handleCheckoutCanceledPage(new Request("https://example.com/store/checkout/canceled", {
    headers: {
      cookie
    }
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    TRG_ORDERS: d1
  });
  body = await response.text();
  assert.match(body, /Checkout was canceled\./, "Cancellation page should render a minimal TRG cancellation message.");
  assert.match(body, new RegExp(order.public_id), "Cancellation page may show the safe public order reference.");
}

async function testPendingRouteDisabled(pendingRoute) {
  const response = await pendingRoute.onRequestPost();
  assert.equal(response.status, 410, "The temporary pending-order route should be disabled once checkout owns pending order creation.");
}

function createD1Database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const migrationPath of MIGRATION_PATHS) {
    raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  raw.exec("UPDATE runtime_settings SET setting_value = 'OPEN' WHERE setting_key = 'store_state'");
  return {
    d1: createD1Adapter(raw),
    raw
  };
}

function createD1Adapter(raw) {
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE TRANSACTION");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) {
      raw.exec(sql);
      return { success: true };
    },
    prepare(sql) {
      const statement = raw.prepare(sql);
      return createPreparedStatement(statement);
    }
  };
}

function createPreparedStatement(statement, boundValues = []) {
  return {
    all() {
      const results = statement.all(...boundValues);
      return Promise.resolve({ results });
    },
    bind(...values) {
      return createPreparedStatement(statement, values);
    },
    first() {
      const result = statement.get(...boundValues);
      return Promise.resolve(result || null);
    },
    run() {
      const result = statement.run(...boundValues);
      return Promise.resolve({
        meta: {
          changes: Number(result.changes ?? 0),
          last_row_id: Number(result.lastInsertRowid ?? 0)
        }
      });
    }
  };
}

async function findSingleRow(d1, query) {
  const result = await d1.prepare(query).all();
  assert.equal(result.results.length, 1, `Expected one row for query: ${query}`);
  return result.results[0];
}

async function countRows(d1, tableName) {
  const result = await d1.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
  return Number(result?.count || 0);
}

function createJsonResponse(payload, status = 200) {
  return {
    async json() {
      return payload;
    },
    ok: status >= 200 && status < 300,
    status
  };
}

function decodeCheckoutCookie(setCookie) {
  const raw = getCheckoutCookieValue(setCookie);
  const encodedPayload = raw.split(".")[0];
  const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8"));
}

function getCheckoutCookieValue(setCookie) {
  return String(setCookie || "").split(";")[0].split("=").slice(1).join("=");
}

function tamperCheckoutCookie(setCookie) {
  const raw = getCheckoutCookieValue(setCookie);
  const separator = raw.lastIndexOf(".");
  const payload = raw.slice(0, separator + 1);
  const signature = raw.slice(separator + 1);
  const alteredSignature = signature.replace(/.$/, (value) => value === "0" ? "1" : "0");
  return String(setCookie || "").replace(raw, `${payload}${alteredSignature}`);
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
