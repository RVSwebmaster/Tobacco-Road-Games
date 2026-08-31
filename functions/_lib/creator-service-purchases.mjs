import { getCreatorBalance } from "./creator-balance.mjs";
export const SERVICE_PRICING = Object.freeze({
  preferred_monthly: {
    serviceType: "preferred_creator_fee",
    amountCents: 2000,
    quantity: 1,
    cadence: "monthly_commitment",
  },
  preferred_annual: {
    serviceType: "preferred_creator_fee",
    amountCents: 20000,
    quantity: 1,
    cadence: "annual_prepaid",
  },
  ad_credit_package: {
    serviceType: "ad_credit_package",
    amountCents: 500,
    quantity: 5,
  },
});

export async function purchaseServiceWithCreatorBalance(
  db,
  { creatorId, userId, sku, idempotencyKey, nowMs = Date.now() } = {},
) {
  if (
    !creatorId ||
    !userId ||
    !/^svc_[0-9a-f-]{36}$/i.test(String(idempotencyKey || ""))
  )
    throw new Error("A valid service purchase attempt is required.");
  const price = SERVICE_PRICING[sku];
  if (!price)
    throw new Error(
      "That marketplace service is not eligible for Creator Balance.",
    );
  const existing = await db
    .prepare(
      "SELECT * FROM marketplace_service_purchases WHERE idempotency_key=? AND creator_id=? AND user_id=?",
    )
    .bind(String(idempotencyKey), creatorId, userId)
    .first();
  if (existing)
    return {
      purchaseId: existing.id,
      serviceType: existing.service_type,
      amountCents: existing.amount_cents,
      idempotent: true,
    };
  if (price.serviceType === "preferred_creator_fee") {
    const covered = await db
      .prepare(
        "SELECT pc.coverage_ends_at FROM preferred_service_charges pc JOIN marketplace_service_purchases p ON p.id=pc.service_purchase_id WHERE p.creator_id=? AND p.status='settled' AND pc.payment_cadence=? AND pc.coverage_ends_at>? ORDER BY pc.coverage_ends_at DESC LIMIT 1",
      )
      .bind(creatorId, price.cadence, new Date(nowMs).toISOString())
      .first();
    if (covered)
      throw new Error(
        `This Preferred charge is already covered through ${covered.coverage_ends_at}.`,
      );
  }
  const balance = await getCreatorBalance(db, { creatorId, userId, nowMs });
  if (balance.availableCents < price.amountCents)
    throw new Error(
      "Available Creator Balance does not cover this full service charge. Split tender is not available.",
    );
  const now = new Date(nowMs).toISOString(),
    purchaseId = crypto.randomUUID(),
    reservationId = crypto.randomUUID(),
    debitId = crypto.randomUUID(),
    statements = [
      db
        .prepare(
          "INSERT INTO creator_balance_reservations(id,creator_id,user_id,amount_cents,currency,purpose,checkout_attempt_id,state,created_at) VALUES(?,?,?,?,'USD','marketplace_service',?,'reserved',?)",
        )
        .bind(
          reservationId,
          creatorId,
          userId,
          price.amountCents,
          `service:${idempotencyKey}`,
          now,
        ),
      db
        .prepare(
          "INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,processor_fee_cents,status,balance_reservation_id,balance_transaction_id,idempotency_key,context_json,created_at) VALUES(?,?,?,?,?,?,?,'USD','creator_balance','internal_ledger',0,'settled',?,NULL,?,'{}',?)",
        )
        .bind(
          purchaseId,
          creatorId,
          userId,
          price.serviceType,
          sku,
          price.quantity,
          price.amountCents,
          reservationId,
          String(idempotencyKey),
          now,
        ),
      db
        .prepare(
          "INSERT INTO creator_balance_transactions(id,creator_id,user_id,transaction_type,amount_cents,currency,reservation_id,idempotency_key,description,created_at) VALUES(?,?,?,'service_debit',-?,'USD',?,?,?,?)",
        )
        .bind(
          debitId,
          creatorId,
          userId,
          price.amountCents,
          reservationId,
          `service-debit:${idempotencyKey}`,
          price.serviceType === "ad_credit_package"
            ? "Creator Balance Ad Credit package"
            : "Creator Balance Preferred Creator fee",
          now,
        ),
      db
        .prepare(
          "INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,?,'service_revenue',?,'USD',?,?)",
        )
        .bind(
          purchaseId,
          price.serviceType,
          price.amountCents,
          `service-revenue:${idempotencyKey}`,
          now,
        ),
    ];
  let result = {
    purchaseId,
    serviceType: price.serviceType,
    amountCents: price.amountCents,
    paymentSource: "creator_balance",
    settlementMethod: "internal_ledger",
    processorFeeCents: 0,
  };
  if (price.serviceType === "ad_credit_package") {
    const creditPurchaseId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          "INSERT INTO creator_ad_credit_purchases(id,creator_id,quantity,amount_cents,currency,status,created_at,paid_at,service_purchase_id,payment_source,settlement_method) VALUES(?,?,5,500,'USD','paid',?,?,?,?, 'internal_ledger')",
        )
        .bind(
          creditPurchaseId,
          creatorId,
          now,
          now,
          purchaseId,
          "creator_balance",
        ),
      db
        .prepare(
          "INSERT INTO creator_ad_credit_ledger(creator_id,entry_type,quantity,idempotency_key,context_json,created_at) VALUES(?,'pack_purchase',5,?,?,?)",
        )
        .bind(
          creatorId,
          `service-credit:${idempotencyKey}`,
          JSON.stringify({
            servicePurchaseId: purchaseId,
            amountCents: 500,
            currency: "USD",
            paymentSource: "creator_balance",
          }),
          now,
        ),
    );
    result = { ...result, creditsIssued: 5 };
  } else {
    const active = await db
        .prepare(
          "SELECT * FROM creator_preferred_terms WHERE creator_id=? AND status='active' AND term_ends_at>? ORDER BY term_ends_at DESC LIMIT 1",
        )
        .bind(creatorId, now)
        .first(),
      termId = active?.id || crypto.randomUUID(),
      termStart = active ? new Date(active.term_started_at) : new Date(nowMs),
      termEnd = active ? new Date(active.term_ends_at) : addYear(termStart),
      coverageStart = active
        ? nextCoverageStart(active, price.cadence, nowMs)
        : termStart,
      coverageEnd =
        price.cadence === "annual_prepaid"
          ? addYear(coverageStart)
          : addMonth(coverageStart);
    if (!active)
      statements.push(
        db
          .prepare(
            "INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'renews','active',?,?)",
          )
          .bind(
            termId,
            creatorId,
            price.cadence,
            price.amountCents,
            termStart.toISOString(),
            termEnd.toISOString(),
            now,
            now,
          ),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO preferred_service_charges(service_purchase_id,preferred_term_id,payment_cadence,coverage_starts_at,coverage_ends_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          purchaseId,
          termId,
          price.cadence,
          coverageStart.toISOString(),
          coverageEnd.toISOString(),
        ),
    );
    result = {
      ...result,
      preferredTermId: termId,
      paymentCadence: price.cadence,
      termEndsAt: termEnd.toISOString(),
      coverageEndsAt: coverageEnd.toISOString(),
    };
  }
  statements.push(
    db
      .prepare(
        "UPDATE marketplace_service_purchases SET balance_transaction_id=? WHERE id=?",
      )
      .bind(debitId, purchaseId),
    db
      .prepare(
        "UPDATE creator_balance_reservations SET state='consumed',resolved_at=? WHERE id=? AND state='reserved'",
      )
      .bind(now, reservationId),
    db
      .prepare(
        "INSERT INTO creator_balance_audit(actor_type,actor_id,action,creator_id,amount_cents,currency,context_json,created_at) VALUES('customer',?,'service_purchase_settled',?,?,'USD',?,?)",
      )
      .bind(
        userId,
        creatorId,
        price.amountCents,
        JSON.stringify({ purchaseId, serviceType: price.serviceType, sku }),
        now,
      ),
  );
  await db.batch(statements);
  return result;
}
function addMonth(date) {
  const x = new Date(date);
  x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}
function addYear(date) {
  const x = new Date(date);
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  return x;
}
function nextCoverageStart(term, cadence, nowMs) {
  if (cadence === "annual_prepaid")
    return new Date(Math.max(nowMs, Date.parse(term.term_ends_at)));
  return new Date(nowMs);
}
