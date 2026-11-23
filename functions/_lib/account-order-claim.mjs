import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { OrderAccessError, verifyOrderAccessToken } from "./order-access.mjs";
import { isNativeGuestClaimEnabled } from "./native-guest-purchase-policy.mjs";

const METHOD = "verified_email_and_order_access";

export async function handleAccountOrderClaimRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST to recover a purchase." } }, 405);
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return denied("Sign in to recover a purchase.", 401);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) return denied("The recovery request could not be verified.", 403);
  const body = await readJson(request);
  const credential = String(body?.credential || "").trim();
  if (!credential || credential.length > 2048) return denied();
  const database = options.database || env.TRG_ORDERS;
  let access;
  try {
    access = await verifyOrderAccessToken(database, credential, options.orderAccessSecret || env.ORDER_ACCESS_SIGNING_SECRET, { nowMs: options.nowMs });
  } catch (error) {
    if (!(error instanceof OrderAccessError)) throw error;
    return denied();
  }
  const order = await loadClaimOrder(database, access.order_id);
  if (!order) return denied();
  const now = new Date(Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()).toISOString();
  if (order.payment_status !== "paid") return reject(database, order.id, session.user.id, "order_not_paid", now);
  if (String(order.customer_email_normalized || "").toLowerCase() !== String(session.user.email_normalized || "").toLowerCase()) {
    return reject(database, order.id, session.user.id, "email_mismatch", now);
  }
  if (order.catalog_source === "native_d1") {
    if (!isNativeGuestClaimEnabled(env, options)) {
      return json({ error: { code: "native_guest_claim_unavailable", message: "Native guest purchase claiming is temporarily unavailable." } }, 503);
    }
    return claimNativeOrder(database, order, session.user.id, now, access);
  }
  if (order.user_id) return reject(database, order.id, session.user.id, order.user_id === session.user.id ? "already_owned" : "owned_by_another_account", now);
  let results;
  try {
    results = await database.batch([
      database.prepare("UPDATE orders SET user_id = ? WHERE id = ? AND user_id IS NULL").bind(session.user.id, order.id),
      database.prepare(`INSERT INTO historical_order_claim_audit (order_id, user_id, outcome, verification_method, reason_code, created_at) SELECT ?, ?, 'succeeded', ?, 'claimed', ? WHERE changes() = 1`).bind(order.id, session.user.id, METHOD, now)
    ]);
  } catch {
    return reject(database, order.id, session.user.id, "ownership_conflict", now);
  }
  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) return reject(database, order.id, session.user.id, "ownership_conflict", now);
  return json({ ok: true, message: "Purchase recovered. It is now available in My Library.", orderReference: order.public_id }, 200);
}

async function claimNativeOrder(database, order, userId, now, access) {
  if (access?.consumed_by_user_id && access.consumed_by_user_id !== userId) {
    return reject(database, order.id, userId, "credential_already_claimed", now);
  }
  const complete = await nativeClaimIsComplete(database, order.id, userId);
  if (order.user_id === userId && complete) {
    if (!access?.consumed_by_user_id) {
      await bindClaimCredential(database, access?.id, userId, now);
    }
    return claimSuccess(order.public_id, true);
  }
  if (order.user_id && order.user_id !== userId) {
    return reject(database, order.id, userId, "owned_by_another_account", now);
  }
  if (order.native_order_state !== "paid" || order.native_entitlement_status !== "ready") {
    return reject(database, order.id, userId, "native_entitlements_not_ready", now);
  }
  const counts = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM order_items WHERE order_id=? AND catalog_source='native_d1') AS item_count,
      (SELECT COUNT(*) FROM native_product_entitlements WHERE order_id=? AND status='active') AS entitlement_count,
      (SELECT COUNT(*) FROM native_product_entitlements WHERE order_id=? AND status='active' AND purchaser_user_id IS NOT NULL AND purchaser_user_id<>?) AS conflicting_count
  `).bind(order.id, order.id, order.id, userId).first();
  if (!Number(counts?.item_count) || Number(counts.item_count) !== Number(counts.entitlement_count)) {
    return reject(database, order.id, userId, "native_entitlements_not_ready", now);
  }
  if (Number(counts.conflicting_count)) {
    return reject(database, order.id, userId, "ownership_conflict", now);
  }
  try {
    await database.batch([
      database.prepare("UPDATE orders SET user_id=? WHERE id=? AND user_id IS NULL").bind(userId, order.id),
      database.prepare("UPDATE native_product_entitlements SET purchaser_user_id=? WHERE order_id=? AND status='active' AND purchaser_user_id IS NULL").bind(userId, order.id),
      database.prepare(`
        UPDATE order_access_credentials
        SET consumed_at=?, consumed_by_user_id=?
        WHERE id=? AND consumed_at IS NULL AND consumed_by_user_id IS NULL
      `).bind(now, userId, Number(access?.id)),
      database.prepare(`
        INSERT INTO historical_order_claim_audit(order_id,user_id,outcome,verification_method,reason_code,created_at)
        SELECT ?,?,'succeeded',?,'native_claimed',?
        WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND user_id=? AND catalog_source='native_d1')
          AND NOT EXISTS(SELECT 1 FROM native_product_entitlements WHERE order_id=? AND status='active' AND purchaser_user_id<>?)
          AND EXISTS(SELECT 1 FROM order_access_credentials WHERE id=? AND consumed_by_user_id=?)
      `).bind(order.id, userId, METHOD, now, order.id, userId, order.id, userId, Number(access?.id), userId)
    ]);
  } catch {
    const repaired = await nativeClaimIsComplete(database, order.id, userId);
    if (repaired) return claimSuccess(order.public_id, true);
    return reject(database, order.id, userId, "ownership_conflict", now);
  }
  if (!(await nativeClaimIsComplete(database, order.id, userId))) {
    return reject(database, order.id, userId, "ownership_conflict", now);
  }
  if (!(await claimCredentialIsBound(database, access?.id, userId))) {
    return reject(database, order.id, userId, "credential_consumption_failed", now);
  }
  return claimSuccess(order.public_id, false);
}

async function bindClaimCredential(database, credentialId, userId, now) {
  const id = Number(credentialId);
  if (!Number.isInteger(id) || id < 1) return false;
  await database.prepare(`
    UPDATE order_access_credentials
    SET consumed_at=?, consumed_by_user_id=?
    WHERE id=? AND consumed_at IS NULL AND consumed_by_user_id IS NULL
  `).bind(now, userId, id).run();
  return claimCredentialIsBound(database, id, userId);
}

async function claimCredentialIsBound(database, credentialId, userId) {
  const id = Number(credentialId);
  if (!Number.isInteger(id) || id < 1) return false;
  const row = await database.prepare(`
    SELECT consumed_by_user_id FROM order_access_credentials WHERE id=?
  `).bind(id).first();
  return row?.consumed_by_user_id === userId;
}

async function nativeClaimIsComplete(database, orderId, userId) {
  const row = await database.prepare(`
    SELECT o.user_id,
      (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND catalog_source='native_d1') AS item_count,
      (SELECT COUNT(*) FROM native_product_entitlements WHERE order_id=o.id AND status='active' AND purchaser_user_id=?) AS owned_count,
      (SELECT COUNT(*) FROM native_product_entitlements WHERE order_id=o.id AND status='active') AS entitlement_count
    FROM orders o WHERE o.id=? AND o.catalog_source='native_d1'
  `).bind(userId, orderId).first();
  return Boolean(row && row.user_id === userId && Number(row.item_count) > 0
    && Number(row.item_count) === Number(row.entitlement_count)
    && Number(row.item_count) === Number(row.owned_count));
}

function claimSuccess(orderReference, duplicate) {
  return json({
    ok: true,
    duplicate: duplicate === true,
    message: "Purchase recovered. It is now available in My Library.",
    orderReference
  }, 200);
}

async function reject(database, orderId, userId, reason, now) {
  await audit(database, orderId, userId, "rejected", reason, now);
  return denied();
}
function audit(database, orderId, userId, outcome, reason, now) {
  return database.prepare(`INSERT INTO historical_order_claim_audit (order_id, user_id, outcome, verification_method, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(orderId, userId, outcome, METHOD, reason, now).run();
}
async function loadClaimOrder(database, orderId) {
  try {
    return await database.prepare("SELECT id, public_id, user_id, customer_email_normalized, payment_status, catalog_source, native_order_state, native_entitlement_status FROM orders WHERE id = ?").bind(orderId).first();
  } catch (error) {
    if (!/no such column:\s*(catalog_source|native_order_state|native_entitlement_status)/i.test(String(error))) throw error;
    return database.prepare("SELECT id, public_id, user_id, customer_email_normalized, payment_status, 'legacy' AS catalog_source, NULL AS native_order_state, NULL AS native_entitlement_status FROM orders WHERE id = ?").bind(orderId).first();
  }
}
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function denied(message = "The purchase could not be recovered with the supplied access link.", status = 400) { return json({ error: { code: "claim_not_verified", message } }, status); }
function json(payload, status) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "private, no-store, max-age=0", "content-type": "application/json; charset=utf-8" } }); }
