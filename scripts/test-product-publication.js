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
  const nativeOrders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/native-orders-d1.mjs")).href);
  const ownerOrders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/owner-orders.mjs")).href);
  const ownerOrdersPage = fs.readFileSync(path.join(ROOT, "owner/orders.html"), "utf8");
  assert.match(ownerOrdersPage, /delivery-audit-button/, "Owner order recovery must expose the purchased-file audit.");
  assert.match(ownerOrdersPage, /audit:'purchased-deliveries'/, "Owner UI must call the paginated exact-snapshot audit.");
  assert.match(ownerOrdersPage, /no replacement was made/i, "Missing historical files must be reported without implying substitution.");
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
  assert.equal(published.listingVisibility, "listed", "Owner publication must make a public listing explicitly visible.");
  assert.equal(published.revision, 1);
  assert.equal(published.coverR2Key, "catalog-publications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cover.webp");
  assert.equal(published.deliveryR2Key, "catalog-publications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/delivery.pdf");
  assert.equal((await catalog.getProductBySlug(db, published.slug)).id, published.id);
  assert.equal(bucket.objects.size, 2);
  const retried = await publication.publishProduct(db, bucket, input("publication-success"), {
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nowMs: NOW_MS
  });
  assert.equal(retried.id, published.id, "Retrying a completed attempt must return the existing native product.");
  assert.deepEqual(await publication.reconcilePublicationAttempt(db, bucket, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), {
    ok: true, state: "published", product: retried, storefrontUrl: "/store/products/publication-success/"
  });
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
  assert.equal(ownerProduct.listingVisibility, "listed", "Owner intake must explicitly list newly published products by default.");
  assert.equal(ownerProduct.managedByUserId, "test-owner");

  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?, ?, 1, 'active', 'user', ?, ?)")
    .run("test-buyer", "buyer@example.invalid", now, now);
  const orderResult = await nativeOrders.createOrGetNativePendingOrder(db, {
    checkoutAttemptId: "trgca_00000001-0000-4000-8000-000000000001",
    checkoutRequestHash: "a".repeat(64),
    createdAt: now,
    currency: "USD",
    customerEmail: "buyer@example.invalid",
    customerEmailHash: "buyer-hash",
    customerEmailNormalized: "buyer@example.invalid",
    publicId: "TRG-TEST-PURCHASE-SNAPSHOT",
    subtotalCents: 500,
    totalCents: 500,
    userId: "test-buyer"
  }, [{
    authorSlugsJson: "[]",
    catalogRevision: ownerProduct.revision,
    createdAt: now,
    creatorFeeBasisPoints: 2000,
    creatorFeePolicyEffectiveAt: now,
    creatorFeePolicyReason: "standard",
    creatorCommissionCategory: "standard",
    creatorCommissionPolicyVersion: "legacy-marketplace-policy",
    creatorFirstPublishedAt: ownerProduct.publishedAt,
    creatorFixedFeeCents: 0,
    creatorReserveDays: 14,
    creatorFeePolicyId: null,
    currency: ownerProduct.currency,
    deliveryContentType: ownerProduct.deliveryContentType,
    deliveryFilename: ownerProduct.deliveryFilename,
    deliveryR2Key: ownerProduct.deliveryR2Key,
    effectiveUnitPriceCents: 500,
    lastUpdatedSnapshot: ownerProduct.updatedAt,
    lineTotalCents: 500,
    listPriceCents: 500,
    minimumPriceCents: null,
    nativeCreatorId: ownerProduct.creatorId,
    nativeProductId: ownerProduct.id,
    pricingModel: "fixed",
    primaryAuthorSlug: "test-author",
    productSlug: ownerProduct.slug,
    productStatus: ownerProduct.status,
    productTitleSnapshot: ownerProduct.title,
    publicationState: "published",
    quantity: 1,
    suggestedPriceCents: null,
    versionSnapshot: "1.0"
  }]);
  raw.prepare("UPDATE orders SET payment_status='paid',native_order_state='paid',paid_at=? WHERE id=?")
    .run(now, orderResult.order.id);
  const updatedOwnerProduct = await publication.updatePublishedProduct(db, bucket, {
    slug: ownerProduct.slug,
    expectedRevision: ownerProduct.revision,
    metadata: { ...viaRoute.metadata, title: "Product publication-owner-route revised" },
    coverFile: new File([WEBP], "cover-v2.webp", { type: "image/webp" }),
    pdfFile: new File([PDF, new TextEncoder().encode("Revision 2")], "delivery-v2.pdf", { type: "application/pdf" })
  }, { managingRole: "owner", managingUserId: "test-owner", nowMs: NOW_MS + 1000 });
  assert.equal(updatedOwnerProduct.title, "Product publication-owner-route revised");
  assert.equal(updatedOwnerProduct.revision, 2);
  assert.notEqual(updatedOwnerProduct.coverR2Key, ownerProduct.coverR2Key);
  assert.notEqual(updatedOwnerProduct.deliveryR2Key, ownerProduct.deliveryR2Key);
  assert.ok(bucket.objects.has(ownerProduct.deliveryR2Key), "A purchase-referenced delivery object must survive product replacement.");
  assert.ok(bucket.objects.has(updatedOwnerProduct.deliveryR2Key), "The current catalog must point at the replacement delivery object.");

  const healthyAudit = await ownerOrders.handleOwnerOrdersRequest(new Request(
    "https://example.test/owner/api/orders?audit=purchased-deliveries"
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, { nowMs: NOW_MS + 2000 });
  assert.equal(healthyAudit.status, 200);
  const healthyAuditBody = await healthyAudit.json();
  assert.equal(healthyAuditBody.scanned, 1);
  assert.equal(healthyAuditBody.missing.length, 0);
  assert.equal(healthyAuditBody.availableCount, 1);

  bucket.objects.delete(ownerProduct.deliveryR2Key);
  const missingAudit = await ownerOrders.handleOwnerOrdersRequest(new Request(
    "https://example.test/owner/api/orders?audit=purchased-deliveries"
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, { nowMs: NOW_MS + 3000 });
  assert.equal(missingAudit.status, 200);
  const missingAuditBody = await missingAudit.json();
  assert.equal(missingAuditBody.missing.length, 1);
  assert.equal(missingAuditBody.missing[0].deliveryKey, ownerProduct.deliveryR2Key,
    "The audit must identify the exact missing purchase-time key.");
  assert.equal(missingAuditBody.missing[0].version, "1.0");
  assert.notEqual(missingAuditBody.missing[0].deliveryKey, updatedOwnerProduct.deliveryR2Key,
    "The newer catalog asset must never be reported or silently substituted for the missing purchase snapshot.");
  assert.equal(missingAuditBody.missing[0].status, "missing");

  bucket.throwOnHead = true;
  const unverifiedAudit = await ownerOrders.handleOwnerOrdersRequest(new Request(
    "https://example.test/owner/api/orders?audit=purchased-deliveries"
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, { nowMs: NOW_MS + 4000 });
  assert.equal(unverifiedAudit.status, 200);
  const unverifiedAuditBody = await unverifiedAudit.json();
  assert.equal(unverifiedAuditBody.missing.length, 0, "An R2 error must not be misreported as a confirmed missing object.");
  assert.equal(unverifiedAuditBody.unverified.length, 1);
  bucket.throwOnHead = false;

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

function r2() {
  const objects = new Map();
  return {
    objects,
    failAfterPut: 0,
    throwOnHead: false,
    async head(key) { if (this.throwOnHead) throw new Error("Simulated R2 head failure."); return objects.get(key) || null; },
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
