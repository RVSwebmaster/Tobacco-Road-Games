import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { getForumAvatarPreset } from "./forum-avatar-presets.mjs";

export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_PREFIX = "forum-avatars/";
const ACCEPTED_MEDIA = Object.freeze({
  "image/jpeg": { extension: "jpg", signature: isJpeg },
  "image/png": { extension: "png", signature: isPng },
  "image/webp": { extension: "webp", signature: isWebp }
});

export async function handleForumAvatarMutation(request, env, options = {}) {
  if (request.method !== "POST" && request.method !== "DELETE") return jsonError("method_not_allowed", "Use POST to upload or DELETE to remove an avatar.", 405);
  const authorized = await authorize(request, env, options);
  if (!authorized.ok) return authorized.response;
  if (request.method === "DELETE") return deleteAvatar(env, authorized, options);
  return String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")
    ? selectPreset(request, env, authorized, options)
    : uploadAvatar(request, env, authorized, options);
}

export async function deliverForumAvatar(request, env, requestedHandle) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Not found", { status: 404 });
  const handle = normalizeHandle(requestedHandle);
  if (!handle) return avatarNotFound();
  const profile = await requireDb(env).prepare(`
    SELECT p.avatar_object_key, p.avatar_media_type, p.avatar_preset_id, p.avatar_version
    FROM forum_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.handle_normalized = ? AND p.status = 'active' AND u.status = 'active'
  `).bind(handle).first();
  if (!profile) return avatarNotFound();
  const preset = getForumAvatarPreset(profile.avatar_preset_id);
  if (preset) return redirectAvatar(preset.url, profile.avatar_version);
  if (!profile.avatar_object_key || !profile.avatar_media_type) return defaultAvatar(profile.avatar_version);
  const object = await requireBucket(env).get(profile.avatar_object_key);
  if (!object) return defaultAvatar();
  const requestedVersion = new URL(request.url).searchParams.get("v");
  const immutable = requestedVersion === String(profile.avatar_version);
  const headers = new Headers({
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300, stale-while-revalidate=86400",
    "content-type": profile.avatar_media_type,
    "x-content-type-options": "nosniff"
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

export function avatarPublicFields(row) {
  const version = Number(row?.avatar_version || 0);
  const selected = Boolean(row?.avatar_object_key || getForumAvatarPreset(row?.avatar_preset_id));
  return {
    avatarUrl: selected && row?.handle ? `/forum/avatar/${encodeURIComponent(row.handle)}?v=${version}` : null,
    avatarVersion: version
  };
}

export function detectImageMediaType(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  for (const [mediaType, rule] of Object.entries(ACCEPTED_MEDIA)) if (rule.signature(data)) return mediaType;
  return "";
}

async function uploadAvatar(request, env, authorized, options) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > AVATAR_MAX_BYTES) return jsonError("avatar_too_large", "Avatars must be 1 MiB or smaller.", 413);
  const submittedType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_MEDIA[submittedType]) return jsonError("avatar_format_invalid", "Upload a PNG, JPEG, or WebP image.", 415);
  const bytes = await readLimitedBytes(request, AVATAR_MAX_BYTES);
  if (!bytes.ok) return bytes.response;
  const detectedType = detectImageMediaType(bytes.value);
  if (!detectedType) return jsonError("avatar_format_invalid", "The uploaded file is not a valid PNG, JPEG, or WebP image.", 415);
  if (detectedType !== submittedType) return jsonError("avatar_mime_mismatch", "The image contents do not match the submitted media type.", 415);

  const db = requireDb(env);
  const bucket = requireBucket(env);
  const oldKey = authorized.profile.avatar_object_key || "";
  const extension = ACCEPTED_MEDIA[detectedType].extension;
  const newKey = `${AVATAR_PREFIX}${crypto.randomUUID()}.${extension}`;
  const now = nowIso(options);
  await bucket.put(newKey, bytes.value, { httpMetadata: { contentType: detectedType } });
  let result;
  try {
    result = await db.prepare(`
      UPDATE forum_profiles
      SET avatar_object_key = ?, avatar_media_type = ?, avatar_preset_id = NULL, avatar_version = avatar_version + 1,
          avatar_updated_at = ?, updated_at = ?
      WHERE user_id = ? AND status = 'active'
    `).bind(newKey, detectedType, now, now, authorized.session.user.id).run();
    if (affectedRows(result) !== 1) throw new AvatarDatabaseUpdateError();
  } catch (error) {
    await bucket.delete(newKey);
    if (error instanceof AvatarDatabaseUpdateError) return jsonError("profile_missing", "Create an active forum profile before uploading an avatar.", 404);
    throw error;
  }
  if (oldKey && oldKey !== newKey) await bucket.delete(oldKey);
  const updated = await loadOwnProfile(db, authorized.session.user.id);
  return json({ avatar: avatarPublicFields(updated) });
}

async function selectPreset(request, env, authorized, options) {
  if (Number(request.headers.get("content-length") || 0) > 4096) return jsonError("avatar_preset_invalid", "Choose a valid built-in avatar.", 400);
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096) throw new Error("too large");
    body = JSON.parse(text);
  } catch { return jsonError("avatar_preset_invalid", "Choose a valid built-in avatar.", 400); }
  const preset = getForumAvatarPreset(body?.presetId);
  if (!preset) return jsonError("avatar_preset_invalid", "Choose a valid built-in avatar.", 400);
  const db = requireDb(env);
  const oldKey = authorized.profile.avatar_object_key || "";
  const now = nowIso(options);
  const result = await db.prepare(`
    UPDATE forum_profiles
    SET avatar_object_key = NULL, avatar_media_type = NULL, avatar_preset_id = ?,
        avatar_version = avatar_version + 1, avatar_updated_at = ?, updated_at = ?
    WHERE user_id = ? AND status = 'active'
  `).bind(preset.id, now, now, authorized.session.user.id).run();
  if (affectedRows(result) !== 1) return jsonError("profile_missing", "Create an active forum profile before changing an avatar.", 404);
  if (oldKey) await requireBucket(env).delete(oldKey);
  const updated = await loadOwnProfile(db, authorized.session.user.id);
  return json({ avatar: avatarPublicFields(updated), presetId: preset.id });
}

async function deleteAvatar(env, authorized, options) {
  const db = requireDb(env);
  const bucket = requireBucket(env);
  const oldKey = authorized.profile.avatar_object_key || "";
  const now = nowIso(options);
  const result = await db.prepare(`
    UPDATE forum_profiles
    SET avatar_object_key = NULL, avatar_media_type = NULL, avatar_preset_id = NULL, avatar_version = avatar_version + 1,
        avatar_updated_at = ?, updated_at = ?
    WHERE user_id = ? AND status = 'active'
  `).bind(now, now, authorized.session.user.id).run();
  if (affectedRows(result) !== 1) return jsonError("profile_missing", "Create an active forum profile before removing an avatar.", 404);
  if (oldKey) await bucket.delete(oldKey);
  const updated = await loadOwnProfile(db, authorized.session.user.id);
  return json({ avatar: avatarPublicFields(updated) });
}

async function authorize(request, env, options) {
  if (!validateSameOriginRequest(request)) return { ok: false, response: jsonError("csrf_rejected", "This avatar request could not be verified.", 403) };
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return { ok: false, response: jsonError("not_authenticated", "Sign in before changing an avatar.", 401) };
  if (Number(session.user.email_verified) !== 1) return { ok: false, response: jsonError("email_verification_required", "Verify your account email before changing an avatar.", 403) };
  if (!(await validateSessionCsrf(request, session)).valid) return { ok: false, response: jsonError("csrf_rejected", "This avatar request could not be verified.", 403) };
  const profile = await loadOwnProfile(requireDb(env), session.user.id);
  if (!profile || profile.status !== "active") return { ok: false, response: jsonError("profile_missing", "Create an active forum profile before changing an avatar.", 404) };
  return { ok: true, profile, session };
}

async function loadOwnProfile(db, userId) {
  return db.prepare("SELECT handle, status, avatar_object_key, avatar_media_type, avatar_preset_id, avatar_version, avatar_updated_at FROM forum_profiles WHERE user_id = ?").bind(userId).first();
}

async function readLimitedBytes(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: jsonError("avatar_empty", "Choose an image to upload.", 400) };
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false, response: jsonError("avatar_too_large", "Avatars must be 1 MiB or smaller.", 413) };
    }
    chunks.push(value);
  }
  if (!total) return { ok: false, response: jsonError("avatar_empty", "Choose an image to upload.", 400) };
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, value: combined };
}

function isPng(data) { return data.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte); }
function isJpeg(data) { return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data.at(-2) === 0xff && data.at(-1) === 0xd9; }
function isWebp(data) { return data.length >= 12 && text(data, 0, 4) === "RIFF" && text(data, 8, 12) === "WEBP"; }
function text(data, start, end) { return String.fromCharCode(...data.slice(start, end)); }
function normalizeHandle(value) { try { const handle = decodeURIComponent(String(Array.isArray(value) ? value.join("/") : value || "")).toLowerCase(); return /^[a-z0-9_-]{3,24}$/.test(handle) ? handle : ""; } catch { return ""; } }
function requireDb(env) { if (!env.TRG_ORDERS?.prepare) throw new Error("Forum avatar database is unavailable."); return env.TRG_ORDERS; }
function requireBucket(env) { if (!env.TRG_FORUM_AVATARS?.put || !env.TRG_FORUM_AVATARS?.get || !env.TRG_FORUM_AVATARS?.delete) throw new Error("Forum avatar storage is unavailable."); return env.TRG_FORUM_AVATARS; }
function nowIso(options) { return new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(); }
function affectedRows(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function defaultAvatar(version = 0) { return redirectAvatar("/assets/logo.png?v=forum-avatar-default", version); }
function redirectAvatar(location, version) { return new Response(null, { status: 302, headers: { "cache-control": "public, max-age=300", location, "x-avatar-version": String(version || 0), "x-content-type-options": "nosniff" } }); }
function avatarNotFound() { return new Response("Avatar not found", { status: 404, headers: { "cache-control": "public, max-age=60", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } }); }
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "private, no-store, max-age=0", "content-type": "application/json; charset=utf-8" } }); }
function jsonError(code, message, status) { return json({ error: { code, message } }, status); }
class AvatarDatabaseUpdateError extends Error {}
