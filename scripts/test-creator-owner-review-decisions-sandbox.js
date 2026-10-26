const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const { createOwnerWorkbenchFixture } = require("./test-support/owner-workbench-fixture.js");
const CREATOR_ID = "creator-mock-review-task4b";
const CREATOR_USER_ID = "user-mock-review-task4b";
const CREATOR_EMAIL = "mock-task4b@example.invalid";
const CREATOR_SESSION = "mock-task4b-creator-session";
const CREATOR_CSRF = "mock-task4b-creator-csrf";
const OWNER_ID = "owner-open-workbench";
const NOW_MS = Date.parse("2026-10-18T19:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-18T19:00:00.000Z";
const PRODUCTS = Object.freeze({
  approval: {
    slug: "mock-owner-approval-task4b",
    title: "Mock Owner Approval Product Task 4B",
    filename: "mock-owner-approval-task4b.pdf",
    bytes: Buffer.from(
      "%PDF-1.7\nTobacco Road Games disposable Task 4B approval file\n%%EOF",
      "utf8"
    )
  },
  rejection: {
    slug: "mock-owner-rejection-task4b",
    title: "Mock Owner Rejection Product Task 4B",
    filename: "mock-owner-rejection-task4b.pdf",
    bytes: Buffer.from(
      "%PDF-1.7\nTobacco Road Games disposable Task 4B rejection file\n%%EOF",
      "utf8"
    )
  }
});

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-owner-review-task4b-")
  );
  const databasePath = path.join(sandboxRoot, "creator-owner-review.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogPath = path.join(ROOT, "data", "products.json");
  const catalogHashBefore = sha256(fs.readFileSync(catalogPath));
  let database;
  let explicitCleanupComplete = false;
  const ids = { approval: "", rejection: "" };

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const creatorOperations = await load(
      "functions/_lib/creator-operations.mjs"
    );
    const creatorFiles = await load("functions/_lib/creator-files.mjs");
    const creatorReview = await load("functions/_lib/creator-review.mjs");

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(database);
    await createEligibleMockCreator(database, accountAuth);

    const d1 = createD1(database);
    const bucket = createLocalBucket(storageRoot);
    const creatorEnvironment = { TRG_ORDERS: d1, TRG_PRODUCTS: bucket };

    for (const [decision, product] of Object.entries(PRODUCTS)) {
      ids[decision] = await submitProduct({
        creatorFiles,
        creatorOperations,
        environment: creatorEnvironment,
        product,
        d1,
        bucket
      });
    }

    const publicCatalogBefore = readJson(catalogPath);
    for (const product of Object.values(PRODUCTS)) {
      assert.equal(
        publicCatalogBefore.some((entry) => entry.slug === product.slug),
        false
      );
    }
    const commerceBefore = commerceSnapshot(database);
    assert.deepEqual(commerceBefore, {
      orders: 0,
      orderItems: 0,
      entitlements: 0,
      earningsRows: 0,
      earningsCents: 0
    });

    const ownerFixture = createOwnerWorkbenchFixture({ ownerId: OWNER_ID });
    const ownerEnvironment = {
      ...creatorEnvironment,
      ...ownerFixture.environment
    };
    const ownerOptions = {
      database: d1,
      nowMs: NOW_MS,
      ...ownerFixture.options
    };

    let response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.readRequest("/owner/api/creator-reviews"),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    const reviewQueue = await response.json();
    for (const productId of Object.values(ids)) {
      const listing = reviewQueue.listings.find((entry) => entry.id === productId);
      assert.ok(listing, `Owner review queue must include ${productId}.`);
      assert.equal(listing.lifecycle_state, "submitted");
      assert.equal(listing.publication_state, "not_approved");
      assert.equal(
        reviewQueue.files.some((file) => file.listing_id === productId),
        true
      );
    }

    const auditCountBeforeDecision = decisionAuditCount(database);

    response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.jsonRequest("/owner/api/creator-reviews", {
        listingId: ids.approval,
        action: "publish",
        note: "Invalid"
      }),
      ownerEnvironment,
      ownerOptions
    );
    const invalidActionStatus = response.status;
    assert.equal(invalidActionStatus, 400);
    assert.equal(listingState(database, ids.approval).lifecycle_state, "submitted");
    assert.equal(decisionAuditCount(database), auditCountBeforeDecision);

    const approvalNote = "Approved after Owner review.";
    response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.jsonRequest("/owner/api/creator-reviews", {
        listingId: ids.approval,
        action: "approve",
        note: approvalNote
      }),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "active",
      reviewedBy: OWNER_ID
    });

    const rejectionNote =
      "Rejected: submitted PDF does not match the listing representation.";
    response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.jsonRequest("/owner/api/creator-reviews", {
        listingId: ids.rejection,
        action: "reject",
        note: rejectionNote
      }),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "rejected",
      reviewedBy: OWNER_ID
    });

    const approved = listingState(database, ids.approval);
    assert.equal(approved.lifecycle_state, "active");
    assert.equal(approved.publication_state, "approved");
    assert.equal(approved.review_note, approvalNote);
    assert.equal(approved.reviewed_at, NOW);
    assert.equal(approved.public_product_slug, null);
    assert.equal(approved.published_at, null);

    const rejected = listingState(database, ids.rejection);
    assert.equal(rejected.lifecycle_state, "rejected");
    assert.equal(rejected.publication_state, "not_approved");
    assert.equal(rejected.review_note, rejectionNote);
    assert.equal(rejected.reviewed_at, NOW);
    assert.equal(rejected.public_product_slug, null);
    assert.equal(rejected.published_at, null);

    response = await creatorOperations.handleCreatorRequest(
      creatorGetRequest("listings"),
      creatorEnvironment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    const creatorView = await response.json();
    const creatorApproved = creatorView.listings.find(
      (entry) => entry.id === ids.approval
    );
    const creatorRejected = creatorView.listings.find(
      (entry) => entry.id === ids.rejection
    );
    assert.deepEqual(
      {
        lifecycleState: creatorApproved.lifecycleState,
        publicationState: creatorApproved.publicationState,
        reviewNote: creatorApproved.reviewNote,
        reviewedAt: creatorApproved.reviewedAt
      },
      {
        lifecycleState: "active",
        publicationState: "approved",
        reviewNote: approvalNote,
        reviewedAt: NOW
      }
    );
    assert.deepEqual(
      {
        lifecycleState: creatorRejected.lifecycleState,
        publicationState: creatorRejected.publicationState,
        reviewNote: creatorRejected.reviewNote,
        reviewedAt: creatorRejected.reviewedAt
      },
      {
        lifecycleState: "rejected",
        publicationState: "not_approved",
        reviewNote: rejectionNote,
        reviewedAt: NOW
      }
    );

    verifyDecisionAudits(database, ids, approvalNote, rejectionNote);

    const stateBeforeRepeatedAttempts = Object.fromEntries(
      Object.entries(ids).map(([key, id]) => [key, listingState(database, id)])
    );
    const auditCountBeforeRepeatedAttempts = decisionAuditCount(database);
    const repeatedStatuses = [];
    for (const attempt of [
      [ids.approval, "approve", "Repeated approval"],
      [ids.approval, "reject", "Invalid reversal"],
      [ids.rejection, "reject", "Repeated rejection"]
    ]) {
      response = await creatorReview.handleCreatorReviewRequest(
        ownerFixture.jsonRequest("/owner/api/creator-reviews", {
          listingId: attempt[0],
          action: attempt[1],
          note: attempt[2]
        }),
        ownerEnvironment,
        ownerOptions
      );
      repeatedStatuses.push(response.status);
      assert.equal(response.status, 404);
    }
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(ids).map(([key, id]) => [key, listingState(database, id)])
      ),
      stateBeforeRepeatedAttempts
    );
    assert.equal(decisionAuditCount(database), auditCountBeforeRepeatedAttempts);

    assert.deepEqual(commerceSnapshot(database), commerceBefore);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) count FROM creator_publication_audit WHERE listing_id IN (?,?) AND action='published'"
        )
        .get(ids.approval, ids.rejection).count,
      0
    );
    assert.equal(sha256(fs.readFileSync(catalogPath)), catalogHashBefore);

    cleanup(database, ids);
    assert.deepEqual(remainingCounts(database, ids), {
      users: 0,
      sessions: 0,
      profiles: 0,
      creators: 0,
      memberships: 0,
      ownerships: 0,
      listings: 0,
      files: 0,
      declarations: 0,
      reviewAudits: 0,
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

    console.log("Creator Owner approval/rejection sandbox test passed.");
    console.log(`Creator ID: ${CREATOR_ID}`);
    console.log(`Mock Owner: ${OWNER_ID}`);
    console.log(`Approved Product ID: ${ids.approval}`);
    console.log("Approval result: active / approved (not auto-published)");
    console.log(`Rejected Product ID: ${ids.rejection}`);
    console.log("Rejection result: rejected / not_approved");
    console.log(`Rejection reason: ${rejectionNote}`);
    console.log("Creator decision visibility: confirmed through Creator listings (200)");
    console.log(`Invalid Owner action: rejected (${invalidActionStatus})`);
    console.log(`Repeated/reversal decisions: rejected (${repeatedStatuses.join(", ")})`);
    console.log("Owner decision audit events: 2 review + 2 publication");
    console.log("Commerce and entitlement rows created: 0");
    console.log("Disposable records remaining: 0");
    console.log("Sandbox storage removed: true");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

async function submitProduct({
  creatorFiles,
  creatorOperations,
  environment,
  product,
  d1,
  bucket
}) {
  let response = await creatorOperations.handleCreatorRequest(
    creatorJsonRequest("listings", {
      title: product.title,
      slug: product.slug,
      shortDescription: "Disposable Owner decision fixture.",
      longDescription:
        "This submitted product exists only inside the Task 4B sandbox.",
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
  const productId = (await response.json()).listing.id;

  const form = new FormData();
  form.set("purpose", "product");
  form.set(
    "file",
    new File([product.bytes], product.filename, { type: "application/pdf" })
  );
  response = await creatorFiles.handleCreatorFileUpload(
    creatorFormRequest(`listings/${productId}/files`, form),
    environment,
    productId,
    { database: d1, nowMs: NOW_MS }
  );
  assert.equal(response.status, 201);
  const fileId = (await response.json()).file.id;

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

  const listing = listingState(d1.raw, productId);
  const file = d1.raw
    .prepare("SELECT * FROM creator_listing_files WHERE id=?")
    .get(fileId);
  assert.equal(listing.creator_id, CREATOR_ID);
  assert.equal(listing.lifecycle_state, "submitted");
  assert.equal(listing.publication_state, "not_approved");
  assert.equal(file.creator_id, CREATOR_ID);
  assert.equal(file.listing_id, productId);
  assert.equal(sha256(bucket.read(file.quarantine_key)), sha256(product.bytes));
  return productId;
}

function verifyDecisionAudits(
  database,
  ids,
  approvalNote,
  rejectionNote
) {
  const reviewAudits = database
    .prepare(
      "SELECT listing_id,creator_id,action,note,created_at FROM creator_review_audit WHERE listing_id IN (?,?) ORDER BY action"
    )
    .all(ids.approval, ids.rejection);
  assert.equal(reviewAudits.length, 2);
  assert.deepEqual(reviewAudits.map((audit) => ({ ...audit })), [
    {
      listing_id: ids.approval,
      creator_id: CREATOR_ID,
      action: "approve",
      note: approvalNote,
      created_at: NOW
    },
    {
      listing_id: ids.rejection,
      creator_id: CREATOR_ID,
      action: "reject",
      note: rejectionNote,
      created_at: NOW
    }
  ]);

  const publicationAudits = database
    .prepare(
      "SELECT listing_id,creator_id,actor_type,actor_id,action,context_json,created_at FROM creator_publication_audit WHERE listing_id IN (?,?) AND action IN ('approve','reject') ORDER BY action"
    )
    .all(ids.approval, ids.rejection);
  assert.equal(publicationAudits.length, 2);
  for (const audit of publicationAudits) {
    assert.equal(audit.creator_id, CREATOR_ID);
    assert.equal(audit.actor_type, "operator");
    assert.equal(audit.actor_id, OWNER_ID);
    assert.equal(audit.created_at, NOW);
  }
  assert.equal(publicationAudits[0].listing_id, ids.approval);
  assert.equal(publicationAudits[0].action, "approve");
  assert.equal(JSON.parse(publicationAudits[0].context_json).note, approvalNote);
  assert.equal(publicationAudits[1].listing_id, ids.rejection);
  assert.equal(publicationAudits[1].action, "reject");
  assert.equal(JSON.parse(publicationAudits[1].context_json).note, rejectionNote);
}

async function createEligibleMockCreator(database, accountAuth) {
  database
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)"
    )
    .run(CREATOR_USER_ID, CREATOR_EMAIL, NOW, NOW);
  database
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)"
    )
    .run(
      "session-mock-review-task4b",
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
      "mock-creator-review-task4b",
      "Mock Creator Review Task 4B",
      "Disposable Owner decision fixture.",
      "This Creator exists only in the Task 4B temporary database.",
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
    .run(CREATOR_USER_ID, "Mock Creator Task 4B", NOW, NOW, NOW);
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
      "Mock Creator Task 4B",
      "",
      "individual",
      "US",
      "NC",
      "4B Disposable Test Road",
      "Durham",
      "27701",
      CREATOR_EMAIL,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      `INSERT INTO creator_agreement_acceptances(
         creator_id,accepted_by_user_id,agreement_id,agreement_version,
         accepted_at,source_context
       ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task4b_sandbox')`
    )
    .run(CREATOR_ID, CREATOR_USER_ID, NOW);
  database
    .prepare(
      `INSERT INTO creator_payout_profiles(
         creator_id,provider,onboarding_status,payouts_enabled,
         verification_status,status_updated_at
       ) VALUES(?,'manual','complete',1,'verified',?)`
    )
    .run(CREATOR_ID, NOW);
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

function creatorJsonRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: creatorHeaders(true),
    body: JSON.stringify(body)
  });
}

function creatorFormRequest(route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: creatorHeaders(false),
    body
  });
}

function creatorGetRequest(route) {
  return new Request(`https://example.com/api/creator/${route}`, {
    headers: { cookie: `__Host-trg_session=${CREATOR_SESSION}` }
  });
}

function creatorHeaders(json) {
  return {
    origin: "https://example.com",
    cookie: `__Host-trg_session=${CREATOR_SESSION}; trg_account_csrf=${CREATOR_CSRF}`,
    "x-csrf-token": CREATOR_CSRF,
    ...(json ? { "content-type": "application/json" } : {})
  };
}

function unauthorizedCreatorDecisionRequest(listingId) {
  return new Request("https://example.com/owner/api/creator-reviews", {
    method: "POST",
    headers: creatorHeaders(true),
    body: JSON.stringify({
      listingId,
      action: "approve",
      note: "A Creator must never authorize this."
    })
  });
}

function listingState(database, listingId) {
  return database
    .prepare(
      "SELECT id,creator_id,lifecycle_state,publication_state,review_note,reviewed_at,public_product_slug,published_at FROM creator_listings WHERE id=?"
    )
    .get(listingId);
}

function decisionAuditCount(database) {
  return Number(
    database
      .prepare(
        "SELECT COUNT(*) count FROM creator_review_audit WHERE listing_id IN (SELECT id FROM creator_listings WHERE creator_id=?)"
      )
      .get(CREATOR_ID).count
  );
}

function commerceSnapshot(database) {
  const earnings = database
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) cents FROM creator_earnings_ledger"
    )
    .get();
  return {
    orders: countAll(database, "orders"),
    orderItems: countAll(database, "order_items"),
    entitlements: countAll(database, "download_entitlements"),
    earningsRows: countAll(database, "creator_earnings_ledger"),
    earningsCents: Number(earnings.cents)
  };
}

function cleanup(database, ids) {
  database.exec("BEGIN;");
  try {
    for (const productId of Object.values(ids)) {
      database
        .prepare("DELETE FROM creator_review_audit WHERE listing_id=?")
        .run(productId);
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
    }
    for (const table of [
      "creator_account_notices",
      "creator_account_audits",
      "creator_account_audit_states",
      "creator_agreement_acceptances",
      "creator_payout_profiles",
      "creator_registration_details",
      "creator_identity_ownership",
      "creator_memberships"
    ]) {
      database.prepare(`DELETE FROM ${table} WHERE creator_id=?`).run(CREATOR_ID);
    }
    database
      .prepare("DELETE FROM marketplace_creators WHERE id=?")
      .run(CREATOR_ID);
    database.prepare("DELETE FROM sessions WHERE user_id=?").run(CREATOR_USER_ID);
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

function remainingCounts(database, ids) {
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
    listings: countEither(
      database,
      "creator_listings",
      "id",
      ids.approval,
      ids.rejection
    ),
    files: countEither(
      database,
      "creator_listing_files",
      "listing_id",
      ids.approval,
      ids.rejection
    ),
    declarations: countEither(
      database,
      "creator_listing_declarations",
      "listing_id",
      ids.approval,
      ids.rejection
    ),
    reviewAudits: countEither(
      database,
      "creator_review_audit",
      "listing_id",
      ids.approval,
      ids.rejection
    ),
    publicationAudits: countEither(
      database,
      "creator_publication_audit",
      "listing_id",
      ids.approval,
      ids.rejection
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

function countEither(database, table, column, first, second) {
  return Number(
    database
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column} IN (?,?)`)
      .get(first, second).count
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
    raw: database,
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
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task4b=${Math.random()}`
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
