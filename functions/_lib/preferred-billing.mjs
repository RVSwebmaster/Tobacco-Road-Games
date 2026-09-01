import { createStripeHostedCheckoutSession } from "./stripe-checkout.mjs";
import { validateStripeKey } from "./stripe-checkout.mjs";

export const PREFERRED_BILLING = Object.freeze({
  monthlyInstallmentCents: 2000,
  annualPrepaidCents: 20000,
  installmentCount: 12,
  defaultGraceDays: 7,
});

export function preferredGraceDays(env = {}) {
  const configured = String(env.PREFERRED_BILLING_GRACE_DAYS || "").trim();
  if (configured && configured !== String(PREFERRED_BILLING.defaultGraceDays))
    throw new Error(
      "Preferred billing grace is settled marketplace policy at 7 calendar days.",
    );
  return PREFERRED_BILLING.defaultGraceDays;
}

export async function getPreferredBillingState(db, creatorId, nowMs = Date.now()) {
  const commitment = await db.prepare(
    "SELECT b.*,t.status term_status,t.renewal_state term_renewal_state FROM preferred_billing_commitments b JOIN creator_preferred_terms t ON t.id=b.preferred_term_id WHERE b.creator_id=? ORDER BY b.commitment_starts_at DESC LIMIT 1",
  ).bind(creatorId).first();
  if (!commitment) return { active: false, planType: null, commitment: null, installments: [] };
  const installments = commitment.plan_type === "monthly_commitment"
    ? await rows(db.prepare("SELECT * FROM preferred_billing_installments WHERE commitment_id=? ORDER BY installment_number").bind(commitment.id))
    : [];
  const now = new Date(nowMs).toISOString(), paidThrough = commitment.paid_through_at;
  return {
    active: commitment.billing_state !== "suspended" && Boolean(paidThrough && paidThrough > now),
    planType: commitment.plan_type,
    commitment,
    installments,
    currentInstallment: installments.find((x) => ["scheduled", "failed", "past_due"].includes(x.status)) || null,
    paidCount: installments.filter((x) => x.status === "paid").length,
    outstandingCount: installments.filter((x) => x.status !== "paid" && x.status !== "cancelled").length,
  };
}

export async function preparePreferredBalanceSettlement(db, {
  creatorId, userId, cadence, servicePurchaseId, nowMs = Date.now(), graceDays = PREFERRED_BILLING.defaultGraceDays,
} = {}) {
  if (
    graceDays !== undefined &&
    Number(graceDays) !== PREFERRED_BILLING.defaultGraceDays
  )
    throw new Error(
      "Preferred billing grace is settled marketplace policy at 7 calendar days.",
    );
  graceDays = PREFERRED_BILLING.defaultGraceDays;
  await assertOwner(db, creatorId, userId);
  const now = new Date(nowMs).toISOString();
  if (cadence === "annual_prepaid") {
    const current = await latestCommitment(db, creatorId),
      start = new Date(Math.max(nowMs, Date.parse(current?.commitment_ends_at || "") || 0)),
      end = addMonthsClamped(start, 12), termId = crypto.randomUUID(), commitmentId = crypto.randomUUID();
    return {
      statements: [
        db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?, 'annual_prepaid',20000,?,?,'cancelled','active',?,?)").bind(termId, creatorId, start.toISOString(), end.toISOString(), now, now),
        db.prepare("INSERT INTO preferred_billing_commitments(id,preferred_term_id,creator_id,owner_user_id,plan_type,commitment_starts_at,commitment_ends_at,paid_through_at,normal_payment_source,billing_state,renewal_state,grace_days,created_at,updated_at) VALUES(?,?,?,?,'annual_prepaid',?,?,?,'creator_balance','current','renewal_decision_required',?,?,?)").bind(commitmentId, termId, creatorId, userId, start.toISOString(), end.toISOString(), end.toISOString(), graceDays, now, now),
        db.prepare("INSERT INTO preferred_service_charges(service_purchase_id,preferred_term_id,payment_cadence,coverage_starts_at,coverage_ends_at,commitment_id) VALUES(?,?,'annual_prepaid',?,?,?)").bind(servicePurchaseId, termId, start.toISOString(), end.toISOString(), commitmentId),
      ],
      result: { preferredTermId: termId, commitmentId, paymentCadence: cadence, termEndsAt: end.toISOString(), coverageEndsAt: end.toISOString() },
    };
  }
  let commitment = await db.prepare("SELECT * FROM preferred_billing_commitments WHERE creator_id=? AND plan_type='monthly_commitment' AND billing_state IN ('pending','current','remediation') AND commitment_ends_at>? ORDER BY commitment_starts_at DESC LIMIT 1").bind(creatorId, now).first(),
    statements = [];
  if (!commitment) {
    const termId = crypto.randomUUID(), commitmentId = crypto.randomUUID(), start = new Date(nowMs), end = addMonthsClamped(start, 12);
    commitment = { id: commitmentId, preferred_term_id: termId, commitment_starts_at: start.toISOString(), commitment_ends_at: end.toISOString() };
    statements.push(
      db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?,'monthly_commitment',2000,?,?,'renews','active',?,?)").bind(termId, creatorId, start.toISOString(), end.toISOString(), now, now),
      db.prepare("INSERT INTO preferred_billing_commitments(id,preferred_term_id,creator_id,owner_user_id,plan_type,commitment_starts_at,commitment_ends_at,normal_payment_source,billing_state,renewal_state,grace_days,created_at,updated_at) VALUES(?,?,?,?,'monthly_commitment',?,?,'stripe','pending','renewal_decision_required',?,?,?)").bind(commitmentId, termId, creatorId, userId, start.toISOString(), end.toISOString(), graceDays, now, now),
      ...installmentStatements(db, commitmentId, start, graceDays, now),
    );
  }
  let installment = await db.prepare("SELECT * FROM preferred_billing_installments WHERE commitment_id=? AND status IN ('scheduled','failed','past_due') ORDER BY installment_number LIMIT 1").bind(commitment.id).first();
  if (!installment) {
    // A newly prepared commitment is not visible until the batch executes.
    const start = new Date(commitment.commitment_starts_at);
    installment = installmentRecord(commitment.id, 1, start, graceDays, now);
  }
  statements.push(
    db.prepare("UPDATE preferred_billing_installments SET status='paid',payment_source='creator_balance',service_purchase_id=?,paid_at=?,failure_code=NULL,next_retry_at=NULL,updated_at=? WHERE id=? AND status IN ('scheduled','failed','past_due')").bind(servicePurchaseId, now, now, installment.id),
    db.prepare("UPDATE preferred_billing_commitments SET paid_through_at=?,billing_state='current',updated_at=? WHERE id=?").bind(installment.coverage_ends_at, now, commitment.id),
    db.prepare("INSERT INTO preferred_service_charges(service_purchase_id,preferred_term_id,payment_cadence,coverage_starts_at,coverage_ends_at,commitment_id,installment_id) VALUES(?,?,'monthly_commitment',?,?,?,?)").bind(servicePurchaseId, commitment.preferred_term_id, installment.coverage_starts_at, installment.coverage_ends_at, commitment.id, installment.id),
  );
  return { statements, result: { preferredTermId: commitment.preferred_term_id, commitmentId: commitment.id, installmentId: installment.id, installmentNumber: installment.installment_number, paymentCadence: cadence, termEndsAt: commitment.commitment_ends_at, coverageEndsAt: installment.coverage_ends_at } };
}

export async function startAnnualPreferredCheckout(db, { creatorId, userId, email, env = {}, fetchImpl, nowMs = Date.now() } = {}) {
  await assertOwner(db, creatorId, userId);
  const id = crypto.randomUUID(), now = new Date(nowMs).toISOString();
  await db.prepare("INSERT INTO preferred_external_billing_attempts(id,creator_id,owner_user_id,plan_type,amount_cents,status,created_at) VALUES(?,?,?,'annual_prepaid',20000,'pending',?)").bind(id, creatorId, userId, now).run();
  const session = await createStripeHostedCheckoutSession({
    successUrl: `${env.SITE_ORIGIN || env.PUBLIC_SITE_ORIGIN || "https://tobaccoroadgames.com"}/creator/?preferred=success`,
    cancelUrl: `${env.SITE_ORIGIN || env.PUBLIC_SITE_ORIGIN || "https://tobaccoroadgames.com"}/creator/?preferred=canceled`,
    clientReferenceId: id, customerEmail: email, checkoutAttemptId: `preferred-annual-${id}`, serviceType: "preferred_creator_annual",
    lineItems: [{ currency: "USD", unitAmount: 20000, name: "Tobacco Road Games — Preferred Creator (annual prepaid)" }],
  }, { secretKey: env.STRIPE_SECRET_KEY, pipelineStage: env.PAYMENT_PIPELINE_STAGE, idempotencyKey: `trg-preferred-annual-${id}`, fetchImpl });
  await db.prepare("UPDATE preferred_external_billing_attempts SET stripe_checkout_session_id=?,checkout_url=? WHERE id=?").bind(session.id, session.url, id).run();
  return { attemptId: id, checkoutUrl: session.url };
}

export async function startMonthlyPreferredCommitment(db, { creatorId, userId, env = {}, fetchImpl, nowMs = Date.now() } = {}) {
  await assertOwner(db, creatorId, userId);
  const existing = await db.prepare("SELECT id FROM preferred_billing_commitments WHERE creator_id=? AND billing_state IN ('pending','current','remediation') AND commitment_ends_at>? LIMIT 1").bind(creatorId, new Date(nowMs).toISOString()).first();
  if (existing) throw new Error("This Creator already has a current Preferred commitment.");
  const profile = await db.prepare("SELECT payment_method_status FROM user_account_profiles WHERE user_id=?").bind(userId).first();
  if (profile?.payment_method_status !== "ready") throw new Error("A ready stored marketplace payment method is required.");
  const now = new Date(nowMs).toISOString(), start = new Date(nowMs), end = addMonthsClamped(start, 12), termId = crypto.randomUUID(), commitmentId = crypto.randomUUID(), graceDays = preferredGraceDays(env);
  await db.batch([
    db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?,'monthly_commitment',2000,?,?,'renews','active',?,?)").bind(termId, creatorId, start.toISOString(), end.toISOString(), now, now),
    db.prepare("INSERT INTO preferred_billing_commitments(id,preferred_term_id,creator_id,owner_user_id,plan_type,commitment_starts_at,commitment_ends_at,normal_payment_source,billing_state,renewal_state,grace_days,created_at,updated_at) VALUES(?,?,?,?,'monthly_commitment',?,?,'stripe','pending','renewal_decision_required',?,?,?)").bind(commitmentId, termId, creatorId, userId, start.toISOString(), end.toISOString(), graceDays, now, now),
    ...installmentStatements(db, commitmentId, start, graceDays, now),
  ]);
  const billing = await runPreferredBillingScheduler(db, { env, fetchImpl, nowMs, limit: 1 });
  return { commitmentId, termId, commitmentStartsAt: start.toISOString(), commitmentEndsAt: end.toISOString(), billing };
}

export async function settleAnnualPreferredStripe(db, input = {}) {
  const attempt = await db.prepare("SELECT * FROM preferred_external_billing_attempts WHERE id=?").bind(String(input.attemptId || "")).first();
  if (!attempt) throw new Error("Preferred annual billing attempt was not found.");
  if (attempt.service_purchase_id) {
    if (attempt.stripe_checkout_session_id !== input.stripeCheckoutSessionId)
      throw new Error("Authoritative Stripe Preferred payment data is invalid.");
    return { idempotent: true, servicePurchaseId: attempt.service_purchase_id };
  }
  validateStripeSettlement(attempt, input, 20000);
  const current = await latestCommitment(db, attempt.creator_id), start = new Date(Math.max(input.nowMs || Date.now(), Date.parse(current?.commitment_ends_at || "") || 0)), end = addMonthsClamped(start, 12), now = new Date(input.nowMs || Date.now()).toISOString(), termId = crypto.randomUUID(), commitmentId = crypto.randomUUID(), purchaseId = crypto.randomUUID(), key = `stripe-preferred-annual:${attempt.id}`;
  await db.batch([
    db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?,'annual_prepaid',20000,?,?,'cancelled','active',?,?)").bind(termId, attempt.creator_id, start.toISOString(), end.toISOString(), now, now),
    db.prepare("INSERT INTO preferred_billing_commitments(id,preferred_term_id,creator_id,owner_user_id,plan_type,commitment_starts_at,commitment_ends_at,paid_through_at,normal_payment_source,billing_state,renewal_state,grace_days,created_at,updated_at) VALUES(?,?,?,?,'annual_prepaid',?,?,?,'stripe','current','renewal_decision_required',?, ?,?)").bind(commitmentId, termId, attempt.creator_id, attempt.owner_user_id, start.toISOString(), end.toISOString(), end.toISOString(), PREFERRED_BILLING.defaultGraceDays, now, now),
    servicePurchase(db, purchaseId, attempt.creator_id, attempt.owner_user_id, "preferred_annual", 20000, "stripe", key, now, input),
    revenue(db, purchaseId, 20000, key, now),
    db.prepare("INSERT INTO preferred_service_charges(service_purchase_id,preferred_term_id,payment_cadence,coverage_starts_at,coverage_ends_at,commitment_id,external_attempt_id) VALUES(?,?,'annual_prepaid',?,?,?,?)").bind(purchaseId, termId, start.toISOString(), end.toISOString(), commitmentId, attempt.id),
    db.prepare("UPDATE preferred_external_billing_attempts SET status='paid',paid_at=?,service_purchase_id=? WHERE id=? AND status='pending'").bind(now, purchaseId, attempt.id),
  ]);
  return { idempotent: false, servicePurchaseId: purchaseId, coverageEndsAt: end.toISOString() };
}

export async function settlePreferredInstallmentStripe(db, { installmentId, paymentIntentId, providerEventId, nowMs = Date.now() } = {}) {
  const installment = await db.prepare("SELECT i.*,b.creator_id,b.owner_user_id,b.preferred_term_id FROM preferred_billing_installments i JOIN preferred_billing_commitments b ON b.id=i.commitment_id WHERE i.id=?").bind(installmentId).first();
  if (!installment) throw new Error("Preferred installment was not found.");
  if (installment.service_purchase_id) return { idempotent: true, servicePurchaseId: installment.service_purchase_id };
  if (!String(paymentIntentId).startsWith("pi_") || (providerEventId && !String(providerEventId).startsWith("evt_"))) throw new Error("Authoritative Stripe installment references are required.");
  const now = new Date(nowMs).toISOString(), purchaseId = crypto.randomUUID(), key = `stripe-preferred-installment:${installment.id}`;
  await db.batch([
    servicePurchase(db, purchaseId, installment.creator_id, installment.owner_user_id, "preferred_monthly", 2000, "stripe", key, now, { stripePaymentIntentId: paymentIntentId, providerEventId }),
    revenue(db, purchaseId, 2000, key, now),
    db.prepare("UPDATE preferred_billing_installments SET status='paid',payment_source='stripe',service_purchase_id=?,stripe_payment_intent_id=?,provider_event_id=?,paid_at=?,failure_code=NULL,next_retry_at=NULL,updated_at=? WHERE id=? AND status<>'paid'").bind(purchaseId, paymentIntentId, providerEventId, now, now, installment.id),
    db.prepare("UPDATE preferred_billing_commitments SET paid_through_at=?,billing_state='current',updated_at=? WHERE id=?").bind(installment.coverage_ends_at, now, installment.commitment_id),
    db.prepare("INSERT INTO preferred_service_charges(service_purchase_id,preferred_term_id,payment_cadence,coverage_starts_at,coverage_ends_at,commitment_id,installment_id) VALUES(?,?,'monthly_commitment',?,?,?,?)").bind(purchaseId, installment.preferred_term_id, installment.coverage_starts_at, installment.coverage_ends_at, installment.commitment_id, installment.id),
  ]);
  return { idempotent: false, servicePurchaseId: purchaseId };
}

export async function runPreferredBillingScheduler(db, { env = {}, fetchImpl, nowMs = Date.now(), limit = 50 } = {}) {
  const now = new Date(nowMs).toISOString(), candidates = await rows(db.prepare("SELECT i.*,b.creator_id,b.owner_user_id FROM preferred_billing_installments i JOIN preferred_billing_commitments b ON b.id=i.commitment_id WHERE b.billing_state IN ('pending','current','remediation') AND i.status IN ('scheduled','failed','past_due') AND i.due_at<=? AND (i.next_retry_at IS NULL OR i.next_retry_at<=?) ORDER BY i.due_at LIMIT ?").bind(now, now, limit));
  const results = [];
  for (const installment of candidates) {
    const recoverable = await db.prepare("SELECT stripe_payment_intent_id FROM preferred_billing_provider_attempts WHERE installment_id=? AND status='succeeded' AND stripe_payment_intent_id IS NOT NULL ORDER BY attempt_number DESC LIMIT 1").bind(installment.id).first();
    if (recoverable) {
      await settlePreferredInstallmentStripe(db, { installmentId: installment.id, paymentIntentId: recoverable.stripe_payment_intent_id, providerEventId: null, nowMs });
      results.push({ installmentId: installment.id, status: "paid", recovered: true });
      continue;
    }
    const profile = await db.prepare("SELECT stripe_customer_reference,default_payment_method_reference,payment_method_status FROM user_account_profiles WHERE user_id=?").bind(installment.owner_user_id).first();
    if (profile?.payment_method_status !== "ready") { await markInstallmentFailed(db, installment, "payment_method_not_ready", nowMs); results.push({ installmentId: installment.id, status: "failed" }); continue; }
    const attemptNumber = Number(installment.attempt_count) + 1;
    try {
      const intent = await chargeStoredMethod({ installment, profile, env, fetchImpl, attemptNumber });
      await db.prepare("INSERT INTO preferred_billing_provider_attempts(id,installment_id,attempt_number,stripe_payment_intent_id,status,created_at,updated_at) VALUES(?,?,?,?, 'succeeded',?,?)").bind(crypto.randomUUID(), installment.id, attemptNumber, intent.id, now, now).run();
      await settlePreferredInstallmentStripe(db, { installmentId: installment.id, paymentIntentId: intent.id, providerEventId: null, nowMs });
      results.push({ installmentId: installment.id, status: "paid" });
    } catch (error) {
      const code = String(error.code || error.message || "stripe_failed");
      await db.prepare("INSERT OR IGNORE INTO preferred_billing_provider_attempts(id,installment_id,attempt_number,status,failure_code,created_at,updated_at) VALUES(?,?,?,'failed',?,?,?)").bind(crypto.randomUUID(), installment.id, attemptNumber, code.slice(0, 100), now, now).run();
      await markInstallmentFailed(db, installment, code, nowMs);
      results.push({ installmentId: installment.id, status: "failed" });
    }
  }
  await processPreferredNotices(db, nowMs);
  return { processed: results.length, results };
}

export async function markPreferredDoNotRenew(db, { creatorId, userId, nowMs = Date.now() } = {}) {
  const now = new Date(nowMs).toISOString(), result = await db.prepare("UPDATE preferred_billing_commitments SET renewal_state='do_not_renew',updated_at=? WHERE creator_id=? AND owner_user_id=? AND billing_state IN ('pending','current','remediation')").bind(now, creatorId, userId).run();
  await db.prepare("UPDATE creator_preferred_terms SET renewal_state='cancelled',updated_at=? WHERE id IN (SELECT preferred_term_id FROM preferred_billing_commitments WHERE creator_id=? AND owner_user_id=?)").bind(now, creatorId, userId).run();
  return { doNotRenew: true, changed: Number(result?.meta?.changes ?? result?.changes ?? 0) };
}

async function markInstallmentFailed(db, installment, code, nowMs) {
  const now = new Date(nowMs).toISOString(), attempts = Number(installment.attempt_count) + 1, retry = new Date(nowMs + Math.min(attempts, 3) * 86400000).toISOString(), grace = installment.grace_ends_at;
  await db.batch([
    db.prepare("UPDATE preferred_billing_installments SET status=?,attempt_count=?,last_attempted_at=?,next_retry_at=?,failure_code=?,updated_at=? WHERE id=? AND status<>'paid'").bind(now >= grace ? "past_due" : "failed", attempts, now, retry, code.slice(0, 100), now, installment.id),
    db.prepare("UPDATE preferred_billing_commitments SET billing_state=?,updated_at=? WHERE id=?").bind(now >= grace ? "suspended" : "remediation", now, installment.commitment_id),
    noticeStatement(db, installment.creator_id, "preferred_payment_failed", `Preferred installment ${installment.installment_number} needs attention`, `Your $20 Preferred installment could not be paid. Update your payment method or use sufficient Creator Balance before ${grace}.`, `preferred:${installment.id}:failed:${attempts}`, now),
  ]);
}

async function processPreferredNotices(db, nowMs) {
  const now = new Date(nowMs).toISOString(), soon = new Date(nowMs + 7 * 86400000).toISOString(), due = await rows(db.prepare("SELECT i.*,b.creator_id FROM preferred_billing_installments i JOIN preferred_billing_commitments b ON b.id=i.commitment_id WHERE i.status='scheduled' AND i.due_at>? AND i.due_at<=?").bind(now, soon));
  for (const x of due) try { await noticeStatement(db, x.creator_id, "preferred_installment_upcoming", `Preferred installment ${x.installment_number} is upcoming`, `Your next $20 Preferred installment is due ${x.due_at}.`, `preferred:${x.id}:upcoming`, now).run(); } catch (e) { if (!/unique|constraint/i.test(String(e))) throw e; }
  const ending = await rows(db.prepare("SELECT * FROM preferred_billing_commitments WHERE billing_state IN ('current','remediation') AND renewal_state='renewal_decision_required' AND commitment_ends_at>? AND commitment_ends_at<=?").bind(now, new Date(nowMs + 30 * 86400000).toISOString()));
  for (const x of ending) try { await noticeStatement(db, x.creator_id, "preferred_commitment_ending", "Preferred commitment nearing its end", `Your Preferred commitment ends ${x.commitment_ends_at}. Choose a new plan to continue after the current commitment.`, `preferred:${x.id}:ending`, now).run(); } catch (e) { if (!/unique|constraint/i.test(String(e))) throw e; }
}

async function chargeStoredMethod({ installment, profile, env, fetchImpl = globalThis.fetch, attemptNumber }) {
  const { secretKey } = validateStripeKey(env.STRIPE_SECRET_KEY, env.PAYMENT_PIPELINE_STAGE), params = new URLSearchParams();
  params.set("amount", "2000"); params.set("currency", "usd"); params.set("customer", profile.stripe_customer_reference); params.set("payment_method", profile.default_payment_method_reference); params.set("confirm", "true"); params.set("off_session", "true"); params.set("metadata[trg_service_type]", "preferred_creator_installment"); params.set("metadata[trg_service_reference_id]", installment.id);
  const response = await fetchImpl("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `trg-preferred-${installment.id}-${attemptNumber}` }, body: params.toString() }), payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== "succeeded" || Number(payload.amount) !== 2000 || String(payload.currency).toLowerCase() !== "usd" || payload.livemode !== (String(env.PAYMENT_PIPELINE_STAGE).toLowerCase() === "production")) { const error = new Error("Stripe installment payment did not succeed."); error.code = payload?.error?.code || payload?.status || "stripe_failed"; throw error; }
  return payload;
}

function installmentStatements(db, commitmentId, start, graceDays, now) { return Array.from({ length: 12 }, (_, index) => { const record = installmentRecord(commitmentId, index + 1, start, graceDays, now); return db.prepare("INSERT INTO preferred_billing_installments(id,commitment_id,installment_number,amount_cents,due_at,coverage_starts_at,coverage_ends_at,status,grace_ends_at,created_at,updated_at) VALUES(?,?,?,2000,?,?,?,'scheduled',?,?,?)").bind(record.id, commitmentId, record.installment_number, record.due_at, record.coverage_starts_at, record.coverage_ends_at, record.grace_ends_at, now, now); }); }
function installmentRecord(commitmentId, number, start, graceDays, now) { const coverageStart = addMonthsClamped(start, number - 1), coverageEnd = addMonthsClamped(start, number), graceEnd = new Date(coverageStart.getTime() + graceDays * 86400000); return { id: `${commitmentId}:${number}`, commitment_id: commitmentId, installment_number: number, due_at: coverageStart.toISOString(), coverage_starts_at: coverageStart.toISOString(), coverage_ends_at: coverageEnd.toISOString(), grace_ends_at: graceEnd.toISOString(), created_at: now, updated_at: now }; }
function addMonthsClamped(date, months) { const x = new Date(date), day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + months); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x; }
async function latestCommitment(db, creatorId) { return db.prepare("SELECT * FROM preferred_billing_commitments WHERE creator_id=? ORDER BY commitment_ends_at DESC LIMIT 1").bind(creatorId).first(); }
async function assertOwner(db, creatorId, userId) { const row = await db.prepare("SELECT 1 ok FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=?").bind(creatorId, userId).first(); if (!row) throw new Error("Only the Creator owner may manage Preferred billing."); }
function validateStripeSettlement(attempt, input, amount) { if (attempt.status !== "pending" || attempt.stripe_checkout_session_id !== input.stripeCheckoutSessionId || Number(input.amountCents) !== amount || String(input.currency).toUpperCase() !== "USD" || input.paymentStatus !== "paid" || !String(input.stripePaymentIntentId).startsWith("pi_") || !String(input.providerEventId).startsWith("evt_")) throw new Error("Authoritative Stripe Preferred payment data is invalid."); }
function servicePurchase(db, id, creatorId, userId, sku, amount, source, key, now, input) { return db.prepare("INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,processor_fee_cents,status,stripe_checkout_session_id,idempotency_key,context_json,created_at,provider_event_id,provider_payment_reference,processor_fee_authoritative,completed_at) VALUES(?,?,?,'preferred_creator_fee',?,1,?,'USD',?,'external_provider',0,'settled',?,?, '{}',?,?,?,0,?)").bind(id, creatorId, userId, sku, amount, source, input.stripeCheckoutSessionId || null, key, now, input.providerEventId, input.stripePaymentIntentId, now); }
function revenue(db, purchaseId, amount, key, now) { return db.prepare("INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,'preferred_creator_fee','service_revenue',?,'USD',?,?)").bind(purchaseId, amount, `service-revenue:${key}`, now); }
function noticeStatement(db, creatorId, type, subject, message, key, now) { return db.prepare("INSERT INTO marketplace_notice_outbox(id,audience_type,creator_id,notice_type,subject,message,dedupe_key,available_at,created_at) VALUES(?,'creator',?,?,?,?,?,?,?)").bind(crypto.randomUUID(), creatorId, type, subject, message, key, now, now); }
async function rows(statement) { return (await statement.all()).results || []; }
