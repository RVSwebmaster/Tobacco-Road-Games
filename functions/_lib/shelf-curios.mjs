import { getSessionFromRequest, validateSameOriginRequest } from "./account-auth.mjs";
import { buildCookie, readCookie } from "./owner-auth.mjs";
import { hmacIpFingerprint } from "./forum-rate-limits.mjs";
import { readOwnerSession } from "./owner-middleware.mjs";
import { getOwnerAccessConfig, verifyOwnerAccessRequest } from "./owner-access.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";

const CURIOS = Object.freeze({
  harimafuji: { name: "Yokozuna Harimafuji", shelfId: "bric-a-brac-1", x: 0.5, y: 0.5 }
});
const MOVE_LIMIT = 30;
const CSRF_COOKIE = "trg_curio_csrf";
const VISITOR_COOKIE = "trg_curio_visitor";
const validToken = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value || "");

export async function handleShelfCuriosRequest(request, env, options = {}) {
  if (!["GET", "POST"].includes(request.method)) return error("Use GET or POST.", 405);
  try {
    const db = requireDb(env);
    if (request.method === "GET") {
      const csrfToken = validToken(readCookie(request, CSRF_COOKIE)) ? readCookie(request, CSRF_COOKIE) : crypto.randomUUID();
      const visitorId = validToken(readCookie(request, VISITOR_COOKIE)) ? readCookie(request, VISITOR_COOKIE) : crypto.randomUUID();
      const response = json({ curios: await listCurios(db), csrfToken });
      for (const [name, value] of [[CSRF_COOKIE, csrfToken], [VISITOR_COOKIE, visitorId]]) {
        response.headers.append("set-cookie", buildCookie(name, value, { httpOnly: true, sameSite: "Strict", maxAge: 365 * 86400 }));
      }
      return response;
    }
    if (!validateSameOriginRequest(request)) return error("This shelf request could not be verified.", 403);
    const csrf = readCookie(request, CSRF_COOKIE);
    const visitorId = readCookie(request, VISITOR_COOKIE);
    if (!validToken(csrf) || request.headers.get("x-csrf-token") !== csrf || !validToken(visitorId)) {
      return error("Reload the page before moving a curio.", 403);
    }
    const session = await getSessionFromRequest(request, env, options);
    const actor = session.valid ? session.user.id : `visitor:${visitorId}`;
    let rateKey = `member:${actor}`;
    if (!session.valid) {
      const secret = String(env.FORUM_RATE_LIMIT_SECRET || env.OWNER_CSRF_SECRET || env.OWNER_SESSION_SECRET || "");
      if (secret.length < 32) return error("Visitor move protection is unavailable. Please try again later.", 503);
      rateKey = `visitor-network:${await hmacIpFingerprint(secret, request.headers.get('cf-connecting-ip') || 'unknown')}`;
    }
    const body = await readJson(request);
    if (!body || !Object.hasOwn(CURIOS, body.id)) return error("That movable curio is not available.", 400);
    if (!validPosition(body.x) || !validPosition(body.y) || !Number.isSafeInteger(body.revision) || body.revision < 0) {
      return error("The shelf position is invalid.", 400);
    }
    const now = new Date(options.nowMs ?? Date.now()).toISOString();
    const since = new Date(Date.parse(now) - 60000).toISOString();
    const eventId = crypto.randomUUID();
    // The conditional event and position update share one transaction, including the rate limit.
    const results = await db.batch([
      db.prepare(`INSERT INTO shelf_curio_events (id, curio_id, action, actor_id, rate_key, from_x, from_y, to_x, to_y, created_at)
        SELECT ?, id, 'move', ?, ?, x, y, ?, ?, ? FROM shelf_curios
        WHERE id = ? AND revision = ? AND (x != ? OR y != ?)
          AND (SELECT COUNT(*) FROM shelf_curio_events WHERE rate_key = ? AND action = 'move' AND created_at >= ?) < ?`)
        .bind(eventId, actor, rateKey, body.x, body.y, now, body.id, body.revision, body.x, body.y, rateKey, since, MOVE_LIMIT),
      db.prepare(`UPDATE shelf_curios SET x = ?, y = ?, revision = revision + 1, last_event_id = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM shelf_curio_events WHERE id = ?)`)
        .bind(body.x, body.y, eventId, now, actor, body.id, body.revision, eventId)
    ]);
    const curio = publicCurio(await db.prepare("SELECT * FROM shelf_curios WHERE id = ?").bind(body.id).first());
    if (results[0].meta.changes === 1) return json({ curio });
    if (!curio) return error("The shelf is not ready to save positions.", 503);
    if (curio.revision !== body.revision) return json({ error: "This curio was moved or reset. Its current position has been restored.", curio }, 409);
    if (curio.x === body.x && curio.y === body.y) return json({ curio });
    return json({ error: "Too many moves. Please wait a minute.", curio }, 429);
  } catch {
    return error("The shelf could not be saved or loaded. Please try again.", 503);
  }
}

export async function handleOwnerShelfCuriosRequest(request, env, options = {}) {
  if (!["GET", "POST"].includes(request.method)) return error("Use GET or POST.", 405);
  try {
    const auth = request.method === "POST"
      ? await verifyAuthenticatedOwnerMutationRequest(request, env, options)
      : getOwnerAccessConfig(env).enabled
        ? await verifyOwnerAccessRequest(request, env)
        : await readOwnerSession(request, env);
    if (!auth.valid) return error(auth.userMessage || "Owner sign-in is required.", auth.status || 401);
    const db = requireDb(env);
    if (request.method === "POST") {
      const body = await readJson(request);
      if (body?.action !== "reset") return error("Choose the reset action.", 400);
      const now = new Date(options.nowMs ?? Date.now()).toISOString();
      const actor = auth.username;
      const statements = [];
      for (const [id, definition] of Object.entries(CURIOS)) {
        const eventId = crypto.randomUUID();
        statements.push(
          db.prepare(`INSERT INTO shelf_curio_events (id, curio_id, action, actor_id, rate_key, from_x, from_y, to_x, to_y, created_at)
            SELECT ?, id, 'reset', ?, 'owner', x, y, ?, ?, ? FROM shelf_curios WHERE id = ?`)
            .bind(eventId, actor, definition.x, definition.y, now, id),
          db.prepare(`UPDATE shelf_curios SET x = ?, y = ?, revision = revision + 1, last_event_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
            .bind(definition.x, definition.y, eventId, now, actor, id)
        );
      }
      await db.batch(statements);
    }
    const activity = await db.prepare(`SELECT e.id, e.curio_id, e.action, e.actor_id, e.from_x, e.from_y, e.to_x, e.to_y, e.created_at, p.display_name AS actor_name FROM shelf_curio_events e
      LEFT JOIN user_account_profiles p ON p.user_id = e.actor_id
      ORDER BY e.created_at DESC, e.rowid DESC LIMIT 100`).all();
    const counts = await db.prepare("SELECT COUNT(*) AS moves, COUNT(DISTINCT actor_id) AS participants FROM shelf_curio_events WHERE action = 'move'").first();
    return json({ curios: await listCurios(db), activity: activity.results || [], counts });
  } catch {
    return error("The shelf controls could not be loaded or confirmed. Reload to check the current arrangement.", 503);
  }
}

async function listCurios(db) {
  const rows = await db.prepare("SELECT * FROM shelf_curios ORDER BY id").all();
  const curios = (rows.results || []).filter(row => Object.hasOwn(CURIOS, row.id)).map(publicCurio);
  if (curios.length !== Object.keys(CURIOS).length) throw new Error("Shelf migration incomplete.");
  return curios;
}

function publicCurio(row) {
  if (!row || !Object.hasOwn(CURIOS, row.id)) return null;
  return { id: row.id, shelfId: CURIOS[row.id].shelfId, name: CURIOS[row.id].name, x: row.x, y: row.y, revision: row.revision };
}

function validPosition(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function requireDb(env) {
  if (!env.TRG_ORDERS?.prepare || !env.TRG_ORDERS?.batch) throw new Error("Shelf database unavailable.");
  return env.TRG_ORDERS;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function error(message, status) { return json({ error: message }, status); }
function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "private, no-store" } });
}
