import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { avatarPublicFields } from "./forum-avatars.mjs";

const JSON_LIMIT = 24 * 1024;

export async function handleForumTopicsCollection(request, env, options = {}) {
  if (request.method !== "POST") return jsonError("method_not_allowed", "Use POST to create a forum topic.", 405);
  const auth = await authorizeCreation(request, env, options);
  if (!auth.ok) return auth.response;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const fields = validateTopicInput(parsed.body);
  if (!fields.valid) return jsonError(fields.code, fields.message, 400);
  const db = requireDb(env);
  const category = await db.prepare("SELECT id, slug FROM forum_categories WHERE slug = ? AND status = 'active'").bind(fields.categorySlug).first();
  if (!category) return jsonError("category_not_found", "That forum category is not available.", 404);
  const topicId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const now = nowIso(options);
  const slug = slugify(fields.title);
  const topicStatement = db.prepare(`
    INSERT INTO forum_topics (id, category_id, creator_profile_id, title, slug, status, created_at, updated_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(topicId, category.id, auth.profile.user_id, fields.title, slug, now, now, now);
  const postStatement = db.prepare(`
    INSERT INTO forum_posts (id, topic_id, author_profile_id, body, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(postId, topicId, auth.profile.user_id, fields.body, now, now);
  if (typeof db.batch !== "function") throw new Error("Atomic forum topic writes are unavailable.");
  await db.batch([topicStatement, postStatement]);
  return json({ topic: { categorySlug: category.slug, createdAt: now, id: topicId, postCount: 1, slug, title: fields.title, url: `/forum/topic/${topicId}/${slug}` } }, 201);
}

export async function handleCategoryTopicsApi(request, env, requestedSlug) {
  if (request.method !== "GET") return jsonError("method_not_allowed", "Use GET for category topics.", 405);
  const slug = normalizeSlug(requestedSlug);
  if (!slug) return publicNotFound("category_not_found", "That forum category is not available.");
  const category = await requireDb(env).prepare("SELECT id, slug, display_name, description FROM forum_categories WHERE slug = ? AND status = 'active'").bind(slug).first();
  if (!category) return publicNotFound("category_not_found", "That forum category is not available.");
  return json({ category: { description: category.description, name: category.display_name, slug: category.slug }, topics: await listCategoryTopics(env, category.id) }, 200, { "cache-control": "public, max-age=30" });
}

export async function handleTopicApi(request, env, requestedId) {
  if (request.method !== "GET") return jsonError("method_not_allowed", "Use GET for forum topics.", 405);
  const topic = await loadPublicTopic(env, requestedId);
  return topic ? json({ topic: publicTopic(topic) }, 200, { "cache-control": "public, max-age=30" }) : publicNotFound("topic_not_found", "That forum topic is not available.");
}

export async function renderForumTopic(request, env, requestedId, requestedSlug) {
  if (request.method !== "GET" && request.method !== "HEAD") return topicNotFound();
  const topic = await loadPublicTopic(env, requestedId);
  if (!topic) return topicNotFound();
  if (requestedSlug !== topic.slug) return new Response(null, { status: 302, headers: { location: `/forum/topic/${encodeURIComponent(topic.id)}/${encodeURIComponent(topic.slug)}` } });
  const avatar = avatarPublicFields(topic);
  const displayName = topic.display_name ? `<p class="forum-post__display-name">${escapeHtml(topic.display_name)}</p>` : "";
  const body = renderPlainText(topic.body);
  return htmlResponse(pageShell({
    title: topic.title,
    body: `<section class="store-section forum-topic" aria-labelledby="topic-heading">
      <p class="section-heading__kicker"><a href="/forum/category/${encodeURIComponent(topic.category_slug)}">${escapeHtml(topic.category_name)}</a></p>
      <h1 id="topic-heading">${escapeHtml(topic.title)}</h1>
      <article class="forum-post forum-post--opening">
        <aside class="forum-post__author" aria-label="Opening post author">
          <img class="forum-avatar forum-avatar--large" src="${avatar.avatarUrl || "/assets/logo.png?v=forum-avatar-default"}" alt="${escapeHtml(topic.handle)} forum avatar">
          <p><a href="/forum/member/${encodeURIComponent(topic.handle)}">@${escapeHtml(topic.handle)}</a></p>
          ${displayName}
          <p class="forum-post__meta">Joined ${formatDate(topic.profile_created_at)}</p>
        </aside>
        <div class="forum-post__content"><p class="forum-post__meta">Posted ${formatDate(topic.post_created_at)}</p><div class="forum-post__body">${body}</div></div>
      </article>
      <div class="forum-notice" role="status"><h2>Replies are not enabled yet</h2><p>This topic currently contains its opening post. Replies will arrive in a later forum phase.</p></div>
    </section>`
  }));
}

export async function listCategoryTopics(env, categoryId) {
  const result = await requireDb(env).prepare(`
    SELECT t.id, t.title, t.slug, t.created_at, t.last_activity_at,
           p.handle, p.display_name, p.avatar_object_key, p.avatar_preset_id, p.avatar_version,
           COUNT(posts.id) AS post_count
    FROM forum_topics t
    JOIN forum_profiles p ON p.user_id = t.creator_profile_id AND p.status = 'active'
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    LEFT JOIN forum_posts posts ON posts.topic_id = t.id AND posts.status = 'active'
    WHERE t.category_id = ? AND t.status = 'active'
    GROUP BY t.id, t.title, t.slug, t.created_at, t.last_activity_at,
             p.handle, p.display_name, p.avatar_object_key, p.avatar_preset_id, p.avatar_version
    ORDER BY t.last_activity_at DESC, t.created_at DESC, t.id DESC
  `).bind(categoryId).all();
  return (result.results || []).map((row) => ({
    creator: { avatarUrl: avatarPublicFields(row).avatarUrl, displayName: row.display_name || null, handle: row.handle },
    createdAt: row.created_at,
    id: row.id,
    lastActivityAt: row.last_activity_at,
    postCount: Number(row.post_count || 0),
    slug: row.slug,
    title: row.title,
    url: `/forum/topic/${row.id}/${row.slug}`
  }));
}

export async function getEligibleTopicCreator(request, env, options = {}) {
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid || Number(session.user.email_verified) !== 1) return null;
  const profile = await requireDb(env).prepare("SELECT user_id, handle FROM forum_profiles WHERE user_id = ? AND status = 'active'").bind(session.user.id).first();
  return profile ? { handle: profile.handle } : null;
}

async function authorizeCreation(request, env, options) {
  if (!validateSameOriginRequest(request)) return { ok: false, response: jsonError("csrf_rejected", "This topic request could not be verified.", 403) };
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return { ok: false, response: jsonError("not_authenticated", "Sign in before creating a topic.", 401) };
  if (Number(session.user.email_verified) !== 1) return { ok: false, response: jsonError("email_verification_required", "Verify your account email before creating a topic.", 403) };
  if (!(await validateSessionCsrf(request, session)).valid) return { ok: false, response: jsonError("csrf_rejected", "This topic request could not be verified.", 403) };
  const profile = await requireDb(env).prepare("SELECT user_id, status FROM forum_profiles WHERE user_id = ?").bind(session.user.id).first();
  if (!profile || profile.status !== "active") return { ok: false, response: jsonError("profile_required", "Create an active forum profile before creating a topic.", 403) };
  return { ok: true, profile, session };
}

async function loadPublicTopic(env, requestedId) {
  const id = normalizeId(requestedId);
  if (!id) return null;
  return requireDb(env).prepare(`
    SELECT t.id, t.title, t.slug, t.created_at, t.last_activity_at,
           c.slug AS category_slug, c.display_name AS category_name,
           post.id AS post_id, post.body, post.created_at AS post_created_at,
           p.handle, p.display_name, p.created_at AS profile_created_at,
           p.avatar_object_key, p.avatar_preset_id, p.avatar_version
    FROM forum_topics t
    JOIN forum_categories c ON c.id = t.category_id AND c.status = 'active'
    JOIN forum_posts post ON post.topic_id = t.id AND post.status = 'active'
    JOIN forum_profiles p ON p.user_id = post.author_profile_id AND p.status = 'active'
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    WHERE t.id = ? AND t.status = 'active'
    ORDER BY post.created_at ASC, post.id ASC
    LIMIT 1
  `).bind(id).first();
}

function publicTopic(row) {
  return {
    author: { avatarUrl: avatarPublicFields(row).avatarUrl, displayName: row.display_name || null, handle: row.handle, joinedAt: row.profile_created_at },
    category: { name: row.category_name, slug: row.category_slug },
    createdAt: row.created_at,
    id: row.id,
    lastActivityAt: row.last_activity_at,
    openingPost: { body: row.body, createdAt: row.post_created_at, id: row.post_id },
    slug: row.slug,
    title: row.title,
    url: `/forum/topic/${row.id}/${row.slug}`
  };
}

function validateTopicInput(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const postBody = typeof body.body === "string" ? body.body : "";
  const categorySlug = normalizeSlug(body.categorySlug);
  if (!categorySlug) return invalid("category_invalid", "Choose a valid forum category.");
  if (title.length < 5 || title.length > 120) return invalid("title_invalid", "Topic titles must be 5 to 120 characters.");
  if (postBody.length < 1 || postBody.length > 10000) return invalid("body_invalid", "Opening posts must be 1 to 10,000 characters.");
  return { valid: true, body: postBody, categorySlug, title };
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > JSON_LIMIT) return { ok: false, response: jsonError("request_too_large", "That topic request is too large.", 413) };
  let text;
  try { text = await request.text(); } catch { return { ok: false, response: jsonError("invalid_input", "Send a valid topic request.", 400) }; }
  if (new TextEncoder().encode(text).length > JSON_LIMIT) return { ok: false, response: jsonError("request_too_large", "That topic request is too large.", 413) };
  try { const body = JSON.parse(text); return body && typeof body === "object" && !Array.isArray(body) ? { ok: true, body } : { ok: false, response: jsonError("invalid_input", "Send a valid topic request.", 400) }; }
  catch { return { ok: false, response: jsonError("invalid_input", "Send a valid topic request.", 400) }; }
}

function slugify(value) { const slug = String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/g, ""); return slug || "topic"; }
function normalizeSlug(value) { try { const slug = decodeURIComponent(String(Array.isArray(value) ? value.join("/") : value || "")).toLowerCase(); return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : ""; } catch { return ""; } }
function normalizeId(value) { const id = String(Array.isArray(value) ? value[0] : value || ""); return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : ""; }
function renderPlainText(value) { return String(value).split(/\r?\n/).map((line) => line ? `<p>${escapeHtml(line)}</p>` : `<p class="forum-post__blank" aria-hidden="true">&nbsp;</p>`).join(""); }
function formatDate(value) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
function nowIso(options) { return new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(); }
function requireDb(env) { if (!env.TRG_ORDERS?.prepare) throw new Error("Forum topic database is unavailable."); return env.TRG_ORDERS; }
function invalid(code, message) { return { valid: false, code, message }; }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function publicNotFound(code, message) { return jsonError(code, message, 404); }
function topicNotFound() { return htmlResponse(pageShell({ title: "Forum topic not found", body: `<section class="store-section"><h1>Forum topic not found</h1><p>That forum topic is not available.</p><p><a class="button button--secondary" href="/forum">Back to Forum Home</a></p></section>` }), 404); }
function pageShell({ title, body }) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | Tobacco Road Games</title><link rel="icon" type="image/png" href="/assets/logo.png"><link rel="stylesheet" href="/styles.css?v=20260731c"></head><body class="view-section"><div class="page-shell"><header class="site-header"><a class="brand" href="/" aria-label="Tobacco Road Games home"><img class="brand__logo" src="/assets/logo.png" alt="Tobacco Road Games logo"><div class="brand__copy"><span class="brand__name">Tobacco Road Games</span><span class="brand__tag">A working GM's bench for strange tables and long campaigns</span></div></a><nav class="site-nav" aria-label="Primary"><a href="/">Home</a><a href="/store/">Store</a><a href="/authors.html">Authors</a><a href="/forum" aria-current="page">Forum</a><a href="/account.html">Account</a></nav></header><main>${body}</main></div></body></html>`; }
function htmlResponse(body, status = 200) { return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } }); }
function json(payload, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", ...extraHeaders } }); }
function jsonError(code, message, status) { return json({ error: { code, message } }, status); }
