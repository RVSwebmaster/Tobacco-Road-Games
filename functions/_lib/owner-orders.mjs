import { getOwnerAccessConfig, verifyOwnerAccessRequest } from "./owner-access.mjs";
import { SESSION_COOKIE_NAME, getOwnerSecrets, jsonResponse, readCookie, verifySessionToken } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";
import { createAndSendIntentionalResend, listOrderEmailOutbox } from "./order-delivery.mjs";
import {
  getActiveOrderAccessCredential,
  regenerateOrderAccessCredential,
  revokeOrderAccessCredentials
} from "./order-access.mjs";
import { getOrderByPublicId, getOrderItems } from "./orders-d1.mjs";
import { getOrderEntitlements, repairPaidOrderFulfillment } from "./order-fulfillment.mjs";

export async function handleOwnerOrdersRequest(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS) {
    return jsonResponse({ error: "Owner order recovery is missing TRG_ORDERS." }, 503);
  }
  if (request.method === "GET") {
    return handleLookup(request, env, options);
  }
  if (request.method === "POST") {
    return handleMutation(request, env, options);
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleLookup(request, env, options) {
  const auth = await resolveOwnerReadIdentity(request, env, options);
  if (!auth.valid) {
    return jsonResponse({ error: auth.userMessage }, auth.status);
  }
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
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env, {
    csrfExpiredMessage: "The order recovery security token expired. Reload the page and try again.",
    csrfMismatchMessage: "The order recovery security token did not match. Reload the page and try again.",
    missingCsrfSecretMessage: "Owner order recovery is missing OWNER_CSRF_SECRET in Cloudflare.",
    nowMs: options.nowMs,
    sameOriginMessage: "Order recovery actions must come from the Tobacco Road Games owner site."
  });
  if (!auth.valid) {
    return jsonResponse({ error: auth.userMessage }, auth.status);
  }
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
      result = await repairPaidOrderFulfillment(env.TRG_ORDERS, env.TRG_PRODUCTS, Number(order.id), { nowMs: options.nowMs });
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
  const [items, entitlements, emails, activeAccess, audits, downloadSummary] = await Promise.all([
    getOrderItems(database, orderId),
    getOrderEntitlements(database, orderId),
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

async function resolveOwnerReadIdentity(request, env, options = {}) {
  const accessConfig = getOwnerAccessConfig(env);
  if (accessConfig.enabled) {
    const state = await verifyOwnerAccessRequest(request, env);
    return state.valid
      ? { valid: true, username: state.email || state.csrfSubject }
      : { valid: false, status: 403, userMessage: state.userMessage };
  }
  const secrets = getOwnerSecrets(env);
  const token = readCookie(request, SESSION_COOKIE_NAME);
  const state = token && secrets.sessionSecret ? await verifySessionToken(token, secrets.sessionSecret, options.nowMs) : { valid: false };
  return state.valid
    ? { valid: true, username: state.username }
    : { valid: false, status: 401, userMessage: "Owner authentication is required." };
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
