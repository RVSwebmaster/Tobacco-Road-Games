// Staging-only Task 2H D1/webhook proof. Real Stripe Session creation is attempted only when isolated preview credentials exist.
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
const WEBHOOK_SECRET = "whsec_task2h_isolated_preview_v1";
const suffix = randomUUID().replace(/-/g, "");
const id = `task2h-${suffix}`;
const slug = `task2h-stripe-${suffix}`;
const attempt = `trgca_${randomUUID()}`;
const sessionId = `task2h-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const stripeSessionId = `cs_test_task2h_${suffix}`;
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();

function cli(...args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
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
function form() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2H Stripe Order",
    subtitle: "Staging webhook proof", shortDescription: "A disposable staging native payment record.",
    longDescription: "This product verifies native Stripe reconciliation without entitlement or fulfillment activation.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", buyMode: "cart", pricingModel: "fixed", priceCents: 500,
    metadata: { task2hDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], "task2h-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2h-delivery.pdf", { type: "application/pdf" }));
  return data;
}

async function main() {
  const deployment = new URL(ORIGIN || "");
  assert.ok(deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DB_ID);
  assert.ok(query("PRAGMA table_info(orders)").results.some(row => row.name === "native_payment_expires_at"));
  console.log(`Staging binding: D1 ${DB_NAME} (${DB_ID}); migration 059 confirmed.`);
  const owner = query("SELECT id,email_normalized,email_verified FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner.email_verified, 1);
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const nativeOrders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/native-orders-d1.mjs")).href);
  let product = null;
  let order = null;
  let sessionCreated = false;
  let mainError = null;
  try {
    query("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
    const now = new Date();
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(new Date(now.getTime()+600000).toISOString())},${sql(now.toISOString())})`);
    sessionCreated = true;
    const auth = { origin: ORIGIN, cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`, "x-csrf-token": csrfToken };
    let response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: form(), headers: auth });
    assert.equal(response.status, 201, await response.text());
    product = await catalog.getProductById(db, id);

    response = await fetch(`${ORIGIN}/api/cart/prepare-order`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, email: owner.email_normalized, emailConfirmation: owner.email_normalized,
        items: [{ slug, quantity: 1, priceCents: 1 }]
      })
    });
    const prepared = await response.json();
    assert.equal(response.status, 201, JSON.stringify(prepared));
    assert.equal(prepared.totalCents, 500);
    order = query(`SELECT * FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0];
    assert.equal(order.native_order_state, "pending");
    console.log("Native preparation: authoritative 500-cent pending order recorded.");

    response = await fetch(`${ORIGIN}/api/cart/pay-order`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, publicOrderReference: order.public_id,
        email: owner.email_normalized, emailConfirmation: owner.email_normalized, priceCents: 1
      })
    });
    assert.equal(response.status, 503);
    console.log("Real Stripe checkout: unavailable because encrypted Stripe credentials are not exposed to isolated preview deployments.");

    order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(order.id), {
      id: stripeSessionId, url: `https://checkout.stripe.test/${stripeSessionId}`
    });
    let event = stripeEvent(order, { amountTotal: 501, id: `evt_task2h_${suffix}_wrong_amount` });
    response = await sendEvent(event, "invalid");
    assert.equal(response.status, 400);
    assert.equal(query(`SELECT COUNT(*) n FROM webhook_events WHERE provider_event_id=${sql(event.id)}`).results[0].n, 0);
    response = await sendEvent(event);
    let result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.code, "amount_total_mismatch");
    assert.equal(query(`SELECT payment_status FROM orders WHERE id=${order.id}`).results[0].payment_status, "pending");

    event = stripeEvent(order, { currency: "cad", id: `evt_task2h_${suffix}_wrong_currency` });
    response = await sendEvent(event);
    result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.code, "currency_mismatch");

    event = stripeEvent(order, { id: `evt_task2h_${suffix}_paid` });
    response = await sendEvent(event);
    result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    order = query(`SELECT * FROM orders WHERE id=${order.id}`).results[0];
    assert.equal(order.payment_status, "paid");
    assert.equal(order.native_order_state, "paid");
    assert.equal(order.fulfillment_status, "pending");
    assert.equal(query(`SELECT COUNT(*) n FROM download_entitlements WHERE order_id=${order.id}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM creator_sale_snapshots WHERE order_id=${order.id}`).results[0].n, 0);
    console.log("Verified webhook: signed test-mode event marked the native order paid with no download entitlement, fulfillment, or Creator accounting.");

    response = await sendEvent(event);
    result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.duplicate, true);
    const late = stripeEvent(order, { id: `evt_task2h_${suffix}_expired`, paymentStatus: "unpaid", type: "checkout.session.expired", paymentIntent: order.stripe_payment_intent_id });
    response = await sendEvent(late);
    assert.equal(response.status, 200);
    assert.equal(query(`SELECT payment_status FROM orders WHERE id=${order.id}`).results[0].payment_status, "paid");
    console.log("Idempotency: duplicate and late expiration events were accepted without changing the paid state.");
  } catch (error) { mainError = error; }

  try {
    if (order?.id) {
      query(`DELETE FROM native_product_entitlements WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM webhook_events WHERE provider_event_id LIKE ${sql(`evt_task2h_${suffix}%`)}`);
      query(`DELETE FROM orders WHERE id=${Number(order.id)}`);
    }
    product = await catalog.getProductById(db, id);
    if (product) {
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      if (product.publicationState !== "draft") product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
      if (coverKey) r2Delete(coverKey);
      if (deliveryKey) r2Delete(deliveryKey);
    }
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0].n, 0);
    assert.equal(await catalog.getProductById(db, id), null);
    console.log("Cleanup: disposable order, events, product, and R2 objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    query(`UPDATE runtime_settings SET setting_value=${sql(originalStoreState)} WHERE setting_key='store_state'`);
    assert.equal(query(`SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'`).results[0].setting_value, originalStoreState);
    console.log(`Cleanup: Owner session removed and store state restored to ${originalStoreState}.`);
  }
  if (mainError) throw mainError;
  console.log("Task 2H staging native Stripe webhook verification passed with real-checkout credential limitation recorded.");
}

function stripeEvent(order, overrides = {}) {
  return {
    api_version: "2026-06-24.dahlia", created: Math.floor(Date.now()/1000),
    data: { object: {
      amount_total: overrides.amountTotal ?? Number(order.total_cents), currency: overrides.currency || "usd",
      id: order.stripe_checkout_session_id, livemode: false,
      metadata: { trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id), trg_order_public_id: order.public_id, trg_order_source: "native_d1" },
      object: "checkout.session", payment_intent: overrides.paymentIntent === undefined ? `pi_test_task2h_${suffix}` : overrides.paymentIntent,
      payment_status: overrides.paymentStatus || "paid", ui_mode: "hosted_page"
    } },
    id: overrides.id, livemode: false, object: "event", type: overrides.type || "checkout.session.completed"
  };
}
async function sendEvent(event, mode = "valid") {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now()/1000);
  const signature = mode === "valid" ? await sign(body, timestamp) : "0".repeat(64);
  return fetch(`${ORIGIN}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body });
}
async function sign(body, timestamp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  return Buffer.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))).toString("hex");
}
function makePdf() {
  const objects = ["1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n", "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n", "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"];
  let body = "%PDF-1.4\n"; const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const start = Buffer.byteLength(body); body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10,"0")} 00000 n \n`; });
  body += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`; return Buffer.from(body);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
