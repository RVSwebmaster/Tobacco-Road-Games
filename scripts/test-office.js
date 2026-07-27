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
  const storageModule = await importModule("functions/_lib/office-storage.mjs");
  const auth = await importModule("functions/_lib/office-mutation-auth.mjs");
  const api = await importModule("functions/_lib/office-api.mjs");

  await testSchemaAndRecovery(d1);
  await testChecksumAndImmutability(storageModule);
  await testAuthorizationAndApi(api, auth);
  assertNoDeleteAuthority();
  assertStorageBoundary();
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

async function testChecksumAndImmutability(storageModule) {
  const bytes = new TextEncoder().encode("verified content");
  const hash = await sha256Hex(bytes);
  const bucket = createBucket(bytes, hash);
  const storage = storageModule.createOfficeStorage(bucket);
  const item = {
    id: crypto.randomUUID(),
    expected_content_type: "text/plain",
    expected_sha256_hex: hash,
    expected_size: bytes.length,
    final_r2_key: "versions/project/file/version",
    pending_r2_key: "pending/batch/item",
    version_id: crypto.randomUUID()
  };
  const received = await storage.reserveUpload(item, new Request("https://staging.example/office/api/upload", {
    body: bytes,
    duplex: "half",
    method: "PUT"
  }));
  assert.equal(received.sha256, hash);
  const result = await storage.storeVersion(item);
  assert.equal(result.verified, true);
  assert.equal(bucket.puts.length, 2);
  assert.equal(bucket.deletes, undefined);

  await assert.rejects(
    storage.storeVersion(item),
    (error) => error.code === "immutable_key_exists",
    "An immutable version must never be overwritten."
  );

  const mismatchBucket = createBucket(bytes, "0".repeat(64));
  const mismatchStorage = storageModule.createOfficeStorage(mismatchBucket);
  await assert.rejects(
    mismatchStorage.reserveUpload(item, new Request("https://staging.example/office/api/upload", {
      body: bytes,
      duplex: "half",
      method: "PUT"
    })),
    (error) => error.code === "upload_checksum_rejected"
  );
}

async function testAuthorizationAndApi(api, csrfModule) {
  const db = createD1();
  const bucket = createBucket(new Uint8Array(), await sha256Hex(new Uint8Array()));
  const env = {
    OFFICE_ACCESS_AUD: "office-audience",
    OFFICE_ACCESS_EMAIL: ACTOR,
    OFFICE_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    OFFICE_CSRF_SECRET: "office-csrf-secret-at-least-32-characters",
    TRG_OFFICE: db,
    TRG_OFFICE_ARCHIVE: bucket
  };
  const authOptions = {
    jwks: {},
    jwtVerify: async () => ({ payload: { email: ACTOR, sub: "owner-subject" } })
  };
  for (const missing of ["OFFICE_ACCESS_TEAM_DOMAIN", "OFFICE_ACCESS_AUD", "OFFICE_ACCESS_EMAIL"]) {
    const incompleteEnv = { ...env };
    delete incompleteEnv[missing];
    const denied = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
      headers: { "cf-access-jwt-assertion": "must-not-be-trusted" }
    }), incompleteEnv, { auth: authOptions });
    await assertSafeDenial(denied, 503, "office_access_not_configured", env);
  }
  const invalidDomain = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    headers: { "cf-access-jwt-assertion": "must-not-be-trusted" }
  }), { ...env, OFFICE_ACCESS_TEAM_DOMAIN: "http://not-secure.example" }, { auth: authOptions });
  await assertSafeDenial(invalidDomain, 503, "office_access_not_configured", env);

  let response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`), env, {
    auth: authOptions
  });
  await assertSafeDenial(response, 403, "office_access_missing", env);

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    headers: { "cf-access-jwt-assertion": "invalid-jwt-value" }
  }), env, {
    auth: { jwks: {}, jwtVerify: async () => { throw new Error("invalid test assertion"); } }
  });
  await assertSafeDenial(response, 403, "office_access_invalid", env);

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    headers: { "cf-access-jwt-assertion": "wrong-audience-jwt" }
  }), { ...env, OFFICE_ACCESS_AUD: "wrong-audience" }, {
    auth: {
      jwks: {},
      jwtVerify: async (_token, _jwks, verifyOptions) => {
        assert.equal(verifyOptions.audience, "wrong-audience");
        throw new Error("audience mismatch");
      }
    }
  });
  await assertSafeDenial(response, 403, "office_access_invalid", env);

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    headers: { "cf-access-jwt-assertion": "wrong-owner-jwt" }
  }), env, {
    auth: {
      jwks: {},
      jwtVerify: async () => ({ payload: { email: "intruder@example.com", sub: "intruder" } })
    }
  });
  await assertSafeDenial(response, 403, "office_access_identity_rejected", env);

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

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    body: JSON.stringify({ name: "Missing CSRF" }),
    headers: {
      "cf-access-jwt-assertion": "test-jwt",
      "content-type": "application/json",
      origin: ORIGIN
    },
    method: "POST"
  }), env, { auth: authOptions });
  await assertSafeDenial(response, 403, "office_csrf_rejected", env);

  response = await api.handleOfficeApiRequest(new Request(`${ORIGIN}/office/api/projects`, {
    body: JSON.stringify({ name: "Invalid CSRF" }),
    headers: {
      "cf-access-jwt-assertion": "test-jwt",
      "content-type": "application/json",
      cookie: "trg_office_csrf=malformed.matching",
      origin: ORIGIN,
      "x-csrf-token": "malformed.matching"
    },
    method: "POST"
  }), env, { auth: authOptions });
  await assertSafeDenial(response, 403, "office_csrf_invalid", env);

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

async function assertSafeDenial(response, expectedStatus, expectedCode, env) {
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.error.code, expectedCode);
  assert.doesNotMatch(text, /must-not-be-trusted|invalid-jwt-value|wrong-audience-jwt|wrong-owner-jwt|malformed\.matching/);
  assert.doesNotMatch(text, new RegExp(escapeRegex(env.OFFICE_CSRF_SECRET)));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoDeleteAuthority() {
  for (const relative of [
    "functions/_lib/office-api.mjs",
    "functions/_lib/office-storage.mjs",
    "functions/_lib/office-d1.mjs"
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /\.delete\s*\(/, `${relative} must not delete R2 objects.`);
    assert.doesNotMatch(source, /DELETE\s+FROM/i, `${relative} must not hard-delete D1 records.`);
  }
}

function assertStorageBoundary() {
  const libraryDirectory = path.join(ROOT, "functions", "_lib");
  for (const filename of fs.readdirSync(libraryDirectory).filter((name) => name.startsWith("office-") && name.endsWith(".mjs"))) {
    if (filename === "office-storage.mjs") continue;
    const source = fs.readFileSync(path.join(libraryDirectory, filename), "utf8");
    assert.doesNotMatch(source, /TRG_OFFICE_ARCHIVE\.(?:get|head|put|delete|list)\s*\(/);
    assert.doesNotMatch(source, /\br2Binding\.(?:get|head|put|delete|list)\s*\(/);
  }
}

function assertBrowserHashing() {
  const source = fs.readFileSync(path.join(ROOT, "office", "office.js"), "utf8");
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /\.\.\.item\.uploadHeaders/);
  assert.match(source, /"x-csrf-token": cookie\("trg_office_csrf"\)/);
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
  const objects = new Map();
  return {
    objects,
    puts: [],
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object, body: object.bytes } : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { ...object } : null;
    },
    async put(key, body, options) {
      if (objects.has(key) && options?.onlyIf?.etagDoesNotMatch === "*") return null;
      const expected = Buffer.from(options.sha256).toString("hex");
      if (expected !== hash) throw new Error("checksum mismatch");
      const storedBytes = body instanceof ReadableStream
        ? new Uint8Array(await new Response(body).arrayBuffer())
        : new Uint8Array(body);
      const object = {
        bytes: storedBytes,
        checksums: { sha256: hexToBytes(hash).buffer },
        etag: "etag",
        httpEtag: '"etag"',
        size: storedBytes.length
      };
      objects.set(key, object);
      this.puts.push({ body, key, options });
      return object;
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
