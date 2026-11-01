const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-11-01T15:00:00Z");
const NOW = new Date(NOW_MS).toISOString();

async function main() {
  const pricing = await import(pathToFileURL(path.join(ROOT, "functions/_lib/owner-pricing-publish.mjs")).href);
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions/_lib/account-auth.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
  const db = d1(raw);
  const created = await catalog.createProduct(db, {
    id: "pricing-native-product", slug: "pricing-native-product", creatorId: "creator-rv-sawyer",
    publicationState: "published", publishedAt: NOW, title: "Native Pricing Product",
    status: "available-direct", buyMode: "cart", currency: "USD", pricingModel: "fixed", priceCents: 500,
    coverR2Key: "catalog-publications/pricing/cover.webp",
    deliveryR2Key: "catalog-publications/pricing/delivery.pdf",
    deliveryFilename: "Native-Pricing-Product.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], version: "1.0" }
  }, { nowMs: NOW_MS });

  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("pricing-owner", "pricing-owner@example.invalid", 1, "owner", "active", NOW, NOW);
  const sessionToken = "pricing-owner-session-token", csrfToken = "pricing-owner-csrf-token";
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
    .run("pricing-owner-session", "pricing-owner", await auth.hashToken(sessionToken), await auth.hashToken(csrfToken),
      NOW, new Date(Date.now() + 60_000).toISOString(), NOW);
  const env = { TRG_ORDERS: db };

  const unauthenticated = await pricing.handleOwnerPricingPublishRequest(
    new Request("https://example.test/owner/api/pricing"), env);
  assert.equal(unauthenticated.status, 401);

  const listResponse = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken), env);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.csrfToken, csrfToken);
  const listed = list.products.find(product => product.slug === created.slug);
  assert.equal(listed.revision, 1);
  assert.equal(listed.source, "native-d1");
  assert.equal(listed.editable, true);
  assert.equal("coverR2Key" in listed, false);
  assert.equal("deliveryR2Key" in listed, false);

  const wrongCsrf = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, fixedInput(1, 725), "wrong"), env);
  assert.equal(wrongCsrf.status, 403);

  let response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, fixedInput(1, 725)), env, { nowMs: NOW_MS + 1_000 });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.product.priceCents, 725);
  assert.equal(payload.product.revision, 2);
  let stored = await catalog.getProductBySlug(db, created.slug);
  assert.equal(stored.coverR2Key, created.coverR2Key);
  assert.equal(stored.deliveryR2Key, created.deliveryR2Key);
  assert.equal(stored.creatorId, created.creatorId);
  assert.equal(stored.id, created.id);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, fixedInput(1, 900)), env);
  assert.equal(response.status, 409);
  payload = await response.json();
  assert.equal(payload.code, "revision_conflict");
  assert.equal(payload.product.revision, 2);
  assert.equal((await catalog.getProductBySlug(db, created.slug)).priceCents, 725);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, fixedInput(2, 0)), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /positive price/i);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, {
    ...baseInput(2), pricingModel: "free", priceCents: 0
  }), env, { nowMs: NOW_MS + 2_000 });
  assert.equal(response.status, 200);
  stored = await catalog.getProductBySlug(db, created.slug);
  assert.equal(stored.revision, 3);
  assert.equal(stored.pricingModel, "free");
  assert.equal(stored.status, "free-download");
  assert.equal(stored.buyMode, "free-download");
  assert.equal(stored.priceCents, 0);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, {
    ...baseInput(3), pricingModel: "pwyw", priceCents: 650, suggestedPriceCents: 650, minimumPriceCents: 200
  }), env, { nowMs: NOW_MS + 3_000 });
  assert.equal(response.status, 200);
  stored = await catalog.getProductBySlug(db, created.slug);
  assert.equal(stored.revision, 4);
  assert.equal(stored.pricingModel, "pwyw");
  assert.equal(stored.suggestedPriceCents, 650);
  assert.equal(stored.minimumPriceCents, 200);
  assert.equal(stored.status, "pay-what-you-want");
  assert.equal(stored.buyMode, "cart");

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, {
    ...baseInput(4), pricingModel: "pwyw", priceCents: 100, suggestedPriceCents: 100, minimumPriceCents: 200
  }), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /at or above/i);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, {
    ...baseInput(4), availability: "paused", pricingModel: "pwyw", priceCents: 650,
    suggestedPriceCents: 650, minimumPriceCents: 200
  }), env, { nowMs: NOW_MS + 4_000 });
  assert.equal(response.status, 200);
  stored = await catalog.getProductBySlug(db, created.slug);
  assert.equal(stored.publicationState, "paused");
  assert.equal(stored.revision, 5);

  response = await pricing.handleOwnerPricingPublishRequest(ownerRequest(auth, sessionToken, csrfToken, {
    ...baseInput(5), availability: "paused", pricingModel: "pwyw", priceCents: 650,
    suggestedPriceCents: 650, minimumPriceCents: 200
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "no_changes");

  assert.equal(stored.coverR2Key, created.coverR2Key);
  assert.equal(stored.deliveryR2Key, created.deliveryR2Key);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  raw.close();
  console.log("Native Owner D1 pricing tests passed.");
}

function baseInput(expectedRevision) {
  return {
    availability: "available", currency: "USD", expectedRevision,
    minimumPriceCents: null, priceCents: 500, pricingModel: "fixed",
    saleEnabled: false, saleEnd: "", saleLabel: "", salePriceCents: null,
    saleStart: "", slug: "pricing-native-product", suggestedPriceCents: null
  };
}
function fixedInput(revision, priceCents) { return { ...baseInput(revision), priceCents }; }
function ownerRequest(auth, sessionToken, csrfToken, body, csrfHeader = csrfToken) {
  const headers = {
    cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${sessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${csrfToken}`,
    origin: "https://example.test"
  };
  if (body) {
    headers["content-type"] = "application/json";
    headers["x-csrf-token"] = csrfHeader;
  }
  return new Request("https://example.test/owner/api/pricing", {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined
  });
}
function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values).changes) } }; }
      };
    }
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
