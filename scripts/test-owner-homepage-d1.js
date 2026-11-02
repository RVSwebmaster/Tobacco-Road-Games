const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-11-01T18:00:00Z");
const NOW = new Date(NOW_MS).toISOString();

async function main() {
  const homepage = await load("functions/_lib/owner-homepage-publish.mjs");
  const configStore = await load("functions/_lib/homepage-config-d1.mjs");
  const shelves = await load("functions/_lib/homepage-shelves.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const auth = await load("functions/_lib/account-auth.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
  const db = d1(raw);
  for (const product of [
    fixtureProduct("homepage-new-alpha", "Homepage New Alpha", "fixed", 500),
    fixtureProduct("homepage-new-beta", "Homepage New Beta", "fixed", 700),
    fixtureProduct("homepage-free", "Homepage Free", "free", 0),
    { ...fixtureProduct("homepage-paused", "Homepage Paused", "fixed", 900), publicationState: "paused" }
  ]) await catalog.createProduct(db, product, { nowMs: NOW_MS });

  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("homepage-owner", "homepage-owner@example.invalid", 1, "owner", "active", NOW, NOW);
  const sessionToken = "homepage-owner-session-token", csrfToken = "homepage-owner-csrf-token";
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
    .run("homepage-owner-session", "homepage-owner", await auth.hashToken(sessionToken), await auth.hashToken(csrfToken),
      NOW, new Date(Date.now() + 60_000).toISOString(), NOW);
  const env = { TRG_ORDERS: db };

  let response = await homepage.handleOwnerHomepagePublishRequest(new Request("https://example.test/owner/api/homepage"), env);
  assert.equal(response.status, 401);

  response = await homepage.handleOwnerHomepagePublishRequest(ownerRequest(auth, sessionToken, csrfToken), env, { nowMs: NOW_MS });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.revision, 1);
  assert.equal(payload.csrfToken, csrfToken);
  assert.equal(payload.products.length >= 4, true);
  assert.equal(payload.products.some(product => "deliveryR2Key" in product || "coverR2Key" in product), false);
  assert.ok(payload.eligibility.newThisWeek.includes("homepage-new-alpha"));
  assert.ok(payload.eligibility.newThisWeek.includes("homepage-new-beta"));
  assert.ok(payload.eligibility.freePwyw.includes("homepage-free"));
  assert.ok(!payload.eligibility.newThisWeek.includes("homepage-paused"));
  assert.equal(payload.legacyCompatibility.source, "repository-rendered-fallback");

  const next = configStore.defaultHomepageConfiguration();
  next.shelves.featuredCreator.creatorId = "creator-rv-sawyer";
  next.shelves.featuredCreator.managed = true;
  next.shelves.featuredCreator.productIds = ["homepage-new-alpha"];
  next.shelves.newThisWeek.managed = true;
  next.shelves.newThisWeek.productIds = ["homepage-new-beta", "homepage-new-alpha"];
  next.shelves.freePwyw.managed = true;
  next.shelves.freePwyw.productIds = ["homepage-free"];
  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 1, shelves: next.shelves }), env, { nowMs: NOW_MS + 1_000 });
  assert.equal(response.status, 200, await response.clone().text());
  payload = await response.json();
  assert.equal(payload.revision, 2);
  assert.deepEqual(payload.configuration.shelves.newThisWeek.productIds, ["homepage-new-beta", "homepage-new-alpha"]);

  const publicPayload = await shelves.getHomepageShelves(db, { nowMs: NOW_MS + 1_000 });
  assert.deepEqual(publicPayload.shelves.newThisWeek.products.slice(0, 2).map(product => product.id),
    ["homepage-new-beta", "homepage-new-alpha"]);
  assert.equal(publicPayload.shelves.featuredCreator.products[0].creatorId, "creator-rv-sawyer");
  assert.equal(publicPayload.shelves.freePwyw.products[0].id, "homepage-free");

  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 1, shelves: next.shelves }), env, { nowMs: NOW_MS + 2_000 });
  assert.equal(response.status, 409);
  payload = await response.json();
  assert.equal(payload.code, "revision_conflict");
  assert.equal(payload.revision, 2);

  const invalid = configStore.defaultHomepageConfiguration();
  invalid.shelves.newThisWeek.managed = true;
  invalid.shelves.newThisWeek.productIds = ["homepage-paused"];
  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 2, shelves: invalid.shelves }), env, { nowMs: NOW_MS + 2_000 });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ineligible_product");

  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 2, shelves: next.shelves }, "wrong"), env);
  assert.equal(response.status, 403);

  const cleared = JSON.parse(JSON.stringify(next));
  cleared.shelves.newThisWeek.productIds = [];
  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 2, shelves: cleared.shelves }), env, { nowMs: NOW_MS + 2_500 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 3);
  assert.deepEqual((await shelves.getHomepageShelves(db, { nowMs: NOW_MS + 2_500 })).shelves.newThisWeek.products, []);
  response = await homepage.handleOwnerHomepagePublishRequest(
    ownerRequest(auth, sessionToken, csrfToken, { expectedRevision: 3, shelves: next.shelves }), env, { nowMs: NOW_MS + 2_750 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 4);

  let alpha = await catalog.getProductById(db, "homepage-new-alpha");
  alpha = await catalog.updateProduct(db, alpha.id, { publicationState: "paused" }, { expectedRevision: alpha.revision, nowMs: NOW_MS + 3_000 });
  assert.equal(alpha.publicationState, "paused");
  const filtered = await shelves.getHomepageShelves(db, { nowMs: NOW_MS + 3_000 });
  assert.ok(!filtered.shelves.newThisWeek.products.some(product => product.id === alpha.id));
  assert.ok(!filtered.shelves.featuredCreator.products.some(product => product.id === alpha.id));
  assert.ok(filtered.shelves.newThisWeek.suppressedSlugs.includes(alpha.slug));
  assert.deepEqual((await configStore.getHomepageConfiguration(db)).configuration.shelves.newThisWeek.productIds,
    ["homepage-new-beta", "homepage-new-alpha"], "Visibility changes must not rewrite the authoritative selection history.");

  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  raw.close();
  console.log("Native Owner homepage D1 tests passed.");
}

function fixtureProduct(id, title, pricingModel, priceCents) {
  return {
    id, slug: id, creatorId: "creator-rv-sawyer", publicationState: "published", publishedAt: NOW,
    title, status: pricingModel === "free" ? "free-download" : "available-direct",
    buyMode: pricingModel === "free" ? "free-download" : "cart", currency: "USD", pricingModel, priceCents,
    coverR2Key: `catalog-publications/${id}/cover.webp`, deliveryR2Key: `catalog-publications/${id}/delivery.pdf`,
    deliveryFilename: `${id}.pdf`, deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], releaseDate: NOW.slice(0, 10) }
  };
}
function ownerRequest(auth, sessionToken, csrfToken, body, csrfHeader = csrfToken) {
  const headers = {
    cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${sessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${csrfToken}`,
    origin: "https://example.test"
  };
  if (body) {
    headers["content-type"] = "application/json";
    headers["x-csrf-token"] = csrfHeader;
  }
  return new Request("https://example.test/owner/api/homepage", {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined
  });
}
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href); }
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
