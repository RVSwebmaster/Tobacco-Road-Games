const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "office-migrations", "001_office_archive.sql"), "utf8");
const ACTOR = "owner@example.com";
const ORIGIN = "https://tobacco-road-games-staging.pages.dev";

async function main() {
  const d1 = await importModule("functions/_lib/office-d1.mjs");
  const r2 = await importModule("functions/_lib/office-r2.mjs");
  const auth = await importModule("functions/_lib/office-mutation-auth.mjs");
  const api = await importModule("functions/_lib/office-api.mjs");

  await testSchemaAndRecovery(d1);
  await testChecksumAndImmutability(r2);
  await testAuthorizationAndApi(api, auth);
  assertNoDeleteAuthority();
  assertBrowserHashing();
  console.log("TRG Office tests passed.");
}

async function testSchemaAndRecovery(d1) {
  const db = createD1();
  const project = await d1.createProject(db, { name: "Living Repository" }, ACTOR);
  const folder = await d1.createFolder(db, {
    name: "Drafts", parentId: null, projectId: project.id
  }, ACTOR);
  const reserved = await d1.reserveUploadBatch(db, {
    projectId: project.id,
    folderId: folder.id,
    files: [{
      contentType: "text/plain", fileId: null, name: "notes.txt",
      sha256: "a".repeat(64), size: 12
    }]
  }, ACTOR, { expiresAt: "2099-01-01T00:00:00.000Z" });
  const batch = await d1.getUploadBatch(db, reserved.batchId, ACTOR);
  await d1.publishUploadItem(db, batch.items[0], ACTOR, { etag: '"etag-1"' });
  const listing = await d1.browse(db, project.id, folder.id);
  assert.equal(listing.files.length, 1);
  assert.equal(listing.files[0].version_number, 1);

  const second = await d1.reserveUploadBatch(db, {
    projectId: project.id,
    folderId: folder.id,
    files: [{
      contentType: "text/plain", fileId: listing.files[0].id, name: "ignored.txt",
      sha256: "b".repeat(64), size: 14
    }]
  }, ACTOR, { expiresAt: "2099-01-01T00:00:00.000Z" });
  const secondBatch = await d1.getUploadBatch(db, second.batchId, ACTOR);
  await d1.publishUploadItem(db, secondBatch.items[0], ACTOR, { etag: '"etag-2"' });
  let details = await d1.fileDetails(db, listing.files[0].id);
  assert.deepEqual(details.versions.map((version) => version.version_number), [2, 1]);
  await d1.restoreVersion(db, details.file.id, details.versions[1].id);
  details = await d1.fileDetails(db, details.file.id);
  assert.equal(details.versions.find((version) => version.is_current).version_number, 1);

  await d1.softDelete(db, "file", details.file.id, ACTOR);
  assert.equal((await d1.browse(db, project.id, folder.id)).files.length, 0);
  assert.equal((await d1.listTrash(db)).files.length, 1);
  await d1.recoverTrash(db, "file", details.file.id);
  assert.equal((await d1.browse(db, project.id, folder.id)).files.length, 1);

  const eventId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO office_project_events
      (id, project_id, event_type, title, narrative, occurred_at, created_by, created_at)
    VALUES (?, ?, 'milestone', 'Archive created', 'Foundation event.', ?, ?, ?)
  `).bind(eventId, project.id, new Date().toISOString(), ACTOR, new Date().toISOString()).run();
  assert.equal((await db.prepare("SELECT count(*) AS count FROM office_project_events").first()).count, 1);
}

async function testChecksumAndImmutability(r2) {
  const bytes = new TextEncoder().encode("verified content");
  const hash = await sha256Hex(bytes);
  const bucket = createBucket(bytes, hash);
  const result = await r2.verifyAndPromoteOfficeObject(bucket, {
    expected_content_type: "text/plain",
    expected_sha256_hex: hash,
    expected_size: bytes.length,
    final_r2_key: "versions/project/file/version",
    pending_r2_key: "pending/batch/item",
    version_id: crypto.randomUUID()
  });
  assert.equal(result.verified, true);
  assert.equal(bucket.puts.length, 1);
  assert.equal(bucket.deletes, undefined);

  const mismatch = await r2.verifyAndPromoteOfficeObject(createBucket(bytes, "0".repeat(64)), {
    expected_content_type: "text/plain",
    expected_sha256_hex: hash,
    expected_size: bytes.length,
    final_r2_key: "versions/project/file/bad",
    pending_r2_key: "pending/batch/item",
    version_id: crypto.randomUUID()
  });
  assert.equal(mismatch.failureCode, "checksum_mismatch");
}

async function testAuthorizationAndApi(api, csrfModule) {
  const db = createD1();
  const bucket = createBucket(new Uint8Array(), await sha256Hex(new Uint8Array()));
  const env = {
    OFFICE_ACCESS_AUD: "office-audience",
    OFFICE_ACCESS_EMAIL: ACTOR,
    OFFICE_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    OFFICE_CSRF_SECRET: "office-csrf-secret-at-least-32-characters",
    OFFICE_R2_ACCESS_KEY_ID: "access-key",
    OFFICE_R2_ACCOUNT_ID: "account-id",
    OFFICE_R2_BUCKET_NAME: "trg-office-archive-staging",
    OFFICE_R2_SECRET_ACCESS_KEY: "secret-key",
    TRG_OFFICE: db,
    TRG_OFFICE_ARCHIVE: bucket
  };
  const authOptions = {
    jwks: {},
    jwtVerify: async () => ({ payload: { email: ACTOR, sub: "owner-subject" } })
  };
  let response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`), env, {
    auth: authOptions
  });
  assert.equal(response.status, 403, "Access assertion is mandatory.");

  const token = await csrfModule.createCsrf("owner-subject", env.OFFICE_CSRF_SECRET);
  const requestHeaders = {
    "cf-access-jwt-assertion": "test-jwt",
    "content-type": "application/json",
    cookie: `trg_office_csrf=${token}`,
    origin: ORIGIN,
    "x-csrf-token": token
  };
  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    body: JSON.stringify({ name: "Office API Project" }),
    headers: requestHeaders,
    method: "POST"
  }), env, { auth: authOptions });
  assert.equal(response.status, 201);
  const project = (await response.json()).project;

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/folders`, {
    body: JSON.stringify({ name: "Sources", projectId: project.id }),
    headers: requestHeaders,
    method: "POST"
  }), env, { auth: authOptions });
  assert.equal(response.status, 201);

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    body: JSON.stringify({ name: "Rejected" }),
    headers: { ...requestHeaders, origin: "https://evil.example" },
    method: "POST"
  }), env, { auth: authOptions });
  assert.equal(response.status, 403);
  const audits = await db.prepare("SELECT action, outcome FROM office_audit_records ORDER BY id").all();
  assert.ok(audits.results.some((item) => item.action === "project.create" && item.outcome === "succeeded"));
  assert.ok(audits.results.some((item) => item.outcome === "rejected"));
}

function assertNoDeleteAuthority() {
  for (const relative of [
    "functions/_lib/office-api.mjs",
    "functions/_lib/office-r2.mjs",
    "functions/_lib/office-d1.mjs"
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /\.delete\s*\(/, `${relative} must not delete R2 objects.`);
    assert.doesNotMatch(source, /DELETE\s+FROM/i, `${relative} must not hard-delete D1 records.`);
  }
}

function assertBrowserHashing() {
  const source = fs.readFileSync(path.join(ROOT, "office", "office.js"), "utf8");
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /headers: item\.uploadHeaders/);
  assert.match(source, /\/complete/);
}

function createD1() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) { return prepared(raw.prepare(sql)); }
  };
}

function prepared(statement, values = []) {
  return {
    all: async () => ({ results: statement.all(...values) }),
    bind: (...next) => prepared(statement, next),
    first: async () => statement.get(...values) || null,
    run: async () => {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
  };
}

function createBucket(bytes, hash) {
  return {
    puts: [],
    async get(key) {
      if (!key.startsWith("pending/")) return null;
      return { body: bytes, size: bytes.length };
    },
    async head(key) {
      if (!key.startsWith("pending/")) return null;
      return { checksums: { sha256: hexToBytes(hash).buffer }, size: bytes.length };
    },
    async put(key, body, options) {
      this.puts.push({ body, key, options });
      return { etag: "etag", httpEtag: '"etag"' };
    }
  };
}

async function sha256Hex(bytes) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}
function hexToBytes(value) { return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16)); }
function importModule(relative) { return import(pathToFileURL(path.join(ROOT, relative)).href); }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
