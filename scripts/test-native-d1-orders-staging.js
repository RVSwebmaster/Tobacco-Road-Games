// Deliberate staging-only Task 2G proof. Requires TRG_WRANGLER_PATH and TRG_STAGING_PAGES_URL.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
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
const id = `task2g-${suffix}`;
const slug = `task2g-order-${suffix}`;
const sessionId = `task2g-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const attemptOne = `trgca_${randomUUID()}`;
const attemptTwo = `trgca_${randomUUID()}`;
const attemptThree = `trgca_${randomUUID()}`;
const attemptMixed = `trgca_${randomUUID()}`;
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
  throw new TypeError("Unsupported staging D1 value.");
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
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function publicationForm() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2G Native Order",
    subtitle: "Immutable staging order snapshot", shortDescription: "A staging-only native order proof.",
    longDescription: "This disposable product verifies native D1 pending order preparation without payment or fulfillment.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw",
    priceCents: 700, minimumPriceCents: 250, suggestedPriceCents: 700,
    metadata: { task2gDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], "task2g-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2g-delivery.pdf", { type: "application/pdf" }));
  return data;
}
async function prepare(attempt, items, headers) {
  const { ownerEmail, ...requestHeaders } = headers;
  return fetch(`${ORIGIN}/api/cart/prepare-order`, {
    method: "POST", headers: { ...requestHeaders, "content-type": "application/json" }, body: JSON.stringify({
      checkoutAttemptId: attempt, email: ownerEmail, emailConfirmation: ownerEmail, items
    })
  });
}
async function responseBody(response) {
  const text = await response.text();
  if (!text) throw new Error(`Staging endpoint returned an empty HTTP ${response.status} response.`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Staging endpoint returned HTTP ${response.status} with non-JSON content: ${text.slice(0, 500)}`); }
}

async function main() {
  const deployment = new URL(ORIGIN || "");
  assert.equal(deployment.protocol, "https:");
  assert.ok(deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  assert.notEqual(deployment.hostname, "tobaccoroadgames.com");
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.name, DB_NAME);
  assert.equal(info.uuid, DB_ID);
  console.log(`Staging binding: D1 ${info.name} (${info.uuid}).`);
  const columns = query("PRAGMA table_info(order_items)").results.map(row => row.name);
  assert.ok(columns.includes("native_product_id") && columns.includes("delivery_r2_key_snapshot"));
  console.log("Migration 058: native order snapshot columns confirmed on staging.");
  const owner = query("SELECT id,email_normalized,email_verified,role,status FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner?.email_verified, 1);
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0]?.setting_value;
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  let sessionCreated = false;
  let product = null;
  let mainError = null;
  try {
    query("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60_000);
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(expires.toISOString())},${sql(now.toISOString())})`);
    sessionCreated = true;
    const auth = {
      origin: ORIGIN,
      cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`,
      "x-csrf-token": csrfToken
    };
    const published = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: publicationForm(), headers: auth });
    assert.equal(published.status, 201, await published.text());
    product = await catalog.getProductById(db, id);
    assert.equal(product?.publicationState, "published");
    console.log("Native publication: disposable PWYW product created through Pages/D1/R2.");

    const orderHeaders = { ...auth, ownerEmail: owner.email_normalized };
    let response = await prepare(attemptOne, [{ slug, quantity: 1, amountCents: 525, priceCents: 1 }], orderHeaders);
    let body = await responseBody(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.totalCents, 525);
    assert.equal(body.nativeOrderState, "pending");
    assert.equal(body.paymentActivation, false);
    assert.equal(JSON.stringify(body).includes(product.deliveryR2Key), false);
    const stored = query(`SELECT o.id,o.public_id,o.payment_status,o.fulfillment_status,o.catalog_source,o.native_order_state,o.stripe_checkout_session_id,oi.* FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.checkout_attempt_id=${sql(attemptOne)}`).results[0];
    assert.equal(stored.native_product_id, id);
    assert.equal(stored.native_creator_id, "creator-rv-sawyer");
    assert.equal(stored.catalog_revision, product.revision);
    assert.equal(stored.selected_price_cents, 525);
    assert.equal(stored.delivery_r2_key_snapshot, product.deliveryR2Key);
    assert.equal(stored.stripe_checkout_session_id, null);
    assert.equal(query(`SELECT COUNT(*) n FROM download_entitlements WHERE order_id=${stored.order_id || stored.id}`).results[0].n, 0);
    console.log("Pending order: authoritative PWYW snapshot stored privately with no Stripe Session or entitlement.");

    response = await prepare(attemptOne, [{ slug, quantity: 1, amountCents: 525 }], orderHeaders);
    body = await responseBody(response);
    assert.equal(response.status, 200);
    assert.equal(body.reusedCheckoutAttempt, true);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attemptOne)}`).results[0].n, 1);
    console.log("Idempotency: identical retry reused the same order.");

    product = await catalog.updateProduct(db, id, { title: "Disposable Task 2G Native Order Revised", minimumPriceCents: 300, suggestedPriceCents: 900, priceCents: 900 }, { expectedRevision: product.revision });
    response = await prepare(attemptOne, [{ slug, quantity: 1, amountCents: 850 }], orderHeaders);
    assert.equal(response.status, 409);
    const original = query(`SELECT o.total_cents,oi.product_title_snapshot,oi.catalog_revision,oi.selected_price_cents FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.checkout_attempt_id=${sql(attemptOne)}`).results[0];
    assert.deepEqual([original.total_cents, original.product_title_snapshot, original.catalog_revision, original.selected_price_cents], [525, "Disposable Task 2G Native Order", 1, 525]);
    response = await prepare(attemptTwo, [{ slug, quantity: 1, amountCents: 850 }], orderHeaders);
    body = await responseBody(response);
    assert.equal(response.status, 201);
    assert.equal(body.totalCents, 850);
    assert.equal(body.items[0].catalogRevision, product.revision);
    console.log(`Repricing: revision ${product.revision} required a new attempt; the original snapshot remained unchanged.`);

    response = await prepare(attemptMixed, [{ slug, quantity: 1, amountCents: 850 }, { slug: "agency", quantity: 1 }], orderHeaders);
    body = await responseBody(response);
    assert.equal(response.status, 400);
    assert.equal(body.unavailableItems[0].code, "unknown_slug");
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attemptMixed)}`).results[0].n, 0);
    console.log("Compatibility: staging has no legacy runtime record; the mixed probe rejected the unknown legacy slug without a partial order.");

    product = await catalog.updateProduct(db, id, { publicationState: "paused" }, { expectedRevision: product.revision });
    response = await prepare(attemptThree, [{ slug, quantity: 1, amountCents: 850 }], orderHeaders);
    body = await responseBody(response);
    assert.equal(response.status, 400);
    assert.equal(body.unavailableItems[0].code, "paused_product");
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attemptThree)}`).results[0].n, 0);
    console.log("Availability: paused product rejected without creating an order.");
  } catch (error) {
    mainError = error;
  }

  try {
    query(`DELETE FROM orders WHERE checkout_attempt_id IN (${[attemptOne, attemptTwo, attemptThree, attemptMixed].map(sql).join(",")})`);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id IN (${[attemptOne, attemptTwo, attemptThree, attemptMixed].map(sql).join(",")})`).results[0].n, 0);
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
    console.log("Cleanup: native orders, item snapshots, product, and R2 objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    if (originalStoreState) query(`UPDATE runtime_settings SET setting_value=${sql(originalStoreState)} WHERE setting_key='store_state'`);
    assert.equal(query(`SELECT COUNT(*) n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
    assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, originalStoreState);
    console.log(`Cleanup: Owner session removed and store state restored to ${originalStoreState}.`);
  }
  if (mainError) throw mainError;
  console.log("Task 2G staging native pending-order verification passed.");
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
