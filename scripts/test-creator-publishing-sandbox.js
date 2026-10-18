const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const CREATOR_ID = "creator-mock-publishing-task1";
const PRODUCT_ID = "listing-mock-publishing-task1";
const PRODUCT_SLUG = "mock-publishing-task1";
const COVER_FILE_ID = "file-mock-publishing-task1-cover";
const PRODUCT_FILE_ID = "file-mock-publishing-task1-product";
const NOW = "2026-10-18T15:00:00.000Z";

const BASE_MIGRATIONS = [
  "001_direct_storefront.sql",
  "003_checkout_attempt_idempotency.sql",
  "004_verified_stripe_webhooks.sql",
  "005_secure_download_entitlements.sql",
  "006_customer_delivery_owner_controls.sql",
  "007_shared_accounts.sql",
  "016_order_account_ownership.sql",
  "017_historical_order_claims.sql",
  "018_creator_operations.sql",
  "019_creator_publication_pipeline.sql"
];

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-publishing-task1-")
  );
  const databasePath = path.join(sandboxRoot, "creator-publishing.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const publicationRoot = path.join(sandboxRoot, "publication-worktree");
  const catalogPath = path.join(ROOT, "data", "products.json");
  const catalogHashBefore = sha256(catalogPath);
  let database;
  let explicitCleanupComplete = false;

  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of BASE_MIGRATIONS) {
      database.exec(
        fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8")
      );
    }

    createMockRecords(database);
    createMockStorage(storageRoot);

    const ownership = database
      .prepare(
        `SELECT
           listing.id product_id,
           listing.creator_id,
           creator.id retrieved_creator_id,
           creator.display_name creator_name
         FROM creator_listings listing
         JOIN marketplace_creators creator ON creator.id=listing.creator_id
         WHERE listing.id=?`
      )
      .get(PRODUCT_ID);
    assert.ok(ownership, "The mock product should be retrievable.");
    assert.equal(ownership.product_id, PRODUCT_ID);
    assert.equal(ownership.creator_id, CREATOR_ID);
    assert.equal(ownership.retrieved_creator_id, CREATOR_ID);
    assert.equal(ownership.creator_name, "Mock Creator Task 1");

    const listing = database
      .prepare("SELECT * FROM creator_listings WHERE id=?")
      .get(PRODUCT_ID);
    const creator = database
      .prepare("SELECT * FROM marketplace_creators WHERE id=?")
      .get(CREATOR_ID);
    const files = database
      .prepare(
        "SELECT * FROM creator_listing_files WHERE listing_id=? ORDER BY purpose"
      )
      .all(PRODUCT_ID);
    assert.equal(files.length, 2);

    const mappingModule = await import(
      `${pathToFileURL(path.join(ROOT, "functions", "_lib", "creator-publication-map.mjs")).href}?task1=${Date.now()}`
    );
    const mapped = mappingModule.mapApprovedListingToPublishPayload(
      listing,
      creator,
      files,
      { nowMs: Date.parse(NOW) }
    );
    assert.equal(mapped.valid, true, mapped.errors.join(" "));
    assert.equal(mapped.metadata.creatorId, CREATOR_ID);
    assert.equal(mapped.metadata.productIdentityId, PRODUCT_ID);
    assert.equal(mapped.metadata.slug, PRODUCT_SLUG);

    prepareDisposablePublicationWorktree(publicationRoot);
    const productsBefore = readJson(
      path.join(publicationRoot, "data", "products.json")
    );
    assert.equal(
      productsBefore.some((product) => product.slug === PRODUCT_SLUG),
      false,
      "The disposable mock product must not already exist in the catalog fixture."
    );

    const { applyPublishPayload } = require(path.join(
      ROOT,
      "scripts",
      "publish-intake.js"
    ));
    await applyPublishPayload(publicationRoot, {
      operation: "creator_publication",
      folder: mapped.folder,
      metadata: mapped.metadata,
      publish_id: "task1-disposable-publication"
    });

    const productsAfter = readJson(
      path.join(publicationRoot, "data", "products.json")
    );
    const publishedProduct = productsAfter.find(
      (product) => product.slug === PRODUCT_SLUG
    );
    assert.ok(publishedProduct, "The real intake routine should publish the mock product.");
    assert.equal(publishedProduct.creatorId, CREATOR_ID);
    assert.equal(
      productsAfter.filter((product) => product.slug === PRODUCT_SLUG).length,
      1
    );
    assert.deepEqual(
      productsAfter.filter((product) => product.slug !== PRODUCT_SLUG),
      productsBefore,
      "Publishing in the disposable copy must not alter unrelated catalog records."
    );

    const publishedMap = readJson(
      path.join(publicationRoot, "data", "product-intake-map.json")
    );
    assert.equal(
      publishedMap.products.find((product) => product.slug === PRODUCT_SLUG)?.folder,
      PRODUCT_SLUG
    );

    database.exec("BEGIN;");
    try {
      database
        .prepare("DELETE FROM creator_listing_files WHERE listing_id=?")
        .run(PRODUCT_ID);
      database
        .prepare("DELETE FROM creator_listings WHERE id=?")
        .run(PRODUCT_ID);
      database
        .prepare("DELETE FROM marketplace_creators WHERE id=?")
        .run(CREATOR_ID);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }

    const cleanupCounts = {
      creator: countById(database, "marketplace_creators", CREATOR_ID),
      product: countById(database, "creator_listings", PRODUCT_ID),
      files: Number(
        database
          .prepare("SELECT COUNT(*) count FROM creator_listing_files WHERE listing_id=?")
          .get(PRODUCT_ID).count
      )
    };
    assert.deepEqual(cleanupCounts, { creator: 0, product: 0, files: 0 });

    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(publicationRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(storageRoot), false);
    assert.equal(fs.existsSync(publicationRoot), false);
    assert.equal(sha256(catalogPath), catalogHashBefore);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator publishing sandbox test passed.");
    console.log(`Creator ID: ${CREATOR_ID}`);
    console.log(`Product ID: ${PRODUCT_ID}`);
    console.log("Database rows after cleanup: creator=0 product=0 files=0");
    console.log("Sandbox removed: true");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

function createMockRecords(database) {
  database
    .prepare(
      `INSERT INTO marketplace_creators(
         id,slug,display_name,short_bio,long_bio,profile_template,
         marketplace_status,created_at,updated_at
       ) VALUES(?,?,?,?,?,'catalog','approved',?,?)`
    )
    .run(
      CREATOR_ID,
      "mock-creator-task1",
      "Mock Creator Task 1",
      "Disposable Creator publishing sandbox fixture.",
      "This record exists only inside a temporary Task 1 SQLite database.",
      NOW,
      NOW
    );

  database
    .prepare(
      `INSERT INTO creator_listings(
         id,creator_id,slug,title,short_description,long_description,
         lifecycle_state,listed_price_cents,media_type,format_json,
         game_system,genre,discovery_json,publication_state,created_at,updated_at
       ) VALUES(?,?,?,?,?,?,'active',700,'digital','["PDF"]',
         'System Neutral','test','{}','approved',?,?)`
    )
    .run(
      PRODUCT_ID,
      CREATOR_ID,
      PRODUCT_SLUG,
      "Mock Publishing Task 1 Product",
      "Disposable publishing sandbox product.",
      "A local-only product used to verify Creator ownership and cleanup.",
      NOW,
      NOW
    );

  const insertFile = database.prepare(
    `INSERT INTO creator_listing_files(
       id,listing_id,creator_id,purpose,original_filename,normalized_filename,
       content_type,size_bytes,quarantine_key,validation_state,uploaded_at,validated_at
     ) VALUES(?,?,?,?,?,?,?,?,?,'accepted',?,?)`
  );
  insertFile.run(
    COVER_FILE_ID,
    PRODUCT_ID,
    CREATOR_ID,
    "cover",
    "mock-cover.webp",
    "mock-cover.webp",
    "image/webp",
    16,
    quarantineKey("mock-cover.webp"),
    NOW,
    NOW
  );
  insertFile.run(
    PRODUCT_FILE_ID,
    PRODUCT_ID,
    CREATOR_ID,
    "product",
    "mock-product.pdf",
    "mock-product.pdf",
    "application/pdf",
    25,
    quarantineKey("mock-product.pdf"),
    NOW,
    NOW
  );
}

function createMockStorage(storageRoot) {
  const pdf = Buffer.from("%PDF-1.7\nmock product\n%%EOF", "utf8");
  const webp = Buffer.alloc(16);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  writeStorageObject(storageRoot, quarantineKey("mock-cover.webp"), webp);
  writeStorageObject(storageRoot, quarantineKey("mock-product.pdf"), pdf);
}

function writeStorageObject(storageRoot, key, bytes) {
  const target = path.join(storageRoot, ...key.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function quarantineKey(filename) {
  return `creator-quarantine/${CREATOR_ID}/${PRODUCT_ID}/${filename}`;
}

function prepareDisposablePublicationWorktree(targetRoot) {
  for (const relativePath of [
    "data/products.json",
    "data/product-intake-map.json",
    "shared/product-folder-map.mjs"
  ]) {
    const target = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relativePath), target);
  }
}

function countById(database, table, id) {
  return Number(
    database
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE id=?`)
      .get(id).count
  );
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
