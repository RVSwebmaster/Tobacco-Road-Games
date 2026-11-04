const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-29T18:00:00.000Z");

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const quote = await load("functions/_lib/cart-quote.mjs");
  const checkout = await load("functions/_lib/cart-checkout.mjs");
  const hybrid = await load("functions/_lib/cart-catalog.mjs");
  const accountAuth = await load("functions/_lib/account-auth.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  raw.exec(`INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,closure_state,created_at,updated_at)
    VALUES('creator-ineligible','creator-ineligible','Ineligible Creator','suspended','suspended','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  const db = d1(raw);
  const base = { creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500, currency: "USD",
    coverR2Key: "catalog-publications/test/cover.webp", deliveryR2Key: "catalog-publications/test/delivery.pdf",
    deliveryFilename: "private.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" } };
  const fixed = await catalog.createProduct(db, { ...base, id: "native-fixed", slug: "native-fixed", title: "Native Fixed" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-free", slug: "native-free", title: "Native Free",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0 }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-pwyw", slug: "native-pwyw", title: "Native PWYW",
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 700,
    minimumPriceCents: 250, suggestedPriceCents: 700 }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-draft", slug: "native-draft", title: "Native Draft",
    publicationState: "draft" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-paused", slug: "native-paused", title: "Native Paused",
    publicationState: "paused" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-conflict", slug: "native-conflict", title: "Native Conflict Draft",
    publicationState: "draft" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "native-ineligible", slug: "native-ineligible", title: "Native Ineligible",
    creatorId: "creator-ineligible" }, { nowMs: NOW });

  const legacyProducts = [
    legacy("legacy-fixed", 400),
    legacy("native-conflict", 111)
  ];
  const requestQuote = items => quote.handleCartQuoteRequest(new Request("https://example.test/api/cart/quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items })
  }), { database: db, catalogProducts: legacyProducts, includeNative: true, now: NOW });

  let response = await requestQuote([{ slug: "native-fixed", productId: "forged-product-id", quantity: 1, amountCents: 1, priceCents: 1 }]);
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].effectivePriceCents, 500, "Fixed prices must ignore manipulated client amounts and prices.");
  assert.equal(body.items[0].catalogSource, "native-d1");
  assert.equal(body.items[0].catalogRevision, 1);
  assert.equal(body.checkoutAllowed, false);
  assert.equal(body.items[0].deliveryR2Key, undefined);
  assert.equal(JSON.stringify(body).includes("catalog-publications/test/delivery.pdf"), false);

  const sessionToken = "authenticated-native-quote-session";
  const sessionTokenHash = await accountAuth.hashToken(sessionToken);
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("authenticated-quote-user", "authenticated-quote@example.test", 1, "active", "user", "2026-10-29T18:00:00.000Z", "2026-10-29T18:00:00.000Z");
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
    .run("authenticated-quote-session", "authenticated-quote-user", sessionTokenHash, "csrf-hash", "2026-10-29T18:00:00.000Z", "2099-01-01T00:00:00.000Z", "2026-10-29T18:00:00.000Z");
  response = await quote.handleCartQuoteRequest(new Request("https://example.test/api/cart/quote", {
    method: "POST",
    headers: { cookie: `__Host-trg_session=${sessionToken}`, "content-type": "application/json" },
    body: JSON.stringify({ items: [{ slug: "native-fixed", quantity: 1 }] })
  }), {
    database: db,
    catalogProducts: legacyProducts,
    env: { PAYMENT_PIPELINE_STAGE: "staging", NATIVE_GUEST_CHECKOUT_MODE: "disabled", TRG_ORDERS: db },
    includeNative: true,
    now: NOW
  });
  body = await response.json();
  assert.equal(body.checkoutAllowed, true,
    "A signed-in verified customer must receive an enabled native paid quote while guest checkout remains disabled.");
  assert.equal(body.checkoutMode, "native-paid");
  response = await requestQuote([{ productId: "native-fixed", quantity: 1 }]);
  assert.equal(response.status, 400, "A product ID cannot substitute for the authoritative cart slug.");

  body = await (await requestQuote([{ slug: "native-free", quantity: 1, amountCents: 9999 }])).json();
  assert.equal(body.items[0].effectivePriceCents, 0, "Free D1 products must remain server-authoritative at zero cents.");

  body = await (await requestQuote([{ slug: "native-pwyw", quantity: 1, amountCents: 525 }])).json();
  assert.equal(body.items[0].effectivePriceCents, 525);
  assert.equal(body.items[0].minimumPriceCents, 250);
  assert.equal(body.items[0].suggestedPriceCents, 700);
  body = await (await requestQuote([{ slug: "native-pwyw", quantity: 1, amountCents: 249 }])).json();
  assert.equal(body.items.length, 0);
  assert.equal(body.unavailableItems[0].code, "pwyw_below_minimum");
  body = await (await requestQuote([{ slug: "native-pwyw", quantity: 1 }])).json();
  assert.equal(body.unavailableItems[0].code, "invalid_pwyw_amount");

  for (const [slug, code] of [
    ["native-draft", "unpublished_product"],
    ["native-paused", "paused_product"],
    ["native-ineligible", "ineligible_creator"],
    ["unknown-native", "unknown_slug"]
  ]) {
    body = await (await requestQuote([{ slug, quantity: 1 }])).json();
    assert.equal(body.items.length, 0, `${slug} must not be quoted as available.`);
    assert.equal(body.unavailableItems[0].code, code);
  }

  body = await (await requestQuote([{ slug: "native-conflict", quantity: 1 }])).json();
  assert.equal(body.items.length, 0, "A draft D1 identity must suppress a conflicting legacy price.");
  assert.equal(body.unavailableItems[0].code, "unpublished_product");

  body = await (await requestQuote([
    { slug: "legacy-fixed", quantity: 1 },
    { slug: "native-fixed", quantity: 1 }
  ])).json();
  assert.deepEqual(body.items.map(item => [item.slug, item.effectivePriceCents]), [
    ["legacy-fixed", 400], ["native-fixed", 500]
  ]);
  assert.equal(body.totalCents, 900, "Mixed carts must total legacy and D1 authoritative prices.");
  assert.equal(body.checkoutAllowed, false, "Mixed carts containing native products must not activate payment.");

  const updated = await catalog.updateProduct(db, fixed.id, { title: "Native Fixed Revised", priceCents: 650 }, {
    expectedRevision: fixed.revision, nowMs: NOW + 60_000
  });
  body = await (await requestQuote([{ slug: "native-fixed", quantity: 1, catalogRevision: 1, priceCents: 500 }])).json();
  assert.equal(body.items[0].title, "Native Fixed Revised");
  assert.equal(body.items[0].effectivePriceCents, 650);
  assert.equal(body.items[0].catalogRevision, updated.revision, "Every quote must read the current D1 revision.");

  const legacyOnly = await quote.handleCartQuoteRequest(new Request("https://example.test/api/cart/quote", {
    method: "POST", body: JSON.stringify({ items: [{ slug: "legacy-fixed", quantity: 1 }] })
  }), { catalogProducts: legacyProducts, now: NOW });
  const legacyBody = await legacyOnly.json();
  assert.equal(legacyBody.items[0].effectivePriceCents, 400);
  assert.equal(legacyBody.checkoutAllowed, true, "The existing legacy quote path must remain checkout-compatible.");

  const resolved = await hybrid.resolveHybridCartCatalog(db, ["native-fixed"], {
    catalogProducts: legacyProducts, includeNative: true
  });
  assert.equal(resolved.catalogMap.get("native-fixed").deliveryR2Key, "catalog-publications/test/delivery.pdf",
    "The private delivery reference must remain available internally for later fulfillment work.");

  let stripeCalled = false;
  response = await checkout.handleCartCheckoutRequest(new Request("https://example.test/api/cart/checkout", {
    method: "POST", body: JSON.stringify({
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000002002",
      email: "buyer@example.test", emailConfirmation: "buyer@example.test",
      items: [{ slug: "native-fixed", quantity: 1 }]
    })
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: "cookie-secret", ORDER_EMAIL_HASH_SECRET: "email-secret",
    STRIPE_SECRET_KEY: "sk_test_must_not_run", TRG_ORDERS: db
  }, {
    catalogProducts: legacyProducts, includeNative: true, now: NOW,
    stripeFetchImpl: async () => { stripeCalled = true; throw new Error("Stripe must not be called."); }
  });
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_checkout_unavailable");
  assert.equal(stripeCalled, false);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 0,
    "Native quote-only products must not create pending orders or entitlements.");

  raw.close();
  console.log("D1 cart pricing and native checkout-boundary tests passed.");
}

function legacy(slug, priceCents) {
  return { slug, title: slug, authorDisplay: "Legacy Author", authorSlugs: ["legacy-author"],
    buyMode: "cart", status: "available-direct", pricingModel: "fixed", currency: "USD",
    priceCents, saleEnabled: false, coverUrl: `/product-assets/${slug}/cover.webp`, version: "legacy" };
}

function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
      };
    },
    async batch(statements) { const results = []; for (const statement of statements) results.push(await statement.run()); return results; }
  };
}

function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
