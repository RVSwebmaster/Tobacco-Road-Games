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
  path.join(ROOT, "migrations", "015_store_state.sql")
];
const NOW = Date.parse("2026-07-14T15:00:00.000Z");
const ATTEMPT_ONE = "trgca_10000000-0000-4000-8000-000000000001";
const ATTEMPT_TWO = "trgca_20000000-0000-4000-8000-000000000002";
const ATTEMPT_THREE = "trgca_30000000-0000-4000-8000-000000000003";
const ATTEMPT_FOUR = "trgca_40000000-0000-4000-8000-000000000004";
const ATTEMPT_FIVE = "trgca_50000000-0000-4000-8000-000000000005";
const ATTEMPT_SIX = "trgca_60000000-0000-4000-8000-000000000006";
const ATTEMPT_SEVEN = "trgca_70000000-0000-4000-8000-000000000007";

const CATALOG = [
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

async function main() {
  const cartCheckout = await importModule("functions/_lib/cart-checkout.mjs");

  await testSequentialDuplicate(cartCheckout);
  await testConcurrentDuplicate(cartCheckout);
  await testNewAttemptCreatesNewOrder(cartCheckout);
  await testChangedRequestRejected(cartCheckout);
  await testDefinitiveStripeValidationFailure(cartCheckout);
  await testIndeterminateConnectionRecovery(cartCheckout);
  await testIndeterminateServerFailure(cartCheckout);
  await testAttachmentFailureRecovery(cartCheckout);

  console.log("Checkout idempotency tests passed.");
}

async function testSequentialDuplicate(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness();

  const first = await checkout(cartCheckout, d1, stripe, ATTEMPT_ONE);
  const second = await checkout(cartCheckout, d1, stripe, ATTEMPT_ONE);
  const firstPayload = await first.json();
  const secondPayload = await second.json();

  assert.equal(first.status, 201, "The first submission should create an order and Session.");
  assert.equal(second.status, 200, "A sequential duplicate should return the existing order and Session.");
  assert.equal(secondPayload.reusedCheckoutAttempt, true, "Sequential duplicates should be identified as reused attempts.");
  assert.equal(firstPayload.publicOrderReference, secondPayload.publicOrderReference, "Sequential duplicates should return the same order.");
  assert.equal(firstPayload.checkoutUrl, secondPayload.checkoutUrl, "Sequential duplicates should return the same active Session URL.");
  assert.equal(await countRows(d1, "orders"), 1, "Sequential duplicates must create one order.");
  assert.equal(stripe.sessions.size, 1, "Sequential duplicates must create one Stripe Session.");
  assert.deepEqual(stripe.calls, [`trg-checkout-${ATTEMPT_ONE}`], "An already active attempt should not call Stripe again.");
}

async function testConcurrentDuplicate(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness({ delayMs: 10 });

  const responses = await Promise.all([
    checkout(cartCheckout, d1, stripe, ATTEMPT_TWO),
    checkout(cartCheckout, d1, stripe, ATTEMPT_TWO)
  ]);
  const payloads = await Promise.all(responses.map((response) => response.json()));

  assert.ok(responses.every((response) => [200, 201].includes(response.status)), "Concurrent duplicates should both recover successfully.");
  assert.equal(payloads[0].publicOrderReference, payloads[1].publicOrderReference, "Concurrent duplicates should converge on one order.");
  assert.equal(payloads[0].checkoutUrl, payloads[1].checkoutUrl, "Concurrent duplicates should converge on one Stripe Session.");
  assert.equal(await countRows(d1, "orders"), 1, "Concurrent duplicates must create one order.");
  assert.equal(stripe.sessions.size, 1, "Concurrent Stripe calls with one idempotency key must create one Session.");
  assert.ok(stripe.calls.every((key) => key === `trg-checkout-${ATTEMPT_TWO}`), "Concurrent calls must use the same Stripe idempotency key.");
}

async function testNewAttemptCreatesNewOrder(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness();

  const firstPayload = await (await checkout(cartCheckout, d1, stripe, ATTEMPT_ONE)).json();
  const secondPayload = await (await checkout(cartCheckout, d1, stripe, ATTEMPT_THREE)).json();

  assert.notEqual(firstPayload.publicOrderReference, secondPayload.publicOrderReference, "A genuinely new attempt should create a new order.");
  assert.notEqual(firstPayload.checkoutUrl, secondPayload.checkoutUrl, "A genuinely new attempt should create a new Session.");
  assert.equal(await countRows(d1, "orders"), 2, "Two genuine attempts should create two orders.");
  assert.equal(stripe.sessions.size, 2, "Two genuine attempts should create two Stripe Sessions.");
}

async function testChangedRequestRejected(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness();
  const original = await checkout(cartCheckout, d1, stripe, ATTEMPT_FOUR);
  const originalPayload = await original.json();

  const changedEmail = await checkout(cartCheckout, d1, stripe, ATTEMPT_FOUR, {
    email: "different@example.com"
  });
  const changedCartCatalog = [
    ...CATALOG,
    { ...CATALOG[0], slug: "janni", title: "Janni" }
  ];
  const changedCart = await checkout(cartCheckout, d1, stripe, ATTEMPT_FOUR, {
    catalogProducts: changedCartCatalog,
    enforceAgency: false,
    items: [
      { quantity: 1, slug: "agency" },
      { quantity: 1, slug: "janni" }
    ]
  });
  const changedAmount = await checkout(cartCheckout, d1, stripe, ATTEMPT_FOUR, {
    catalogProducts: [{
      ...CATALOG[0],
      priceCents: 600,
      saleEnabled: false,
      salePriceCents: null
    }],
    enforceAgency: false
  });
  const changedCurrency = await checkout(cartCheckout, d1, stripe, ATTEMPT_FOUR, {
    catalogProducts: [{ ...CATALOG[0], currency: "EUR" }],
    enforceAgency: false
  });
  const changedPayload = await changedEmail.json();

  assert.deepEqual(
    [changedEmail.status, changedCart.status, changedAmount.status, changedCurrency.status],
    [409, 409, 409, 409],
    "Reusing an attempt with changed email, cart contents, amount, or currency should fail safely."
  );
  assert.equal(changedPayload.retryable, false, "A changed request must require a genuinely new attempt.");
  assert.equal(await countRows(d1, "orders"), 1, "Changed request reuse must not create another order.");
  assert.equal(stripe.sessions.size, 1, "Changed request reuse must not create another Session.");
  const stored = await firstRow(d1, "SELECT * FROM orders");
  assert.equal(stored.public_id, originalPayload.publicOrderReference, "Changed request reuse must not mutate the original order.");
  assert.equal(stored.customer_email_normalized, "buyer@example.com", "Changed request reuse must preserve the original email.");
}

async function testDefinitiveStripeValidationFailure(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness({ definitiveStatus: 400 });
  const response = await checkout(cartCheckout, d1, stripe, ATTEMPT_FIVE);
  const payload = await response.json();
  const order = await firstRow(d1, "SELECT * FROM orders");

  assert.equal(response.status, 502, "A definitive Stripe validation rejection should fail the attempt.");
  assert.equal(payload.retryable, false, "Definitive Stripe validation failures must not be retried under the same attempt.");
  assert.equal(order.payment_status, "failed", "Definitive Stripe failures should leave ordinary pending status.");
  assert.equal(order.checkout_session_status, "failed_terminal", "Definitive Stripe failures should be terminal.");
  assert.equal(order.checkout_failure_code, "stripe_request_rejected", "Definitive Stripe failures should store a safe classification.");
}

async function testIndeterminateConnectionRecovery(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness({ createThenDisconnectOnce: true });
  const first = await checkout(cartCheckout, d1, stripe, ATTEMPT_SIX);
  const firstPayload = await first.json();
  let order = await firstRow(d1, "SELECT * FROM orders");

  assert.equal(first.status, 503, "An uncertain connection result should be retryable.");
  assert.equal(firstPayload.retryable, true, "Connection uncertainty should tell the caller to retry the same attempt.");
  assert.equal(order.payment_status, "pending", "Connection uncertainty should keep the order pending.");
  assert.equal(order.checkout_session_status, "retryable", "Connection uncertainty should retain retry state.");
  assert.equal(order.checkout_failure_code, "stripe_connection_indeterminate", "Connection uncertainty should store a safe classification.");

  const recovered = await checkout(cartCheckout, d1, stripe, ATTEMPT_SIX);
  const recoveredPayload = await recovered.json();
  order = await firstRow(d1, "SELECT * FROM orders");
  assert.equal(recovered.status, 200, "Retrying the same uncertain attempt should recover successfully.");
  assert.equal(recoveredPayload.publicOrderReference, order.public_id, "Connection recovery should preserve the original order.");
  assert.equal(order.stripe_checkout_session_id, stripe.sessions.values().next().value.id, "Connection recovery should attach the original Stripe Session.");
  assert.equal(stripe.sessions.size, 1, "Connection recovery must not create a second Session.");
}

async function testIndeterminateServerFailure(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness({ serverFailureOnce: true });
  const response = await checkout(cartCheckout, d1, stripe, ATTEMPT_SEVEN);
  const payload = await response.json();
  const order = await firstRow(d1, "SELECT * FROM orders");

  assert.equal(response.status, 503, "Stripe server failures should be treated as indeterminate.");
  assert.equal(payload.retryable, true, "Stripe server failures should retain retry instructions.");
  assert.equal(order.payment_status, "pending", "Stripe server failures should keep the order pending.");
  assert.equal(order.checkout_session_status, "retryable", "Stripe server failures should preserve the attempt for retry.");
  assert.equal(order.checkout_failure_code, "stripe_http_indeterminate", "Stripe server failures should store a safe classification.");
}

async function testAttachmentFailureRecovery(cartCheckout) {
  const created = createD1Database();
  const fault = createAttachFailureDatabase(created.d1);
  const stripe = createStripeHarness();

  const failedAttachment = await checkout(cartCheckout, fault.database, stripe, ATTEMPT_THREE);
  const failedPayload = await failedAttachment.json();
  let order = await firstRow(created.d1, "SELECT * FROM orders");
  const originalSession = stripe.sessions.values().next().value;

  assert.equal(failedAttachment.status, 503, "A D1 attachment failure should return a retryable response.");
  assert.equal(failedPayload.failureClassification, "stripe_session_attachment_indeterminate", "Attachment failures should have a safe classification.");
  assert.equal(order.stripe_checkout_session_id, null, "A failed D1 attachment should leave the Session ID unattached.");
  assert.equal(order.checkout_session_status, "retryable", "A failed attachment should preserve retry state when possible.");

  const recovered = await checkout(cartCheckout, fault.database, stripe, ATTEMPT_THREE);
  const recoveredPayload = await recovered.json();
  order = await firstRow(created.d1, "SELECT * FROM orders");

  assert.equal(recovered.status, 200, "Retry should recover after the attachment failure.");
  assert.equal(recoveredPayload.publicOrderReference, order.public_id, "Attachment recovery should use the original order.");
  assert.equal(order.stripe_checkout_session_id, originalSession.id, "Attachment recovery should attach the original Stripe Session.");
  assert.equal(order.checkout_session_status, "active", "Attachment recovery should make the original Session active.");
  assert.equal(await countRows(created.d1, "orders"), 1, "Attachment recovery must not create a second order.");
  assert.equal(stripe.sessions.size, 1, "Attachment recovery must not create a second Session.");
}

function checkout(cartCheckout, database, stripe, checkoutAttemptId, options = {}) {
  const email = options.email || "buyer@example.com";
  const env = {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret",
    ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_mocked",
    TRG_ORDERS: database
  };
  if (options.enforceAgency !== false) {
    env.STAGING_CHECKOUT_PRODUCT_SLUG = "agency";
  }
  return cartCheckout.handleCartCheckoutRequest(new Request("https://staging.example.com/api/cart/checkout", {
    body: JSON.stringify({
      checkoutAttemptId,
      email,
      emailConfirmation: email,
      items: options.items || [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), env, {
    catalogProducts: options.catalogProducts || CATALOG,
    now: NOW,
    stripeFetchImpl: stripe.fetch
  });
}

function createStripeHarness(options = {}) {
  const sessions = new Map();
  const calls = [];
  let sequence = 0;
  let disconnected = false;
  let serverFailed = false;

  const fetch = async (url, fetchOptions = {}) => {
    assert.match(String(url), /\/checkout\/sessions$/, "The Stripe harness should receive Session creation calls.");
    const idempotencyKey = String(fetchOptions.headers?.["idempotency-key"] || "");
    assert.ok(idempotencyKey, "Every Stripe Session request must include an idempotency key.");
    calls.push(idempotencyKey);

    if (options.definitiveStatus) {
      return createJsonResponse({ error: { message: "synthetic validation rejection" } }, options.definitiveStatus);
    }
    if (options.serverFailureOnce && !serverFailed) {
      serverFailed = true;
      return createJsonResponse({ error: { message: "synthetic server failure" } }, 500);
    }

    let session = sessions.get(idempotencyKey);
    if (!session) {
      sequence += 1;
      session = {
        id: `cs_test_idempotent_${sequence}`,
        livemode: false,
        ui_mode: "hosted_page",
        url: `https://checkout.stripe.com/c/pay/cs_test_idempotent_${sequence}`
      };
      sessions.set(idempotencyKey, session);
    }

    if (options.createThenDisconnectOnce && !disconnected) {
      disconnected = true;
      throw new Error("synthetic connection loss after Stripe execution");
    }
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return createJsonResponse(session, 200);
  };

  return { calls, fetch, sessions };
}

function createAttachFailureDatabase(base) {
  let failed = false;
  const database = {
    batch(statements) {
      return base.batch(statements);
    },
    exec(sql) {
      return base.exec(sql);
    },
    prepare(sql) {
      const shouldFail = String(sql).includes("stripe_checkout_session_url = ?");
      return wrapPreparedStatement(base.prepare(sql), () => {
        if (shouldFail && !failed) {
          failed = true;
          return true;
        }
        return false;
      });
    }
  };
  return { database };
}

function wrapPreparedStatement(statement, shouldFail) {
  return {
    all() {
      return statement.all();
    },
    bind(...values) {
      return wrapPreparedStatement(statement.bind(...values), shouldFail);
    },
    first() {
      return statement.first();
    },
    run() {
      if (shouldFail()) {
        return Promise.reject(new Error("synthetic D1 attachment failure"));
      }
      return statement.run();
    }
  };
}

function createD1Database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const migrationPath of MIGRATION_PATHS) {
    raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  raw.exec("UPDATE runtime_settings SET setting_value = 'OPEN' WHERE setting_key = 'store_state'");
  return { d1: createD1Adapter(raw), raw };
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
      return createPreparedStatement(raw.prepare(sql));
    }
  };
}

function createPreparedStatement(statement, boundValues = []) {
  return {
    all() {
      return Promise.resolve({ results: statement.all(...boundValues) });
    },
    bind(...values) {
      return createPreparedStatement(statement, values);
    },
    first() {
      return Promise.resolve(statement.get(...boundValues) || null);
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

async function countRows(d1, tableName) {
  const row = await d1.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
  return Number(row?.count || 0);
}

function firstRow(d1, query) {
  return d1.prepare(query).first();
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
