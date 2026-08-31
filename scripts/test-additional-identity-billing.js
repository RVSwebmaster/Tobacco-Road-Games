const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-08-31T12:00:00Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const db = d1(raw),
    billing = await load("functions/_lib/creator-identity-billing.mjs"),
    service = await load("functions/_lib/creator-service-purchases.mjs"),
    webhook = await load("functions/_lib/stripe-webhook.mjs");
  seed(raw);

  let state = await billing.getIdentityBillingState(db, "primary", NOW);
  assert.equal(state.included, true);
  assert.equal(state.active, true);
  state = await billing.getIdentityBillingState(db, "additional", NOW);
  assert.equal(state.status, "billing_required");
  assert.equal(state.active, false);

  const monthly = await service.purchaseServiceWithCreatorBalance(db, {
    creatorId: "additional",
    userId: "owner",
    sku: "additional_identity_monthly",
    idempotencyKey: "svc_00000000-0000-4000-8000-000000000101",
    nowMs: NOW,
  });
  assert.equal(monthly.amountCents, 1000);
  assert.equal(monthly.coverageStartsAt, "2026-08-31T12:00:00.000Z");
  assert.equal(monthly.coverageEndsAt, "2026-09-30T12:00:00.000Z");
  assert.equal(monthly.paymentSource, "creator_balance");
  state = await billing.getIdentityBillingState(db, "additional", NOW + 1);
  assert.equal(state.active, true);
  assert.equal(state.billingPlan, "monthly");

  const annual = await service.purchaseServiceWithCreatorBalance(db, {
    creatorId: "additional",
    userId: "owner",
    sku: "additional_identity_annual",
    idempotencyKey: "svc_00000000-0000-4000-8000-000000000102",
    nowMs: NOW + 86400000,
  });
  assert.equal(annual.amountCents, 10000);
  assert.equal(annual.coverageStartsAt, "2026-09-30T12:00:00.000Z");
  assert.equal(annual.coverageEndsAt, "2027-09-30T12:00:00.000Z");
  state = await billing.getIdentityBillingState(
    db,
    "additional",
    Date.parse("2027-10-01T12:00:00Z"),
  );
  assert.equal(state.active, false, "Expired paid coverage must block entitlement.");
  assert.equal(
    (await billing.getIdentityBillingState(db, "primary", Date.parse("2027-10-01T12:00:00Z"))).active,
    true,
    "Additional identity expiry must not affect the included primary identity.",
  );
  const policy = await load("functions/_lib/marketplace-policy.mjs");
  assert.equal(
    (await policy.getCreatorTier(db, "additional", Date.parse("2027-10-01T12:00:00Z"))).preferred,
    true,
  );
  assert.equal(count(raw, "creator_balance_transactions"), 2);
  assert.equal(sumRevenue(raw, "additional_creator_identity_fee"), 11000);
  await assert.rejects(
    () => service.purchaseServiceWithCreatorBalance(db, {
      creatorId: "additional",
      userId: "owner",
      sku: "additional_identity_monthly",
      idempotencyKey: "svc_00000000-0000-4000-8000-000000000103",
      nowMs: NOW + 2 * 86400000,
    }),
    /does not cover/,
  );
  await assert.rejects(
    () => service.purchaseServiceWithCreatorBalance(db, {
      creatorId: "additional",
      userId: "unrelated",
      sku: "additional_identity_monthly",
      idempotencyKey: "svc_00000000-0000-4000-8000-000000000104",
      nowMs: NOW,
    }),
    /Only the owner/,
  );

  insertAttempt(raw, "stripe-monthly", "stripe-additional", "monthly", 1000, "cs_test_monthly");
  let stripe = await billing.settleStripeIdentityCoverage(db, {
    billingAttemptId: "stripe-monthly",
    stripeCheckoutSessionId: "cs_test_monthly",
    stripePaymentIntentId: "pi_test_monthly",
    providerEventId: "evt_test_monthly",
    amountCents: 1000,
    currency: "usd",
    paymentStatus: "paid",
    nowMs: NOW,
  });
  assert.equal(stripe.coverageEndsAt, "2026-09-30T12:00:00.000Z");
  stripe = await billing.settleStripeIdentityCoverage(db, {
    billingAttemptId: "stripe-monthly",
    stripeCheckoutSessionId: "cs_test_monthly",
    stripePaymentIntentId: "pi_test_monthly",
    providerEventId: "evt_test_monthly_replay",
    amountCents: 1000,
    currency: "USD",
    paymentStatus: "paid",
    nowMs: NOW,
  });
  assert.equal(stripe.idempotent, true);
  insertAttempt(raw, "stripe-annual", "stripe-additional", "annual_prepaid", 10000, "cs_test_annual");
  stripe = await billing.settleStripeIdentityCoverage(db, {
    billingAttemptId: "stripe-annual",
    stripeCheckoutSessionId: "cs_test_annual",
    stripePaymentIntentId: "pi_test_annual",
    providerEventId: "evt_test_annual",
    amountCents: 10000,
    currency: "USD",
    paymentStatus: "paid",
    nowMs: NOW + 86400000,
  });
  assert.equal(stripe.coverageStartsAt, "2026-09-30T12:00:00.000Z");
  assert.equal(stripe.coverageEndsAt, "2027-09-30T12:00:00.000Z");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_service_purchases WHERE creator_id='stripe-additional'").get().n, 2);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_identity_coverage_periods WHERE creator_id='stripe-additional'").get().n, 2);
  insertAttempt(raw, "webhook-monthly", "webhook-additional", "monthly", 1000, "cs_test_webhook");
  const webhookEvent = identityEvent("evt_identity_webhook", "webhook-monthly", "cs_test_webhook", "pi_test_webhook", 1000);
  let webhookResult = await webhook.processStripeWebhookEvent(db, webhookEvent, { nowMs: NOW, pipelineStage: "staging" });
  assert.equal(webhookResult.processingResult, "identity_coverage_settled");
  webhookResult = await webhook.processStripeWebhookEvent(db, webhookEvent, { nowMs: NOW, pipelineStage: "staging" });
  assert.equal(webhookResult.duplicate, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_identity_coverage_periods WHERE creator_id='webhook-additional'").get().n, 1);
  insertAttempt(raw, "webhook-failed", "webhook-additional", "annual_prepaid", 10000, "cs_test_webhook_failed");
  await webhook.processStripeWebhookEvent(db, identityEvent("evt_identity_failed", "webhook-failed", "cs_test_webhook_failed", "pi_test_webhook_failed", 10000, "checkout.session.async_payment_failed", "unpaid"), { nowMs: NOW, pipelineStage: "staging" });
  assert.equal(raw.prepare("SELECT status FROM creator_identity_billing_attempts WHERE id='webhook-failed'").get().status, "failed");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_identity_coverage_periods WHERE creator_id='webhook-additional'").get().n, 1);
  await assert.rejects(
    () => billing.settleStripeIdentityCoverage(db, {
      billingAttemptId: "forged",
      stripeCheckoutSessionId: "cs_test_forged",
      stripePaymentIntentId: "pi_test_forged",
      providerEventId: "evt_test_forged",
      amountCents: 100,
      currency: "USD",
      paymentStatus: "paid",
      nowMs: NOW,
    }),
    /invalid/,
  );
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE creator_id='additional'").get().n, 1);
  assert.equal(raw.prepare("SELECT amount_cents FROM creator_earnings_ledger WHERE idempotency_key='history'").get().amount_cents, 11000);
  assert.equal(count(raw, "orders"), 0, "Identity fees are not product GMV.");
  assert.equal(sumRevenue(raw, "preferred_creator_fee"), 0);
  assert.equal(sumRevenue(raw, "ad_credit_package"), 0);
  const registrationSource = read("functions/_lib/creator-registration.mjs");
  const accountHtml = read("account.html"), accountJs = read("assets/js/account.js"), operatorSource = read("functions/owner/api/creator-balance.js"), routes = JSON.parse(read("_routes.json"));
  assert.match(registrationSource, /identityBilling\.active/);
  assert.match(registrationSource, /identity_type !== "additional"/);
  assert.doesNotMatch(registrationSource, /amountCents:\s*body|coverageEndsAt:\s*body/);
  assert.match(accountHtml, /\$10 monthly or \$100 annual prepaid coverage/);
  assert.match(accountJs, /purchase_identity_coverage_with_creator_balance/);
  assert.match(accountJs, /\["monthly", "\$10 monthly", 1000\]/);
  assert.match(accountJs, /Pay \$\{label\} with Stripe/);
  assert.match(operatorSource, /identityEntitlements/);
  assert.match(operatorSource, /additionalIdentityAnnualCents/);
  assert.ok(routes.include.includes("/api/creator-registration"));
  console.log("Additional Creator identity billing tests passed.");
}

function seed(raw) {
  for (const id of ["owner", "unrelated"]) raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(id, `${id}@test.invalid`, ISO, ISO);
  for (const [id, owner, type] of [["primary", "owner", "primary"], ["additional", "owner", "additional"], ["stripe-additional", "owner", "additional"], ["webhook-additional", "owner", "additional"]]) {
    raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at) VALUES(?,?,?,'approved','active',?,?)").run(id, id, id, ISO, ISO);
    raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,?,'active',?,?,?,?)").run(id, owner, type, type === "primary" ? "not_required" : "pending", type === "primary" ? "primary_free" : "additional_paid", ISO, ISO);
  }
  raw.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES('additional','manual_adjustment',11000,'USD',?,'available','fixture','history',?)").run(ISO, ISO);
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,created_at,updated_at) VALUES('history-listing','additional','history','History','active','published',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES('preferred-additional','additional','annual_prepaid',20000,?,'2028-12-31T12:00:00.000Z','renews','active',?,?)").run(ISO, ISO, ISO);
  insertAttempt(raw, "forged", "stripe-additional", "monthly", 1000, "cs_test_forged");
}
function insertAttempt(raw, id, creatorId, plan, amount, session) { raw.prepare("INSERT INTO creator_identity_billing_attempts(id,creator_id,user_id,billing_plan,amount_cents,status,stripe_checkout_session_id,created_at) VALUES(?,?, 'owner',?,?,'pending',?,?)").run(id, creatorId, plan, amount, session, ISO); }
function identityEvent(id, attemptId, sessionId, paymentIntent, amount, type="checkout.session.completed", paymentStatus="paid") { return { id, type, api_version:"2026-06-24.dahlia", created:Math.floor(NOW/1000), livemode:false, data:{object:{id:sessionId,object:"checkout.session",livemode:false,client_reference_id:attemptId,payment_intent:paymentIntent,payment_status:paymentStatus,amount_total:amount,currency:"usd",metadata:{trg_service_type:"additional_creator_identity_fee",trg_service_reference_id:attemptId,trg_checkout_attempt_id:`identity-fee-${attemptId}`}}}}; }
function sumRevenue(raw, type) { return Number(raw.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM marketplace_service_revenue_ledger WHERE service_type=?").get(type).n); }
function count(raw, table) { return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; }
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?${Math.random()}`); }
function d1(raw) { return { prepare(sql){let values=[];return{bind(...next){values=next;return this;},first:async()=>raw.prepare(sql).get(...values)||null,all:async()=>({results:raw.prepare(sql).all(...values)}),run:async()=>raw.prepare(sql).run(...values)};},async batch(statements){raw.exec("BEGIN");try{for(const statement of statements)await statement.run();raw.exec("COMMIT");}catch(error){raw.exec("ROLLBACK");throw error;}}}; }
main().catch((error) => { console.error(error); process.exitCode = 1; });
