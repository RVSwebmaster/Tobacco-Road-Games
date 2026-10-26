const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const CREATOR_ID = "creator-mock-review-task4a";
const CREATOR_USER_ID = "user-mock-review-task4a";
const OWNER_ID = "owner-open-workbench";
const PRODUCT_SLUG = "mock-owner-review-task4a";
const CREATOR_SESSION = "mock-task4a-creator-session";
const CREATOR_CSRF = "mock-task4a-creator-csrf";
const NOW_MS = Date.parse("2026-10-18T18:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-18T18:00:00.000Z";
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\nTobacco Road Games disposable Task 4A review file\n%%EOF",
  "utf8"
);

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-owner-review-task4a-")
  );
  const databasePath = path.join(sandboxRoot, "creator-owner-review.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogPath = path.join(ROOT, "data", "products.json");
  const catalogHashBefore = sha256(fs.readFileSync(catalogPath));
  let database;
  let productId = "";
  let fileId = "";
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const creatorOperations = await load(
      "functions/_lib/creator-operations.mjs"
    );
    const creatorFiles = await load("functions/_lib/creator-files.mjs");
    const ownerListingFiles = await load(
      "functions/_lib/owner-listing-files.mjs"
    );

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
      creatorJsonRequest("listings", {
        title: "Mock Owner Review Product Task 4A",
        slug: PRODUCT_SLUG,
        shortDescription: "Disposable Owner review-access fixture.",
        longDescription:
          "This submitted product exists only inside the Task 4A sandbox.",
        priceCents: 900,
        mediaType: "digital",
        format: ["PDF"],
        gameSystem: "System Neutral",
        genre: "test",
        discovery: { language: "English" }
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    productId = (await response.json()).listing.id;

    const form = new FormData();
    form.set("purpose", "product");
    form.set(
      "file",
      new File([PDF_BYTES], "mock-owner-review-task4a.pdf", {
        type: "application/pdf"
      })
    );
    response = await creatorFiles.handleCreatorFileUpload(
      creatorFormRequest(`listings/${productId}/files`, form),
      environment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    fileId = (await response.json()).file.id;

    response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(`listings/${productId}/submit`, {
        rightsConfirmed: true,
        representationConfirmed: true,
        licensesConfirmed: true
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "submitted" });

    const submitted = database
      .prepare("SELECT * FROM creator_listings WHERE id=?")
      .get(productId);
    const storedFile = database
      .prepare("SELECT * FROM creator_listing_files WHERE id=?")
      .get(fileId);
    assert.equal(submitted.creator_id, CREATOR_ID);
    assert.equal(submitted.lifecycle_state, "submitted");
    assert.equal(submitted.publication_state, "not_approved");
    assert.equal(storedFile.creator_id, CREATOR_ID);
    assert.equal(storedFile.listing_id, productId);
    assert.equal(storedFile.validation_state, "uploaded");
    assert.equal(sha256(bucket.read(storedFile.quarantine_key)), sha256(PDF_BYTES));

    const commerceBefore = commerceSnapshot(database);
    assert.deepEqual(commerceBefore, {
      orders: 0,
      orderItems: 0,
      entitlements: 0,
      earningsRows: 0,
      earningsCents: 0
    });
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_memberships WHERE creator_id=? AND user_id<>?"
        )
        .get(CREATOR_ID, CREATOR_USER_ID).count,
      0,
      "The Mock Owner must not impersonate or join the Mock Creator."
    );

    const ownerEnvironment = { ...environment };
    const ownerOptions = {
      database: d1,
      nowMs: NOW_MS
    };

    response = await ownerListingFiles.handleOwnerListingFiles(
      ownerRequest(`/owner/api/listing-files?listingId=${productId}`),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    const inspection = await response.json();
    assert.equal(inspection.listing.id, productId);
    assert.equal(inspection.listing.creator_id, CREATOR_ID);
    assert.equal(inspection.listing.lifecycle_state, "submitted");
    assert.equal(inspection.files.length, 1);
    assert.equal(inspection.files[0].id, fileId);
    assert.equal(inspection.files[0].creator_id, CREATOR_ID);
    assert.equal(inspection.files[0].storageState, "present");
    assert.equal(inspection.files[0].secureDeliveryState, "not_current");
    assert.equal(inspection.files[0].quarantine_key, undefined);

    response = await ownerListingFiles.handleOwnerListingFiles(
      ownerRequest(`/owner/api/listing-files?download=${fileId}`),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(
      response.headers.get("content-disposition"),
      /mock-owner-review-task4a\.pdf/
    );
    const downloadedBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(downloadedBytes), sha256(PDF_BYTES));

    const reviewAudits = database
      .prepare(
        "SELECT actor_type,actor_id,action,context_json FROM creator_publication_audit WHERE listing_id=? AND action IN ('owner_listing_inspected','owner_file_downloaded') ORDER BY id"
      )
      .all(productId);
    assert.deepEqual(
      reviewAudits.map((entry) => entry.action),
      ["owner_listing_inspected", "owner_file_downloaded"]
    );
    for (const audit of reviewAudits) {
      assert.equal(audit.actor_type, "operator");
      assert.equal(audit.actor_id, OWNER_ID);
    }
    assert.equal(JSON.parse(reviewAudits[0].context_json).fileCount, 1);
    assert.equal(JSON.parse(reviewAudits[1].context_json).fileId, fileId);
    assert.equal(
      JSON.parse(reviewAudits[1].context_json).validationState,
      "uploaded"
    );

    assert.deepEqual(commerceSnapshot(database), commerceBefore);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_publication_audit WHERE listing_id=? AND action='published'"
        )
        .get(productId).count,
      0
    );
    assert.equal(sha256(fs.readFileSync(catalogPath)), catalogHashBefore);
    assert.equal(
      JSON.parse(fs.readFileSync(catalogPath, "utf8")).some(
        (product) => product.slug === PRODUCT_SLUG
      ),
      false
    );

    cleanup(database, productId);
    assert.deepEqual(remainingCounts(database, productId), {
      users: 0,
      sessions: 0,
      profiles: 0,
      creators: 0,
      memberships: 0,
      ownerships: 0,
      listings: 0,
      files: 0,
      declarations: 0,
      publicationAudits: 0,
      agreements: 0,
      registrationDetails: 0,
      payoutProfiles: 0
    });
    assert.deepEqual(commerceSnapshot(database), commerceBefore);

    fs.rmSync(storageRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(storageRoot), false);
    assert.equal(sha256(fs.readFileSync(catalogPath)), catalogHashBefore);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator Owner review-access sandbox test passed.");
    console.log(`Creator ID: ${CREATOR_ID}`);
    console.log(`Mock Owner: ${OWNER_ID}`);
    console.log(`Product ID: ${productId}`);
    console.log(`File ID: ${fileId}`);
    console.log(`Original PDF SHA-256: ${sha256(PDF_BYTES)}`);
    console.log(`Downloaded PDF SHA-256: ${sha256(downloadedBytes)}`);
    console.log("Owner listing inspection: allowed (200)");
    console.log("Owner private PDF download: allowed (200)");
    console.log("Creator impersonation: not used");
    console.log("Commerce and entitlement rows created: 0");
    console.log("Owner review audit events: 2");
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
    .run(CREATOR_USER_ID, "mock-task4a@example.invalid", NOW, NOW);
  database
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      "session-mock-review-task4a",
      CREATOR_USER_ID,
      await accountAuth.hashToken(CREATOR_SESSION),
      await accountAuth.hashToken(CREATOR_CSRF),
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
      "mock-creator-review-task4a",
      "Mock Creator Review Task 4A",
      "Disposable Owner review-access fixture.",
      "This Creator exists only in the Task 4A temporary database.",
      NOW,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)"
    )
    .run(CREATOR_USER_ID, CREATOR_ID, NOW);
  database
    .prepare(
      `INSERT INTO creator_identity_ownership(
         creator_id,owner_user_id,identity_type,account_status,billing_status,
         entitlement_source,created_at,updated_at
       ) VALUES(?,?,'primary','active','not_required','primary_free',?,?)`
    )
    .run(CREATOR_ID, CREATOR_USER_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO user_account_profiles(
         user_id,legal_name,payment_method_status,payment_method_status_updated_at,
         created_at,updated_at
       ) VALUES(?,?,'ready',?,?,?)`
    )
    .run(CREATOR_USER_ID, "Mock Creator Task 4A", NOW, NOW, NOW);
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
      "Mock Creator Task 4A",
      "",
      "individual",
      "US",
      "NC",
      "4 Disposable Test Road",
      "Durham",
      "27701",
      "mock-task4a@example.invalid",
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      `INSERT INTO creator_agreement_acceptances(
         creator_id,accepted_by_user_id,agreement_id,agreement_version,
         accepted_at,source_context
       ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task4a_sandbox')`
    )
    .run(CREATOR_ID, CREATOR_USER_ID, NOW);
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

function creatorJsonRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${CREATOR_SESSION}; trg_account_csrf=${CREATOR_CSRF}`,
      "x-csrf-token": CREATOR_CSRF,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function creatorFormRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${CREATOR_SESSION}; trg_account_csrf=${CREATOR_CSRF}`,
      "x-csrf-token": CREATOR_CSRF
    },
    body
  });
}

function ownerRequest(route) {
  return new Request(`https://example.com${route}`);
}

function commerceSnapshot(database) {
  const earnings = database
    .prepare("SELECT COALESCE(SUM(amount_cents),0) cents FROM creator_earnings_ledger")
    .get();
  return {
    orders: countAll(database, "orders"),
    orderItems: countAll(database, "order_items"),
    entitlements: countAll(database, "download_entitlements"),
    earningsRows: countAll(database, "creator_earnings_ledger"),
    earningsCents: Number(earnings.cents)
  };
}

function cleanup(database, productId) {
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
      .prepare("DELETE FROM creator_account_audits WHERE creator_id=?")
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
    database
      .prepare("DELETE FROM sessions WHERE user_id=?")
      .run(CREATOR_USER_ID);
    database
      .prepare("DELETE FROM user_account_profiles WHERE user_id=?")
      .run(CREATOR_USER_ID);
    database.prepare("DELETE FROM users WHERE id=?").run(CREATOR_USER_ID);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function remainingCounts(database, productId) {
  return {
    users: count(database, "users", "id", CREATOR_USER_ID),
    sessions: count(database, "sessions", "user_id", CREATOR_USER_ID),
    profiles: count(
      database,
      "user_account_profiles",
      "user_id",
      CREATOR_USER_ID
    ),
    creators: count(database, "marketplace_creators", "id", CREATOR_ID),
    memberships: count(
      database,
      "creator_memberships",
      "creator_id",
      CREATOR_ID
    ),
    ownerships: count(
      database,
      "creator_identity_ownership",
      "creator_id",
      CREATOR_ID
    ),
    listings: count(database, "creator_listings", "id", productId),
    files: count(database, "creator_listing_files", "listing_id", productId),
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
    ),
    agreements: count(
      database,
      "creator_agreement_acceptances",
      "creator_id",
      CREATOR_ID
    ),
    registrationDetails: count(
      database,
      "creator_registration_details",
      "creator_id",
      CREATOR_ID
    ),
    payoutProfiles: count(
      database,
      "creator_payout_profiles",
      "creator_id",
      CREATOR_ID
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

function countAll(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
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
    async head(key) {
      const target = storagePath(root, key);
      if (!fs.existsSync(target)) return null;
      return { size: fs.statSync(target).size, uploaded: new Date(NOW) };
    },
    async get(key) {
      const target = storagePath(root, key);
      if (!fs.existsSync(target)) return null;
      const bytes = fs.readFileSync(target);
      return { body: bytes, size: bytes.byteLength };
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
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task4a=${Math.random()}`
  );
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
