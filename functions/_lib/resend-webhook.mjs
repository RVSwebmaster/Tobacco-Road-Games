import { getOutboxByProviderMessageId } from "./order-delivery.mjs";

export const RESEND_WEBHOOK_EVENT_TYPES = Object.freeze([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.suppressed"
]);

const MAX_BODY_BYTES = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function handleResendWebhookRequest(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS || !String(env.RESEND_WEBHOOK_SECRET || "").startsWith("whsec_")) {
    return jsonResponse({ error: "webhook_unavailable" }, 503);
  }
  let rawBody;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }
  if (!rawBody.length || rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }
  const svixId = String(request.headers.get("svix-id") || "").trim();
  const svixTimestamp = String(request.headers.get("svix-timestamp") || "").trim();
  const svixSignature = String(request.headers.get("svix-signature") || "").trim();
  try {
    await verifyResendWebhookSignature(rawBody, {
      id: svixId,
      signature: svixSignature,
      timestamp: svixTimestamp
    }, env.RESEND_WEBHOOK_SECRET, options);
  } catch {
    return jsonResponse({ error: "invalid_signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse({ error: "invalid_event_payload" }, 400);
  }
  try {
    const result = await processResendWebhookEvent(env.TRG_ORDERS, event, {
      nowMs: options.nowMs,
      providerEventId: svixId
    });
    return jsonResponse({ duplicate: result.duplicate, ok: true }, 200);
  } catch {
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}

export async function verifyResendWebhookSignature(rawBody, headers, secret, options = {}) {
  const id = String(headers?.id || "").trim();
  const timestampText = String(headers?.timestamp || "").trim();
  const signatures = String(headers?.signature || "").trim().split(/\s+/).filter(Boolean);
  const timestamp = Number(timestampText);
  if (!/^msg_[A-Za-z0-9_-]+$/.test(id)
    || !Number.isInteger(timestamp)
    || !signatures.some((value) => value.startsWith("v1,"))
    || !String(secret || "").startsWith("whsec_")) {
    throw new Error("resend_signature_malformed");
  }
  const nowSeconds = Math.floor((Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()) / 1000);
  const tolerance = Number.isFinite(options.toleranceSeconds)
    ? Math.max(0, Number(options.toleranceSeconds))
    : SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new Error("resend_signature_expired");
  }

  let keyBytes;
  try {
    keyBytes = base64Decode(String(secret).slice("whsec_".length));
  } catch {
    throw new Error("resend_secret_invalid");
  }
  const prefix = new TextEncoder().encode(`${id}.${timestampText}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );
  for (const signature of signatures) {
    if (!signature.startsWith("v1,")) {
      continue;
    }
    try {
      if (await crypto.subtle.verify("HMAC", key, base64Decode(signature.slice(3)), signed)) {
        return true;
      }
    } catch {
      // Continue through key rotation signatures without exposing which one failed.
    }
  }
  throw new Error("resend_signature_mismatch");
}

export async function processResendWebhookEvent(database, event, options = {}) {
  const providerEventId = requiredString(options.providerEventId, "provider_event_id_missing");
  const eventType = requiredString(event?.type, "event_type_missing");
  const providerMessageId = String(event?.data?.email_id || "").trim() || null;
  const receivedAt = nowIso(options.nowMs);
  await database.prepare(`
    INSERT OR IGNORE INTO email_webhook_events (
      provider, provider_event_id, provider_message_id, event_type,
      processing_status, received_at
    ) VALUES ('resend', ?, ?, ?, 'pending', ?)
  `).bind(providerEventId, providerMessageId, eventType, receivedAt).run();
  let record = await database.prepare(`
    SELECT * FROM email_webhook_events
    WHERE provider = 'resend' AND provider_event_id = ?
  `).bind(providerEventId).first();
  if (!record) {
    throw new Error("email_webhook_record_missing");
  }
  if (["processed", "ignored"].includes(record.processing_status)) {
    return { duplicate: true, event: record };
  }
  if (record.event_type !== eventType
    || String(record.provider_message_id || "") !== String(providerMessageId || "")) {
    await markEmailWebhookFailure(database, record, "provider_event_payload_mismatch", receivedAt);
    throw new Error("provider_event_payload_mismatch");
  }

  if (!RESEND_WEBHOOK_EVENT_TYPES.includes(eventType)) {
    await database.prepare(`
      UPDATE email_webhook_events
      SET processing_status = 'ignored', attempt_count = attempt_count + 1, processed_at = ?
      WHERE id = ?
    `).bind(receivedAt, Number(record.id)).run();
    record = await getEmailWebhookEvent(database, Number(record.id));
    return { duplicate: false, event: record };
  }
  if (!providerMessageId) {
    await markEmailWebhookFailure(database, record, "provider_message_id_missing", receivedAt);
    throw new Error("provider_message_id_missing");
  }
  const outbox = await getOutboxByProviderMessageId(database, providerMessageId);
  if (!outbox) {
    await markEmailWebhookFailure(database, record, "outbox_message_not_attached", receivedAt);
    throw new Error("outbox_message_not_attached");
  }

  const transition = eventTransition(eventType, event?.created_at, receivedAt);
  const statements = [
    database.prepare(`
      UPDATE email_outbox
      SET status = CASE WHEN ${transition.guardSql} THEN ? ELSE status END,
          ${transition.timestampColumn} = CASE WHEN ${transition.guardSql} THEN COALESCE(${transition.timestampColumn}, ?) ELSE ${transition.timestampColumn} END,
          failure_code = CASE WHEN ${transition.guardSql} THEN ? ELSE failure_code END,
          updated_at = CASE WHEN ${transition.guardSql} THEN ? ELSE updated_at END
      WHERE id = ?
    `).bind(
      transition.status,
      transition.timestamp,
      transition.failureCode,
      transition.timestamp,
      Number(outbox.id)
    ),
    database.prepare(`
      UPDATE orders
      SET email_status = CASE (
        SELECT status FROM email_outbox WHERE id = ?
      )
        WHEN 'accepted' THEN 'sent'
        WHEN 'delivered' THEN 'sent'
        WHEN 'pending' THEN 'pending'
        WHEN 'delayed' THEN 'pending'
        ELSE 'failed'
      END
      WHERE id = ?
    `).bind(Number(outbox.id), Number(outbox.order_id)),
    database.prepare(`
      UPDATE email_webhook_events
      SET processing_status = 'processed', email_outbox_id = ?,
          attempt_count = attempt_count + 1, failure_code = NULL, processed_at = ?
      WHERE id = ?
    `).bind(Number(outbox.id), receivedAt, Number(record.id))
  ];
  await database.batch(statements);
  record = await getEmailWebhookEvent(database, Number(record.id));
  if (record?.processing_status !== "processed") {
    throw new Error("email_webhook_finalization_failed");
  }
  return { duplicate: false, event: record, outboxId: Number(outbox.id) };
}

function eventTransition(eventType, providerCreatedAt, fallback) {
  const timestamp = validTimestamp(providerCreatedAt) || fallback;
  if (eventType === "email.sent") {
    return transition("accepted", "accepted_at", "sent", null, "status IN ('pending', 'accepted', 'delayed')", timestamp);
  }
  if (eventType === "email.delivered") {
    return transition("delivered", "delivered_at", "sent", null, "status IN ('pending', 'accepted', 'delayed', 'delivered')", timestamp);
  }
  if (eventType === "email.delivery_delayed") {
    return transition("delayed", "delayed_at", "pending", "delivery_delayed", "status IN ('pending', 'accepted', 'delayed')", timestamp);
  }
  const status = eventType.slice("email.".length);
  return transition(status, `${status}_at`, "failed", status, `status NOT IN ('bounced', 'suppressed')`, timestamp);
}

function transition(status, timestampColumn, orderEmailStatus, failureCode, guardSql, timestamp) {
  return { failureCode, guardSql, orderEmailStatus, status, timestamp, timestampColumn };
}

async function markEmailWebhookFailure(database, record, code, attemptedAt) {
  await database.prepare(`
    UPDATE email_webhook_events
    SET processing_status = 'failed', attempt_count = attempt_count + 1, failure_code = ?
    WHERE id = ?
  `).bind(code, Number(record.id)).run();
}

function getEmailWebhookEvent(database, id) {
  return database.prepare("SELECT * FROM email_webhook_events WHERE id = ?").bind(id).first();
}

function base64Decode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function requiredString(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    status
  });
}
