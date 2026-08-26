import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { OrderAccessError, verifyOrderAccessToken } from "./order-access.mjs";

const METHOD = "verified_email_and_order_access";

export async function handleAccountOrderClaimRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST to recover a purchase." } }, 405);
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return denied("Sign in to recover a purchase.", 401);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) return denied("The recovery request could not be verified.", 403);
  if (Number(session.user.email_verified) !== 1) return denied("Verify your account email before recovering a purchase.", 403);
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
  const order = await database.prepare("SELECT id, public_id, user_id, customer_email_normalized, payment_status FROM orders WHERE id = ?").bind(access.order_id).first();
  if (!order) return denied();
  const now = new Date(Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()).toISOString();
  if (order.payment_status !== "paid") return reject(database, order.id, session.user.id, "order_not_paid", now);
  if (order.user_id) return reject(database, order.id, session.user.id, order.user_id === session.user.id ? "already_owned" : "owned_by_another_account", now);
  if (String(order.customer_email_normalized || "").toLowerCase() !== String(session.user.email_normalized || "").toLowerCase()) {
    return reject(database, order.id, session.user.id, "email_mismatch", now);
  }
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

async function reject(database, orderId, userId, reason, now) {
  await audit(database, orderId, userId, "rejected", reason, now);
  return denied();
}
function audit(database, orderId, userId, outcome, reason, now) {
  return database.prepare(`INSERT INTO historical_order_claim_audit (order_id, user_id, outcome, verification_method, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(orderId, userId, outcome, METHOD, reason, now).run();
}
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function denied(message = "The purchase could not be recovered with the supplied access link.", status = 400) { return json({ error: { code: "claim_not_verified", message } }, status); }
function json(payload, status) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "private, no-store, max-age=0", "content-type": "application/json; charset=utf-8" } }); }
