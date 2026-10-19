const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_ROOT = path.join(ROOT, "migrations");
const CLEANUP_MIGRATION = "054_remove_legacy_creator_listing_seeds.sql";
const LEGACY_LISTING_IDS = [
  "listing-agency",
  "listing-circle-of-cinder",
  "listing-final-flame",
  "listing-janni",
  "listing-mouthy-monsters",
  "listing-path-of-the-janky",
  "listing-ringbound",
  "listing-silence-and-the-spotlight",
  "listing-sirrocans",
  "listing-spriggans",
  "listing-tablecraft-primer",
  "listing-yojimbo"
];
const REMOVED_SLUGS = LEGACY_LISTING_IDS.map((id) => id.slice("listing-".length));

async function main() {
  const migrationFiles = fs.readdirSync(MIGRATIONS_ROOT)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), CLEANUP_MIGRATION, "The legacy cleanup must remain forward-only.");

  const database = openDatabase();
  let bootstrapCountBeforeCleanup = null;
  for (const migrationFile of migrationFiles) {
    if (migrationFile === CLEANUP_MIGRATION) {
      const legacyRows = database.prepare(
        "SELECT id,creator_id,slug,source_product_slug FROM creator_listings ORDER BY id"
      ).all();
      bootstrapCountBeforeCleanup = legacyRows.length;
      assert.deepEqual(legacyRows.map((row) => row.id), LEGACY_LISTING_IDS);
      assert.equal(legacyRows.every((row) => row.creator_id === "creator-rv-sawyer"), true);
      assert.equal(legacyRows.every((row) => row.slug === row.source_product_slug), true);
    }
    applyMigration(database, migrationFile);
  }

  assert.equal(bootstrapCountBeforeCleanup, 12, "Migration 018 should reproduce the obsolete seed inventory before cleanup.");
  assert.equal(count(database, "creator_listings"), 0, "A fully initialized Creator catalog must be empty.");
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM marketplace_creators WHERE id='creator-rv-sawyer'").get().count,
    1,
    "The canonical RV Sawyer Creator identity must survive catalog cleanup."
  );
  assert.equal(tableExists(database, "creator_listing_files"), true);
  assert.equal(tableExists(database, "creator_publication_audit"), true);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();

  verifySelectiveCleanup(migrationFiles);
  await verifyCurrentPublicationMapping();
  verifyStaticCatalogIsEmpty();

  console.log("Empty-catalog bootstrap integrity tests passed.");
  console.log(`Bootstrap listings before migration 054: ${bootstrapCountBeforeCleanup}`);
  console.log("Bootstrap listings after migration 054: 0");
  console.log("RV Sawyer Creator identity preserved: true");
  console.log("Non-seed future listing preserved: true");
}

function verifySelectiveCleanup(migrationFiles) {
  const database = openDatabase();
  for (const migrationFile of migrationFiles) {
    if (migrationFile === CLEANUP_MIGRATION) break;
    applyMigration(database, migrationFile);
  }

  const now = "2026-10-19T00:00:00.000Z";
  database.prepare(`INSERT INTO creator_listings(
    id,creator_id,slug,source_product_slug,title,lifecycle_state,publication_state,created_at,updated_at
  ) VALUES(?,?,?,?,?,'draft','not_approved',?,?)`).run(
    "listing-agency-reissue",
    "creator-rv-sawyer",
    "agency-reissue",
    "agency-reissue",
    "Agency",
    now,
    now
  );
  database.prepare(
    "UPDATE creator_listings SET lifecycle_state='draft',updated_at=? WHERE id='listing-agency'"
  ).run(now);
  applyMigration(database, CLEANUP_MIGRATION);

  assert.equal(count(database, "creator_listings"), 2, "Only an untouched exact legacy seed may be removed.");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM creator_listings WHERE id='listing-agency'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM creator_listings WHERE id='listing-agency-reissue'").get().count, 1);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM creator_listings WHERE id IN (SELECT value FROM json_each(?))")
      .get(JSON.stringify(LEGACY_LISTING_IDS)).count,
    1,
    "The other eleven untouched legacy rows should be removed."
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
}

async function verifyCurrentPublicationMapping() {
  const publication = await import(
    pathToFileURL(path.join(ROOT, "functions/_lib/creator-publication-map.mjs")).href
  );
  const mapped = publication.mapApprovedListingToPublishPayload({
    id: "listing-published-fixture",
    slug: "published-fixture",
    title: "Published Fixture",
    short_description: "A current listing.",
    long_description: "A current listing that completed publication review.",
    game_system: "System Neutral",
    format_json: '["PDF"]',
    listed_price_cents: 500,
    media_type: "digital",
    publication_state: "approved"
  }, {
    id: "creator-fixture",
    slug: "creator-fixture",
    display_name: "Creator Fixture"
  }, [
    { id: "cover", purpose: "cover", validation_state: "accepted" },
    { id: "product", purpose: "product", validation_state: "accepted" }
  ], { nowMs: Date.UTC(2026, 8, 27) });
  assert.equal(mapped.valid, true);
  assert.equal(mapped.metadata.status, "available-direct");
  assert.equal(mapped.metadata.buyMode, "cart");
  assert.equal(mapped.metadata.productIdentityId, "listing-published-fixture");
}

function verifyStaticCatalogIsEmpty() {
  const products = JSON.parse(read("data/products.json"));
  assert.deepEqual(products, [], "The static product source must remain empty.");

  const activePages = [
    "authors/rv-sawyer/index.html",
    "store/index.html",
    "store/catalog/index.html",
    "store/cart/index.html",
    "store/sitemap.xml",
    "shared/runtime-catalog.mjs"
  ];
  for (const slug of REMOVED_SLUGS) {
    assert.equal(fs.existsSync(path.join(ROOT, "store", "products", slug, "index.html")), false);
    for (const activePage of activePages) {
      assert.doesNotMatch(read(activePage), new RegExp(slug), `${slug} must stay out of ${activePage}.`);
    }
  }

  const homepage = JSON.parse(read("data/homepage.json"));
  assert.equal(REMOVED_SLUGS.includes(homepage.featuredSlug), false);
  assert.deepEqual(homepage.workInProgressSlugs.filter((slug) => REMOVED_SLUGS.includes(slug)), []);
}

function openDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  return database;
}

function applyMigration(database, migrationFile) {
  database.exec(fs.readFileSync(path.join(MIGRATIONS_ROOT, migrationFile), "utf8"));
}

function count(database, table) {
  return database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
}

function tableExists(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
