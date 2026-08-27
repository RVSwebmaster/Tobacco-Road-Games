import {
  claimWebhookEvent,
  createOrGetWebhookEvent,
  getOrderById,
  getWebhookEventById,
  markWebhookEventFailure
} from "./orders-d1.mjs";
import { repairPaidOrderFulfillment } from "./order-fulfillment.mjs";
import { OrderDeliveryError, deliverPaidOrderEmail } from "./order-delivery.mjs";
import { STRIPE_API_VERSION } from "./stripe-api.mjs";
import { creatorSaleStatements, getEffectiveFeePolicy, resolveFeePolicy } from "./creator-finance.mjs";
import {recordQualifyingActivity} from './product-inactivity.mjs';
import { processStripeCreatorFinanceEvent, STRIPE_CREATOR_FINANCE_EVENTS } from "./creator-provider-finance.mjs";

export const STRIPE_WEBHOOK_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  ...STRIPE_CREATOR_FINANCE_EVENTS
]);

const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export class StripeWebhookError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "StripeWebhookError";
    this.code = String(options.code || "stripe_webhook_error");
    this.httpStatus = Number.isInteger(options.httpStatus) ? options.httpStatus : 400;
  }
}

export async function handleStripeWebhookRequest(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS) {
    return jsonResponse({ error: "webhook_unavailable" }, 503);
  }

  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret || !webhookSecret.startsWith("whsec_")) {
    return jsonResponse({ error: "webhook_unavailable" }, 503);
  }

  let rawBody;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }
  if (!rawBody.length || rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }

  const signatureHeader = request.headers.get("stripe-signature");
  try {
    await verifyStripeSignature(rawBody, signatureHeader, webhookSecret, {
      nowMs: options.nowMs,
      toleranceSeconds: options.toleranceSeconds
    });
  } catch (error) {
    const status = error instanceof StripeWebhookError ? error.httpStatus : 400;
    return jsonResponse({ error: "invalid_signature" }, status);
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse({ error: "invalid_event_payload" }, 400);
  }

  try {
    const result = await processStripeWebhookEvent(env.TRG_ORDERS, stripeEvent, {
      nowMs: options.nowMs,
      pipelineStage: env.PAYMENT_PIPELINE_STAGE,
      processingToken: options.processingToken,
      productsBucket: env.TRG_PRODUCTS,
      deliveryEnv: env,
      deliveryFetchImpl: options.deliveryFetchImpl,
      feePolicy: await getEffectiveFeePolicy(env.TRG_ORDERS,env,options.nowMs)
    });
    return jsonResponse({
      duplicate: result.duplicate,
      ok: true,
      processingResult: result.processingResult
    }, 200);
  } catch (error) {
    if (error instanceof StripeWebhookError) {
      return jsonResponse({ error: "webhook_processing_failed", code: error.code }, error.httpStatus);
    }
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}

export async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret, options = {}) {
  const secret = String(webhookSecret || "").trim();
  if (!secret || !secret.startsWith("whsec_")) {
    throw new StripeWebhookError("The webhook signing secret is unavailable.", {
      code: "webhook_secret_unavailable",
      httpStatus: 503
    });
  }

  const parsed = parseSignatureHeader(signatureHeader);
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const toleranceSeconds = Number.isFinite(options.toleranceSeconds)
    ? Math.max(0, Number(options.toleranceSeconds))
    : SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp) > toleranceSeconds) {
    throw new StripeWebhookError("The webhook signature timestamp is outside the accepted window.", {
      code: "signature_timestamp_outside_tolerance"
    });
  }

  const prefix = new TextEncoder().encode(`${parsed.timestamp}.`);
  const payload = new Uint8Array(prefix.length + rawBody.length);
  payload.set(prefix, 0);
  payload.set(rawBody, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );

  for (const signature of parsed.v1Signatures) {
    if (await crypto.subtle.verify("HMAC", key, hexToBytes(signature), payload)) {
      return true;
    }
  }
  throw new StripeWebhookError("The webhook signature is invalid.", {
    code: "signature_mismatch"
  });
}

export async function processStripeWebhookEvent(database, stripeEvent, options = {}) {
  const eventId = requiredStripeString(stripeEvent?.id, "event_id_missing");
  const eventType = String(stripeEvent?.type || "unknown").trim() || "unknown";
  const session = stripeEvent?.data?.object && typeof stripeEvent.data.object === "object"
    ? stripeEvent.data.object
    : {};
  const internalOrderId = parsePositiveInteger(session?.metadata?.trg_order_id);
  const paymentIntentId = normalizeStripeId(session?.payment_intent);
  const receivedAt = nowIso(options.nowMs);
  const eventRecord = await createOrGetWebhookEvent(database, {
    eventAmountTotalCents: nonNegativeIntegerOrNull(session?.amount_total),
    eventCurrency: normalizedCurrencyOrNull(session?.currency),
    eventLivemode: typeof stripeEvent?.livemode === "boolean" ? stripeEvent.livemode : null,
    eventType,
    internalOrderId: null,
    provider: "stripe",
    providerEventId: eventId,
    receivedAt,
    stripeApiVersion: String(stripeEvent?.api_version || "").trim() || null,
    stripeCheckoutSessionId: normalizeStripeId(session?.id),
    stripePaymentIntentId: paymentIntentId
  });

  if(STRIPE_CREATOR_FINANCE_EVENTS.includes(eventType)&&["processed","ignored"].includes(eventRecord.event.processing_status))return{duplicate:true,event:eventRecord.event,processingResult:eventRecord.event.processing_result||"duplicate_noop"};

  if (["processed", "ignored"].includes(eventRecord.event.processing_status)) {
    const fulfillment = await repairProcessedPaidOrder(
      database,
      eventRecord.event,
      options.productsBucket,
      options.nowMs
    );
    const delivery = await deliverProcessedPaidOrder(
      database,
      eventRecord.event,
      fulfillment,
      options
    );
    return {
      duplicate: true,
      delivery,
      event: eventRecord.event,
      fulfillment,
      processingResult: eventRecord.event.processing_result || "duplicate_noop"
    };
  }

  const processingToken = String(options.processingToken || crypto.randomUUID());
  const claimed = await claimWebhookEvent(database, Number(eventRecord.event.id), processingToken, {
    attemptedAt: receivedAt
  });
  if (!claimed.claimed) {
    if(STRIPE_CREATOR_FINANCE_EVENTS.includes(eventType)&&["processed","ignored"].includes(claimed.event?.processing_status))return{duplicate:true,event:claimed.event,processingResult:claimed.event.processing_result||"duplicate_noop"};
    if (["processed", "ignored"].includes(claimed.event?.processing_status)) {
      const fulfillment = await repairProcessedPaidOrder(
        database,
        claimed.event,
        options.productsBucket,
        options.nowMs
      );
      const delivery = await deliverProcessedPaidOrder(
        database,
        claimed.event,
        fulfillment,
        options
      );
      return {
        duplicate: true,
        delivery,
        event: claimed.event,
        fulfillment,
        processingResult: claimed.event.processing_result || "duplicate_noop"
      };
    }
    throw new StripeWebhookError("The event is already being processed.", {
      code: "event_processing_in_progress",
      httpStatus: 409
    });
  }

  const fail = async (failureCode, httpStatus = 400, orderId = internalOrderId) => {
    await markWebhookEventFailure(database, Number(eventRecord.event.id), processingToken, {
      errorText: `Stripe webhook reconciliation failed: ${failureCode}.`,
      failureCode,
      internalOrderId: orderId,
      processingResult: failureCode
    });
    throw new StripeWebhookError("Stripe webhook reconciliation failed safely.", {
      code: failureCode,
      httpStatus
    });
  };

  const pipelineStage = String(options.pipelineStage || "staging").toLowerCase();
  const expectedLivemode = pipelineStage === "production";
  if (stripeEvent?.livemode !== expectedLivemode) {
    return fail(expectedLivemode ? "test_mode_rejected" : "live_mode_rejected");
  }
  if (String(stripeEvent?.api_version || "") !== STRIPE_API_VERSION) {
    return fail("stripe_api_version_mismatch");
  }

  if(STRIPE_CREATOR_FINANCE_EVENTS.includes(eventType)){
    try{const providerResult=await processStripeCreatorFinanceEvent(database,stripeEvent,{createdAt:stripeEventTimestamp(stripeEvent,receivedAt)}),result=await finalizeWebhookEvent(database,eventRecord.event,processingToken,{internalOrderId:providerResult.orderId,processingResult:providerResult.action,processingStatus:"processed",processedAt:receivedAt});return{...result,duplicate:Boolean(providerResult.duplicate),providerFinance:providerResult};}
    catch{return fail("provider_financial_accounting_failed",400,null);}
  }

  if (!STRIPE_WEBHOOK_EVENT_TYPES.includes(eventType)) {
    const result = await finalizeWebhookEvent(database, eventRecord.event, processingToken, {
      processingResult: "ignored_event_type",
      processingStatus: "ignored",
      processedAt: receivedAt
    });
    return { ...result, duplicate: false };
  }

  if (session?.object !== "checkout.session") {
    return fail("checkout_session_object_missing");
  }
  if (session?.livemode !== stripeEvent?.livemode) {
    return fail("session_event_mode_mismatch");
  }
  if (!internalOrderId) {
    return fail("trg_order_metadata_missing", 400, null);
  }

  const order = await getOrderById(database, internalOrderId);
  if (!order) {
    return fail("unknown_trg_order", 400, null);
  }
  const mismatch = reconcileCheckoutSession(order, session, paymentIntentId);
  if (mismatch) {
    return fail(mismatch, 400, Number(order.id));
  }

  let orderAction = "none";
  let processingResult = "completed_unpaid";
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(eventType)) {
    if (session.payment_status === "paid") {
      if (!paymentIntentId) {
        return fail("payment_intent_missing", 400, Number(order.id));
      }
      orderAction = "paid";
      processingResult = order.payment_status === "paid" ? "already_paid_noop" : "paid";
    } else if (eventType === "checkout.session.async_payment_succeeded") {
      return fail("async_success_not_paid", 400, Number(order.id));
    }
  } else if (eventType === "checkout.session.expired") {
    orderAction = "expired";
    processingResult = order.payment_status === "paid" ? "already_paid_noop" : "expired";
  } else if (eventType === "checkout.session.async_payment_failed") {
    orderAction = "failed";
    processingResult = order.payment_status === "paid" ? "already_paid_noop" : "async_payment_failed";
  }

  let result;
  try {
    result = await finalizeWebhookEvent(database, eventRecord.event, processingToken, {
      internalOrderId: Number(order.id),
      order,
      orderAction,
      paidAt: stripeEventTimestamp(stripeEvent, receivedAt),
      paymentIntentId,
      feePolicy: options.feePolicy,
      processingResult,
      processingStatus: "processed",
      processedAt: receivedAt
    });
  } catch (error) {
    try {
      await markWebhookEventFailure(database, Number(eventRecord.event.id), processingToken, {
        errorText: "Stripe webhook atomic finalization failed.",
        failureCode: "webhook_finalization_failed",
        internalOrderId: Number(order.id),
        processingResult: "webhook_finalization_failed"
      });
    } catch {
      // The event remains pending with its processing lease and becomes reclaimable after the lease expires.
    }
    throw new StripeWebhookError("Stripe webhook finalization failed and is retryable.", {
      cause: error,
      code: "webhook_finalization_failed",
      httpStatus: 500
    });
  }

  const fulfillment = orderAction === "paid"
    ? await repairPaidOrderFulfillment(database, options.productsBucket, Number(order.id), {
      nowMs: options.nowMs
    })
    : null;
  const delivery = orderAction === "paid"
    ? await deliverProcessedPaidOrder(database, result.event, fulfillment, options)
    : null;
  return { ...result, duplicate: false, delivery, fulfillment };
}

async function deliverProcessedPaidOrder(database, eventRecord, fulfillment, options) {
  if (String(options.deliveryEnv?.RESEND_DELIVERY_ENABLED || "").toLowerCase() !== "true") {
    return null;
  }
  const orderId = parsePositiveInteger(eventRecord?.internal_order_id);
  if (!orderId || !fulfillment?.ready) {
    return null;
  }
  try {
    const delivery = await deliverPaidOrderEmail(database, options.deliveryEnv, orderId, {
      fetchImpl: options.deliveryFetchImpl,
      nowMs: options.nowMs
    });
    if (delivery?.retryable) {
      throw new StripeWebhookError("Email delivery remains retryable.", {
        code: "order_email_retryable",
        httpStatus: 500
      });
    }
    return delivery;
  } catch (error) {
    if (error instanceof StripeWebhookError) {
      throw error;
    }
    if (error instanceof OrderDeliveryError && error.retryable) {
      throw new StripeWebhookError("Email delivery remains retryable.", {
        cause: error,
        code: error.code,
        httpStatus: 500
      });
    }
    return { errorCode: error instanceof OrderDeliveryError ? error.code : "order_email_failed", retryable: false };
  }
}

async function repairProcessedPaidOrder(database, eventRecord, productsBucket, nowMs) {
  const orderId = parsePositiveInteger(eventRecord?.internal_order_id);
  if (!orderId || eventRecord?.processing_status !== "processed") {
    return null;
  }
  const order = await getOrderById(database, orderId);
  if (!order || order.payment_status !== "paid") {
    return null;
  }
  return repairPaidOrderFulfillment(database, productsBucket, orderId, { nowMs });
}

async function finalizeWebhookEvent(database, eventRecord, processingToken, outcome) {
  if (typeof database?.batch !== "function") {
    throw new Error("Webhook finalization requires D1 transactional batch support.");
  }

  const statements = [];
  if (outcome.orderAction === "paid") {
    statements.push(database.prepare(`
      UPDATE orders
      SET payment_status = 'paid',
          paid_at = COALESCE(paid_at, ?),
          stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?)
      WHERE id = ?
        AND payment_status IN ('pending', 'failed', 'expired')
        AND stripe_checkout_session_id = ?
        AND total_cents = ?
        AND lower(currency) = lower(?)
        AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = ?)
    `).bind(
      outcome.paidAt,
      outcome.paymentIntentId,
      Number(outcome.order.id),
      outcome.order.stripe_checkout_session_id,
      Number(outcome.order.total_cents),
      outcome.order.currency,
      outcome.paymentIntentId
    ));
    statements.push(...await creatorSaleStatements(database,outcome.order,outcome.feePolicy||resolveFeePolicy({},Date.parse(outcome.paidAt)),outcome.paidAt));
  } else if (outcome.orderAction === "expired") {
    statements.push(database.prepare(`
      UPDATE orders SET payment_status = 'expired'
      WHERE id = ? AND payment_status = 'pending'
    `).bind(Number(outcome.order.id)));
  } else if (outcome.orderAction === "failed") {
    statements.push(database.prepare(`
      UPDATE orders SET payment_status = 'failed'
      WHERE id = ? AND payment_status = 'pending'
    `).bind(Number(outcome.order.id)));
  }

  statements.push(database.prepare(`
    UPDATE webhook_events
    SET processing_status = ?,
        internal_order_id = COALESCE(?, internal_order_id),
        failure_code = NULL,
        error_text = NULL,
        processing_result = ?,
        processing_token = NULL,
        processing_started_at = NULL,
        processed_at = ?
    WHERE id = ? AND processing_token = ?
  `).bind(
    outcome.processingStatus,
    Number.isInteger(outcome.internalOrderId) ? outcome.internalOrderId : null,
    outcome.processingResult,
    outcome.processedAt,
    Number(eventRecord.id),
    processingToken
  ));

  await database.batch(statements);
  if(outcome.orderAction==='paid')await recordQualifyingActivity(database,{orderId:Number(outcome.order.id),nowMs:Date.parse(outcome.paidAt)}).catch(()=>{});
  const finalizedEvent = await getWebhookEventById(database, Number(eventRecord.id));
  if (!finalizedEvent || finalizedEvent.processing_status !== outcome.processingStatus) {
    throw new Error("The webhook event did not reach its final state.");
  }
  return {
    event: finalizedEvent,
    processingResult: finalizedEvent.processing_result
  };
}

function reconcileCheckoutSession(order, session, paymentIntentId) {
  if (session.ui_mode !== "hosted_page") {
    return "checkout_ui_mode_mismatch";
  }
  if (normalizeStripeId(session.id) !== order.stripe_checkout_session_id) {
    return "checkout_session_id_mismatch";
  }
  if (String(session?.metadata?.trg_order_public_id || "") !== order.public_id) {
    return "trg_public_order_metadata_mismatch";
  }
  if (order.checkout_attempt_id
    && String(session?.metadata?.trg_checkout_attempt_id || "") !== order.checkout_attempt_id) {
    return "checkout_attempt_metadata_mismatch";
  }
  if (!Number.isInteger(session.amount_total) || Number(session.amount_total) !== Number(order.total_cents)) {
    return "amount_total_mismatch";
  }
  if (normalizedCurrencyOrNull(session.currency) !== String(order.currency || "").toUpperCase()) {
    return "currency_mismatch";
  }
  if (order.stripe_payment_intent_id && paymentIntentId !== order.stripe_payment_intent_id) {
    return "payment_intent_id_mismatch";
  }
  return null;
}

function parseSignatureHeader(header) {
  const fields = String(header || "").split(",").map((part) => part.trim()).filter(Boolean);
  const timestamps = fields.filter((field) => field.startsWith("t=")).map((field) => field.slice(2));
  const v1Signatures = fields.filter((field) => field.startsWith("v1=")).map((field) => field.slice(3));
  const timestamp = Number(timestamps[0]);
  if (!Number.isInteger(timestamp) || timestamp <= 0 || !v1Signatures.length) {
    throw new StripeWebhookError("The Stripe-Signature header is missing or malformed.", {
      code: "signature_header_malformed"
    });
  }
  if (v1Signatures.some((signature) => !/^[a-f0-9]{64}$/i.test(signature))) {
    throw new StripeWebhookError("The Stripe-Signature header is malformed.", {
      code: "signature_header_malformed"
    });
  }
  return { timestamp, v1Signatures };
}

function hexToBytes(value) {
  return Uint8Array.from(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

function normalizeStripeId(value) {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (value && typeof value.id === "string") {
    return value.id.trim() || null;
  }
  return null;
}

function normalizedCurrencyOrNull(value) {
  const currency = String(value || "").trim().toUpperCase();
  return currency.length === 3 ? currency : null;
}

function nonNegativeIntegerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(String(value || ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredStripeString(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new StripeWebhookError("The Stripe Event is missing a required identifier.", {
      code,
      httpStatus: 400
    });
  }
  return normalized;
}

function stripeEventTimestamp(event, fallback) {
  const created = Number(event?.created);
  if (!Number.isInteger(created) || created <= 0) {
    return fallback;
  }
  return new Date(created * 1000).toISOString();
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? Number(nowMs) : Date.now()).toISOString();
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}
