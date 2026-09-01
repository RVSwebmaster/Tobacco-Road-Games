import { validateStripeKey } from "./stripe-checkout.mjs";

export const SERVICE_REFUND_REASONS = Object.freeze([
  "duplicate_charge",
  "incorrect_amount",
  "service_not_delivered",
  "trg_system_failure",
  "other_trg_caused_error",
]);

export async function correctCreatorServicePurchase(
  db,
  {
    servicePurchaseId,
    operatorId,
    reasonCategory,
    reasonDetail,
    refundAmountCents,
    entitlementAction = "none",
    entitlementAdjustment = {},
    idempotencyKey,
    env = {},
    fetchImpl = globalThis.fetch,
    nowMs = Date.now(),
  } = {},
) {
  if (!SERVICE_REFUND_REASONS.includes(reasonCategory))
    throw new Error("An objective TRG-caused service correction reason is required.");
  if (!String(reasonDetail || "").trim())
    throw new Error("Document the Tobacco Road Games billing or service error.");
  if (!/^svc_refund_[0-9a-f-]{36}$/i.test(String(idempotencyKey || "")))
    throw new Error("A valid service correction idempotency key is required.");
  const amount = Number(refundAmountCents);
  if (!Number.isInteger(amount) || amount < 0)
    throw new Error("Service correction amount is invalid.");
  const existing = await db
    .prepare("SELECT * FROM creator_service_refund_corrections WHERE idempotency_key=?")
    .bind(String(idempotencyKey))
    .first();
  if (existing) return correctionResult(existing, true);
  const purchase = await db
    .prepare("SELECT * FROM marketplace_service_purchases WHERE id=?")
    .bind(String(servicePurchaseId || ""))
    .first();
  if (!purchase || !["settled", "reversed"].includes(purchase.status))
    throw new Error("Settled Creator service purchase was not found.");
  if (amount > Number(purchase.amount_cents))
    throw new Error("Service correction cannot exceed the original charge.");
  validateEntitlementAction(purchase, entitlementAction, entitlementAdjustment);
  const priorRefunded = await totalReserved(db, purchase.id),
    projectedRefunded = priorRefunded + amount;
  if (
    ["reverse_coverage", "reverse_ad_credits"].includes(entitlementAction) &&
    projectedRefunded !== Number(purchase.amount_cents)
  )
    throw new Error("Entitlement reversal requires correction of the full original charge.");
  const id = crypto.randomUUID(),
    now = new Date(nowMs).toISOString(),
    detail = String(reasonDetail).trim().slice(0, 1000),
    adjustmentJson = JSON.stringify(entitlementAdjustment || {});
  if (purchase.payment_source === "creator_balance") {
    const creditId = amount ? crypto.randomUUID() : null,
      statements = [];
    if (amount)
      statements.push(
        db.prepare("INSERT INTO creator_balance_transactions(id,creator_id,user_id,transaction_type,amount_cents,currency,idempotency_key,description,created_at) VALUES(?,?,?,'operator_correction',?,? ,?,'TRG-caused Creator service correction',?)")
          .bind(creditId, purchase.creator_id, purchase.user_id, amount, purchase.currency, `service-refund:${idempotencyKey}`, now),
      );
    statements.push(
      correctionInsert(db, { id, purchase, operatorId, reasonCategory, detail, amount, entitlementAction, adjustmentJson, idempotencyKey, status: "completed", creditId, now }),
    );
    if (amount) statements.push(revenueReversal(db, purchase, amount, idempotencyKey, now));
    statements.push(...entitlementStatements(db, purchase, entitlementAction, entitlementAdjustment, idempotencyKey, now));
    if (amount && projectedRefunded === Number(purchase.amount_cents))
      statements.push(db.prepare("UPDATE marketplace_service_purchases SET status='reversed',reversed_at=? WHERE id=?").bind(now, purchase.id));
    statements.push(auditStatement(db, id, operatorId, "service_correction_completed", amount, purchase, entitlementAction, now));
    await db.batch(statements);
    return { correctionId: id, status: "completed", paymentSource: "creator_balance", refundAmountCents: amount, stripeRefund: false, idempotent: false };
  }
  if (String(env.PAYMENT_PIPELINE_STAGE || "staging").toLowerCase() === "production")
    throw new Error("Live production Creator service refunds are not activated.");
  if (amount && !String(purchase.provider_payment_reference || "").startsWith("pi_"))
    throw new Error("The authoritative original Stripe payment reference is unavailable.");
  await correctionInsert(db, { id, purchase, operatorId, reasonCategory, detail, amount, entitlementAction, adjustmentJson, idempotencyKey, status: amount ? "processing" : "completed", creditId: null, now }).run();
  if (!amount) {
    await db.batch([...entitlementStatements(db, purchase, entitlementAction, entitlementAdjustment, idempotencyKey, now), auditStatement(db, id, operatorId, "service_correction_completed", 0, purchase, entitlementAction, now)]);
    return { correctionId: id, status: "completed", paymentSource: "stripe", refundAmountCents: 0, stripeRefund: false, idempotent: false };
  }
  try {
    const refund = await createStripeServiceRefund({ purchase, amount, correctionId: id, idempotencyKey, env, fetchImpl });
    const completed = refund.status === "succeeded", status = completed ? "completed" : "provider_pending", statements = [
      db.prepare("UPDATE creator_service_refund_corrections SET status=?,stripe_refund_id=?,provider_status=?,completed_at=? WHERE id=? AND status='processing'").bind(status, refund.id, refund.status, completed ? now : null, id),
      auditStatement(db, id, operatorId, completed ? "stripe_service_refund_completed" : "stripe_service_refund_pending", amount, purchase, entitlementAction, now),
    ];
    if (completed) statements.push(revenueReversal(db, purchase, amount, idempotencyKey, now), ...entitlementStatements(db, purchase, entitlementAction, entitlementAdjustment, idempotencyKey, now));
    if (completed && (await totalReserved(db, purchase.id)) === Number(purchase.amount_cents)) statements.push(db.prepare("UPDATE marketplace_service_purchases SET status='reversed',reversed_at=? WHERE id=?").bind(now, purchase.id));
    await db.batch(statements);
    return { correctionId: id, status, paymentSource: "stripe", refundAmountCents: amount, stripeRefund: true, stripeRefundId: refund.id, idempotent: false };
  } catch (error) {
    const uncertain = error?.uncertain === true;
    await db.batch([
      db.prepare("UPDATE creator_service_refund_corrections SET status=?,provider_failure_code=?,failed_at=? WHERE id=? AND status='processing'").bind(uncertain ? "provider_pending" : "failed", String(error.code || "stripe_refund_failed").slice(0, 100), uncertain ? null : now, id),
      auditStatement(db, id, operatorId, uncertain ? "stripe_service_refund_indeterminate" : "stripe_service_refund_failed", amount, purchase, entitlementAction, now),
    ]);
    throw error;
  }
}

async function createStripeServiceRefund({ purchase, amount, correctionId, idempotencyKey, env, fetchImpl }) {
  const { secretKey } = validateStripeKey(env.STRIPE_SECRET_KEY, env.PAYMENT_PIPELINE_STAGE), params = new URLSearchParams();
  params.set("payment_intent", purchase.provider_payment_reference); params.set("amount", String(amount)); params.set("metadata[trg_service_purchase_id]", purchase.id); params.set("metadata[trg_service_correction_id]", correctionId);
  let response;
  try { response = await fetchImpl("https://api.stripe.com/v1/refunds", { method: "POST", headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `trg-${idempotencyKey}` }, body: params.toString() }); }
  catch (cause) { const error = new Error("Stripe refund result is uncertain.", { cause }); error.uncertain = true; error.code = "stripe_refund_indeterminate"; throw error; }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !String(payload.id || "").startsWith("re_") || !["pending", "succeeded"].includes(payload.status) || Number(payload.amount) !== amount || String(payload.currency).toUpperCase() !== String(purchase.currency).toUpperCase()) { const error = new Error("Stripe definitively rejected the service refund."); error.code = payload?.error?.code || "stripe_refund_rejected"; throw error; }
  return payload;
}

function correctionInsert(db, x) { return db.prepare("INSERT INTO creator_service_refund_corrections(id,service_purchase_id,creator_id,operator_id,reason_category,reason_detail,refund_amount_cents,payment_source,entitlement_action,entitlement_adjustment_json,status,idempotency_key,balance_transaction_id,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(x.id, x.purchase.id, x.purchase.creator_id, String(x.operatorId), x.reasonCategory, x.detail, x.amount, x.purchase.payment_source, x.entitlementAction, x.adjustmentJson, x.status, String(x.idempotencyKey), x.creditId, x.now, x.status === "completed" ? x.now : null); }
function revenueReversal(db, purchase, amount, key, now) { return db.prepare("INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,?,'service_reversal',?,?,?,?)").bind(purchase.id, purchase.service_type, -amount, purchase.currency, `service-refund-revenue:${key}`, now); }
function auditStatement(db, id, operatorId, action, amount, purchase, entitlementAction, now) { return db.prepare("INSERT INTO creator_service_refund_audit(correction_id,actor_type,actor_id,action,amount_cents,context_json,created_at) VALUES(?,'operator',?,?,?,?,?)").bind(id, String(operatorId), action, amount, JSON.stringify({ servicePurchaseId: purchase.id, serviceType: purchase.service_type, paymentSource: purchase.payment_source, entitlementAction }), now); }
async function totalReserved(db, purchaseId) { const row = await db.prepare("SELECT COALESCE(SUM(refund_amount_cents),0) total FROM creator_service_refund_corrections WHERE service_purchase_id=? AND status IN ('processing','provider_pending','completed')").bind(purchaseId).first(); return Number(row?.total || 0); }
function validateEntitlementAction(purchase, action, adjustment) { const allowed = ["none","reverse_coverage","reverse_ad_credits","restore_ad_credits","extend_ad_slot"]; if (!allowed.includes(action)) throw new Error("Service entitlement correction action is invalid."); if (action === "reverse_coverage" && !["preferred_creator_fee","additional_creator_identity_fee"].includes(purchase.service_type)) throw new Error("Coverage reversal does not match this service."); if (["reverse_ad_credits","restore_ad_credits","extend_ad_slot"].includes(action) && purchase.service_type !== "ad_credit_package") throw new Error("Ad Credit correction does not match this service."); if (["reverse_ad_credits","restore_ad_credits"].includes(action) && (!Number.isInteger(Number(adjustment.quantity)) || Number(adjustment.quantity) < 1 || Number(adjustment.quantity) > 5)) throw new Error("Ad Credit correction quantity is invalid."); if (action === "extend_ad_slot" && (!adjustment.slotId || !Number.isInteger(Number(adjustment.days)) || Number(adjustment.days) < 1 || Number(adjustment.days) > 30)) throw new Error("Ad slot correction is invalid."); }
function entitlementStatements(db, purchase, action, adjustment, key, now) {
  if (action === "none") return [];
  if (action === "reverse_coverage") {
    if (purchase.service_type === "additional_creator_identity_fee") return [db.prepare("UPDATE creator_identity_coverage_periods SET status='reversed' WHERE service_purchase_id=?").bind(purchase.id)];
    return [db.prepare("UPDATE preferred_billing_installments SET status='cancelled',updated_at=? WHERE service_purchase_id=?").bind(now, purchase.id), db.prepare("UPDATE preferred_billing_commitments SET billing_state='suspended',paid_through_at=(SELECT MAX(coverage_ends_at) FROM preferred_billing_installments WHERE commitment_id=preferred_billing_commitments.id AND status='paid'),updated_at=? WHERE id IN (SELECT commitment_id FROM preferred_service_charges WHERE service_purchase_id=?)").bind(now, purchase.id)];
  }
  if (action === "reverse_ad_credits") return [db.prepare("INSERT INTO creator_ad_credit_ledger(creator_id,entry_type,quantity,idempotency_key,context_json,created_at) VALUES(?,'operator_adjustment',-?,?,?,?)").bind(purchase.creator_id, Number(adjustment.quantity), `service-refund-credit:${key}`, JSON.stringify({ servicePurchaseId: purchase.id, reason: "TRG-caused correction" }), now)];
  if (action === "restore_ad_credits") return [db.prepare("INSERT INTO creator_ad_credit_ledger(creator_id,entry_type,quantity,idempotency_key,context_json,created_at) VALUES(?,'operator_adjustment',?,?,?,?)").bind(purchase.creator_id, Number(adjustment.quantity), `service-refund-credit:${key}`, JSON.stringify({ servicePurchaseId: purchase.id, reason: "TRG-caused slot-service correction" }), now)];
  return [db.prepare("UPDATE creator_ad_slots SET expires_at=datetime(expires_at,'+' || ? || ' days'),updated_at=? WHERE id=? AND creator_id=? AND slot_type='purchased'").bind(Number(adjustment.days), now, String(adjustment.slotId), purchase.creator_id)];
}
function correctionResult(row, idempotent) { return { correctionId: row.id, status: row.status, paymentSource: row.payment_source, refundAmountCents: Number(row.refund_amount_cents), stripeRefund: row.payment_source === "stripe" && Number(row.refund_amount_cents) > 0, stripeRefundId: row.stripe_refund_id || null, idempotent }; }
