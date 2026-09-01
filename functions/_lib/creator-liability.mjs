const rows = async (statement) => (await statement.all()).results || [];
const amount = (row) => Number(row?.amount || 0);
const firstOrZero = async (statement) => {
  try {
    return (await statement.first()) || {};
  } catch (error) {
    if (/no such table|no such column/i.test(String(error))) return {};
    throw error;
  }
};

export async function getCreatorLiability(
  db,
  creatorId,
  { currency = "USD", nowMs = Date.now() } = {},
) {
  const now = new Date(nowMs).toISOString(),
    code = String(currency).toUpperCase();
  const [
    ledger,
    internal,
    payoutReserved,
    purchaseReserved,
    disputeHeld,
    completed,
  ] = await Promise.all([
    firstOrZero(
      db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN entry_type='sale_earning' THEN amount_cents ELSE 0 END),0) gross,
   COALESCE(SUM(CASE WHEN payout_state<>'held' AND available_at<=? THEN amount_cents ELSE 0 END),0) available,
   COALESCE(SUM(CASE WHEN payout_state<>'held' AND available_at>? THEN amount_cents ELSE 0 END),0) pending,
   COALESCE(SUM(CASE WHEN payout_state='held' THEN amount_cents ELSE 0 END),0) held,
   COALESCE(SUM(amount_cents),0) net,
   COALESCE(SUM(CASE WHEN entry_type='payout' THEN -amount_cents ELSE 0 END),0) completed_payouts,
   COALESCE(SUM(CASE WHEN entry_type IN ('refund_reversal','chargeback_reversal','manual_adjustment','payout_reversal') THEN amount_cents ELSE 0 END),0) adjustments
   FROM creator_earnings_ledger WHERE creator_id=? AND currency=?`,
        )
        .bind(now, now, creatorId, code),
    ),
    firstOrZero(
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_cents),0) amount,
   COALESCE(SUM(CASE WHEN amount_cents<0 THEN -amount_cents ELSE 0 END),0) debits,
   COALESCE(SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END),0) credits
   FROM creator_balance_transactions WHERE creator_id=? AND currency=?`,
        )
        .bind(creatorId, code),
    ),
    firstOrZero(
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_payout_reservations WHERE creator_id=? AND status='reserved'",
        )
        .bind(creatorId),
    ),
    firstOrZero(
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_balance_reservations WHERE creator_id=? AND currency=? AND state='reserved'",
        )
        .bind(creatorId, code),
    ),
    firstOrZero(
      db
        .prepare(
          "SELECT COALESCE(SUM(allocated_gross_cents),0) amount FROM creator_dispute_allocations WHERE creator_id=? AND status='held'",
        )
        .bind(creatorId),
    ),
    firstOrZero(
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_payouts WHERE creator_id=? AND currency=? AND status='paid'",
        )
        .bind(creatorId, code),
    ),
  ]);
  const internalNet = amount(internal),
    signedNet = Number(ledger?.net || 0) + internalNet,
    availableBeforeRestrictions = Number(ledger?.available || 0) + internalNet,
    payoutReserve = amount(payoutReserved),
    purchaseReserve = amount(purchaseReserved),
    dispute = amount(disputeHeld),
    eligible =
      availableBeforeRestrictions - payoutReserve - purchaseReserve - dispute;
  return {
    creatorId,
    currency: code,
    grossAccruedCreatorEarningsCents: Number(ledger?.gross || 0),
    availableBalanceCents: Math.max(0, availableBeforeRestrictions),
    pendingBalanceCents: Math.max(0, Number(ledger?.pending || 0)),
    heldBalanceCents: Math.max(0, Number(ledger?.held || 0)),
    disputeHeldCents: Math.max(0, dispute),
    payoutReservedCents: payoutReserve,
    purchaseReservedCents: purchaseReserve,
    internalBalanceDebitsCents: Number(internal?.debits || 0),
    correctionRestorationCreditsCents: Number(internal?.credits || 0),
    ledgerAdjustmentsCents: Number(ledger?.adjustments || 0),
    negativeBalanceCents: Math.max(0, -signedNet),
    completedPayoutsCents: Math.max(
      amount(completed),
      Number(ledger?.completed_payouts || 0),
    ),
    currentNetLiabilityCents: Math.max(0, signedNet),
    rawPayoutReservationCapacityCents: eligible,
    payoutEligibleCents: Math.max(0, eligible),
  };
}

export async function getPayoutCompletionCapacity(
  db,
  { payoutRequestId, creatorId, nowMs = Date.now() } = {},
) {
  const reservation = await db
    .prepare(
      "SELECT r.*,q.currency,q.status request_status FROM creator_payout_reservations r JOIN creator_payout_requests q ON q.id=r.payout_request_id WHERE r.payout_request_id=? AND r.creator_id=? AND r.status='reserved' AND q.status IN ('pending','processing')",
    )
    .bind(String(payoutRequestId || ""), String(creatorId || ""))
    .first();
  if (!reservation)
    throw new Error("A matching active payout reservation is required.");
  const liability = await getCreatorLiability(db, reservation.creator_id, {
      currency: reservation.currency,
      nowMs,
    }),
    reservedAmountCents = Number(reservation.amount_cents),
    rawCompletionCapacityCents =
      liability.rawPayoutReservationCapacityCents + reservedAmountCents;
  return {
    reservation,
    liability,
    reservedAmountCents,
    rawCompletionCapacityCents,
    completionSafe: rawCompletionCapacityCents >= reservedAmountCents,
  };
}

export async function getMarketplaceCreatorLiability(db, options = {}) {
  const creators = await rows(
      db.prepare(
        "SELECT id,slug,display_name FROM marketplace_creators ORDER BY display_name",
      ),
    ),
    items = [];
  for (const creator of creators)
    items.push({
      ...creator,
      ...(await getCreatorLiability(db, creator.id, options)),
    });
  const keys = [
    "currentNetLiabilityCents",
    "availableBalanceCents",
    "pendingBalanceCents",
    "heldBalanceCents",
    "disputeHeldCents",
    "payoutReservedCents",
    "purchaseReservedCents",
    "negativeBalanceCents",
    "completedPayoutsCents",
    "payoutEligibleCents",
  ];
  const totals = Object.fromEntries(
    keys.map((key) => [
      key,
      items.reduce((sum, item) => sum + Number(item[key] || 0), 0),
    ]),
  );
  return {
    items,
    totals: {
      ...totals,
      totalCreatorLiabilityCents: totals.currentNetLiabilityCents,
    },
  };
}

export async function reserveCreatorPayout(
  db,
  {
    creatorId,
    amountCents,
    currency = "USD",
    accountClosure = false,
    enforceMinimum = true,
    requestId = crypto.randomUUID(),
    nowMs = Date.now(),
  } = {},
) {
  const liability = await getCreatorLiability(db, creatorId, {
      currency,
      nowMs,
    }),
    amount = accountClosure
      ? liability.payoutEligibleCents
      : Number(amountCents),
    now = new Date(nowMs).toISOString();
  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > liability.payoutEligibleCents
  )
    throw new Error("Payout exceeds canonical eligible Creator liability.");
  if (enforceMinimum && !accountClosure && amount < 1000)
    throw new Error("Normal withdrawals require at least $10.");
  const reservationsAvailable = await payoutReservationSchemaAvailable(db);
  try {
    const statements = [
      db
        .prepare(
          "INSERT INTO creator_payout_requests(id,creator_id,amount_cents,currency,request_kind,status,requested_at) VALUES(?,?,?,?,?,'pending',?)",
        )
        .bind(
          requestId,
          creatorId,
          amount,
          String(currency).toUpperCase(),
          accountClosure ? "account_closure" : "normal",
          now,
        ),
    ];
    if (reservationsAvailable)
      statements.push(
        db
          .prepare(
            "INSERT INTO creator_payout_reservations(payout_request_id,creator_id,amount_cents,status,created_at) VALUES(?,?,?,'reserved',?)",
          )
          .bind(requestId, creatorId, amount, now),
      );
    await db.batch(statements);
  } catch (error) {
    throw new Error(
      /insufficient available Creator Balance/i.test(String(error))
        ? "Payout reservation exceeds current canonical balance."
        : "Only one payout request may be pending at a time.",
    );
  }
  return { requestId, amountCents: amount, liabilityBefore: liability };
}

export async function payoutReservationSchemaAvailable(db) {
  try {
    await db
      .prepare("SELECT 1 FROM creator_payout_reservations LIMIT 1")
      .first();
    return true;
  } catch (error) {
    if (/no such table/i.test(String(error))) return false;
    throw error;
  }
}

export async function getTrgRevenueReport(db) {
  const [
    externalProduct,
    internalProduct,
    productReversals,
    service,
    providerCosts,
    orders,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT COALESCE(SUM(s.marketplace_fee_cents),0) amount FROM creator_sale_snapshots s JOIN orders o ON o.id=s.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE b.id IS NULL",
      )
      .first(),
    db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN entry_type='commission' THEN amount_cents ELSE 0 END),0) gross,COALESCE(SUM(CASE WHEN entry_type='commission_reversal' THEN -amount_cents ELSE 0 END),0) reversals,COALESCE(SUM(amount_cents),0) amount FROM marketplace_internal_commission_ledger",
      )
      .first(),
    db
      .prepare(
        "SELECT COALESCE(SUM(r.gross_reversed_cents-r.creator_net_reversed_cents),0) amount FROM creator_reversal_snapshots r JOIN orders o ON o.id=r.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE b.id IS NULL",
      )
      .first(),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN l.entry_type='service_revenue' THEN l.amount_cents ELSE 0 END),0) gross,
   COALESCE(SUM(CASE WHEN l.entry_type='service_reversal' THEN -l.amount_cents ELSE 0 END),0) reversals,
   COALESCE(SUM(l.amount_cents),0) net,
   COALESCE(SUM(CASE WHEN p.payment_source='stripe' THEN l.amount_cents ELSE 0 END),0) stripe_net,
   COALESCE(SUM(CASE WHEN p.payment_source='creator_balance' THEN l.amount_cents ELSE 0 END),0) balance_net,
   COALESCE(SUM(CASE WHEN l.entry_type='service_revenue' AND p.service_sku LIKE 'preferred_%' THEN l.amount_cents ELSE 0 END),0) preferred,
   COALESCE(SUM(CASE WHEN l.entry_type='service_revenue' AND p.service_sku='ad_credit_package' THEN l.amount_cents ELSE 0 END),0) ads,
   COALESCE(SUM(CASE WHEN l.entry_type='service_revenue' AND p.service_sku LIKE 'additional_identity_%' THEN l.amount_cents ELSE 0 END),0) identities,
   COALESCE(SUM(CASE WHEN p.payment_source='stripe' AND p.service_sku LIKE 'preferred_%' THEN l.amount_cents ELSE 0 END),0) preferred_stripe,
   COALESCE(SUM(CASE WHEN p.payment_source='creator_balance' AND p.service_sku LIKE 'preferred_%' THEN l.amount_cents ELSE 0 END),0) preferred_balance,
   COALESCE(SUM(CASE WHEN p.payment_source='stripe' AND p.service_sku='ad_credit_package' THEN l.amount_cents ELSE 0 END),0) ads_stripe,
   COALESCE(SUM(CASE WHEN p.payment_source='creator_balance' AND p.service_sku='ad_credit_package' THEN l.amount_cents ELSE 0 END),0) ads_balance,
   COALESCE(SUM(CASE WHEN p.payment_source='stripe' AND p.service_sku LIKE 'additional_identity_%' THEN l.amount_cents ELSE 0 END),0) identities_stripe,
   COALESCE(SUM(CASE WHEN p.payment_source='creator_balance' AND p.service_sku LIKE 'additional_identity_%' THEN l.amount_cents ELSE 0 END),0) identities_balance,
   COALESCE(SUM(CASE WHEN p.processor_fee_authoritative=1 THEN p.processor_fee_cents ELSE 0 END),0) fees,
   COALESCE(SUM(CASE WHEN p.processor_fee_authoritative<>1 AND p.payment_source='stripe' THEN 1 ELSE 0 END),0) unknown_fees
   FROM marketplace_service_revenue_ledger l JOIN marketplace_service_purchases p ON p.id=l.service_purchase_id`,
      )
      .first(),
    db
      .prepare(
        "SELECT COALESCE(SUM(actual_provider_cost_cents),0) amount FROM marketplace_provider_cost_allocations WHERE responsibility='marketplace'",
      )
      .first(),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN payment_source='stripe' AND payment_status IN ('paid','refunded','disputed') THEN total_cents ELSE 0 END),0) stripe_product,
   COALESCE(SUM(CASE WHEN payment_source='creator_balance' AND payment_status IN ('paid','refunded','disputed') THEN total_cents ELSE 0 END),0) balance_product,
   COALESCE(SUM(CASE WHEN payment_source='stripe' THEN processor_fee_cents ELSE 0 END),0) processor_fees FROM orders`,
      )
      .first(),
  ]);
  const productGross =
      amount(externalProduct) + Number(internalProduct?.gross || 0),
    productReversal =
      amount(productReversals) + Number(internalProduct?.reversals || 0),
    productNet = productGross - productReversal,
    costs =
      Number(orders?.processor_fees || 0) +
      Number(service?.fees || 0) +
      amount(providerCosts);
  return {
    productCommission: {
      stripeGrossCents: amount(externalProduct),
      creatorBalanceGrossCents: Number(internalProduct?.gross || 0),
      creatorBalanceNetCents: amount(internalProduct),
      reversalsCents: productReversal,
      grossCents: productGross,
      netCents: productNet,
    },
    serviceRevenue: {
      grossCents: Number(service?.gross || 0),
      reversalsCents: Number(service?.reversals || 0),
      netCents: Number(service?.net || 0),
      stripeNetCents: Number(service?.stripe_net || 0),
      creatorBalanceNetCents: Number(service?.balance_net || 0),
      preferredGrossCents: Number(service?.preferred || 0),
      preferredStripeNetCents: Number(service?.preferred_stripe || 0),
      preferredCreatorBalanceNetCents: Number(service?.preferred_balance || 0),
      adCreditsGrossCents: Number(service?.ads || 0),
      adCreditsStripeNetCents: Number(service?.ads_stripe || 0),
      adCreditsCreatorBalanceNetCents: Number(service?.ads_balance || 0),
      additionalIdentityGrossCents: Number(service?.identities || 0),
      additionalIdentityStripeNetCents: Number(service?.identities_stripe || 0),
      additionalIdentityCreatorBalanceNetCents: Number(
        service?.identities_balance || 0,
      ),
    },
    costs: {
      productProcessorFeesCents: Number(orders?.processor_fees || 0),
      serviceProcessorFeesCents: Number(service?.fees || 0),
      marketplaceProviderCostsCents: amount(providerCosts),
      totalCents: costs,
      unknownServiceProcessorFeeCount: Number(service?.unknown_fees || 0),
    },
    cashActivity: {
      externalStripeProductCents: Number(orders?.stripe_product || 0),
      externalStripeServiceCents: Math.max(0, Number(service?.stripe_net || 0)),
      internalCreatorBalanceProductCents: Number(orders?.balance_product || 0),
      internalCreatorBalanceServiceCents: Math.max(
        0,
        Number(service?.balance_net || 0),
      ),
    },
    netRetainedRevenueCents: productNet + Number(service?.net || 0) - costs,
    timingWarning:
      "Stripe settlement timing and bank transfers are not represented; this is ledger activity, not a bank-statement reconciliation.",
  };
}

export async function listFinanceTransactions(db, { limit = 250 } = {}) {
  const product = await rows(
    db
      .prepare(
        `SELECT o.public_id order_reference,o.created_at,o.payment_source,o.total_cents,o.processor_fee_cents,o.payment_status,o.fulfillment_status,s.creator_id,c.display_name creator_name,s.product_title,s.gross_cents,s.creator_net_cents,s.marketplace_fee_cents,l.payout_state,e.status entitlement_status,(SELECT COUNT(*) FROM creator_reversal_snapshots r WHERE r.order_item_id=s.order_item_id) reversal_count FROM creator_sale_snapshots s JOIN orders o ON o.id=s.order_id JOIN marketplace_creators c ON c.id=s.creator_id LEFT JOIN creator_earnings_ledger l ON l.order_item_id=s.order_item_id AND l.entry_type='sale_earning' LEFT JOIN download_entitlements e ON e.order_item_id=s.order_item_id ORDER BY o.created_at DESC LIMIT ?`,
      )
      .bind(limit),
  );
  const service = await rows(
    db
      .prepare(
        `SELECT p.id,p.created_at,p.creator_id,c.display_name creator_name,p.service_type,p.service_sku,p.payment_source,p.amount_cents,p.processor_fee_cents,p.processor_fee_authoritative,p.status,p.provider_payment_reference,COALESCE((SELECT SUM(amount_cents) FROM marketplace_service_revenue_ledger l WHERE l.service_purchase_id=p.id),0) recognized_revenue_cents,(SELECT COUNT(*) FROM creator_service_refund_corrections r WHERE r.service_purchase_id=p.id) correction_count,(SELECT coverage_ends_at FROM creator_identity_coverage_periods x WHERE x.service_purchase_id=p.id) identity_coverage_ends_at,(SELECT coverage_ends_at FROM preferred_service_charges x WHERE x.service_purchase_id=p.id) preferred_coverage_ends_at FROM marketplace_service_purchases p JOIN marketplace_creators c ON c.id=p.creator_id ORDER BY p.created_at DESC LIMIT ?`,
      )
      .bind(limit),
  );
  const audit = await rows(
    db
      .prepare(
        "SELECT actor_type,actor_id,action,creator_id,amount_cents,currency,context_json,created_at FROM creator_financial_audit ORDER BY created_at DESC LIMIT ?",
      )
      .bind(limit),
  );
  return { product, service, audit };
}
