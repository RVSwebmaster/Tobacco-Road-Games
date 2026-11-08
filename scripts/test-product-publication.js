const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-10-29T12:00:00Z");
const WEBP = Uint8Array.from(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const PDF = Uint8Array.from(Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"));

async function main() {
  const publication = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-publication.mjs")).href);
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions/_lib/account-auth.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(n => n.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  const db = d1(raw);
  const bucket = r2();
  assert.equal(publication.ADMIN_PRODUCT_PDF_LIMIT_BYTES, 90 * 1024 * 1024);
  const input = (slug, overrides = {}) => ({
    metadata: { id: `product-${slug}`, slug, creatorId: "creator-rv-sawyer",
      title: `Product ${slug}`, status: "available-direct", buyMode: "cart",
      pricingModel: "fixed", priceCents: 500, ...overrides },
    coverFile: new File([WEBP], "cover.webp", { type: "image/webp" }),
    pdfFile: new File([PDF], "delivery.pdf", { type: "application/pdf" })
  });
  const published = await publication.publishProduct(db, bucket, input("publication-success"), {
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nowMs: NOW_MS
  });
  assert.equal(published.publicationState, "published");
  assert.equal(published.revision, 1);
  assert.equal(published.coverR2Key, "catalog-publications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover.webp");
  assert.equal(published.deliveryR2Key, "catalog-publications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/delivery.pdf");
  assert.equal((await catalog.getProductBySlug(db, published.slug)).id, published.id);
  assert.equal(bucket.objects.size, 2);
  const withBack = input("publication-with-back");
  withBack.backCoverFile = new File([WEBP], "back-cover.webp", { type: "image/webp" });
  const backed = await publication.publishProduct(db, bucket, withBack, {
    attemptId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", nowMs: NOW_MS
  });
  assert.equal(backed.backCoverR2Key, "catalog-publications/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/back-cover.webp");
  assert.deepEqual(bucket.objects.get(backed.backCoverR2Key).bytes, WEBP);
  assert.equal(bucket.objects.size, 5);
  const preservedCover = Uint8Array.from(bucket.objects.get(published.coverR2Key).bytes);
  await assert.rejects(publication.publishProduct(db, bucket, input("publication-key-collision"), {
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nowMs: NOW_MS
  }), error => error.code === "asset_exists");
  assert.deepEqual(bucket.objects.get(published.coverR2Key).bytes, preservedCover);
  assert.equal(bucket.objects.size, 5);

  await assert.rejects(publication.publishProduct(db, bucket, input("publication-success"), {
    attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nowMs: NOW_MS
  }), error => error.code === "product_exists");
  assert.equal(bucket.objects.size, 5);
  assert.equal((await catalog.getProductById(db, published.id)).deliveryR2Key, published.deliveryR2Key);

  bucket.failAfterPut = 2;
  await assert.rejects(publication.publishProduct(db, bucket, input("publication-r2-failure"), {
    attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nowMs: NOW_MS
  }), error => error.code === "publication_failed");
  assert.equal(await catalog.getProductBySlug(db, "publication-r2-failure"), null);
  assert.equal(bucket.objects.size, 5);

  await assert.rejects(publication.publishProduct(db, bucket,
    input("publication-d1-failure", { creatorListingId: "missing-listing" }), {
      attemptId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", nowMs: NOW_MS
    }), error => error.code === "publication_failed");
  assert.equal(await catalog.getProductBySlug(db, "publication-d1-failure"), null);
  assert.equal(bucket.objects.size, 5);

  const invalid = input("publication-invalid");
  invalid.coverFile = new File([PDF], "cover.webp", { type: "image/webp" });
  await assert.rejects(publication.publishProduct(db, bucket, invalid), error => error.code === "invalid_file");
  assert.equal(bucket.objects.size, 5);
  assert.equal(await catalog.getProductBySlug(db, "publication-invalid"), null);

  const unauthenticated = await publication.handleOwnerCatalogPublicationRequest(
    new Request("https://example.test/owner/api/catalog-publication", { method: "POST" }),
    { TRG_ORDERS: db, TRG_PRODUCTS: bucket }
  );
  assert.equal(unauthenticated.status, 401);
  const now = new Date(NOW_MS).toISOString();
  raw.prepare("INSERT INTO users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("test-owner", "owner@example.invalid", "owner", "active", now, now);
  const sessionToken = "owner-test-session", csrfToken = "owner-test-csrf";
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
    .run("test-session", "test-owner", await auth.hashToken(sessionToken), await auth.hashToken(csrfToken),
      now, new Date(Date.now() + 60_000).toISOString(), now);
  const form = new FormData();
  const viaRoute = input("publication-owner-route");
  form.set("metadata", JSON.stringify(viaRoute.metadata));
  form.set("cover", viaRoute.coverFile);
  form.set("pdf", viaRoute.pdfFile);
  const ownerRequest = new Request("https://example.test/owner/api/catalog-publication", {
    method: "POST", headers: { origin: "https://example.test",
      cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${sessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${csrfToken}`,
      "x-csrf-token": csrfToken }, body: form
  });
  const ownerResponse = await publication.handleOwnerCatalogPublicationRequest(ownerRequest, { TRG_ORDERS: db, TRG_PRODUCTS: bucket });
  assert.equal(ownerResponse.status, 201);
  const ownerPayload = await ownerResponse.json();
  assert.equal(ownerPayload.product.slug, "publication-owner-route");
  assert.equal(ownerPayload.storefrontUrl, "/store/products/publication-owner-route/");
  const ownerProduct = await catalog.getProductBySlug(db, "publication-owner-route");
  assert.equal(ownerProduct.publicationState, "published");
  assert.equal(ownerProduct.managedByUserId, "test-owner");

  const updatedOwnerProduct = await publication.updatePublishedProduct(db, bucket, {
    slug: ownerProduct.slug,
    expectedRevision: ownerProduct.revision,
    metadata: { ...viaRoute.metadata, title: "Product publication-owner-route revised" }
  }, { managingRole: "owner", managingUserId: "test-owner", nowMs: NOW_MS + 1000 });
  assert.equal(updatedOwnerProduct.title, "Product publication-owner-route revised");
  assert.equal(updatedOwnerProduct.revision, 2);
  assert.equal(updatedOwnerProduct.coverR2Key, ownerProduct.coverR2Key);
  assert.equal(updatedOwnerProduct.deliveryR2Key, ownerProduct.deliveryR2Key);

  raw.prepare("INSERT INTO users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("test-admin", "admin@example.invalid", "admin", "active", now, now);
  raw.prepare("INSERT INTO users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("test-creator-user", "creator@example.invalid", "user", "active", now, now);
  const adminSessionToken = "admin-test-session", adminCsrfToken = "admin-test-csrf";
  const creatorSessionToken = "creator-test-session", creatorCsrfToken = "creator-test-csrf";
  for (const [id, userId, token, csrf] of [
    ["admin-session", "test-admin", adminSessionToken, adminCsrfToken],
    ["creator-session", "test-creator-user", creatorSessionToken, creatorCsrfToken]
  ]) {
    raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, userId, await auth.hashToken(token), await auth.hashToken(csrf),
        now, new Date(Date.now() + 60_000).toISOString(), now);
  }

  const adminInput = input("publication-admin-private", {
    publisher: "Tobacco Road Games",
    status: "preview-only",
    buyMode: "preview-only",
    priceCents: 0,
    metadata: { authors: ["RV Sawyer"], pageCount: 122, series: "5e Reference Library", volume: "One" }
  });
  const adminForm = new FormData();
  adminForm.set("metadata", JSON.stringify(adminInput.metadata));
  adminForm.set("cover", adminInput.coverFile);
  adminForm.set("pdf", adminInput.pdfFile);
  const adminResponse = await publication.handleOwnerCatalogPublicationRequest(new Request(
    "https://example.test/owner/api/catalog-publication", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${adminSessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${adminCsrfToken}`,
        "x-csrf-token": adminCsrfToken
      },
      body: adminForm
    }
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket });
  assert.equal(adminResponse.status, 201);
  const adminProduct = await catalog.getProductBySlug(db, "publication-admin-private");
  assert.equal(adminProduct.managedByUserId, "test-admin");
  assert.equal(adminProduct.publisher, "Tobacco Road Games");
  assert.deepEqual(adminProduct.metadata.authors, ["RV Sawyer"]);
  assert.equal(adminProduct.status, "preview-only");
  assert.equal(adminProduct.buyMode, "preview-only");
  assert.equal(adminProduct.priceCents, 0);

  const creatorForm = new FormData();
  creatorForm.set("metadata", "{}");
  const creatorResponse = await publication.handleOwnerCatalogPublicationRequest(new Request(
    "https://example.test/owner/api/catalog-publication", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${creatorSessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${creatorCsrfToken}`,
        "x-csrf-token": creatorCsrfToken
      },
      body: creatorForm
    }
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket });
  assert.equal(creatorResponse.status, 403);

  const listResponse = await publication.handleOwnerCatalogPublicationRequest(new Request(
    "https://example.test/owner/api/catalog-publication", {
      headers: { cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${adminSessionToken}` }
    }
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket });
  assert.equal(listResponse.status, 200);
  const intakeProducts = (await listResponse.json()).products;
  assert.equal(intakeProducts.find(product => product.slug === adminProduct.slug).managedByUserId, "test-admin");
  assert.deepEqual(intakeProducts.find(product => product.slug === adminProduct.slug).authors, ["RV Sawyer"]);
  assert.equal(intakeProducts.find(product => product.slug === adminProduct.slug).volume, "One");
  const badCsrf = new Request("https://example.test/owner/api/catalog-publication", {
    method: "POST", headers: { origin: "https://example.test",
      cookie: `${auth.ACCOUNT_SESSION_COOKIE}=${sessionToken}; ${auth.ACCOUNT_CSRF_COOKIE}=${csrfToken}`,
      "x-csrf-token": "wrong" }, body: new FormData()
  });
  assert.equal((await publication.handleOwnerCatalogPublicationRequest(badCsrf, { TRG_ORDERS: db, TRG_PRODUCTS: bucket })).status, 403);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products").get().n, 5);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  raw.close();
  console.log("Native product publication unit tests passed.");
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

function r2() {
  const objects = new Map();
  return {
    objects,
    failAfterPut: 0,
    async head(key) { return objects.get(key) || null; },
    async put(key, bytes, options) {
      assert.equal(options.onlyIf?.get("if-none-match"), "*");
      if (options.onlyIf?.get("if-none-match") === "*" && objects.has(key)) return null;
      const copy = Uint8Array.from(bytes);
      objects.set(key, { bytes: copy, size: copy.byteLength, ...options });
      if (this.failAfterPut && --this.failAfterPut === 0) throw new Error("Simulated R2 failure after write.");
      return { key };
    },
    async get(key) {
      const object = objects.get(key);
      return object && { ...object, async arrayBuffer() { return object.bytes.buffer.slice(0); } };
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
