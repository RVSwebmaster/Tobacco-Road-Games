import {
  MARKETPLACE_POLICY,
  resolveSalePolicy,
} from "./marketplace-policy.mjs";
import {
  getCreatorLiability,
  getPayoutCompletionCapacity,
  payoutCompletionLinkageAvailable,
  payoutReservationSchemaAvailable,
  reserveCreatorPayout,
} from "./creator-liability.mjs";
import { assertOrdinaryPayoutAmount } from "./creator-payout-amount-policy.mjs";
const DEFAULT_RESERVE_DAYS = 14;

export function resolveFeePolicy(env = {}, nowMs = Date.now()) {
  const configured = Number(env.MARKETPLACE_FEE_BPS),
    basisPoints =
      Number.isInteger(configured) && configured >= 0 && configured <= 10000
        ? configured
        : MARKETPLACE_POLICY.standardFeeBasisPoints;
  const reserve = Number(env.CREATOR_PAYOUT_RESERVE_DAYS),
    reserveDays =
      Number.isInteger(reserve) && reserve >= 0 && reserve <= 365
        ? reserve
        : DEFAULT_RESERVE_DAYS;
  return {
    basisPoints,
    fixedOrderFeeCents: 0,
    fixedLineFeeCents: 0,
    reserveDays,
    effectiveAt: new Date(nowMs).toISOString(),
    developmentDefault: false,
  };
}
export async function getEffectiveFeePolicy(
  database,
  env = {},
  nowMs = Date.now(),
) {
  try {
    const row = await database
      .prepare(
        "SELECT * FROM marketplace_fee_policies WHERE effective_at<=? ORDER BY effective_at DESC,id DESC LIMIT 1",
      )
      .bind(new Date(nowMs).toISOString())
      .first();
    if (row)
      return {
        basisPoints: Number(row.percentage_basis_points),
        fixedOrderFeeCents: Number(row.fixed_order_fee_cents),
        fixedLineFeeCents: Number(row.fixed_line_fee_cents),
        reserveDays: resolveFeePolicy(env, nowMs).reserveDays,
        effectiveAt: row.effective_at,
        developmentDefault: false,
        policyId: Number(row.id),
      };
  } catch {}
  return resolveFeePolicy(env, nowMs);
}
export async function recordFeePolicy(database, input) {
  const bps = Number(input.basisPoints),
    line = Number(input.fixedLineFeeCents || 0),
    order = Number(input.fixedOrderFeeCents || 0),
    actor = String(input.operatorActor || ""),
    now = String(input.effectiveAt || new Date().toISOString()),
    note = String(input.note || "").slice(0, 1000);
  if (
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10000 ||
    ![line, order].every((value) => Number.isInteger(value) && value >= 0) ||
    !actor
  )
    throw new Error("Fee policy is invalid.");
  await database.batch([
    database
      .prepare(
        "INSERT INTO marketplace_fee_policies(percentage_basis_points,fixed_order_fee_cents,fixed_line_fee_cents,effective_at,created_by,note,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(bps, order, line, now, actor, note, now),
    database
      .prepare(
        "INSERT INTO creator_financial_audit(actor_type,actor_id,action,context_json,created_at) VALUES('operator',?,'fee_policy_recorded',?,?)",
      )
      .bind(
        actor,
        JSON.stringify({
          basisPoints: bps,
          fixedOrderFeeCents: order,
          fixedLineFeeCents: line,
          effectiveAt: now,
        }),
        now,
      ),
  ]);
  return { basisPoints: bps, effectiveAt: now };
}

export async function creatorSaleStatements(database, order, policy, paidAt) {
  let result,
    aligned = true;
  const nativeOrder = order?.catalog_source === "native_d1";
  try {
    result = await database
      .prepare(
        nativeOrder
          ? `SELECT oi.*,oi.native_creator_id creator_id,oi.native_product_id product_identity_id,oi.creator_first_published_at_snapshot first_published_at FROM order_items oi WHERE oi.order_id=? AND oi.catalog_source='native_d1'`
          : `SELECT oi.*,COALESCE(cl.creator_id,cb.creator_id) creator_id,cl.id product_identity_id,COALESCE((SELECT corrected_timestamp FROM creator_first_publication_corrections c WHERE c.listing_id=cl.id ORDER BY c.id DESC LIMIT 1),cl.first_published_at) first_published_at FROM order_items oi LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published' WHERE oi.order_id=?`,
      )
      .bind(Number(order.id))
      .all();
  } catch {
    aligned = false;
    try {
      result = await database
        .prepare(
          `SELECT oi.*,COALESCE(cl.creator_id,cb.creator_id) creator_id FROM order_items oi LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published' WHERE oi.order_id=?`,
        )
        .bind(Number(order.id))
        .all();
    } catch {
      return [];
    }
  }
  const availableAt = new Date(
      Date.parse(paidAt) + policy.reserveDays * 86400000,
    ).toISOString(),
    statements = [];
  for (const line of result.results || []) {
    if (!line.creator_id || Number(line.line_total_cents) <= 0) continue;
    const nativeSnapshotComplete = nativeOrder
      && Number.isInteger(line.creator_fee_basis_points_snapshot)
      && Number.isInteger(line.creator_fixed_fee_cents_snapshot)
      && Number.isInteger(line.creator_reserve_days_snapshot)
      && typeof line.creator_fee_policy_reason_snapshot === "string"
      && line.creator_fee_policy_reason_snapshot.length > 0
      && typeof line.creator_commission_category_snapshot === "string"
      && typeof line.creator_commission_policy_version_snapshot === "string";
    if (nativeOrder && !nativeSnapshotComplete) {
      throw new Error(`Native Creator fee policy snapshot is missing for order item ${line.id}.`);
    }
    const applied = nativeOrder
        ? { basisPoints: Number(line.creator_fee_basis_points_snapshot), reason: line.creator_fee_policy_reason_snapshot, category: line.creator_commission_category_snapshot }
        : aligned
        ? await resolveSalePolicy(database, {
            creatorId: line.creator_id,
            firstPublishedAt: line.first_published_at,
            nowMs: Date.parse(paidAt),
          })
        : { basisPoints: policy.basisPoints, reason: "legacy" },
      quantity = Number(line.quantity),
      gross = Number(line.line_total_cents),
      discount = Math.max(0, Number(line.list_price_cents) * quantity - gross),
      fixedFeeCents = nativeOrder
        ? Number(line.creator_fixed_fee_cents_snapshot)
        : applied.policyVersion === "owner-approved-commission-v1" ? 0 : policy.fixedLineFeeCents,
      reserveDays = nativeOrder ? Number(line.creator_reserve_days_snapshot) : policy.reserveDays,
      houseRevenue = Boolean(applied.houseRevenue)
        || ["owner", "admin"].includes(String(applied.category || line.creator_commission_category_snapshot || "")),
      fee = Math.min(
        gross,
        Math.round((gross * applied.basisPoints) / 10000) +
          fixedFeeCents,
      ),
      net = gross - fee,
      lineAvailableAt = new Date(Date.parse(paidAt) + reserveDays * 86400000).toISOString(),
      key = `sale:${order.id}:${line.id}`;
    const awaitingStripeFee = nativeOrder
      && line.creator_commission_policy_version_snapshot === "owner-approved-commission-v1";
    statements.push(
      aligned
        ? database
            .prepare(
              `INSERT OR IGNORE INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at,product_identity_id,policy_reason,account_category,account_category_verified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              Number(order.id),
              Number(line.id),
              line.creator_id,
              line.product_slug,
              line.product_title_snapshot,
              Number(line.list_price_cents),
              Number(line.effective_unit_price_cents),
              quantity,
              discount,
              gross,
              applied.basisPoints,
              fixedFeeCents,
              fee,
              net,
              String(line.currency).toUpperCase(),
              paidAt,
              line.product_identity_id,
              applied.reason,
              applied.category || "standard",
              nativeOrder && line.creator_commission_policy_version_snapshot === "owner-approved-commission-v1" ? 1 : 0,
            )
        : database
            .prepare(
              `INSERT OR IGNORE INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at,account_category,account_category_verified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              Number(order.id),
              Number(line.id),
              line.creator_id,
              line.product_slug,
              line.product_title_snapshot,
              Number(line.list_price_cents),
              Number(line.effective_unit_price_cents),
              quantity,
              discount,
              gross,
              applied.basisPoints,
              fixedFeeCents,
              fee,
              net,
              String(line.currency).toUpperCase(),
              paidAt,
              applied.category || "standard",
              0,
            ),
    );
    if (houseRevenue) continue;
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'sale_earning',?,?,?,?,?,?,?,'Creator sale earning',?,?)`,
        )
        .bind(
          line.creator_id,
          net,
          String(line.currency).toUpperCase(),
          Number(order.id),
          Number(line.id),
          line.product_slug,
          nativeOrder ? lineAvailableAt : availableAt,
          awaitingStripeFee ? "held" : reserveDays ? "pending" : "available",
          key,
          paidAt,
        ),
    );
  }
  return statements;
}

export async function repairNativePaidOrderAccounting(database, orderId, options = {}) {
  const id = Number(orderId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Native accounting order ID is invalid.");
  const order = await database.prepare("SELECT id,catalog_source,payment_status,paid_at,currency FROM orders WHERE id=?").bind(id).first();
  if (!order || order.catalog_source !== "native_d1" || !["paid", "refunded", "disputed"].includes(order.payment_status)) {
    return { ready: false, repaired: false, reason: "native_paid_order_required" };
  }
  const policyRows = await rows(database.prepare(`
    SELECT id,creator_reserve_days_snapshot,creator_fee_basis_points_snapshot,
      creator_fixed_fee_cents_snapshot,creator_fee_policy_reason_snapshot,
      creator_commission_category_snapshot,creator_commission_policy_version_snapshot
    FROM order_items
    WHERE order_id=? AND catalog_source='native_d1' AND native_creator_id IS NOT NULL
      AND line_total_cents>0 AND COALESCE(creator_commission_category_snapshot,'') NOT IN ('owner','admin')
  `).bind(id));
  const missingPolicy = policyRows.filter(row => !Number.isInteger(row.creator_fee_basis_points_snapshot)
    || !Number.isInteger(row.creator_fixed_fee_cents_snapshot)
    || !Number.isInteger(row.creator_reserve_days_snapshot)
    || !row.creator_fee_policy_reason_snapshot
    || !row.creator_commission_category_snapshot
    || !row.creator_commission_policy_version_snapshot);
  if (missingPolicy.length) {
    return {
      ready: false,
      repaired: false,
      reason: "native_sale_policy_snapshot_missing",
      orderItemIds: missingPolicy.map(row => Number(row.id))
    };
  }
  const reserveDays = policyRows.length
    ? Number(policyRows[0].creator_reserve_days_snapshot)
    : resolveFeePolicy({}, Date.parse(order.paid_at || new Date().toISOString())).reserveDays;
  const statements = await creatorSaleStatements(database, order, {
    ...resolveFeePolicy({}, options.nowMs),
    reserveDays
  }, order.paid_at);
  const missingBefore = await rows(database.prepare(`
    SELECT oi.id FROM order_items oi
    LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id
    LEFT JOIN creator_earnings_ledger l ON l.order_item_id=oi.id AND l.entry_type='sale_earning'
    WHERE oi.order_id=? AND oi.catalog_source='native_d1' AND oi.native_creator_id IS NOT NULL
      AND oi.line_total_cents>0 AND COALESCE(oi.creator_commission_category_snapshot,'') NOT IN ('owner','admin')
      AND (s.id IS NULL OR l.id IS NULL)
  `).bind(id));
  if (statements.length) await database.batch(statements);
  const exceptions = await rows(database.prepare(`
    SELECT oi.id order_item_id FROM order_items oi
    LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id
    LEFT JOIN creator_earnings_ledger l ON l.order_item_id=oi.id AND l.entry_type='sale_earning'
    WHERE oi.order_id=? AND oi.catalog_source='native_d1' AND oi.native_creator_id IS NOT NULL
      AND oi.line_total_cents>0 AND COALESCE(oi.creator_commission_category_snapshot,'') NOT IN ('owner','admin')
      AND (s.id IS NULL OR l.id IS NULL)
  `).bind(id));
  return { ready: exceptions.length === 0, repaired: missingBefore.length > 0 && statements.length > 0, reason: exceptions.length ? "native_sale_accounting_incomplete" : null };
}

export async function recordOrderReversal(
  database,
  {
    orderId,
    type = "refund_reversal",
    amountCents = null,
    eventId,
    createdAt = new Date().toISOString(),
  },
) {
  if (
    !["refund_reversal", "chargeback_reversal"].includes(type) ||
    !String(eventId || "").trim()
  )
    throw new Error("Invalid reversal type or event ID.");
  if (
    await database
      .prepare(
        "SELECT id FROM creator_reversal_snapshots WHERE provider_event_id=? LIMIT 1",
      )
      .bind(String(eventId))
      .first()
  )
    return [];
  const sales = await rows(
      database
        .prepare(
          "SELECT * FROM creator_sale_snapshots WHERE order_id=? ORDER BY id",
        )
        .bind(Number(orderId)),
    ),
    entries = [],
    statements = [];
  let remaining = Number.isInteger(amountCents)
    ? amountCents
    : sales.reduce((sum, row) => sum + Number(row.gross_cents), 0);
  for (const sale of sales) {
    if (remaining <= 0) break;
    const prior = await database
        .prepare(
          "SELECT COALESCE(SUM(gross_reversed_cents),0) gross,COALESCE(SUM(creator_net_reversed_cents),0) creator_net FROM creator_reversal_snapshots WHERE order_item_id=?",
        )
        .bind(Number(sale.order_item_id))
        .first(),
      refundable = Math.max(
        0,
        Number(sale.gross_cents) - Number(prior?.gross || 0),
      ),
      reversedGross = Math.min(remaining, refundable);
    if (!reversedGross) continue;
    const cumulativeGross = Number(prior?.gross || 0) + reversedGross,
      cumulativeCreatorTarget = cumulativeAllocation(
        Number(sale.creator_net_cents),
        Number(sale.gross_cents),
        cumulativeGross,
      ),
      reversedNet = cumulativeCreatorTarget - Number(prior?.creator_net || 0),
      key = `${type}:${eventId}:${sale.order_item_id}`;
    if (
      reversedNet < 0 ||
      reversedNet > reversedGross ||
      reversedNet >
        Number(sale.creator_net_cents) - Number(prior?.creator_net || 0)
    )
      throw new Error("Reversal exceeds the remaining Creator allocation.");
    statements.push(
      database
        .prepare(
          "INSERT INTO creator_reversal_snapshots(order_id,order_item_id,creator_id,reversal_type,gross_reversed_cents,creator_net_reversed_cents,currency,provider_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          Number(orderId),
          Number(sale.order_item_id),
          sale.creator_id,
          type,
          reversedGross,
          reversedNet,
          sale.currency,
          String(eventId),
          createdAt,
        ),
      database
        .prepare(
          `INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,'Payment reversal',?,?)`,
        )
        .bind(
          sale.creator_id,
          type,
          -reversedNet,
          sale.currency,
          Number(orderId),
          Number(sale.order_item_id),
          sale.product_slug,
          createdAt,
          "available",
          key,
          createdAt,
        ),
    );
    entries.push({ creatorId: sale.creator_id, amountCents: -reversedNet });
    remaining -= reversedGross;
  }
  if (remaining > 0)
    throw new Error("Reversal exceeds the remaining original transaction.");
  if (statements.length) await database.batch(statements);
  return entries;
}

function cumulativeAllocation(originalAmount, originalGross, cumulativeGross) {
  if (
    !Number.isInteger(originalAmount) ||
    !Number.isInteger(originalGross) ||
    !Number.isInteger(cumulativeGross) ||
    originalAmount < 0 ||
    originalGross <= 0 ||
    cumulativeGross < 0 ||
    cumulativeGross > originalGross
  )
    throw new Error("Cumulative reversal allocation is invalid.");
  if (cumulativeGross === originalGross) return originalAmount;
  return Math.round((originalAmount * cumulativeGross) / originalGross);
}

export async function getCreatorFinance(
  database,
  creatorId,
  { from = "", to = "", nowMs = Date.now() } = {},
) {
  const where = ["creator_id=?"],
    bind = [creatorId],
    saleWhere = ["s.creator_id=?"],
    saleBind = [creatorId];
  if (from) {
    where.push("created_at>=?");
    bind.push(from);
    saleWhere.push("s.sold_at>=?");
    saleBind.push(from);
  }
  if (to) {
    where.push("created_at<?");
    bind.push(to);
    saleWhere.push("s.sold_at<?");
    saleBind.push(to);
  }
  const entries = await rows(
      database
        .prepare(
          `SELECT id,entry_type,amount_cents,currency,order_id,product_slug,available_at,payout_state,reason,created_at FROM creator_earnings_ledger WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id DESC`,
        )
        .bind(...bind),
    ),
    sales = await rows(
      database
        .prepare(
          `SELECT s.product_slug,s.product_title,s.quantity,s.gross_cents,s.marketplace_fee_cents,s.creator_net_cents,s.currency,s.sold_at,
             COALESCE(a.creator_absorbed_fee_cents,0) processing_fee_cents,
             s.creator_net_cents-COALESCE(a.creator_absorbed_fee_cents,0) creator_net_after_processing_fee_cents,
             CASE WHEN f.status='reconciled' THEN 'reconciled' ELSE 'pending_fee_reconciliation' END processing_fee_status
           FROM creator_sale_snapshots s LEFT JOIN stripe_order_fee_allocations a ON a.order_item_id=s.order_item_id
           LEFT JOIN stripe_order_fee_reconciliations f ON f.order_id=s.order_id
           WHERE ${saleWhere.join(" AND ")} AND s.account_category NOT IN ('owner','admin') ORDER BY s.sold_at,s.id`,
        )
        .bind(...saleBind),
    ),
    result = summarize(entries, new Date(nowMs).toISOString()),
    liability = await getCreatorLiability(database, creatorId, { nowMs });
  result.summary.grossSalesCents = sales.reduce(
    (sum, row) => sum + Number(row.gross_cents),
    0,
  );
  result.summary.marketplaceFeesCents = sales.reduce(
    (sum, row) => sum + Number(row.marketplace_fee_cents),
    0,
  );
  result.summary.processingFeesCents = sales.reduce((sum, row) => sum + Number(row.processing_fee_cents || 0), 0);
  result.summary.creatorNetAfterProcessingFeesCents = sales.reduce((sum, row) => sum + Number(row.creator_net_after_processing_fee_cents || 0), 0);
  result.summary.unitsSold = sales.reduce(
    (sum, row) => sum + Number(row.quantity),
    0,
  );
  result.liability = liability;
  if (!from && !to) {
    result.summary.unpaidBalanceCents = liability.currentNetLiabilityCents;
    result.summary.availableBalanceCents = liability.payoutEligibleCents;
    result.summary.negativeBalanceCents = liability.negativeBalanceCents;
    result.summary.onHoldCents =
      liability.heldBalanceCents + liability.disputeHeldCents;
  }
  result.sales = sales;
  return result;
}
export async function getOperatorFinance(
  database,
  { nowMs = Date.now() } = {},
) {
  const creators = await rows(
      database.prepare(
        "SELECT id,slug,display_name,payout_profile_status,tax_document_required FROM marketplace_creators ORDER BY display_name",
      ),
    ),
    balances = [];
  for (const creator of creators) {
    const finance = await getCreatorFinance(database, creator.id, { nowMs }),
      last = await database
        .prepare(
          "SELECT paid_at,amount_cents,reference FROM creator_payouts WHERE creator_id=? AND status='paid' ORDER BY paid_at DESC LIMIT 1",
        )
        .bind(creator.id)
        .first();
    balances.push({ ...creator, ...finance.summary, lastPayout: last || null });
  }
  let house;
  try {
    house = await database
      .prepare(
        `SELECT
           COALESCE((SELECT SUM(s.gross_cents) FROM creator_sale_snapshots s JOIN orders o ON o.id=s.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE s.account_category_verified=1 AND s.account_category IN ('owner','admin') AND o.payment_status IN ('paid','refunded','disputed') AND b.id IS NULL),0)
           -COALESCE((SELECT SUM(r.gross_reversed_cents) FROM creator_reversal_snapshots r JOIN creator_sale_snapshots s ON s.order_item_id=r.order_item_id JOIN orders o ON o.id=r.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE s.account_category_verified=1 AND s.account_category IN ('owner','admin') AND b.id IS NULL),0)
           +COALESCE((SELECT SUM(oi.line_total_cents) FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published' WHERE o.payment_status IN ('paid','refunded','disputed') AND s.id IS NULL AND COALESCE(oi.native_creator_id,cl.creator_id,cb.creator_id) IS NULL),0) revenue`,
      )
      .first();
  } catch {
    // Keep legacy-only finance reports usable against databases predating native
    // D1 order-item columns; current schema reports include native attribution.
    house = await database
      .prepare(
        `SELECT COALESCE(SUM(oi.line_total_cents),0) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id
         LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id
         LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug
         LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published'
         WHERE o.payment_status IN ('paid','refunded','disputed') AND s.id IS NULL
           AND COALESCE(cl.creator_id,cb.creator_id) IS NULL`,
      )
      .first();
  }
  let unclassified = { gross: 0, count: 0 };
  try { unclassified = await database.prepare("SELECT COALESCE(SUM(gross_cents),0) gross,COUNT(*) count FROM creator_sale_snapshots WHERE account_category_verified=0").first(); } catch {}
  return {
    balances,
    houseRevenueCents: Number(house?.revenue || 0),
    unclassifiedHistoricalSaleGrossCents: Number(unclassified?.gross || 0),
    unclassifiedHistoricalSaleCount: Number(unclassified?.count || 0),
    reconciliation: await reconcileCreatorFinance(database),
  };
}
export async function recordManualPayout(database, input) {
  const creatorId = String(input.creatorId || ""),
    currency = String(input.currency || "USD").toUpperCase(),
    amount = Number(input.amountCents),
    now = String(input.paidAt || new Date().toISOString()),
    authorizationNowMs = Number.isFinite(input.nowMs)
      ? Number(input.nowMs)
      : Date.now(),
    key = String(input.idempotencyKey || "").trim(),
    actor = String(input.operatorActor || "");
  if (
    !creatorId ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    currency.length !== 3 ||
    !key ||
    !actor
  )
    throw new Error("Payout fields are invalid.");
  let requestId = String(input.payoutRequestId || "");
  const exactLinkage = await payoutCompletionLinkageAvailable(database);
  const existingPayout = await database
    .prepare(
      exactLinkage
        ? "SELECT id,creator_id,amount_cents,currency,payout_request_id FROM creator_payouts WHERE idempotency_key=?"
        : "SELECT id,creator_id,amount_cents,currency FROM creator_payouts WHERE idempotency_key=?",
    )
    .bind(key)
    .first();
  if (existingPayout) {
    if (
      existingPayout.creator_id !== creatorId ||
      Number(existingPayout.amount_cents) !== amount ||
      existingPayout.currency !== currency ||
      (exactLinkage &&
        requestId &&
        existingPayout.payout_request_id !== requestId)
    )
      throw new Error("Payout idempotency key conflicts with another payout.");
    return {
      payoutId: existingPayout.id,
      payoutRequestId: existingPayout.payout_request_id || requestId,
      amountCents: amount,
      idempotent: true,
    };
  }
  if (!requestId) {
    const amountPolicyLiability = await getCreatorLiability(
      database,
      creatorId,
      { currency, nowMs: authorizationNowMs },
    );
    assertOrdinaryPayoutAmount(
      amount,
      amountPolicyLiability.payoutEligibleCents,
    );
  }
  const reservationsAvailable =
    await payoutReservationSchemaAvailable(database);
  let completion;
  if (requestId && reservationsAvailable) {
    completion = await getPayoutCompletionCapacity(database, {
      payoutRequestId: requestId,
      creatorId,
      nowMs: authorizationNowMs,
    });
    if (completion.reservedAmountCents !== amount)
      throw new Error("A matching active payout reservation is required.");
  } else if (reservationsAvailable) {
    const reserved = await reserveCreatorPayout(database, {
      creatorId,
      amountCents: amount,
      currency,
      requestId: crypto.randomUUID(),
      nowMs: authorizationNowMs,
    });
    requestId = reserved.requestId;
    completion = await getPayoutCompletionCapacity(database, {
      payoutRequestId: requestId,
      creatorId,
      nowMs: authorizationNowMs,
    });
  }
  if (reservationsAvailable && !completion.completionSafe)
    throw new Error(
      "Reserved payout completion is blocked by current holds or financial obligations.",
    );
  if (!reservationsAvailable) {
    const liability = await getCreatorLiability(database, creatorId, {
      currency,
      nowMs: authorizationNowMs,
    });
    if (liability.rawPayoutReservationCapacityCents < amount)
      throw new Error("Payout exceeds current canonical Creator liability.");
  }
  const payoutId = crypto.randomUUID(),
    reason = String(input.reference || "").slice(0, 200),
    note = String(input.note || "").slice(0, 1000);
  const statements = [
    database
      .prepare(
        exactLinkage
          ? "INSERT INTO creator_payouts(id,creator_id,amount_cents,currency,reference,note,idempotency_key,operator_actor,paid_at,created_at,payout_request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
          : "INSERT INTO creator_payouts(id,creator_id,amount_cents,currency,reference,note,idempotency_key,operator_actor,paid_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        payoutId,
        creatorId,
        amount,
        currency,
        reason,
        note,
        key,
        actor,
        now,
        now,
        ...(exactLinkage ? [requestId] : []),
      ),
  ];
  if (!exactLinkage)
    statements.push(
      database
        .prepare(
          `INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,operator_actor,idempotency_key,created_at) VALUES(?,'payout',?,?,?,'paid',?,?,?,?)`,
        )
        .bind(
          creatorId,
          -amount,
          currency,
          now,
          `Payout: ${reason}`,
          actor,
          `payout:${key}`,
          now,
        ),
    );
  if (reservationsAvailable)
    if (!exactLinkage)
      statements.push(
        database
          .prepare(
            "UPDATE creator_payout_requests SET status='paid',resolved_at=? WHERE id=? AND status IN ('pending','processing')",
          )
          .bind(now, requestId),
        database
          .prepare(
            "UPDATE creator_payout_reservations SET status='consumed',resolved_at=? WHERE payout_request_id=? AND status='reserved'",
          )
          .bind(now, requestId),
      );
  if (!exactLinkage)
    statements.push(
      database
        .prepare(
          "INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,amount_cents,currency,context_json,created_at) VALUES(?,'operator',?,'payout_recorded',?,?,?,?)",
        )
        .bind(
          creatorId,
          actor,
          amount,
          currency,
          JSON.stringify({ payoutId, requestId, reference: reason }),
          now,
        ),
    );
  await database.batch(statements);
  return { payoutId, payoutRequestId: requestId, amountCents: amount };
}
export async function recordManualAdjustment(database, input) {
  const creatorId = String(input.creatorId || ""),
    amount = Number(input.amountCents),
    currency = String(input.currency || "USD").toUpperCase(),
    actor = String(input.operatorActor || ""),
    reason = String(input.reason || "")
      .trim()
      .slice(0, 1000),
    key = String(input.idempotencyKey || "").trim(),
    now = String(input.createdAt || new Date().toISOString());
  if (
    !creatorId ||
    !Number.isInteger(amount) ||
    !amount ||
    currency.length !== 3 ||
    !actor ||
    !reason ||
    !key
  )
    throw new Error("Adjustment fields are invalid.");
  await database.batch([
    database
      .prepare(
        `INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,operator_actor,idempotency_key,created_at) VALUES(?,'manual_adjustment',?,?,?,'available',?,?,?,?)`,
      )
      .bind(
        creatorId,
        amount,
        currency,
        now,
        reason,
        actor,
        `adjustment:${key}`,
        now,
      ),
    database
      .prepare(
        "INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,amount_cents,currency,context_json,created_at) VALUES(?,'operator',?,'manual_adjustment',?,?,?,?)",
      )
      .bind(
        creatorId,
        actor,
        amount,
        currency,
        JSON.stringify({ reason }),
        now,
      ),
  ]);
  return { amountCents: amount };
}
export async function setCreatorLedgerHold(database, input) {
  const creatorId = String(input.creatorId || ""),
    held = Boolean(input.held),
    actor = String(input.operatorActor || ""),
    reason = String(input.reason || "")
      .trim()
      .slice(0, 1000),
    now = String(input.createdAt || new Date().toISOString());
  if (!creatorId || !actor || !reason)
    throw new Error("Hold fields are invalid.");
  await database.batch([
    database
      .prepare(
        "UPDATE creator_earnings_ledger SET payout_state=CASE WHEN ?=1 THEN 'held' WHEN available_at<=? THEN 'available' ELSE 'pending' END WHERE creator_id=? AND entry_type<>'payout' AND payout_state IN ('pending','available','held')",
      )
      .bind(held ? 1 : 0, now, creatorId),
    database
      .prepare(
        "INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,'operator',?,?,?,?)",
      )
      .bind(
        creatorId,
        actor,
        held ? "hold_applied" : "hold_released",
        JSON.stringify({ reason }),
        now,
      ),
  ]);
  return { held };
}
export async function reconcileCreatorFinance(database) {
  const exceptions = [];
  let missing;
  try {
    missing = await rows(
      database.prepare(
        `SELECT oi.order_id,oi.id order_item_id,oi.product_slug,
                CASE WHEN oi.catalog_source='native_d1' THEN oi.native_creator_id ELSE COALESCE(cl.creator_id,cb.creator_id) END creator_id
         FROM order_items oi JOIN orders o ON o.id=oi.order_id
         LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug
         LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published'
         LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id
         WHERE o.payment_status IN ('paid','refunded','disputed') AND oi.line_total_cents>0 AND s.id IS NULL
           AND ((oi.catalog_source='native_d1' AND oi.native_creator_id IS NOT NULL AND COALESCE(o.native_order_state,'')<>'free_acquired')
             OR (oi.catalog_source<>'native_d1' AND COALESCE(cl.creator_id,cb.creator_id) IS NOT NULL))`,
      ),
    );
  } catch {
    missing = await rows(database.prepare(
      `SELECT oi.order_id,oi.id order_item_id,oi.product_slug,COALESCE(cl.creator_id,cb.creator_id) creator_id
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
       LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug OR cl.public_product_slug=oi.product_slug
       LEFT JOIN creator_bundles cb ON cb.public_bundle_slug=oi.product_slug AND cb.publication_state='published'
       LEFT JOIN creator_sale_snapshots s ON s.order_item_id=oi.id
       WHERE o.payment_status IN ('paid','refunded','disputed') AND s.id IS NULL
         AND COALESCE(cl.creator_id,cb.creator_id) IS NOT NULL`,
    ));
  }
  for (const row of missing)
    exceptions.push({ code: "paid_line_missing_sale", ...row });
  const missingLedger = await rows(
    database.prepare(
      `SELECT s.order_id,s.order_item_id,s.product_slug FROM creator_sale_snapshots s LEFT JOIN creator_earnings_ledger l ON l.order_item_id=s.order_item_id AND l.entry_type='sale_earning' WHERE s.account_category_verified=1 AND s.account_category NOT IN ('owner','admin') AND l.id IS NULL`,
    ),
  );
  for (const row of missingLedger)
    exceptions.push({ code: "paid_line_missing_sale_ledger", ...row });
  let unverifiedCategories = [];
  try { unverifiedCategories = await rows(database.prepare(`
    SELECT order_id,order_item_id,product_slug,creator_id,gross_cents,account_category
    FROM creator_sale_snapshots WHERE account_category_verified=0 ORDER BY order_id,order_item_id
  `)); } catch { /* Migration 076 has not been applied to this isolated legacy schema. */ }
  for (const row of unverifiedCategories)
    exceptions.push({ code: "historical_sale_category_unverified", ...row });
  let nativePolicyMissing = [];
  try { nativePolicyMissing = await rows(database.prepare(`
    SELECT oi.order_id,oi.id order_item_id,oi.product_slug,oi.native_creator_id creator_id
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.catalog_source='native_d1' AND oi.native_creator_id IS NOT NULL
      AND oi.line_total_cents>0 AND o.payment_status IN ('paid','refunded','disputed')
      AND COALESCE(oi.creator_commission_category_snapshot,'') NOT IN ('owner','admin')
      AND (oi.creator_fee_basis_points_snapshot IS NULL OR oi.creator_fixed_fee_cents_snapshot IS NULL
        OR oi.creator_reserve_days_snapshot IS NULL OR oi.creator_fee_policy_reason_snapshot IS NULL)
  `)); } catch { /* This database predates native order-item snapshots. */ }
  for (const row of nativePolicyMissing)
    exceptions.push({ code: "native_sale_policy_snapshot_missing", ...row });
  let pendingFees = [];
  try { pendingFees = await rows(database.prepare(`
    SELECT r.order_id,r.payment_intent_id,r.status,r.created_at,o.public_id order_reference,
      (SELECT COUNT(*) FROM creator_earnings_ledger l WHERE l.order_id=r.order_id AND l.entry_type='sale_earning' AND l.payout_state='held') held_creator_earnings
    FROM stripe_order_fee_reconciliations r JOIN orders o ON o.id=r.order_id
    WHERE r.status<>'reconciled' ORDER BY r.created_at,r.order_id
  `)); } catch {}
  for (const row of pendingFees) exceptions.push({ code: "stripe_processing_fee_reconciliation_pending", ...row });
  let feeAllocationMismatches = [];
  try { feeAllocationMismatches = await rows(database.prepare(`
    SELECT r.order_id,r.processing_fee_cents,COALESCE(SUM(a.processing_fee_cents),0)+r.non_product_processing_fee_cents allocated_fee_cents
    FROM stripe_order_fee_reconciliations r LEFT JOIN stripe_order_fee_allocations a ON a.order_id=r.order_id
    WHERE r.status='reconciled' GROUP BY r.order_id
    HAVING allocated_fee_cents<>r.processing_fee_cents
  `)); } catch {}
  for (const row of feeAllocationMismatches) exceptions.push({ code: "stripe_processing_fee_allocation_mismatch", ...row });
  let nativeMismatches = [];
  try { nativeMismatches = await rows(database.prepare(`
    SELECT s.order_id,s.order_item_id,s.product_slug,s.creator_id snapshot_creator_id,
      oi.native_creator_id item_creator_id,s.gross_cents,s.marketplace_fee_cents,s.creator_net_cents,
      oi.line_total_cents,oi.currency
    FROM creator_sale_snapshots s JOIN order_items oi ON oi.id=s.order_item_id
    WHERE oi.catalog_source='native_d1' AND (
      s.creator_id<>oi.native_creator_id OR s.gross_cents<>oi.line_total_cents
      OR upper(s.currency)<>upper(oi.currency)
      OR s.marketplace_fee_cents+s.creator_net_cents<>s.gross_cents
      OR s.fee_basis_points<>oi.creator_fee_basis_points_snapshot
      OR s.fixed_fee_cents<>oi.creator_fixed_fee_cents_snapshot
      OR s.policy_reason<>oi.creator_fee_policy_reason_snapshot
    )
  `)); } catch { /* This database predates native order-item snapshots. */ }
  for (const row of nativeMismatches)
    exceptions.push({ code: "native_sale_snapshot_mismatch", ...row });
  const missingReversal = await rows(
    database.prepare(
      `SELECT DISTINCT o.id order_id,o.payment_status FROM orders o JOIN creator_sale_snapshots s ON s.order_id=o.id LEFT JOIN creator_reversal_snapshots r ON r.order_id=o.id WHERE o.payment_status IN ('refunded','disputed') AND r.id IS NULL`,
    ),
  );
  for (const row of missingReversal)
    exceptions.push({
      code:
        row.payment_status === "disputed"
          ? "chargeback_missing_reversal"
          : "refund_missing_reversal",
      ...row,
    });
  const duplicates = await rows(
    database.prepare(
      "SELECT order_item_id,COUNT(*) count FROM creator_earnings_ledger WHERE entry_type='sale_earning' GROUP BY order_item_id HAVING COUNT(*)>1",
    ),
  );
  for (const row of duplicates)
    exceptions.push({ code: "duplicate_sale_entry", ...row });
  const negative = await rows(
    database.prepare(
      "SELECT creator_id,currency,SUM(amount_cents) balance FROM creator_earnings_ledger GROUP BY creator_id,currency HAVING SUM(amount_cents)<0",
    ),
  );
  for (const row of negative)
    exceptions.push({ code: "negative_creator_balance", ...row });
  const orphans = await rows(
    database.prepare(
      "SELECT l.id FROM creator_earnings_ledger l LEFT JOIN orders o ON o.id=l.order_id WHERE l.order_id IS NOT NULL AND o.id IS NULL",
    ),
  );
  for (const row of orphans)
    exceptions.push({ code: "ledger_missing_order", ...row });
  try {
    const unpairedPayouts = await rows(
      database.prepare(
        "SELECT p.id payout_id,p.payout_request_id FROM creator_payouts p LEFT JOIN creator_payout_requests q ON q.id=p.payout_request_id LEFT JOIN creator_payout_reservations r ON r.payout_request_id=p.payout_request_id LEFT JOIN creator_earnings_ledger l ON l.payout_id=p.id AND l.payout_request_id=p.payout_request_id AND l.entry_type='payout' WHERE p.status='paid' AND (p.payout_request_id IS NULL OR COALESCE(q.status,'')<>'paid' OR COALESCE(r.status,'')<>'consumed' OR l.id IS NULL OR l.amount_cents<>-p.amount_cents)",
      ),
    );
    for (const row of unpairedPayouts)
      exceptions.push({ code: "completed_payout_integrity_mismatch", ...row });
    const orphanPayoutLedger = await rows(
      database.prepare(
        "SELECT l.id ledger_id,l.payout_id,l.payout_request_id FROM creator_earnings_ledger l LEFT JOIN creator_payouts p ON p.id=l.payout_id AND p.payout_request_id=l.payout_request_id WHERE l.entry_type='payout' AND (l.payout_id IS NULL OR l.payout_request_id IS NULL OR p.id IS NULL)",
      ),
    );
    for (const row of orphanPayoutLedger)
      exceptions.push({ code: "payout_ledger_integrity_mismatch", ...row });
  } catch (error) {
    if (!/no such column|no such table/i.test(String(error))) throw error;
  }
  return exceptions;
}
export function statementCsv(creator, period, finance) {
  const lines = [
    ["Creator", creator.display_name],
    ["Period", `${period.from} through ${period.to}`],
    [],
    ["Product sales"],
    [
      "Date",
      "Product",
      "Quantity",
      "Gross cents",
      "Marketplace fee cents",
      "Creator net cents",
      "Currency",
    ],
  ];
  for (const sale of finance.sales || [])
    lines.push([
      sale.sold_at,
      sale.product_title,
      sale.quantity,
      sale.gross_cents,
      sale.marketplace_fee_cents,
      sale.creator_net_cents,
      sale.currency,
    ]);
  lines.push(
    [],
    ["Ledger activity"],
    ["Date", "Type", "Product", "Amount cents", "Currency", "Reason"],
  );
  for (const entry of finance.entries)
    lines.push([
      entry.created_at,
      entry.entry_type,
      entry.product_slug || "",
      entry.amount_cents,
      entry.currency,
      entry.reason,
    ]);
  lines.push(
    [],
    ["Closing unpaid balance", finance.summary.unpaidBalanceCents, "cents"],
  );
  return lines.map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n";
}
function summarize(entries, now) {
  const gross = entries
      .filter((e) => e.entry_type === "sale_earning")
      .reduce((s, e) => s + Number(e.amount_cents), 0),
    reversals = entries
      .filter((e) =>
        ["refund_reversal", "chargeback_reversal"].includes(e.entry_type),
      )
      .reduce((s, e) => s + Number(e.amount_cents), 0),
    payouts = -entries
      .filter((e) => e.entry_type === "payout")
      .reduce((s, e) => s + Number(e.amount_cents), 0),
    unpaid = entries.reduce((s, e) => s + Number(e.amount_cents), 0),
    available = entries
      .filter((e) => e.payout_state !== "held" && e.available_at <= now)
      .reduce((s, e) => s + Number(e.amount_cents), 0);
  return {
    summary: {
      creatorNetSalesCents: gross,
      refundsAndAdjustmentsCents: reversals,
      unpaidBalanceCents: unpaid,
      availableBalanceCents: Math.max(0, available),
      negativeBalanceCents: Math.max(0, -available),
      onHoldCents: Math.max(0, unpaid - available),
      paidBalanceCents: payouts,
      lifetimeEarningsCents: gross + reversals,
    },
    entries,
  };
}
async function rows(statement) {
  const result = await statement.all();
  return result.results || [];
}
