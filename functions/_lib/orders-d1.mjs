import { generatePublicOrderReference } from "./order-privacy.mjs";

export async function createPendingOrder(database, orderInput, itemSnapshots, options = {}) {
  const createdAt = String(orderInput?.createdAt || new Date().toISOString());
  const publicId = String(orderInput?.publicId || options.publicIdGenerator?.() || generatePublicOrderReference());
  const checkoutAttemptId = nullableString(orderInput?.checkoutAttemptId);
  const checkoutRequestHash = nullableString(orderInput?.checkoutRequestHash);
  if (checkoutAttemptId && !checkoutRequestHash) {
    throw new Error("checkoutRequestHash is required when checkoutAttemptId is present.");
  }
  const normalizedOrder = {
    checkoutAttemptId,
    checkoutFailureCode: nullableString(orderInput?.checkoutFailureCode),
    checkoutRequestHash,
    checkoutSessionStatus: String(orderInput?.checkoutSessionStatus || (checkoutAttemptId ? "creating" : "legacy")),
    checkoutUpdatedAt: orderInput?.checkoutUpdatedAt || (checkoutAttemptId ? createdAt : null),
    completedAt: orderInput?.completedAt || null,
    createdAt,
    currency: requiredString(orderInput?.currency, "currency"),
    customerEmail: requiredString(orderInput?.customerEmail, "customerEmail"),
    customerEmailHash: requiredString(orderInput?.customerEmailHash, "customerEmailHash"),
    customerEmailNormalized: requiredString(orderInput?.customerEmailNormalized, "customerEmailNormalized"),
    disputedAt: orderInput?.disputedAt || null,
    emailStatus: String(orderInput?.emailStatus || "pending"),
    fulfillmentStatus: String(orderInput?.fulfillmentStatus || "pending"),
    includedTaxCents: nullableInteger(orderInput?.includedTaxCents),
    netProceedsCents: nullableInteger(orderInput?.netProceedsCents),
    paidAt: orderInput?.paidAt || null,
    paymentStatus: String(orderInput?.paymentStatus || "pending"),
    processorFeeCents: nullableInteger(orderInput?.processorFeeCents),
    publicId,
    refundedAt: orderInput?.refundedAt || null,
    stripeCheckoutSessionId: nullableString(orderInput?.stripeCheckoutSessionId),
    stripeCheckoutSessionUrl: nullableString(orderInput?.stripeCheckoutSessionUrl),
    stripePaymentIntentId: nullableString(orderInput?.stripePaymentIntentId),
    subtotalCents: requiredInteger(orderInput?.subtotalCents, "subtotalCents"),
    totalCents: requiredInteger(orderInput?.totalCents, "totalCents"),
    userId: nullableString(orderInput?.userId)
  };

  const normalizedItems = normalizeItemSnapshots(itemSnapshots);
  if (!normalizedItems.length) {
    throw new Error("At least one order item snapshot is required.");
  }

  // Cloudflare D1 rejects SQL BEGIN/COMMIT statements. D1 batch() executes its
  // prepared statements sequentially as one transaction and rolls everything
  // back if any statement fails.
  if (typeof database?.batch === "function") {
    await database.batch([
      prepareOrderInsert(database, normalizedOrder),
      ...normalizedItems.map((item) => prepareOrderItemInsertByPublicId(
        database,
        normalizedOrder.publicId,
        item
      ))
    ]);

    const order = await getOrderByPublicId(database, normalizedOrder.publicId);
    if (!order) {
      throw new Error("Pending order creation could not reload the inserted order.");
    }
    return order;
  }

  throw new Error("Pending order creation requires D1 transactional batch support.");
}

export async function insertOrderItemSnapshots(database, orderId, itemSnapshots, options = {}) {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("A valid orderId is required.");
  }

  const normalizedItems = normalizeItemSnapshots(itemSnapshots);
  if (!normalizedItems.length) {
    throw new Error("At least one order item snapshot is required.");
  }

  const insertAll = async () => {
    for (const item of normalizedItems) {
      await prepareOrderItemInsertById(database, orderId, item).run();
    }
  };

  if (options.transactional === false) {
    await insertAll();
    return normalizedItems.length;
  }

  if (typeof database?.batch === "function") {
    await database.batch(normalizedItems.map((item) => prepareOrderItemInsertById(database, orderId, item)));
    return normalizedItems.length;
  }

  throw new Error("Atomic order item insertion requires D1 transactional batch support.");
}

export async function getOrderById(database, orderId) {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return null;
  }
  return firstRow(database.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId));
}

export async function getOrderByPublicId(database, publicId) {
  const normalizedPublicId = nullableString(publicId);
  if (!normalizedPublicId) {
    return null;
  }
  return firstRow(database.prepare("SELECT * FROM orders WHERE public_id = ?").bind(normalizedPublicId));
}

export async function getOrderByCheckoutAttemptId(database, checkoutAttemptId) {
  const normalizedAttemptId = nullableString(checkoutAttemptId);
  if (!normalizedAttemptId) {
    return null;
  }
  return firstRow(database.prepare("SELECT * FROM orders WHERE checkout_attempt_id = ?").bind(normalizedAttemptId));
}

export async function createOrGetPendingOrderByCheckoutAttempt(database, orderInput, itemSnapshots, options = {}) {
  const checkoutAttemptId = requiredString(orderInput?.checkoutAttemptId, "checkoutAttemptId");
  const existingOrder = await getOrderByCheckoutAttemptId(database, checkoutAttemptId);
  if (existingOrder) {
    return { created: false, order: existingOrder };
  }

  try {
    const order = await createPendingOrder(database, orderInput, itemSnapshots, options);
    return { created: true, order };
  } catch (error) {
    const concurrentOrder = await getOrderByCheckoutAttemptId(database, checkoutAttemptId);
    if (concurrentOrder) {
      return { created: false, order: concurrentOrder };
    }
    throw error;
  }
}

export async function getOrderByStripeCheckoutSessionId(database, checkoutSessionId) {
  const normalizedSessionId = nullableString(checkoutSessionId);
  if (!normalizedSessionId) {
    return null;
  }
  return firstRow(database.prepare("SELECT * FROM orders WHERE stripe_checkout_session_id = ?").bind(normalizedSessionId));
}

export async function attachStripeCheckoutSessionId(database, orderId, checkoutSessionId) {
  const normalizedSessionId = requiredString(checkoutSessionId, "checkoutSessionId");
  await database.prepare(`
    UPDATE orders
    SET stripe_checkout_session_id = ?
    WHERE id = ?
  `).bind(normalizedSessionId, requiredInteger(orderId, "orderId")).run();
  return getOrderById(database, orderId);
}

export async function attachStripeCheckoutSession(database, orderId, sessionInput, options = {}) {
  const normalizedOrderId = requiredInteger(orderId, "orderId");
  const checkoutSessionId = requiredString(sessionInput?.id, "checkoutSessionId");
  const checkoutSessionUrl = requiredString(sessionInput?.url, "checkoutSessionUrl");
  const updatedAt = String(options.updatedAt || new Date().toISOString());

  await database.prepare(`
    UPDATE orders
    SET stripe_checkout_session_id = ?,
        stripe_checkout_session_url = ?,
        checkout_session_status = 'active',
        checkout_failure_code = NULL,
        checkout_updated_at = ?
    WHERE id = ?
      AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)
  `).bind(
    checkoutSessionId,
    checkoutSessionUrl,
    updatedAt,
    normalizedOrderId,
    checkoutSessionId
  ).run();

  const order = await getOrderById(database, normalizedOrderId);
  if (!order
    || order.stripe_checkout_session_id !== checkoutSessionId
    || order.stripe_checkout_session_url !== checkoutSessionUrl
    || order.checkout_session_status !== "active") {
    throw new Error("The Stripe Checkout Session could not be attached to the order.");
  }
  return order;
}

export async function markCheckoutAttemptTerminalFailure(database, orderId, failureCode, options = {}) {
  const normalizedOrderId = requiredInteger(orderId, "orderId");
  const updatedAt = String(options.updatedAt || new Date().toISOString());
  await database.prepare(`
    UPDATE orders
    SET payment_status = 'failed',
        fulfillment_status = 'canceled',
        email_status = 'skipped',
        checkout_session_status = 'failed_terminal',
        checkout_failure_code = ?,
        checkout_updated_at = ?
    WHERE id = ?
      AND stripe_checkout_session_id IS NULL
  `).bind(
    requiredString(failureCode, "failureCode"),
    updatedAt,
    normalizedOrderId
  ).run();
  return getOrderById(database, normalizedOrderId);
}

export async function markCheckoutAttemptRetryable(database, orderId, failureCode, options = {}) {
  const normalizedOrderId = requiredInteger(orderId, "orderId");
  const updatedAt = String(options.updatedAt || new Date().toISOString());
  await database.prepare(`
    UPDATE orders
    SET checkout_session_status = 'retryable',
        checkout_failure_code = ?,
        checkout_updated_at = ?
    WHERE id = ?
      AND payment_status = 'pending'
      AND stripe_checkout_session_id IS NULL
  `).bind(
    requiredString(failureCode, "failureCode"),
    updatedAt,
    normalizedOrderId
  ).run();
  return getOrderById(database, normalizedOrderId);
}

export async function updateOrderPaymentStatus(database, orderId, patch) {
  const updates = [];
  const values = [];

  if (patch.paymentStatus !== undefined) {
    updates.push("payment_status = ?");
    values.push(String(patch.paymentStatus));
  }
  if (patch.paidAt !== undefined) {
    updates.push("paid_at = ?");
    values.push(patch.paidAt || null);
  }
  if (patch.refundedAt !== undefined) {
    updates.push("refunded_at = ?");
    values.push(patch.refundedAt || null);
  }
  if (patch.disputedAt !== undefined) {
    updates.push("disputed_at = ?");
    values.push(patch.disputedAt || null);
  }
  if (patch.processorFeeCents !== undefined) {
    updates.push("processor_fee_cents = ?");
    values.push(nullableInteger(patch.processorFeeCents));
  }
  if (patch.netProceedsCents !== undefined) {
    updates.push("net_proceeds_cents = ?");
    values.push(nullableInteger(patch.netProceedsCents));
  }
  if (patch.includedTaxCents !== undefined) {
    updates.push("included_tax_cents = ?");
    values.push(nullableInteger(patch.includedTaxCents));
  }
  if (patch.stripePaymentIntentId !== undefined) {
    updates.push("stripe_payment_intent_id = ?");
    values.push(nullableString(patch.stripePaymentIntentId));
  }

  if (!updates.length) {
    return getOrderById(database, orderId);
  }

  values.push(requiredInteger(orderId, "orderId"));
  await database.prepare(`
    UPDATE orders
    SET ${updates.join(", ")}
    WHERE id = ?
  `).bind(...values).run();

  return getOrderById(database, orderId);
}

export async function getOrderItems(database, orderId) {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return [];
  }
  return allRows(database.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC").bind(orderId));
}

export async function recordWebhookEvent(database, eventInput) {
  const receivedAt = String(eventInput?.receivedAt || new Date().toISOString());
  const result = await database.prepare(`
    INSERT INTO webhook_events (
      provider,
      provider_event_id,
      event_type,
      processing_status,
      internal_order_id,
      error_text,
      received_at,
      processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    requiredString(eventInput?.provider, "provider"),
    requiredString(eventInput?.providerEventId, "providerEventId"),
    requiredString(eventInput?.eventType, "eventType"),
    String(eventInput?.processingStatus || "pending"),
    nullableInteger(eventInput?.internalOrderId),
    nullableString(eventInput?.errorText),
    receivedAt,
    eventInput?.processedAt || null
  ).run();

  return getWebhookEventById(database, getLastInsertId(result));
}

export async function getWebhookEventById(database, eventId) {
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return null;
  }
  return firstRow(database.prepare("SELECT * FROM webhook_events WHERE id = ?").bind(eventId));
}

export async function getWebhookEventByProviderEventId(database, provider, providerEventId) {
  const normalizedProvider = nullableString(provider);
  const normalizedEventId = nullableString(providerEventId);
  if (!normalizedProvider || !normalizedEventId) {
    return null;
  }
  return firstRow(database.prepare(`
    SELECT *
    FROM webhook_events
    WHERE provider = ? AND provider_event_id = ?
  `).bind(normalizedProvider, normalizedEventId));
}

export async function createOrGetWebhookEvent(database, eventInput) {
  const provider = requiredString(eventInput?.provider, "provider");
  const providerEventId = requiredString(eventInput?.providerEventId, "providerEventId");
  const existing = await getWebhookEventByProviderEventId(database, provider, providerEventId);
  if (existing) {
    return { created: false, event: existing };
  }

  try {
    await database.prepare(`
      INSERT INTO webhook_events (
        provider,
        provider_event_id,
        event_type,
        processing_status,
        internal_order_id,
        error_text,
        received_at,
        processed_at,
        attempt_count,
        failure_code,
        processing_result,
        event_livemode,
        stripe_api_version,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        event_amount_total_cents,
        event_currency
      ) VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, 0, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).bind(
      provider,
      providerEventId,
      requiredString(eventInput?.eventType, "eventType"),
      nullableInteger(eventInput?.internalOrderId),
      String(eventInput?.receivedAt || new Date().toISOString()),
      eventInput?.eventLivemode === true ? 1 : eventInput?.eventLivemode === false ? 0 : null,
      nullableString(eventInput?.stripeApiVersion),
      nullableString(eventInput?.stripeCheckoutSessionId),
      nullableString(eventInput?.stripePaymentIntentId),
      nullableInteger(eventInput?.eventAmountTotalCents),
      nullableString(eventInput?.eventCurrency)?.toUpperCase() || null
    ).run();
  } catch (error) {
    const concurrent = await getWebhookEventByProviderEventId(database, provider, providerEventId);
    if (concurrent) {
      return { created: false, event: concurrent };
    }
    throw error;
  }

  const created = await getWebhookEventByProviderEventId(database, provider, providerEventId);
  if (!created) {
    throw new Error("Webhook event insertion could not reload the inserted event.");
  }
  return { created: true, event: created };
}

export async function claimWebhookEvent(database, eventId, processingToken, options = {}) {
  const normalizedEventId = requiredInteger(eventId, "eventId");
  const token = requiredString(processingToken, "processingToken");
  const attemptedAt = String(options.attemptedAt || new Date().toISOString());
  const staleBefore = String(options.staleBefore || new Date(Date.parse(attemptedAt) - 5 * 60 * 1000).toISOString());
  const result = await database.prepare(`
    UPDATE webhook_events
    SET processing_token = ?,
        processing_started_at = ?,
        last_attempt_at = ?,
        attempt_count = attempt_count + 1,
        processing_status = 'pending',
        failure_code = NULL,
        error_text = NULL
    WHERE id = ?
      AND processing_status IN ('pending', 'failed')
      AND (
        processing_token IS NULL
        OR processing_started_at IS NULL
        OR processing_started_at < ?
      )
  `).bind(token, attemptedAt, attemptedAt, normalizedEventId, staleBefore).run();

  return {
    claimed: getRunChangeCount(result) === 1,
    event: await getWebhookEventById(database, normalizedEventId)
  };
}

export async function markWebhookEventFailure(database, eventId, processingToken, failureInput = {}) {
  const normalizedEventId = requiredInteger(eventId, "eventId");
  const token = requiredString(processingToken, "processingToken");
  await database.prepare(`
    UPDATE webhook_events
    SET processing_status = 'failed',
        internal_order_id = COALESCE(?, internal_order_id),
        failure_code = ?,
        error_text = ?,
        processing_result = ?,
        processing_token = NULL,
        processing_started_at = NULL,
        processed_at = NULL
    WHERE id = ? AND processing_token = ?
  `).bind(
    nullableInteger(failureInput?.internalOrderId),
    requiredString(failureInput?.failureCode, "failureCode"),
    nullableString(failureInput?.errorText) || "Webhook processing failed safely.",
    nullableString(failureInput?.processingResult),
    normalizedEventId,
    token
  ).run();
  return getWebhookEventById(database, normalizedEventId);
}

function prepareOrderInsert(database, order) {
  return database.prepare(`
    INSERT INTO orders (
      public_id,
      user_id,
      checkout_attempt_id,
      checkout_request_hash,
      checkout_session_status,
      checkout_failure_code,
      customer_email,
      customer_email_normalized,
      customer_email_hash,
      stripe_checkout_session_id,
      stripe_checkout_session_url,
      stripe_payment_intent_id,
      currency,
      subtotal_cents,
      included_tax_cents,
      total_cents,
      processor_fee_cents,
      net_proceeds_cents,
      payment_status,
      fulfillment_status,
      email_status,
      created_at,
      paid_at,
      completed_at,
      refunded_at,
      disputed_at,
      checkout_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    order.publicId,
    order.userId,
    order.checkoutAttemptId,
    order.checkoutRequestHash,
    order.checkoutSessionStatus,
    order.checkoutFailureCode,
    order.customerEmail,
    order.customerEmailNormalized,
    order.customerEmailHash,
    order.stripeCheckoutSessionId,
    order.stripeCheckoutSessionUrl,
    order.stripePaymentIntentId,
    order.currency,
    order.subtotalCents,
    order.includedTaxCents,
    order.totalCents,
    order.processorFeeCents,
    order.netProceedsCents,
    order.paymentStatus,
    order.fulfillmentStatus,
    order.emailStatus,
    order.createdAt,
    order.paidAt,
    order.completedAt,
    order.refundedAt,
    order.disputedAt,
    order.checkoutUpdatedAt
  );
}

function prepareOrderItemInsertById(database, orderId, item) {
  return database.prepare(`
    INSERT INTO order_items (
      order_id,
      product_slug,
      product_title_snapshot,
      primary_author_slug,
      author_slugs_json,
      quantity,
      list_price_cents,
      effective_unit_price_cents,
      line_total_cents,
      currency,
      version_snapshot,
      last_updated_snapshot,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    orderId,
    item.productSlug,
    item.productTitleSnapshot,
    item.primaryAuthorSlug,
    item.authorSlugsJson,
    item.quantity,
    item.listPriceCents,
    item.effectiveUnitPriceCents,
    item.lineTotalCents,
    item.currency,
    item.versionSnapshot,
    item.lastUpdatedSnapshot,
    item.createdAt
  );
}

function prepareOrderItemInsertByPublicId(database, publicId, item) {
  return database.prepare(`
    INSERT INTO order_items (
      order_id,
      product_slug,
      product_title_snapshot,
      primary_author_slug,
      author_slugs_json,
      quantity,
      list_price_cents,
      effective_unit_price_cents,
      line_total_cents,
      currency,
      version_snapshot,
      last_updated_snapshot,
      created_at
    ) VALUES ((SELECT id FROM orders WHERE public_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    publicId,
    item.productSlug,
    item.productTitleSnapshot,
    item.primaryAuthorSlug,
    item.authorSlugsJson,
    item.quantity,
    item.listPriceCents,
    item.effectiveUnitPriceCents,
    item.lineTotalCents,
    item.currency,
    item.versionSnapshot,
    item.lastUpdatedSnapshot,
    item.createdAt
  );
}

function normalizeItemSnapshots(itemSnapshots) {
  return ensureArray(itemSnapshots).map((item) => ({
    authorSlugsJson: requiredString(item?.authorSlugsJson, "authorSlugsJson"),
    createdAt: String(item?.createdAt || new Date().toISOString()),
    currency: requiredString(item?.currency, "currency"),
    effectiveUnitPriceCents: requiredInteger(item?.effectiveUnitPriceCents, "effectiveUnitPriceCents"),
    lastUpdatedSnapshot: String(item?.lastUpdatedSnapshot || ""),
    lineTotalCents: requiredInteger(item?.lineTotalCents, "lineTotalCents"),
    listPriceCents: requiredInteger(item?.listPriceCents, "listPriceCents"),
    primaryAuthorSlug: requiredString(item?.primaryAuthorSlug ?? "", "primaryAuthorSlug"),
    productSlug: requiredString(item?.productSlug, "productSlug"),
    productTitleSnapshot: requiredString(item?.productTitleSnapshot, "productTitleSnapshot"),
    quantity: requiredInteger(item?.quantity, "quantity"),
    versionSnapshot: String(item?.versionSnapshot || "")
  }));
}

async function firstRow(statement) {
  return statement.first();
}

async function allRows(statement) {
  const result = await statement.all();
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result?.results) ? result.results : [];
}

function getLastInsertId(runResult) {
  const candidate = runResult?.meta?.last_row_id
    ?? runResult?.meta?.lastRowId
    ?? runResult?.lastInsertRowid
    ?? runResult?.lastInsertRowId;
  if (typeof candidate === "bigint") {
    return Number(candidate);
  }
  return Number.isInteger(candidate) ? candidate : Number(candidate);
}

function getRunChangeCount(runResult) {
  const candidate = runResult?.meta?.changes ?? runResult?.changes;
  if (typeof candidate === "bigint") {
    return Number(candidate);
  }
  return Number(candidate || 0);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function requiredInteger(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return value;
}

function nullableInteger(value) {
  return Number.isInteger(value) ? value : null;
}

function requiredString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function nullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
