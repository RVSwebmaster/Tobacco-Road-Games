import { getEffectiveFeePolicy } from "./creator-finance.mjs";
import { resolveSalePolicy } from "./marketplace-policy.mjs";
export async function getCreatorBalance(
  db,
  { creatorId, userId, currency = "USD", nowMs = Date.now() } = {},
) {
  const owned = await db
    .prepare(
      "SELECT 1 ok FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=? AND account_status='active'",
    )
    .bind(creatorId, userId)
    .first();
  if (!owned) throw new Error("Creator ownership is required.");
  const now = new Date(nowMs).toISOString(),
    ledger = await db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN payout_state<>'held' AND available_at<=? THEN amount_cents ELSE 0 END),0) available,COALESCE(SUM(CASE WHEN payout_state='held' THEN amount_cents ELSE 0 END),0) held,COALESCE(SUM(CASE WHEN payout_state<>'held' AND available_at>? THEN amount_cents ELSE 0 END),0) pending FROM creator_earnings_ledger WHERE creator_id=? AND currency=?",
      )
      .bind(now, now, creatorId, currency)
      .first(),
    internal = await db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_balance_transactions WHERE creator_id=? AND currency=?",
      )
      .bind(creatorId, currency)
      .first(),
    payout = await db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_payout_reservations WHERE creator_id=? AND status='reserved'",
      )
      .bind(creatorId)
      .first(),
    purchase = await db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_balance_reservations WHERE creator_id=? AND currency=? AND state='reserved'",
      )
      .bind(creatorId, currency)
      .first(),
    raw =
      Number(ledger?.available || 0) +
      Number(internal?.amount || 0) -
      Number(payout?.amount || 0) -
      Number(purchase?.amount || 0);
  return {
    creatorId,
    currency,
    availableCents: Math.max(0, raw),
    pendingCents: Math.max(0, Number(ledger?.pending || 0)),
    heldCents: Math.max(0, Number(ledger?.held || 0)),
    payoutReservedCents: Number(payout?.amount || 0),
    purchaseReservedCents: Number(purchase?.amount || 0),
    negativeCents: Math.max(0, -raw),
    spendable: raw > 0,
  };
}

export async function settleCreatorBalancePurchase(
  db,
  {
    buyerCreatorId,
    buyerUserId,
    checkoutAttemptId,
    orderPublicId,
    email,
    emailHash,
    currency = "USD",
    items,
    deliveryMappings,
    nowMs = Date.now(),
    env = {},
  } = {},
) {
  if (
    !Array.isArray(items) ||
    !items.length ||
    !Array.isArray(deliveryMappings) ||
    deliveryMappings.length !== items.length
  )
    throw new Error("A complete product purchase is required.");
  const total = items.reduce((n, x) => n + Number(x.lineTotalCents), 0);
  if (!Number.isInteger(total) || total <= 0)
    throw new Error("Creator Balance purchases require a positive full total.");
  const existing = await db
    .prepare(
      "SELECT s.*,o.public_id FROM creator_balance_settlements s JOIN orders o ON o.id=s.order_id WHERE o.checkout_attempt_id=?",
    )
    .bind(checkoutAttemptId)
    .first();
  if (existing)
    return {
      orderId: existing.order_id,
      publicOrderReference: existing.public_id,
      totalCents: existing.gross_cents,
      idempotent: true,
    };
  const balance = await getCreatorBalance(db, {
    creatorId: buyerCreatorId,
    userId: buyerUserId,
    currency,
    nowMs,
  });
  if (balance.availableCents < total)
    throw new Error(
      "Available Creator Balance does not cover the full purchase. Split tender is not available.",
    );
  const now = new Date(nowMs).toISOString(),
    policy = await getEffectiveFeePolicy(db, env, nowMs),
    checkoutRequestHash = await sha256(`creator-balance:${checkoutAttemptId}`),
    reservationId = crypto.randomUUID(),
    debitId = crypto.randomUUID(),
    settlementId = crypto.randomUUID(),
    statements = [];
  let totalFee = 0,
    totalNet = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index],
      listing = await db
        .prepare(
          "SELECT id,creator_id,first_published_at FROM creator_listings WHERE source_product_slug=? OR public_product_slug=? LIMIT 1",
        )
        .bind(item.productSlug, item.productSlug)
        .first();
    if (!listing)
      throw new Error("A cart product is not mapped to a Creator listing.");
    const applied = await resolveSalePolicy(db, {
        creatorId: listing.creator_id,
        firstPublishedAt: listing.first_published_at,
        nowMs,
      }),
      gross = Number(item.lineTotalCents),
      fee = Math.min(
        gross,
        Math.round((gross * applied.basisPoints) / 10000) +
          policy.fixedLineFeeCents,
      ),
      net = gross - fee;
    totalFee += fee;
    totalNet += net;
    item._finance = { listing, applied, gross, fee, net, index };
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO creator_balance_reservations(id,creator_id,user_id,amount_cents,currency,purpose,checkout_attempt_id,state,order_public_id,created_at) VALUES(?,?,?,?,?,'product_purchase',?,'reserved',?,?)",
      )
      .bind(
        reservationId,
        buyerCreatorId,
        buyerUserId,
        total,
        currency,
        checkoutAttemptId,
        orderPublicId,
        now,
      ),
    db
      .prepare(
        "INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,user_id,checkout_attempt_id,checkout_request_hash,checkout_session_status,checkout_updated_at,processor_fee_cents,net_proceeds_cents,paid_at,created_at,payment_source,settlement_method) VALUES(?,?,?,?,?,?,?,'paid','ready','pending',?,?,?,'legacy',?,0,?,?,?,'creator_balance','internal_ledger')",
      )
      .bind(
        orderPublicId,
        email,
        email,
        emailHash,
        currency,
        total,
        total,
        buyerUserId,
        checkoutAttemptId,
        checkoutRequestHash,
        now,
        total - totalFee,
        now,
        now,
      ),
  );
  for (const item of items) {
    const f = item._finance,
      map = deliveryMappings[f.index];
    statements.push(
      db
        .prepare(
          "INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES((SELECT id FROM orders WHERE public_id=?),?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          orderPublicId,
          item.productSlug,
          item.productTitleSnapshot,
          item.primaryAuthorSlug || "",
          item.authorSlugsJson || "[]",
          item.quantity,
          item.listPriceCents,
          item.effectiveUnitPriceCents,
          item.lineTotalCents,
          currency,
          item.versionSnapshot || "",
          item.lastUpdatedSnapshot || "",
          now,
        ),
      db
        .prepare(
          "INSERT INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at,product_identity_id,policy_reason) SELECT o.id,oi.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.product_slug=? WHERE o.public_id=?",
        )
        .bind(
          f.listing.creator_id,
          item.productSlug,
          item.productTitleSnapshot,
          item.listPriceCents,
          item.effectiveUnitPriceCents,
          item.quantity,
          Math.max(0, item.listPriceCents * item.quantity - f.gross),
          f.gross,
          f.applied.basisPoints,
          policy.fixedLineFeeCents,
          f.fee,
          f.net,
          currency,
          now,
          f.listing.id,
          f.applied.reason,
          item.productSlug,
          orderPublicId,
        ),
      db
        .prepare(
          "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) SELECT ?,'sale_earning',?,?,o.id,oi.id,?,?,?,'Internal Creator Balance sale',?,? FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.product_slug=? WHERE o.public_id=?",
        )
        .bind(
          f.listing.creator_id,
          f.net,
          currency,
          item.productSlug,
          new Date(nowMs + policy.reserveDays * 86400000).toISOString(),
          policy.reserveDays ? "pending" : "available",
          `sale:balance:${checkoutAttemptId}:${item.productSlug}`,
          now,
          item.productSlug,
          orderPublicId,
        ),
      db
        .prepare(
          "INSERT INTO marketplace_internal_commission_ledger(order_id,order_item_id,entry_type,amount_cents,currency,idempotency_key,created_at) SELECT o.id,oi.id,'commission',?,?,?,? FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.product_slug=? WHERE o.public_id=?",
        )
        .bind(
          f.fee,
          currency,
          `commission:${checkoutAttemptId}:${item.productSlug}`,
          now,
          item.productSlug,
          orderPublicId,
        ),
      db
        .prepare(
          "INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at) SELECT o.id,oi.id,?,?,?,?,?,'active',? FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.product_slug=? WHERE o.public_id=?",
        )
        .bind(
          item.productSlug,
          map.r2ObjectKey,
          map.customerFilename,
          map.contentType,
          map.objectSize,
          now,
          item.productSlug,
          orderPublicId,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO creator_balance_transactions(id,creator_id,user_id,transaction_type,amount_cents,currency,order_id,reservation_id,idempotency_key,description,created_at) VALUES(?,?,?,'purchase_debit',-?,?,(SELECT id FROM orders WHERE public_id=?),?,?,'Creator Balance product purchase',?)",
      )
      .bind(
        debitId,
        buyerCreatorId,
        buyerUserId,
        total,
        currency,
        orderPublicId,
        reservationId,
        `purchase:${checkoutAttemptId}`,
        now,
      ),
    db
      .prepare(
        "INSERT INTO creator_balance_settlements(id,order_id,order_public_id,buyer_creator_id,buyer_user_id,gross_cents,marketplace_commission_cents,seller_net_cents,currency,status,debit_transaction_id,settled_at) VALUES(?,(SELECT id FROM orders WHERE public_id=?),?,?,?,?,?,?,?,'settled',?,?)",
      )
      .bind(
        settlementId,
        orderPublicId,
        orderPublicId,
        buyerCreatorId,
        buyerUserId,
        total,
        totalFee,
        totalNet,
        currency,
        debitId,
        now,
      ),
    db
      .prepare(
        "UPDATE creator_balance_reservations SET state='consumed',resolved_at=? WHERE id=? AND state='reserved'",
      )
      .bind(now, reservationId),
    db
      .prepare(
        "INSERT INTO creator_balance_audit(actor_type,actor_id,action,creator_id,order_public_id,amount_cents,currency,context_json,created_at) VALUES('customer',?,'purchase_settled',?,?,?,?,?,?)",
      )
      .bind(
        buyerUserId,
        buyerCreatorId,
        orderPublicId,
        total,
        currency,
        JSON.stringify({
          commissionCents: totalFee,
          sellerNetCents: totalNet,
          paymentSource: "creator_balance",
        }),
        now,
      ),
  );
  await db.batch(statements);
  return {
    publicOrderReference: orderPublicId,
    totalCents: total,
    commissionCents: totalFee,
    sellerNetCents: totalNet,
    paymentProvider: "none",
    paymentSource: "creator_balance",
    settlementMethod: "internal_ledger",
  };
}

export async function refundCreatorBalancePurchase(
  db,
  { orderPublicId, actorId, nowMs = Date.now() } = {},
) {
  const settlement = await db
    .prepare(
      "SELECT s.*,o.payment_status FROM creator_balance_settlements s JOIN orders o ON o.id=s.order_id WHERE s.order_public_id=?",
    )
    .bind(orderPublicId)
    .first();
  if (
    !settlement ||
    settlement.status !== "settled" ||
    settlement.payment_status !== "paid"
  )
    throw new Error("Settled Creator Balance order not found.");
  const now = new Date(nowMs).toISOString(),
    refundId = crypto.randomUUID(),
    sales = await rows(
      db
        .prepare("SELECT * FROM creator_sale_snapshots WHERE order_id=?")
        .bind(settlement.order_id),
    ),
    statements = [];
  for (const sale of sales)
    statements.push(
      db
        .prepare(
          "INSERT INTO creator_reversal_snapshots(order_id,order_item_id,creator_id,reversal_type,gross_reversed_cents,creator_net_reversed_cents,currency,provider_event_id,created_at) VALUES(?,?,?,'refund_reversal',?,?,?,?,?)",
        )
        .bind(
          settlement.order_id,
          sale.order_item_id,
          sale.creator_id,
          sale.gross_cents,
          sale.creator_net_cents,
          sale.currency,
          `internal-refund:${orderPublicId}`,
          now,
        ),
      db
        .prepare(
          "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'refund_reversal',?,?,?,?,?,?,'available','Internal Creator Balance refund',?,?)",
        )
        .bind(
          sale.creator_id,
          -Number(sale.creator_net_cents),
          sale.currency,
          settlement.order_id,
          sale.order_item_id,
          sale.product_slug,
          now,
          `refund:balance:${orderPublicId}:${sale.order_item_id}`,
          now,
        ),
      db
        .prepare(
          "INSERT INTO marketplace_internal_commission_ledger(order_id,order_item_id,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,?,'commission_reversal',?,?,?,?)",
        )
        .bind(
          settlement.order_id,
          sale.order_item_id,
          -Number(sale.marketplace_fee_cents),
          sale.currency,
          `commission-refund:${orderPublicId}:${sale.order_item_id}`,
          now,
        ),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO creator_balance_transactions(id,creator_id,user_id,transaction_type,amount_cents,currency,order_id,idempotency_key,description,created_at) VALUES(?,?,?,'refund_credit',?,?,?,?,'Creator Balance internal refund',?)",
      )
      .bind(
        refundId,
        settlement.buyer_creator_id,
        settlement.buyer_user_id,
        settlement.gross_cents,
        settlement.currency,
        settlement.order_id,
        `refund:${orderPublicId}`,
        now,
      ),
    db
      .prepare(
        "UPDATE orders SET payment_status='refunded',refunded_at=?,fulfillment_status='canceled' WHERE id=?",
      )
      .bind(now, settlement.order_id),
    db
      .prepare(
        "UPDATE download_entitlements SET status='revoked',revoked_at=? WHERE order_id=? AND status='active'",
      )
      .bind(now, settlement.order_id),
    db
      .prepare(
        "UPDATE creator_balance_settlements SET status='refunded',refund_transaction_id=?,refunded_at=? WHERE id=?",
      )
      .bind(refundId, now, settlement.id),
    db
      .prepare(
        "INSERT INTO creator_balance_audit(actor_type,actor_id,action,creator_id,order_public_id,amount_cents,currency,context_json,created_at) VALUES('operator',?,'refund_reversed',?,?,?,?,?,?)",
      )
      .bind(
        actorId,
        settlement.buyer_creator_id,
        orderPublicId,
        settlement.gross_cents,
        settlement.currency,
        JSON.stringify({ stripeRefund: false }),
        now,
      ),
  );
  await db.batch(statements);
  return {
    orderPublicId,
    restoredCents: settlement.gross_cents,
    stripeRefund: false,
  };
}
async function rows(s) {
  const r = await s.all();
  return r.results || [];
}
async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
