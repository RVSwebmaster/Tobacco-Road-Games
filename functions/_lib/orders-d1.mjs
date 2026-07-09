import { generatePublicOrderReference } from "./order-privacy.mjs";

export async function createPendingOrder(database, orderInput, itemSnapshots, options = {}) {
  const createdAt = String(orderInput?.createdAt || new Date().toISOString());
  const publicId = String(orderInput?.publicId || options.publicIdGenerator?.() || generatePublicOrderReference());
  const normalizedOrder = {
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
    stripePaymentIntentId: nullableString(orderInput?.stripePaymentIntentId),
    subtotalCents: requiredInteger(orderInput?.subtotalCents, "subtotalCents"),
    totalCents: requiredInteger(orderInput?.totalCents, "totalCents")
  };

  return withTransaction(database, async () => {
    const insertResult = await database.prepare(`
      INSERT INTO orders (
        public_id,
        customer_email,
        customer_email_normalized,
        customer_email_hash,
        stripe_checkout_session_id,
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
        disputed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      normalizedOrder.publicId,
      normalizedOrder.customerEmail,
      normalizedOrder.customerEmailNormalized,
      normalizedOrder.customerEmailHash,
      normalizedOrder.stripeCheckoutSessionId,
      normalizedOrder.stripePaymentIntentId,
      normalizedOrder.currency,
      normalizedOrder.subtotalCents,
      normalizedOrder.includedTaxCents,
      normalizedOrder.totalCents,
      normalizedOrder.processorFeeCents,
      normalizedOrder.netProceedsCents,
      normalizedOrder.paymentStatus,
      normalizedOrder.fulfillmentStatus,
      normalizedOrder.emailStatus,
      normalizedOrder.createdAt,
      normalizedOrder.paidAt,
      normalizedOrder.completedAt,
      normalizedOrder.refundedAt,
      normalizedOrder.disputedAt
    ).run();

    const orderId = getLastInsertId(insertResult);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new Error("Pending order creation did not return an order identifier.");
    }

    await insertOrderItemSnapshots(database, orderId, itemSnapshots, {
      transactional: false
    });

    const order = await getOrderById(database, orderId);
    if (!order) {
      throw new Error("Pending order creation could not reload the inserted order.");
    }

    return order;
  });
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
      await database.prepare(`
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
      ).run();
    }
  };

  if (options.transactional === false) {
    await insertAll();
    return normalizedItems.length;
  }

  await withTransaction(database, insertAll);
  return normalizedItems.length;
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

async function withTransaction(database, callback) {
  if (typeof database?.exec !== "function") {
    return callback();
  }

  await database.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await callback();
    await database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await database.exec("ROLLBACK");
    } catch {
      // Best effort rollback only.
    }
    throw error;
  }
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
