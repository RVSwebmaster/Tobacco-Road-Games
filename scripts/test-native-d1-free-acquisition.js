const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-30T22:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const EMAIL_SECRET = "task2l-order-email-hash-secret";
const DOWNLOAD_SECRET = "task2l-download-signing-secret-long-enough";
const PDF = new TextEncoder().encode("%PDF-1.7\nTask 2L native free acquisition\n%%EOF\n");
const BUYER = { id: "task2l-buyer", email: "task2l-buyer@example.test", token: "task2l-buyer-token" };
const OTHER = { id: "task2l-other", email: "task2l-other@example.test", token: "task2l-other-token" };
const UNVERIFIED = { id: "task2l-unverified", email: "task2l-unverified@example.test", token: "task2l-unverified-token" };
let attemptSequence = 0;

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const acquire = await load("functions/_lib/native-free-acquisition.mjs");
  const library = await load("functions/_lib/account-library.mjs");
  const download = await load("functions/_lib/download-route.mjs");
  const legacyFree = await load("functions/_lib/free-download.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  await seedUser(raw, auth, BUYER, true);
  await seedUser(raw, auth, OTHER, true);
  await seedUser(raw, auth, UNVERIFIED, false);
  raw.exec(`INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,closure_state,created_at,updated_at)
    VALUES('task2l-ineligible','task2l-ineligible','Ineligible Task 2L Creator','suspended','suspended','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);

  const base = {
    creatorId: "creator-rv-sawyer", publicationState: "published", currency: "USD",
    coverR2Key: "catalog-publications/task2l/cover.webp",
    deliveryFilename: "Task 2L.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2.6" }
  };
  const products = {};
  products.free = await catalog.createProduct(db, { ...base,
    id: "task2l-free", slug: "task2l-free", title: "Task 2L Free",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-free/delivery.pdf"
  }, { nowMs: NOW });
  products.fixedFree = await catalog.createProduct(db, { ...base,
    id: "task2l-fixed-free", slug: "task2l-fixed-free", title: "Task 2L Fixed Free",
    status: "free-download", buyMode: "free-download", pricingModel: "fixed", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-fixed-free/delivery.pdf"
  }, { nowMs: NOW });
  products.pwywZero = await catalog.createProduct(db, { ...base,
    id: "task2l-pwyw-zero", slug: "task2l-pwyw-zero", title: "Task 2L PWYW Zero",
    status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw", priceCents: 500,
    minimumPriceCents: 0, suggestedPriceCents: 500,
    deliveryR2Key: "catalog-publications/task2l-pwyw-zero/delivery.pdf"
  }, { nowMs: NOW });
  products.pwywPaid = await catalog.createProduct(db, { ...base,
    id: "task2l-pwyw-paid", slug: "task2l-pwyw-paid", title: "Task 2L PWYW Paid",
    status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw", priceCents: 500,
    minimumPriceCents: 100, suggestedPriceCents: 500,
    deliveryR2Key: "catalog-publications/task2l-pwyw-paid/delivery.pdf"
  }, { nowMs: NOW });
  products.paid = await catalog.createProduct(db, { ...base,
    id: "task2l-paid", slug: "task2l-paid", title: "Task 2L Paid",
    status: "available-direct", buyMode: "cart", pricingModel: "fixed", priceCents: 900,
    deliveryR2Key: "catalog-publications/task2l-paid/delivery.pdf"
  }, { nowMs: NOW });
  products.paused = await catalog.createProduct(db, { ...base,
    id: "task2l-paused", slug: "task2l-paused", title: "Task 2L Paused",
    publicationState: "paused", status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-paused/delivery.pdf"
  }, { nowMs: NOW });
  products.ineligible = await catalog.createProduct(db, { ...base,
    id: "task2l-ineligible-product", slug: "task2l-ineligible-product", title: "Task 2L Ineligible",
    creatorId: "task2l-ineligible", status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-ineligible/delivery.pdf"
  }, { nowMs: NOW });
  products.recovery = await catalog.createProduct(db, { ...base,
    id: "task2l-recovery", slug: "task2l-recovery", title: "Task 2L Recovery",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-recovery/delivery.pdf"
  }, { nowMs: NOW });
  products.concurrent = await catalog.createProduct(db, { ...base,
    id: "task2l-concurrent", slug: "task2l-concurrent", title: "Task 2L Concurrent",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-concurrent/delivery.pdf"
  }, { nowMs: NOW });
  products.failure = await catalog.createProduct(db, { ...base,
    id: "task2l-failure", slug: "task2l-failure", title: "Task 2L Failure Recovery",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
    deliveryR2Key: "catalog-publications/task2l-failure/delivery.pdf"
  }, { nowMs: NOW });

  const bucket = createBucket(Object.values(products).map(product => product.deliveryR2Key));
  const env = {
    DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET,
    ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET,
    TRG_ORDERS: db,
    TRG_PRODUCTS: bucket
  };
  const call = (user, slug, amountCents, attempt = nextAttempt(), options = {}) => {
    const request = acquisitionRequest(user, slug, amountCents, attempt, options);
    return { attempt, response: acquire.handleNativeFreeAcquisitionRequest(request, env, { now: NOW, ...options.handlerOptions }) };
  };

  let invocation = call(BUYER, products.free.slug, 999);
  let response = await invocation.response;
  let body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.acquisitionComplete, true);
  assert.equal(body.paymentProvider, "none");
  assert.equal(body.stripeCheckoutSessionCreated, false);
  assert.equal(body.totalCents, 0);
  let order = orderByAttempt(raw, invocation.attempt);
  assertFreeOrder(order);
  let entitlement = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=?").get(order.id);
  assert.equal(entitlement.entitlement_source, "native_free");
  assert.equal(entitlement.selected_price_cents_snapshot, 0);
  assert.equal(entitlement.purchaser_user_id, BUYER.id);

  invocation = call(BUYER, products.fixedFree.slug, 12345);
  response = await invocation.response;
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  assertFreeOrder(orderByAttempt(raw, invocation.attempt));

  invocation = call(BUYER, products.pwywZero.slug, 0);
  response = await invocation.response;
  body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  order = orderByAttempt(raw, invocation.attempt);
  assertFreeOrder(order);
  entitlement = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=?").get(order.id);
  assert.equal(entitlement.pricing_model_snapshot, "pwyw");
  assert.equal(entitlement.selected_price_cents_snapshot, 0);

  const rejectedBefore = count(raw, "orders");
  for (const [user, product, amount, expectedStatus, expectedCode, requestOptions] of [
    [BUYER, products.pwywPaid, 0, 400, "native_free_product_unavailable", {}],
    [BUYER, products.paid, 0, 409, "native_zero_value_required", {}],
    [BUYER, products.paused, 0, 400, "native_free_product_unavailable", {}],
    [BUYER, products.ineligible, 0, 400, "native_free_product_unavailable", {}],
    [null, products.recovery, 0, 403, "authenticated_account_required", {}],
    [BUYER, products.recovery, 0, 403, "csrf_rejected", { origin: "https://evil.example" }]
  ]) {
    invocation = call(user, product.slug, amount, nextAttempt(), requestOptions);
    response = await invocation.response;
    body = await response.json();
    assert.equal(response.status, expectedStatus, `${product.slug}: ${JSON.stringify(body)}`);
    assert.equal(body.code, expectedCode);
  }
  assert.equal(count(raw, "orders"), rejectedBefore, "Rejected free acquisitions must not create orders.");

  invocation = call(UNVERIFIED, products.recovery.slug, 0);
  response = await invocation.response;
  body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body), "An authenticated Customer may acquire a free title before email verification.");
  assert.equal(raw.prepare("SELECT email_verified FROM users WHERE id=?").get(UNVERIFIED.id).email_verified, 0);
  order = orderByAttempt(raw, invocation.attempt);
  assertFreeOrder(order);
  assert.equal(raw.prepare("SELECT purchaser_user_id FROM native_product_entitlements WHERE order_id=?").get(order.id).purchaser_user_id, UNVERIFIED.id);

  const mismatchAttempt = nextAttempt();
  response = await acquire.handleNativeFreeAcquisitionRequest(
    acquisitionRequest(BUYER, products.recovery.slug, 0, mismatchAttempt, { email: OTHER.email }),
    env,
    { now: NOW }
  );
  assert.equal(response.status, 403);
  assert.equal(orderByAttempt(raw, mismatchAttempt), undefined);

  const duplicateAttempt = nextAttempt();
  response = await acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.recovery.slug, 0, duplicateAttempt), env, { now: NOW });
  assert.equal(response.status, 201);
  response = await acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.recovery.slug, 0, duplicateAttempt), env, { now: NOW + 1 });
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reusedCheckoutAttempt, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=?").get(duplicateAttempt).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE native_product_id=? AND purchaser_user_id=?").get(products.recovery.id, BUYER.id).n, 1);
  const secondAttempt = nextAttempt();
  response = await acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.recovery.slug, 0, secondAttempt), env, { now: NOW });
  assert.equal(response.status, 409);
  assert.equal(orderByAttempt(raw, secondAttempt), undefined);

  const concurrentAttempt = nextAttempt();
  const concurrentResponses = await Promise.all([
    acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.concurrent.slug, 0, concurrentAttempt), env, { now: NOW }),
    acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.concurrent.slug, 0, concurrentAttempt), env, { now: NOW })
  ]);
  assert.ok(concurrentResponses.every(result => [200, 201].includes(result.status)));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=?").get(concurrentAttempt).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE native_product_id=? AND purchaser_user_id=?").get(products.concurrent.id, BUYER.id).n, 1);

  const failureAttempt = nextAttempt();
  const failingDb = failNextBatch(db);
  response = await acquire.handleNativeFreeAcquisitionRequest(
    acquisitionRequest(BUYER, products.failure.slug, 0, failureAttempt),
    env,
    { now: NOW, entitlementDatabase: failingDb }
  );
  body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.retryable, true);
  order = orderByAttempt(raw, failureAttempt);
  assert.equal(order.payment_status, "pending");
  assert.equal(order.native_order_state, "pending");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(order.id).n, 0);
  response = await acquire.handleNativeFreeAcquisitionRequest(acquisitionRequest(BUYER, products.failure.slug, 0, failureAttempt), env, { now: NOW + 1 });
  assert.equal(response.status, 201);
  assertFreeOrder(orderByAttempt(raw, failureAttempt));

  response = await library.handleAccountLibraryRequest(libraryRequest(BUYER), env, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  const libraryBody = await response.json();
  for (const product of [products.free, products.fixedFree, products.pwywZero, products.recovery, products.concurrent]) {
    assert.ok(libraryBody.items.some(item => item.productId === product.id), `${product.id} must appear in My Library.`);
  }
  assert.doesNotMatch(JSON.stringify(libraryBody), /catalog-publications|delivery_r2_key|order_item_id|purchaser_user_id/i);
  const freeItem = libraryBody.items.find(item => item.productId === products.free.id);
  response = await download.handleAuthorizedDownload(
    new Request(new URL(freeItem.downloadUrl, "https://example.test"), { headers: { cookie: `__Host-trg_session=${BUYER.token}` } }),
    env,
    { nowMs: NOW, accountSessionOptions: { nowMs: NOW } }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF);
  response = await download.handleAuthorizedDownload(
    new Request(new URL(freeItem.downloadUrl, "https://example.test"), { headers: { cookie: `__Host-trg_session=${OTHER.token}` } }),
    env,
    { nowMs: NOW, accountSessionOptions: { nowMs: NOW } }
  );
  assert.equal(response.status, 403);

  const stripeColumns = raw.prepare(`SELECT COUNT(*) n FROM orders WHERE catalog_source='native_d1'
    AND total_cents=0 AND (stripe_checkout_session_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL
      OR payment_source='stripe' OR settlement_method='external_provider')`).get().n;
  assert.equal(stripeColumns, 0, "Zero-value acquisition must never create or associate Stripe payment state.");

  const legacyEnv = {
    DOWNLOAD_SIGNING_SECRET: "legacy-free-task2l-secret-at-least-32-characters",
    TRG_ORDERS: stateDatabase("OPEN"),
    TRG_PRODUCTS: { async head() { return { size: 1 }; }, async get() { return object(PDF, "application/pdf"); } }
  };
  response = await legacyFree.handleFreeDownloadRequest(
    new Request("https://example.test/store/free-download?product=agency"),
    legacyEnv,
    { allowLegacyAnonymousAcquisition: true, nowMs: NOW }
  );
  assert.equal(response.status, 404, "Legacy free-download routing must preserve its explicit compatibility behavior for the cleared catalog.");

  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/cart/acquire-free"));
  const cartSource = fs.readFileSync(path.join(ROOT, "assets/js/cart.js"), "utf8");
  assert.match(cartSource, /NATIVE_FREE_ACQUISITION_ENDPOINT/);
  raw.close();
  console.log("Native D1 free acquisition tests passed.");
}

function nextAttempt() {
  attemptSequence += 1;
  return `trgca_2c000000-0000-4000-8000-${attemptSequence.toString(16).padStart(12, "0")}`;
}
function acquisitionRequest(user, slug, amountCents, checkoutAttemptId, options = {}) {
  const email = options.email || user?.email || "guest@example.test";
  const headers = { "content-type": "application/json", origin: options.origin || "https://example.test" };
  if (user) headers.cookie = `__Host-trg_session=${user.token}`;
  return new Request("https://example.test/api/cart/acquire-free", {
    method: "POST", headers, body: JSON.stringify({
      checkoutAttemptId, email, emailConfirmation: email,
      items: [{ slug, quantity: 1, amountCents, priceCents: 999999 }]
    })
  });
}
function libraryRequest(user) {
  return new Request("https://example.test/api/account/library", {
    headers: { cookie: `__Host-trg_session=${user.token}` }
  });
}
function assertFreeOrder(order) {
  assert.ok(order);
  assert.equal(order.total_cents, 0);
  assert.equal(order.payment_status, "paid");
  assert.equal(order.native_order_state, "free_acquired");
  assert.equal(order.payment_source, "none");
  assert.equal(order.settlement_method, "no_payment");
  assert.equal(order.native_entitlement_status, "ready");
  assert.equal(order.stripe_checkout_session_id, null);
  assert.equal(order.stripe_payment_intent_id, null);
}
function orderByAttempt(raw, attempt) {
  return raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(attempt);
}
function count(raw, table) {
  return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}
function stateDatabase(state) {
  return {
    prepare() {
      return { bind() { return this; }, async first() { return { setting_value: state, updated_at: ISO, updated_by: "test" }; } };
    }
  };
}
async function seedUser(raw, auth, user, verified) {
  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
    VALUES(?,?,?,?, 'active','user',?,?)`).run(user.id, user.email, verified ? 1 : 0, verified ? ISO : null, ISO, ISO);
  raw.prepare(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?)`).run(`${user.id}-session`, user.id, await auth.hashToken(user.token),
    await auth.hashToken(`${user.id}-csrf`), ISO, "2027-10-30T22:00:00.000Z", ISO);
}
function createBucket(keys) {
  const allowed = new Set(keys);
  return {
    async head(key) {
      return allowed.has(key) ? { httpMetadata: { contentType: "application/pdf" }, size: PDF.length } : null;
    },
    async get(key) {
      return allowed.has(key) ? object(PDF, "application/pdf") : null;
    }
  };
}
function object(bytes, contentType) {
  return {
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    httpMetadata: { contentType }, size: bytes.length
  };
}
function failNextBatch(db) {
  let fail = true;
  return {
    prepare: db.prepare.bind(db),
    async batch(statements) {
      if (fail) {
        fail = false;
        throw new Error("Injected native free entitlement failure.");
      }
      return db.batch(statements);
    }
  };
}
function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  return { raw, db: d1(raw) };
}
function d1(raw) {
  let batchQueue = Promise.resolve();
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() {
          const result = raw.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        }
      };
    },
    async batch(statements) {
      const execute = async () => {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          raw.exec("COMMIT");
          return results;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      };
      const result = batchQueue.then(execute, execute);
      batchQueue = result.catch(() => {});
      return result;
    }
  };
}
function load(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?task2l=${Math.random()}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
