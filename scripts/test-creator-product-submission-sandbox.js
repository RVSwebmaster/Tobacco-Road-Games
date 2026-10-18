const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const CREATOR_ID = "creator-mock-publishing-task2";
const USER_ID = "user-mock-publishing-task2";
const PRODUCT_SLUG = "mock-product-submission-task2";
const SESSION_TOKEN = "mock-task2-session-token";
const CSRF_TOKEN = "mock-task2-csrf-token";
const NOW_MS = Date.parse("2026-10-18T16:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-18T16:00:00.000Z";
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\nTobacco Road Games disposable Task 2 submission\n%%EOF",
  "utf8"
);

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-submission-task2-")
  );
  const databasePath = path.join(sandboxRoot, "creator-submission.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogPath = path.join(ROOT, "data", "products.json");
  const catalogHashBefore = sha256File(catalogPath);
  let database;
  let productId = "";
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const creatorOperations = await load(
      "functions/_lib/creator-operations.mjs"
    );
    const creatorFiles = await load("functions/_lib/creator-files.mjs");

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of fs
      .readdirSync(path.join(ROOT, "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      database.exec(
        fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8")
      );
    }

    await createEligibleMockCreator(database, accountAuth);
    const d1 = createD1(database);
    const bucket = createLocalBucket(storageRoot);
    const environment = { TRG_ORDERS: d1, TRG_PRODUCTS: bucket };

    let response = await creatorOperations.handleCreatorRequest(
      jsonRequest("listings", {
        title: "Mock Product Submission Task 2",
        slug: PRODUCT_SLUG,
        shortDescription: "Disposable Creator product submission fixture.",
        longDescription:
          "This product exists only inside the disposable Task 2 sandbox.",
        priceCents: 700,
        mediaType: "digital",
        format: ["PDF"],
        gameSystem: "System Neutral",
        genre: "test",
        discovery: {
          playerCountMin: 1,
          playerCountMax: 6,
          language: "English"
        }
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    const createResult = await response.json();
    assert.equal(createResult.ok, true);
    productId = createResult.listing.id;
    assert.match(productId, /^[0-9a-f-]{36}$/i);
    assert.equal(createResult.listing.slug, PRODUCT_SLUG);
    assert.equal(createResult.listing.lifecycleState, "draft");

    const form = new FormData();
    form.set("purpose", "product");
    form.set(
      "file",
      new File([PDF_BYTES], "mock-product-task2.pdf", {
        type: "application/pdf"
      })
    );
    response = await creatorFiles.handleCreatorFileUpload(
      formRequest(`listings/${productId}/files`, form),
      environment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    const uploadResult = await response.json();
    assert.equal(uploadResult.ok, true);
    assert.equal(uploadResult.file.purpose, "product");
    assert.equal(uploadResult.file.state, "uploaded");

    response = await creatorOperations.handleCreatorRequest(
      jsonRequest(`listings/${productId}/submit`, {
        rightsConfirmed: true,
        representationConfirmed: true,
        licensesConfirmed: true
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const submitResult = await response.json();
    assert.deepEqual(submitResult, { ok: true, state: "submitted" });

    const listing = database
      .prepare("SELECT * FROM creator_listings WHERE id=?")
      .get(productId);
    assert.ok(listing);
    assert.equal(listing.creator_id, CREATOR_ID);
    assert.equal(listing.slug, PRODUCT_SLUG);
    assert.equal(listing.title, "Mock Product Submission Task 2");
    assert.equal(
      listing.short_description,
      "Disposable Creator product submission fixture."
    );
    assert.equal(
      listing.long_description,
      "This product exists only inside the disposable Task 2 sandbox."
    );
    assert.equal(listing.listed_price_cents, 700);
    assert.equal(listing.pricing_model, "fixed");
    assert.equal(listing.media_type, "digital");
    assert.deepEqual(JSON.parse(listing.format_json), ["PDF"]);
    assert.equal(listing.game_system, "System Neutral");
    assert.equal(listing.genre, "test");
    assert.deepEqual(JSON.parse(listing.discovery_json), {
      playerCountMin: 1,
      playerCountMax: 6,
      language: "English"
    });
    assert.equal(listing.lifecycle_state, "submitted");
    assert.equal(listing.publication_state, "not_approved");
    assert.equal(listing.public_product_slug, null);
    assert.equal(listing.source_product_slug, null);

    const storedFile = database
      .prepare("SELECT * FROM creator_listing_files WHERE id=?")
      .get(uploadResult.file.id);
    assert.ok(storedFile);
    assert.equal(storedFile.listing_id, productId);
    assert.equal(storedFile.creator_id, CREATOR_ID);
    assert.equal(storedFile.purpose, "product");
    assert.equal(storedFile.content_type, "application/pdf");
    assert.equal(storedFile.size_bytes, PDF_BYTES.length);
    assert.equal(storedFile.validation_state, "uploaded");
    assert.equal(storedFile.delivery_object_key, null);

    const storedBytes = bucket.read(storedFile.quarantine_key);
    assert.deepEqual(storedBytes, PDF_BYTES);
    assert.equal(sha256Bytes(storedBytes), sha256Bytes(PDF_BYTES));

    response = await creatorOperations.handleCreatorRequest(
      getRequest("listings"),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const retrieved = await response.json();
    assert.equal(retrieved.creator.id, CREATOR_ID);
    assert.equal(
      retrieved.listings.find((item) => item.id === productId)?.lifecycleState,
      "submitted"
    );
    assert.equal(
      retrieved.files.find((item) => item.id === storedFile.id)?.validation_state,
      "uploaded"
    );

    const publicCatalog = readJson(catalogPath);
    assert.equal(
      publicCatalog.some((product) => product.slug === PRODUCT_SLUG),
      false
    );
    assert.equal(sha256File(catalogPath), catalogHashBefore);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_listing_declarations WHERE listing_id=? AND creator_id=?"
        )
        .get(productId, CREATOR_ID).count,
      1
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_publication_audit WHERE listing_id=? AND creator_id=? AND action='submitted'"
        )
        .get(productId, CREATOR_ID).count,
      1
    );

    cleanupMockData(database, productId);
    const remaining = countRemainingMockData(database, productId);
    assert.deepEqual(remaining, {
      users: 0,
      creators: 0,
      memberships: 0,
      listings: 0,
      files: 0,
      declarations: 0,
      publicationAudits: 0
    });

    fs.rmSync(storageRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(storageRoot), false);
    assert.equal(sha256File(catalogPath), catalogHashBefore);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator product submission sandbox test passed.");
    console.log(`Creator ID: ${CREATOR_ID}`);
    console.log(`Product ID: ${productId}`);
    console.log("Listing status: submitted / not_approved");
    console.log("File status: uploaded");
    console.log(`PDF SHA-256: ${sha256Bytes(PDF_BYTES)}`);
    console.log("Public catalog entry: absent");
    console.log("Disposable records remaining: 0");
    console.log("Sandbox removed: true");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

async function createEligibleMockCreator(database, accountAuth) {
  database
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)"
    )
    .run(USER_ID, "mock-task2@example.invalid", NOW, NOW);
  database
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      "session-mock-publishing-task2",
      USER_ID,
      await accountAuth.hashToken(SESSION_TOKEN),
      await accountAuth.hashToken(CSRF_TOKEN),
      NOW,
      EXPIRES_AT,
      NOW
    );
  database
    .prepare(
      `INSERT INTO marketplace_creators(
         id,slug,display_name,short_bio,long_bio,profile_template,
         marketplace_status,registration_status,registration_completed_at,
         intake_registration_completed_at,created_at,updated_at
       ) VALUES(?,?,?,?,?,'catalog','approved','active',?,?,?,?)`
    )
    .run(
      CREATOR_ID,
      "mock-creator-publishing-task2",
      "Mock Creator Publishing Task 2",
      "Disposable Creator submission sandbox fixture.",
      "This Creator exists only in the Task 2 temporary database.",
      NOW,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)"
    )
    .run(USER_ID, CREATOR_ID, NOW);
  database
    .prepare(
      `INSERT INTO creator_identity_ownership(
         creator_id,owner_user_id,identity_type,account_status,billing_status,
         entitlement_source,created_at,updated_at
       ) VALUES(?,?,'primary','active','not_required','primary_free',?,?)`
    )
    .run(CREATOR_ID, USER_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO user_account_profiles(
         user_id,legal_name,payment_method_status,payment_method_status_updated_at,
         created_at,updated_at
       ) VALUES(?,?,'ready',?,?,?)`
    )
    .run(USER_ID, "Mock Creator Task 2", NOW, NOW, NOW);
  database
    .prepare(
      `INSERT INTO creator_registration_details(
         creator_id,legal_name,business_name,business_type,country,state_region,
         address_line1,city,postal_code,contact_email,rights_confirmation_at,
         created_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      CREATOR_ID,
      "Mock Creator Task 2",
      "",
      "individual",
      "US",
      "NC",
      "1 Disposable Test Road",
      "Durham",
      "27701",
      "mock-task2@example.invalid",
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      `INSERT INTO creator_agreement_acceptances(
         creator_id,accepted_by_user_id,agreement_id,agreement_version,
         accepted_at,source_context
       ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task2_sandbox')`
    )
    .run(CREATOR_ID, USER_ID, NOW);
  database
    .prepare(
      `INSERT INTO creator_payout_profiles(
         creator_id,provider,onboarding_status,payouts_enabled,
         verification_status,status_updated_at
       ) VALUES(?,'manual','complete',1,'verified',?)
       ON CONFLICT(creator_id) DO UPDATE SET
         onboarding_status='complete',payouts_enabled=1,
         verification_status='verified',status_updated_at=excluded.status_updated_at`
    )
    .run(CREATOR_ID, NOW);
}

function cleanupMockData(database, productId) {
  database.exec("BEGIN;");
  try {
    database
      .prepare("DELETE FROM creator_listing_declarations WHERE listing_id=?")
      .run(productId);
    database
      .prepare("DELETE FROM creator_publication_audit WHERE listing_id=?")
      .run(productId);
    database
      .prepare("DELETE FROM creator_listing_files WHERE listing_id=?")
      .run(productId);
    database
      .prepare("DELETE FROM creator_listings WHERE id=?")
      .run(productId);
    database
      .prepare("DELETE FROM creator_account_notices WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_account_audit_states WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_agreement_acceptances WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_payout_profiles WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_registration_details WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_identity_ownership WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM creator_memberships WHERE creator_id=?")
      .run(CREATOR_ID);
    database
      .prepare("DELETE FROM marketplace_creators WHERE id=?")
      .run(CREATOR_ID);
    database.prepare("DELETE FROM sessions WHERE user_id=?").run(USER_ID);
    database
      .prepare("DELETE FROM user_account_profiles WHERE user_id=?")
      .run(USER_ID);
    database.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function countRemainingMockData(database, productId) {
  return {
    users: count(database, "users", "id", USER_ID),
    creators: count(database, "marketplace_creators", "id", CREATOR_ID),
    memberships: count(
      database,
      "creator_memberships",
      "creator_id",
      CREATOR_ID
    ),
    listings: count(database, "creator_listings", "id", productId),
    files: count(
      database,
      "creator_listing_files",
      "listing_id",
      productId
    ),
    declarations: count(
      database,
      "creator_listing_declarations",
      "listing_id",
      productId
    ),
    publicationAudits: count(
      database,
      "creator_publication_audit",
      "listing_id",
      productId
    )
  };
}

function count(database, table, column, value) {
  return Number(
    database
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`)
      .get(value).count
  );
}

function createLocalBucket(root) {
  return {
    async put(key, value) {
      const target = storagePath(root, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const bytes =
        value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(await new Response(value).arrayBuffer());
      fs.writeFileSync(target, bytes);
    },
    read(key) {
      return fs.readFileSync(storagePath(root, key));
    }
  };
}

function storagePath(root, key) {
  const target = path.resolve(root, ...String(key).split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`;
  assert.ok(target.startsWith(prefix), "Storage keys must remain inside the sandbox.");
  return target;
}

function jsonRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${SESSION_TOKEN}; trg_account_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function formRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${SESSION_TOKEN}; trg_account_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN
    },
    body
  });
}

function getRequest(route) {
  return new Request(`https://example.com/api/creator/${route}`, {
    headers: { cookie: `__Host-trg_session=${SESSION_TOKEN}` }
  });
}

function createD1(database) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: database.prepare(sql).all(...values) };
        },
        async run() {
          const result = database.prepare(sql).run(...values);
          return {
            changes: Number(result.changes),
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid || 0)
            }
          };
        }
      };
    },
    async batch(statements) {
      database.exec("BEGIN;");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT;");
        return results;
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    }
  };
}

function load(relativePath) {
  return import(
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task2=${Math.random()}`
  );
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256File(filename) {
  return sha256Bytes(fs.readFileSync(filename));
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
