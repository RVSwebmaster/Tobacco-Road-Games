const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATH = path.join(ROOT, "migrations", "001_direct_storefront.sql");
const TAX_NOTE = "The listed price is the final price. Any applicable sales tax is included.";

async function main() {
  const cartCheckout = await importModule("functions/_lib/cart-checkout.mjs");
  const completePage = await importModule("functions/_lib/checkout-pages.mjs");
  const pendingRoute = await importModule("functions/_lib/orders-pending-route.mjs");

  await testCheckoutEndpoint(cartCheckout);
  await testCheckoutValidation(cartCheckout);
  await testCheckoutReturnPages(completePage);
  await testPendingRouteDisabled(pendingRoute);

  console.log("Cart checkout tests passed.");
}

async function testCheckoutEndpoint(cartCheckout) {
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

  let capturedForm = null;
  const stripeFetchImpl = async (url, options = {}) => {
    assert.match(String(url), /\/checkout\/sessions$/, "Checkout should call Stripe's Checkout Session creation endpoint.");
    capturedForm = new URLSearchParams(String(options.body || ""));
    return createJsonResponse({
      id: "cs_test_created",
      livemode: false,
      url: "https://checkout.stripe.com/c/pay/cs_test_created"
    });
  };

  const response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
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

  assert.equal(response.status, 201, "Valid checkout requests should create a Checkout Session.");
  const payload = await response.json();
  assert.equal(payload.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_created", "Checkout should return only the Stripe-hosted redirect URL.");
  assert.equal(payload.subtotalCents, 400, "Checkout should use server-authoritative sale pricing.");
  assert.equal(payload.totalCents, 400, "Checkout should preserve tax-inclusive totals.");
  assert.equal(payload.taxInclusive, true, "Checkout should preserve the tax-inclusive pricing flag.");
  assert.equal(payload.paymentStatus, "pending", "Checkout should create a pending order before payment completion.");
  assert.equal(payload.pricingNote, TAX_NOTE, "Checkout should preserve the exact pricing note.");
  assert.ok(!("stripeCheckoutSessionId" in payload), "Checkout responses must not expose the Stripe Session ID.");

  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /trg_checkout_access=/, "Checkout should issue a checkout-access cookie.");
  assert.match(setCookie, /HttpOnly/i, "Checkout-access cookie should be HttpOnly.");
  assert.match(setCookie, /Secure/i, "Checkout-access cookie should be Secure.");
  assert.match(setCookie, /SameSite=Lax/i, "Checkout-access cookie should be SameSite=Lax.");
  assert.match(setCookie, /Path=\/store\/checkout\//i, "Checkout-access cookie should be scoped to checkout return pages.");

  assert.equal(capturedForm.get("mode"), "payment", "Stripe checkout should use payment mode.");
  assert.equal(capturedForm.get("client_reference_id"), payload.publicOrderReference, "Stripe checkout should reconcile with the public order reference.");
  assert.equal(capturedForm.get("customer_email"), "Buyer@Example.com", "Stripe checkout should use the confirmed buyer email.");
  assert.equal(capturedForm.get("line_items[0][price_data][currency]"), "usd", "Stripe line items should send server-authoritative currency.");
  assert.equal(capturedForm.get("line_items[0][price_data][unit_amount]"), "400", "Stripe line items should send server-authoritative effective prices.");
  assert.equal(capturedForm.get("line_items[0][price_data][tax_behavior]"), "inclusive", "Stripe line items should preserve tax-inclusive pricing.");
  assert.equal(capturedForm.get("line_items[0][price_data][product_data][name]"), "Agency", "Stripe line items should use the trusted product title.");
  assert.equal(capturedForm.get("line_items[0][price_data][product_data][description]"), "By RV Sawyer", "Stripe line items should use safe author display text.");
  assert.match(capturedForm.get("success_url") || "", /\/store\/checkout\/complete\?session_id=\{CHECKOUT_SESSION_ID\}/, "Stripe checkout should use the documented success URL placeholder.");
  assert.match(capturedForm.get("cancel_url") || "", /\/store\/checkout\/canceled$/, "Stripe checkout should return to the TRG cancellation page.");

  const order = await findSingleRow(d1, "SELECT * FROM orders");
  assert.equal(order.payment_status, "pending", "Checkout must not mark orders paid in this phase.");
  assert.equal(order.stripe_checkout_session_id, "cs_test_created", "Checkout should attach the Stripe Checkout Session ID after creation.");

  const item = await findSingleRow(d1, "SELECT * FROM order_items");
  assert.equal(item.effective_unit_price_cents, 400, "Checkout should snapshot the sale price in D1.");
  assert.equal(item.list_price_cents, 500, "Checkout should snapshot the regular list price in D1.");
}

async function testCheckoutValidation(cartCheckout) {
  const validCatalog = [
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "cart",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: false,
      salePriceCents: null,
      slug: "agency",
      status: "available-direct",
      title: "Agency",
      version: "2026.1"
    }
  ];

  let response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      email: "buyer@example.com",
      emailConfirmation: "different@example.com",
      items: [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl: async () => {
      throw new Error("stripe should not be called");
    }
  });
  assert.equal(response.status, 400, "Checkout should reject mismatched email confirmation.");

  response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      email: "buyer@example.com",
      emailConfirmation: "buyer@example.com",
      items: [{ quantity: 1, slug: "unknown" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl: async () => {
      throw new Error("stripe should not be called");
    }
  });
  assert.equal(response.status, 400, "Checkout should reject unknown products.");

  const failureDb = createD1Database().d1;
  response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      email: "buyer@example.com",
      emailConfirmation: "buyer@example.com",
      items: [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_live_not_allowed",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl: async () => createJsonResponse({
      id: "cs_test_created",
      livemode: false,
      url: "https://checkout.stripe.com/c/pay/cs_test_created"
    })
  });
  assert.equal(response.status, 502, "Checkout should reject non-sandbox Stripe keys in this phase.");

  response = await cartCheckout.handleCartCheckoutRequest(new Request("https://example.com/api/cart/checkout", {
    body: JSON.stringify({
      email: "buyer@example.com",
      emailConfirmation: "buyer@example.com",
      items: [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: failureDb
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z"),
    stripeFetchImpl: async () => {
      throw new Error("synthetic stripe failure");
    }
  });
  assert.equal(response.status, 502, "Checkout should surface Stripe session creation failures safely.");
  assert.equal(await countRows(failureDb, "orders"), 1, "Checkout should create the pending order before attempting Stripe session creation.");
  const failedOrder = await findSingleRow(failureDb, "SELECT * FROM orders");
  assert.equal(failedOrder.stripe_checkout_session_id, null, "Failed Stripe session creation should not attach a session ID.");
}

async function testCheckoutReturnPages(completePage) {
  const { d1 } = createD1Database();
  const ordersD1 = await importModule("functions/_lib/orders-d1.mjs");
  const cookieHelpers = await importModule("functions/_lib/checkout-cookie.mjs");
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
  assert.match(body, /payment status is still/i, "Completion page should avoid claiming fulfillment or payment confirmation in this phase.");
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/, "Completion page should clear the checkout cookie after use.");

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
  raw.exec(fs.readFileSync(MIGRATION_PATH, "utf8"));
  return {
    d1: createD1Adapter(raw),
    raw
  };
}

function createD1Adapter(raw) {
  return {
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

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
