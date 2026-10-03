const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://staging.tobaccoroadgames.com';
const NOW = Date.now();

async function createFixture() {
  const auth = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/account-auth.mjs')));
  const owner = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/owner-auth.mjs')));
  const api = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/shelf-curios.mjs')));
  const raw = new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(path.join(ROOT, 'migrations/007_shared_accounts.sql'), 'utf8'));
  raw.exec('CREATE TABLE user_account_profiles (user_id TEXT PRIMARY KEY, display_name TEXT);');
  raw.exec(fs.readFileSync(path.join(ROOT, 'migrations/048_shelf_curios.sql'), 'utf8'));
  const now = new Date(NOW).toISOString();
  raw.prepare("INSERT INTO users (id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES ('member-1','private@example.com',1,'active','user',?,?)").run(now, now);
  raw.prepare("INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES ('session-1','member-1',?,?,?,?,?)")
    .run(await auth.hashToken('member-session'), await auth.hashToken('member-csrf'), now, new Date(NOW + 86400000).toISOString(), now);
  const env = {
    TRG_ORDERS: d1(raw), FORUM_RATE_LIMIT_SECRET: 'test-forum-secret-at-least-32-characters',
    OWNER_SESSION_SECRET: 'test-owner-session-at-least-32-characters', OWNER_CSRF_SECRET: 'test-owner-csrf-at-least-32-characters'
  };
  const ownerSession = await owner.createSessionToken('RV', env.OWNER_SESSION_SECRET);
  const ownerCsrf = await owner.createCsrfToken('RV', env.OWNER_CSRF_SECRET);
  const fixture = { raw, env, api, now: NOW, ownerSession, ownerCsrf };
  const response = await api.handleShelfCuriosRequest(new Request(`${ORIGIN}/api/curios`), env);
  assert.equal(response.status, 200);
  fixture.csrf = (await response.json()).csrfToken;
  fixture.cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return fixture;
}

function d1(raw) {
  const prepare = (sql, values = []) => ({
    _sql: sql, _values: values, bind: (...next) => prepare(sql, next),
    first: async () => raw.prepare(sql).get(...values) || null,
    all: async () => ({ results: raw.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...values).changes) } })
  });
  return {
    prepare: sql => prepare(sql),
    batch: async statements => {
      raw.exec('BEGIN');
      try {
        const results = statements.map(statement => ({ meta: { changes: Number(raw.prepare(statement._sql).run(...statement._values).changes) } }));
        raw.exec('COMMIT');
        return results;
      } catch (error) { raw.exec('ROLLBACK'); throw error; }
    }
  };
}

function moveRequest(fixture, body, overrides = {}) {
  return new Request(`${ORIGIN}/api/curios`, {
    method: 'POST', headers: { cookie: fixture.cookie, origin: ORIGIN, 'x-csrf-token': fixture.csrf,
      'cf-connecting-ip': '192.0.2.1', 'content-type': 'application/json', ...overrides },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function ownerRequest(fixture, reset = false, overrides = {}) {
  return new Request(`${ORIGIN}/owner/api/curios`, {
    method: reset ? 'POST' : 'GET', headers: {
      cookie: `trg_owner_session=${fixture.ownerSession}; trg_owner_csrf=${fixture.ownerCsrf}`,
      origin: ORIGIN, 'x-csrf-token': fixture.ownerCsrf, 'content-type': 'application/json', ...overrides
    }, ...(reset ? { body: JSON.stringify({ action: 'reset' }) } : {})
  });
}

async function main() {
  let fixture = await createFixture();
  const { api, env, raw } = fixture;
  let response = await api.handleShelfCuriosRequest(new Request(`${ORIGIN}/api/curios`), env);
  const initial = await response.json();
  assert.deepEqual(initial.curios[0], { id: 'harimafuji', name: 'Yokozuna Harimafuji', shelfId: 'bric-a-brac-1', x: 0.5, y: 0.5, revision: 0 });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(response.headers.getSetCookie().every(cookie => cookie.includes('Secure') && cookie.includes('HttpOnly')));

  const placement = { id: 'harimafuji', revision: 0, x: 0.7, y: 0.25 };
  response = await api.handleShelfCuriosRequest(moveRequest(fixture, placement), env);
  assert.equal(response.status, 200, 'Anonymous visitors must be able to move curios.');
  assert.equal((await response.json()).curio.revision, 1);
  assert.match(raw.prepare('SELECT actor_id FROM shelf_curio_events').get().actor_id, /^visitor:/);
  response = await api.handleShelfCuriosRequest(new Request(`${ORIGIN}/api/curios`), env, { nowMs: NOW + 3 * 365 * 86400000 });
  assert.equal((await response.json()).curios[0].x, 0.7, 'Another visitor years later sees the same arrangement.');
  raw.exec(fs.readFileSync(path.join(ROOT, 'migrations/048_shelf_curios.sql'), 'utf8'));
  assert.equal(raw.prepare('SELECT x FROM shelf_curios').get().x, 0.7, 'Migration reapplication must not reset arrangements.');
  response = await api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 1 }, { cookie: `${fixture.cookie}; __Host-trg_session=member-session` }), env);
  assert.equal(response.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM shelf_curio_events').get().count, 1, 'Putting a curio back without moving it is not new activity.');
  response = await api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 1, x: 0.8 }, { cookie: `${fixture.cookie}; __Host-trg_session=member-session` }), env);
  assert.equal(response.status, 200);
  assert.equal(raw.prepare("SELECT actor_id FROM shelf_curio_events WHERE action='move' ORDER BY rowid DESC").get().actor_id, 'member-1');
  response = await api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, x: 0.1 }), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).curio.x, 0.8);

  for (const overrides of [{ origin: 'https://evil.example' }, { 'x-csrf-token': 'wrong' }, { cookie: '' }]) {
    assert.equal((await api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 2 }, overrides), env)).status, 403);
  }
  for (const body of [{ ...placement, x: -1 }, { ...placement, y: 2 }, { ...placement, x: '0.5' }, { ...placement, revision: 0.5 }, { ...placement, id: 'tardis' }, '[]', 'null', '{', ' '.repeat(4097)]) {
    assert.equal((await api.handleShelfCuriosRequest(moveRequest(fixture, body), env)).status, 400);
  }
  assert.equal((await api.handleShelfCuriosRequest(new Request(`${ORIGIN}/api/curios`, { method: 'DELETE' }), env)).status, 405);
  assert.equal((await api.handleShelfCuriosRequest(new Request(`${ORIGIN}/api/curios`), {})).status, 503);
  assert.equal((await api.handleOwnerShelfCuriosRequest(new Request(`${ORIGIN}/owner/api/curios`), env)).status, 401);
  assert.equal((await api.handleOwnerShelfCuriosRequest(ownerRequest(fixture, true, { cookie: `${fixture.cookie}; __Host-trg_session=member-session` }), env)).status, 401);
  assert.equal((await api.handleOwnerShelfCuriosRequest(ownerRequest(fixture, true, { 'x-csrf-token': 'wrong' }), env)).status, 403);
  assert.equal((await api.handleOwnerShelfCuriosRequest(ownerRequest(fixture, true, { origin: 'https://evil.example' }), env)).status, 403);
  response = await api.handleOwnerShelfCuriosRequest(ownerRequest(fixture), env);
  assert.equal(response.status, 200);
  const activity = await response.json();
  assert.equal(activity.counts.moves, 2);
  assert.ok(!JSON.stringify(activity).includes('private@example.com') && !JSON.stringify(activity).includes('visitor-network:'), 'Private owner activity must not expose emails or network hashes.');
  response = await api.handleOwnerShelfCuriosRequest(ownerRequest(fixture, true), env);
  assert.equal(response.status, 200);
  const reset = (await response.json()).curios[0];
  assert.equal(reset.x, 0.5); assert.equal(reset.y, 0.5); assert.equal(reset.revision, 3);
  assert.equal((await api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 2 }), env)).status, 409, 'Reset must invalidate an unfinished move.');

  fixture = await createFixture();
  const concurrent = await Promise.all([0.2, 0.9].map(x => fixture.api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, x }), fixture.env)));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  assert.equal(fixture.raw.prepare('SELECT COUNT(*) AS count FROM shelf_curio_events').get().count, 1);

  fixture = await createFixture();
  for (let revision = 0; revision < 30; revision++) {
    const result = await fixture.api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision, x: revision % 2 ? 0.2 : 0.8 }), fixture.env, { nowMs: NOW });
    assert.equal(result.status, 200);
  }
  // Changing the anonymous browser cookie must not bypass its network limit.
  fixture.cookie = fixture.cookie.replace(/trg_curio_visitor=[^;]+/, `trg_curio_visitor=${crypto.randomUUID()}`);
  response = await fixture.api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 30, x: 0.8 }), fixture.env, { nowMs: NOW });
  assert.equal(response.status, 429);
  assert.equal(fixture.raw.prepare('SELECT revision FROM shelf_curios').get().revision, 30);
  response = await fixture.api.handleShelfCuriosRequest(moveRequest(fixture, { ...placement, revision: 30, x: 0.8 }), fixture.env, { nowMs: NOW + 61000 });
  assert.equal(response.status, 200);

  fixture = await createFixture();
  fixture.raw.exec("CREATE TRIGGER fail_shelf BEFORE UPDATE ON shelf_curios BEGIN SELECT RAISE(ABORT, 'forced failure'); END;");
  assert.equal((await fixture.api.handleShelfCuriosRequest(moveRequest(fixture, placement), fixture.env)).status, 503);
  assert.equal(fixture.raw.prepare('SELECT revision FROM shelf_curios').get().revision, 0);
  assert.equal(fixture.raw.prepare('SELECT COUNT(*) AS count FROM shelf_curio_events').get().count, 0, 'Failed saves must roll back activity and placement together.');
  assert.equal((await fixture.api.handleOwnerShelfCuriosRequest(ownerRequest(fixture, true), fixture.env)).status, 503);
  assert.equal(fixture.raw.prepare('SELECT COUNT(*) AS count FROM shelf_curio_events').get().count, 0, 'Failed reset must roll back its audit event.');
  console.log('Shared shelf curios: public movement, years-long persistence, member attribution, bounds, CSRF, concurrency, abuse limits, owner reset, and atomic rollback passed.');
}

module.exports = { createFixture, moveRequest, ownerRequest, ORIGIN };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
