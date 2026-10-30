// Staging-only Task 2K proof using Pages, verified account sessions, D1, and private R2.
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
const WEBHOOK_SECRET = "whsec_task2k_isolated_preview_v1";
const suffix = randomUUID().replace(/-/g, "");
const id = `task2k-${suffix}`;
const slug = `task2k-library-${suffix}`;
const buyerId = `task2k-buyer-${suffix}`;
const otherId = `task2k-other-${suffix}`;
const buyerEmail = `${buyerId}@example.test`;
const otherEmail = `${otherId}@example.test`;
const buyerToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const otherToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const ownerToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const ownerCsrf = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const attempt = `trgca_${randomUUID()}`;
const stripeSessionId = `cs_test_task2k_${suffix}`;
const eventId = `evt_task2k_${suffix}_paid`;
const PDF = makePdf();
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

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
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function assertR2Missing(key) {
  const result = spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /specified key does not exist/i);
}
function publicationForm() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2K Library Product",
    subtitle: "Staging customer library proof", shortDescription: "A disposable native paid PDF.",
    longDescription: "This product verifies native ownership in the authenticated customer library.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", buyMode: "cart", pricingModel: "fixed", priceCents: 625,
    metadata: { task2kDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2.5" }
  }));
  data.set("cover", new File([WEBP], "task2k-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2k-purchased.pdf", { type: "application/pdf" }));
  return data;
}

async function main() {
  assert.ok(new URL(ORIGIN || "").hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DB_ID);
  assert.ok(query("PRAGMA table_info(native_product_entitlements)").results.some(row => row.name === "download_reference"));
  console.log(`Staging binding: D1 ${DB_NAME} (${DB_ID}); native library schema confirmed.`);
  const owner = query("SELECT id,email_normalized,email_verified FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner.email_verified, 1);
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const nativeOrders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/native-orders-d1.mjs")).href);
  let product = null;
  let order = null;
  let coverKey = "";
  let deliveryKey = "";
  let mainError = null;
  const sessionIds = [`task2k-owner-session-${suffix}`, `task2k-buyer-session-${suffix}`, `task2k-other-session-${suffix}`];
  try {
    query("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
    const now = new Date();
    const expires = new Date(now.getTime() + 900000).toISOString();
    query(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES
      (${sql(buyerId)},${sql(buyerEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())}),
      (${sql(otherId)},${sql(otherEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())})`);
    for (const [sessionId, userId, token, csrf] of [
      [sessionIds[0], owner.id, ownerToken, ownerCsrf],
      [sessionIds[1], buyerId, buyerToken, "task2k-buyer-csrf"],
      [sessionIds[2], otherId, otherToken, "task2k-other-csrf"]
    ]) {
      query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
        ${sql(sessionId)},${sql(userId)},${sql(hash(token))},${sql(hash(csrf))},${sql(now.toISOString())},${sql(expires)},${sql(now.toISOString())})`);
    }
    const ownerAuth = { origin: ORIGIN, cookie: `__Host-trg_session=${ownerToken}; trg_account_csrf=${ownerCsrf}`, "x-csrf-token": ownerCsrf };
    let response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: publicationForm(), headers: ownerAuth });
    if (response.status !== 201) throw new Error(`Publication failed (${response.status}): ${await response.text()}`);
    product = await catalog.getProductById(db, id);
    coverKey = product.coverR2Key;
    deliveryKey = product.deliveryR2Key;

    const buyerCsrf = "task2k-buyer-csrf";
    const buyerAuth = { origin: ORIGIN, cookie: `__Host-trg_session=${buyerToken}; trg_account_csrf=${buyerCsrf}`, "x-csrf-token": buyerCsrf };
    response = await fetch(`${ORIGIN}/api/cart/prepare-order`, {
      method: "POST", headers: { ...buyerAuth, "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, email: buyerEmail, emailConfirmation: buyerEmail, items: [{ slug, quantity: 1 }]
      })
    });
    const prepared = await response.json();
    assert.equal(response.status, 201, JSON.stringify(prepared));
    order = query(`SELECT * FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0];
    response = await fetch(`${ORIGIN}/api/cart/pay-order`, {
      method: "POST", headers: { ...buyerAuth, "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, publicOrderReference: order.public_id,
        email: buyerEmail, emailConfirmation: buyerEmail
      })
    });
    assert.equal(response.status, 503);
    console.log("Real Stripe checkout remains unavailable to isolated previews; no hosted Checkout Session was claimed.");

    order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(order.id), {
      id: stripeSessionId, url: `https://checkout.stripe.test/${stripeSessionId}`
    });
    response = await sendEvent(stripeEvent(order));
    if (response.status !== 200) throw new Error(`Signed Stripe webhook failed (${response.status}): ${await response.text()}`);
    order = query(`SELECT * FROM orders WHERE id=${order.id}`).results[0];
    assert.equal(order.payment_status, "paid");
    assert.equal(query(`SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=${order.id}`).results[0].n, 1);

    response = await fetch(`${ORIGIN}/account.html`, { headers: { cookie: `__Host-trg_session=${buyerToken}` } });
    const accountHtml = await response.text();
    assert.equal(response.status, 200);
    assert.match(accountHtml, /id="library-panel"/);
    assert.match(accountHtml, /account\.js\?v=20261030a/);

    const buyerCookie = { cookie: `__Host-trg_session=${buyerToken}` };
    response = await fetch(`${ORIGIN}/api/account/library`, { headers: buyerCookie });
    assert.equal(response.status, 200);
    let library = await response.json();
    let item = library.items.find(entry => entry.productId === id);
    assert.ok(item);
    assert.equal(item.productTitle, "Disposable Task 2K Library Product");
    assert.equal(item.creator, "RV Sawyer");
    assert.equal(item.purchaseAmountCents, 625);
    assert.equal(item.purchasedVersion, "2.5");
    assert.match(item.coverImage, /^\/api\/account\/library-cover\?credential=/);
    assert.match(item.downloadUrl, /^\/store\/download\?credential=/);
    assert.doesNotMatch(JSON.stringify(item), /catalog-publications|delivery_r2_key|order_item_id|purchaser_user_id/i);
    assert.equal(library.items.filter(entry => entry.productId === id).length, 1);

    response = await fetch(`${ORIGIN}${item.coverImage}`, { headers: buyerCookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEBP);
    response = await fetch(`${ORIGIN}${item.downloadUrl}`, { headers: buyerCookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") || "", /task2k-purchased\.pdf/i);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
    console.log("My Library: verified customer saw the native purchase, authenticated cover, and exact purchased PDF.");

    const otherCookie = { cookie: `__Host-trg_session=${otherToken}` };
    response = await fetch(`${ORIGIN}/api/account/library`, { headers: otherCookie });
    assert.equal((await response.json()).items.some(entry => entry.productId === id), false);
    response = await fetch(`${ORIGIN}${item.coverImage}`, { headers: otherCookie });
    assert.equal(response.status, 403);
    response = await fetch(`${ORIGIN}${item.downloadUrl}`, { headers: otherCookie });
    assert.equal(response.status, 403);
    console.log("Authorization: second verified identity could neither see nor retrieve the purchase.");

    product = await catalog.getProductById(db, id);
    product = await catalog.updateProduct(db, id, {
      title: "Mutated Task 2K Live Title", priceCents: 975, publicationState: "paused"
    }, { expectedRevision: product.revision });
    response = await fetch(`${ORIGIN}/api/account/library`, { headers: buyerCookie });
    library = await response.json();
    item = library.items.find(entry => entry.productId === id);
    assert.ok(item);
    assert.equal(item.productTitle, "Disposable Task 2K Library Product");
    assert.equal(item.purchaseAmountCents, 625);
    assert.equal(library.items.filter(entry => entry.productId === id).length, 1);
    response = await fetch(`${ORIGIN}${item.downloadUrl}`, { headers: buyerCookie });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
    console.log("Durability: paused/repriced/retitled product retained snapshot history and secure download access.");
  } catch (error) {
    mainError = error;
  }

  try {
    if (!order) order = query(`SELECT * FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0] || null;
    if (order?.id) {
      query(`DELETE FROM native_download_attempts WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM native_product_entitlements WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM webhook_events WHERE provider_event_id=${sql(eventId)}`);
      query(`DELETE FROM orders WHERE id=${Number(order.id)}`);
    }
    product = await catalog.getProductById(db, id);
    if (product) {
      coverKey ||= product.coverR2Key;
      deliveryKey ||= product.deliveryR2Key;
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
    }
    if (coverKey) r2Delete(coverKey);
    if (deliveryKey) r2Delete(deliveryKey);
    if (coverKey) assertR2Missing(coverKey);
    if (deliveryKey) assertR2Missing(deliveryKey);
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id=${sql(id)}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0].n, 0);
    console.log("Cleanup: library audit, entitlement, event, order, product, and exact R2 objects removed.");
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
  console.log("Task 2K staging customer-library verification passed; Task 2H real-checkout limitation remains.");
}

function stripeEvent(order) {
  return {
    api_version: "2026-06-24.dahlia", created: Math.floor(Date.now() / 1000), id: eventId,
    livemode: false, object: "event", type: "checkout.session.completed", data: { object: {
      amount_total: Number(order.total_cents), currency: "usd", id: order.stripe_checkout_session_id,
      livemode: false, object: "checkout.session", payment_status: "paid", ui_mode: "hosted_page",
      payment_intent: `pi_test_task2k_${suffix}`, metadata: {
        trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id),
        trg_order_public_id: order.public_id, trg_order_source: "native_d1"
      }
    } }
  };
}
async function sendEvent(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Buffer.from(new Uint8Array(signed)).toString("hex");
  return fetch(`${ORIGIN}/api/stripe/webhook`, {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body
  });
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
