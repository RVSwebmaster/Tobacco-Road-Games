import { hashToken } from "./account-auth.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 25 * 60 * 60 * 1000;
const RULES = Object.freeze({
  topic: { minimumMs: 30_000, burstMs: 15 * 60_000, burst: 3, daily: 10, ipBurst: 6, ipDaily: 20 },
  reply: { minimumMs: 10_000, burstMs: 5 * 60_000, burst: 10, daily: 50, ipBurst: 20, ipDaily: 100 },
  report: { minimumMs: 0, burstMs: 15 * 60_000, burst: 5, daily: 20, ipBurst: 10, ipDaily: 40 }
});

export async function checkForumActionLimit(request, env, db, user, action, destinationId, content, options = {}) {
  const rule = RULES[action];
  if (!rule) throw new Error("Unknown forum rate-limit action.");
  const secret = String(env.FORUM_RATE_LIMIT_SECRET || "");
  if (secret.length < 32) return unavailable();
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const nowText = new Date(now).toISOString();
  await db.prepare("DELETE FROM forum_action_events WHERE created_at < ?").bind(new Date(now - RETENTION_MS).toISOString()).run();
  const ip = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",", 1)[0].trim();
  const ipHash = await hmacIpFingerprint(secret, ip);
  const normalized = content == null ? "" : normalizeDuplicateContent(content);
  const fingerprint = normalized ? await hashToken(`forum-content|${action}|${destinationId}|${normalized}`) : null;
  const userRows = await db.prepare("SELECT created_at,content_fingerprint,destination_id FROM forum_action_events WHERE user_id=? AND action_type=? AND created_at>=? ORDER BY created_at DESC")
    .bind(user.id, action, new Date(now - DAY_MS).toISOString()).all();
  const ipRows = await db.prepare("SELECT created_at FROM forum_action_events WHERE ip_hash=? AND action_type=? AND created_at>=? ORDER BY created_at DESC")
    .bind(ipHash, action, new Date(now - DAY_MS).toISOString()).all();
  const users = userRows.results || [], ips = ipRows.results || [];
  if (fingerprint) {
    const duplicate = users.find((row) => row.destination_id === destinationId && row.content_fingerprint === fingerprint && Date.parse(row.created_at) >= now - 10 * 60_000);
    if (duplicate) return limited("That looks identical to something you just submitted. Please wait before trying it again.", retrySeconds(Date.parse(duplicate.created_at) + 10 * 60_000 - now));
  }
  if (rule.minimumMs && users[0] && Date.parse(users[0].created_at) > now - rule.minimumMs) {
    return limited("Please wait a moment before posting again.", retrySeconds(Date.parse(users[0].created_at) + rule.minimumMs - now));
  }
  const burstStart = now - rule.burstMs;
  const userBurst = users.filter((row) => Date.parse(row.created_at) >= burstStart);
  if (userBurst.length >= rule.burst) return limited("You have been posting quickly. Please take a short break and try again.", retrySeconds(Date.parse(userBurst[rule.burst - 1].created_at) + rule.burstMs - now));
  if (users.length >= rule.daily) return limited("You have reached the posting limit for now. Please try again later.", retrySeconds(Date.parse(users[rule.daily - 1].created_at) + DAY_MS - now));
  const ipBurst = ips.filter((row) => Date.parse(row.created_at) >= burstStart);
  if (ipBurst.length >= rule.ipBurst) return limited("Too many recent submissions came from this network. Please try again shortly.", retrySeconds(Date.parse(ipBurst[rule.ipBurst - 1].created_at) + rule.burstMs - now));
  if (ips.length >= rule.ipDaily) return limited("This network has reached the posting limit for now. Please try again later.", retrySeconds(Date.parse(ips[rule.ipDaily - 1].created_at) + DAY_MS - now));
  const statement = db.prepare("INSERT INTO forum_action_events (id,user_id,ip_hash,action_type,destination_id,content_fingerprint,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), user.id, ipHash, action, destinationId, fingerprint, nowText);
  return { ok: true, statement };
}

export function normalizeDuplicateContent(value) {
  return String(value).replace(/\r\n?/g, "\n").trim().replace(/[ \t]+/g, " ");
}

export async function hmacIpFingerprint(secret, ip) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`forum-ip-v1|${ip}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function limited(message, retryAfter) {
  return { ok: false, response: new Response(JSON.stringify({ error: { code: "rate_limited", message, retryAfter } }), { status: 429, headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", "retry-after": String(retryAfter) } }) };
}
function unavailable() { return { ok: false, response: new Response(JSON.stringify({ error: { code: "rate_limit_unavailable", message: "Forum posting protection is temporarily unavailable. Please try again later." } }), { status: 503, headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" } }) }; }
function retrySeconds(ms) { return Math.max(1, Math.ceil(ms / 1000)); }
