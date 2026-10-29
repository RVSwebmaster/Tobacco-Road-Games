// Staging-only Task 2I proof using native Pages, D1, R2, and verified webhook bindings.
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
const WEBHOOK_SECRET = "whsec_task2i_isolated_preview_v1";
const suffix = randomUUID().replace(/-/g, "");
const id = `task2i-${suffix}`;
const slug = `task2i-entitlement-${suffix}`;
const attempt = `trgca_${randomUUID()}`;
const sessionId = `task2i-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const stripeSessionId = `cs_test_task2i_${suffix}`;
const eventId = `evt_task2i_${suffix}_paid`;
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();

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
function publicationForm() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2I Ownership",
    subtitle: "Staging entitlement proof", shortDescription: "A disposable native ownership record.",
    longDescription: "This product verifies paid native ownership through the signed Stripe webhook path.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", buyMode: "cart", pricingModel: "fixed", priceCents: 500,
    metadata: { task2iDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2.0" }
  }));
  data.set("cover", new File([WEBP], "task2i-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2i-delivery.pdf", { type: "application/pdf" }));
  return data;
}

async function main() {
  const deployment = new URL(ORIGIN || "");
  assert.ok(deployment.hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DB_ID);
  assert.ok(query("PRAGMA table_info(orders)").results.some(row => row.name === "native_entitlement_status"));
  assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='native_product_entitlements'").results.length === 1);
  console.log(`Staging binding: D1 ${DB_NAME} (${DB_ID}); migration 060 confirmed.`);

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
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at)
      VALUES(${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},
      ${sql(now.toISOString())},${sql(new Date(now.getTime() + 600000).toISOString())},${sql(now.toISOString())})`);
    sessionCreated = true;
    const auth = {
      origin: ORIGIN,
      cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`,
      "x-csrf-token": csrfToken
    };
    let response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, {
      method: "POST", body: publicationForm(), headers: auth
    });
    assert.equal(response.status, 201, await response.text());
    product = await catalog.getProductById(db, id);
    assert.ok(product);

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
    assert.equal(order.native_entitlement_status, "pending");
    assert.equal(order.user_id, owner.id);
    console.log("Native preparation: authoritative 500-cent order snapshot recorded for the staging customer.");

    response = await fetch(`${ORIGIN}/api/cart/pay-order`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, publicOrderReference: order.public_id,
        email: owner.email_normalized, emailConfirmation: owner.email_normalized
      })
    });
    assert.equal(response.status, 503);
    console.log("Real Stripe checkout: unavailable because encrypted Stripe credentials are not exposed to isolated preview deployments.");

    order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(order.id), {
      id: stripeSessionId, url: `https://checkout.stripe.test/${stripeSessionId}`
    });
    const event = stripeEvent(order);
    response = await sendEvent(event);
    const webhookResult = await response.json();
    assert.equal(response.status, 200, JSON.stringify(webhookResult));
    assert.doesNotMatch(JSON.stringify(webhookResult), /r2|delivery|email_hash|purchaser/i);
    order = query(`SELECT * FROM orders WHERE id=${order.id}`).results[0];
    assert.equal(order.payment_status, "paid");
    assert.equal(order.native_order_state, "paid");
    assert.equal(order.native_entitlement_status, "ready");
    assert.equal(order.fulfillment_status, "pending");
    let owned = query(`SELECT * FROM native_product_entitlements WHERE order_id=${order.id}`).results;
    assert.equal(owned.length, 1);
    assert.equal(owned[0].purchaser_user_id, owner.id);
    assert.equal(owned[0].native_product_id, id);
    assert.equal(owned[0].product_slug_snapshot, slug);
    assert.equal(owned[0].native_creator_id, "creator-rv-sawyer");
    assert.equal(owned[0].catalog_revision_snapshot, 1);
    assert.equal(owned[0].version_snapshot, "2.0");
    assert.equal(owned[0].selected_price_cents_snapshot, 500);
    assert.equal(query(`SELECT COUNT(*) n FROM download_entitlements WHERE order_id=${order.id}`).results[0].n, 0);
    console.log("Verified webhook: paid order created exactly one immutable native ownership entitlement and no download entitlement.");

    response = await sendEvent(event);
    const duplicate = await response.json();
    assert.equal(response.status, 200);
    assert.equal(duplicate.duplicate, true);
    assert.equal(query(`SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=${order.id}`).results[0].n, 1);
    console.log("Idempotency: duplicate signed event retained exactly one entitlement.");

    product = await catalog.getProductById(db, id);
    product = await catalog.updateProduct(db, id, { priceCents: 900, publicationState: "paused" }, {
      expectedRevision: product.revision
    });
    owned = query(`SELECT * FROM native_product_entitlements WHERE order_id=${order.id}`).results;
    assert.equal(owned.length, 1);
    assert.equal(owned[0].selected_price_cents_snapshot, 500);
    assert.equal(owned[0].catalog_revision_snapshot, 1);
    console.log("Durability: entitlement persisted unchanged after repricing and pausing the product.");
  } catch (error) {
    mainError = error;
  }

  try {
    if (order?.id) {
      query(`DELETE FROM native_product_entitlements WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM webhook_events WHERE provider_event_id=${sql(eventId)}`);
      query(`DELETE FROM orders WHERE id=${Number(order.id)}`);
    }
    product = await catalog.getProductById(db, id);
    if (product) {
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
      if (coverKey) r2Delete(coverKey);
      if (deliveryKey) r2Delete(deliveryKey);
    }
    assert.equal(query(`SELECT COUNT(*) n FROM native_product_entitlements WHERE native_product_id=${sql(id)}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0].n, 0);
    assert.equal(await catalog.getProductById(db, id), null);
    console.log("Cleanup: entitlement, order, event, product, and R2 objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    if (sessionCreated) query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    query(`UPDATE runtime_settings SET setting_value=${sql(originalStoreState)} WHERE setting_key='store_state'`);
    const restored = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
    assert.equal(restored, originalStoreState);
    assert.equal(restored, "CLOSED");
    console.log("Cleanup: Owner session removed and staging store remains CLOSED.");
  }
  if (mainError) throw mainError;
  console.log("Task 2I staging native paid-purchase entitlement verification passed; Task 2H real-checkout limitation remains.");
}

function stripeEvent(order) {
  return {
    api_version: "2026-06-24.dahlia", created: Math.floor(Date.now() / 1000),
    data: { object: {
      amount_total: Number(order.total_cents), currency: "usd", id: order.stripe_checkout_session_id,
      livemode: false, metadata: {
        trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id),
        trg_order_public_id: order.public_id, trg_order_source: "native_d1"
      }, object: "checkout.session", payment_intent: `pi_test_task2i_${suffix}`,
      payment_status: "paid", ui_mode: "hosted_page"
    } },
    id: eventId, livemode: false, object: "event", type: "checkout.session.completed"
  };
}
async function sendEvent(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sign(body, timestamp);
  return fetch(`${ORIGIN}/api/stripe/webhook`, {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body
  });
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
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
