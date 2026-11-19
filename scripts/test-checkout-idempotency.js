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
  await testLegacyPaidCheckoutRetired(cartCheckout);
  console.log("Legacy paid checkout retirement tests passed.");
}

async function testLegacyPaidCheckoutRetired(cartCheckout) {
  const { d1 } = createD1Database();
  const stripe = createStripeHarness();
  for (const attempt of [ATTEMPT_ONE, ATTEMPT_TWO, ATTEMPT_THREE, ATTEMPT_FOUR, ATTEMPT_FIVE, ATTEMPT_SIX, ATTEMPT_SEVEN]) {
    const response = await checkout(cartCheckout, d1, stripe, attempt);
    const payload = await response.json();
    assert.equal(response.status, 410, "Every new paid legacy-catalog attempt must be retired.");
    assert.equal(payload.code, "legacy_paid_checkout_retired");
  }
  assert.equal(await countRows(d1, "orders"), 0, "Retired legacy requests must not create orders.");
  assert.equal(stripe.sessions.size, 0, "Retired legacy requests must not initiate Stripe sessions.");
  assert.deepEqual(stripe.calls, []);
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
