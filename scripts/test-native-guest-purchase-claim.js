const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-02T17:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const EMAIL = "task2pa-guest@example.test";
const EMAIL_SECRET = "task-2pa-email-hash-secret";
const COOKIE_SECRET = "task-2pa-checkout-cookie-secret";
const ACCESS_SECRET = "task-2pa-order-access-secret-long-enough";
const DOWNLOAD_SECRET = "task-2pa-download-secret-long-enough";
const WEBHOOK_SECRET = "whsec_task2pa_signed_test_event";
const PDF = new TextEncoder().encode("%PDF-1.7\nTask 2P-A guest purchase\n%%EOF\n");

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const checkout = await load("functions/_lib/cart-checkout.mjs");
  const quote = await load("functions/_lib/cart-quote.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const access = await load("functions/_lib/order-access.mjs");
  const accessPage = await load("functions/_lib/order-access-page.mjs");
  const claim = await load("functions/_lib/account-order-claim.mjs");
  const library = await load("functions/_lib/account-library.mjs");
  const download = await load("functions/_lib/download-route.mjs");
  const preparation = await load("functions/_lib/native-order-preparation.mjs");
  const privacy = await load("functions/_lib/order-privacy.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");

  const base = {
    creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 575, currency: "USD",
    coverR2Key: "catalog-publications/task2pa/fixed-cover.webp",
    deliveryR2Key: "catalog-publications/task2pa-fixed/delivery.pdf",
    deliveryFilename: "Task 2P-A Fixed.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  };
  await catalog.createProduct(db, { ...base, id: "task2pa-fixed", slug: "task2pa-fixed", title: "Task 2P-A Fixed" }, { nowMs: NOW });
  await catalog.createProduct(db, {
    ...base, id: "task2pa-pwyw", slug: "task2pa-pwyw", title: "Task 2P-A PWYW",
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 900,
    minimumPriceCents: 250, suggestedPriceCents: 900,
    coverR2Key: "catalog-publications/task2pa/pwyw-cover.webp",
    deliveryR2Key: "catalog-publications/task2pa-pwyw/delivery.pdf",
    deliveryFilename: "Task 2P-A PWYW.pdf"
  }, { nowMs: NOW });
  await catalog.createProduct(db, {
    ...base, id: "task2pa-account", slug: "task2pa-account", title: "Task 2P-A Account"
  }, { nowMs: NOW });

  const emailHash = await privacy.createCustomerEmailHash(EMAIL, EMAIL_SECRET);
  let response = await checkout.handleCartCheckoutRequest(jsonRequest("/api/cart/checkout", {
    checkoutAttemptId: "trgca_2f000000-0000-4000-8000-000000000000",
    email: EMAIL, emailConfirmation: EMAIL, items: [{ slug: "task2pa-fixed", quantity: 1 }]
  }), baseEnv(db), { nativeGuestCheckoutEnabled: true, now: NOW, stripeFetchImpl: stripeHarness().fetch });
  let body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "verified_email_required");
  assert.equal(count(raw, "orders"), 0, "An unverified guest identity must not create an order.");
  raw.prepare(`INSERT INTO guest_email_verifications(email_hash,email_normalized,code_hash,verified_at,expires_at,attempt_count,created_at)
    VALUES(?,?,?, ?,?,0,?)`).run(emailHash, EMAIL, "verified-code-hash", ISO, new Date(NOW + 86400000).toISOString(), ISO);

  const cart = {
    checkoutAttemptId: "trgca_2f000000-0000-4000-8000-000000000001",
    email: EMAIL, emailConfirmation: EMAIL,
    items: [{ slug: "task2pa-fixed", quantity: 1 }, { slug: "task2pa-pwyw", quantity: 1, amountCents: 725 }]
  };
  response = await quote.handleCartQuoteRequest(jsonRequest("/api/cart/quote", { items: cart.items }), { database: db });
  body = await response.json();
  assert.equal(body.checkoutAllowed, false, "Native guest checkout must be disabled by default.");
  assert.equal(body.checkoutMode, "legacy");

  response = await checkout.handleCartCheckoutRequest(jsonRequest("/api/cart/checkout", cart), baseEnv(db), {
    nativeGuestCheckoutEnabled: false, now: NOW
  });
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_checkout_unavailable");
  assert.equal(count(raw, "orders"), 0, "A disabled guest attempt must not create an order.");

  response = await quote.handleCartQuoteRequest(jsonRequest("/api/cart/quote", { items: cart.items }), {
    database: db, nativeGuestCheckoutEnabled: true
  });
  body = await response.json();
  assert.equal(body.checkoutAllowed, true);
  assert.equal(body.checkoutMode, "native-paid");
  assert.equal(body.totalCents, 1300);

  const stripe = stripeHarness();
  response = await checkout.handleCartCheckoutRequest(jsonRequest("/api/cart/checkout", cart), baseEnv(db), {
    nativeGuestCheckoutEnabled: true, now: NOW,
    publicIdGenerator: () => "TRG-TASK2PA-GUEST",
    stripeFetchImpl: stripe.fetch
  });
  body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.totalCents, 1300);
  assert.equal(stripe.calls.length, 1);
  assert.equal(stripe.calls[0].get("line_items[0][price_data][unit_amount]"), "575");
  assert.equal(stripe.calls[0].get("line_items[1][price_data][unit_amount]"), "725");
  assert.doesNotMatch(JSON.stringify(body), /delivery_r2|catalog-publications|customer_email_hash/i);

  response = await checkout.handleCartCheckoutRequest(jsonRequest("/api/cart/checkout", cart), baseEnv(db), {
    nativeGuestCheckoutEnabled: true, now: NOW, stripeFetchImpl: stripe.fetch
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(stripe.calls.length, 1, "A retried browser checkout must reuse the Stripe Session.");

  let order = raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(cart.checkoutAttemptId);
  assert.equal(order.user_id, null);
  assert.equal(order.customer_email_hash, emailHash);
  assert.equal(order.total_cents, 1300);
  const snapshots = raw.prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY id").all(order.id);
  assert.deepEqual(snapshots.map(row => row.selected_price_cents), [575, 725]);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM email_outbox WHERE order_id=?").get(order.id).n, 0,
    "Preparing an order must not issue a purchase notification.");

  const deliveryCalls = [];
  let failDeliveryOnce = true;
  const webhookEnv = {
    ORDER_ACCESS_SIGNING_SECRET: ACCESS_SECRET, PAYMENT_PIPELINE_STAGE: "staging",
    PUBLIC_SITE_ORIGIN: "https://example.test", RESEND_API_KEY: "re_task2pb_test",
    RESEND_DELIVERY_ENABLED: "true", RESEND_REPLY_TO: "support@example.test",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TRG_ORDERS: db,
    TRG_PRODUCTS: {
      async head(key) {
        return ["catalog-publications/task2pa-fixed/delivery.pdf", "catalog-publications/task2pa-pwyw/delivery.pdf"].includes(key)
          ? { size: PDF.byteLength }
          : null;
      }
    }
  };
  const deliveryFetchImpl = async (_url, options) => {
    deliveryCalls.push({ body: String(options.body), key: options.headers["idempotency-key"] });
    if (failDeliveryOnce) {
      failDeliveryOnce = false;
      return providerResponse({ name: "internal_server_error" }, 500);
    }
    return providerResponse({ id: "email_task2pb_guest_claim" }, 200);
  };
  response = await webhook.handleStripeWebhookRequest(await webhookRequest(order), webhookEnv, {
    deliveryFetchImpl, nowMs: NOW
  });
  body = await response.json();
  assert.equal(response.status, 500, "A retryable email-provider failure must keep the verified paid event retryable.");
  order = raw.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  assert.equal(order.payment_status, "paid");
  assert.equal(order.native_entitlement_status, "ready");
  let entitlements = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=? ORDER BY id").all(order.id);
  assert.equal(entitlements.length, 2);
  assert.ok(entitlements.every(row => row.purchaser_user_id === null));
  assert.equal(raw.prepare("SELECT status FROM email_outbox WHERE order_id=?").get(order.id).status, "delayed");

  response = await webhook.handleStripeWebhookRequest(await webhookRequest(order), webhookEnv, {
    deliveryFetchImpl, nowMs: NOW + 1000
  });
  body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.duplicate, true);
  assert.equal(deliveryCalls.length, 2);
  assert.equal(deliveryCalls[0].key, deliveryCalls[1].key, "Webhook retries must reuse the provider idempotency key.");
  assert.equal(deliveryCalls[0].body, deliveryCalls[1].body, "Webhook retries must reuse the exact email payload.");
  response = await webhook.handleStripeWebhookRequest(await webhookRequest(order), webhookEnv, {
    deliveryFetchImpl, nowMs: NOW + 2000
  });
  assert.equal(response.status, 200);
  assert.equal(deliveryCalls.length, 2, "An accepted purchase notification must not be sent again.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM email_outbox WHERE order_id=?").get(order.id).n, 1);
  const emailPayload = JSON.parse(deliveryCalls[1].body);
  assert.match(emailPayload.subject, /TRG-TASK2PA-GUEST/);
  assert.match(emailPayload.text, /Claim this purchase/);
  assert.match(emailPayload.html, /Claim your purchase/);
  assert.match(emailPayload.text, /30 days/);
  assert.doesNotMatch(JSON.stringify(emailPayload), /catalog-publications|delivery_r2|order_item_id|purchaser_email_hash/i);

  await seedUser(raw, auth, { id: "task2pa-buyer", email: EMAIL, token: "task2pa-buyer-token", csrf: "task2pa-buyer-csrf" });
  await seedUser(raw, auth, { id: "task2pa-other", email: "other-task2pa@example.test", token: "task2pa-other-token", csrf: "task2pa-other-csrf" });
  const orderAccess = await access.ensureActiveOrderAccessCredential(db, order, ACCESS_SECRET, {
    expiresAt: new Date(NOW + 30 * 86400000).toISOString(), nowMs: NOW
  });
  assert.equal(orderAccess.credential.expires_at, new Date(NOW + 30 * 86400000).toISOString());
  const claimEnv = { ORDER_ACCESS_SIGNING_SECRET: ACCESS_SECRET, PAYMENT_PIPELINE_STAGE: "staging", TRG_ORDERS: db };

  response = await accessPage.handleOrderAccessPage(new Request(`https://example.test/store/order-access?credential=${encodeURIComponent(orderAccess.token)}`), {
    ...claimEnv, NATIVE_GUEST_CLAIM_MODE: "staging-verification"
  }, { nowMs: NOW + 2000 });
  assert.equal(response.status, 200);
  const accessHtml = await response.text();
  assert.match(accessHtml, /Claim your purchase/);
  assert.match(accessHtml, /account\.html\?claim=/);
  assert.doesNotMatch(accessHtml, /catalog-publications|delivery_r2|\.pdf/i);

  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-buyer", orderAccess.token), claimEnv, {
    nativeGuestClaimEnabled: false, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  assert.equal(response.status, 503, "Native claiming must remain disabled by default.");
  assert.equal(raw.prepare("SELECT user_id FROM orders WHERE id=?").get(order.id).user_id, null);

  const claimRouteSource = fs.readFileSync(path.join(ROOT, "functions/api/account/claim-order.js"), "utf8");
  assert.match(claimRouteSource, /handleAccountOrderClaimRequest\(context\.request, context\.env\)/,
    "The Pages route must adapt its context to the request handler.");
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/checkout-email/*"),
    "Guest checkout email verification must route through Pages Functions.");
  assert.ok(routes.include.includes("/api/account/profile"),
    "The account claim experience must route the existing account profile request through Pages Functions.");
  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-other", orderAccess.token), claimEnv, {
    nativeGuestClaimEnabled: true, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  assert.equal(response.status, 400, "Knowing an order credential under a different verified identity must not claim ownership.");
  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-buyer", `${orderAccess.token}altered`), claimEnv, {
    nativeGuestClaimEnabled: true, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  assert.equal(response.status, 400);

  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-buyer", orderAccess.token), claimEnv, {
    nativeGuestClaimEnabled: true, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.duplicate, false);
  order = raw.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  entitlements = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=? ORDER BY id").all(order.id);
  assert.equal(order.user_id, "task2pa-buyer");
  assert.ok(entitlements.every(row => row.purchaser_user_id === "task2pa-buyer"));
  assert.deepEqual(entitlements.map(row => row.selected_price_cents_snapshot), [575, 725]);

  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-buyer", orderAccess.token), claimEnv, {
    nativeGuestClaimEnabled: true, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM historical_order_claim_audit WHERE order_id=? AND outcome='succeeded'").get(order.id).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(order.id).n, 2);
  const consumed = raw.prepare("SELECT consumed_at,consumed_by_user_id FROM order_access_credentials WHERE id=?").get(orderAccess.credential.id);
  assert.equal(consumed.consumed_by_user_id, "task2pa-buyer");
  assert.ok(consumed.consumed_at);

  const bucket = createBucket(snapshots);
  const customerEnv = { DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET, TRG_ORDERS: db, TRG_PRODUCTS: bucket };
  response = await library.handleAccountLibraryRequest(new Request("https://example.test/api/account/library", {
    headers: { cookie: "__Host-trg_session=task2pa-buyer-token" }
  }), customerEnv, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  const libraryPayload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(libraryPayload.items.filter(item => item.orderReference === order.public_id).length, 2);
  assert.doesNotMatch(JSON.stringify(libraryPayload), /catalog-publications|delivery_r2|order_item_id|purchaser_user_id/i);
  const downloadUrl = new URL(libraryPayload.items.find(item => item.productId === "task2pa-fixed").downloadUrl, "https://example.test");
  response = await download.handleAuthorizedDownload(new Request(downloadUrl, {
    headers: { cookie: "__Host-trg_session=task2pa-buyer-token" }
  }), customerEnv, { nowMs: NOW, accountSessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF);

  let product = await catalog.getProductById(db, "task2pa-fixed");
  await catalog.updateProduct(db, product.id, { priceCents: 1900, publicationState: "paused" }, {
    expectedRevision: product.revision, nowMs: NOW + 1000
  });
  response = await library.handleAccountLibraryRequest(new Request("https://example.test/api/account/library", {
    headers: { cookie: "__Host-trg_session=task2pa-buyer-token" }
  }), customerEnv, { nowMs: NOW + 1000, sessionOptions: { nowMs: NOW + 1000 } });
  assert.ok((await response.json()).items.some(item => item.productId === "task2pa-fixed"));

  raw.prepare("UPDATE order_access_credentials SET expires_at=? WHERE id=?").run(
    new Date(NOW - 1000).toISOString(), orderAccess.credential.id
  );
  response = await claim.handleAccountOrderClaimRequest(claimRequest("task2pa-buyer", orderAccess.token), claimEnv, {
    nativeGuestClaimEnabled: true, nowMs: NOW, sessionOptions: { nowMs: NOW }
  });
  assert.equal(response.status, 400, "An expired claim credential must be rejected even for the matching account.");

  const registered = await preparation.handleNativeOrderPreparationRequest(jsonRequest("/api/cart/prepare-order", {
    checkoutAttemptId: "trgca_2f000000-0000-4000-8000-000000000002",
    email: EMAIL, emailConfirmation: EMAIL, items: [{ slug: "task2pa-account", quantity: 1 }]
  }), { ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, PAYMENT_PIPELINE_STAGE: "staging", TRG_ORDERS: db }, {
    accountSession: { valid: true, user: { email: EMAIL, email_normalized: EMAIL, email_verified: 1, id: "task2pa-buyer" } },
    includeNative: true, now: NOW + 2000, publicIdGenerator: () => "TRG-TASK2PA-ACCOUNT"
  });
  assert.equal(registered.status, 201, "Registered native preparation must remain available while the guest gate is off.");

  assert.throws(() => raw.prepare("UPDATE native_product_entitlements SET purchaser_user_id='task2pa-other' WHERE order_id=?").run(order.id), /not authorized/);
  raw.close();
  console.log("Native guest purchase notification and verified account-claim tests passed.");
}

function baseEnv(db) {
  return {
    CHECKOUT_ACCESS_COOKIE_SECRET: COOKIE_SECRET, NATIVE_GUEST_CHECKOUT_MODE: "disabled",
    ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, PAYMENT_PIPELINE_STAGE: "staging",
    STRIPE_SECRET_KEY: "sk_test_task2pa", TRG_ORDERS: db
  };
}

function stripeHarness() {
  const calls = [];
  return {
    calls,
    async fetch(_url, options) {
      calls.push(new URLSearchParams(String(options.body || "")));
      return providerResponse({ id: "cs_test_task2pa_guest", livemode: false, ui_mode: "hosted_page", url: "https://checkout.stripe.test/task2pa" });
    }
  };
}

async function webhookRequest(order) {
  const event = {
    api_version: "2026-06-24.dahlia", created: Math.floor(NOW / 1000), id: "evt_task2pa_paid",
    livemode: false, object: "event", type: "checkout.session.completed", data: { object: {
      amount_total: Number(order.total_cents), currency: "usd", id: order.stripe_checkout_session_id,
      livemode: false, object: "checkout.session", payment_intent: "pi_task2pa_paid", payment_status: "paid", ui_mode: "hosted_page",
      metadata: { trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id), trg_order_public_id: order.public_id, trg_order_source: "native_d1" }
    } }
  };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${Buffer.from(new Uint8Array(signed)).toString("hex")}` }, body
  });
}

async function seedUser(raw, auth, user) {
  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
    VALUES(?,?,1,?,'active','user',?,?)`).run(user.id, user.email, ISO, ISO, ISO);
  raw.prepare(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?)`).run(`${user.id}-session`, user.id, await auth.hashToken(user.token), await auth.hashToken(user.csrf), ISO,
    new Date(NOW + 86400000).toISOString(), ISO);
}

function claimRequest(name, credential) {
  return new Request("https://example.test/api/account/claim-order", {
    method: "POST", headers: {
      cookie: `__Host-trg_session=${name}-token; trg_account_csrf=${name}-csrf`,
      "content-type": "application/json", origin: "https://example.test", "x-csrf-token": `${name}-csrf`
    }, body: JSON.stringify({ credential })
  });
}

function createBucket(items) {
  const keys = new Set(items.map(item => item.delivery_r2_key_snapshot));
  return { async get(key) { return keys.has(key) ? { body: new Blob([PDF]).stream(), size: PDF.length } : null; } };
}

function jsonRequest(route, body) {
  return new Request(`https://example.test${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  return {
    prepare(sql) {
      let values = [];
      return {
        _sql: sql,
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
      };
    },
    async batch(statements) {
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
    }
  };
}

function count(raw, table) { return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; }
function providerResponse(payload, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?task2pa=${Math.random()}`); }

main().catch(error => { console.error(error); process.exitCode = 1; });
