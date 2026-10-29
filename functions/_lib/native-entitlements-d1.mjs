import { getNativeOrderItemSnapshots } from "./native-orders-d1.mjs";

export async function grantNativePaidOrderEntitlements(database, orderId, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return { entitlements: [], ready: false, result: "order_not_found" };
  const order = await database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (!order) return { entitlements: [], ready: false, result: "order_not_found" };
  if (order.catalog_source !== "native_d1") {
    return { entitlements: [], order, ready: false, result: "not_native_order" };
  }
  if (order.payment_status !== "paid" || order.native_order_state !== "paid") {
    return { entitlements: [], order, ready: false, result: "order_not_paid" };
  }
  if (order.payment_source !== "stripe" || order.settlement_method !== "external_provider"
    || !order.stripe_payment_intent_id) {
    return { entitlements: [], order, ready: false, result: "payment_not_authoritative" };
  }
  const items = await getNativeOrderItemSnapshots(database, id);
  if (!items.length || items.some(item => !isPaidNativeSnapshot(item))) {
    await markNativeEntitlementFailure(database, id, "native_entitlement_snapshot_invalid", options);
    throw new Error("The native paid-order entitlement snapshot is invalid.");
  }
  if (typeof database?.batch !== "function") {
    throw new Error("Native entitlement creation requires D1 transactional batch support.");
  }
  const createdAt = nowIso(options.nowMs);
  const acquiredAt = String(order.paid_at || createdAt);
  const statements = items.map(item => database.prepare(`
    INSERT OR IGNORE INTO native_product_entitlements(
      order_id,order_item_id,purchaser_user_id,purchaser_email_hash_snapshot,
      native_product_id,product_slug_snapshot,product_title_snapshot,native_creator_id,
      catalog_revision_snapshot,version_snapshot,pricing_model_snapshot,
      selected_price_cents_snapshot,currency_snapshot,entitlement_source,status,
      acquired_at,created_at
    )
    SELECT o.id,oi.id,o.user_id,o.customer_email_hash,
      oi.native_product_id,oi.product_slug,oi.product_title_snapshot,oi.native_creator_id,
      oi.catalog_revision,oi.version_snapshot,oi.pricing_model_snapshot,
      oi.selected_price_cents,oi.currency,'stripe_paid','active',?,?
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    WHERE o.id=? AND oi.id=?
      AND o.catalog_source='native_d1' AND o.native_order_state='paid'
      AND o.payment_status='paid' AND o.payment_source='stripe'
      AND o.settlement_method='external_provider' AND o.stripe_payment_intent_id IS NOT NULL
      AND oi.catalog_source='native_d1' AND oi.pricing_model_snapshot IN ('fixed','pwyw')
      AND oi.selected_price_cents > 0
  `).bind(acquiredAt, createdAt, id, Number(item.id)));
  statements.push(database.prepare(`
    UPDATE orders
    SET native_entitlement_status='ready',native_entitlement_failure_code=NULL,
        native_entitlement_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
      AND native_order_state='paid'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        LEFT JOIN native_product_entitlements npe
          ON npe.order_item_id=oi.id AND npe.order_id=oi.order_id AND npe.status='active'
        WHERE oi.order_id=orders.id AND oi.catalog_source='native_d1' AND npe.id IS NULL
      )
  `).bind(createdAt, id));
  await database.batch(statements);
  const entitlements = await getNativeOrderEntitlements(database, id);
  const repairedOrder = await database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (entitlements.length !== items.length || repairedOrder?.native_entitlement_status !== "ready") {
    await markNativeEntitlementFailure(database, id, "native_entitlement_reconciliation_failed", options);
    throw new Error("Native paid-order entitlements did not reconcile.");
  }
  return {
    entitlementCount: entitlements.length,
    entitlements,
    order: repairedOrder,
    ready: true,
    result: order.native_entitlement_status === "ready"
      ? "already_entitled"
      : "native_entitlements_ready"
  };
}

export async function getNativeOrderEntitlements(database, orderId, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return [];
  const activeClause = options.activeOnly ? " AND npe.status='active'" : "";
  const result = await database.prepare(`
    SELECT npe.*
    FROM native_product_entitlements npe
    JOIN orders o ON o.id=npe.order_id
    JOIN order_items oi ON oi.id=npe.order_item_id AND oi.order_id=npe.order_id
    WHERE npe.order_id=?${activeClause}
    ORDER BY npe.id
  `).bind(id).all();
  return Array.isArray(result) ? result : result?.results || [];
}

export async function markNativeEntitlementFailure(database, orderId, failureCode, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return null;
  await database.prepare(`
    UPDATE orders
    SET native_entitlement_status='failed',native_entitlement_failure_code=?,
        native_entitlement_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
      AND native_order_state='paid' AND native_entitlement_status<>'ready'
  `).bind(String(failureCode || "native_entitlement_failed"), nowIso(options.nowMs), id).run();
  return database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
}

function isPaidNativeSnapshot(item) {
  return item?.catalog_source === "native_d1"
    && Boolean(String(item.native_product_id || "").trim())
    && Boolean(String(item.native_creator_id || "").trim())
    && Number.isInteger(Number(item.catalog_revision))
    && Number(item.catalog_revision) > 0
    && ["fixed", "pwyw"].includes(item.pricing_model_snapshot)
    && Number.isInteger(Number(item.selected_price_cents))
    && Number(item.selected_price_cents) > 0;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}
