import { STRIPE_API_VERSION } from "./stripe-api.mjs";

export const STRIPE_ORDER_FEE_EVENTS = Object.freeze(["charge.updated"]);
const PROCESSING_FEE_TYPES = new Set(["stripe_fee", "payment_method_passthrough_fee"]);
const KNOWN_FEE_TYPES = new Set(["stripe_fee", "payment_method_passthrough_fee", "application_fee", "tax"]);

export async function createPendingOrderFeeStatement(database, order, createdAt) {
  if (order?.catalog_source !== "native_d1" || order?.payment_source !== "stripe") return null;
  const items = await database.prepare(`SELECT creator_commission_policy_version_snapshot FROM order_items WHERE order_id=? AND catalog_source='native_d1'`).bind(Number(order.id)).all();
  const rows = items.results || [];
  if (!rows.length || rows.some(row => row.creator_commission_policy_version_snapshot !== "owner-approved-commission-v1")) return null;
  return database.prepare(`
    INSERT OR IGNORE INTO stripe_order_fee_reconciliations(
      order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at
    ) VALUES(?,?,?,?,'pending',?)
  `).bind(Number(order.id), String(order.stripe_payment_intent_id || ""), Number(order.total_cents), String(order.currency).toUpperCase(), createdAt);
}

export async function processStripeOrderFeeEvent(database, event, { env = {}, fetchImpl = fetch, createdAt = new Date().toISOString(), balanceTransaction: suppliedBalanceTransaction } = {}) {
  if (!STRIPE_ORDER_FEE_EVENTS.includes(String(event?.type || ""))) return null;
  const charge = event?.data?.object || {};
  const chargeId = String(charge.id || "");
  const paymentIntentId = providerId(charge.payment_intent);
  if (charge.object !== "charge" || !/^ch_[A-Za-z0-9_]+$/.test(chargeId) || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
    throw new Error("Stripe charge fee event is incomplete.");
  }
  const order = await database.prepare("SELECT * FROM orders WHERE stripe_payment_intent_id=?").bind(paymentIntentId).first();
  if (!order) throw new Error("Stripe fee event has no matching Tobacco Road Games order.");
  if (order.catalog_source !== "native_d1" || !["paid", "refunded", "disputed"].includes(order.payment_status)) {
    return { action: "not_applicable", orderId: Number(order.id) };
  }
  const statement = await database.prepare("SELECT * FROM stripe_order_fee_reconciliations WHERE order_id=?").bind(Number(order.id)).first();
  if (!statement) return { action: "historical_policy_preserved", orderId: Number(order.id) };
  if (statement.status === "reconciled") {
    if (statement.charge_id !== chargeId || providerId(charge.balance_transaction) !== statement.balance_transaction_id) {
      throw new Error("A different Stripe charge or balance transaction conflicts with the reconciled order fee.");
    }
    return { action: "already_reconciled", orderId: Number(order.id), duplicate: true };
  }

  const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  let chargeDetails = charge;
  const relation = charge.balance_transaction;
  if (!relation && !suppliedBalanceTransaction && secretKey) {
    chargeDetails = await stripeGet(`/charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction`, secretKey, fetchImpl);
  }
  const balanceRef = suppliedBalanceTransaction || chargeDetails.balance_transaction;
  if (!balanceRef) {
    return { action: "fee_pending", orderId: Number(order.id), chargeId };
  }
  let balanceTransaction = typeof balanceRef === "object" ? balanceRef : null;
  if ((!balanceTransaction || !Array.isArray(balanceTransaction.fee_details)) && secretKey) {
    const balanceId = providerId(balanceRef);
    if (!/^txn_[A-Za-z0-9]+$/.test(balanceId)) throw new Error("Stripe balance transaction reference is invalid.");
    balanceTransaction = await stripeGet(`/balance_transactions/${encodeURIComponent(balanceId)}`, secretKey, fetchImpl);
  }
  if (!balanceTransaction || !Array.isArray(balanceTransaction.fee_details)) {
    return { action: "fee_pending", orderId: Number(order.id), chargeId };
  }
  return reconcileOrderProcessingFee(database, {
    order,
    chargeId,
    charge,
    balanceTransaction,
    providerEventId: String(event.id || ""),
    createdAt,
  });
}

export async function recoverNativeOrderProcessingFee(database, orderId, { secretKey, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const order = await database.prepare("SELECT * FROM orders WHERE id=?").bind(Number(orderId)).first();
  if (!order || order.catalog_source !== "native_d1" || !["paid", "refunded", "disputed"].includes(order.payment_status)) {
    return { action: "paid_native_order_required", orderId: Number(orderId) };
  }
  const state = await database.prepare("SELECT * FROM stripe_order_fee_reconciliations WHERE order_id=?").bind(Number(order.id)).first();
  if (!state) return { action: "historical_policy_preserved", orderId: Number(order.id) };
  if (state.status === "reconciled") return { action: "already_reconciled", orderId: Number(order.id), balanceTransactionId: state.balance_transaction_id };
  if (!secretKey) return { action: "fee_pending", orderId: Number(order.id), reason: "stripe_secret_unavailable" };
  const paymentIntent = await stripeGet(`/payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}?expand[]=latest_charge.balance_transaction`, secretKey, fetchImpl);
  let charge = paymentIntent.latest_charge;
  if (!charge) return { action: "fee_pending", orderId: Number(order.id), reason: "charge_unavailable" };
  if (typeof charge === "string") charge = await stripeGet(`/charges/${encodeURIComponent(charge)}?expand[]=balance_transaction`, secretKey, fetchImpl);
  let balance = charge.balance_transaction;
  if (typeof balance === "string") balance = await stripeGet(`/balance_transactions/${encodeURIComponent(balance)}`, secretKey, fetchImpl);
  if (!balance || !Array.isArray(balance.fee_details)) return { action: "fee_pending", orderId: Number(order.id), chargeId: String(charge.id || ""), reason: "balance_transaction_pending" };
  return reconcileOrderProcessingFee(database, { order, chargeId: String(charge.id || ""), charge,
    balanceTransaction: balance, providerEventId: `owner-recovery:${String(balance.id || "")}`,
    createdAt: new Date(nowMs).toISOString() });
}

export async function reconcileOrderProcessingFee(database, { order, chargeId, charge, balanceTransaction, providerEventId = "", createdAt = new Date().toISOString() } = {}) {
  const orderId = Number(order?.id);
  const paymentIntentId = String(order?.stripe_payment_intent_id || "");
  const chargePaymentIntent = providerId(charge?.payment_intent);
  const balanceId = String(balanceTransaction?.id || "");
  const balanceSource = providerId(balanceTransaction?.source);
  const currency = String(balanceTransaction?.currency || "").toUpperCase();
  const transactionAmount = Number(balanceTransaction?.amount);
  const totalFee = Number(balanceTransaction?.fee);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || order.catalog_source !== "native_d1" || !paymentIntentId
    || chargePaymentIntent !== paymentIntentId || balanceSource !== chargeId
    || !/^txn_[A-Za-z0-9]+$/.test(balanceId) || currency !== String(order.currency).toUpperCase()
    || !Number.isSafeInteger(transactionAmount) || transactionAmount !== Number(order.total_cents)
    || !Number.isSafeInteger(totalFee) || totalFee < 0) {
    throw new Error("Stripe fee evidence does not match the paid Tobacco Road Games order.");
  }
  const prior = await database.prepare("SELECT * FROM stripe_order_fee_reconciliations WHERE order_id=?").bind(orderId).first();
  if (!prior) return { action: "historical_policy_preserved", orderId };
  if (prior.status === "needs_review") {
    return { action: "fee_needs_review", orderId, balanceTransactionId: prior.balance_transaction_id || null,
      reason: "owner_review_required", duplicate: true };
  }
  if (prior.status === "reconciled") {
    if (prior.balance_transaction_id !== balanceId || prior.charge_id !== chargeId) throw new Error("Conflicting Stripe fee evidence exists for this order.");
    return { action: "already_reconciled", orderId, duplicate: true };
  }
  const details = balanceTransaction.fee_details;
  const malformedDetail = details.some(item => !item || !Number.isSafeInteger(item.amount) || item.amount < 0
    || !KNOWN_FEE_TYPES.has(String(item.type || ""))
    || String(item.currency || "").toUpperCase() !== currency);
  const detailTotal = details.reduce((sum, item) => sum + (Number.isSafeInteger(item?.amount) ? item.amount : 0), 0);
  if (malformedDetail || !Number.isSafeInteger(detailTotal) || detailTotal !== totalFee) {
    return markFeeReconciliationNeedsReview(database, {
      orderId, chargeId, balanceId, totalFee, currency, transactionAmount, details,
      providerEventId, createdAt,
      reason: malformedDetail ? "invalid_or_incomplete_fee_details" : "fee_detail_total_mismatch",
    });
  }
  const processingFee = details.filter(item => PROCESSING_FEE_TYPES.has(String(item.type || "")))
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const nonProcessingFee = totalFee - processingFee;
  if (processingFee > totalFee) throw new Error("Stripe processing fees exceed the balance transaction fee.");
  const itemsResult = await database.prepare(`
    SELECT id,line_total_cents,currency,creator_commission_category_snapshot,native_creator_id
    FROM order_items WHERE order_id=? AND catalog_source='native_d1' ORDER BY id
  `).bind(orderId).all();
  const items = (itemsResult.results || []).map(row => ({
    ...row,
    amountCents: Number(row.line_total_cents),
    orderItemId: Number(row.id),
    category: String(row.creator_commission_category_snapshot || ""),
  }));
  if (!items.length || items.some(item => !["standard", "founding25", "premier", "owner", "admin"].includes(item.category)
    || String(item.currency).toUpperCase() !== currency)) throw new Error("Sale-time commission category snapshots are incomplete.");
  const productTotal = items.reduce((sum, item) => sum + item.amountCents, 0);
  const nonProduct = transactionAmount - productTotal;
  if (nonProduct < 0) throw new Error("Stripe charged amount is less than the immutable product total.");
  if (order.included_tax_cents == null && nonProduct > 0) {
    const detailsJson = JSON.stringify({
      reason: "non_product_amount_tax_breakdown_missing",
      balanceTransactionId: balanceId,
      nonProductAmountCents: nonProduct,
      processingFeeCents: processingFee,
      totalFeeCents: totalFee,
    });
    await database.batch([
      database.prepare(`UPDATE stripe_order_fee_reconciliations SET charge_id=?,balance_transaction_id=?,
        total_fee_cents=?,processing_fee_cents=?,non_processing_fee_cents=?,non_product_amount_cents=?,
        status='needs_review',provider_event_id=?,details_json=?,reconciled_at=? WHERE order_id=? AND status='pending'`)
        .bind(chargeId, balanceId, totalFee, processingFee, nonProcessingFee, nonProduct,
          providerEventId || null, detailsJson, createdAt, orderId),
      database.prepare("UPDATE orders SET processor_fee_cents=?,net_proceeds_cents=? WHERE id=? AND payment_status IN ('paid','refunded','disputed')")
        .bind(totalFee, transactionAmount - totalFee, orderId),
    ]);
    return { action: "fee_needs_review", orderId, balanceTransactionId: balanceId,
      reason: "non_product_amount_tax_breakdown_missing", nonProductAmountCents: nonProduct };
  }
  const taxAmount = Number(order.included_tax_cents || 0);
  if (!Number.isSafeInteger(taxAmount) || taxAmount < 0 || taxAmount > nonProduct) {
    throw new Error("Recorded order tax does not reconcile to the non-product amount.");
  }
  const otherNonProduct = nonProduct - taxAmount;
  const feeParts = allocateMinorUnits(processingFee, [
    ...items.map(item => ({ id: `item:${String(item.orderItemId).padStart(20, "0")}`, weight: item.amountCents })),
    { id: "zz:tax", weight: taxAmount },
    { id: "zzz:other-non-product", weight: otherNonProduct },
  ]);
  const feeById = new Map(feeParts.map(part => [part.id, part.amountCents]));
  const allocations = items.map(item => {
    const fee = feeById.get(`item:${String(item.orderItemId).padStart(20, "0")}`) || 0;
    const creatorFee = ["standard", "founding25", "premier"].includes(item.category) ? fee : 0;
    return { ...item, processingFeeCents: fee, creatorAbsorbedFeeCents: creatorFee, trgAbsorbedFeeCents: fee - creatorFee };
  });
  const taxFee = feeById.get("zz:tax") || 0;
  const otherNonProductFee = feeById.get("zzz:other-non-product") || 0;
  const nonProductFee = taxFee + otherNonProductFee;
  const detailsJson = JSON.stringify({
    feeDetails: details.map(item => ({ type: String(item.type || ""), amountCents: Number(item.amount), currency: String(item.currency || currency).toUpperCase() })),
    nonProcessingFeeCents: nonProcessingFee,
    processingFeeTypes: [...PROCESSING_FEE_TYPES],
    taxAmountCents: taxAmount,
    taxProcessingFeeCents: taxFee,
    otherNonProductAmountCents: otherNonProduct,
    otherNonProductProcessingFeeCents: otherNonProductFee,
  });

  const existingBalance = await database.prepare("SELECT order_id FROM stripe_order_fee_reconciliations WHERE balance_transaction_id=? AND order_id<>?").bind(balanceId, orderId).first();
  if (existingBalance) throw new Error("Stripe balance transaction is already reconciled to another order.");
  const statements = [database.prepare(`
    UPDATE stripe_order_fee_reconciliations SET charge_id=?,balance_transaction_id=?,transaction_amount_cents=?,
      currency=?,total_fee_cents=?,processing_fee_cents=?,non_processing_fee_cents=?,non_product_amount_cents=?,
      non_product_processing_fee_cents=?,tax_amount_cents=?,other_non_product_amount_cents=?,
      tax_processing_fee_cents=?,other_non_product_processing_fee_cents=?,status='reconciled',provider_event_id=?,details_json=?,reconciled_at=?
    WHERE order_id=? AND status='pending'
  `).bind(chargeId, balanceId, transactionAmount, currency, totalFee, processingFee, nonProcessingFee, nonProduct, nonProductFee,
    taxAmount, otherNonProduct, taxFee, otherNonProductFee,
    providerEventId || null, detailsJson, createdAt, orderId),
  database.prepare("UPDATE orders SET processor_fee_cents=?,net_proceeds_cents=? WHERE id=? AND payment_status IN ('paid','refunded','disputed')")
    .bind(totalFee, transactionAmount - totalFee, orderId)];

  for (const allocation of allocations) {
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO stripe_order_fee_allocations(order_item_id,order_id,account_category,item_amount_cents,
        processing_fee_cents,creator_absorbed_fee_cents,trg_absorbed_fee_cents,balance_transaction_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(allocation.orderItemId, orderId, allocation.category, allocation.amountCents, allocation.processingFeeCents,
      allocation.creatorAbsorbedFeeCents, allocation.trgAbsorbedFeeCents, balanceId, createdAt));
    if (allocation.creatorAbsorbedFeeCents > 0) {
      const sale = await database.prepare("SELECT creator_id,currency,available_at,payout_state,amount_cents FROM creator_earnings_ledger WHERE order_item_id=? AND entry_type='sale_earning'").bind(allocation.orderItemId).first();
      if (!sale || Number(sale.amount_cents) < allocation.creatorAbsorbedFeeCents) throw new Error("Creator sale earning is not available for fee reconciliation.");
      statements.push(database.prepare(`
        INSERT OR IGNORE INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,
          product_slug,available_at,payout_state,reason,idempotency_key,created_at)
        SELECT ?, 'manual_adjustment', ?, ?, ?, ?, oi.product_slug, ?, ?, 'Stripe transaction processing fee allocation', ?, ?
        FROM order_items oi WHERE oi.id=?
      `).bind(sale.creator_id, -allocation.creatorAbsorbedFeeCents, sale.currency, orderId, allocation.orderItemId,
        sale.available_at, sale.available_at <= createdAt ? "available" : "pending",
        `stripe-processing-fee:${balanceId}:${allocation.orderItemId}`, createdAt, allocation.orderItemId));
      statements.push(database.prepare(`UPDATE creator_earnings_ledger SET payout_state=CASE WHEN available_at<=? THEN 'available' ELSE 'pending' END
        WHERE order_item_id=? AND entry_type='sale_earning' AND payout_state='held'`).bind(createdAt, allocation.orderItemId));
    }
  }
  statements.push(database.prepare(`
    INSERT INTO creator_financial_audit(actor_type,actor_id,action,amount_cents,currency,context_json,created_at)
    VALUES('system',?,'stripe_processing_fee_reconciled',?,?,?,?)
  `).bind(providerEventId || balanceId, processingFee, currency, JSON.stringify({ orderId, chargeId, balanceTransactionId: balanceId,
    totalFeeCents: totalFee, processingFeeCents: processingFee, nonProcessingFeeCents: nonProcessingFee,
    nonProductAmountCents: nonProduct, nonProductProcessingFeeCents: nonProductFee,
    allocations: allocations.map(row => ({ orderItemId: row.orderItemId, category: row.category,
      processingFeeCents: row.processingFeeCents, creatorAbsorbedFeeCents: row.creatorAbsorbedFeeCents,
      trgAbsorbedFeeCents: row.trgAbsorbedFeeCents })) }), createdAt));
  await database.batch(statements);
  return { action: "fee_reconciled", orderId, balanceTransactionId: balanceId, processingFeeCents: processingFee,
    totalFeeCents: totalFee, nonProcessingFeeCents: nonProcessingFee,
    nonProductAmountCents: nonProduct, nonProductProcessingFeeCents: nonProductFee,
    taxAmountCents: taxAmount, taxProcessingFeeCents: taxFee,
    otherNonProductAmountCents: otherNonProduct, otherNonProductProcessingFeeCents: otherNonProductFee,
    allocations };
}

async function markFeeReconciliationNeedsReview(database, { orderId, chargeId, balanceId, totalFee, currency, transactionAmount, details, providerEventId, createdAt, reason }) {
  const prior = await database.prepare("SELECT status FROM stripe_order_fee_reconciliations WHERE order_id=?").bind(orderId).first();
  if (!prior || prior.status !== "pending") return { action: "fee_needs_review", orderId, reason };
  const detailsJson = JSON.stringify({ reason, balanceTransactionId: balanceId, totalFeeCents: totalFee,
    transactionAmountCents: transactionAmount, feeDetails: (details || []).map(item => ({
      type: String(item?.type || ""), amountCents: Number.isSafeInteger(item?.amount) ? item.amount : null,
      currency: String(item?.currency || "").toUpperCase() || null,
    })) });
  await database.batch([
    database.prepare(`UPDATE stripe_order_fee_reconciliations SET charge_id=?,balance_transaction_id=?,
      transaction_amount_cents=?,currency=?,total_fee_cents=?,status='needs_review',provider_event_id=?,details_json=?,reconciled_at=?
      WHERE order_id=? AND status='pending'`).bind(chargeId, balanceId, transactionAmount, currency,
        totalFee, providerEventId || null, detailsJson, createdAt, orderId),
    database.prepare("UPDATE orders SET processor_fee_cents=?,net_proceeds_cents=? WHERE id=? AND payment_status IN ('paid','refunded','disputed')")
      .bind(totalFee, transactionAmount - totalFee, orderId),
  ]);
  return { action: "fee_needs_review", orderId, balanceTransactionId: balanceId, reason };
}

export function allocateMinorUnits(amountCents, weights) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Array.isArray(weights)) throw new Error("Minor-unit allocation input is invalid.");
  const normalized = weights.map(part => ({ id: String(part.id), weight: Number(part.weight) }));
  if (normalized.some(part => !part.id || !Number.isSafeInteger(part.weight) || part.weight < 0)) throw new Error("Minor-unit allocation weight is invalid.");
  if (new Set(normalized.map(part => part.id)).size !== normalized.length) throw new Error("Minor-unit allocation IDs must be unique.");
  const denominator = normalized.reduce((sum, part) => sum + part.weight, 0);
  if (amountCents && !denominator) throw new Error("Cannot allocate a fee without transaction contribution.");
  const allocated = normalized.map(part => {
    const numerator = amountCents * part.weight;
    return { ...part, amountCents: denominator ? Math.floor(numerator / denominator) : 0, remainder: denominator ? numerator % denominator : 0 };
  });
  let centsLeft = amountCents - allocated.reduce((sum, part) => sum + part.amountCents, 0);
  const order = [...allocated].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let index = 0; centsLeft > 0; index += 1, centsLeft -= 1) order[index % order.length].amountCents += 1;
  return allocated.map(({ id, weight, amountCents: share }) => ({ id, weight, amountCents: share }));
}

export async function stripeGet(path, secretKey, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    headers: { authorization: `Bearer ${secretKey}`, "stripe-version": STRIPE_API_VERSION },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message || "Stripe fee evidence could not be retrieved."));
  return payload;
}

function providerId(value) {
  return typeof value === "string" ? value : String(value?.id || "");
}
