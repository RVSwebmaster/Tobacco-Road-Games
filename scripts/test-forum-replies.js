const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tobaccoroadgames.com";
const NOW = Date.parse("2026-07-31T15:00:00.000Z");
const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const MIGRATION = ["007_shared_accounts.sql", "008_token_claim_markers.sql", "009_forum_profiles.sql", "010_forum_categories.sql", "011_forum_profile_avatars.sql", "012_forum_topics.sql", "013_forum_moderation.sql", "014_forum_rate_limits.sql"]
  .map((name) => fs.readFileSync(path.join(ROOT, "migrations", name), "utf8")).join("\n");

async function main() {
  const topics = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-topics.mjs")).href);
  const categories = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-categories.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  await replyFlow(topics, categories, auth);
  await rejectionCases(topics, auth);
  await atomicRollback(topics, auth);
  browserAndSchemaAssertions();
  console.log("Forum reply tests passed.");
}

async function replyFlow(topics, categories, auth) {
  const fixture = await createFixture(auth);
  let response = await topics.handleForumReplyCreation(replyRequest(fixture, "First reply.\n\n<script>alert(1)</script>"), fixture.env, TOPIC_ID, { now: NOW + 2000 });
  assert.equal(response.status, 201);
  const reply = (await response.json()).reply;
  assert.equal(fixture.raw.prepare("SELECT last_activity_at FROM forum_topics WHERE id = ?").get(TOPIC_ID).last_activity_at, new Date(NOW + 2000).toISOString());

  response = await topics.handleForumReplyCreation(replyRequest(fixture, "Second reply."), fixture.env, TOPIC_ID, { now: NOW + 13000 });
  assert.equal(response.status, 201);
  const secondReply = (await response.json()).reply;
  response = await topics.handleTopicApi(new Request(`${ORIGIN}/api/forum/topic/${TOPIC_ID}`), fixture.env, TOPIC_ID);
  const payload = await response.json();
  assert.deepEqual(payload.topic.posts.map((post) => post.body), ["Opening post.", "First reply.\n\n<script>alert(1)</script>", "Second reply."], "Opening post and replies must be chronological.");
  assert.equal(payload.topic.openingPost.id, payload.topic.posts[0].id, "Opening post must remain first.");
  assert.equal(JSON.stringify(payload).includes("avatar_object_key"), false);

  response = await topics.renderForumTopic(new Request(`${ORIGIN}/forum/topic/${TOPIC_ID}/first-topic`, { headers: fixture.authHeaders }), fixture.env, TOPIC_ID, "first-topic", { now: NOW });
  let html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Add a Reply/);
  assert.match(html, /First reply/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /forum-post__blank/);
  assert.ok(html.indexOf("Opening post.") < html.indexOf("First reply.") && html.indexOf("First reply.") < html.indexOf("Second reply."));

  const categoryId = fixture.raw.prepare("SELECT id FROM forum_categories WHERE slug='the-common-room'").get().id;
  let listed = await topics.listCategoryTopics(fixture.env, categoryId);
  assert.equal(listed.find((topic) => topic.id === TOPIC_ID).postCount, 3);
  assert.equal(listed[0].id, TOPIC_ID, "A reply must move its topic to the top by latest activity.");
  response = await categories.handleForumCategoriesApi(new Request(`${ORIGIN}/api/forum/categories`), fixture.env);
  let common = (await response.json()).categories.find((category) => category.slug === "the-common-room");
  assert.equal(common.topicCount, 2);
  assert.equal(common.postCount, 4);
  response = await categories.renderForumHome(new Request(`${ORIGIN}/forum`), fixture.env);
  html = await response.text();
  assert.match(html, /<dt>Posts<\/dt><dd>4<\/dd>/);

  fixture.raw.prepare("UPDATE forum_profiles SET handle='CurrentAuthor',handle_normalized='currentauthor',display_name='Current Name',avatar_preset_id='brass-d20',avatar_version=1 WHERE user_id='reply-user'").run();
  response = await topics.renderForumTopic(new Request(`${ORIGIN}/forum/topic/${TOPIC_ID}/first-topic`), fixture.env, TOPIC_ID, "first-topic");
  html = await response.text();
  assert.match(html, /@CurrentAuthor/);
  assert.match(html, /Current Name/);
  assert.match(html, /\/forum\/avatar\/CurrentAuthor\?v=1/);
  assert.doesNotMatch(html, /@ReplyAuthor|Original Name/);

  fixture.raw.prepare("UPDATE forum_posts SET status='inactive' WHERE id=?").run(reply.id);
  response = await topics.handleTopicApi(new Request(`${ORIGIN}/api/forum/topic/${TOPIC_ID}`), fixture.env, TOPIC_ID);
  assert.deepEqual((await response.json()).topic.posts.map((post) => post.id), ["opening-post", secondReply.id]);
  listed = await topics.listCategoryTopics(fixture.env, categoryId);
  assert.equal(listed.find((topic) => topic.id === TOPIC_ID).postCount, 2, "Inactive posts must not count.");
  response = await categories.handleForumCategoriesApi(new Request(`${ORIGIN}/api/forum/categories`), fixture.env);
  common = (await response.json()).categories.find((category) => category.slug === "the-common-room");
  assert.equal(common.postCount, 3, "Inactive posts must not count on forum home.");
}

async function rejectionCases(topics, auth) {
  let fixture = await createFixture(auth);
  let response = await topics.handleForumReplyCreation(new Request(`${ORIGIN}/api/forum/topic/${TOPIC_ID}/replies`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ body: "Reply" }) }), fixture.env, TOPIC_ID);
  assert.equal(response.status, 401);
  response = await topics.handleForumReplyCreation(replyRequest(fixture, "Reply", { origin: "https://evil.example" }), fixture.env, TOPIC_ID, { now: NOW }); assert.equal(response.status, 403);
  response = await topics.handleForumReplyCreation(replyRequest(fixture, "Reply", { csrf: "wrong" }), fixture.env, TOPIC_ID, { now: NOW }); assert.equal(response.status, 403);
  for (const body of ["", "   \n\t", "x".repeat(10001)]) { response = await topics.handleForumReplyCreation(replyRequest(fixture, body), fixture.env, TOPIC_ID, { now: NOW }); assert.equal(response.status, 400); }
  response = await topics.handleForumReplyCreation(replyRequest(fixture, "x".repeat(10000)), fixture.env, TOPIC_ID, { now: NOW }); assert.equal(response.status, 201);

  fixture = await createFixture(auth); fixture.raw.prepare("UPDATE users SET email_verified=0 WHERE id='reply-user'").run();
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, TOPIC_ID, { now: NOW })).status, 403);
  fixture = await createFixture(auth); fixture.raw.prepare("DELETE FROM forum_profiles WHERE user_id='reply-user'").run();
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, TOPIC_ID, { now: NOW })).status, 403);
  fixture = await createFixture(auth); fixture.raw.prepare("UPDATE forum_profiles SET status='inactive' WHERE user_id='reply-user'").run();
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, TOPIC_ID, { now: NOW })).status, 403);
  fixture = await createFixture(auth);
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, "00000000-0000-4000-8000-000000000000", { now: NOW })).status, 404);
  fixture.raw.prepare("UPDATE forum_topics SET status='inactive' WHERE id=?").run(TOPIC_ID);
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, TOPIC_ID, { now: NOW })).status, 404);
  fixture = await createFixture(auth); fixture.raw.prepare("UPDATE forum_categories SET status='inactive' WHERE slug='the-common-room'").run();
  assert.equal((await topics.handleForumReplyCreation(replyRequest(fixture, "Reply"), fixture.env, TOPIC_ID, { now: NOW })).status, 404);
}

async function atomicRollback(topics, auth) {
  const fixture = await createFixture(auth);
  fixture.raw.exec("CREATE TRIGGER fail_topic_activity BEFORE UPDATE ON forum_topics BEGIN SELECT RAISE(ABORT, 'forced activity failure'); END;");
  await assert.rejects(() => topics.handleForumReplyCreation(replyRequest(fixture, "Must roll back."), fixture.env, TOPIC_ID, { now: NOW }), /forced activity failure/);
  assert.equal(fixture.raw.prepare("SELECT COUNT(*) AS count FROM forum_posts WHERE topic_id=?").get(TOPIC_ID).count, 1, "Failed activity update must roll back the reply.");
}

function browserAndSchemaAssertions() {
  const source = fs.readFileSync(path.join(ROOT, "assets", "js", "forum-topic.js"), "utf8");
  assert.match(source, /if \(submitting\) return/);
  assert.match(source, /submit\.disabled = true/);
  assert.match(source, /form\.reset\(\)/);
  assert.match(source, /window\.location\.assign/);
  const raw = new DatabaseSync(":memory:"); raw.exec(MIGRATION);
  for (const table of ["forum_topics", "forum_posts"]) for (const column of raw.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)) assert.doesNotMatch(column, /avatar|handle|display|email|google|provider|role|session/i);
  assert.equal(fs.existsSync(path.join(ROOT, "functions", "api", "forum", "topic", "[id]", "replies.js")), true);
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='forum_replies'").get(), undefined, "Replies must continue using forum_posts.");
}

async function createFixture(auth) {
  const raw = new DatabaseSync(":memory:"); raw.exec(MIGRATION);
  const now = new Date(NOW).toISOString();
  raw.prepare("INSERT INTO users (id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES ('reply-user','private@example.com',1,?,'active','user',?,?)").run(now, now, now);
  raw.prepare("INSERT INTO forum_profiles (user_id,handle,handle_normalized,display_name,status,created_at,updated_at) VALUES ('reply-user','ReplyAuthor','replyauthor','Original Name','active',?,?)").run(now, now);
  raw.prepare("INSERT INTO users (id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES ('topic-owner','owner@example.com',1,?,'active','user',?,?)").run(now, now, now);
  raw.prepare("INSERT INTO forum_profiles (user_id,handle,handle_normalized,display_name,status,created_at,updated_at) VALUES ('topic-owner','TopicOwner','topicowner','Topic Owner','active',?,?)").run(now, now);
  const category = raw.prepare("SELECT id FROM forum_categories WHERE slug='the-common-room'").get();
  raw.prepare("INSERT INTO forum_topics (id,category_id,creator_profile_id,title,slug,status,created_at,updated_at,last_activity_at) VALUES (?,?,?,'First topic','first-topic','active',?,?,?)").run(TOPIC_ID, category.id, "topic-owner", now, now, now);
  raw.prepare("INSERT INTO forum_posts (id,topic_id,author_profile_id,body,status,created_at,updated_at) VALUES ('opening-post',?,?,'Opening post.','active',?,?)").run(TOPIC_ID, "topic-owner", now, now);
  raw.prepare("INSERT INTO forum_topics (id,category_id,creator_profile_id,title,slug,status,created_at,updated_at,last_activity_at) VALUES (?,?,?,'Other topic','other-topic','active',?,?,?)").run(OTHER_TOPIC_ID, category.id, "topic-owner", now, now, now);
  raw.prepare("INSERT INTO forum_posts (id,topic_id,author_profile_id,body,status,created_at,updated_at) VALUES ('other-opening',?,?,'Other opening.','active',?,?)").run(OTHER_TOPIC_ID, "topic-owner", now, now);
  const token = "reply-session", csrf = "reply-csrf";
  raw.prepare("INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES ('reply-session-id','reply-user',?,?,?,?,?)").run(await auth.hashToken(token), await auth.hashToken(csrf), now, "2026-08-02T12:00:00.000Z", now);
  return { raw, env: { FORUM_RATE_LIMIT_SECRET: "forum-rate-limit-test-secret-32-characters-minimum", TRG_ORDERS: d1(raw) }, authHeaders: { cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}`, origin: ORIGIN, "x-csrf-token": csrf } };
}

function d1(raw) {
  const prepare = (sql, values = []) => ({ _sql: sql, _values: values, bind: (...next) => prepare(sql, next), first: async () => raw.prepare(sql).get(...values) || null, all: async () => ({ results: raw.prepare(sql).all(...values) }), run: async () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; } });
  return { prepare: (sql) => prepare(sql), batch: async (statements) => { raw.exec("BEGIN"); try { const results = statements.map((statement) => { const result = raw.prepare(statement._sql).run(...statement._values); return { meta: { changes: Number(result.changes) } }; }); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
}

function replyRequest(fixture, body, overrides = {}) {
  const headers = { ...fixture.authHeaders, "content-type": "application/json" };
  if (overrides.origin) headers.origin = overrides.origin;
  if (overrides.csrf) headers["x-csrf-token"] = overrides.csrf;
  return new Request(`${ORIGIN}/api/forum/topic/${TOPIC_ID}/replies`, { method: "POST", headers, body: JSON.stringify({ body }) });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
