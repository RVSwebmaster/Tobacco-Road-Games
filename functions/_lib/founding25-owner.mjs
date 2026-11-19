import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { assignFounding25CommissionCategory, revokeFounding25CommissionCategory } from "./marketplace-policy.mjs";

export async function handleFounding25OwnerRequest(request, env = {}, options = {}) {
  const db = options.database || env.TRG_ORDERS;
  if (!db?.prepare) return json({ error: "Marketplace database is unavailable.", code: "bindings_unavailable" }, 503);
  if (!["GET", "POST"].includes(String(request.method || "").toUpperCase())) return json({ error: "Use GET or POST.", code: "method_not_allowed" }, 405);
  let session;
  try { session = await (options.getSession || getSessionFromRequest)(request, env, options); }
  catch { return json({ error: "Owner session could not be verified.", code: "session_unavailable" }, 503); }
  if (!session?.valid) return json({ error: "Sign in as an Owner to manage Founding-25 assignments.", code: "authentication_required" }, 401);
  if (session.user?.role !== "owner" || session.user?.status !== "active") return json({ error: "Only an active Owner may manage Founding-25 assignments.", code: "owner_required" }, 403);

  if (request.method.toUpperCase() === "GET") {
    const result = await db.prepare(`SELECT a.id,a.creator_id,c.display_name,c.slug,a.category,a.effective_at,
      a.revoked_at,a.assigned_by_user_id,a.reason,a.created_at
      FROM creator_commission_category_assignments a JOIN marketplace_creators c ON c.id=a.creator_id
      WHERE a.category='founding25' ORDER BY a.created_at DESC,a.id`).all();
    const assignments = result.results || [];
    return json({ csrfToken: session.csrfToken, activeCount: assignments.filter(row => !row.revoked_at).length,
      limit: 25, assignments });
  }

  if (!validateSameOriginRequest(request) || !(await (options.validateCsrf || validateSessionCsrf)(request, session)).valid) {
    return json({ error: "The Founding-25 management request could not be verified.", code: "csrf_rejected" }, 403);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "A valid JSON action is required.", code: "invalid_json" }, 400); }
  const action = String(body.action || "");
  const creatorId = String(body.creatorId || "").trim();
  const reason = String(body.reason || "").trim();
  const confirmation = action === "assign" ? "ASSIGN FOUNDING-25" : action === "revoke" ? "REVOKE FOUNDING-25" : "";
  if (!confirmation || !creatorId || creatorId.length > 128 || reason.length < 8 || reason.length > 500 || body.confirmation !== confirmation) {
    return json({ error: "Choose assign or revoke, provide a Creator ID and an 8–500 character reason, and enter the exact confirmation phrase.", code: "confirmation_required" }, 400);
  }
  try {
    const result = action === "assign"
      ? await assignFounding25CommissionCategory(db, { creatorId, actorUserId: session.user.id, reason, nowMs: options.nowMs })
      : await revokeFounding25CommissionCategory(db, { creatorId, actorUserId: session.user.id, reason, nowMs: options.nowMs });
    return json({ ok: true, result });
  } catch (error) {
    const message = String(error?.message || "The assignment could not be changed.");
    if (/limit reached|already has an active/i.test(message)) return json({ error: message, code: "founding25_capacity_or_assignment_conflict" }, 409);
    if (/does not exist|No active/i.test(message)) return json({ error: message, code: "creator_or_assignment_not_found" }, 404);
    if (/Only an active Owner/i.test(message)) return json({ error: message, code: "owner_required" }, 403);
    console.error(JSON.stringify({ event: "founding25_owner_action_failed", message }));
    return json({ error: "The audited Founding-25 action could not be completed.", code: "action_failed" }, 503);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
}
