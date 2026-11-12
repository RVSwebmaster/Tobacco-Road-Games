// Explicit, idempotent promotion for the thirteen approved Open Rules Library
// publications. It never changes store state, pricing, or purchase availability.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const STAGING = Object.freeze({
  bucket: "trg-products-staging",
  config: "ops/staging/wrangler.pages.toml",
  database: "trg-orders-staging",
  env: ""
});
const PRODUCTION = Object.freeze({
  bucket: "trg-products",
  config: "ops/production/wrangler.pages.toml",
  database: "trg-orders",
  env: "production"
});
const PRODUCT_IDS = Object.freeze([
  "5e-players-manual",
  "5e-spellbook",
  "5e-bard-spellbook",
  "5e-cleric-spellbook",
  "5e-druid-spellbook",
  "5e-paladin-spellbook",
  "5e-ranger-spellbook",
  "5e-sorcerer-spellbook",
  "5e-warlock-spellbook",
  "5e-wizard-spellbook",
  "5e-relics-and-wonders",
  "5e-dungeon-masters-handbook",
  "5e-monster-guide"
]);
const PRODUCT_COLUMNS = Object.freeze([
  "id", "slug", "creator_id", "creator_listing_id", "publication_state", "title", "subtitle",
  "short_description", "long_description", "publisher", "game_system", "product_line", "genre",
  "media_type", "status", "buy_mode", "buy_url", "currency", "pricing_model", "price_cents",
  "suggested_price_cents", "minimum_price_cents", "sale_enabled", "sale_price_cents", "sale_start",
  "sale_end", "cover_r2_key", "preview_r2_key", "thumbnail_r2_key", "delivery_r2_key",
  "delivery_filename", "delivery_content_type", "metadata_json", "created_at", "updated_at",
  "published_at", "revision", "back_cover_r2_key", "managed_by_user_id", "storefront_visibility"
]);
const REQUIRED_ASSET_FIELDS = Object.freeze([
  ["cover_r2_key", "image/webp"],
  ["back_cover_r2_key", "image/webp"],
  ["delivery_r2_key", "application/pdf"]
]);

function cli(target, ...args) {
  const environment = target.env ? ["--env", target.env] : [];
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, ...args, "--config", target.config, ...environment], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function query(target, command) {
  const response = JSON.parse(cli(target, "d1", "execute", target.database, "--remote", "--json", "--command", command));
  assert.equal(response.length, 1);
  assert.equal(response[0].success, true, JSON.stringify(response));
  return response[0].results || [];
}

function executeFile(target, filePath) {
  cli(target, "d1", "execute", target.database, "--remote", "--yes", "--file", filePath);
}

function r2Get(target, key, filePath) {
  const args = [WRANGLER, "r2", "object", "get", `${target.bucket}/${key}`, "--remote", "--file", filePath,
    "--config", target.config, ...(target.env ? ["--env", target.env] : [])];
  return childProcess.spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}

function r2Put(target, key, filePath, contentType) {
  cli(target, "r2", "object", "put", `${target.bucket}/${key}`, "--remote", "--file", filePath,
    "--content-type", contentType, "--force");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function inList(values) {
  return values.map(sql).join(",");
}

function validateSourceRows(rows) {
  assert.equal(rows.length, PRODUCT_IDS.length, "Staging must contain exactly the thirteen approved publication records.");
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.deepEqual([...byId.keys()].sort(), [...PRODUCT_IDS].sort(), "Staging publication identities do not match the allowlist.");
  return PRODUCT_IDS.map((id) => {
    const row = byId.get(id);
    assert.equal(row.slug, id, `${id}: product ID and slug must match.`);
    assert.equal(row.creator_id, "creator-rv-sawyer", `${id}: unexpected Creator identity.`);
    assert.equal(row.publication_state, "published", `${id}: publication is not published for browsing.`);
    assert.equal(row.publisher, "Tobacco Road Games", `${id}: unexpected publisher.`);
    assert.equal(row.status, "preview-only", `${id}: status could enable sale visibility.`);
    assert.ok(["listed", "automatic"].includes(row.storefront_visibility), `${id}: publication is not available for browsing.`);
    assert.equal(row.buy_mode, "preview-only", `${id}: buy mode could enable purchase.`);
    assert.equal(Number(row.sale_enabled), 0, `${id}: sale must remain disabled.`);
    assert.equal(Number(row.price_cents), 0, `${id}: no invented price is allowed.`);
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(metadata.openRulesEligible, true, `${id}: Open Rules designation is absent.`);
    assert.ok(Number.isInteger(metadata.pageCount) && metadata.pageCount > 1, `${id}: representative page count is absent.`);
    for (const [field] of REQUIRED_ASSET_FIELDS) assert.ok(row[field], `${id}: ${field} is required.`);
    return row;
  });
}

function productInsert(rows, managerId) {
  const values = rows.map((row) => {
    const promoted = { ...row, managed_by_user_id: managerId };
    return `(${PRODUCT_COLUMNS.map((column) => sql(promoted[column])).join(",")})`;
  });
  return `INSERT INTO marketplace_products(${PRODUCT_COLUMNS.join(",")}) VALUES\n${values.join(",\n")};\n`;
}

function safeRemoveTemporaryDirectory(directory) {
  const parent = path.resolve(path.dirname(directory));
  const expectedParent = path.resolve(os.tmpdir());
  assert.equal(parent, expectedParent, "Refusing to remove a temporary directory outside the OS temporary folder.");
  assert.match(path.basename(directory), /^trg-open-rules-production-/);
  fs.rmSync(directory, { recursive: true, force: true });
}

function verifyClosed(target) {
  const rows = query(target, "SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'");
  assert.equal(rows[0]?.setting_value, "CLOSED", `${target.database} store state is not CLOSED.`);
}

function main() {
  assert.ok(fs.existsSync(WRANGLER), "Install repository dependencies before running the promotion.");
  verifyClosed(STAGING);
  verifyClosed(PRODUCTION);

  const sourceRows = validateSourceRows(query(STAGING,
    `SELECT ${PRODUCT_COLUMNS.join(",")} FROM marketplace_products WHERE id IN (${inList(PRODUCT_IDS)})`));
  const existing = query(PRODUCTION,
    `SELECT id FROM marketplace_products WHERE id IN (${inList(PRODUCT_IDS)}) ORDER BY id`);
  assert.equal(existing.length, 0, "Production already contains one or more allowlisted IDs; refusing to overwrite or duplicate them.");

  const creators = query(PRODUCTION, `SELECT id FROM marketplace_creators WHERE id='creator-rv-sawyer'
    AND marketplace_status='approved' AND registration_status='active' AND closure_state='active'`);
  assert.equal(creators.length, 1, "Production is missing the approved RV Sawyer Creator identity prerequisite.");
  const managers = query(PRODUCTION,
    "SELECT id FROM users WHERE role='owner' AND status='active' ORDER BY id");
  assert.equal(managers.length, 1, "Production must have exactly one active Owner manager for this promotion.");
  const managerId = managers[0].id;

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-open-rules-production-"));
  const assetReport = [];
  try {
    for (const row of sourceRows) {
      for (const [field, contentType] of REQUIRED_ASSET_FIELDS) {
        const key = row[field];
        const safeName = `${row.id}-${path.basename(key)}`;
        const stagingFile = path.join(temporaryDirectory, `staging-${safeName}`);
        const productionFile = path.join(temporaryDirectory, `production-${safeName}`);
        const stagingRead = r2Get(STAGING, key, stagingFile);
        assert.equal(stagingRead.status, 0, `${row.id}: staging R2 read failed for ${key}: ${stagingRead.stderr || stagingRead.stdout}`);
        const sourceHash = sha256(stagingFile);
        const existingRead = r2Get(PRODUCTION, key, productionFile);
        if (existingRead.status === 0) {
          assert.equal(sha256(productionFile), sourceHash, `${row.id}: production already has a different object at ${key}.`);
        } else {
          r2Put(PRODUCTION, key, stagingFile, contentType);
          const verifiedRead = r2Get(PRODUCTION, key, productionFile);
          assert.equal(verifiedRead.status, 0, `${row.id}: production R2 verification failed for ${key}.`);
          assert.equal(sha256(productionFile), sourceHash, `${row.id}: production R2 hash mismatch for ${key}.`);
        }
        assetReport.push({ productId: row.id, field, key, sha256: sourceHash, bytes: fs.statSync(stagingFile).size });
      }
    }

    const sqlFile = path.join(temporaryDirectory, "insert-open-rules-publications.sql");
    fs.writeFileSync(sqlFile, productInsert(sourceRows, managerId));
    executeFile(PRODUCTION, sqlFile);

    const promoted = validateSourceRows(query(PRODUCTION,
      `SELECT ${PRODUCT_COLUMNS.join(",")} FROM marketplace_products WHERE id IN (${inList(PRODUCT_IDS)})`));
    assert.ok(promoted.every((row) => row.managed_by_user_id === managerId), "Production manager assignment is incorrect.");
    verifyClosed(PRODUCTION);

    const report = {
      managerId,
      productIds: PRODUCT_IDS,
      products: promoted.map((row) => ({
        id: row.id,
        title: row.title,
        pageCount: JSON.parse(row.metadata_json).pageCount,
        coverR2Key: row.cover_r2_key,
        backCoverR2Key: row.back_cover_r2_key,
        deliveryR2Key: row.delivery_r2_key
      })),
      assets: assetReport,
      storeState: "CLOSED"
    };
    const reportPath = path.join(ROOT, "tmp", "open-rules-production-promotion.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, products: report.products.length, assets: report.assets.length, storeState: report.storeState }, null, 2));
  } finally {
    safeRemoveTemporaryDirectory(temporaryDirectory);
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { PRODUCT_COLUMNS, PRODUCT_IDS, productInsert, sql, validateSourceRows };
