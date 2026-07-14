import { EmailProviderError, createEmailProvider, isEmailDeliveryConfigured } from "./email-provider.mjs";
import {
  ensureActiveOrderAccessCredential,
  getActiveOrderAccessCredential,
  isOrderAccessSecretConfigured,
  reconstructOrderAccessToken
} from "./order-access.mjs";
import { getOrderById, getOrderItems } from "./orders-d1.mjs";
import { getOrderEntitlements } from "./order-fulfillment.mjs";

export class OrderDeliveryError extends Error {
  constructor(code, options = {}) {
    super("Order delivery could not be completed.");
    this.name = "OrderDeliveryError";
    this.code = String(code || "order_delivery_failed");
    this.retryable = Boolean(options.retryable);
  }
}

export async function deliverPaidOrderEmail(database, env, orderId, options = {}) {
  if (!isOrderAccessSecretConfigured(env.ORDER_ACCESS_SIGNING_SECRET)
    || !isEmailDeliveryConfigured(env)
    || !normalizeOrigin(env.PUBLIC_SITE_ORIGIN)) {
    throw new OrderDeliveryError("delivery_configuration_incomplete", { retryable: true });
  }
  const prepared = await ensureOrderDeliveryMessage(database, env, orderId, {
    intentional: false,
    nowMs: options.nowMs
  });
  return dispatchOrderEmail(database, env, prepared.outbox.id, options);
}

export async function createAndSendIntentionalResend(database, env, orderId, options = {}) {
  if (!isOrderAccessSecretConfigured(env.ORDER_ACCESS_SIGNING_SECRET)
    || !isEmailDeliveryConfigured(env)
    || !normalizeOrigin(env.PUBLIC_SITE_ORIGIN)) {
    throw new OrderDeliveryError("delivery_configuration_incomplete");
  }
  const prepared = await ensureOrderDeliveryMessage(database, env, orderId, {
    intentional: true,
    nowMs: options.nowMs
  });
  return dispatchOrderEmail(database, env, prepared.outbox.id, options);
}

export async function ensureOrderDeliveryMessage(database, env, orderId, options = {}) {
  const normalizedOrderId = positiveInteger(orderId);
  const order = normalizedOrderId ? await getOrderById(database, normalizedOrderId) : null;
  if (!order || order.payment_status !== "paid") {
    throw new OrderDeliveryError("order_not_paid");
  }
  if (!['ready', 'fulfilled'].includes(order.fulfillment_status)) {
    throw new OrderDeliveryError("fulfillment_not_ready", { retryable: true });
  }
  const items = await getOrderItems(database, normalizedOrderId);
  const entitlements = await getOrderEntitlements(database, normalizedOrderId, { activeOnly: true });
  if (!items.length || entitlements.length !== items.length) {
    throw new OrderDeliveryError("entitlements_not_ready", { retryable: true });
  }

  const access = await ensureActiveOrderAccessCredential(
    database,
    order,
    env.ORDER_ACCESS_SIGNING_SECRET,
    { nowMs: options.nowMs }
  );
  const intentional = Boolean(options.intentional);
  let messageNumber = 1;
  if (intentional) {
    const row = await database.prepare(`
      SELECT COALESCE(MAX(message_number), 0) + 1 AS next_message_number
      FROM email_outbox
      WHERE order_id = ? AND order_access_credential_id = ?
    `).bind(normalizedOrderId, Number(access.credential.id)).first();
    messageNumber = positiveInteger(row?.next_message_number) || 1;
  }
  const purpose = intentional ? "owner_resend" : "delivery";
  const messageKey = buildMessageKey(order.public_id, access.credential.generation, messageNumber);
  const providerIdempotencyKey = `trg/${messageKey}`;
  const message = buildOrderEmail({
    accessToken: access.token,
    items,
    order,
    origin: normalizeOrigin(env.PUBLIC_SITE_ORIGIN),
    supportEmail: String(env.RESEND_REPLY_TO || "").trim().toLowerCase()
  });
  const payloadHash = await hashEmailPayload(message);
  const createdAt = nowIso(options.nowMs);

  try {
    await database.prepare(`
      INSERT INTO email_outbox (
        order_id, order_access_credential_id, purpose, message_number,
        message_key, payload_hash, provider, provider_idempotency_key,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'resend', ?, 'pending', ?, ?)
    `).bind(
      normalizedOrderId,
      Number(access.credential.id),
      purpose,
      messageNumber,
      messageKey,
      payloadHash,
      providerIdempotencyKey,
      createdAt,
      createdAt
    ).run();
  } catch (error) {
    if (intentional) {
      throw new OrderDeliveryError("concurrent_intentional_resend");
    }
    const existing = await getOutboxByMessageKey(database, messageKey);
    if (!existing) {
      throw error;
    }
  }
  const outbox = await getOutboxByMessageKey(database, messageKey);
  if (!outbox || outbox.payload_hash !== payloadHash) {
    throw new OrderDeliveryError("outbox_payload_mismatch");
  }
  return { accessCredential: access.credential, message, order, outbox };
}

export async function dispatchOrderEmail(database, env, outboxId, options = {}) {
  const outbox = await getOutboxById(database, outboxId);
  if (!outbox) {
    throw new OrderDeliveryError("outbox_not_found");
  }
  if (["accepted", "delivered", "bounced", "suppressed"].includes(outbox.status)) {
    return { duplicate: true, outbox, retryable: false };
  }
  if (outbox.status === "failed") {
    return { duplicate: true, outbox, retryable: false };
  }

  const order = await getOrderById(database, Number(outbox.order_id));
  const items = await getOrderItems(database, Number(outbox.order_id));
  const credential = await database.prepare(`
    SELECT * FROM order_access_credentials WHERE id = ?
  `).bind(Number(outbox.order_access_credential_id)).first();
  if (!order || !credential || credential.status !== "active") {
    await markOutboxFailure(database, outbox, "access_credential_unavailable", false, options.nowMs);
    throw new OrderDeliveryError("access_credential_unavailable");
  }
  const accessToken = await reconstructOrderAccessToken(credential, env.ORDER_ACCESS_SIGNING_SECRET);
  const message = buildOrderEmail({
    accessToken,
    items,
    order,
    origin: normalizeOrigin(env.PUBLIC_SITE_ORIGIN),
    supportEmail: String(env.RESEND_REPLY_TO || "").trim().toLowerCase()
  });
  if (await hashEmailPayload(message) !== outbox.payload_hash) {
    await markOutboxFailure(database, outbox, "outbox_payload_mismatch", false, options.nowMs);
    throw new OrderDeliveryError("outbox_payload_mismatch");
  }

  const attemptedAt = nowIso(options.nowMs);
  await database.prepare(`
    UPDATE email_outbox
    SET attempt_count = attempt_count + 1,
        last_attempt_at = ?, updated_at = ?, failure_code = NULL
    WHERE id = ? AND status IN ('pending', 'delayed')
  `).bind(attemptedAt, attemptedAt, Number(outbox.id)).run();

  const provider = options.provider || createEmailProvider(env, { fetchImpl: options.fetchImpl });
  let providerResult;
  try {
    providerResult = await provider.send(message, {
      idempotencyKey: outbox.provider_idempotency_key
    });
  } catch (error) {
    const retryable = error instanceof EmailProviderError && error.retryable;
    const code = error instanceof EmailProviderError ? error.code : "provider_unknown_failure";
    const failed = await markOutboxFailure(database, outbox, code, retryable, options.nowMs);
    return { duplicate: false, errorCode: code, outbox: failed, retryable };
  }

  const acceptedAt = nowIso(options.nowMs);
  await database.batch([
    database.prepare(`
      UPDATE email_outbox
      SET provider_message_id = ?, status = 'accepted', accepted_at = COALESCE(accepted_at, ?),
          failure_code = NULL, updated_at = ?
      WHERE id = ?
        AND (provider_message_id IS NULL OR provider_message_id = ?)
        AND status IN ('pending', 'delayed', 'accepted')
    `).bind(providerResult.id, acceptedAt, acceptedAt, Number(outbox.id), providerResult.id),
    database.prepare(`
      UPDATE orders SET email_status = 'sent'
      WHERE id = ? AND email_status IN ('pending', 'failed')
    `).bind(Number(outbox.order_id))
  ]);
  const accepted = await getOutboxById(database, Number(outbox.id));
  if (!accepted || accepted.provider_message_id !== providerResult.id || accepted.status !== "accepted") {
    throw new OrderDeliveryError("provider_attachment_failed", { retryable: true });
  }
  return { duplicate: false, outbox: accepted, retryable: false };
}

export async function getOutboxById(database, outboxId) {
  const id = positiveInteger(outboxId);
  return id ? database.prepare("SELECT * FROM email_outbox WHERE id = ?").bind(id).first() : null;
}

export async function getOutboxByMessageKey(database, messageKey) {
  return database.prepare("SELECT * FROM email_outbox WHERE message_key = ?")
    .bind(String(messageKey || "")).first();
}

export async function getOutboxByProviderMessageId(database, providerMessageId) {
  const id = String(providerMessageId || "").trim();
  return id ? database.prepare("SELECT * FROM email_outbox WHERE provider_message_id = ?").bind(id).first() : null;
}

export async function listOrderEmailOutbox(database, orderId) {
  return allRows(database.prepare(`
    SELECT id, purpose, message_number, provider, provider_message_id, status,
           attempt_count, last_attempt_at, accepted_at, delivered_at, delayed_at,
           failed_at, bounced_at, suppressed_at, failure_code, created_at, updated_at
    FROM email_outbox WHERE order_id = ? ORDER BY id DESC
  `).bind(positiveInteger(orderId) || 0));
}

export function buildOrderEmail({ accessToken, items, order, origin, supportEmail }) {
  const accessUrl = `${origin}/store/order-access?credential=${encodeURIComponent(accessToken)}`;
  const productTitles = items.map((item) => String(item.product_title_snapshot || "Product"));
  const amount = formatMoney(order.total_cents, order.currency);
  const productText = productTitles.map((title) => `- ${title}`).join("\n");
  const productHtml = productTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("");
  const subject = `Your Tobacco Road Games order ${order.public_id}`;
  const text = `Your Tobacco Road Games order is ready.\n\nOrder: ${order.public_id}\nPurchased products:\n${productText}\nAmount paid: ${amount}\n\nAccess your downloads:\n${accessUrl}\n\nNeed help? Reply to this email or contact ${supportEmail}.\n`;
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f7f2e8;color:#24170f;font-family:Arial,sans-serif;line-height:1.55">
<main style="max-width:620px;margin:0 auto;background:#fff;padding:28px;border:1px solid #ddcfb5;border-radius:12px">
<h1 style="margin-top:0;font-size:24px">Your order is ready</h1>
<p><strong>Order:</strong> ${escapeHtml(order.public_id)}</p>
<p><strong>Purchased products:</strong></p><ul>${productHtml}</ul>
<p><strong>Amount paid:</strong> ${escapeHtml(amount)}</p>
<p style="margin:28px 0"><a href="${escapeHtml(accessUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#6f431e;color:#fff;text-decoration:none;font-weight:bold">Access your downloads</a></p>
<p>Need help? Reply to this email or contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
<p style="color:#66584b;font-size:13px">This is a transactional order-delivery message from Tobacco Road Games.</p>
</main></body></html>`;
  return {
    accessUrl,
    html,
    subject,
    tags: [
      { name: "category", value: "order_delivery" },
      { name: "order_reference", value: String(order.public_id) }
    ],
    text,
    to: order.customer_email
  };
}

async function markOutboxFailure(database, outbox, code, retryable, nowMs) {
  const updatedAt = nowIso(nowMs);
  const status = retryable ? "delayed" : "failed";
  const timestampColumn = retryable ? "delayed_at" : "failed_at";
  await database.batch([
    database.prepare(`
      UPDATE email_outbox
      SET status = ?, ${timestampColumn} = ?, failure_code = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'delayed')
    `).bind(status, updatedAt, safeFailureCode(code), updatedAt, Number(outbox.id)),
    database.prepare(`
      UPDATE orders SET email_status = ? WHERE id = ?
    `).bind(retryable ? "pending" : "failed", Number(outbox.order_id))
  ]);
  return getOutboxById(database, Number(outbox.id));
}

async function hashEmailPayload(message) {
  const canonical = JSON.stringify({
    html: message.html,
    subject: message.subject,
    tags: message.tags,
    text: message.text,
    to: message.to
  });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildMessageKey(publicId, generation, messageNumber) {
  return `order-delivery/${String(publicId)}/g${Number(generation)}/m${Number(messageNumber)}`;
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    currency: String(currency || "USD").toUpperCase(),
    style: "currency"
  }).format(Number(cents || 0) / 100);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function safeFailureCode(value) {
  const normalized = String(value || "provider_failure").toLowerCase();
  return /^[a-z0-9_-]{1,80}$/.test(normalized) ? normalized : "provider_failure";
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [];
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}
