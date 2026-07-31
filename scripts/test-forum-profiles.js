const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tobaccoroadgames.com";
const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const MIGRATION = ["007_shared_accounts.sql", "008_token_claim_markers.sql", "009_forum_profiles.sql", "011_forum_profile_avatars.sql"]
  .map((file) => fs.readFileSync(path.join(ROOT, "migrations", file), "utf8")).join("\n");

async function main() {
  const profiles = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-profiles.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  testHandleRules(profiles);
  await testAuthenticationVerificationAndCsrf(profiles, auth);
  await testCreationUniquenessAndEditing(profiles, auth);
  await testPublicPrivacyStatusAndEscaping(profiles, auth);
  assertFilesAndRoutes();
  console.log("Forum profile tests passed.");
}

function testHandleRules(profiles) {
  for (const value of ["abc", "Abc_123", "a-b", "A".repeat(24)]) assert.equal(profiles.validateHandle(value).valid, true, `${value} should be valid.`);
  for (const value of ["ab", "A".repeat(25)]) assert.equal(profiles.validateHandle(value).code, "handle_length");
  for (const value of ["_abc", "abc-", "-abc", "abc_"]) assert.equal(profiles.validateHandle(value).code, "handle_edges");
  for (const value of ["ab c", "abc!", "åbc"]) assert.equal(profiles.validateHandle(value).code, "handle_characters");
  for (const value of ["ab__cd", "ab--cd", "ab_-cd", "ab-_cd"]) assert.equal(profiles.validateHandle(value).code, "handle_punctuation");
  for (const value of ["admin", "MODERATOR", "TrG", "tobacco-road-games", "anonymous"]) assert.equal(profiles.validateHandle(value).code, "handle_reserved");
}

async function testAuthenticationVerificationAndCsrf(profiles, auth) {
  const fixture = await createFixture(auth);
  let response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "ValidUser" }), fixture.env, { now: NOW });
  assert.equal(response.status, 401, "Anonymous creation should be rejected.");

  const unverified = await fixture.user("unverified", false);
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "ValidUser" }, unverified), fixture.env, { now: NOW });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "email_verification_required");

  const verified = await fixture.user("verified", true);
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "ValidUser" }, { ...verified, csrf: "wrong" }), fixture.env, { now: NOW });
  assert.equal(response.status, 403, "Bad CSRF should be rejected.");
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "ValidUser" }, { ...verified, origin: "https://evil.example" }), fixture.env, { now: NOW });
  assert.equal(response.status, 403, "Cross-origin creation should be rejected.");
}

async function testCreationUniquenessAndEditing(profiles, auth) {
  const fixture = await createFixture(auth);
  const first = await fixture.user("first", true);
  let response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "Road_Gamer", displayName: "Road Gamer", biography: "Line one\nLine two" }, first), fixture.env, { now: NOW });
  assert.equal(response.status, 201, "Verified user should create a profile.");
  assert.equal((await response.json()).profile.handle, "Road_Gamer", "Handle capitalization should be preserved.");

  const second = await fixture.user("second", true);
  response = await profiles.handleHandleAvailability(new Request(`${ORIGIN}/api/forum/handle-availability?handle=road_gamer`), fixture.env);
  assert.equal(response.status, 409, "Availability should compare case-insensitively.");
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "road_gamer" }, second), fixture.env, { now: NOW });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "handle_unavailable");

  const third = await fixture.user("third", true);
  const fourth = await fixture.user("fourth", true);
  const concurrent = await Promise.all([
    profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "SameTime" }, third), fixture.env, { now: NOW }),
    profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "sametime" }, fourth), fixture.env, { now: NOW })
  ]);
  assert.equal(concurrent.filter((item) => item.status === 201).length, 1, "Concurrent same-handle creation must have one winner.");
  assert.equal(concurrent.filter((item) => item.status === 409).length, 1, "Concurrent conflict should be controlled.");

  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "PATCH", { displayName: "Updated", biography: "New bio" }, first), fixture.env, { now: NOW + 1000 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).profile.displayName, "Updated");
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "PATCH", { handle: "Changed", displayName: "No" }, first), fixture.env, { now: NOW });
  assert.equal((await response.json()).error.code, "handle_immutable");

  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "PATCH", { displayName: "x".repeat(61) }, first), fixture.env, { now: NOW });
  assert.equal((await response.json()).error.code, "display_name_invalid");
  response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "PATCH", { biography: "x".repeat(501) }, first), fixture.env, { now: NOW });
  assert.equal((await response.json()).error.code, "biography_invalid");

  const unexpectedEnv = { TRG_ORDERS: { prepare() { throw new Error("database unavailable"); } } };
  await assert.rejects(() => profiles.handleHandleAvailability(new Request(`${ORIGIN}/api/forum/handle-availability?handle=Unexpected`), unexpectedEnv), /database unavailable/, "Unexpected database failures must not look like handle conflicts.");
}

async function testPublicPrivacyStatusAndEscaping(profiles, auth) {
  const fixture = await createFixture(auth);
  const member = await fixture.user("private-email", true);
  const markup = `<script>alert("x")</script>`;
  let response = await profiles.handleForumProfileCollection(request("/api/forum/profile", "POST", { handle: "PublicMember", displayName: markup, biography: `<b>hello</b>\n${markup}` }, member), fixture.env, { now: NOW });
  assert.equal(response.status, 201);
  response = await profiles.getPublicProfile(fixture.env, "publicmember");
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.profile).sort(), ["avatarUrl", "avatarVersion", "biography", "displayName", "handle", "joinedAt"]);
  assert.equal(JSON.stringify(payload).includes("private-email"), false, "Public lookup must not expose account identity.");

  response = await profiles.renderPublicProfilePage(new Request(`${ORIGIN}/forum/member/PublicMember`), fixture.env, "PublicMember");
  const html = await response.text();
  assert.doesNotMatch(html, /<script>alert|<b>hello<\/b>/, "Public markup must be escaped.");
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /<br>/, "Biography line breaks should be preserved.");

  await fixture.env.TRG_ORDERS.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").bind(new Date(NOW + 1).toISOString(), member.userId).run();
  response = await profiles.getPublicProfile(fixture.env, "PublicMember");
  assert.equal(response.status, 404, "Disabled account profile should be publicly unavailable.");
  response = await profiles.getPublicProfile(fixture.env, "MissingMember");
  assert.equal(response.status, 404, "Missing profile should return public not found.");
}

async function createFixture(auth) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  const env = { TRG_ORDERS: d1(raw) };
  return {
    env,
    async user(label, verified) {
      const userId = `user-${label}`;
      const token = `session-${label}`;
      const csrf = `csrf-${label}`;
      const now = new Date(NOW).toISOString();
      await env.TRG_ORDERS.prepare("INSERT INTO users (id, email_normalized, email_verified, email_verified_at, status, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'user', ?, ?)")
        .bind(userId, `${label}@example.com`, verified ? 1 : 0, verified ? now : null, now, now).run();
      await env.TRG_ORDERS.prepare("INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(`id-${label}`, userId, await auth.hashToken(token), await auth.hashToken(csrf), now, new Date(NOW + 86400000).toISOString(), now).run();
      return { csrf, token, userId };
    }
  };
}

function request(pathname, method, body, identity = {}) {
  return new Request(`${ORIGIN}${pathname}`, {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: identity.token ? `__Host-trg_session=${identity.token}; trg_account_csrf=${identity.csrf}` : "",
      origin: identity.origin || ORIGIN,
      "x-csrf-token": identity.csrf || ""
    }
  });
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

function assertFilesAndRoutes() {
  const migration = fs.readFileSync(path.join(ROOT, "migrations", "009_forum_profiles.sql"), "utf8");
  assert.match(migration, /handle_normalized TEXT NOT NULL UNIQUE/);
  assert.match(migration, /ON DELETE CASCADE/);
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/forum/*"));
  assert.ok(routes.include.includes("/forum/member/*"));
  const profileRoute = fs.readFileSync(path.join(ROOT, "functions", "api", "forum", "profile", "[[handle]].js"), "utf8");
  assert.match(profileRoute, /handleForumProfileCollection/, "The optional-handle route must serve collection mutations at /api/forum/profile.");
  assert.match(profileRoute, /Array\.isArray\(params\.handle\)/, "The profile API route must normalize Pages catch-all parameters.");
  const memberRoute = fs.readFileSync(path.join(ROOT, "functions", "forum", "member", "[[handle]].js"), "utf8");
  assert.match(memberRoute, /Array\.isArray\(params\.handle\)/, "The public member route must normalize Pages catch-all parameters.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
