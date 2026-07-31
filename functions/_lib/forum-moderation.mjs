import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { checkForumActionLimit } from "./forum-rate-limits.mjs";

export const MODERATOR_ROLES = Object.freeze(["owner", "admin"]);
export const REPORT_REASONS = Object.freeze([
  ["spam", "Spam"], ["harassment", "Harassment"], ["hate_abuse", "Hate or abusive conduct"],
  ["sexual_mature", "Sexual or mature content"], ["graphic_violence", "Graphic violence"],
  ["personal_information", "Personal information"], ["copyright_ownership", "Copyright or ownership concern"], ["other", "Other"]
]);
const REASON_IDS = new Set(REPORT_REASONS.map(([id]) => id));

export async function getModeratorSession(request, env, options = {}) {
  const session = await getSessionFromRequest(request, env, options);
  return session.valid && MODERATOR_ROLES.includes(session.user.role) ? session : null;
}

export async function handleForumReport(request, env, targetType, requestedId, options = {}) {
  if (request.method !== "POST") return jsonError("method_not_allowed", "Use POST to report forum content.", 405);
  const auth = await authorizeMemberMutation(request, env, options);
  if (!auth.ok) return auth.response;
  const id = normalizeId(requestedId);
  if (!id || !["topic", "post"].includes(targetType)) return jsonError("content_not_found", "That forum content is not available.", 404);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const reason = String(parsed.body.reason || "");
  const explanation = parsed.body.explanation == null ? "" : parsed.body.explanation;
  if (!REASON_IDS.has(reason)) return jsonError("reason_invalid", "Choose a valid report reason.", 400);
  if (typeof explanation !== "string" || explanation.length > 1000) return jsonError("explanation_invalid", "Report explanations may contain up to 1,000 characters.", 400);
  const db = requireDb(env);
  const target = targetType === "topic"
    ? await db.prepare("SELECT t.id FROM forum_topics t JOIN forum_categories c ON c.id=t.category_id AND c.status='active' WHERE t.id=? AND t.status='active' AND t.moderation_state!='hidden' AND (SELECT op.moderation_state FROM forum_posts op WHERE op.topic_id=t.id AND op.status='active' ORDER BY op.created_at,op.id LIMIT 1)='active'").bind(id).first()
    : await db.prepare("SELECT p.id FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id AND t.status='active' JOIN forum_categories c ON c.id=t.category_id AND c.status='active' WHERE p.id=? AND p.status='active' AND p.moderation_state='active' AND t.moderation_state!='hidden' AND (SELECT op.moderation_state FROM forum_posts op WHERE op.topic_id=t.id AND op.status='active' ORDER BY op.created_at,op.id LIMIT 1)='active'").bind(id).first();
  if (!target) return jsonError("content_not_found", "That forum content is not available.", 404);
  const rate = await checkForumActionLimit(request, env, db, auth.session.user, "report", `${targetType}:${id}`, null, options);
  if (!rate.ok) return rate.response;
  const targetColumn = targetType === "topic" ? "reported_topic_id" : "reported_post_id";
  const duplicate = await db.prepare(`SELECT id FROM forum_reports WHERE reporting_profile_id=? AND ${targetColumn}=? AND reason_category=? AND status='open'`).bind(auth.profile.user_id, id, reason).first();
  if (duplicate) return jsonError("report_exists", "You already have an open report for this reason.", 409);
  const reportId = crypto.randomUUID(), now = nowIso(options);
  try {
    if (typeof db.batch !== "function") throw new Error("Atomic forum report writes are unavailable.");
    await db.batch([db.prepare(`INSERT INTO forum_reports (id,reporting_profile_id,${targetColumn},reason_category,explanation,status,created_at) VALUES (?,?,?,?,?,'open',?)`)
      .bind(reportId, auth.profile.user_id, id, reason, explanation || null, now), rate.statement]);
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) return jsonError("report_exists", "You already have an open report for this reason.", 409);
    throw error;
  }
  return json({ report: { createdAt: now, id: reportId, status: "open" } }, 201);
}

export async function handleModerationAction(request, env, options = {}) {
  if (request.method !== "POST") return jsonError("method_not_allowed", "Use POST for moderation actions.", 405);
  const auth = await authorizeModeratorMutation(request, env, options);
  if (!auth.ok) return auth.response;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const { action } = parsed.body;
  const targetId = normalizeId(parsed.body.targetId || parsed.body.reportId);
  const reason = typeof parsed.body.reason === "string" ? parsed.body.reason.trim() : "";
  if (!targetId) return jsonError("target_invalid", "Choose valid forum content.", 400);
  if (!reason || reason.length > 1000) return jsonError("moderation_reason_required", "An internal moderation reason is required and may contain up to 1,000 characters.", 400);
  const rules = {
    hide_post: ["post", "UPDATE forum_posts SET moderation_state='hidden',updated_at=? WHERE id=?", "hidden"],
    restore_post: ["post", "UPDATE forum_posts SET moderation_state='active',updated_at=? WHERE id=?", "active"],
    hide_topic: ["topic", "UPDATE forum_topics SET moderation_state='hidden',updated_at=? WHERE id=?", "hidden"],
    restore_topic: ["topic", "UPDATE forum_topics SET moderation_state='active',updated_at=? WHERE id=?", "active"],
    lock_topic: ["topic", "UPDATE forum_topics SET moderation_state='locked',updated_at=? WHERE id=?", "locked"],
    unlock_topic: ["topic", "UPDATE forum_topics SET moderation_state='active',updated_at=? WHERE id=?", "active"],
    pin_topic: ["topic", "UPDATE forum_topics SET is_pinned=1,updated_at=? WHERE id=?", "pinned"],
    unpin_topic: ["topic", "UPDATE forum_topics SET is_pinned=0,updated_at=? WHERE id=?", "unpinned"]
  };
  const db = requireDb(env), now = nowIso(options), logId = crypto.randomUUID();
  if (action === "resolve_report" || action === "dismiss_report") {
    const report = await db.prepare("SELECT id FROM forum_reports WHERE id=? AND status='open'").bind(targetId).first();
    if (!report) return jsonError("report_not_found", "That open report is not available.", 404);
    const status = action === "resolve_report" ? "resolved" : "dismissed";
    await requireBatch(db, [
      db.prepare("UPDATE forum_reports SET status=?,resolved_at=?,resolving_moderator_user_id=? WHERE id=? AND status='open'").bind(status, now, auth.session.user.id, targetId),
      logStatement(db, logId, auth.session.user.id, action, "report", targetId, reason, now)
    ]);
    return json({ ok: true, state: status });
  }
  const rule = rules[action];
  if (!rule) return jsonError("action_invalid", "Choose a valid moderation action.", 400);
  const [type, sql, state] = rule;
  const table = type === "topic" ? "forum_topics" : "forum_posts";
  if (!(await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(targetId).first())) return jsonError("content_not_found", "That forum content is not available.", 404);
  await requireBatch(db, [db.prepare(sql).bind(now, targetId), logStatement(db, logId, auth.session.user.id, action, type, targetId, reason, now)]);
  return json({ ok: true, state });
}

export async function renderModerationPage(request, env, options = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return forbiddenPage();
  const session = await getModeratorSession(request, env, options);
  if (!session) return forbiddenPage();
  const result = await requireDb(env).prepare(`
    SELECT r.id,r.reason_category,r.explanation,r.created_at,r.reported_topic_id,r.reported_post_id,
      t.title,t.slug,t.moderation_state AS topic_state,p.body,p.moderation_state AS post_state,p.topic_id,pt.slug AS post_topic_slug
    FROM forum_reports r
    LEFT JOIN forum_topics t ON t.id=r.reported_topic_id
    LEFT JOIN forum_posts p ON p.id=r.reported_post_id
    LEFT JOIN forum_topics pt ON pt.id=p.topic_id
    WHERE r.status='open' ORDER BY r.created_at ASC,r.id ASC
  `).all();
  const cards = (result.results || []).map(renderReportCard).join("") || `<p class="forum-notice">There are no open forum reports.</p>`;
  return htmlPage("Forum Moderation", `<section class="store-section forum-moderation"><h1>Forum Moderation</h1><p>Open member reports and evidence-preserving moderation controls.</p><div class="forum-moderation-list">${cards}</div></section><script src="/assets/js/forum-moderation.js?v=20260731a" defer></script>`);
}

function renderReportCard(row) {
  const type = row.reported_post_id ? "post" : "topic", targetId = row.reported_post_id || row.reported_topic_id;
  const topicId = row.reported_post_id ? row.topic_id : row.reported_topic_id, slug = row.reported_post_id ? row.post_topic_slug : row.slug;
  const excerpt = row.reported_post_id ? String(row.body || "").slice(0, 300) : row.title;
  const state = row.reported_post_id ? row.post_state : row.topic_state;
  const contentActions = type === "post" ? [["hide_post","Hide post"],["restore_post","Restore post"]] : [["hide_topic","Hide topic"],["restore_topic","Restore topic"],["lock_topic","Lock topic"],["unlock_topic","Unlock topic"],["pin_topic","Pin topic"],["unpin_topic","Unpin topic"]];
  const buttons = [...contentActions, ["resolve_report","Resolve report"], ["dismiss_report","Dismiss report"]].map(([action,label]) => `<button class="button button--secondary" type="submit" name="action" value="${action}">${label}</button>`).join("");
  return `<article class="forum-moderation-card"><h2>${escapeHtml(reasonLabel(row.reason_category))} report</h2><p><strong>Reported:</strong> ${escapeHtml(formatDate(row.created_at))}</p><p><strong>Current state:</strong> ${escapeHtml(state || "unknown")}</p><p class="forum-moderation-card__excerpt">${escapeHtml(excerpt)}</p>${row.explanation ? `<p><strong>Member explanation:</strong> ${escapeHtml(row.explanation)}</p>` : ""}<p><a href="/forum/topic/${encodeURIComponent(topicId)}/${encodeURIComponent(slug)}${type === "post" ? `#post-${encodeURIComponent(targetId)}` : ""}">Review reported content</a></p><form class="forum-moderation-action" data-target-id="${targetId}" data-report-id="${row.id}"><label>Internal reason<textarea name="reason" maxlength="1000" required></textarea></label><div class="forum-moderation-actions">${buttons}</div><p role="status" aria-live="polite"></p></form></article>`;
}

async function authorizeMemberMutation(request, env, options) {
  if (!validateSameOriginRequest(request)) return { ok: false, response: jsonError("csrf_rejected", "This report request could not be verified.", 403) };
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return { ok: false, response: jsonError("not_authenticated", "Sign in before reporting forum content.", 401) };
  if (Number(session.user.email_verified) !== 1) return { ok: false, response: jsonError("email_verification_required", "Verify your account before reporting forum content.", 403) };
  if (!(await validateSessionCsrf(request, session)).valid) return { ok: false, response: jsonError("csrf_rejected", "This report request could not be verified.", 403) };
  const profile = await requireDb(env).prepare("SELECT user_id FROM forum_profiles WHERE user_id=? AND status='active'").bind(session.user.id).first();
  return profile ? { ok: true, profile, session } : { ok: false, response: jsonError("profile_required", "Create an active forum profile before reporting content.", 403) };
}
async function authorizeModeratorMutation(request, env, options) {
  if (!validateSameOriginRequest(request)) return { ok: false, response: jsonError("forbidden", "Forum moderation access is forbidden.", 403) };
  const session = await getModeratorSession(request, env, options);
  if (!session || !(await validateSessionCsrf(request, session)).valid) return { ok: false, response: jsonError("forbidden", "Forum moderation access is forbidden.", 403) };
  return { ok: true, session };
}
function logStatement(db,id,user,action,type,target,reason,now) { return db.prepare("INSERT INTO forum_moderation_log (id,acting_moderator_user_id,action_type,affected_type,affected_id,internal_reason,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,user,action,type,target,reason,now); }
async function requireBatch(db, statements) { if (typeof db.batch !== "function") throw new Error("Atomic moderation writes are unavailable."); return db.batch(statements); }
async function readJson(request) { try { const body=await request.json(); return body&&typeof body==="object"&&!Array.isArray(body)?{ok:true,body}:{ok:false,response:jsonError("invalid_input","Send a valid request.",400)}; } catch { return {ok:false,response:jsonError("invalid_input","Send a valid request.",400)}; } }
function reasonLabel(id) { return REPORT_REASONS.find(([value]) => value===id)?.[1] || "Other"; }
function normalizeId(value) { const id=String(value||""); return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)?id:""; }
function nowIso(options) { return new Date(Number.isFinite(options.now)?options.now:Date.now()).toISOString(); }
function requireDb(env) { if(!env.TRG_ORDERS?.prepare) throw new Error("Forum database is unavailable."); return env.TRG_ORDERS; }
function escapeHtml(value) { return String(value||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function formatDate(value) { return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value)); }
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{"cache-control":"private, no-store","content-type":"application/json; charset=utf-8"}});}
function jsonError(code,message,status){return json({error:{code,message}},status);}
function forbiddenPage(){return htmlPage("Forbidden","<section class=\"store-section\"><h1>Forum moderation access is forbidden</h1></section>",403);}
function htmlPage(title,body,status=200){return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css"></head><body class="view-section"><main class="page-shell">${body}</main></body></html>`,{status,headers:{"content-type":"text/html; charset=utf-8"}});}
