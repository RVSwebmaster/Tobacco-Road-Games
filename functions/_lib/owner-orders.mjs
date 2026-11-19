import { OWNER_ACTOR_ID, jsonResponse } from "./owner-runtime.mjs";
import { createAndSendIntentionalResend, listOrderEmailOutbox } from "./order-delivery.mjs";
import {
  getActiveOrderAccessCredential,
  regenerateOrderAccessCredential,
  revokeOrderAccessCredentials
} from "./order-access.mjs";
import { getOrderByPublicId, getOrderItems } from "./orders-d1.mjs";
import { getOrderEntitlements, repairNativePaidOrderFulfillment, repairPaidOrderFulfillment } from "./order-fulfillment.mjs";
import { getNativeOrderEntitlements } from "./native-entitlements-d1.mjs";
import { repairNativePaidOrderAccounting } from "./creator-finance.mjs";
import { recoverNativeOrderProcessingFee } from "./stripe-order-fees.mjs";

const PURCHASED_DELIVERY_AUDIT_PAGE_SIZE = 50;

export async function handleOwnerOrdersRequest(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS) {
    return jsonResponse({ error: "Owner order recovery is missing TRG_ORDERS." }, 503);
  }
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("audit") === "purchased-deliveries") {
      if (!env.TRG_PRODUCTS?.head) {
        return jsonResponse({ error: "Purchased delivery audit requires the TRG_PRODUCTS R2 binding." }, 503);
      }
      return auditPurchasedDeliveries(env.TRG_ORDERS, env.TRG_PRODUCTS, url.searchParams.get("afterOrderItemId"), options);
    }
    return handleLookup(request, env, options);
  }
  if (request.method === "POST") {
    return handleMutation(request, env, options);
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function auditPurchasedDeliveries(database, bucket, afterOrderItemId, options = {}) {
  const cursor = afterOrderItemId == null || afterOrderItemId === ""
    ? 0
    : Number(afterOrderItemId);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return jsonResponse({ error: "The purchased-delivery audit cursor is invalid." }, 400);
  }
  let rows;
  try {
    rows = await allRows(database.prepare(`
      SELECT oi.id AS order_item_id, o.public_id, oi.product_slug,
             oi.product_title_snapshot, oi.version_snapshot,
             oi.delivery_filename_snapshot, oi.delivery_r2_key_snapshot
      FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      WHERE oi.id>? AND oi.catalog_source='native_d1'
        AND oi.delivery_r2_key_snapshot IS NOT NULL
        AND (o.payment_status IN ('paid','refunded','disputed') OR o.native_order_state='free_acquired')
      ORDER BY oi.id ASC
      LIMIT ?
    `).bind(cursor, PURCHASED_DELIVERY_AUDIT_PAGE_SIZE + 1));
  } catch (error) {
    console.error(JSON.stringify({ event: "purchased_delivery_audit_query_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "Purchased delivery snapshots could not be audited." }, 503);
  }

  const hasMore = rows.length > PURCHASED_DELIVERY_AUDIT_PAGE_SIZE;
  const page = rows.slice(0, PURCHASED_DELIVERY_AUDIT_PAGE_SIZE);
  const checks = await Promise.all(page.map(async row => {
    try {
      const object = await bucket.head(row.delivery_r2_key_snapshot);
      return { row, status: object ? "available" : "missing" };
    } catch {
      return { row, status: "unverified" };
    }
  }));
  const describe = ({ row, status }) => ({
    orderItemId: Number(row.order_item_id),
    publicOrderId: row.public_id,
    productSlug: row.product_slug,
    productTitle: row.product_title_snapshot,
    version: row.version_snapshot || "",
    filename: row.delivery_filename_snapshot,
    deliveryKey: row.delivery_r2_key_snapshot,
    status
  });
  const lastRow = page[page.length - 1];
  return jsonResponse({
    scanned: page.length,
    availableCount: checks.filter(item => item.status === "available").length,
    missing: checks.filter(item => item.status === "missing").map(describe),
    unverified: checks.filter(item => item.status === "unverified").map(describe),
    complete: !hasMore,
    nextAfterOrderItemId: hasMore && lastRow ? Number(lastRow.order_item_id) : null,
    verifiedAt: nowIso(options.nowMs)
  });
}

async function handleLookup(request, env, options) {
  const auth = { username: OWNER_ACTOR_ID };
  const query = String(new URL(request.url).searchParams.get("query") || "").trim();
  if (!query || query.length > 254) {
    return jsonResponse({ error: "Enter a public order number or complete customer email address." }, 400);
  }
  const orders = await findOrders(env.TRG_ORDERS, query);
  for (const order of orders) {
    await recordOwnerAudit(env.TRG_ORDERS, {
      action: "order.lookup",
      actor: auth.username,
      details: { queryType: query.includes("@") ? "email" : "public_order" },
      orderId: Number(order.id),
      outcome: "succeeded"
    }, options);
  }
  return jsonResponse({ ok: true, orders: await Promise.all(orders.map((order) => orderDetails(env.TRG_ORDERS, order))) });
}

async function handleMutation(request, env, options) {
  const auth = { username: OWNER_ACTOR_ID };
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "The order action must be valid JSON." }, 400);
  }
  const action = String(payload?.action || "").trim();
  const publicId = String(payload?.publicOrderId || "").trim().toUpperCase();
  const order = await getOrderByPublicId(env.TRG_ORDERS, publicId);
  if (!order || !["resend_delivery", "revoke_access", "regenerate_access", "repair_fulfillment"].includes(action)) {
    return jsonResponse({ error: "The requested order action is not valid." }, 400);
  }

  const auditBase = { action: `order.${action}`, actor: auth.username, orderId: Number(order.id) };
  try {
    let result;
    if (action === "repair_fulfillment") {
      if (order.payment_status !== "paid") {
        await recordOwnerAudit(env.TRG_ORDERS, { ...auditBase, details: { reason: "order_not_paid" }, outcome: "rejected" }, options);
        return jsonResponse({ error: "Only a verified paid order can have fulfillment repaired." }, 409);
      }
      if (order.catalog_source === "native_d1") {
        const creatorAccounting = await repairNativePaidOrderAccounting(env.TRG_ORDERS, Number(order.id), {
          nowMs: options.nowMs
        });
        if (!creatorAccounting.ready) throw new Error(creatorAccounting.reason || "native_creator_accounting_incomplete");
        let feeReconciliation;
        try {
          feeReconciliation = await recoverNativeOrderProcessingFee(env.TRG_ORDERS, Number(order.id), {
            secretKey: env.STRIPE_SECRET_KEY,
            fetchImpl: options.stripeFetchImpl,
            nowMs: options.nowMs
          });
        } catch (error) {
          feeReconciliation = { action: "fee_recovery_failed", reason: String(error?.message || error) };
        }
        const fulfillment = await repairNativePaidOrderFulfillment(env.TRG_ORDERS, env.TRG_PRODUCTS, Number(order.id), {
          nowMs: options.nowMs
        });
        result = { ...fulfillment, creatorAccounting, feeReconciliation };
      } else {
        result = await repairPaidOrderFulfillment(env.TRG_ORDERS, env.TRG_PRODUCTS, Number(order.id), {
          deliveryProducts: options.deliveryProducts,
          nowMs: options.nowMs
        });
      }
      if (!result.ready) {
        throw new Error(result.result || "fulfillment_repair_failed");
      }
    } else if (action === "revoke_access") {
      result = { revoked: await revokeOrderAccessCredentials(env.TRG_ORDERS, Number(order.id), { nowMs: options.nowMs }) };
    } else if (action === "regenerate_access") {
      if (order.payment_status !== "paid") {
        await recordOwnerAudit(env.TRG_ORDERS, { ...auditBase, details: { reason: "order_not_paid" }, outcome: "rejected" }, options);
        return jsonResponse({ error: "Only a verified paid order can receive an order-access credential." }, 409);
      }
      const access = await regenerateOrderAccessCredential(
        env.TRG_ORDERS,
        order,
        env.ORDER_ACCESS_SIGNING_SECRET,
        { nowMs: options.nowMs }
      );
      result = { generation: Number(access.credential.generation) };
    } else {
      if (order.payment_status !== "paid" || !["ready", "fulfilled"].includes(order.fulfillment_status)) {
        await recordOwnerAudit(env.TRG_ORDERS, { ...auditBase, details: { reason: "order_not_delivery_ready" }, outcome: "rejected" }, options);
        return jsonResponse({ error: "The order must be verified paid and fulfillment-ready before delivery email can be resent." }, 409);
      }
      const delivery = await createAndSendIntentionalResend(env.TRG_ORDERS, env, Number(order.id), {
        fetchImpl: options.fetchImpl,
        nowMs: options.nowMs
      });
      if (delivery.retryable) {
        throw new Error("delivery_retryable");
      }
      result = { messageId: delivery.outbox?.provider_message_id || null, status: delivery.outbox?.status };
    }

    await recordOwnerAudit(env.TRG_ORDERS, { ...auditBase, details: safeAuditDetails(result), outcome: "succeeded" }, options);
    return jsonResponse({ ok: true, order: await orderDetails(env.TRG_ORDERS, await getOrderByPublicId(env.TRG_ORDERS, publicId)) });
  } catch (error) {
    await recordOwnerAudit(env.TRG_ORDERS, {
      ...auditBase,
      details: { failureCode: safeFailureCode(error) },
      outcome: "failed"
    }, options);
    return jsonResponse({ error: "The owner order action could not be completed. Review the order status and try again." }, 502);
  }
}

async function findOrders(database, query) {
  if (query.includes("@")) {
    return allRows(database.prepare(`
      SELECT * FROM orders WHERE customer_email_normalized = ? ORDER BY created_at DESC LIMIT 20
    `).bind(query.toLowerCase()));
  }
  const order = await getOrderByPublicId(database, query.toUpperCase());
  return order ? [order] : [];
}

async function orderDetails(database, order) {
  const orderId = Number(order.id);
  const [items, entitlements, nativeEntitlements, emails, activeAccess, audits, downloadSummary] = await Promise.all([
    getOrderItems(database, orderId),
    getOrderEntitlements(database, orderId),
    order.catalog_source === "native_d1" ? getNativeOrderEntitlements(database, orderId) : Promise.resolve([]),
    listOrderEmailOutbox(database, orderId),
    getActiveOrderAccessCredential(database, orderId),
    allRows(database.prepare(`
      SELECT actor, action, outcome, details_json, created_at
      FROM owner_order_audit WHERE order_id = ? ORDER BY id DESC LIMIT 25
    `).bind(orderId)),
    database.prepare(`
      SELECT COUNT(*) AS successful_downloads, MIN(attempted_at) AS first_downloaded_at,
             MAX(attempted_at) AS last_downloaded_at
      FROM download_attempts WHERE order_id = ?
    `).bind(orderId).first()
  ]);
  return {
    access: activeAccess ? {
      createdAt: activeAccess.created_at,
      generation: Number(activeAccess.generation),
      lastUsedAt: activeAccess.last_used_at,
      status: activeAccess.status
    } : null,
    audits: audits.map((audit) => ({
      action: audit.action,
      actor: audit.actor,
      createdAt: audit.created_at,
      details: parseJson(audit.details_json),
      outcome: audit.outcome
    })),
    checkoutSessionId: order.stripe_checkout_session_id,
    createdAt: order.created_at,
    customerEmail: order.customer_email,
    downloads: {
      firstDownloadedAt: downloadSummary?.first_downloaded_at || null,
      lastDownloadedAt: downloadSummary?.last_downloaded_at || null,
      successfulCount: Number(downloadSummary?.successful_downloads || 0)
    },
    emails,
    emailStatus: order.email_status,
    entitlements: entitlements.map((entry) => ({
      createdAt: entry.created_at,
      customerFilename: entry.customer_filename,
      firstDownloadedAt: entry.first_downloaded_at,
      productSlug: entry.product_slug,
      status: entry.status,
      successfulDownloadCount: Number(entry.successful_download_count || 0)
    })),
    fulfillmentFailureCode: order.fulfillment_failure_code,
    fulfillmentStatus: order.fulfillment_status,
    items: items.map((item) => ({ productSlug: item.product_slug, title: item.product_title_snapshot })),
    nativeEntitlementCount: nativeEntitlements.length,
    nativeEntitlementFailureCode: order.native_entitlement_failure_code || null,
    nativeEntitlementStatus: order.catalog_source === "native_d1" ? order.native_entitlement_status : null,
    paidAt: order.paid_at,
    paymentIntentId: order.stripe_payment_intent_id,
    paymentStatus: order.payment_status,
    publicId: order.public_id,
    totalCents: Number(order.total_cents),
    currency: order.currency
  };
}

export async function recordOwnerAudit(database, input, options = {}) {
  await database.prepare(`
    INSERT INTO owner_order_audit (order_id, actor, action, outcome, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    Number.isInteger(input.orderId) ? input.orderId : null,
    String(input.actor || "unknown-owner"),
    String(input.action || "order.unknown"),
    String(input.outcome || "failed"),
    JSON.stringify(input.details || {}),
    nowIso(options.nowMs)
  ).run();
}

function safeAuditDetails(result) {
  if (!result || typeof result !== "object") {
    return {};
  }
  const allowed = ["generation", "messageId", "ready", "result", "revoked", "status"];
  return Object.fromEntries(allowed
    .filter((key) => ["boolean", "number", "string"].includes(typeof result[key]))
    .map((key) => [key, result[key]]));
}

function safeFailureCode(error) {
  const value = String(error?.code || error?.message || "owner_action_failed").toLowerCase();
  return /^[a-z0-9_-]{1,80}$/.test(value) ? value : "owner_action_failed";
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return {}; }
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [];
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}
