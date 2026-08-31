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
  additional_identity_monthly: {
    serviceType: "additional_creator_identity_fee",
    amountCents: 1000,
    quantity: 1,
    cadence: "monthly",
  },
  additional_identity_annual: {
    serviceType: "additional_creator_identity_fee",
    amountCents: 10000,
    quantity: 1,
    cadence: "annual_prepaid",
  },
});

export async function settleStripeAdCreditPurchase(
  db,
  {
    purchaseId,
    stripeCheckoutSessionId,
    stripePaymentIntentId,
    providerEventId,
    amountCents,
    currency,
    paymentStatus,
    processorFeeCents = null,
    nowMs = Date.now(),
  } = {},
) {
  const price = SERVICE_PRICING.ad_credit_package;
  if (
    !purchaseId ||
    !String(stripeCheckoutSessionId || "").startsWith("cs_") ||
    !String(stripePaymentIntentId || "").startsWith("pi_") ||
    !String(providerEventId || "").startsWith("evt_") ||
    Number(amountCents) !== price.amountCents ||
    String(currency || "").toUpperCase() !== "USD" ||
    paymentStatus !== "paid"
  )
    throw new Error("Authoritative Stripe Ad Credit payment data is invalid.");
  const purchase = await db
    .prepare("SELECT * FROM creator_ad_credit_purchases WHERE id=?")
    .bind(String(purchaseId))
    .first();
  if (!purchase) throw new Error("Stripe Ad Credit purchase was not found.");
  if (
    purchase.stripe_checkout_session_id &&
    purchase.stripe_checkout_session_id !== stripeCheckoutSessionId
  )
    throw new Error("Stripe Ad Credit checkout session does not match.");
  const existing = purchase.service_purchase_id
    ? await db
        .prepare("SELECT * FROM marketplace_service_purchases WHERE id=?")
        .bind(purchase.service_purchase_id)
        .first()
    : await db
        .prepare(
          "SELECT * FROM marketplace_service_purchases WHERE stripe_checkout_session_id=?",
        )
        .bind(stripeCheckoutSessionId)
        .first();
  if (
    existing &&
    (existing.creator_id !== purchase.creator_id ||
      existing.service_type !== "ad_credit_package" ||
      Number(existing.amount_cents) !== price.amountCents ||
      Number(existing.quantity) !== price.quantity ||
      existing.payment_source !== "stripe")
  )
    throw new Error("Existing Stripe service settlement is inconsistent.");
  if (existing)
    return {
      purchaseId: existing.id,
      creditsIssued: 5,
      idempotent: true,
      paymentSource: existing.payment_source,
    };
  if (purchase.status !== "pending")
    throw new Error("Stripe Ad Credit purchase is not payable.");
  const owner = await db
      .prepare(
        "SELECT owner_user_id FROM creator_identity_ownership WHERE creator_id=?",
      )
      .bind(purchase.creator_id)
      .first(),
    userId = purchase.initiated_by_user_id || owner?.owner_user_id;
  if (!userId) throw new Error("Stripe Ad Credit purchaser is unavailable.");
  const now = new Date(nowMs).toISOString(),
    servicePurchaseId = crypto.randomUUID(),
    feeKnown = Number.isInteger(processorFeeCents) && processorFeeCents >= 0,
    fee = feeKnown ? Number(processorFeeCents) : 0,
    serviceKey = `stripe-ad-credit:${purchase.id}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,processor_fee_cents,status,stripe_checkout_session_id,idempotency_key,context_json,created_at,provider_event_id,provider_payment_reference,processor_fee_authoritative,completed_at) VALUES(?,?,?,'ad_credit_package','ad_credit_package',5,500,'USD','stripe','external_provider',?,'settled',?,?,?,?,?,?,?,?)",
      )
      .bind(
        servicePurchaseId,
        purchase.creator_id,
        userId,
        fee,
        stripeCheckoutSessionId,
        serviceKey,
        JSON.stringify({
          adCreditPurchaseId: purchase.id,
          creditsIssued: 5,
          processorFeeKnown: feeKnown,
        }),
        now,
        providerEventId,
        stripePaymentIntentId,
        feeKnown ? 1 : 0,
        now,
      ),
    db
      .prepare(
        "INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,'ad_credit_package','service_revenue',500,'USD',?,?)",
      )
      .bind(servicePurchaseId, `service-revenue:${serviceKey}`, now),
    db
      .prepare(
        "UPDATE creator_ad_credit_purchases SET status='paid',paid_at=?,stripe_checkout_session_id=COALESCE(stripe_checkout_session_id,?),service_purchase_id=?,payment_source='stripe',settlement_method='external_provider',initiated_by_user_id=COALESCE(initiated_by_user_id,?) WHERE id=? AND status='pending'",
      )
      .bind(
        now,
        stripeCheckoutSessionId,
        servicePurchaseId,
        userId,
        purchase.id,
      ),
    db
      .prepare(
        "INSERT INTO creator_ad_credit_ledger(creator_id,entry_type,quantity,stripe_checkout_session_id,idempotency_key,context_json,created_at) VALUES(?,'pack_purchase',5,?,?,?,?)",
      )
      .bind(
        purchase.creator_id,
        stripeCheckoutSessionId,
        `service-credit:${serviceKey}`,
        JSON.stringify({
          servicePurchaseId,
          amountCents: 500,
          currency: "USD",
          paymentSource: "stripe",
          providerEventId,
        }),
        now,
      ),
  ]);
  return {
    purchaseId: servicePurchaseId,
    creditsIssued: 5,
    idempotent: false,
    paymentSource: "stripe",
    processorFeeCents: feeKnown ? fee : null,
  };
}

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
  if (price.serviceType === "additional_creator_identity_fee") {
    const identity = await db
      .prepare(
        "SELECT * FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=?",
      )
      .bind(creatorId, userId)
      .first();
    if (!identity || identity.identity_type !== "additional")
      throw new Error(
        "Only the owner may purchase coverage for an additional Creator identity.",
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
          "INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,processor_fee_cents,status,balance_reservation_id,balance_transaction_id,idempotency_key,context_json,created_at,processor_fee_authoritative,completed_at) VALUES(?,?,?,?,?,?,?,'USD','creator_balance','internal_ledger',0,'settled',?,NULL,?,'{}',?,1,?)",
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
            : price.serviceType === "additional_creator_identity_fee"
              ? "Creator Balance additional Creator identity fee"
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
  } else if (price.serviceType === "preferred_creator_fee") {
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
  } else {
    const latest = await db
        .prepare(
          "SELECT coverage_ends_at FROM creator_identity_coverage_periods WHERE creator_id=? AND status='active' ORDER BY coverage_ends_at DESC LIMIT 1",
        )
        .bind(creatorId)
        .first(),
      coverageStart = new Date(
        Math.max(nowMs, Date.parse(latest?.coverage_ends_at || "") || 0),
      ),
      coverageEnd =
        price.cadence === "annual_prepaid"
          ? addCoverageMonths(coverageStart, 12)
          : addCoverageMonths(coverageStart, 1),
      coverageId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          "INSERT INTO creator_identity_coverage_periods(id,creator_id,service_purchase_id,billing_plan,coverage_starts_at,coverage_ends_at,payment_source,status,renewal_state,created_at) VALUES(?,?,?,?,?,?,'creator_balance','active','nonrenewing',?)",
        )
        .bind(
          coverageId,
          creatorId,
          purchaseId,
          price.cadence,
          coverageStart.toISOString(),
          coverageEnd.toISOString(),
          now,
        ),
      db
        .prepare(
          "UPDATE creator_identity_ownership SET billing_cadence=?,billing_status='current',entitlement_source='additional_paid',updated_at=? WHERE creator_id=? AND owner_user_id=? AND identity_type='additional'",
        )
        .bind(price.cadence, now, creatorId, userId),
    );
    result = {
      ...result,
      billingPlan: price.cadence,
      coverageStartsAt: coverageStart.toISOString(),
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
function addCoverageMonths(date, months) {
  const source = new Date(date),
    day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0),
  ).getUTCDate();
  source.setUTCDate(Math.min(day, last));
  return source;
}
function nextCoverageStart(term, cadence, nowMs) {
  if (cadence === "annual_prepaid")
    return new Date(Math.max(nowMs, Date.parse(term.term_ends_at)));
  return new Date(nowMs);
}
