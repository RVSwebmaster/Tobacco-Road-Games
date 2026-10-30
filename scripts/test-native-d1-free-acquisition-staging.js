// Staging-only Task 2L proof using Pages, verified account sessions, D1, and private R2.
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
const freeId = `task2l-free-${suffix}`;
const freeSlug = `task2l-free-${suffix}`;
const pwywId = `task2l-pwyw-${suffix}`;
const pwywSlug = `task2l-pwyw-${suffix}`;
const buyerId = `task2l-buyer-${suffix}`;
const otherId = `task2l-other-${suffix}`;
const buyerEmail = `${buyerId}@example.test`;
const otherEmail = `${otherId}@example.test`;
const buyerToken = token();
const otherToken = token();
const ownerToken = token();
const ownerCsrf = token();
const buyerCsrf = `task2l-buyer-${suffix}`;
const otherCsrf = `task2l-other-${suffix}`;
const attempts = {
  free: `trgca_${randomUUID()}`,
  pwyw: `trgca_${randomUUID()}`
};
const PDF = makePdf();
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

function token() { return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function cli(...args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
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
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function assertR2Missing(key) {
  const result = spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /specified key does not exist/i);
}
function publicationForm({ id, slug, pricingModel }) {
  const pwyw = pricingModel === "pwyw";
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer",
    title: pwyw ? "Disposable Task 2L Zero PWYW" : "Disposable Task 2L Free Product",
    subtitle: "Staging native free-acquisition proof",
    shortDescription: "A disposable native zero-value PDF.",
    longDescription: "This product verifies authenticated zero-value acquisition without Stripe.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: pwyw ? "pay-what-you-want" : "free-download",
    buyMode: pwyw ? "cart" : "free-download", pricingModel,
    priceCents: pwyw ? 500 : 0, minimumPriceCents: pwyw ? 0 : null,
    suggestedPriceCents: pwyw ? 500 : null,
    metadata: { task2lDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], `${slug}-cover.webp`, { type: "image/webp" }));
  data.set("pdf", new File([PDF], `${slug}.pdf`, { type: "application/pdf" }));
  return data;
}

async function main() {
  assert.ok(new URL(ORIGIN || "").hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DB_ID);
  const entitlementColumns = query("PRAGMA table_info(native_product_entitlements)").results;
  assert.ok(entitlementColumns.some(row => row.name === "download_reference"));
  const migration = query("SELECT id,name FROM d1_migrations WHERE id=62").results[0];
  assert.equal(migration?.name, "062_native_free_product_acquisition.sql");
  console.log(`Staging binding: D1 ${DB_NAME} (${DB_ID}); Task 2L migration confirmed.`);

  const owner = query("SELECT id,email_normalized,email_verified FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner.email_verified, 1);
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const products = [];
  const orders = [];
  const sessionIds = [`task2l-owner-${suffix}`, `task2l-buyer-${suffix}`, `task2l-other-${suffix}`];
  let mainError = null;
  try {
    query("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
    const now = new Date();
    const expires = new Date(now.getTime() + 900000).toISOString();
    query(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES
      (${sql(buyerId)},${sql(buyerEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())}),
      (${sql(otherId)},${sql(otherEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())})`);
    for (const [sessionId, userId, sessionToken, csrf] of [
      [sessionIds[0], owner.id, ownerToken, ownerCsrf],
      [sessionIds[1], buyerId, buyerToken, buyerCsrf],
      [sessionIds[2], otherId, otherToken, otherCsrf]
    ]) {
      query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
        ${sql(sessionId)},${sql(userId)},${sql(hash(sessionToken))},${sql(hash(csrf))},${sql(now.toISOString())},${sql(expires)},${sql(now.toISOString())})`);
    }

    const ownerAuth = { origin: ORIGIN, cookie: `__Host-trg_session=${ownerToken}; trg_account_csrf=${ownerCsrf}`, "x-csrf-token": ownerCsrf };
    for (const fixture of [
      { id: freeId, slug: freeSlug, pricingModel: "free" },
      { id: pwywId, slug: pwywSlug, pricingModel: "pwyw" }
    ]) {
      const response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, {
        method: "POST", body: publicationForm(fixture), headers: ownerAuth
      });
      if (response.status !== 201) throw new Error(`Publication failed (${response.status}): ${await response.text()}`);
      products.push(await catalog.getProductById(db, fixture.id));
    }
    console.log("Publication: disposable fixed-free and zero-minimum PWYW products reached staging D1 and R2.");

    const buyerAuth = { origin: ORIGIN, cookie: `__Host-trg_session=${buyerToken}; trg_account_csrf=${buyerCsrf}`, "x-csrf-token": buyerCsrf };
    for (const fixture of [
      { key: "free", slug: freeSlug },
      { key: "pwyw", slug: pwywSlug, amountCents: 0 }
    ]) {
      const body = {
        checkoutAttemptId: attempts[fixture.key], email: buyerEmail, emailConfirmation: buyerEmail,
        items: [{ slug: fixture.slug, quantity: 1, ...(fixture.amountCents === undefined ? {} : { amountCents: fixture.amountCents }) }]
      };
      let response = await fetch(`${ORIGIN}/api/cart/acquire-free`, {
        method: "POST", headers: { ...buyerAuth, "content-type": "application/json" }, body: JSON.stringify(body)
      });
      let result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      assert.equal(result.acquisitionComplete, true);
      assert.equal(result.totalCents, 0);
      assert.equal(result.paymentProvider, "none");
      assert.equal(result.stripeCheckoutSessionCreated, false);
      assert.doesNotMatch(JSON.stringify(result), /catalog-publications|delivery_r2_key|order_item_id|purchaser_user_id/i);
      const order = query(`SELECT * FROM orders WHERE checkout_attempt_id=${sql(attempts[fixture.key])}`).results[0];
      orders.push(order);
      assert.equal(order.user_id, buyerId);
      assert.equal(order.payment_status, "paid");
      assert.equal(order.native_order_state, "free_acquired");
      assert.equal(order.payment_source, "none");
      assert.equal(order.settlement_method, "no_payment");
      assert.equal(order.total_cents, 0);
      assert.equal(order.stripe_checkout_session_id, null);
      assert.equal(order.stripe_payment_intent_id, null);
      assert.equal(query(`SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=${order.id} AND entitlement_source='native_free'`).results[0].n, 1);

      response = await fetch(`${ORIGIN}/api/cart/acquire-free`, {
        method: "POST", headers: { ...buyerAuth, "content-type": "application/json" }, body: JSON.stringify(body)
      });
      result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.reusedCheckoutAttempt, true);
    }
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id IN (${sql(attempts.free)},${sql(attempts.pwyw)})`).results[0].n, 2);
    assert.equal(query(`SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id IN (${orders.map(row => row.id).join(",")})`).results[0].n, 2);
    console.log("Acquisition: both zero-value products completed without Stripe; retries created no duplicate orders or ownership.");

    const buyerCookie = { cookie: `__Host-trg_session=${buyerToken}` };
    let response = await fetch(`${ORIGIN}/api/account/library`, { headers: buyerCookie });
    assert.equal(response.status, 200);
    const library = await response.json();
    for (const fixture of [{ id: freeId, slug: freeSlug }, { id: pwywId, slug: pwywSlug }]) {
      const item = library.items.find(entry => entry.productId === fixture.id);
      assert.ok(item, `${fixture.id} must appear in My Library.`);
      assert.equal(item.purchaseAmountCents, 0);
      assert.match(item.downloadUrl, /^\/store\/download\?credential=/);
      response = await fetch(`${ORIGIN}${item.downloadUrl}`, { headers: buyerCookie });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
    }
    const otherCookie = { cookie: `__Host-trg_session=${otherToken}` };
    response = await fetch(`${ORIGIN}/api/account/library`, { headers: otherCookie });
    assert.equal((await response.json()).items.some(entry => [freeId, pwywId].includes(entry.productId)), false);
    const buyerItem = library.items.find(entry => entry.productId === freeId);
    response = await fetch(`${ORIGIN}${buyerItem.downloadUrl}`, { headers: otherCookie });
    assert.equal(response.status, 403);
    console.log("Library/delivery: buyer retrieved both exact PDFs; the second verified identity was denied.");
  } catch (error) {
    mainError = error;
  }

  try {
    const persistedOrders = query(`SELECT id FROM orders WHERE checkout_attempt_id IN (${sql(attempts.free)},${sql(attempts.pwyw)})`).results;
    if (persistedOrders.length) {
      const ids = persistedOrders.map(row => Number(row.id)).join(",");
      query(`DELETE FROM native_download_attempts WHERE order_id IN (${ids})`);
      query(`DELETE FROM native_product_entitlements WHERE order_id IN (${ids})`);
      query(`DELETE FROM orders WHERE id IN (${ids})`);
    }
    for (const id of [freeId, pwywId]) {
      let product = await catalog.getProductById(db, id);
      if (!product) continue;
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
      r2Delete(coverKey);
      r2Delete(deliveryKey);
      assertR2Missing(coverKey);
      assertR2Missing(deliveryKey);
    }
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id IN (${sql(freeId)},${sql(pwywId)})`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id IN (${sql(attempts.free)},${sql(attempts.pwyw)})`).results[0].n, 0);
    console.log("Cleanup: download audits, entitlements, orders, products, and exact R2 objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    query(`DELETE FROM sessions WHERE id IN (${sessionIds.map(sql).join(",")})`);
    query(`DELETE FROM users WHERE id IN (${sql(buyerId)},${sql(otherId)})`);
    query(`UPDATE runtime_settings SET setting_value=${sql(originalStoreState)} WHERE setting_key='store_state'`);
    assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
    assert.equal(query(`SELECT COUNT(*) n FROM users WHERE id IN (${sql(buyerId)},${sql(otherId)})`).results[0].n, 0);
    console.log("Cleanup: disposable identities and sessions removed; staging store remains CLOSED.");
  }
  if (mainError) throw mainError;
  console.log("Task 2L staging free-acquisition verification passed; Task 2H real-checkout limitation remains.");
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
  const xref = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer<</Size 4/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
