// Deliberate staging-only integration test. Requires TRG_WRANGLER_PATH.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = process.env.TRG_WRANGLER_PATH;
const CONFIG = "ops/staging/wrangler.toml";
const DB_NAME = "trg-orders-staging";
const DB_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const ORIGIN = process.env.TRG_STAGING_PAGES_URL || "https://tobacco-road-games-staging.pages.dev";
const suffix = randomUUID().replace(/-/g, "");
const id = `task2c-${suffix}`;
const slug = `task2c-staging-${suffix}`;
const failedId = `task2c-failed-${suffix}`;
const failedSlug = `task2c-failed-staging-${suffix}`;
const sessionId = `task2c-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const testDir = path.join(ROOT, ".wrangler", `task2c-proof-${suffix}`);
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();

function cli(...args) {
  if (!WRANGLER) throw new Error("TRG_WRANGLER_PATH must identify a local Wrangler CLI.");
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler ${args.slice(0, 2).join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new TypeError("Unsupported staging D1 test value.");
}

function query(command) {
  const result = JSON.parse(cli("d1", "execute", DB_NAME, "--remote", "--config", CONFIG, "--json", "--command", command));
  if (result.length !== 1 || result[0].success !== true) throw new Error(`Staging D1 query failed: ${JSON.stringify(result)}`);
  return result[0];
}

const db = {
  prepare(statement) {
    let values = [];
    return {
      bind(...items) { values = items; return this; },
      async first() { return query(bound()).results[0] || null; },
      async all() { return { results: query(bound()).results }; },
      async run() { return { meta: { changes: query(bound()).meta.changes } }; }
    };
    function bound() {
      let index = 0;
      const rendered = statement.replace(/\?/g, () => sql(values[index++]));
      if (index !== values.length) throw new Error("Staging D1 bind count mismatch.");
      return rendered;
    }
  }
};

function hash(value) { return createHash("sha256").update(value).digest("hex"); }

function r2Download(key, destination) {
  const result = spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--file", destination], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024
  });
  if (result.status === 0) return fs.readFileSync(destination);
  if (/The specified key does not exist/i.test(result.stderr + result.stdout)) return null;
  throw new Error(`Staging R2 lookup failed: ${result.stderr || result.stdout}`);
}

function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote"); }

function form(metadata) {
  const data = new FormData();
  data.set("metadata", JSON.stringify(metadata));
  data.set("cover", new File([WEBP], "task2c-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2c-delivery.pdf", { type: "application/pdf" }));
  return data;
}

function metadata(productId, productSlug, extra = {}) {
  return { id: productId, slug: productSlug, creatorId: "creator-rv-sawyer",
    title: "Disposable Task 2C staging product", status: "pay-what-you-want",
    buyMode: "cart", pricingModel: "pwyw", priceCents: 500,
    suggestedPriceCents: 500, minimumPriceCents: 0,
    metadata: { task2cDisposable: true }, ...extra };
}

async function main() {
  const deployment = new URL(ORIGIN);
  assert.equal(deployment.protocol, "https:");
  assert.ok(deployment.hostname === "tobacco-road-games-staging.pages.dev" ||
    deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  assert.equal(deployment.pathname, "/");
  const config = fs.readFileSync(path.join(ROOT, "ops/staging/wrangler.pages.toml"), "utf8");
  assert.match(config, /name = "tobacco-road-games-staging"/);
  assert.match(config, /database_name = "trg-orders-staging"/);
  assert.match(config, /database_id = "d92594e8-a45c-4f84-8f48-7c3aeba17f29"/);
  assert.match(config, /bucket_name = "trg-products-staging"/);
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.name, DB_NAME);
  assert.equal(info.uuid, DB_ID);
  assert.match(cli("r2", "bucket", "info", BUCKET), /name:\s+trg-products-staging/);
  const owner = query("SELECT id,role,status FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner?.role, "owner");
  assert.equal(query("SELECT name FROM d1_migrations WHERE name='057_marketplace_product_catalog.sql'").results.length, 1);
  fs.mkdirSync(testDir, { recursive: true });
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  let sessionCreated = false;
  let failedAttemptId = null;
  let mainError = null;
  try {
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60_000);
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(expires.toISOString())},${sql(now.toISOString())})`);
    sessionCreated = true;
    const headers = { origin: ORIGIN, cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`, "x-csrf-token": csrfToken };
    const denied = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: form(metadata(id, slug)), headers: { origin: ORIGIN } });
    assert.equal(denied.status, 401);
    console.log("Owner gate: unauthenticated publication rejected (401).");

    const response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: form(metadata(id, slug)), headers });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.product.id, id);
    assert.equal(body.product.publicationState, "published");
    assert.equal(body.product.minimumPriceCents, 0);
    assert.equal(body.product.creatorId, "creator-rv-sawyer");
    console.log("Native Pages publication: 201; published PWYW D1 record returned.");

    const byId = await catalog.getProductById(db, id);
    const bySlug = await catalog.getProductBySlug(db, slug);
    assert.equal(byId?.slug, slug);
    assert.equal(bySlug?.id, id);
    assert.equal(byId?.coverR2Key, body.product.coverR2Key);
    assert.equal(byId?.deliveryR2Key, body.product.deliveryR2Key);
    console.log("D1 catalog module: ID/slug lookup and explicit asset keys verified.");

    assert.deepEqual(r2Download(byId.coverR2Key, path.join(testDir, "cover.webp")), WEBP);
    assert.deepEqual(r2Download(byId.deliveryR2Key, path.join(testDir, "delivery.pdf")), PDF);
    console.log("Native staging R2: cover and PDF bytes verified independently.");

    const failed = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST",
      body: form(metadata(failedId, failedSlug, { creatorListingId: `missing-${suffix}` })), headers });
    const failedBody = await failed.json();
    assert.equal(failed.status, 503, JSON.stringify(failedBody));
    assert.equal(failedBody.code, "publication_failed");
    failedAttemptId = failedBody.attemptId;
    assert.match(failedAttemptId, /^[0-9a-f-]{36}$/i);
    assert.equal(await catalog.getProductById(db, failedId), null);
    assert.equal(r2Download(`catalog-publications/${failedAttemptId}/cover.webp`, path.join(testDir, "failed-cover.webp")), null);
    assert.equal(r2Download(`catalog-publications/${failedAttemptId}/delivery.pdf`, path.join(testDir, "failed-delivery.pdf")), null);
    assert.deepEqual(r2Download(byId.coverR2Key, path.join(testDir, "cover-after-failure.webp")), WEBP);
    console.log("Controlled D1 failure: no published row or orphan assets; existing cover preserved.");
  } catch (error) { mainError = error; }
  try {
    const product = await catalog.getProductById(db, id);
    if (product) {
      assert.equal(product.metadata.task2cDisposable, true);
      assert.equal(product.slug, slug);
      assert.match(product.coverR2Key, /^catalog-publications\/[0-9a-f-]{36}\/cover\.webp$/i);
      assert.match(product.deliveryR2Key, /^catalog-publications\/[0-9a-f-]{36}\/delivery\.pdf$/i);
      const draft = product.publicationState === "draft" ? product
        : await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      assert.equal(await catalog.deleteDraftProduct(db, draft.id), true);
      assert.equal(await catalog.getProductById(db, id), null);
      r2Delete(product.coverR2Key);
      r2Delete(product.deliveryR2Key);
      assert.equal(r2Download(product.coverR2Key, path.join(testDir, "cleaned-cover.webp")), null);
      assert.equal(r2Download(product.deliveryR2Key, path.join(testDir, "cleaned-delivery.pdf")), null);
    }
    assert.equal(await catalog.getProductBySlug(db, slug), null);
    assert.equal(await catalog.getProductById(db, failedId), null);
    if (failedAttemptId) {
      let orphan = false;
      for (const [key, filename] of [
        [`catalog-publications/${failedAttemptId}/cover.webp`, "orphan-cover.webp"],
        [`catalog-publications/${failedAttemptId}/delivery.pdf`, "orphan-delivery.pdf"]
      ]) {
        if (r2Download(key, path.join(testDir, filename)) !== null) { r2Delete(key); orphan = true; }
      }
      if (orphan) throw new Error("Failed publication left R2 objects; test cleanup removed them.");
    }
    console.log("Cleanup: product and test R2 objects absent.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    assert.equal(query(`SELECT COUNT(*) AS n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
    const expectedParent = path.join(ROOT, ".wrangler");
    if (path.dirname(testDir) !== expectedParent || !path.basename(testDir).startsWith("task2c-proof-")) {
      throw new Error("Refusing to remove an unexpected staging proof directory.");
    }
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log("Cleanup: disposable Owner session absent.");
  }
  if (mainError) throw mainError;
  console.log("Native staging publication verification passed.");
}

function makePdf() {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(text)); text += object; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
