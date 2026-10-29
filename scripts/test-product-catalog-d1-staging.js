// Explicit, disposable integration check against the staging D1 database.
// Run only with TRG_WRANGLER_PATH=<wrangler.js> node scripts/test-product-catalog-d1-staging.js.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = "ops/staging/wrangler.toml";
const DATABASE = "trg-orders-staging";
const DATABASE_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const WRANGLER = process.env.TRG_WRANGLER_PATH;

function wrangler(...args) {
  if (!WRANGLER) throw new Error("TRG_WRANGLER_PATH must point to a local Wrangler CLI.");
  return execFileSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function query(sql) {
  const response = JSON.parse(wrangler("d1", "execute", DATABASE, "--remote", "--config", CONFIG, "--json", "--command", sql));
  if (!Array.isArray(response) || response.length !== 1 || response[0].success !== true) {
    throw new Error(`Staging D1 query failed: ${JSON.stringify(response)}`);
  }
  return response[0];
}

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new TypeError(`Unsupported D1 test parameter type: ${typeof value}`);
}

function bindSql(sql, values) {
  let index = 0;
  const bound = sql.replace(/\?/g, () => {
    if (index >= values.length) throw new Error("Too few D1 test parameters.");
    return literal(values[index++]);
  });
  if (index !== values.length) throw new Error("Too many D1 test parameters.");
  return bound;
}

// This adapter sends every catalog-module statement to actual remote staging D1.
// Wrangler's CLI accepts SQL text rather than bound values, so this test harness
// quotes controlled parameters as SQL literals before invoking the remote command.
const database = {
  prepare(sql) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async first() { return query(bindSql(sql, values)).results[0] || null; },
      async all() { return { results: query(bindSql(sql, values)).results }; },
      async run() { return { meta: { changes: query(bindSql(sql, values)).meta.changes } }; }
    };
  }
};

async function main() {
  const info = JSON.parse(wrangler("d1", "info", DATABASE, "--config", CONFIG, "--json"));
  assert.equal(info.name, DATABASE);
  assert.equal(info.uuid, DATABASE_ID);
  assert.equal(query("SELECT name FROM d1_migrations WHERE name='057_marketplace_product_catalog.sql'").results.length, 1);
  const storeStateBefore = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0]?.setting_value;
  const creator = query("SELECT id, marketplace_status FROM marketplace_creators WHERE id='creator-rv-sawyer'").results[0];
  assert.equal(creator?.marketplace_status, "approved");
  console.log(`Target: ${info.name} (${info.uuid}); migration 057 present; Creator ${creator.id} approved.`);

  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const suffix = randomUUID().replace(/-/g, "");
  const id = `task2b-${suffix}`;
  const slug = `task2b-staging-${suffix}`;
  let testError;
  try {
    assert.equal(await catalog.getProductById(database, id), null);
    const created = await catalog.createProduct(database, {
      id, slug, creatorId: creator.id, publicationState: "draft",
      title: "Task 2B disposable staging catalog record",
      status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw",
      priceCents: 500, suggestedPriceCents: 500, minimumPriceCents: 0,
      coverR2Key: `${slug}/cover.webp`, deliveryR2Key: `${slug}/delivery.pdf`,
      deliveryFilename: "task2b-disposable.pdf", deliveryContentType: "application/pdf",
      metadata: { disposableStagingCheck: true, owner: "creator-rv-sawyer" }
    });
    assert.equal(created.id, id);
    assert.equal(created.revision, 1);
    assert.equal(created.minimumPriceCents, 0);
    assert.equal(created.coverR2Key, `${slug}/cover.webp`);
    assert.equal(created.deliveryR2Key, `${slug}/delivery.pdf`);
    console.log("Create: passed (draft PWYW, owner, and explicit R2 keys).");

    assert.equal((await catalog.getProductById(database, id))?.slug, slug);
    assert.equal((await catalog.getProductBySlug(database, slug))?.id, id);
    console.log("Retrieve by ID and slug: passed.");

    assert.equal((await catalog.listProducts(database, { creatorId: creator.id, publicationState: "draft", status: "pay-what-you-want" })).some(p => p.id === id), true);
    assert.equal((await catalog.listProducts(database, { creatorId: creator.id, publicationState: "published" })).some(p => p.id === id), false);
    assert.equal((await catalog.listProducts(database, { status: "available-direct" })).some(p => p.id === id), false);
    console.log("Listing and filters: passed.");

    const updated = await catalog.updateProduct(database, id, {
      title: "Task 2B revised disposable record", suggestedPriceCents: 700,
      coverR2Key: `${slug}/revised-cover.webp`
    }, { expectedRevision: 1 });
    assert.equal(updated.revision, 2);
    assert.equal(updated.suggestedPriceCents, 700);
    assert.equal(updated.coverR2Key, `${slug}/revised-cover.webp`);
    console.log("Revision-checked update: passed (revision 1 -> 2).");

    await assert.rejects(catalog.updateProduct(database, id, { title: "Stale overwrite" }, { expectedRevision: 1 }),
      error => error.code === "conflict");
    assert.equal((await catalog.getProductById(database, id))?.title, updated.title);
    assert.equal((await catalog.getProductById(database, id))?.revision, 2);
    console.log("Outdated revision: rejected; newer record preserved.");
  } catch (error) {
    testError = error;
  } finally {
    try {
      const remaining = await catalog.getProductById(database, id);
      if (remaining) assert.equal(await catalog.deleteDraftProduct(database, id), true);
      assert.equal(await catalog.getProductById(database, id), null);
      assert.equal(await catalog.getProductBySlug(database, slug), null);
      assert.equal(query("SELECT COUNT(*) AS count FROM marketplace_products WHERE id='" + id + "'").results[0].count, 0);
      assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0]?.setting_value, storeStateBefore);
      console.log(`Cleanup: passed (ID ${id} absent; store state unchanged: ${storeStateBefore}).`);
    } catch (cleanupError) {
      if (testError) console.error("Original staging check failure:", testError);
      throw cleanupError;
    }
  }
  if (testError) throw testError;
  console.log("Staging D1 product catalog verification passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
