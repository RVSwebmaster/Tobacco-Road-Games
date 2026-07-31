import { getSessionFromRequest } from "./account-auth.mjs";
import { getEligibleTopicCreator, listCategoryTopics } from "./forum-topics.mjs";

export async function handleForumCategoriesApi(request, env) {
  if (request.method !== "GET") return json({ error: { code: "method_not_allowed", message: "Use GET for forum categories." } }, 405);
  return json({ categories: (await listActiveCategories(env)).map(publicCategory) }, 200, { "cache-control": "public, max-age=60" });
}

export async function renderForumHome(request, env, options = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return htmlNotFound();
  const [categories, identity] = await Promise.all([listActiveCategories(env), forumIdentity(request, env, options)]);
  const identityMarkup = identity
    ? `<div class="forum-identity"><img class="forum-avatar forum-avatar--small" src="/forum/avatar/${encodeURIComponent(identity.handle)}?v=${identity.avatarVersion}" alt=""><p>Signed in as <a href="/forum/member/${encodeURIComponent(identity.handle)}">@${escapeHtml(identity.handle)}</a> · <a href="/account.html">Account &amp; Profile</a></p></div>`
    : `<p class="forum-identity"><a href="/account.html">Account &amp; Profile</a></p>`;
  const categoryMarkup = categories.map((category) => `
    <article class="forum-category-card">
      <div class="forum-category-card__body">
        <h2><a href="/forum/category/${encodeURIComponent(category.slug)}">${escapeHtml(category.display_name)}</a></h2>
        <p>${escapeHtml(category.description)}</p>
      </div>
      <dl class="forum-category-card__counts" aria-label="Current discussion counts">
        <div><dt>Topics</dt><dd>${Number(category.topic_count || 0)}</dd></div>
        <div><dt>Posts</dt><dd>${Number(category.post_count || 0)}</dd></div>
      </dl>
    </article>`).join("");
  return htmlResponse(pageShell({
    title: "Forum",
    current: "forum",
    body: `<section class="store-section forum-home" aria-labelledby="forum-heading">
      <div class="section-heading"><p class="section-heading__kicker">Around the table</p><h1 id="forum-heading">Tobacco Road Games Forum</h1><p>A small community space for tabletop play, design, publishing, playtests, campaign stories, and everything beyond the road.</p></div>
      ${identityMarkup}
      <div class="forum-category-list">${categoryMarkup}</div>
    </section>`
  }));
}

export async function renderForumCategory(request, env, requestedSlug, options = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return htmlNotFound();
  const slug = normalizeSlug(requestedSlug);
  if (!slug) return htmlNotFound();
  const category = await requireDb(env).prepare(`
    SELECT id, slug, display_name, description
    FROM forum_categories
    WHERE slug = ? AND status = 'active'
  `).bind(slug).first();
  if (!category) return htmlNotFound();
  const [topics, creator] = await Promise.all([listCategoryTopics(env, category.id), getEligibleTopicCreator(request, env, options)]);
  const topicMarkup = topics.length ? topics.map(renderTopicCard).join("") : `<div class="forum-notice" role="status"><h2>No topics yet</h2><p>Be the first member to start a discussion in this category.</p></div>`;
  const creationMarkup = creator ? `<section class="forum-topic-create" aria-labelledby="start-topic-heading">
      <h2 id="start-topic-heading">Start a Topic</h2>
      <form id="forum-topic-form" data-category-slug="${escapeHtml(category.slug)}">
        <label for="forum-topic-title">Topic title</label><input id="forum-topic-title" name="title" type="text" minlength="5" maxlength="120" required>
        <label for="forum-topic-body">Opening post</label><textarea id="forum-topic-body" name="body" rows="10" maxlength="10000" required></textarea>
        <p class="forum-topic-create__help">Plain text only. Paragraphs and line breaks will be preserved.</p>
        <button class="button" type="submit">Create Topic</button><p id="forum-topic-status" class="forum-topic-create__status" role="status" aria-live="polite"></p>
      </form>
    </section><script src="/assets/js/forum-category.js?v=20260731a" defer></script>` : `<p class="forum-topic-sign-in"><a href="/account.html">Sign in and complete your forum profile</a> to start a topic.</p>`;
  return htmlResponse(pageShell({
    title: category.display_name,
    current: "forum",
    body: `<section class="store-section forum-category" aria-labelledby="category-heading">
      <p class="section-heading__kicker">Forum category</p>
      <h1 id="category-heading">${escapeHtml(category.display_name)}</h1>
      <p class="forum-category-placeholder__description">${escapeHtml(category.description)}</p>
      <div class="forum-topic-list" aria-label="Topics in ${escapeHtml(category.display_name)}">${topicMarkup}</div>
      ${creationMarkup}
      <p><a class="button button--secondary" href="/forum">Back to Forum Home</a></p>
    </section>`
  }));
}

export async function listActiveCategories(env) {
  const result = await requireDb(env).prepare(`
    SELECT c.slug, c.display_name, c.description, c.display_order,
      (SELECT COUNT(*) FROM forum_topics t WHERE t.category_id = c.id AND t.status = 'active') AS topic_count,
      (SELECT COUNT(*) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id JOIN forum_profiles fp ON fp.user_id = p.author_profile_id AND fp.status = 'active' JOIN users pu ON pu.id = fp.user_id AND pu.status = 'active' WHERE t.category_id = c.id AND t.status = 'active' AND p.status = 'active') AS post_count
    FROM forum_categories c
    WHERE c.status = 'active'
    ORDER BY display_order ASC, slug ASC
  `).all();
  return result.results || [];
}

async function forumIdentity(request, env, options) {
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) return null;
  const profile = await requireDb(env).prepare(`
    SELECT p.handle, p.avatar_version
    FROM forum_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ? AND p.status = 'active' AND u.status = 'active'
  `).bind(session.user.id).first();
  return profile ? { avatarVersion: Number(profile.avatar_version || 0), handle: profile.handle } : null;
}

function publicCategory(row) {
  return { description: row.description, name: row.display_name, postCount: Number(row.post_count || 0), slug: row.slug, topicCount: Number(row.topic_count || 0) };
}

function renderTopicCard(topic) {
  const avatar = topic.creator.avatarUrl || "/assets/logo.png?v=forum-avatar-default";
  return `<article class="forum-topic-card"><div class="forum-topic-card__main"><h2><a href="${escapeHtml(topic.url)}">${escapeHtml(topic.title)}</a></h2><div class="forum-topic-card__creator"><img class="forum-avatar forum-avatar--small" src="${escapeHtml(avatar)}" alt=""><span>Started by <a href="/forum/member/${encodeURIComponent(topic.creator.handle)}">@${escapeHtml(topic.creator.handle)}</a> on ${formatDate(topic.createdAt)}</span></div></div><dl class="forum-topic-card__facts"><div><dt>Posts</dt><dd>${topic.postCount}</dd></div><div><dt>Last activity</dt><dd>${formatDate(topic.lastActivityAt)}</dd></div></dl></article>`;
}

function formatDate(value) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }

function pageShell({ title, body, current }) {
  const nav = [
    ["home", "/", "Home"], ["store", "/store/", "Store"], ["authors", "/authors.html", "Authors"],
    ["forum", "/forum", "Forum"], ["account", "/account.html", "Account"]
  ].map(([key, href, label]) => `<a href="${href}"${current === key ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | Tobacco Road Games</title><meta name="description" content="Tobacco Road Games community forum"><link rel="icon" type="image/png" href="/assets/logo.png"><link rel="stylesheet" href="/styles.css?v=20260731b"></head><body class="view-section"><div class="page-shell"><header class="site-header"><a class="brand" href="/" aria-label="Tobacco Road Games home"><img class="brand__logo" src="/assets/logo.png" alt="Tobacco Road Games logo"><div class="brand__copy"><span class="brand__name">Tobacco Road Games</span><span class="brand__tag">A working GM's bench for strange tables and long campaigns</span></div></a><nav class="site-nav" aria-label="Primary">${nav}</nav></header><main>${body}</main></div></body></html>`;
}

function normalizeSlug(value) {
  try {
    const slug = decodeURIComponent(String(Array.isArray(value) ? value.join("/") : value || "")).toLowerCase();
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
  } catch {
    return "";
  }
}
function requireDb(env) { if (!env.TRG_ORDERS?.prepare) throw new Error("Forum category database is unavailable."); return env.TRG_ORDERS; }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function htmlResponse(body, status = 200) { return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } }); }
function htmlNotFound() { return htmlResponse(pageShell({ title: "Forum page not found", current: "forum", body: `<section class="store-section"><h1>Forum page not found</h1><p>That forum category is not available.</p><p><a class="button button--secondary" href="/forum">Back to Forum Home</a></p></section>` }), 404); }
function json(payload, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } }); }
