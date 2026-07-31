const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tobaccoroadgames.com";
const MIGRATION = ["007_shared_accounts.sql", "008_token_claim_markers.sql", "009_forum_profiles.sql", "010_forum_categories.sql"]
  .map((file) => fs.readFileSync(path.join(ROOT, "migrations", file), "utf8")).join("\n");
const EXPECTED = ["The Common Room", "At the Workbench", "Tobacco Road Games", "The Playtest Table", "Campaign Journals", "Off the Road"];

async function main() {
  const categories = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-categories.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  await testSeedsOrderingAndApi(categories);
  await testInactiveAndCategoryPages(categories);
  await testEscapingAndPrivacy(categories, auth);
  assertNavigationAndRoutes();
  console.log("Forum category tests passed.");
}

async function testSeedsOrderingAndApi(categories) {
  const env = createEnv();
  const listed = await categories.listActiveCategories(env);
  assert.deepEqual(listed.map((row) => row.display_name), EXPECTED, "Seeded categories should use database display order.");
  let response = await categories.handleForumCategoriesApi(new Request(`${ORIGIN}/api/forum/categories`), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.categories.map((row) => row.name), EXPECTED);
  for (const category of payload.categories) {
    assert.deepEqual(Object.keys(category).sort(), ["description", "name", "postCount", "slug", "topicCount"]);
    assert.equal(category.topicCount, 0);
    assert.equal(category.postCount, 0);
  }
  response = await categories.renderForumHome(new Request(`${ORIGIN}/forum`), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(EXPECTED.every((name) => html.includes(name)));
  assert.match(html, /<dt>Topics<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Posts<\/dt><dd>0<\/dd>/);
}

async function testInactiveAndCategoryPages(categories) {
  const env = createEnv();
  await env.TRG_ORDERS.prepare("UPDATE forum_categories SET status = 'inactive' WHERE slug = 'off-the-road'").run();
  const listed = await categories.listActiveCategories(env);
  assert.equal(listed.some((row) => row.slug === "off-the-road"), false, "Inactive categories must be excluded.");
  let response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/the-common-room`), env, "the-common-room");
  let html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /The Common Room/);
  assert.match(html, /Discussions are not enabled yet/);
  assert.match(html, /Back to Forum Home/);
  response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/missing`), env, "missing");
  assert.equal(response.status, 404);
  response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/off-the-road`), env, "off-the-road");
  assert.equal(response.status, 404, "Inactive category pages must return 404.");
  response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/bad`), env, "%E0%A4%A");
  assert.equal(response.status, 404, "Malformed category slugs must return a normal 404.");
}

async function testEscapingAndPrivacy(categories, auth) {
  const env = createEnv();
  await env.TRG_ORDERS.prepare("INSERT INTO forum_categories (id, slug, display_name, description, display_order, status, created_at, updated_at) VALUES ('unsafe', 'unsafe-test', '<script>name</script>', '<img src=x onerror=alert(1)>', 5, 'active', '2026-07-31T00:00:00Z', '2026-07-31T00:00:00Z')").run();
  let response = await categories.renderForumHome(new Request(`${ORIGIN}/forum`), env);
  let html = await response.text();
  assert.doesNotMatch(html, /<script>name|<img src=x/);
  assert.match(html, /&lt;script&gt;name/);
  response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/unsafe-test`), env, "unsafe-test");
  html = await response.text();
  assert.doesNotMatch(html, /<script>name|<img src=x/);

  const now = "2026-07-31T12:00:00.000Z";
  const token = "forum-home-session";
  const csrf = "forum-home-csrf";
  await env.TRG_ORDERS.prepare("INSERT INTO users (id, email_normalized, email_verified, status, role, created_at, updated_at) VALUES ('private-user', 'private@example.com', 1, 'active', 'admin', ?, ?)").bind(now, now).run();
  await env.TRG_ORDERS.prepare("INSERT INTO forum_profiles (user_id, handle, handle_normalized, display_name, biography, status, created_at, updated_at) VALUES ('private-user', 'PublicHandle', 'publichandle', 'Public Name', NULL, 'active', ?, ?)").bind(now, now).run();
  await env.TRG_ORDERS.prepare("INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at) VALUES ('home-session', 'private-user', ?, ?, ?, '2026-08-01T12:00:00.000Z', ?)")
    .bind(await auth.hashToken(token), await auth.hashToken(csrf), now, now).run();
  response = await categories.renderForumHome(new Request(`${ORIGIN}/forum`, { headers: { cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}` } }), env, { now: Date.parse(now) });
  html = await response.text();
  assert.match(html, /@PublicHandle/);
  for (const privateValue of ["private@example.com", "admin", "email_normalized", "provider_subject", "google"]) {
    assert.equal(html.toLowerCase().includes(privateValue.toLowerCase()), false, `Forum home must not expose ${privateValue}.`);
  }
}

function createEnv() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  return { TRG_ORDERS: d1(raw) };
}

function d1(raw) {
  return {
    prepare(sql) {
      const statement = raw.prepare(sql);
      const wrap = (values = []) => ({
        bind: (...next) => wrap(next),
        first: async () => statement.get(...values) || null,
        all: async () => ({ results: statement.all(...values) }),
        run: async () => { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; }
      });
      return wrap();
    }
  };
}

function assertNavigationAndRoutes() {
  const build = fs.readFileSync(path.join(ROOT, "scripts", "build-store.js"), "utf8");
  assert.match(build, /href: "\/forum", label: "Forum"/, "Generated public and store navigation must include Forum.");
  const account = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
  assert.match(account, /href="\/forum">Forum<\/a>/, "Account navigation must include Forum.");
  for (const page of ["index.html", "ai-statement.html", "support.html"]) {
    const source = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(source, /href="\/forum">Forum<\/a>/, `${page} navigation must include Forum.`);
  }
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/forum/member/*") && routes.include.includes("/api/forum/*"));
  assert.ok(routes.include.includes("/forum") && routes.include.includes("/forum/category/*"), "Pages must route the forum home and category pages through Functions.");
  assert.ok(fs.existsSync(path.join(ROOT, "functions", "forum", "index.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "functions", "forum", "category", "[[slug]].js")));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
