const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://tobaccoroadgames.com";
const NOW = Date.parse("2026-07-31T16:00:00.000Z");
const MIGRATION = ["007_shared_accounts.sql", "008_token_claim_markers.sql", "009_forum_profiles.sql", "011_forum_profile_avatars.sql"]
  .map((file) => fs.readFileSync(path.join(ROOT, "migrations", file), "utf8")).join("\n");
const PNG = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
const JPEG = Uint8Array.from([0xff,0xd8,0xff,0xe0,0x00,0xff,0xd9]);
const WEBP = Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]);

async function main() {
  const avatars = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-avatars.mjs")).href);
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  const profiles = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "forum-profiles.mjs")).href);
  await testDatabaseAvatarStateConstraint(auth);
  await testAcceptedUploads(avatars, auth);
  await testAuthenticationAndValidation(avatars, auth);
  await testPublicDeliveryAndPrivacy(avatars, auth, profiles);
  await testPresetSelectionAndRetroactiveResolution(avatars, auth);
  await testReplacementFailureCleanupAndDeletion(avatars, auth);
  assertImplementationBoundaries();
  console.log("Forum avatar tests passed.");
}

async function testDatabaseAvatarStateConstraint(auth) {
  const fixture = await createFixture(auth);
  const setState = (presetId, objectKey, mediaType) => fixture.raw.prepare(`
    UPDATE forum_profiles
    SET avatar_preset_id = ?, avatar_object_key = ?, avatar_media_type = ?
    WHERE user_id = 'avatar-user'
  `).run(presetId, objectKey, mediaType);

  assert.doesNotThrow(() => setState(null, null, null), "The default avatar state must be accepted.");
  assert.doesNotThrow(() => setState("brass-d20", null, null), "A preset-only avatar state must be accepted.");
  assert.doesNotThrow(() => setState(null, "forum-avatars/complete.webp", "image/webp"), "A complete custom-avatar state must be accepted.");

  const rejected = [
    ["brass-d20", "forum-avatars/key-only.png", null, "preset ID plus custom object key"],
    ["brass-d20", null, "image/png", "preset ID plus custom media type"],
    [null, "forum-avatars/key-only.png", null, "object key without media type"],
    [null, null, "image/png", "media type without object key"],
    ["brass-d20", "forum-avatars/complete.png", "image/png", "preset and complete custom metadata"]
  ];
  for (const [presetId, objectKey, mediaType, label] of rejected) {
    assert.throws(() => setState(presetId, objectKey, mediaType), /CHECK constraint failed/, `D1 must reject ${label}.`);
  }
}

async function testPresetSelectionAndRetroactiveResolution(avatars, auth) {
  const fixture = await createFixture(auth);
  const existingReference = { authorUserId: "avatar-user", authorHandle: "PublicAvatar" };

  let response = await avatars.handleForumAvatarMutation(presetRequest("brass-d20", fixture.identity), fixture.env, { now: NOW });
  assert.equal(response.status, 200);
  let row = fixture.raw.prepare("SELECT * FROM forum_profiles WHERE user_id = ?").get(existingReference.authorUserId);
  assert.equal(row.avatar_preset_id, "brass-d20");
  assert.equal(row.avatar_object_key, null);
  assert.equal(fixture.bucket.objects.size, 0, "Presets must not create per-user R2 copies.");
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/${existingReference.authorHandle}?v=1`), fixture.env, existingReference.authorHandle);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/assets/forum-avatars/brass-d20.svg");

  response = await avatars.handleForumAvatarMutation(presetRequest("moon-owl", fixture.identity), fixture.env, { now: NOW + 1 });
  assert.equal(response.status, 200);
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/${existingReference.authorHandle}?v=2`), fixture.env, existingReference.authorHandle);
  assert.equal(response.headers.get("location"), "/assets/forum-avatars/moon-owl.svg", "Existing author references must resolve the newly selected preset.");

  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", WEBP, fixture.identity, "image/webp"), fixture.env, { now: NOW + 2 });
  assert.equal(response.status, 200);
  row = fixture.raw.prepare("SELECT * FROM forum_profiles WHERE user_id = ?").get(existingReference.authorUserId);
  assert.equal(row.avatar_preset_id, null);
  const firstCustomKey = row.avatar_object_key;
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/${existingReference.authorHandle}?v=3`), fixture.env, existingReference.authorHandle);
  assert.equal(response.status, 200);

  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, fixture.identity, "image/png"), fixture.env, { now: NOW + 3 });
  assert.equal(response.status, 200);
  row = fixture.raw.prepare("SELECT * FROM forum_profiles WHERE user_id = ?").get(existingReference.authorUserId);
  assert.notEqual(row.avatar_object_key, firstCustomKey);
  assert.equal(fixture.bucket.objects.has(firstCustomKey), false);
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/${existingReference.authorHandle}?v=4`), fixture.env, existingReference.authorHandle);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG, "Existing references must deliver the replacement custom avatar.");

  response = await avatars.handleForumAvatarMutation(avatarRequest("DELETE", null, fixture.identity), fixture.env, { now: NOW + 4 });
  assert.equal(response.status, 200);
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/${existingReference.authorHandle}?v=5`), fixture.env, existingReference.authorHandle);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /logo\.png/, "Deleting an avatar must restore the default for existing references.");

  response = await avatars.handleForumAvatarMutation(presetRequest("not-a-preset", fixture.identity), fixture.env, { now: NOW });
  assert.equal(response.status, 400);
}

async function testAcceptedUploads(avatars, auth) {
  const cases = [["image/png", PNG, ".png"], ["image/jpeg", JPEG, ".jpg"], ["image/webp", WEBP, ".webp"]];
  const keys = [];
  for (const [type, bytes, extension] of cases) {
    const fixture = await createFixture(auth);
    const response = await avatars.handleForumAvatarMutation(avatarRequest("POST", bytes, fixture.identity, type), fixture.env, { now: NOW });
    assert.equal(response.status, 200, `${type} upload should succeed.`);
    const row = fixture.raw.prepare("SELECT * FROM forum_profiles").get();
    assert.match(row.avatar_object_key, /^forum-avatars\/[0-9a-f-]{36}\.(png|jpg|webp)$/);
    assert.ok(row.avatar_object_key.endsWith(extension));
    assert.equal(row.avatar_media_type, type);
    assert.equal(row.avatar_version, 1);
    assert.equal(fixture.bucket.objects.has(row.avatar_object_key), true);
    keys.push(row.avatar_object_key);
  }
  assert.equal(new Set(keys).size, 3, "Server-generated avatar keys should be random and unique.");
}

async function testAuthenticationAndValidation(avatars, auth) {
  let fixture = await createFixture(auth);
  let response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, null, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 401);

  fixture = await createFixture(auth, { verified: false });
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, fixture.identity, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "email_verification_required");

  fixture = await createFixture(auth, { profile: false });
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, fixture.identity, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 404);

  fixture = await createFixture(auth);
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, { ...fixture.identity, csrf: "wrong" }, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 403);
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, { ...fixture.identity, origin: "https://evil.example" }, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 403);

  const oversized = new Uint8Array(avatars.AVATAR_MAX_BYTES + 1); oversized.set(PNG);
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", oversized, fixture.identity, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 413);
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", Uint8Array.from([0x47,0x49,0x46,0x38,0x39,0x61]), fixture.identity, "image/gif"), fixture.env, { now: NOW });
  assert.equal(response.status, 415);
  response = await avatars.handleForumAvatarMutation(avatarRequest("POST", JPEG, fixture.identity, "image/png"), fixture.env, { now: NOW });
  assert.equal(response.status, 415); assert.equal((await response.json()).error.code, "avatar_mime_mismatch");
}

async function testPublicDeliveryAndPrivacy(avatars, auth, profiles) {
  const fixture = await createFixture(auth);
  let response = await avatars.handleForumAvatarMutation(avatarRequest("POST", WEBP, fixture.identity, "image/webp"), fixture.env, { now: NOW });
  assert.equal(response.status, 200);
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/PublicAvatar?v=1`), fixture.env, "PublicAvatar");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), WEBP);

  response = await profiles.getPublicProfile(fixture.env, "publicavatar");
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.profile).sort(), ["avatarUrl", "avatarVersion", "biography", "displayName", "handle", "joinedAt"]);
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const privateField of ["email", "google", "provider", "role", "session", "avatar_object_key"]) assert.equal(serialized.includes(privateField), false);

  await fixture.env.TRG_ORDERS.prepare("UPDATE forum_profiles SET status = 'inactive' WHERE user_id = 'avatar-user'").run();
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/PublicAvatar`), fixture.env, "PublicAvatar");
  assert.equal(response.status, 404);
}

async function testReplacementFailureCleanupAndDeletion(avatars, auth) {
  const events = [];
  let fixture = await createFixture(auth, { avatar: { key: "forum-avatars/old.png", mediaType: "image/png", version: 4 }, events });
  fixture.bucket.objects.set("forum-avatars/old.png", PNG);
  let response = await avatars.handleForumAvatarMutation(avatarRequest("POST", JPEG, fixture.identity, "image/jpeg"), fixture.env, { now: NOW });
  assert.equal(response.status, 200);
  const row = fixture.raw.prepare("SELECT * FROM forum_profiles").get();
  assert.equal(row.avatar_version, 5);
  assert.notEqual(row.avatar_object_key, "forum-avatars/old.png");
  assert.equal(fixture.bucket.objects.has("forum-avatars/old.png"), false);
  assert.ok(events.indexOf("put") < events.indexOf("db-update") && events.indexOf("db-update") < events.indexOf("delete:forum-avatars/old.png"), "Replacement must put, update D1, then delete old object.");

  fixture = await createFixture(auth, { failAvatarUpdate: true });
  await assert.rejects(() => avatars.handleForumAvatarMutation(avatarRequest("POST", PNG, fixture.identity, "image/png"), fixture.env, { now: NOW }), /Simulated avatar update failure/);
  assert.equal(fixture.bucket.objects.size, 0, "Failed D1 updates must clean the new R2 orphan.");
  assert.equal(fixture.bucket.putKeys.length, 1);
  assert.deepEqual(fixture.bucket.deleteKeys, fixture.bucket.putKeys);

  fixture = await createFixture(auth, { avatar: { key: "forum-avatars/delete.webp", mediaType: "image/webp", version: 2 } });
  fixture.bucket.objects.set("forum-avatars/delete.webp", WEBP);
  response = await avatars.handleForumAvatarMutation(avatarRequest("DELETE", null, fixture.identity), fixture.env, { now: NOW });
  assert.equal(response.status, 200);
  const deleted = fixture.raw.prepare("SELECT * FROM forum_profiles").get();
  assert.equal(deleted.avatar_object_key, null);
  assert.equal(deleted.avatar_media_type, null);
  assert.equal(deleted.avatar_version, 3);
  assert.equal(fixture.bucket.objects.has("forum-avatars/delete.webp"), false);
  response = await avatars.deliverForumAvatar(new Request(`${ORIGIN}/forum/avatar/PublicAvatar?v=3`), fixture.env, "PublicAvatar");
  assert.equal(response.status, 302); assert.match(response.headers.get("location"), /logo\.png/);
}

async function createFixture(auth, options = {}) {
  const raw = new DatabaseSync(":memory:"); raw.exec(MIGRATION);
  const events = options.events || [];
  const adapter = d1(raw, { events, failAvatarUpdate: options.failAvatarUpdate });
  const bucket = createBucket(events);
  const env = { TRG_FORUM_AVATARS: bucket, TRG_ORDERS: adapter };
  const now = new Date(NOW).toISOString();
  const verified = options.verified !== false;
  raw.prepare("INSERT INTO users (id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at) VALUES ('avatar-user','private@example.com',?,?, 'active','user',?,?)")
    .run(verified ? 1 : 0, verified ? now : null, now, now);
  const token = "avatar-session-token"; const csrf = "avatar-csrf-token";
  raw.prepare("INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES ('avatar-session','avatar-user',?,?,?,?,?)")
    .run(await auth.hashToken(token), await auth.hashToken(csrf), now, new Date(NOW + 86400000).toISOString(), now);
  if (options.profile !== false) {
    const avatar = options.avatar || {};
    raw.prepare("INSERT INTO forum_profiles (user_id,handle,handle_normalized,display_name,biography,status,created_at,updated_at,avatar_object_key,avatar_media_type,avatar_preset_id,avatar_version,avatar_updated_at) VALUES ('avatar-user','PublicAvatar','publicavatar','Public Name',NULL,'active',?,?,?,?,?,?,?)")
      .run(now, now, avatar.key || null, avatar.mediaType || null, avatar.presetId || null, avatar.version || 0, avatar.key || avatar.presetId ? now : null);
  }
  return { bucket, env, identity: { csrf, token }, raw };
}

function avatarRequest(method, bytes, identity, contentType) {
  const headers = { origin: identity?.origin || ORIGIN };
  if (identity) { headers.cookie = `__Host-trg_session=${identity.token}; trg_account_csrf=${identity.csrf}`; headers["x-csrf-token"] = identity.csrf; }
  if (contentType) headers["content-type"] = contentType;
  return new Request(`${ORIGIN}/api/forum/profile/avatar`, { method, headers, body: bytes || undefined });
}

function presetRequest(presetId, identity) {
  const headers = { origin: identity?.origin || ORIGIN, "content-type": "application/json" };
  if (identity) { headers.cookie = `__Host-trg_session=${identity.token}; trg_account_csrf=${identity.csrf}`; headers["x-csrf-token"] = identity.csrf; }
  return new Request(`${ORIGIN}/api/forum/profile/avatar`, { method: "POST", headers, body: JSON.stringify({ presetId }) });
}

function createBucket(events) {
  const objects = new Map();
  return {
    objects, putKeys: [], deleteKeys: [],
    async put(key, bytes) { events.push("put"); this.putKeys.push(key); objects.set(key, Uint8Array.from(bytes)); },
    async get(key) { const body = objects.get(key); return body ? { body, httpEtag: '"avatar-etag"' } : null; },
    async delete(key) { events.push(`delete:${key}`); this.deleteKeys.push(key); objects.delete(key); }
  };
}

function d1(raw, options = {}) {
  return { prepare(sql) { const statement = raw.prepare(sql); const wrap = (values = []) => ({
    bind: (...next) => wrap(next), first: async () => statement.get(...values) || null, all: async () => ({ results: statement.all(...values) }),
    run: async () => { if (/UPDATE forum_profiles[\s\S]*avatar_object_key/.test(sql)) { options.events?.push("db-update"); if (options.failAvatarUpdate) throw new Error("Simulated avatar update failure"); } const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; }
  }); return wrap(); } };
}

function assertImplementationBoundaries() {
  const server = fs.readFileSync(path.join(ROOT, "functions", "_lib", "forum-avatars.mjs"), "utf8");
  assert.match(server, /forum-avatars\//);
  assert.doesNotMatch(server, /TRG_PRODUCTS|TRG_OFFICE_ARCHIVE|filename/i);
  const account = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
  assert.match(account, /No mature-themed avatars are permitted anywhere/);
  assert.match(account, /general tabletop gaming audience/);
  const browser = fs.readFileSync(path.join(ROOT, "assets", "js", "account.js"), "utf8");
  assert.match(browser, /256/); assert.match(browser, /image\/webp/); assert.match(browser, /image\/png/);
  assert.doesNotMatch(`${server}\n${browser}`, /google.*(picture|photo)|picture.*google/i, "Avatar code must not import Google imagery.");
  const presetModule = fs.readFileSync(path.join(ROOT, "functions", "_lib", "forum-avatar-presets.mjs"), "utf8");
  const presetAssets = fs.readdirSync(path.join(ROOT, "assets", "forum-avatars")).filter((file) => file.endsWith(".svg"));
  assert.ok(presetAssets.length >= 12 && presetAssets.length <= 20, "The preset gallery should contain approximately 12 to 20 choices.");
  for (const file of presetAssets) assert.match(presetModule, new RegExp(file.replace(".svg", "")), `${file} needs a stable registered ID.`);
  const migration = fs.readFileSync(path.join(ROOT, "migrations", "011_forum_profile_avatars.sql"), "utf8");
  assert.match(migration, /avatar_preset_id/);
  assert.doesNotMatch(migration, /CREATE TABLE.*(?:topics|posts|replies|notifications)|(?:topics|posts|replies|notifications).*avatar_(?:url|preset|object|snapshot)/is, "Forum content must never duplicate avatar metadata.");
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/forum/avatar/*"));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
