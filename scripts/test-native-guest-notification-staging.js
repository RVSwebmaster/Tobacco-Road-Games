// Task 2P-B staging-only setup, verification, and cleanup for the actual Pages claim UI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = process.env.TRG_WRANGLER_PATH;
const ORIGIN = process.env.TRG_STAGING_PAGES_URL;
const CONFIG = "ops/staging/wrangler.toml";
const DB = "trg-orders-staging";
const DB_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const ACCESS_SECRET = "task2pb-isolated-preview-order-access-secret-v1";
const WEBHOOK_SECRET = "whsec_task2pb_isolated_preview_v1";
const STATE_FILE = path.join(ROOT, ".wrangler", "task2pb-staging-state.json");
const PASSWORD = "Task2PB!ClaimPassphrase2026";

function cli(...args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
function query(command) {
  const result = JSON.parse(cli("d1", "execute", DB, "--remote", "--config", CONFIG, "--json", "--command", command));
  if (result.length !== 1 || result[0].success !== true) throw new Error(JSON.stringify(result));
  return result[0];
}
function prepared(statement, values = []) {
  return {
    bind(...next) { return prepared(statement, next); },
    async first() { return query(render()).results[0] || null; },
    async all() { return { results: query(render()).results }; },
    async run() { return { meta: { changes: query(render()).meta.changes } }; }
  };
  function render() {
    let index = 0;
    const result = statement.replace(/\?/g, () => sql(values[index++]));
    if (index !== values.length) throw new Error("D1 staging bind count mismatch.");
    return result;
  }
}
const database = {
  prepare(statement) { return prepared(statement); },
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
};
function storeState() { return query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0]?.setting_value; }
function readState() { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

async function setup() {
  assert.ok(WRANGLER && fs.existsSync(WRANGLER), "TRG_WRANGLER_PATH is required.");
  assert.ok(new URL(ORIGIN).hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  assert.equal(JSON.parse(cli("d1", "info", DB, "--json", "--config", CONFIG)).uuid, DB_ID);
  assert.equal(storeState(), "CLOSED");
  assert.deepEqual(query("SELECT name FROM pragma_table_info('order_access_credentials') WHERE name IN ('expires_at','consumed_at','consumed_by_user_id') ORDER BY name").results.map(row => row.name), ["consumed_at", "consumed_by_user_id", "expires_at"]);

  const auth = await import(pathToFileURL(path.join(ROOT, "functions/_lib/account-auth.mjs")).href);
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const orders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/native-orders-d1.mjs")).href);
  const privacy = await import(pathToFileURL(path.join(ROOT, "functions/_lib/order-privacy.mjs")).href);
  const access = await import(pathToFileURL(path.join(ROOT, "functions/_lib/order-access.mjs")).href);
  const suffix = randomUUID().replace(/-/g, "");
  const state = {
    suffix, id: `task2pb-${suffix}`, slug: `task2pb-claim-${suffix}`,
    buyerId: `task2pb-buyer-${suffix}`, buyerEmail: `task2pb-buyer-${suffix}@example.test`,
    otherId: `task2pb-other-${suffix}`, otherEmail: `task2pb-other-${suffix}@example.test`,
    attempt: `trgca_${randomUUID()}`, eventId: `evt_task2pb_${suffix}_paid`,
    stripeSessionId: `cs_test_task2pb_${suffix}`,
    coverKey: `catalog-publications/task2pb-${suffix}/cover.webp`,
    deliveryKey: `catalog-publications/task2pb-${suffix}/delivery.pdf`,
    password: PASSWORD, origin: ORIGIN
  };
  const now = new Date();
  const passwordHash = await auth.hashPassword(PASSWORD);
  query(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES
    (${sql(state.buyerId)},${sql(state.buyerEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())}),
    (${sql(state.otherId)},${sql(state.otherEmail)},1,${sql(now.toISOString())},'active','user',${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO password_credentials(user_id,password_hash,created_at,updated_at) VALUES
    (${sql(state.buyerId)},${sql(passwordHash)},${sql(now.toISOString())},${sql(now.toISOString())}),
    (${sql(state.otherId)},${sql(passwordHash)},${sql(now.toISOString())},${sql(now.toISOString())})`);

  const product = await catalog.createProduct(database, {
    id: state.id, slug: state.slug, creatorId: "creator-rv-sawyer", title: "Disposable Task 2P-B Guest Claim",
    subtitle: "Staging claim experience proof", shortDescription: "Disposable native guest ownership proof.",
    longDescription: "Verifies authenticated guest purchase claiming without opening the staging store.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", publicationState: "published", buyMode: "cart",
    pricingModel: "fixed", priceCents: 725, currency: "USD", coverR2Key: state.coverKey,
    deliveryR2Key: state.deliveryKey, deliveryFilename: "Task 2P-B Purchased.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2P-B" }
  });
  const emailHash = await privacy.createCustomerEmailHash(state.buyerEmail, "task2pb-staging-email-hash-secret");
  const created = await orders.createOrGetNativePendingOrder(database, {
    checkoutAttemptId: state.attempt, checkoutRequestHash: hash(state.attempt), currency: "USD",
    customerEmail: state.buyerEmail, customerEmailNormalized: state.buyerEmail, customerEmailHash: emailHash,
    publicId: `TRG-2PB-${suffix.slice(0, 12).toUpperCase()}`, subtotalCents: 725, totalCents: 725
  }, [{
    authorSlugsJson: '["rv-sawyer"]', catalogRevision: product.revision, currency: "USD",
    creatorFeeBasisPoints: 2000, creatorFeePolicyEffectiveAt: new Date().toISOString(),
    creatorFeePolicyReason: "standard", creatorCommissionCategory: "standard",
    creatorCommissionPolicyVersion: "legacy-marketplace-policy", creatorFirstPublishedAt: product.publishedAt,
    creatorFixedFeeCents: 0, creatorReserveDays: 14, creatorFeePolicyId: null,
    deliveryContentType: "application/pdf", deliveryFilename: "Task 2P-B Purchased.pdf", deliveryR2Key: state.deliveryKey,
    effectiveUnitPriceCents: 725, lastUpdatedSnapshot: product.updatedAt, lineTotalCents: 725, listPriceCents: 725,
    minimumPriceCents: null, nativeCreatorId: product.creatorId, nativeProductId: product.id, pricingModel: "fixed",
    primaryAuthorSlug: "rv-sawyer", productSlug: product.slug, productStatus: product.status,
    productTitleSnapshot: product.title, publicationState: "published", quantity: 1, selectedPriceCents: 725,
    suggestedPriceCents: null, versionSnapshot: "2P-B"
  }]);
  let order = await orders.attachNativeStripeCheckoutSession(database, created.order.id, {
    id: state.stripeSessionId, url: `https://checkout.stripe.test/${state.stripeSessionId}`
  });
  state.orderId = Number(order.id);
  state.publicId = order.public_id;
  const event = stripeEvent(state, order);
  const response = await sendSignedEvent(event);
  assert.equal(response.status, 200, await response.text());
  order = query(`SELECT * FROM orders WHERE id=${state.orderId}`).results[0];
  assert.equal(order.payment_status, "paid");
  assert.equal(order.native_entitlement_status, "ready");
  const issued = await access.ensureActiveOrderAccessCredential(database, order, ACCESS_SECRET, {
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()
  });
  state.credential = issued.token;
  state.credentialId = Number(issued.credential.id);
  state.claimUrl = `${ORIGIN}/store/order-access?credential=${encodeURIComponent(issued.token)}`;

  const fixtureDir = path.join(ROOT, ".wrangler", `task2pb-${suffix}`);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const coverPath = path.join(fixtureDir, "cover.webp");
  const pdfPath = path.join(fixtureDir, "delivery.pdf");
  fs.writeFileSync(coverPath, Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
  fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.7\nTask 2P-B staging guest claim\n%%EOF\n"));
  cli("r2", "object", "put", `${BUCKET}/${state.coverKey}`, "--remote", "--config", CONFIG, "--file", coverPath, "--content-type", "image/webp");
  cli("r2", "object", "put", `${BUCKET}/${state.deliveryKey}`, "--remote", "--config", CONFIG, "--file", pdfPath, "--content-type", "application/pdf");
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  assert.equal(storeState(), "CLOSED");
  console.log(JSON.stringify({ buyerEmail: state.buyerEmail, otherEmail: state.otherEmail, password: PASSWORD, claimUrl: state.claimUrl, publicId: state.publicId }, null, 2));
}

function verify() {
  const state = readState();
  const order = query(`SELECT user_id,payment_status,native_order_state,native_entitlement_status FROM orders WHERE id=${state.orderId}`).results[0];
  const credential = query(`SELECT consumed_at,consumed_by_user_id FROM order_access_credentials WHERE id=${state.credentialId}`).results[0];
  const entitlement = query(`SELECT purchaser_user_id,status FROM native_product_entitlements WHERE order_id=${state.orderId}`).results[0];
  assert.equal(order.user_id, state.buyerId);
  assert.equal(credential.consumed_by_user_id, state.buyerId);
  assert.ok(credential.consumed_at);
  assert.equal(entitlement.purchaser_user_id, state.buyerId);
  assert.equal(query(`SELECT COUNT(*) n FROM historical_order_claim_audit WHERE order_id=${state.orderId} AND outcome='succeeded'`).results[0].n, 1);
  assert.equal(storeState(), "CLOSED");
  console.log("Staging D1 confirms one consumed claim, one buyer-owned entitlement, and a CLOSED store.");
}

async function cleanup() {
  const state = readState();
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  query(`DELETE FROM native_download_attempts WHERE order_id=${state.orderId}`);
  query(`DELETE FROM historical_order_claim_audit WHERE order_id=${state.orderId}`);
  query(`DELETE FROM email_webhook_events WHERE email_outbox_id IN (SELECT id FROM email_outbox WHERE order_id=${state.orderId})`);
  query(`DELETE FROM email_outbox WHERE order_id=${state.orderId}`);
  query(`DELETE FROM order_access_credentials WHERE order_id=${state.orderId}`);
  query(`DELETE FROM native_product_entitlements WHERE order_id=${state.orderId}`);
  query(`DELETE FROM webhook_events WHERE internal_order_id=${state.orderId}`);
  query(`DELETE FROM order_items WHERE order_id=${state.orderId}`);
  query(`DELETE FROM orders WHERE id=${state.orderId}`);
  query(`DELETE FROM sessions WHERE user_id IN (${sql(state.buyerId)},${sql(state.otherId)})`);
  query(`DELETE FROM password_credentials WHERE user_id IN (${sql(state.buyerId)},${sql(state.otherId)})`);
  query(`DELETE FROM users WHERE id IN (${sql(state.buyerId)},${sql(state.otherId)})`);
  let product = await catalog.getProductById(database, state.id);
  if (product) {
    if (product.publicationState !== "draft") product = await catalog.updateProduct(database, product.id, { publicationState: "draft" }, { expectedRevision: product.revision });
    assert.equal(await catalog.deleteDraftProduct(database, product.id), true);
  }
  for (const key of [state.coverKey, state.deliveryKey]) {
    cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG);
  }
  assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE id=${state.orderId}`).results[0].n, 0);
  assert.equal(query(`SELECT COUNT(*) n FROM users WHERE id IN (${sql(state.buyerId)},${sql(state.otherId)})`).results[0].n, 0);
  assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id=${sql(state.id)}`).results[0].n, 0);
  assert.equal(storeState(), "CLOSED");
  fs.rmSync(path.join(ROOT, ".wrangler", `task2pb-${state.suffix}`), { recursive: true, force: true });
  fs.rmSync(STATE_FILE, { force: true });
  console.log("Task 2P-B staging records, identities, sessions, and R2 objects removed; store remains CLOSED.");
}

function stripeEvent(state, order) {
  return { api_version: "2026-06-24.dahlia", created: Math.floor(Date.now() / 1000), id: state.eventId,
    livemode: false, object: "event", type: "checkout.session.completed", data: { object: {
      amount_total: 725, currency: "usd", id: state.stripeSessionId, livemode: false, object: "checkout.session",
      payment_intent: `pi_test_task2pb_${state.suffix}`, payment_status: "paid", ui_mode: "hosted_page", metadata: {
        trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id),
        trg_order_public_id: order.public_id, trg_order_source: "native_d1"
      }
    } } };
}
async function sendSignedEvent(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signature = Buffer.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))).toString("hex");
  return fetch(`${ORIGIN}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body });
}

const command = process.argv[2];
Promise.resolve(command === "setup" ? setup() : command === "verify" ? verify() : command === "cleanup" ? cleanup() : Promise.reject(new Error("Use setup, verify, or cleanup.")))
  .catch(error => { console.error(error); process.exitCode = 1; });
