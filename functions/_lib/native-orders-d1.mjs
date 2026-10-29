import { generatePublicOrderReference } from "./order-privacy.mjs";

export async function getPreparedOrderByCheckoutAttempt(database, checkoutAttemptId) {
  const attemptId = requiredText(checkoutAttemptId, "checkoutAttemptId");
  return database.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?")
    .bind(attemptId).first();
}

export async function getNativeOrderItemSnapshots(database, orderId) {
  if (!Number.isInteger(orderId) || orderId <= 0) return [];
  const result = await database.prepare(`
    SELECT * FROM order_items
    WHERE order_id=? AND catalog_source='native_d1'
    ORDER BY id
  `).bind(orderId).all();
  return Array.isArray(result) ? result : result?.results || [];
}

export async function createOrGetNativePendingOrder(database, orderInput, itemSnapshots, options = {}) {
  if (typeof database?.batch !== "function") {
    throw new Error("Native order preparation requires D1 transactional batch support.");
  }
  const order = normalizeOrder(orderInput, options);
  const items = normalizeItems(itemSnapshots, order.createdAt);
  const existing = await getPreparedOrderByCheckoutAttempt(database, order.checkoutAttemptId);
  if (existing) return { created: false, order: existing };

  try {
    await database.batch([
      prepareOrderInsert(database, order),
      ...items.map(item => prepareItemInsert(database, order.publicId, item))
    ]);
  } catch (error) {
    const concurrent = await getPreparedOrderByCheckoutAttempt(database, order.checkoutAttemptId);
    if (concurrent) return { created: false, order: concurrent };
    throw error;
  }

  const created = await getPreparedOrderByCheckoutAttempt(database, order.checkoutAttemptId);
  if (!created) throw new Error("Native pending order could not be reloaded after creation.");
  return { created: true, order: created };
}

function prepareOrderInsert(database, order) {
  return database.prepare(`
    INSERT INTO orders(
      public_id,user_id,checkout_attempt_id,checkout_request_hash,
      checkout_session_status,checkout_updated_at,customer_email,
      customer_email_normalized,customer_email_hash,currency,subtotal_cents,
      included_tax_cents,total_cents,processor_fee_cents,net_proceeds_cents,
      payment_status,fulfillment_status,email_status,created_at,payment_source,
      settlement_method,catalog_source,native_order_state,native_prepared_at
    ) VALUES(?,?,?,?,'legacy',?,?,?,?,?,?,NULL,?,NULL,NULL,'pending','pending','pending',?,'none','no_payment','native_d1','pending',?)
  `).bind(
    order.publicId,
    order.userId,
    order.checkoutAttemptId,
    order.checkoutRequestHash,
    order.createdAt,
    order.customerEmail,
    order.customerEmailNormalized,
    order.customerEmailHash,
    order.currency,
    order.subtotalCents,
    order.totalCents,
    order.createdAt,
    order.createdAt
  );
}

function prepareItemInsert(database, publicId, item) {
  return database.prepare(`
    INSERT INTO order_items(
      order_id,product_slug,product_title_snapshot,primary_author_slug,
      author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,
      line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at,
      catalog_source,native_product_id,native_creator_id,catalog_revision,
      pricing_model_snapshot,selected_price_cents,minimum_price_cents_snapshot,
      suggested_price_cents_snapshot,publication_state_snapshot,
      product_status_snapshot,delivery_r2_key_snapshot,
      delivery_filename_snapshot,delivery_content_type_snapshot
    ) VALUES(
      (SELECT id FROM orders WHERE public_id=?),?,?,?,?,?,?,?,?,?,?,?,?,
      'native_d1',?,?,?,?,?,?,?,?,?,?,?,?
    )
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
    item.createdAt,
    item.nativeProductId,
    item.nativeCreatorId,
    item.catalogRevision,
    item.pricingModel,
    item.selectedPriceCents,
    item.minimumPriceCents,
    item.suggestedPriceCents,
    item.publicationState,
    item.productStatus,
    item.deliveryR2Key,
    item.deliveryFilename,
    item.deliveryContentType
  );
}

function normalizeOrder(input, options) {
  const createdAt = String(input?.createdAt || new Date().toISOString());
  const checkoutRequestHash = requiredText(input?.checkoutRequestHash, "checkoutRequestHash");
  if (!/^[a-f0-9]{64}$/i.test(checkoutRequestHash)) {
    throw new Error("checkoutRequestHash must be a SHA-256 digest.");
  }
  const subtotalCents = nonnegativeInteger(input?.subtotalCents, "subtotalCents");
  const totalCents = nonnegativeInteger(input?.totalCents, "totalCents");
  if (subtotalCents !== totalCents) throw new Error("Native prepared order totals must balance.");
  return {
    checkoutAttemptId: requiredText(input?.checkoutAttemptId, "checkoutAttemptId"),
    checkoutRequestHash,
    createdAt,
    currency: requiredText(input?.currency, "currency").toUpperCase(),
    customerEmail: requiredText(input?.customerEmail, "customerEmail"),
    customerEmailHash: requiredText(input?.customerEmailHash, "customerEmailHash"),
    customerEmailNormalized: requiredText(input?.customerEmailNormalized, "customerEmailNormalized"),
    publicId: String(input?.publicId || options.publicIdGenerator?.() || generatePublicOrderReference()),
    subtotalCents,
    totalCents,
    userId: optionalText(input?.userId)
  };
}

function normalizeItems(items, createdAt) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("At least one native order item snapshot is required.");
  }
  return items.map(item => {
    const effective = nonnegativeInteger(item?.effectiveUnitPriceCents, "effectiveUnitPriceCents");
    const lineTotal = nonnegativeInteger(item?.lineTotalCents, "lineTotalCents");
    const quantity = nonnegativeInteger(item?.quantity, "quantity");
    if (quantity !== 1 || lineTotal !== effective) {
      throw new Error("Native digital order snapshots require quantity one and balanced line totals.");
    }
    return {
      authorSlugsJson: requiredText(item?.authorSlugsJson, "authorSlugsJson"),
      catalogRevision: positiveInteger(item?.catalogRevision, "catalogRevision"),
      createdAt: String(item?.createdAt || createdAt),
      currency: requiredText(item?.currency, "currency").toUpperCase(),
      deliveryContentType: requiredText(item?.deliveryContentType, "deliveryContentType"),
      deliveryFilename: requiredText(item?.deliveryFilename, "deliveryFilename"),
      deliveryR2Key: requiredText(item?.deliveryR2Key, "deliveryR2Key"),
      effectiveUnitPriceCents: effective,
      lastUpdatedSnapshot: String(item?.lastUpdatedSnapshot || ""),
      lineTotalCents: lineTotal,
      listPriceCents: nonnegativeInteger(item?.listPriceCents, "listPriceCents"),
      minimumPriceCents: optionalNonnegativeInteger(item?.minimumPriceCents, "minimumPriceCents"),
      nativeCreatorId: requiredText(item?.nativeCreatorId, "nativeCreatorId"),
      nativeProductId: requiredText(item?.nativeProductId, "nativeProductId"),
      pricingModel: oneOf(item?.pricingModel, ["fixed", "free", "pwyw"], "pricingModel"),
      primaryAuthorSlug: requiredText(item?.primaryAuthorSlug, "primaryAuthorSlug"),
      productSlug: requiredText(item?.productSlug, "productSlug"),
      productStatus: requiredText(item?.productStatus, "productStatus"),
      productTitleSnapshot: requiredText(item?.productTitleSnapshot, "productTitleSnapshot"),
      publicationState: oneOf(item?.publicationState, ["published"], "publicationState"),
      quantity,
      selectedPriceCents: effective,
      suggestedPriceCents: optionalNonnegativeInteger(item?.suggestedPriceCents, "suggestedPriceCents"),
      versionSnapshot: String(item?.versionSnapshot || "")
    };
  });
}

function requiredText(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function optionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function nonnegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be nonnegative integer cents.`);
  return value;
}

function optionalNonnegativeInteger(value, name) {
  if (value === null || value === undefined) return null;
  return nonnegativeInteger(value, name);
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} is invalid.`);
  return value;
}
