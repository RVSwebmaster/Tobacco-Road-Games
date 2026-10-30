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
      acquired_at,created_at,download_reference
    )
    SELECT o.id,oi.id,o.user_id,o.customer_email_hash,
      oi.native_product_id,oi.product_slug,oi.product_title_snapshot,oi.native_creator_id,
      oi.catalog_revision,oi.version_snapshot,oi.pricing_model_snapshot,
      oi.selected_price_cents,oi.currency,'stripe_paid','active',?,?,?
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    WHERE o.id=? AND oi.id=?
      AND o.catalog_source='native_d1' AND o.native_order_state='paid'
      AND o.payment_status='paid' AND o.payment_source='stripe'
      AND o.settlement_method='external_provider' AND o.stripe_payment_intent_id IS NOT NULL
      AND oi.catalog_source='native_d1' AND oi.pricing_model_snapshot IN ('fixed','pwyw')
      AND oi.selected_price_cents > 0
  `).bind(acquiredAt, createdAt, randomDownloadReference(), id, Number(item.id)));
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

export async function grantNativeFreeOrderEntitlements(database, orderId, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return { entitlements: [], ready: false, result: "order_not_found" };
  const order = await database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (!order) return { entitlements: [], ready: false, result: "order_not_found" };
  if (order.catalog_source !== "native_d1") {
    return { entitlements: [], order, ready: false, result: "not_native_order" };
  }
  const items = await getNativeOrderItemSnapshots(database, id);
  if (!items.length || items.some(item => !isFreeNativeSnapshot(item)) || Number(order.total_cents) !== 0) {
    return { entitlements: [], order, ready: false, result: "native_free_snapshot_invalid" };
  }
  const existing = await getNativeOrderEntitlements(database, id, { activeOnly: true });
  if (order.payment_status === "paid" && order.native_order_state === "free_acquired"
    && order.native_entitlement_status === "ready" && existing.length === items.length) {
    return { entitlementCount: existing.length, entitlements: existing, order, ready: true, result: "already_entitled" };
  }
  if (order.payment_status !== "pending" || order.native_order_state !== "pending"
    || order.fulfillment_status !== "pending" || !order.user_id
    || order.stripe_checkout_session_id || order.stripe_payment_intent_id) {
    return { entitlements: existing, order, ready: false, result: "order_not_free_acquirable" };
  }
  if (typeof database?.batch !== "function") {
    throw new Error("Native free entitlement creation requires D1 transactional batch support.");
  }
  const acquiredAt = nowIso(options.nowMs);
  const statements = [database.prepare(`
    UPDATE orders
    SET payment_status='paid',paid_at=?,processor_fee_cents=0,net_proceeds_cents=0,
        payment_source='none',settlement_method='no_payment',native_order_state='free_acquired',
        fulfillment_status='ready',checkout_session_status='legacy',checkout_failure_code=NULL,
        checkout_updated_at=?,native_entitlement_status='pending',native_entitlement_failure_code=NULL,
        native_entitlement_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='pending'
      AND native_order_state='pending' AND fulfillment_status='pending' AND total_cents=0
      AND user_id IS NOT NULL AND stripe_checkout_session_id IS NULL
      AND stripe_payment_intent_id IS NULL
  `).bind(acquiredAt, acquiredAt, acquiredAt, id)];
  for (const item of items) {
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO native_product_entitlements(
        order_id,order_item_id,purchaser_user_id,purchaser_email_hash_snapshot,
        native_product_id,product_slug_snapshot,product_title_snapshot,native_creator_id,
        catalog_revision_snapshot,version_snapshot,pricing_model_snapshot,
        selected_price_cents_snapshot,currency_snapshot,entitlement_source,status,
        acquired_at,created_at,download_reference
      )
      SELECT o.id,oi.id,o.user_id,o.customer_email_hash,
        oi.native_product_id,oi.product_slug,oi.product_title_snapshot,oi.native_creator_id,
        oi.catalog_revision,oi.version_snapshot,oi.pricing_model_snapshot,
        oi.selected_price_cents,oi.currency,'native_free','active',?,?,?
      FROM orders o JOIN order_items oi ON oi.order_id=o.id
      WHERE o.id=? AND oi.id=? AND o.catalog_source='native_d1'
        AND o.native_order_state='free_acquired' AND o.payment_status='paid'
        AND o.payment_source='none' AND o.settlement_method='no_payment'
        AND o.user_id IS NOT NULL AND oi.catalog_source='native_d1'
        AND oi.selected_price_cents=0 AND oi.effective_unit_price_cents=0
        AND oi.line_total_cents=0 AND oi.pricing_model_snapshot IN ('fixed','free','pwyw')
        AND (oi.pricing_model_snapshot<>'pwyw' OR COALESCE(oi.minimum_price_cents_snapshot,0)=0)
    `).bind(acquiredAt, acquiredAt, randomDownloadReference(), id, Number(item.id)));
  }
  statements.push(database.prepare(`
    UPDATE orders
    SET native_entitlement_status='ready',native_entitlement_failure_code=NULL,
        native_entitlement_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
      AND native_order_state='free_acquired'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        LEFT JOIN native_product_entitlements npe
          ON npe.order_item_id=oi.id AND npe.order_id=oi.order_id AND npe.status='active'
        WHERE oi.order_id=orders.id AND oi.catalog_source='native_d1' AND npe.id IS NULL
      )
  `).bind(acquiredAt, id));
  await database.batch(statements);
  const entitlements = await getNativeOrderEntitlements(database, id, { activeOnly: true });
  const acquiredOrder = await database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (entitlements.length !== items.length || acquiredOrder?.native_entitlement_status !== "ready") {
    await markNativeEntitlementFailure(database, id, "native_free_entitlement_reconciliation_failed", options);
    throw new Error("Native free entitlements did not reconcile.");
  }
  return {
    entitlementCount: entitlements.length,
    entitlements,
    order: acquiredOrder,
    ready: true,
    result: "native_free_entitlements_ready"
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

export async function getNativeEntitlementByDownloadReference(database, downloadReference) {
  const reference = String(downloadReference || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(reference)) return null;
  return database.prepare(`
    SELECT npe.*,
      o.payment_status AS order_payment_status,
      o.native_order_state AS order_native_state,
      o.catalog_source AS order_catalog_source,
      o.user_id AS order_user_id,
      o.fulfillment_status AS order_fulfillment_status,
      oi.catalog_source AS item_catalog_source,
      oi.native_product_id AS item_native_product_id,
      oi.native_creator_id AS item_native_creator_id,
      oi.product_slug AS item_product_slug,
      oi.delivery_r2_key_snapshot,
      oi.delivery_filename_snapshot,
      oi.delivery_content_type_snapshot,
      mp.cover_r2_key AS current_cover_r2_key
    FROM native_product_entitlements npe
    JOIN orders o ON o.id=npe.order_id
    JOIN order_items oi ON oi.id=npe.order_item_id AND oi.order_id=npe.order_id
    LEFT JOIN marketplace_products mp ON mp.id=npe.native_product_id
    WHERE npe.download_reference=?
  `).bind(reference).first();
}

export async function listNativeEntitlementsForLibrary(database, purchaserUserId) {
  const userId = String(purchaserUserId || "").trim();
  if (!userId) return [];
  const result = await database.prepare(`
    SELECT npe.download_reference,npe.native_product_id,npe.product_slug_snapshot,
      npe.product_title_snapshot,npe.native_creator_id,npe.catalog_revision_snapshot,
      npe.version_snapshot,npe.pricing_model_snapshot,npe.selected_price_cents_snapshot,
      npe.currency_snapshot,npe.status AS entitlement_status,npe.acquired_at,
      o.public_id,o.created_at,o.payment_source,
      oi.author_slugs_json,oi.last_updated_snapshot,
      c.slug AS creator_slug,c.display_name AS creator_display_name,
      mp.cover_r2_key AS current_cover_r2_key,mp.updated_at AS current_updated_at
    FROM native_product_entitlements npe
    JOIN orders o ON o.id=npe.order_id
    JOIN order_items oi ON oi.id=npe.order_item_id AND oi.order_id=npe.order_id
    LEFT JOIN marketplace_creators c ON c.id=npe.native_creator_id
    LEFT JOIN marketplace_products mp ON mp.id=npe.native_product_id
    WHERE npe.purchaser_user_id=? AND npe.status='active'
      AND o.user_id=? AND o.catalog_source='native_d1'
      AND o.payment_status='paid' AND o.native_order_state IN ('paid','free_acquired')
      AND oi.catalog_source='native_d1'
    ORDER BY npe.acquired_at DESC,npe.id ASC
  `).bind(userId, userId).all();
  return Array.isArray(result) ? result : result?.results || [];
}

export function isNativeEntitlementOwnedBySession(entitlement, session) {
  return Boolean(
    entitlement
      && session?.valid === true
      && session.user?.email_verified === 1
      && entitlement.status === "active"
      && entitlement.order_payment_status === "paid"
      && ["paid", "free_acquired"].includes(entitlement.order_native_state)
      && entitlement.order_catalog_source === "native_d1"
      && entitlement.item_catalog_source === "native_d1"
      && entitlement.purchaser_user_id
      && entitlement.purchaser_user_id === session.user.id
      && entitlement.order_user_id === session.user.id
      && entitlement.native_product_id === entitlement.item_native_product_id
      && entitlement.native_creator_id === entitlement.item_native_creator_id
      && entitlement.product_slug_snapshot === entitlement.item_product_slug
  );
}

export async function recordNativeSuccessfulDownload(database, entitlement, options = {}) {
  if (typeof database?.batch !== "function") {
    throw new Error("Native download recording requires D1 transactional batch support.");
  }
  const id = positiveInteger(entitlement?.id);
  const orderId = positiveInteger(entitlement?.order_id);
  const orderItemId = positiveInteger(entitlement?.order_item_id);
  const reference = String(entitlement?.download_reference || "").trim().toLowerCase();
  if (!id || !orderId || !orderItemId || !/^[a-f0-9]{32}$/.test(reference)) {
    throw new Error("A valid native entitlement is required to record a download.");
  }
  const attemptedAt = nowIso(options.nowMs);
  await database.batch([
    database.prepare(`
      INSERT INTO native_download_attempts(entitlement_id,order_id,order_item_id,outcome,attempted_at)
      SELECT id,order_id,order_item_id,'success',?
      FROM native_product_entitlements
      WHERE id=? AND download_reference=? AND status='active'
    `).bind(attemptedAt, id, reference),
    database.prepare(`
      UPDATE native_product_entitlements
      SET first_downloaded_at=COALESCE(first_downloaded_at,?),last_downloaded_at=?,
          successful_download_count=successful_download_count+1
      WHERE id=? AND download_reference=? AND status='active'
    `).bind(attemptedAt, attemptedAt, id, reference),
    database.prepare(`
      UPDATE orders
      SET fulfillment_status='fulfilled',fulfillment_failure_code=NULL,
          fulfillment_updated_at=?,completed_at=COALESCE(completed_at,?)
      WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
        AND native_order_state IN ('paid','free_acquired')
    `).bind(attemptedAt, attemptedAt, orderId)
  ]);
}

export async function markNativeDeliveryFailure(database, orderId, failureCode, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return null;
  await database.prepare(`
    UPDATE orders
    SET fulfillment_status='failed',fulfillment_failure_code=?,fulfillment_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
      AND native_order_state IN ('paid','free_acquired')
  `).bind(String(failureCode || "native_delivery_failed"), nowIso(options.nowMs), id).run();
  return database.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
}

export async function markNativeEntitlementFailure(database, orderId, failureCode, options = {}) {
  const id = positiveInteger(orderId);
  if (!id) return null;
  await database.prepare(`
    UPDATE orders
    SET native_entitlement_status='failed',native_entitlement_failure_code=?,
        native_entitlement_updated_at=?
    WHERE id=? AND catalog_source='native_d1' AND payment_status='paid'
      AND native_order_state IN ('paid','free_acquired') AND native_entitlement_status<>'ready'
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

function isFreeNativeSnapshot(item) {
  return item?.catalog_source === "native_d1"
    && Boolean(String(item.native_product_id || "").trim())
    && Boolean(String(item.native_creator_id || "").trim())
    && Number.isInteger(Number(item.catalog_revision))
    && Number(item.catalog_revision) > 0
    && ["fixed", "free", "pwyw"].includes(item.pricing_model_snapshot)
    && Number(item.selected_price_cents) === 0
    && Number(item.effective_unit_price_cents) === 0
    && Number(item.line_total_cents) === 0
    && (item.pricing_model_snapshot !== "pwyw"
      || Number(item.minimum_price_cents_snapshot || 0) === 0);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}

function randomDownloadReference() {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}
