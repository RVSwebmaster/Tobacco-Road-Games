import { getOrderById, getOrderItems } from "./orders-d1.mjs";
import { getDeliveryProduct, isExactDeliveryMapping } from "./product-delivery.mjs";

export async function repairPaidOrderFulfillment(database, productsBucket, orderId, options = {}) {
  const normalizedOrderId = positiveInteger(orderId);
  if (!normalizedOrderId) {
    return { ready: false, result: "order_not_found" };
  }

  const order = await getOrderById(database, normalizedOrderId);
  if (!order) {
    return { ready: false, result: "order_not_found" };
  }
  if (order.payment_status !== "paid") {
    return { order, ready: false, result: "order_not_paid" };
  }

  const items = await getOrderItems(database, normalizedOrderId);
  const deliveries = items.map((item) => ({ item, product: getDeliveryProduct(item.product_slug) }));
  if (!deliveries.length || deliveries.some(({ product }) => !product)) {
    const failedOrder = await markFulfillmentFailure(
      database,
      normalizedOrderId,
      "unsupported_product",
      options.nowMs
    );
    return { order: failedOrder, ready: false, result: "unsupported_product" };
  }
  if (!productsBucket?.head) {
    const failedOrder = await markFulfillmentFailure(
      database,
      normalizedOrderId,
      "storage_binding_unavailable",
      options.nowMs
    );
    return { order: failedOrder, ready: false, result: "storage_binding_unavailable" };
  }

  const verifiedDeliveries = [];
  try {
    for (const delivery of deliveries) {
      const object = await productsBucket.head(delivery.product.r2ObjectKey);
      if (!object) {
        const failedOrder = await markFulfillmentFailure(
          database,
          normalizedOrderId,
          "object_missing",
          options.nowMs
        );
        return { order: failedOrder, ready: false, result: "object_missing" };
      }
      verifiedDeliveries.push({ ...delivery, objectSize: nonNegativeInteger(object.size) });
    }
  } catch {
    const failedOrder = await markFulfillmentFailure(
      database,
      normalizedOrderId,
      "storage_unavailable",
      options.nowMs
    );
    return { order: failedOrder, ready: false, result: "storage_unavailable" };
  }

  const existingEntitlements = await getOrderEntitlements(database, normalizedOrderId, { activeOnly: true });
  const alreadyReady = ["ready", "fulfilled"].includes(order.fulfillment_status)
    && existingEntitlements.length === verifiedDeliveries.length
    && verifiedDeliveries.every(({ item, product, objectSize }) => {
      const entitlement = existingEntitlements.find(
        (candidate) => Number(candidate.order_item_id) === Number(item.id)
      );
      return isExactDeliveryMapping(entitlement, product)
        && Number(entitlement.object_size_bytes) === objectSize;
    });
  if (alreadyReady) {
    return {
      entitlements: existingEntitlements,
      order,
      ready: true,
      result: "already_fulfillment_ready"
    };
  }

  if (typeof database?.batch !== "function") {
    throw new Error("Fulfillment repair requires D1 transactional batch support.");
  }
  const updatedAt = nowIso(options.nowMs);
  const statements = verifiedDeliveries.map(({ item, product, objectSize }) => database.prepare(`
    INSERT OR IGNORE INTO download_entitlements (
      order_id,
      order_item_id,
      product_slug,
      r2_object_key,
      customer_filename,
      content_type,
      object_size_bytes,
      status,
      created_at
    )
    SELECT o.id, oi.id, ?, ?, ?, ?, ?, 'active', ?
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = ?
      AND o.payment_status = 'paid'
      AND oi.id = ?
      AND oi.product_slug = ?
  `).bind(
    product.productSlug,
    product.r2ObjectKey,
    product.customerFilename,
    product.contentType,
    objectSize,
    updatedAt,
    normalizedOrderId,
    Number(item.id),
    product.productSlug
  ));
  statements.push(database.prepare(`
    UPDATE orders
    SET fulfillment_status = 'ready',
        fulfillment_failure_code = NULL,
        fulfillment_updated_at = ?
    WHERE id = ?
      AND payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1
        FROM order_items oi
        LEFT JOIN download_entitlements de
          ON de.order_item_id = oi.id
          AND de.order_id = oi.order_id
          AND de.status = 'active'
        WHERE oi.order_id = orders.id
          AND de.id IS NULL
      )
  `).bind(updatedAt, normalizedOrderId));
  await database.batch(statements);

  const entitlements = await getOrderEntitlements(database, normalizedOrderId, { activeOnly: true });
  const mappingsAreExact = verifiedDeliveries.every(({ item, product }) => {
    const entitlement = entitlements.find((candidate) => Number(candidate.order_item_id) === Number(item.id));
    return isExactDeliveryMapping(entitlement, product);
  });
  const repairedOrder = await getOrderById(database, normalizedOrderId);
  if (!mappingsAreExact || entitlements.length !== verifiedDeliveries.length || repairedOrder?.fulfillment_status !== "ready") {
    const failedOrder = await markFulfillmentFailure(
      database,
      normalizedOrderId,
      "entitlement_reconciliation_failed",
      options.nowMs
    );
    return { entitlements, order: failedOrder, ready: false, result: "entitlement_reconciliation_failed" };
  }

  return {
    entitlements,
    order: repairedOrder,
    ready: true,
    result: "fulfillment_ready"
  };
}

export async function getOrderEntitlements(database, orderId, options = {}) {
  const normalizedOrderId = positiveInteger(orderId);
  if (!normalizedOrderId) {
    return [];
  }
  const activeClause = options.activeOnly ? " AND de.status = 'active'" : "";
  return allRows(database.prepare(`
    SELECT de.*, o.payment_status AS order_payment_status,
           o.fulfillment_status AS order_fulfillment_status
    FROM download_entitlements de
    JOIN orders o ON o.id = de.order_id
    JOIN order_items oi
      ON oi.id = de.order_item_id
      AND oi.order_id = de.order_id
      AND oi.product_slug = de.product_slug
    WHERE de.order_id = ?${activeClause}
    ORDER BY de.id ASC
  `).bind(normalizedOrderId));
}

export async function getEntitlementById(database, entitlementId) {
  const normalizedEntitlementId = positiveInteger(entitlementId);
  if (!normalizedEntitlementId) {
    return null;
  }
  return database.prepare(`
    SELECT de.*, o.payment_status AS order_payment_status,
           o.fulfillment_status AS order_fulfillment_status
    FROM download_entitlements de
    JOIN orders o ON o.id = de.order_id
    JOIN order_items oi
      ON oi.id = de.order_item_id
      AND oi.order_id = de.order_id
      AND oi.product_slug = de.product_slug
    WHERE de.id = ?
  `).bind(normalizedEntitlementId).first();
}

export async function markFulfillmentFailure(database, orderId, failureCode, nowMs = Date.now()) {
  const normalizedOrderId = positiveInteger(orderId);
  if (!normalizedOrderId) {
    return null;
  }
  await database.prepare(`
    UPDATE orders
    SET fulfillment_status = 'failed',
        fulfillment_failure_code = ?,
        fulfillment_updated_at = ?
    WHERE id = ? AND payment_status = 'paid'
  `).bind(String(failureCode || "fulfillment_failed"), nowIso(nowMs), normalizedOrderId).run();
  return getOrderById(database, normalizedOrderId);
}

export async function recordSuccessfulDownload(database, entitlement, options = {}) {
  if (typeof database?.batch !== "function") {
    throw new Error("Download recording requires D1 transactional batch support.");
  }
  const attemptedAt = nowIso(options.nowMs);
  const entitlementId = positiveInteger(entitlement?.id);
  const orderId = positiveInteger(entitlement?.order_id);
  const orderItemId = positiveInteger(entitlement?.order_item_id);
  if (!entitlementId || !orderId || !orderItemId) {
    throw new Error("A valid entitlement is required to record a download.");
  }
  await database.batch([
    database.prepare(`
      INSERT INTO download_attempts (
        entitlement_id, order_id, order_item_id, outcome, attempted_at
      ) VALUES (?, ?, ?, 'success', ?)
    `).bind(entitlementId, orderId, orderItemId, attemptedAt),
    database.prepare(`
      UPDATE download_entitlements
      SET first_downloaded_at = COALESCE(first_downloaded_at, ?),
          last_downloaded_at = ?,
          successful_download_count = successful_download_count + 1
      WHERE id = ? AND status = 'active'
    `).bind(attemptedAt, attemptedAt, entitlementId)
  ]);
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [];
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("The R2 object size is invalid.");
  }
  return parsed;
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}
