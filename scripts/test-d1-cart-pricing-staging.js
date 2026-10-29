// Deliberate staging-only Task 2F proof. Requires TRG_WRANGLER_PATH and TRG_STAGING_PAGES_URL.
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
const suffix = randomUUID().replace(/-/g, "");
const id = `task2f-${suffix}`;
const slug = `task2f-cart-${suffix}`;
const sessionId = `task2f-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();

function cli(...args) {
  if (!WRANGLER) throw new Error("TRG_WRANGLER_PATH must identify a local Wrangler CLI.");
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
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
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2F Native Cart",
    subtitle: "Server-authoritative D1 pricing", shortDescription: "A staging-only native cart pricing proof.",
    longDescription: "This record verifies D1-backed cart quotes without enabling payment or fulfillment.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw",
    priceCents: 700, minimumPriceCents: 250, suggestedPriceCents: 700,
    metadata: { task2fDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], format: ["PDF"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], "task2f-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2f-delivery.pdf", { type: "application/pdf" }));
  return data;
}
async function quote(items) {
  const response = await fetch(`${ORIGIN}/api/cart/quote`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function main() {
  const deployment = new URL(ORIGIN || "");
  assert.equal(deployment.protocol, "https:");
  assert.ok(deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  assert.notEqual(deployment.hostname, "tobaccoroadgames.com");
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
    product = await catalog.getProductById(db, id);
    assert.equal(product?.publicationState, "published");
    console.log("Native publication: disposable PWYW product created through Pages/D1/R2 (201).");

    const cartPage = await fetch(`${ORIGIN}/store/cart/`, { cache: "no-store" });
    assert.equal(cartPage.status, 200);
    const cartRuntime = await fetch(`${ORIGIN}/assets/js/cart.js`, { cache: "no-store" });
    assert.equal(cartRuntime.status, 200);
    assert.match(await cartRuntime.text(), /checkoutAllowed === false/);
    console.log("Cart interface: existing cart page and native quote-only presentation runtime are deployed.");

    let body = await quote([{ slug, productId: "forged", quantity: 1, amountCents: 525, priceCents: 1 }]);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].effectivePriceCents, 525);
    assert.equal(body.items[0].minimumPriceCents, 250);
    assert.equal(body.items[0].suggestedPriceCents, 700);
    assert.equal(body.items[0].catalogSource, "native-d1");
    assert.equal(body.items[0].catalogRevision, product.revision);
    assert.equal(body.checkoutAllowed, false);
    assert.equal(body.items[0].deliveryR2Key, undefined);
    assert.equal(JSON.stringify(body).includes(product.deliveryR2Key), false);
    console.log("Native quote: selected PWYW amount accepted; forged ID/price ignored; checkout remains disabled; delivery key withheld.");

    body = await quote([{ slug, quantity: 1, amountCents: 249 }]);
    assert.equal(body.items.length, 0);
    assert.equal(body.unavailableItems[0].code, "pwyw_below_minimum");
    console.log("PWYW validation: one cent below the D1 minimum rejected.");

    product = await catalog.updateProduct(db, id, {
      title: "Disposable Task 2F Native Cart Revised", priceCents: 900,
      minimumPriceCents: 300, suggestedPriceCents: 900
    }, { expectedRevision: product.revision });
    body = await quote([{ slug, quantity: 1, amountCents: 850, catalogRevision: 1, priceCents: 700 }]);
    assert.equal(body.items[0].title, "Disposable Task 2F Native Cart Revised");
    assert.equal(body.items[0].minimumPriceCents, 300);
    assert.equal(body.items[0].suggestedPriceCents, 900);
    assert.equal(body.items[0].catalogRevision, product.revision);
    console.log(`Live revision: D1 revision ${product.revision} and updated PWYW bounds quoted without rebuild or redeployment.`);

    product = await catalog.updateProduct(db, id, { publicationState: "paused" }, { expectedRevision: product.revision });
    body = await quote([{ slug, quantity: 1, amountCents: 850 }]);
    assert.equal(body.items.length, 0);
    assert.equal(body.unavailableItems[0].code, "paused_product");
    console.log("Availability: paused native product rejected safely by the live quote endpoint.");
  } catch (error) { mainError = error; }
  try {
    product = await catalog.getProductById(db, id);
    if (product) {
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      if (product.publicationState !== "draft") product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
      if (coverKey) r2Delete(coverKey);
      if (deliveryKey) r2Delete(deliveryKey);
    }
    assert.equal(await catalog.getProductById(db, id), null);
    const after = await quote([{ slug, quantity: 1, amountCents: 850 }]);
    assert.equal(after.items.length, 0);
    assert.equal(after.unavailableItems[0].code, "unknown_slug");
    assert.equal((await fetch(`${ORIGIN}/product-assets/${slug}/cover.webp`, { cache: "no-store" })).status, 404);
    console.log("Cleanup: disposable D1 record and R2 objects removed; quote is unknown and cover is 404.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    assert.equal(query(`SELECT COUNT(*) AS n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
    console.log("Cleanup: disposable Owner session removed.");
  }
  if (mainError) throw mainError;
  console.log("Task 2F staging D1 cart pricing verification passed.");
}

function makePdf() {
  const objects = ["1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n", "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n", "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
