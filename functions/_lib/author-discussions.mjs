const DAY_MS = 24 * 60 * 60 * 1000;
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export async function listDiscussions(request, env) {
  const db = requireDb(env);
  await pruneDiscussions(db);
  const authorSlug = cleanSlug(new URL(request.url).searchParams.get("author"));
  if (!authorSlug) return json({ error: "Choose an author." }, 400);

  const threads = await db.prepare(`
    SELECT public_id, subject, status, created_at, last_activity_at
    FROM discussion_threads
    WHERE author_slug = ? AND EXISTS (
      SELECT 1 FROM discussion_comments c WHERE c.thread_id = discussion_threads.id AND c.status = 'published'
    )
    ORDER BY last_activity_at DESC
  `).bind(authorSlug).all();
  const output = [];
  for (const thread of threads.results || []) {
    const comments = await db.prepare(`
      SELECT public_id, parent_id, display_name, body, is_author, created_at, published_at
      FROM discussion_comments
      WHERE thread_id = (SELECT id FROM discussion_threads WHERE public_id = ?) AND status = 'published'
      ORDER BY created_at ASC
    `).bind(thread.public_id).all();
    output.push({ ...thread, comments: comments.results || [] });
  }
  return json({ threads: output });
}

export async function createDiscussionComment(request, env) {
  const db = requireDb(env);
  await pruneDiscussions(db);
  const body = await readJson(request);
  if (body.notificationsAccepted !== true) {
    return json({ error: "Agreement to receive discussion notifications is required. Nothing was recorded." }, 400);
  }
  const authorSlug = cleanSlug(body.authorSlug);
  const displayName = cleanText(body.displayName, 60);
  const email = normalizeEmail(body.email);
  const message = cleanText(body.message, 4000);
  const subject = cleanText(body.subject, 120);
  const threadPublicId = cleanId(body.threadId);
  const parentPublicId = cleanId(body.parentId);
  if (!authorSlug || !displayName || !isEmail(email) || !message) {
    return json({ error: "Display name, valid email address, and message are required." }, 400);
  }
  if (!(await allowSubmission(db, `${request.headers.get("cf-connecting-ip") || "unknown"}|${email}`))) {
    return json({ error: "Too many messages were submitted recently. Please wait and try again." }, 429);
  }

  const now = new Date().toISOString();
  let thread;
  if (threadPublicId) {
    thread = await db.prepare("SELECT id, public_id, author_slug, subject, status FROM discussion_threads WHERE public_id = ?")
      .bind(threadPublicId).first();
    if (!thread || thread.author_slug !== authorSlug || thread.status !== "open") return json({ error: "This discussion is unavailable." }, 404);
  } else {
    if (!subject) return json({ error: "A discussion subject is required." }, 400);
    const publicId = crypto.randomUUID();
    await db.prepare("INSERT INTO discussion_threads (public_id, author_slug, subject, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?)")
      .bind(publicId, authorSlug, subject, now, now).run();
    thread = await db.prepare("SELECT id, public_id, author_slug, subject, status FROM discussion_threads WHERE public_id = ?").bind(publicId).first();
  }

  let parentId = null;
  if (parentPublicId) {
    const parent = await db.prepare("SELECT id, thread_id FROM discussion_comments WHERE public_id = ? AND status = 'published'").bind(parentPublicId).first();
    if (!parent || parent.thread_id !== thread.id) return json({ error: "The comment being replied to is unavailable." }, 404);
    parentId = parent.id;
  }

  const verificationToken = randomToken();
  const verificationHash = await hashToken(verificationToken);
  const unsubscribeToken = randomToken();
  const commentPublicId = crypto.randomUUID();
  const expires = new Date(Date.now() + DAY_MS).toISOString();
  await db.prepare(`
    INSERT INTO discussion_comments
      (public_id, thread_id, parent_id, display_name, email, email_normalized, body, verification_hash, verification_expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(commentPublicId, thread.id, parentId, displayName, email, email, message, verificationHash, expires, now).run();
  await db.prepare(`
    INSERT INTO discussion_subscriptions (thread_id, email, email_normalized, display_name, unsubscribe_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, email_normalized) DO UPDATE SET active = 1, display_name = excluded.display_name
  `).bind(thread.id, email, email, displayName, unsubscribeToken, now).run();

  const base = new URL(request.url).origin;
  await sendEmail(env, {
    to: email,
    subject: `Confirm your Tobacco Road Games discussion message`,
    html: `<p>Confirm your message in “${escapeHtml(thread.subject)}”:</p><p><a href="${base}/api/discussions/verify?token=${encodeURIComponent(verificationToken)}">Verify and publish my message</a></p><p>This link expires in 24 hours.</p>`
  });
  return json({ ok: true, message: "Check your email to verify and publish your message." }, 202);
}

export async function verifyDiscussion(request, env) {
  const db = requireDb(env);
  await pruneDiscussions(db);
  const token = new URL(request.url).searchParams.get("token") || "";
  const hash = await hashToken(token);
  const comment = await db.prepare(`
    SELECT c.id, c.thread_id, c.display_name, c.body, c.email_normalized, c.verification_expires_at,
           t.public_id AS thread_public_id, t.author_slug, t.subject
    FROM discussion_comments c JOIN discussion_threads t ON t.id = c.thread_id
    WHERE c.verification_hash = ? AND c.status = 'pending'
  `).bind(hash).first();
  if (!comment || Date.parse(comment.verification_expires_at) < Date.now()) return htmlPage("Verification link expired", "This verification link is invalid or has expired.", 410);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE discussion_comments SET status = 'published', published_at = ?, verification_hash = NULL, verification_expires_at = NULL WHERE id = ?").bind(now, comment.id),
    db.prepare("UPDATE discussion_threads SET last_activity_at = ? WHERE id = ?").bind(now, comment.thread_id)
  ]);
  const authorEmail = String(env[`DISCUSSION_AUTHOR_EMAIL_${comment.author_slug.replace(/-/g, "_").toUpperCase()}`] || env.OWNER_ACCESS_EMAIL || "").trim();
  if (authorEmail) {
    await sendEmail(env, { to: authorEmail, subject: `New discussion message: ${comment.subject}`, html: `<p><strong>${escapeHtml(comment.display_name)}</strong> posted:</p><p>${escapeHtml(comment.body)}</p><p><a href="${new URL(`/authors/${comment.author_slug}/#author-discussions`, request.url)}">Open discussion</a></p>` });
  }
  const subscribers = await db.prepare("SELECT email, unsubscribe_token FROM discussion_subscriptions WHERE thread_id = ? AND active = 1 AND email_normalized <> ?")
    .bind(comment.thread_id, comment.email_normalized).all();
  const base = new URL(request.url).origin;
  await Promise.all((subscribers.results || []).map((sub) => sendEmail(env, {
    to: sub.email,
    subject: `New reply: ${comment.subject}`,
    html: `<p><strong>${escapeHtml(comment.display_name)}</strong> added a message to “${escapeHtml(comment.subject)}”.</p><p>${escapeHtml(comment.body)}</p><p><a href="${base}/authors/${comment.author_slug}/#author-discussions">Read the discussion</a></p><p><a href="${base}/api/discussions/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}">Stop notifications</a></p>`
  })));
  return htmlPage("Message published", "Your email is verified and your message is now part of the discussion.", 200, `/authors/${comment.author_slug}/#author-discussions`);
}

export async function unsubscribeDiscussion(request, env) {
  const db = requireDb(env);
  const token = new URL(request.url).searchParams.get("token") || "";
  await db.prepare("UPDATE discussion_subscriptions SET active = 0 WHERE unsubscribe_token = ?").bind(token).run();
  return htmlPage("Notifications stopped", "You will no longer receive messages from this discussion.", 200);
}

export async function createAuthorReply(request, env, ownerName = "Author") {
  const db = requireDb(env);
  await pruneDiscussions(db);
  const body = await readJson(request);
  const threadPublicId = cleanId(body.threadId);
  const parentPublicId = cleanId(body.parentId);
  const message = cleanText(body.message, 4000);
  if (!threadPublicId || !message) return json({ error: "Thread and reply text are required." }, 400);
  const thread = await db.prepare("SELECT id, public_id, author_slug, subject, status FROM discussion_threads WHERE public_id = ?").bind(threadPublicId).first();
  if (!thread || thread.status !== "open") return json({ error: "This discussion is unavailable." }, 404);
  let parentId = null;
  if (parentPublicId) parentId = (await db.prepare("SELECT id FROM discussion_comments WHERE public_id = ? AND thread_id = ?").bind(parentPublicId, thread.id).first())?.id || null;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO discussion_comments (public_id, thread_id, parent_id, display_name, email, email_normalized, body, status, is_author, created_at, published_at) VALUES (?, ?, ?, ?, '', '', ?, 'published', 1, ?, ?)`)
    .bind(crypto.randomUUID(), thread.id, parentId, ownerName || "Author", message, now, now).run();
  await db.prepare("UPDATE discussion_threads SET last_activity_at = ? WHERE id = ?").bind(now, thread.id).run();
  const subs = await db.prepare("SELECT email, unsubscribe_token FROM discussion_subscriptions WHERE thread_id = ? AND active = 1").bind(thread.id).all();
  const base = new URL(request.url).origin;
  await Promise.all((subs.results || []).map((sub) => sendEmail(env, { to: sub.email, subject: `Author reply: ${thread.subject}`, html: `<p>The author replied in “${escapeHtml(thread.subject)}”:</p><p>${escapeHtml(message)}</p><p><a href="${base}/authors/${thread.author_slug}/#author-discussions">Read the discussion</a></p><p><a href="${base}/api/discussions/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}">Stop notifications</a></p>` })));
  return json({ ok: true });
}

async function pruneDiscussions(db) {
  const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const pendingCutoff = new Date(Date.now() - DAY_MS).toISOString();
  await db.batch([
    db.prepare("DELETE FROM discussion_comments WHERE status = 'pending' AND created_at < ?").bind(pendingCutoff),
    db.prepare("DELETE FROM discussion_threads WHERE last_activity_at < ?").bind(cutoff),
    db.prepare("DELETE FROM discussion_rate_limits WHERE window_started_at < ?").bind(new Date(Date.now() - DAY_MS).toISOString())
  ]);
}

async function allowSubmission(db, identity) {
  const key = await hashToken(identity);
  const current = await db.prepare("SELECT attempt_count, window_started_at FROM discussion_rate_limits WHERE key_hash = ?").bind(key).first();
  const now = new Date();
  if (!current || Date.parse(current.window_started_at) < now.getTime() - 60 * 60 * 1000) {
    await db.prepare("INSERT INTO discussion_rate_limits (key_hash, attempt_count, window_started_at) VALUES (?, 1, ?) ON CONFLICT(key_hash) DO UPDATE SET attempt_count = 1, window_started_at = excluded.window_started_at").bind(key, now.toISOString()).run();
    return true;
  }
  if (current.attempt_count >= 5) return false;
  await db.prepare("UPDATE discussion_rate_limits SET attempt_count = attempt_count + 1 WHERE key_hash = ?").bind(key).run();
  return true;
}

async function sendEmail(env, message) {
  const key = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.DISCUSSION_FROM_EMAIL || "").trim();
  if (!key || !from) throw new Error("Discussion email delivery is not configured.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html }) });
  if (!response.ok) throw new Error("Discussion email delivery failed.");
}

function requireDb(env) { if (!env.TRG_ORDERS?.prepare) throw new Error("Discussion database is unavailable."); return env.TRG_ORDERS; }
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function cleanText(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function cleanSlug(value) { const v = String(value || "").trim().toLowerCase(); return /^[a-z0-9-]{1,80}$/.test(v) ? v : ""; }
function cleanId(value) { const v = String(value || "").trim(); return /^[a-f0-9-]{30,40}$/i.test(v) ? v : ""; }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function hashToken(token) { const bytes = new TextEncoder().encode(String(token || "")); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: jsonHeaders }); }
function htmlPage(title, message, status, returnPath = "/authors.html") { return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="page-shell"><section class="store-section"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a class="button button--primary" href="${escapeHtml(returnPath)}">Return to the discussion</a></p></section></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } }); }
