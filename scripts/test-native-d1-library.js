const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-30T20:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const SECRET = "task-2k-download-signing-secret-long-enough";
const PDF = new TextEncoder().encode("%PDF-1.7\nTask 2K purchased PDF\n%%EOF\n");
const LEGACY_PDF = new TextEncoder().encode("%PDF-1.7\nTask 2K legacy PDF\n%%EOF\n");
const WEBP = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const BUYER = { id: "task2k-buyer", email: "task2k-buyer@example.test", token: "task2k-buyer-token" };
const OTHER = { id: "task2k-other", email: "task2k-other@example.test", token: "task2k-other-token" };

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const nativeOrders = await load("functions/_lib/native-orders-d1.mjs");
  const ownership = await load("functions/_lib/native-entitlements-d1.mjs");
  const library = await load("functions/_lib/account-library.mjs");
  const covers = await load("functions/_lib/account-library-cover.mjs");
  const download = await load("functions/_lib/download-route.mjs");
  const { raw, db } = database();
  await seedUser(raw, auth, BUYER);
  await seedUser(raw, auth, OTHER);

  const product = await catalog.createProduct(db, {
    id: "task2k-native-id", slug: "task2k-native-product", creatorId: "creator-rv-sawyer",
    title: "Task 2K Purchased Title", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 725, currency: "USD",
    coverR2Key: "catalog-publications/task2k-original/cover.webp",
    deliveryR2Key: "catalog-publications/task2k-original/delivery.pdf",
    deliveryFilename: "Task 2K Purchased.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2.4" }
  }, { nowMs: NOW });
  const native = await paidNativeFixture(nativeOrders, ownership, db, raw, product);
  seedLegacy(raw, BUYER.id, "task2k-native-product", "Legacy Duplicate", "duplicate/private.pdf", "Duplicate.pdf");
  const legacy = seedLegacy(raw, BUYER.id, "task2k-legacy-product", "Legacy Library Product", "legacy/private.pdf", "Legacy Product.pdf");

  const bucket = createBucket(product);
  const env = { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: db, TRG_PRODUCTS: bucket };
  const buyerRequest = () => libraryRequest(BUYER.token);
  let response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  let payload = await response.json();
  assert.equal(payload.items.length, 2, "Native ownership must replace a conflicting legacy slug without hiding distinct legacy purchases.");
  let nativeItem = payload.items.find(item => item.productId === product.id);
  const legacyItem = payload.items.find(item => item.productId === "task2k-legacy-product");
  assert.ok(nativeItem);
  assert.ok(legacyItem);
  assert.equal(nativeItem.productTitle, "Task 2K Purchased Title");
  assert.equal(nativeItem.creator, "RV Sawyer");
  assert.equal(nativeItem.purchaseAmountCents, 725);
  assert.equal(nativeItem.purchaseCurrency, "USD");
  assert.equal(nativeItem.purchasedVersion, "2.4");
  assert.match(nativeItem.coverImage, /^\/api\/account\/library-cover\?credential=/);
  assert.match(nativeItem.downloadUrl, /^\/store\/download\?credential=/);
  assert.match(legacyItem.downloadUrl, /^\/store\/download\?credential=/);
  assert.doesNotMatch(JSON.stringify(payload), /catalog-publications|delivery_r2_key|order_item_id|purchaser_user_id/i);
  const libraryRouteSource = fs.readFileSync(path.join(ROOT, "functions/api/account/library.js"), "utf8");
  assert.match(libraryRouteSource, /handleAccountLibraryRequest\(context\.request, context\.env\)/);

  const beforeCounts = counts(raw);
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  assert.equal((await response.json()).items.length, 2);
  assert.deepEqual(counts(raw), beforeCounts, "Repeated library reads must not create ownership or download records.");

  response = await library.handleAccountLibraryRequest(libraryRequest(OTHER.token), env, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  assert.equal((await response.json()).items.length, 0);

  raw.prepare("UPDATE users SET email_verified=0,email_verified_at=NULL WHERE id=?").run(BUYER.id);
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW, sessionOptions: { nowMs: NOW } });
  assert.equal((await response.json()).items.some(item => item.productId === product.id), false,
    "A session without a verified identity must not receive native ownership links.");
  raw.prepare("UPDATE users SET email_verified=1,email_verified_at=? WHERE id=?").run(ISO, BUYER.id);

  const coverUrl = new URL(nativeItem.coverImage, "https://example.test").toString();
  response = await covers.handleAccountLibraryCoverRequest(ownedRequest(coverUrl, BUYER.token), env, { nowMs: NOW, accountSessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), WEBP);
  const readsBeforeUnauthorizedCover = bucket.requestedKeys.length;
  response = await covers.handleAccountLibraryCoverRequest(ownedRequest(coverUrl, OTHER.token), env, { nowMs: NOW, accountSessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 403);
  assert.equal(bucket.requestedKeys.length, readsBeforeUnauthorizedCover);

  const downloadUrl = new URL(nativeItem.downloadUrl, "https://example.test").toString();
  response = await download.handleAuthorizedDownload(ownedRequest(downloadUrl, BUYER.token), env, { nowMs: NOW, accountSessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF);
  const readsBeforeUnauthorizedDownload = bucket.requestedKeys.length;
  response = await download.handleAuthorizedDownload(ownedRequest(downloadUrl, OTHER.token), env, { nowMs: NOW, accountSessionOptions: { nowMs: NOW } });
  assert.equal(response.status, 403);
  assert.equal(bucket.requestedKeys.length, readsBeforeUnauthorizedDownload);

  const legacyUrl = new URL(legacyItem.downloadUrl, "https://example.test").toString();
  response = await download.handleAuthorizedDownload(new Request(legacyUrl), env, {
    nowMs: NOW,
    deliveryProducts: { "task2k-legacy-product": {
      contentType: "application/pdf", customerFilename: "Legacy Product.pdf",
      productSlug: "task2k-legacy-product", r2ObjectKey: "legacy/private.pdf"
    } }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), LEGACY_PDF);

  let current = await catalog.getProductById(db, product.id);
  current = await catalog.updateProduct(db, product.id, {
    title: "Mutated Live Catalog Title", priceCents: 1900, publicationState: "paused",
    deliveryR2Key: "catalog-publications/task2k-live-changed/delivery.pdf"
  }, { expectedRevision: current.revision, nowMs: NOW + 1000 });
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW + 1000, sessionOptions: { nowMs: NOW + 1000 } });
  payload = await response.json();
  nativeItem = payload.items.find(item => item.productId === product.id);
  assert.equal(nativeItem.productTitle, "Task 2K Purchased Title");
  assert.equal(nativeItem.purchaseAmountCents, 725);
  assert.equal(nativeItem.purchasedVersion, "2.4");
  response = await download.handleAuthorizedDownload(ownedRequest(new URL(nativeItem.downloadUrl, "https://example.test").toString(), BUYER.token), env, {
    nowMs: NOW + 1000, accountSessionOptions: { nowMs: NOW + 1000 }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF);

  current = await catalog.updateProduct(db, product.id, { publicationState: "retired" }, {
    expectedRevision: current.revision, nowMs: NOW + 2000
  });
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW + 2000, sessionOptions: { nowMs: NOW + 2000 } });
  assert.ok((await response.json()).items.some(item => item.productId === product.id));

  bucket.missingDelivery = true;
  response = await download.handleAuthorizedDownload(ownedRequest(downloadUrl, BUYER.token), env, {
    nowMs: NOW + 3000, accountSessionOptions: { nowMs: NOW + 3000 }
  });
  assert.equal(response.status, 503);
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW + 3000, sessionOptions: { nowMs: NOW + 3000 } });
  assert.ok((await response.json()).items.some(item => item.productId === product.id), "Missing R2 delivery must not erase ownership.");

  bucket.missingCover = true;
  response = await covers.handleAccountLibraryCoverRequest(ownedRequest(coverUrl, BUYER.token), env, { nowMs: NOW + 3000, accountSessionOptions: { nowMs: NOW + 3000 } });
  assert.equal(response.status, 404);
  response = await library.handleAccountLibraryRequest(buyerRequest(), env, { nowMs: NOW + 3000, sessionOptions: { nowMs: NOW + 3000 } });
  assert.ok((await response.json()).items.some(item => item.productId === product.id));

  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(native.order.id).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements WHERE id=?").get(legacy.entitlementId).n, 1);
  const accountSource = fs.readFileSync(path.join(ROOT, "assets/js/account.js"), "utf8");
  assert.match(accountSource, /product-card__media/);
  assert.match(accountSource, /purchaseAmountCents/);
  assert.match(accountSource, /item\.downloadUrl/);
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/account/library-cover"));
  raw.close();
  console.log("Native D1 customer library tests passed.");
}

async function paidNativeFixture(nativeOrders, ownership, db, raw, product) {
  const result = await nativeOrders.createOrGetNativePendingOrder(db, {
    checkoutAttemptId: "trgca_2b000000-0000-4000-8000-000000000001",
    checkoutRequestHash: "2".repeat(64), createdAt: ISO, currency: "USD",
    customerEmail: BUYER.email, customerEmailHash: "task2k-buyer-hash",
    customerEmailNormalized: BUYER.email, publicId: "TRG-TASK2K-NATIVE",
    subtotalCents: 725, totalCents: 725, userId: BUYER.id
  }, [{
    authorSlugsJson: '["rv-sawyer"]', catalogRevision: product.revision, createdAt: ISO,
    currency: "USD", deliveryContentType: product.deliveryContentType,
    deliveryFilename: product.deliveryFilename, deliveryR2Key: product.deliveryR2Key,
    effectiveUnitPriceCents: 725, lastUpdatedSnapshot: product.updatedAt, lineTotalCents: 725,
    listPriceCents: 725, minimumPriceCents: null, nativeCreatorId: product.creatorId,
    nativeProductId: product.id, pricingModel: "fixed", primaryAuthorSlug: "rv-sawyer",
    productSlug: product.slug, productStatus: product.status, productTitleSnapshot: product.title,
    publicationState: "published", quantity: 1, suggestedPriceCents: null, versionSnapshot: "2.4"
  }]);
  const order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(result.order.id), {
    id: "cs_test_task2k", url: "https://checkout.stripe.test/task2k"
  }, { updatedAt: ISO });
  raw.prepare(`UPDATE orders SET payment_status='paid',native_order_state='paid',stripe_payment_intent_id='pi_test_task2k',
    paid_at=?,payment_source='stripe',settlement_method='external_provider' WHERE id=?`).run(ISO, order.id);
  const granted = await ownership.grantNativePaidOrderEntitlements(db, Number(order.id), { nowMs: NOW });
  assert.equal(granted.ready, true);
  return { entitlement: granted.entitlements[0], order: raw.prepare("SELECT * FROM orders WHERE id=?").get(order.id) };
}

function seedLegacy(raw, userId, slug, title, key, filename) {
  const orderId = Number(raw.prepare(`INSERT INTO orders(public_id,user_id,customer_email,customer_email_normalized,
    customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at)
    VALUES(?,?,?,?,?,'USD',725,725,'paid','fulfilled','sent',?)`)
    .run(`TRG-${slug.toUpperCase()}`, userId, BUYER.email, BUYER.email, `hash-${slug}`, ISO).lastInsertRowid);
  const itemId = Number(raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,
    primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,
    currency,version_snapshot,last_updated_snapshot,created_at)
    VALUES(?,?,?,'rv-sawyer','["rv-sawyer"]',1,725,725,725,'USD','1.0','2026-01-01',?)`)
    .run(orderId, slug, title, ISO).lastInsertRowid);
  const entitlementId = Number(raw.prepare(`INSERT INTO download_entitlements(order_id,order_item_id,product_slug,
    r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at)
    VALUES(?,?,?,?,?,'application/pdf',?,'active',?)`)
    .run(orderId, itemId, slug, key, filename, LEGACY_PDF.length, ISO).lastInsertRowid);
  return { entitlementId, itemId, orderId };
}

async function seedUser(raw, auth, user) {
  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
    VALUES(?,?,1,?,'active','user',?,?)`).run(user.id, user.email, ISO, ISO, ISO);
  raw.prepare(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?)`).run(`${user.id}-session`, user.id, await auth.hashToken(user.token),
    await auth.hashToken(`${user.id}-csrf`), ISO, "2027-10-30T20:00:00.000Z", ISO);
}

function libraryRequest(token) {
  return new Request("https://example.test/api/account/library", { headers: { cookie: `__Host-trg_session=${token}` } });
}
function ownedRequest(url, token) {
  return new Request(url, { headers: { cookie: `__Host-trg_session=${token}` } });
}
function counts(raw) {
  return {
    legacy: raw.prepare("SELECT COUNT(*) n FROM download_entitlements").get().n,
    native: raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements").get().n,
    attempts: raw.prepare("SELECT COUNT(*) n FROM native_download_attempts").get().n
  };
}
function createBucket(product) {
  return {
    missingCover: false,
    missingDelivery: false,
    requestedKeys: [],
    async get(key) {
      this.requestedKeys.push(key);
      if (key === product.coverR2Key && !this.missingCover) {
        return object(WEBP, "image/webp");
      }
      if (key === product.deliveryR2Key && !this.missingDelivery) {
        return object(PDF, "application/pdf");
      }
      if (key === "legacy/private.pdf") return object(LEGACY_PDF, "application/pdf");
      return null;
    },
    async head(key) {
      const result = await this.get(key);
      return result ? { ...result, body: undefined } : null;
    }
  };
}
function object(bytes, contentType) {
  return {
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    httpEtag: '"task2k"', httpMetadata: { contentType }, size: bytes.length
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
function load(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?task2k=${Math.random()}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
