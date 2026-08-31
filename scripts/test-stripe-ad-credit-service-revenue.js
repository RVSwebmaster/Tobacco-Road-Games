const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-08-31T16:00:00Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const db = d1(raw);
  seed(raw);
  const success = event("evt_ad_success", "stripe-buy", "cs_test_ad", "pi_test_ad");
  let result = await webhook.processStripeWebhookEvent(db, success, options());
  assert.equal(result.processingResult, "ad_credit_pack_fulfilled");
  assert.equal(count(raw, "marketplace_service_purchases"), 1);
  assert.equal(count(raw, "marketplace_service_revenue_ledger"), 1);
  assert.equal(credits(raw, "creator"), 5);
  const purchase = raw.prepare("SELECT * FROM marketplace_service_purchases").get();
  assert.equal(purchase.service_type, "ad_credit_package");
  assert.equal(purchase.quantity, 5);
  assert.equal(purchase.amount_cents, 500);
  assert.equal(purchase.payment_source, "stripe");
  assert.equal(purchase.settlement_method, "external_provider");
  assert.equal(purchase.provider_event_id, "evt_ad_success");
  assert.equal(purchase.provider_payment_reference, "pi_test_ad");
  assert.equal(purchase.processor_fee_authoritative, 0);
  assert.ok(purchase.completed_at);
  assert.equal(count(raw, "creator_balance_transactions"), 0);
  assert.equal(count(raw, "orders"), 0);
  assert.equal(count(raw, "creator_earnings_ledger"), 0);
  result = await webhook.processStripeWebhookEvent(db, success, options());
  assert.equal(result.duplicate, true);
  await webhook.processStripeWebhookEvent(db, event("evt_ad_async", "stripe-buy", "cs_test_ad", "pi_test_ad", { type: "checkout.session.async_payment_succeeded" }), options());
  assert.equal(count(raw, "marketplace_service_purchases"), 1);
  assert.equal(count(raw, "marketplace_service_revenue_ledger"), 1);
  assert.equal(credits(raw, "creator"), 5);
  await webhook.processStripeWebhookEvent(db, event("evt_ad_failed", "failed-buy", "cs_test_failed", "pi_test_failed", { type: "checkout.session.async_payment_failed", paymentStatus: "unpaid" }), options());
  assert.equal(raw.prepare("SELECT status FROM creator_ad_credit_purchases WHERE id='failed-buy'").get().status, "failed");
  assert.equal(credits(raw, "other-creator"), 0);
  assert.equal(count(raw, "marketplace_service_revenue_ledger"), 1);
  await assert.rejects(() => webhook.processStripeWebhookEvent(db, event("evt_ad_forged", "forged-buy", "cs_test_forged", "pi_test_forged", { amountTotal: 100 }), options()), /reconciliation failed safely/);
  assert.equal(credits(raw, "other-creator"), 0);
  raw.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES('creator','manual_adjustment',500,'USD',?,'available','fixture','internal-funds',?)").run(ISO, ISO);
  const service = await load("functions/_lib/creator-service-purchases.mjs");
  await service.purchaseServiceWithCreatorBalance(db, { creatorId: "creator", userId: "user", sku: "ad_credit_package", idempotencyKey: "svc_00000000-0000-4000-8000-000000000099", nowMs: NOW + 1000 });
  const sources = raw.prepare("SELECT payment_source,processor_fee_authoritative FROM marketplace_service_purchases ORDER BY payment_source").all();
  assert.deepEqual(sources.map((row) => row.payment_source), ["creator_balance", "stripe"]);
  assert.equal(sources[0].processor_fee_authoritative, 1);
  assert.equal(raw.prepare("SELECT SUM(amount_cents) total FROM marketplace_service_revenue_ledger WHERE service_type='ad_credit_package' AND entry_type='service_revenue'").get().total, 1000);
  assert.equal(count(raw, "orders"), 0, "Service revenue is not product GMV.");
  assert.equal(count(raw, "creator_balance_transactions"), 1);
  const route = read("functions/_lib/creator-advertising-route.mjs");
  assert.match(route, /if \(!session\.valid\)/);
  assert.match(route, /creatorId: creator\.id/);
  assert.doesNotMatch(route, /amountCents:\s*body|quantity:\s*body/);
  console.log("Stripe Ad Credit unified service revenue tests passed.");
}

function seed(raw) {
  for (const [userId, creatorId] of [["user", "creator"], ["other-user", "other-creator"]]) {
    raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(userId, `${userId}@test.invalid`, ISO, ISO);
    raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,created_at,updated_at) VALUES(?,?,?,'approved',?,?)").run(creatorId, creatorId, creatorId, ISO, ISO);
    raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','primary_free',?,?)").run(creatorId, userId, ISO, ISO);
  }
  for (const [id, creatorId, sessionId] of [["stripe-buy", "creator", "cs_test_ad"], ["failed-buy", "other-creator", "cs_test_failed"], ["forged-buy", "other-creator", "cs_test_forged"]])
    raw.prepare("INSERT INTO creator_ad_credit_purchases(id,creator_id,status,stripe_checkout_session_id,created_at,initiated_by_user_id) VALUES(?,?,'pending',?,?,?)").run(id, creatorId, sessionId, ISO, creatorId === "creator" ? "user" : "other-user");
}
function event(id, purchaseId, sessionId, paymentIntent, extra = {}) { return { id, type: extra.type || "checkout.session.completed", api_version: "2026-06-24.dahlia", created: Math.floor(NOW / 1000), livemode: false, data: { object: { id: sessionId, object: "checkout.session", livemode: false, client_reference_id: purchaseId, payment_intent: paymentIntent, payment_status: extra.paymentStatus || "paid", amount_total: extra.amountTotal ?? 500, currency: "usd", metadata: { trg_service_type: "ad_credit_pack", trg_service_reference_id: purchaseId, trg_checkout_attempt_id: `ad-credit-${purchaseId}` } } } }; }
function options() { return { nowMs: NOW, pipelineStage: "staging" }; }
function count(raw, table) { return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; }
function credits(raw, creatorId) { return Number(raw.prepare("SELECT COALESCE(SUM(quantity),0) n FROM creator_ad_credit_ledger WHERE creator_id=?").get(creatorId).n); }
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?${Math.random()}`); }
function d1(raw) { return { prepare(sql) { let values=[]; return { bind(...next){values=next;return this;}, first:async()=>raw.prepare(sql).get(...values)||null, all:async()=>({results:raw.prepare(sql).all(...values)}), run:async()=>raw.prepare(sql).run(...values) }; }, async batch(statements){raw.exec("BEGIN");try{for(const statement of statements)await statement.run();raw.exec("COMMIT");}catch(error){raw.exec("ROLLBACK");throw error;}} }; }
main().catch((error) => { console.error(error); process.exitCode = 1; });
