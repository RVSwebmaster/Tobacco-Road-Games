const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tobaccoroadgames.com";
const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const MIGRATION = ["007_shared_accounts.sql", "008_token_claim_markers.sql", "009_forum_profiles.sql", "010_forum_categories.sql", "011_forum_profile_avatars.sql", "012_forum_topics.sql"]
  .map((name) => fs.readFileSync(path.join(ROOT, "migrations", name), "utf8")).join("\n");

async function main() {
  const topics = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-topics.mjs")).href);
  const categories = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-categories.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  await creationAndRendering(topics, categories, auth);
  await authorizationAndValidation(topics, auth);
  await atomicRollback(topics, auth);
  schemaAndRoutes();
  console.log("Forum topic tests passed.");
}

async function creationAndRendering(topics, categories, auth) {
  const fixture = await createFixture(auth);
  let response = await topics.handleForumTopicsCollection(topicRequest(fixture, { ...validBody(), title: "A <Great> Campaign", body: "First paragraph\n\n<script>alert(1)</script>" }), fixture.env, { now: NOW });
  assert.equal(response.status, 201);
  const first = (await response.json()).topic;
  assert.match(first.url, new RegExp(`/forum/topic/${first.id}/a-great-campaign$`));
  assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS count FROM forum_topics").get().count, 1);
  assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS count FROM forum_posts").get().count, 1);

  response = await topics.handleForumTopicsCollection(topicRequest(fixture, { ...validBody(), title: "A <Great> Campaign", body: "Duplicate titles are valid." }), fixture.env, { now: NOW + 1000 });
  assert.equal(response.status, 201, "Duplicate titles must be allowed.");
  const second = (await response.json()).topic;
  const categoryId = fixture.raw.prepare("SELECT id FROM forum_categories WHERE slug = 'the-common-room'").get().id;
  const listed = await topics.listCategoryTopics(fixture.env, categoryId);
  assert.deepEqual(listed.map((item) => item.id), [second.id, first.id], "Topics must be ordered by latest activity.");
  response = await topics.handleCategoryTopicsApi(new Request(`${ORIGIN}/api/forum/category/the-common-room/topics`), fixture.env, "the-common-room");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).topics.map((item) => item.id), [second.id, first.id]);

  response = await topics.handleTopicApi(new Request(`${ORIGIN}/api/forum/topic/${first.id}`), fixture.env, first.id);
  const payloadText = await response.text();
  assert.equal(response.status, 200);
  for (const secret of ["private@example.com", "google", "owner", "avatar_object_key", "avatar_preset_id"]) assert.equal(payloadText.includes(secret), false);

  response = await topics.renderForumTopic(new Request(`${ORIGIN}${first.url}`), fixture.env, first.id, "a-great-campaign");
  let html = await response.text();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /@TableGuide/);
  assert.match(html, /Guide Name/);
  assert.match(html, /Replies are not enabled yet/);

  fixture.raw.prepare("UPDATE forum_profiles SET handle = 'NewGuide', handle_normalized = 'newguide', display_name = 'New Name', avatar_preset_id = 'brass-d20', avatar_version = avatar_version + 1 WHERE user_id = 'topic-user'").run();
  response = await topics.renderForumTopic(new Request(`${ORIGIN}${first.url}`), fixture.env, first.id, "a-great-campaign");
  html = await response.text();
  assert.match(html, /@NewGuide/);
  assert.match(html, /New Name/);
  assert.match(html, /\/forum\/avatar\/NewGuide\?v=1/, "Current avatars must resolve retroactively.");
  assert.doesNotMatch(html, /TableGuide|Guide Name/);

  response = await categories.handleForumCategoriesApi(new Request(`${ORIGIN}/api/forum/categories`), fixture.env);
  const common = (await response.json()).categories.find((item) => item.slug === "the-common-room");
  assert.equal(common.topicCount, 2);
  assert.equal(common.postCount, 2);
  response = await categories.renderForumCategory(new Request(`${ORIGIN}/forum/category/the-common-room`, { headers: fixture.authHeaders }), fixture.env, "the-common-room", { now: NOW });
  html = await response.text();
  assert.match(html, /Start a Topic/);
  assert.match(html, /@NewGuide/);

  response = await topics.renderForumTopic(new Request(`${ORIGIN}/forum/topic/${first.id}/wrong`), fixture.env, first.id, "wrong");
  assert.equal(response.status, 302);
  fixture.raw.prepare("UPDATE forum_topics SET status = 'inactive' WHERE id = ?").run(first.id);
  assert.equal((await topics.handleTopicApi(new Request(`${ORIGIN}/api/forum/topic/${first.id}`), fixture.env, first.id)).status, 404);
  assert.equal((await topics.renderForumTopic(new Request(`${ORIGIN}${first.url}`), fixture.env, first.id, first.slug)).status, 404);
  assert.equal((await topics.handleTopicApi(new Request(`${ORIGIN}/api/forum/topic/00000000-0000-4000-8000-000000000000`), fixture.env, "00000000-0000-4000-8000-000000000000")).status, 404);
}

async function authorizationAndValidation(topics, auth) {
  let fixture = await createFixture(auth);
  assert.equal((await topics.handleForumTopicsCollection(new Request(`${ORIGIN}/api/forum/topics`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(validBody()) }), fixture.env)).status, 401);
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody(), { origin: "https://evil.example" }), fixture.env, { now: NOW })).status, 403);
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody(), { csrf: "wrong" }), fixture.env, { now: NOW })).status, 403);

  fixture.raw.prepare("UPDATE users SET email_verified = 0 WHERE id = 'topic-user'").run();
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody()), fixture.env, { now: NOW })).status, 403);
  fixture = await createFixture(auth);
  fixture.raw.prepare("DELETE FROM forum_profiles WHERE user_id = 'topic-user'").run();
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody()), fixture.env, { now: NOW })).status, 403);
  fixture = await createFixture(auth);
  fixture.raw.prepare("UPDATE forum_profiles SET status = 'inactive' WHERE user_id = 'topic-user'").run();
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody()), fixture.env, { now: NOW })).status, 403);
  fixture = await createFixture(auth);
  fixture.raw.prepare("UPDATE forum_categories SET status = 'inactive' WHERE slug = 'the-common-room'").run();
  assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, validBody()), fixture.env, { now: NOW })).status, 404);

  fixture = await createFixture(auth);
  for (const body of [
    { ...validBody(), title: "four" }, { ...validBody(), title: "x".repeat(121) },
    { ...validBody(), body: "" }, { ...validBody(), body: "x".repeat(10001) }
  ]) assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, body), fixture.env, { now: NOW })).status, 400);
  for (const body of [{ ...validBody(), title: "x".repeat(5) }, { ...validBody(), title: "x".repeat(120), body: "x".repeat(10000) }])
    assert.equal((await topics.handleForumTopicsCollection(topicRequest(fixture, body), fixture.env, { now: NOW })).status, 201);
}

async function atomicRollback(topics, auth) {
  const fixture = await createFixture(auth);
  fixture.raw.exec("CREATE TRIGGER fail_opening_post BEFORE INSERT ON forum_posts BEGIN SELECT RAISE(ABORT, 'forced post failure'); END;");
  await assert.rejects(() => topics.handleForumTopicsCollection(topicRequest(fixture, validBody()), fixture.env, { now: NOW }), /forced post failure/);
  assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS count FROM forum_topics").get().count, 0, "A failed opening post must roll back its topic.");
}

function schemaAndRoutes() {
  const raw = new DatabaseSync(":memory:"); raw.exec(MIGRATION);
  for (const table of ["forum_topics", "forum_posts"]) {
    const columns = raw.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    for (const forbidden of ["avatar", "handle", "display_name", "email", "google", "provider"]) assert.equal(columns.some((name) => name.includes(forbidden)), false);
  }
  assert.deepEqual(raw.prepare("PRAGMA table_info(forum_topics)").all().map((row) => row.name), ["id", "category_id", "creator_profile_id", "title", "slug", "status", "created_at", "updated_at", "last_activity_at"]);
  assert.deepEqual(raw.prepare("PRAGMA table_info(forum_posts)").all().map((row) => row.name), ["id", "topic_id", "author_profile_id", "body", "status", "created_at", "updated_at"]);
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/forum/topic/*"));
  for (const file of ["functions/api/forum/topics.js", "functions/api/forum/category/[slug]/topics.js", "functions/api/forum/topic/[id].js", "functions/forum/topic/[[path]].js", "assets/js/forum-category.js"]) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} should exist.`);
}

async function createFixture(auth) {
  const raw = new DatabaseSync(":memory:"); raw.exec(MIGRATION);
  const now = new Date(NOW).toISOString();
  raw.prepare("INSERT INTO users (id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES ('topic-user','private@example.com',1,?,'active','owner',?,?)").run(now, now, now);
  raw.prepare("INSERT INTO forum_profiles (user_id,handle,handle_normalized,display_name,biography,status,created_at,updated_at) VALUES ('topic-user','TableGuide','tableguide','Guide Name',NULL,'active',?,?)").run(now, now);
  const token = "topic-session-token", csrf = "topic-csrf-token";
  raw.prepare("INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES ('topic-session','topic-user',?,?,?,?,?)")
    .run(await auth.hashToken(token), await auth.hashToken(csrf), now, "2026-08-02T12:00:00.000Z", now);
  return { raw, env: { TRG_ORDERS: d1(raw) }, csrf, authHeaders: { cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}`, origin: ORIGIN, "x-csrf-token": csrf } };
}

function d1(raw) {
  const prepare = (sql, values = []) => ({
    _sql: sql, _values: values,
    bind: (...next) => prepare(sql, next),
    first: async () => raw.prepare(sql).get(...values) || null,
    all: async () => ({ results: raw.prepare(sql).all(...values) }),
    run: async () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
  });
  return { prepare: (sql) => prepare(sql), batch: async (statements) => {
    raw.exec("BEGIN");
    try { const results = statements.map((statement) => { const result = raw.prepare(statement._sql).run(...statement._values); return { meta: { changes: Number(result.changes) } }; }); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
}

function validBody() { return { categorySlug: "the-common-room", title: "Welcome adventurers", body: "This is the opening post." }; }
function topicRequest(fixture, body, overrides = {}) {
  const headers = { ...fixture.authHeaders, "content-type": "application/json" };
  if (overrides.origin) headers.origin = overrides.origin;
  if (overrides.csrf) headers["x-csrf-token"] = overrides.csrf;
  return new Request(`${ORIGIN}/api/forum/topics`, { method: "POST", headers, body: JSON.stringify(body) });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
