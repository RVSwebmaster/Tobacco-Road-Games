const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-10-18T17:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-18T17:00:00.000Z";
const PRODUCT_SLUG = "mock-ownership-task3";
const USERS = Object.freeze({
  a: {
    id: "user-mock-ownership-task3-a",
    email: "mock-task3-a@example.invalid",
    token: "mock-task3-a-session",
    csrf: "mock-task3-a-csrf"
  },
  b: {
    id: "user-mock-ownership-task3-b",
    email: "mock-task3-b@example.invalid",
    token: "mock-task3-b-session",
    csrf: "mock-task3-b-csrf"
  }
});
const ORIGINAL_PDF = Buffer.from(
  "%PDF-1.7\nCreator A immutable Task 3 product\n%%EOF",
  "utf8"
);
const REPLACEMENT_PDF = Buffer.from(
  "%PDF-1.7\nCreator B unauthorized replacement\n%%EOF",
  "utf8"
);

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-ownership-task3-")
  );
  const databasePath = path.join(sandboxRoot, "creator-ownership.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogPath = path.join(ROOT, "data", "products.json");
  const catalogHashBefore = sha256(fs.readFileSync(catalogPath));
  let database;
  let creatorAId = "";
  let creatorBId = "";
  let productId = "";
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const accountProfile = await load("functions/_lib/account-profile.mjs");
    const creatorRegistration = await load(
      "functions/_lib/creator-registration.mjs"
    );
    const creatorOperations = await load(
      "functions/_lib/creator-operations.mjs"
    );
    const creatorFiles = await load("functions/_lib/creator-files.mjs");

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(database);
    const d1 = createD1(database);

    await createUserAndSession(database, accountAuth, USERS.a);
    await createUserAndSession(database, accountAuth, USERS.b);

    const creatorA = await creatorRegistration.registerPrimaryCreator(d1, {
      userId: USERS.a.id,
      email: USERS.a.email,
      body: registrationBody("a"),
      nowMs: NOW_MS
    });
    const creatorB = await creatorRegistration.registerPrimaryCreator(d1, {
      userId: USERS.b.id,
      email: USERS.b.email,
      body: registrationBody("b"),
      nowMs: NOW_MS
    });
    creatorAId = creatorA.creatorId;
    creatorBId = creatorB.creatorId;
    assert.notEqual(creatorAId, creatorBId);

    await makeCreatorEligible(
      database,
      d1,
      accountProfile,
      USERS.a,
      creatorAId,
      "a"
    );
    await makeCreatorEligible(
      database,
      d1,
      accountProfile,
      USERS.b,
      creatorBId,
      "b"
    );

    const bucket = createLocalBucket(storageRoot);
    const environment = { TRG_ORDERS: d1, TRG_PRODUCTS: bucket };

    let response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(USERS.a, "listings", {
        title: "Creator A Ownership Draft",
        slug: PRODUCT_SLUG,
        shortDescription: "Original metadata owned by Creator A.",
        longDescription: "Disposable ownership-enforcement test listing.",
        priceCents: 900,
        mediaType: "digital",
        format: ["PDF"],
        gameSystem: "System Neutral",
        genre: "test"
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    productId = (await response.json()).listing.id;

    const upload = fileForm(ORIGINAL_PDF, "creator-a-product.pdf");
    response = await creatorFiles.handleCreatorFileUpload(
      creatorFormRequest(
        USERS.a,
        `listings/${productId}/files`,
        upload
      ),
      environment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    const originalFileId = (await response.json()).file.id;
    const fileRecord = database
      .prepare("SELECT * FROM creator_listing_files WHERE id=?")
      .get(originalFileId);
    assert.equal(fileRecord.creator_id, creatorAId);
    assert.equal(fileRecord.listing_id, productId);
    const originalStoredHash = sha256(bucket.read(fileRecord.quarantine_key));
    assert.equal(originalStoredHash, sha256(ORIGINAL_PDF));

    response = await creatorOperations.handleCreatorRequest(
      creatorGetRequest(USERS.a, "listings"),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const creatorAListings = await response.json();
    assert.equal(creatorAListings.creator.id, creatorAId);
    assert.equal(
      creatorAListings.listings.find((item) => item.id === productId)?.title,
      "Creator A Ownership Draft"
    );

    response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(USERS.a, `listings/${productId}`, {
        title: "Creator A Revised Metadata",
        shortDescription: "Creator A may revise listing metadata."
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const afterAuthorizedEdit = database
      .prepare("SELECT * FROM creator_listings WHERE id=?")
      .get(productId);
    assert.equal(afterAuthorizedEdit.creator_id, creatorAId);
    assert.equal(afterAuthorizedEdit.title, "Creator A Revised Metadata");
    assert.equal(
      afterAuthorizedEdit.short_description,
      "Creator A may revise listing metadata."
    );
    assert.equal(
      sha256(bucket.read(fileRecord.quarantine_key)),
      originalStoredHash,
      "Editing listing metadata must not change the stored PDF."
    );

    response = await creatorOperations.handleCreatorRequest(
      creatorGetRequest(USERS.b, "listings"),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const creatorBListings = await response.json();
    assert.equal(creatorBListings.creator.id, creatorBId);
    assert.equal(
      creatorBListings.listings.some((item) => item.id === productId),
      false
    );

    response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(USERS.b, `listings/${productId}`, {
        title: "Unauthorized Creator B Edit",
        shortDescription: "This must never be stored."
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    const rejectedEditStatus = response.status;
    assert.equal(rejectedEditStatus, 404);

    response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(USERS.b, `listings/${productId}/submit`, {
        rightsConfirmed: true,
        representationConfirmed: true,
        licensesConfirmed: true
      }),
      environment,
      { database: d1, nowMs: NOW_MS }
    );
    const rejectedSubmitStatus = response.status;
    assert.equal(rejectedSubmitStatus, 404);

    const writesBeforeReplacementAttempt = bucket.writeCount();
    response = await creatorFiles.handleCreatorFileUpload(
      creatorFormRequest(
        USERS.b,
        `listings/${productId}/files`,
        fileForm(REPLACEMENT_PDF, "creator-b-replacement.pdf")
      ),
      environment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    const rejectedReplacementStatus = response.status;
    assert.equal(rejectedReplacementStatus, 403);
    assert.equal(bucket.writeCount(), writesBeforeReplacementAttempt);

    const afterUnauthorizedAttempts = database
      .prepare("SELECT * FROM creator_listings WHERE id=?")
      .get(productId);
    assert.equal(afterUnauthorizedAttempts.creator_id, creatorAId);
    assert.equal(afterUnauthorizedAttempts.title, "Creator A Revised Metadata");
    assert.equal(afterUnauthorizedAttempts.lifecycle_state, "draft");
    assert.equal(afterUnauthorizedAttempts.publication_state, "not_approved");
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_listing_files WHERE listing_id=?"
        )
        .get(productId).count,
      1
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_listing_files WHERE listing_id=? AND creator_id=?"
        )
        .get(productId, creatorBId).count,
      0
    );
    assert.equal(sha256(bucket.read(fileRecord.quarantine_key)), originalStoredHash);
    assert.equal(sha256(bucket.read(fileRecord.quarantine_key)), sha256(ORIGINAL_PDF));
    assert.equal(sha256(fs.readFileSync(catalogPath)), catalogHashBefore);
    assert.equal(
      readJson(catalogPath).some((product) => product.slug === PRODUCT_SLUG),
      false
    );

    cleanup(database, {
      creatorAId,
      creatorBId,
      productId,
      userAId: USERS.a.id,
      userBId: USERS.b.id
    });
    assert.deepEqual(
      remainingCounts(database, {
        creatorAId,
        creatorBId,
        productId,
        userAId: USERS.a.id,
        userBId: USERS.b.id
      }),
      {
        users: 0,
        creators: 0,
        memberships: 0,
        ownerships: 0,
        listings: 0,
        files: 0,
        publicationAudits: 0,
        agreements: 0,
        registrationDetails: 0,
        payoutProfiles: 0
      }
    );

    fs.rmSync(storageRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(storageRoot), false);
    assert.equal(sha256(fs.readFileSync(catalogPath)), catalogHashBefore);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator ownership enforcement sandbox test passed.");
    console.log(`Creator A ID: ${creatorAId}`);
    console.log(`Creator B ID: ${creatorBId}`);
    console.log(`Product ID: ${productId}`);
    console.log("Creator A retrieve: allowed (200)");
    console.log("Creator A metadata edit: allowed (200)");
    console.log(`Creator B metadata edit: rejected (${rejectedEditStatus})`);
    console.log(`Creator B submit: rejected (${rejectedSubmitStatus})`);
    console.log(
      `Creator B PDF replacement: rejected (${rejectedReplacementStatus})`
    );
    console.log(`PDF SHA-256 unchanged: ${originalStoredHash}`);
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

function applyMigrations(database) {
  for (const migration of fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(
      fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8")
    );
  }
}

async function createUserAndSession(database, accountAuth, user) {
  database
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)"
    )
    .run(user.id, user.email, NOW, NOW);
  database
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      `${user.id}-session`,
      user.id,
      await accountAuth.hashToken(user.token),
      await accountAuth.hashToken(user.csrf),
      NOW,
      EXPIRES_AT,
      NOW
    );
}

async function makeCreatorEligible(
  database,
  d1,
  accountProfile,
  user,
  creatorId,
  suffix
) {
  await accountProfile.recordPaymentMethodReadiness(d1, {
    userId: user.id,
    stripeCustomerReference: `cus_mock_task3_${suffix}`,
    paymentMethodReference: `pm_mock_task3_${suffix}`,
    status: "ready",
    nowMs: NOW_MS
  });
  database
    .prepare(
      "UPDATE creator_payout_profiles SET onboarding_status='complete',verification_status='verified',payouts_enabled=1,status_updated_at=? WHERE creator_id=?"
    )
    .run(NOW, creatorId);
}

function registrationBody(suffix) {
  const upper = suffix.toUpperCase();
  return {
    creatorName: `Mock Creator ${upper} Task 3`,
    slug: `mock-creator-${suffix}-task3`,
    shortBio: `Disposable ownership test Creator ${upper}.`,
    legalName: `Mock Creator ${upper}`,
    businessName: "",
    businessType: "individual",
    country: "US",
    stateRegion: "NC",
    addressLine1: `${suffix === "a" ? 1 : 2} Disposable Test Road`,
    city: "Durham",
    postalCode: "27701",
    contactEmail: USERS[suffix].email,
    acceptAgreement: true,
    confirmRights: true
  };
}

function creatorJsonRequest(user, route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: requestHeaders(user, true),
    body: JSON.stringify(body)
  });
}

function creatorFormRequest(user, route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: requestHeaders(user, false),
    body
  });
}

function creatorGetRequest(user, route) {
  return new Request(`https://example.com/api/creator/${route}`, {
    headers: {
      cookie: `__Host-trg_session=${user.token}`
    }
  });
}

function requestHeaders(user, json) {
  return {
    origin: "https://example.com",
    cookie: `__Host-trg_session=${user.token}; trg_account_csrf=${user.csrf}`,
    "x-csrf-token": user.csrf,
    ...(json ? { "content-type": "application/json" } : {})
  };
}

function fileForm(bytes, filename) {
  const form = new FormData();
  form.set("purpose", "product");
  form.set(
    "file",
    new File([bytes], filename, { type: "application/pdf" })
  );
  return form;
}

function createLocalBucket(root) {
  let writes = 0;
  return {
    async put(key, value) {
      const target = storagePath(root, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const bytes =
        value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(await new Response(value).arrayBuffer());
      fs.writeFileSync(target, bytes);
      writes += 1;
    },
    read(key) {
      return fs.readFileSync(storagePath(root, key));
    },
    writeCount() {
      return writes;
    }
  };
}

function storagePath(root, key) {
  const target = path.resolve(root, ...String(key).split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`;
  assert.ok(target.startsWith(prefix), "Storage keys must remain inside the sandbox.");
  return target;
}

function cleanup(database, ids) {
  const creators = [ids.creatorAId, ids.creatorBId];
  const users = [ids.userAId, ids.userBId];
  database.exec("BEGIN;");
  try {
    database
      .prepare("DELETE FROM creator_listing_declarations WHERE listing_id=?")
      .run(ids.productId);
    database
      .prepare("DELETE FROM creator_publication_audit WHERE listing_id=?")
      .run(ids.productId);
    database
      .prepare("DELETE FROM creator_listing_files WHERE listing_id=?")
      .run(ids.productId);
    database
      .prepare("DELETE FROM creator_listings WHERE id=?")
      .run(ids.productId);
    for (const creatorId of creators) {
      database
        .prepare("DELETE FROM creator_account_notices WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_account_audits WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_account_audit_states WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_agreement_acceptances WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_payout_profiles WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_registration_details WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_identity_ownership WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM creator_memberships WHERE creator_id=?")
        .run(creatorId);
      database
        .prepare("DELETE FROM marketplace_creators WHERE id=?")
        .run(creatorId);
    }
    for (const userId of users) {
      database.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      database
        .prepare("DELETE FROM user_account_profiles WHERE user_id=?")
        .run(userId);
      database.prepare("DELETE FROM users WHERE id=?").run(userId);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function remainingCounts(database, ids) {
  return {
    users: countEither(database, "users", "id", ids.userAId, ids.userBId),
    creators: countEither(
      database,
      "marketplace_creators",
      "id",
      ids.creatorAId,
      ids.creatorBId
    ),
    memberships: countEither(
      database,
      "creator_memberships",
      "creator_id",
      ids.creatorAId,
      ids.creatorBId
    ),
    ownerships: countEither(
      database,
      "creator_identity_ownership",
      "creator_id",
      ids.creatorAId,
      ids.creatorBId
    ),
    listings: count(database, "creator_listings", "id", ids.productId),
    files: count(
      database,
      "creator_listing_files",
      "listing_id",
      ids.productId
    ),
    publicationAudits: count(
      database,
      "creator_publication_audit",
      "listing_id",
      ids.productId
    ),
    agreements: countEither(
      database,
      "creator_agreement_acceptances",
      "creator_id",
      ids.creatorAId,
      ids.creatorBId
    ),
    registrationDetails: countEither(
      database,
      "creator_registration_details",
      "creator_id",
      ids.creatorAId,
      ids.creatorBId
    ),
    payoutProfiles: countEither(
      database,
      "creator_payout_profiles",
      "creator_id",
      ids.creatorAId,
      ids.creatorBId
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

function countEither(database, table, column, first, second) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) count FROM ${table} WHERE ${column} IN (?,?)`
      )
      .get(first, second).count
  );
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
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task3=${Math.random()}`
  );
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
