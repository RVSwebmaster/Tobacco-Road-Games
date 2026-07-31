import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "moderator", "mod", "owner", "staff", "support",
  "tobacco-road-games", "tobaccoroadgames", "trg", "system", "deleted", "anonymous"
]);
const JSON_LIMIT = 4 * 1024;

export function validateHandle(input) {
  const handle = typeof input === "string" ? input : "";
  const normalized = handle.toLowerCase();
  if (handle.length < 3 || handle.length > 24) {
    return invalid("handle_length", "Handles must be 3 to 24 characters.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(handle)) {
    return invalid("handle_characters", "Use only letters, numbers, underscores, and hyphens.");
  }
  if (!/^[A-Za-z0-9]/.test(handle) || !/[A-Za-z0-9]$/.test(handle)) {
    return invalid("handle_edges", "A handle must begin and end with a letter or number.");
  }
  if (/[_-]{2}/.test(handle)) {
    return invalid("handle_punctuation", "Consecutive underscores or hyphens are not allowed.");
  }
  if (RESERVED_HANDLES.has(normalized)) {
    return invalid("handle_reserved", "That handle is reserved.");
  }
  return { valid: true, handle, normalized };
}

export async function handleForumProfileCollection(request, env, options = {}) {
  if (request.method === "POST") return createProfile(request, env, options);
  if (request.method === "PATCH") return editProfile(request, env, options);
  return json({ error: error("method_not_allowed", "Use POST to create or PATCH to edit a forum profile.") }, 405);
}

export async function handleForumProfilePath(request, env, handlePath, options = {}) {
  if (request.method !== "GET") return json({ error: error("method_not_allowed", "Use GET for profile lookup.") }, 405);
  if (handlePath === "me") return getMyProfile(request, env, options);
  return getPublicProfile(env, decodeURIComponent(String(handlePath || "")));
}

export async function handleHandleAvailability(request, env) {
  if (request.method !== "GET") return json({ error: error("method_not_allowed", "Use GET for handle availability.") }, 405);
  const checked = validateHandle(new URL(request.url).searchParams.get("handle") || "");
  if (!checked.valid) return json({ available: false, error: error(checked.code, checked.message) }, 400);
  const row = await requireDb(env).prepare("SELECT 1 AS found FROM forum_profiles WHERE handle_normalized = ?").bind(checked.normalized).first();
  if (row) return json({ available: false, error: error("handle_unavailable", "That handle is already in use.") }, 409);
  return json({ available: true, handle: checked.handle });
}

export async function getPublicProfile(env, requestedHandle) {
  const checked = validateHandle(requestedHandle);
  if (!checked.valid) return publicNotFound();
  const row = await requireDb(env).prepare(`
    SELECT p.handle, p.display_name, p.biography, p.created_at
    FROM forum_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.handle_normalized = ? AND p.status = 'active' AND u.status = 'active'
  `).bind(checked.normalized).first();
  return row ? json({ profile: publicProfile(row) }) : publicNotFound();
}

export async function renderPublicProfilePage(request, env, requestedHandle) {
  const checked = validateHandle(requestedHandle);
  let row = null;
  if (checked.valid) {
    row = await requireDb(env).prepare(`
      SELECT p.handle, p.display_name, p.biography, p.created_at
      FROM forum_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.handle_normalized = ? AND p.status = 'active' AND u.status = 'active'
    `).bind(checked.normalized).first();
  }
  if (!row) return htmlPage("Member not found", "That forum member is not available.", 404);
  const name = row.display_name ? `<p class="forum-member__name">${escapeHtml(row.display_name)}</p>` : "";
  const bio = row.biography ? `<p class="forum-member__bio">${escapeHtml(row.biography).replace(/\r?\n/g, "<br>")}</p>` : "";
  const joined = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(row.created_at));
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(row.handle)} | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css"></head><body class="view-section"><main class="page-shell"><section class="store-section forum-member"><p class="section-heading__kicker">Forum member</p><h1>@${escapeHtml(row.handle)}</h1>${name}${bio}<p class="forum-member__joined">Joined ${escapeHtml(joined)}</p><p><a class="button button--secondary" href="/">Tobacco Road Games home</a></p></section></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function getMyProfile(request, env, options) {
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return json({ error: error("not_authenticated", "Sign in to view your forum profile.") }, 401);
  const row = await requireDb(env).prepare("SELECT handle, display_name, biography, status, created_at, updated_at FROM forum_profiles WHERE user_id = ?").bind(session.user.id).first();
  return json({ emailVerified: Number(session.user.email_verified) === 1, profile: row ? ownProfile(row) : null });
}

async function createProfile(request, env, options) {
  const auth = await authorizeMutation(request, env, options);
  if (!auth.ok) return auth.response;
  if (Number(auth.session.user.email_verified) !== 1) return json({ error: error("email_verification_required", "Verify your account email before creating a forum profile.") }, 403);
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const checked = validateHandle(parsed.body.handle);
  if (!checked.valid) return json({ error: error(checked.code, checked.message) }, 400);
  const fields = validateProfileFields(parsed.body);
  if (!fields.valid) return json({ error: error(fields.code, fields.message) }, 400);
  const db = requireDb(env);
  if (await db.prepare("SELECT 1 AS found FROM forum_profiles WHERE user_id = ?").bind(auth.session.user.id).first()) {
    return json({ error: error("profile_exists", "This account already has a forum profile.") }, 409);
  }
  const now = nowIso(options);
  try {
    await db.prepare(`INSERT INTO forum_profiles (user_id, handle, handle_normalized, display_name, biography, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
      .bind(auth.session.user.id, checked.handle, checked.normalized, fields.displayName, fields.biography, now, now).run();
  } catch (databaseError) {
    if (!isExpectedUniqueConflict(databaseError)) throw databaseError;
    const own = await db.prepare("SELECT 1 AS found FROM forum_profiles WHERE user_id = ?").bind(auth.session.user.id).first();
    if (own) return json({ error: error("profile_exists", "This account already has a forum profile.") }, 409);
    return json({ error: error("handle_unavailable", "That handle is already in use.") }, 409);
  }
  const row = await db.prepare("SELECT handle, display_name, biography, status, created_at, updated_at FROM forum_profiles WHERE user_id = ?").bind(auth.session.user.id).first();
  return json({ profile: ownProfile(row) }, 201);
}

async function editProfile(request, env, options) {
  const auth = await authorizeMutation(request, env, options);
  if (!auth.ok) return auth.response;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (Object.prototype.hasOwnProperty.call(parsed.body, "handle")) return json({ error: error("handle_immutable", "Handles cannot be changed in this phase.") }, 400);
  const fields = validateProfileFields(parsed.body);
  if (!fields.valid) return json({ error: error(fields.code, fields.message) }, 400);
  const result = await requireDb(env).prepare("UPDATE forum_profiles SET display_name = ?, biography = ?, updated_at = ? WHERE user_id = ?")
    .bind(fields.displayName, fields.biography, nowIso(options), auth.session.user.id).run();
  if (affectedRows(result) !== 1) return json({ error: error("profile_missing", "Create a forum profile before editing it.") }, 404);
  const row = await requireDb(env).prepare("SELECT handle, display_name, biography, status, created_at, updated_at FROM forum_profiles WHERE user_id = ?").bind(auth.session.user.id).first();
  return json({ profile: ownProfile(row) });
}

async function authorizeMutation(request, env, options) {
  if (!validateSameOriginRequest(request)) return { ok: false, response: json({ error: error("csrf_rejected", "This profile request could not be verified.") }, 403) };
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return { ok: false, response: json({ error: error("not_authenticated", "Sign in before changing a forum profile.") }, 401) };
  if (!(await validateSessionCsrf(request, session)).valid) return { ok: false, response: json({ error: error("csrf_rejected", "This profile request could not be verified.") }, 403) };
  return { ok: true, session };
}

function validateProfileFields(body) {
  const displayName = body.displayName == null ? "" : body.displayName;
  const biography = body.biography == null ? "" : body.biography;
  if (typeof displayName !== "string" || displayName.length > 60) return invalid("display_name_invalid", "Display names may contain up to 60 characters.");
  if (typeof biography !== "string" || biography.length > 500) return invalid("biography_invalid", "Biographies may contain up to 500 characters.");
  return { valid: true, displayName: displayName || null, biography: biography || null };
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > JSON_LIMIT) return { ok: false, response: json({ error: error("request_too_large", "That profile request is too large.") }, 413) };
  let text;
  try { text = await request.text(); } catch { return { ok: false, response: json({ error: error("invalid_input", "Send a valid profile request.") }, 400) }; }
  if (new TextEncoder().encode(text).length > JSON_LIMIT) return { ok: false, response: json({ error: error("request_too_large", "That profile request is too large.") }, 413) };
  try {
    const body = JSON.parse(text || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? { ok: true, body } : { ok: false, response: json({ error: error("invalid_input", "Send a valid profile request.") }, 400) };
  } catch { return { ok: false, response: json({ error: error("invalid_input", "Send a valid profile request.") }, 400) }; }
}

function publicProfile(row) { return { biography: row.biography || null, displayName: row.display_name || null, handle: row.handle, joinedAt: row.created_at }; }
function ownProfile(row) { return { ...publicProfile(row), status: row.status, updatedAt: row.updated_at }; }
function publicNotFound() { return json({ error: error("profile_not_found", "That forum member is not available.") }, 404); }
function isExpectedUniqueConflict(value) { const message = String(value?.message || value); return /UNIQUE constraint failed: forum_profiles\.(handle_normalized|user_id)/i.test(message); }
function nowIso(options) { return new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(); }
function affectedRows(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function requireDb(env) { if (!env.TRG_ORDERS?.prepare) throw new Error("Forum profile database is unavailable."); return env.TRG_ORDERS; }
function invalid(code, message) { return { valid: false, code, message }; }
function error(code, message) { return { code, message }; }
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "private, no-store, max-age=0", "content-type": "application/json; charset=utf-8" } }); }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function htmlPage(title, message, status) { return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css"></head><body class="view-section"><main class="page-shell"><section class="store-section"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a class="button button--secondary" href="/">Tobacco Road Games home</a></p></section></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } }); }
