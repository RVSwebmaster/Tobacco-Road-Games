// Deliberate staging-only integration proof. Requires TRG_WRANGLER_PATH and TRG_STAGING_PAGES_URL.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = process.env.TRG_WRANGLER_PATH;
const ORIGIN = process.env.TRG_STAGING_PAGES_URL;
const CONFIG = "ops/staging/wrangler.toml";
const DB_NAME = "trg-orders-staging";
const DB_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const LEAVE_FOR_BROWSER = process.env.TRG_TASK2E_LEAVE_FOR_BROWSER === "1";
const BROWSER_FIXTURE = path.join(ROOT, ".wrangler", "task2e-browser-fixture.json");
const suffix = randomUUID().replace(/-/g, "");
const id = `task2e-${suffix}`;
const slug = `task2e-storefront-${suffix}`;
const sessionId = `task2e-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
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
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote"); }

function publicationForm() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2E D1 Storefront",
    subtitle: "Visible without a rebuild", shortDescription: "A staging-only Cloudflare-native storefront proof.",
    longDescription: "This record proves that public discovery and detail rendering read D1 at request time.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    genre: "tabletop-rpg", mediaType: "digital", status: "pay-what-you-want", buyMode: "cart",
    pricingModel: "pwyw", priceCents: 700, suggestedPriceCents: 700, minimumPriceCents: 200,
    metadata: { task2eDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"],
      format: ["PDF"], features: ["Native D1 discovery"], version: "1.0", pageCount: 8,
      releaseDate: "2026-10-29", series: "Operation Severance" }
  }));
  data.set("cover", new File([WEBP], "task2e-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2e-delivery.pdf", { type: "application/pdf" }));
  return data;
}

async function main() {
  assert.ok(WRANGLER, "TRG_WRANGLER_PATH is required.");
  const deployment = new URL(ORIGIN || "");
  assert.equal(deployment.protocol, "https:");
  assert.ok(deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  assert.notEqual(deployment.hostname, "tobaccoroadgames.com");
  const config = fs.readFileSync(path.join(ROOT, "ops/staging/wrangler.pages.toml"), "utf8");
  assert.match(config, /database_name = "trg-orders-staging"/);
  assert.match(config, /database_id = "d92594e8-a45c-4f84-8f48-7c3aeba17f29"/);
  assert.match(config, /bucket_name = "trg-products-staging"/);
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.name, DB_NAME);
  assert.equal(info.uuid, DB_ID);
  assert.match(cli("r2", "bucket", "info", BUCKET), /name:\s+trg-products-staging/);
  console.log(`Staging bindings: D1 ${info.name} (${info.uuid}); R2 ${BUCKET}.`);

  const owner = query("SELECT id,role,status FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner?.role, "owner");
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  let sessionCreated = false;
  let product = null;
  let mainError = null;
  try {
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60_000);
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(expires.toISOString())},${sql(now.toISOString())})`);
    sessionCreated = true;
    const headers = { origin: ORIGIN, cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`, "x-csrf-token": csrfToken };
    const published = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: publicationForm(), headers });
    const publishedBody = await published.json();
    assert.equal(published.status, 201, JSON.stringify(publishedBody));
    assert.equal(publishedBody.product.publicationState, "published");
    product = await catalog.getProductById(db, id);
    assert.equal(product?.slug, slug);
    console.log("Publication endpoint: disposable PWYW product published to staging D1/R2 (201).");

    const listing = await fetch(`${ORIGIN}/api/catalog?limit=100&offset=0`, { cache: "no-store" });
    assert.equal(listing.status, 200);
    const listingBody = await listing.json();
    const listed = listingBody.products.find(item => item.id === id);
    assert.ok(listed, "Disposable product did not appear in the live public catalog.");
    assert.equal(listed.creatorName, "RV Sawyer");
    assert.equal(listed.storefrontVisibility, "listed");
    assert.equal(listed.minimumPriceCents, 200);
    assert.equal(listed.suggestedPriceCents, 700);
    assert.equal(listed.coverUrl, `/product-assets/${slug}/cover.webp`);
    console.log("Discovery API: product listed with Creator, cover URL, and PWYW minimum/suggestion.");

    const catalogPage = await fetch(`${ORIGIN}/store/catalog/`, { cache: "no-store" });
    assert.equal(catalogPage.status, 200);
    const catalogHtml = await catalogPage.text();
    assert.match(catalogHtml, /d1-storefront\.js/);
    const client = await fetch(`${ORIGIN}/assets/js/d1-storefront.js`, { cache: "no-store" });
    assert.equal(client.status, 200);
    assert.match(await client.text(), /\/api\/catalog\?limit=/);
    console.log("Catalog shell: live D1 hydration runtime is deployed; no rebuild occurred after publication.");

    const detail = await fetch(`${ORIGIN}/store/products/${slug}/`, { cache: "no-store" });
    assert.equal(detail.status, 200);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /Disposable Task 2E D1 Storefront/);
    assert.match(detailHtml, /RV Sawyer/);
    assert.match(detailHtml, /Pay What You Want — \$2\.00 minimum; \$7\.00 suggested/);
    assert.match(detailHtml, new RegExp(`/product-assets/${slug}/cover\\.webp`));
    assert.match(detailHtml, /Purchase temporarily unavailable/);
    assert.doesNotMatch(detailHtml, /data-cart-add|delivery\.pdf|catalog-publications/);
    const cover = await fetch(`${ORIGIN}/product-assets/${slug}/cover.webp`, { cache: "no-store" });
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await cover.arrayBuffer()), WEBP);
    console.log("Detail and cover: D1 metadata rendered; public R2 WebP bytes verified; private delivery key absent.");

    const updated = await catalog.updateProduct(db, id, {
      subtitle: "Updated live without redeployment", suggestedPriceCents: 900
    }, { expectedRevision: product.revision });
    product = updated;
    const updatedDetail = await (await fetch(`${ORIGIN}/store/products/${slug}/?revision=${updated.revision}`, { cache: "no-store" })).text();
    assert.match(updatedDetail, /Updated live without redeployment/);
    assert.match(updatedDetail, /\$9\.00 suggested/);
    console.log(`Live update: revision ${updated.revision} reflected in detail HTML without redeployment.`);

    product = await catalog.updateProduct(db, id, { publicationState: "paused" }, { expectedRevision: product.revision });
    assert.equal((await fetch(`${ORIGIN}/api/catalog?slug=${slug}`, { cache: "no-store" })).status, 404);
    assert.equal((await fetch(`${ORIGIN}/store/products/${slug}/`, { cache: "no-store" })).status, 404);
    assert.equal((await fetch(`${ORIGIN}/store/products/not-a-task2e-product/`, { cache: "no-store" })).status, 404);
    console.log("Visibility: paused and unknown products returned 404 from public catalog/detail routes.");

    assert.equal((await fetch(`${ORIGIN}/store/`, { cache: "no-store" })).status, 200);
    assert.equal((await fetch(`${ORIGIN}/store/catalog/`, { cache: "no-store" })).status, 200);
    console.log("Compatibility: existing store and legacy catalog shells remained available (200).");
  } catch (error) {
    mainError = error;
  }

  try {
    product = await catalog.getProductById(db, id);
    if (LEAVE_FOR_BROWSER && !mainError && product) {
      if (product.publicationState !== "published") {
        product = await catalog.updateProduct(db, id, { publicationState: "published" }, { expectedRevision: product.revision });
      }
      fs.writeFileSync(BROWSER_FIXTURE, JSON.stringify({ id, slug }, null, 2));
      console.log(`Browser fixture retained temporarily: ${slug}`);
    } else if (product) {
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
      if (coverKey) r2Delete(coverKey);
      if (deliveryKey) r2Delete(deliveryKey);
    }
    if (!LEAVE_FOR_BROWSER || mainError) {
      assert.equal(await catalog.getProductById(db, id), null);
      assert.equal((await fetch(`${ORIGIN}/api/catalog?slug=${slug}`, { cache: "no-store" })).status, 404);
      assert.equal((await fetch(`${ORIGIN}/product-assets/${slug}/cover.webp`, { cache: "no-store" })).status, 404);
      console.log("Cleanup: disposable D1 record and staging R2 objects removed; public lookup and cover return 404.");
    }
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    assert.equal(query(`SELECT COUNT(*) AS n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
    console.log("Cleanup: disposable Owner session removed.");
  }
  if (mainError) throw mainError;
  console.log(LEAVE_FOR_BROWSER
    ? "Task 2E staging verification passed; disposable product retained only for the immediate browser check."
    : "Task 2E native staging storefront verification passed.");
}

async function cleanupBrowserFixture() {
  if (!fs.existsSync(BROWSER_FIXTURE)) throw new Error("No Task 2E browser fixture is recorded.");
  const fixture = JSON.parse(fs.readFileSync(BROWSER_FIXTURE, "utf8"));
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  let product = await catalog.getProductById(db, fixture.id);
  if (product) {
    const coverKey = product.coverR2Key;
    const deliveryKey = product.deliveryR2Key;
    if (product.publicationState !== "draft") {
      product = await catalog.updateProduct(db, product.id, { publicationState: "draft" }, { expectedRevision: product.revision });
    }
    assert.equal(await catalog.deleteDraftProduct(db, product.id), true);
    if (coverKey) r2Delete(coverKey);
    if (deliveryKey) r2Delete(deliveryKey);
  }
  assert.equal(await catalog.getProductById(db, fixture.id), null);
  assert.equal((await fetch(`${ORIGIN}/api/catalog?slug=${fixture.slug}`, { cache: "no-store" })).status, 404);
  assert.equal((await fetch(`${ORIGIN}/product-assets/${fixture.slug}/cover.webp`, { cache: "no-store" })).status, 404);
  fs.rmSync(BROWSER_FIXTURE, { force: true });
  console.log(`Browser fixture cleanup passed: ${fixture.slug}`);
}

function makePdf() {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

const operation = process.argv[2] === "--cleanup-browser-fixture" ? cleanupBrowserFixture : main;
operation().catch(error => { console.error(error); process.exitCode = 1; });
