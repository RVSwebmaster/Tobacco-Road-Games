const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const CREATOR_ID = "creator-mock-publication-task5";
const CREATOR_USER_ID = "user-mock-publication-task5";
const CREATOR_EMAIL = "mock-task5@example.invalid";
const CREATOR_SESSION = "mock-task5-creator-session";
const CREATOR_CSRF = "mock-task5-creator-csrf";
const OWNER_ID = "owner-publication-task5@example.invalid";
const OWNER_SESSION_SECRET = "mock-task5-owner-session-secret-32-bytes";
const OWNER_CSRF_SECRET = "mock-task5-owner-csrf-secret-32-bytes";
const PRODUCT_SLUG = "mock-creator-publication-task5";
const PRODUCT_TITLE = "Mock Creator Publication Product Task 5";
const SHORT_DESCRIPTION = "A disposable Creator publication fixture.";
const LONG_DESCRIPTION =
  "This product exists only in the isolated Task 5 publication sandbox.";
const PRICE_CENTS = 1299;
const NOW_MS = Date.parse("2026-10-18T21:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-18T21:00:00.000Z";
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\nTobacco Road Games disposable Task 5 publication PDF\n%%EOF",
  "utf8"
);
const COVER_BYTES = (() => {
  const bytes = Buffer.alloc(24);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(16, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8 ", 12, "ascii");
  return bytes;
})();
const REAL_CATALOG_FILES = Object.freeze([
  "data/products.json",
  "data/product-intake-map.json",
  "shared/product-folder-map.mjs"
]);

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-publication-task5-")
  );
  const databasePath = path.join(sandboxRoot, "creator-publication.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogRoot = path.join(sandboxRoot, "catalog");
  const realCatalogHashes = hashFiles(ROOT, REAL_CATALOG_FILES);
  let database;
  let productId = "";
  let productFileId = "";
  let coverFileId = "";
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const creatorOperations = await load(
      "functions/_lib/creator-operations.mjs"
    );
    const creatorFiles = await load("functions/_lib/creator-files.mjs");
    const creatorReview = await load("functions/_lib/creator-review.mjs");
    const creatorPublication = await load(
      "functions/_lib/creator-publication.mjs"
    );
    const ownerAuth = await load("functions/_lib/owner-auth.mjs");
    const publishIntake = require(path.join(ROOT, "scripts", "publish-intake.js"));

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(database);
    await createEligibleMockCreator(database, accountAuth);

    const d1 = createD1(database);
    const bucket = createLocalBucket(storageRoot);
    const creatorEnvironment = { TRG_ORDERS: d1, TRG_PRODUCTS: bucket };
    copyCatalogFixture(catalogRoot);

    let response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest("listings", {
        title: PRODUCT_TITLE,
        slug: PRODUCT_SLUG,
        shortDescription: SHORT_DESCRIPTION,
        longDescription: LONG_DESCRIPTION,
        priceCents: PRICE_CENTS,
        mediaType: "digital",
        format: ["PDF"],
        gameSystem: "System Neutral",
        genre: "test",
        discovery: {
          language: "English",
          rulesComplexity: "Light"
        }
      }),
      creatorEnvironment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    productId = (await response.json()).listing.id;

    response = await creatorFiles.handleCreatorFileUpload(
      creatorFileRequest(
        productId,
        "product",
        PDF_BYTES,
        "mock-task5-product.pdf",
        "application/pdf"
      ),
      creatorEnvironment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    productFileId = (await response.json()).file.id;

    response = await creatorFiles.handleCreatorFileUpload(
      creatorFileRequest(
        productId,
        "cover",
        COVER_BYTES,
        "mock-task5-cover.webp",
        "image/webp"
      ),
      creatorEnvironment,
      productId,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 201);
    coverFileId = (await response.json()).file.id;

    response = await creatorOperations.handleCreatorRequest(
      creatorJsonRequest(`listings/${productId}/submit`, {
        rightsConfirmed: true,
        representationConfirmed: true,
        licensesConfirmed: true
      }),
      creatorEnvironment,
      { database: d1, nowMs: NOW_MS }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "submitted" });

    const stagedProductFile = fileRecord(database, productFileId);
    const stagedCoverFile = fileRecord(database, coverFileId);
    assert.equal(stagedProductFile.creator_id, CREATOR_ID);
    assert.equal(stagedProductFile.listing_id, productId);
    assert.equal(stagedProductFile.validation_state, "uploaded");
    assert.equal(stagedCoverFile.creator_id, CREATOR_ID);
    assert.equal(stagedCoverFile.listing_id, productId);
    assert.equal(stagedCoverFile.validation_state, "uploaded");
    assert.equal(
      sha256(bucket.read(stagedProductFile.quarantine_key)),
      sha256(PDF_BYTES)
    );
    assert.equal(
      sha256(bucket.read(stagedCoverFile.quarantine_key)),
      sha256(COVER_BYTES)
    );

    const ownerEnvironment = {
      ...creatorEnvironment,
      OWNER_SESSION_SECRET,
      OWNER_CSRF_SECRET,
      GITHUB_PUBLISH_REF: "staging",
      GITHUB_REPO_OWNER: "mock-owner",
      GITHUB_REPO_NAME: "mock-repository",
      GITHUB_TOKEN: "mock-task5-token"
    };
    const ownerSession = await ownerAuth.createSessionToken(
      OWNER_ID,
      OWNER_SESSION_SECRET,
      NOW_MS
    );
    const ownerOptions = { database: d1, nowMs: NOW_MS };
    const dispatch = createSuccessfulDispatch();
    const publicationOptions = {
      ...ownerOptions,
      dispatchOptions: {
        fetchImpl: dispatch.fetchImpl,
        pollIntervalMs: 1,
        timeoutMs: 100
      }
    };
    const commerceBefore = commerceSnapshot(database);
    const storageKeysBeforeNegativePublish = bucket.keys();

    response = await creatorPublication.handleCreatorPublicationRequest(
      await ownerRequest(ownerAuth, ownerSession, {
        action: "publish",
        listingId: productId
      }),
      ownerEnvironment,
      publicationOptions
    );
    const unapprovedPublishStatus = response.status;
    const unapprovedPublishBody = await response.json();
    assert.equal(unapprovedPublishStatus, 409);
    assert.match(
      unapprovedPublishBody.validationErrors.join(" "),
      /has not completed marketplace compliance review/i
    );
    assert.equal(dispatch.count(), 0);
    assert.deepEqual(bucket.keys(), storageKeysBeforeNegativePublish);
    assert.equal(listingRecord(database, productId).publication_state, "not_approved");
    assert.equal(stagedProductFile.delivery_object_key, null);

    response = await creatorReview.handleCreatorReviewRequest(
      await ownerRequest(ownerAuth, ownerSession, {
        action: "approve",
        listingId: productId,
        note: "Approved for the Task 5 publication sandbox."
      }, "/owner/api/creator-reviews"),
      ownerEnvironment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "active",
      reviewedBy: OWNER_ID
    });

    for (const fileId of [productFileId, coverFileId]) {
      response = await creatorPublication.handleCreatorPublicationRequest(
        await ownerRequest(ownerAuth, ownerSession, {
          action: "accept_file",
          fileId
        }),
        ownerEnvironment,
        ownerOptions
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, state: "accepted" });
    }

    response = await creatorPublication.handleCreatorPublicationRequest(
      await ownerRequest(ownerAuth, ownerSession, {
        action: "publish",
        listingId: productId
      }),
      ownerEnvironment,
      publicationOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      productSlug: PRODUCT_SLUG,
      pending: false,
      runUrl: "https://example.invalid/actions/runs/task5"
    });
    assert.equal(dispatch.count(), 1);

    const publishPayload = dispatch.payload();
    assert.equal(publishPayload.operation, "creator_publication");
    assert.equal(publishPayload.folder, PRODUCT_SLUG);
    assert.equal(publishPayload.ref, "staging");
    assert.equal(publishPayload.requested_by, OWNER_ID);
    assert.equal(publishPayload.metadata.creatorId, CREATOR_ID);
    assert.equal(publishPayload.metadata.productIdentityId, productId);
    assert.equal(publishPayload.metadata.slug, PRODUCT_SLUG);
    assert.equal(publishPayload.metadata.title, PRODUCT_TITLE);
    assert.equal(publishPayload.metadata.shortDescription, SHORT_DESCRIPTION);
    assert.equal(publishPayload.metadata.longDescription, LONG_DESCRIPTION);
    assert.equal(publishPayload.metadata.priceCents, PRICE_CENTS);

    await publishIntake.applyPublishPayload(catalogRoot, publishPayload);

    const publishedListing = listingRecord(database, productId);
    assert.equal(publishedListing.creator_id, CREATOR_ID);
    assert.equal(publishedListing.slug, PRODUCT_SLUG);
    assert.equal(publishedListing.title, PRODUCT_TITLE);
    assert.equal(publishedListing.short_description, SHORT_DESCRIPTION);
    assert.equal(publishedListing.long_description, LONG_DESCRIPTION);
    assert.equal(publishedListing.listed_price_cents, PRICE_CENTS);
    assert.equal(publishedListing.lifecycle_state, "active");
    assert.equal(publishedListing.publication_state, "published");
    assert.equal(publishedListing.public_product_slug, PRODUCT_SLUG);
    assert.equal(publishedListing.source_product_slug, PRODUCT_SLUG);
    assert.equal(publishedListing.published_at, NOW);
    assert.equal(publishedListing.first_published_at, NOW);

    const publishedProductFile = fileRecord(database, productFileId);
    const publishedCoverFile = fileRecord(database, coverFileId);
    assert.equal(publishedProductFile.validation_state, "accepted");
    assert.equal(
      publishedProductFile.delivery_object_key,
      `${PRODUCT_SLUG}/product.pdf`
    );
    assert.equal(publishedCoverFile.validation_state, "accepted");
    assert.equal(
      publishedCoverFile.delivery_object_key,
      `${PRODUCT_SLUG}/cover.webp`
    );
    assert.equal(
      sha256(bucket.read(`${PRODUCT_SLUG}/product.pdf`)),
      sha256(PDF_BYTES)
    );
    assert.equal(
      sha256(bucket.read(`${PRODUCT_SLUG}/cover.webp`)),
      sha256(COVER_BYTES)
    );

    const sandboxProducts = readJson(
      path.join(catalogRoot, "data", "products.json")
    );
    const catalogProduct = sandboxProducts.find(
      (entry) => entry.slug === PRODUCT_SLUG
    );
    assert.ok(catalogProduct);
    assert.equal(catalogProduct.creatorId, CREATOR_ID);
    assert.equal(catalogProduct.productIdentityId, productId);
    assert.equal(catalogProduct.title, PRODUCT_TITLE);
    assert.equal(catalogProduct.shortDescription, SHORT_DESCRIPTION);
    assert.equal(catalogProduct.longDescription, LONG_DESCRIPTION);
    assert.equal(catalogProduct.priceCents, PRICE_CENTS);
    assert.equal(catalogProduct.mediaType, "digital");
    assert.equal(catalogProduct.status, "available-direct");
    assert.equal(catalogProduct.buyMode, "cart");
    assert.equal(
      catalogProduct.coverImage,
      `/product-assets/${PRODUCT_SLUG}/cover.webp`
    );

    const sandboxIntakeMap = readJson(
      path.join(catalogRoot, "data", "product-intake-map.json")
    );
    const intakeProduct = sandboxIntakeMap.products.find(
      (entry) => entry.slug === PRODUCT_SLUG
    );
    assert.ok(intakeProduct);
    assert.equal(intakeProduct.folder, PRODUCT_SLUG);
    assert.equal(intakeProduct.title, PRODUCT_TITLE);

    const folderMap = await import(
      `${pathToFileURL(
        path.join(catalogRoot, "shared", "product-folder-map.mjs")
      ).href}?task5=${Math.random()}`
    );
    assert.equal(folderMap.getFolderForSlug(PRODUCT_SLUG), PRODUCT_SLUG);

    const publicationAudit = database
      .prepare(
        "SELECT creator_id,actor_type,actor_id,action,context_json,created_at FROM creator_publication_audit WHERE listing_id=? AND action='published'"
      )
      .get(productId);
    assert.equal(publicationAudit.creator_id, CREATOR_ID);
    assert.equal(publicationAudit.actor_type, "operator");
    assert.equal(publicationAudit.actor_id, OWNER_ID);
    assert.equal(publicationAudit.action, "published");
    assert.equal(publicationAudit.created_at, NOW);
    assert.equal(
      JSON.parse(publicationAudit.context_json).productSlug,
      PRODUCT_SLUG
    );

    assert.deepEqual(commerceSnapshot(database), commerceBefore);
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), realCatalogHashes);
    assert.equal(
      readJson(path.join(ROOT, "data", "products.json")).some(
        (entry) => entry.slug === PRODUCT_SLUG
      ),
      false
    );

    const publishedStorageKeys = bucket.keys();
    assert.equal(
      publishedStorageKeys.includes(`${PRODUCT_SLUG}/product.pdf`),
      true
    );
    assert.equal(
      publishedStorageKeys.includes(`${PRODUCT_SLUG}/cover.webp`),
      true
    );

    cleanupDatabase(database, productId);
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
      reviewAudits: 0,
      publicationAudits: 0,
      agreements: 0,
      registrationDetails: 0,
      payoutProfiles: 0
    });
    assert.deepEqual(commerceSnapshot(database), commerceBefore);

    bucket.clear();
    assert.deepEqual(bucket.keys(), []);
    assert.equal(fs.existsSync(storageRoot), false);
    fs.rmSync(catalogRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(catalogRoot), false);
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), realCatalogHashes);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator product publication sandbox test passed.");
    console.log(`Creator ID: ${CREATOR_ID}`);
    console.log(`Owner ID: ${OWNER_ID}`);
    console.log(`Product ID: ${productId}`);
    console.log(`Product slug: ${PRODUCT_SLUG}`);
    console.log("Owner approval result: active / approved");
    console.log("Publication result: active / published");
    console.log("Sandbox catalog entry: present with Creator and Product IDs");
    console.log(
      `Private PDF object: ${PRODUCT_SLUG}/product.pdf`
    );
    console.log(`Original PDF SHA-256: ${sha256(PDF_BYTES)}`);
    console.log(
      `Published PDF SHA-256: ${sha256(PDF_BYTES)}`
    );
    console.log(
      `Unapproved publication: rejected (${unapprovedPublishStatus})`
    );
    console.log("Commerce and entitlement rows created: 0");
    console.log("Disposable database records remaining: 0");
    console.log("Disposable storage objects remaining: 0");
    console.log("Disposable catalog removed: true");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

function createSuccessfulDispatch() {
  let dispatchCount = 0;
  let capturedPayload = null;
  return {
    count: () => dispatchCount,
    payload: () => capturedPayload,
    async fetchImpl(url, init = {}) {
      if (String(url).endsWith("/dispatches")) {
        dispatchCount += 1;
        capturedPayload = JSON.parse(init.body).client_payload;
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: "task5",
              html_url: "https://example.invalid/actions/runs/task5",
              created_at: new Date().toISOString(),
              display_title: `Owner publish ${capturedPayload.publish_id}`,
              status: "completed",
              conclusion: "success"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  };
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
      "session-mock-publication-task5",
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
      "mock-creator-publication-task5",
      "Mock Creator Publication Task 5",
      "Disposable publication fixture.",
      "This Creator exists only in the Task 5 temporary database.",
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
    .run(CREATOR_USER_ID, "Mock Creator Task 5", NOW, NOW, NOW);
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
      "Mock Creator Task 5",
      "",
      "individual",
      "US",
      "NC",
      "5 Disposable Publication Road",
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
       ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task5_sandbox')`
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
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${CREATOR_SESSION}; trg_account_csrf=${CREATOR_CSRF}`,
      "x-csrf-token": CREATOR_CSRF,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function creatorFileRequest(
  listingId,
  purpose,
  bytes,
  filename,
  contentType
) {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([bytes], filename, { type: contentType }));
  return new Request(
    `https://example.com/api/creator/listings/${listingId}/files`,
    {
      method: "POST",
      headers: {
        origin: "https://example.com",
        cookie: `__Host-trg_session=${CREATOR_SESSION}; trg_account_csrf=${CREATOR_CSRF}`,
        "x-csrf-token": CREATOR_CSRF
      },
      body: form
    }
  );
}

async function ownerRequest(
  ownerAuth,
  ownerSession,
  body,
  route = "/owner/api/creator-publication"
) {
  const csrf = await ownerAuth.createCsrfToken(
    OWNER_ID,
    OWNER_CSRF_SECRET,
    NOW_MS
  );
  return new Request(`https://example.com${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `${ownerAuth.SESSION_COOKIE_NAME}=${ownerSession}; ${ownerAuth.CSRF_COOKIE_NAME}=${csrf}`,
      "x-csrf-token": csrf,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function listingRecord(database, listingId) {
  return database
    .prepare("SELECT * FROM creator_listings WHERE id=?")
    .get(listingId);
}

function fileRecord(database, fileId) {
  return database
    .prepare("SELECT * FROM creator_listing_files WHERE id=?")
    .get(fileId);
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
    earningsCents: Number(earnings.cents),
    servicePurchases: countAll(database, "marketplace_service_purchases"),
    balanceReservations: countAll(database, "creator_balance_reservations"),
    webhookEvents: countAll(database, "webhook_events")
  };
}

function copyCatalogFixture(catalogRoot) {
  for (const relativePath of REAL_CATALOG_FILES) {
    const target = path.join(catalogRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relativePath), target);
  }
}

function cleanupDatabase(database, productId) {
  database.exec("BEGIN;");
  try {
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
    database.prepare("DELETE FROM creator_listings WHERE id=?").run(productId);
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
    reviewAudits: count(
      database,
      "creator_review_audit",
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
  const metadata = new Map();
  return {
    async put(key, value, options = {}) {
      const target = storagePath(root, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const bytes =
        value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(await new Response(value).arrayBuffer());
      fs.writeFileSync(target, bytes);
      metadata.set(String(key), options);
    },
    async get(key) {
      const target = storagePath(root, key);
      if (!fs.existsSync(target)) return null;
      const bytes = fs.readFileSync(target);
      return {
        body: bytes,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
      };
    },
    read(key) {
      return fs.readFileSync(storagePath(root, key));
    },
    keys() {
      if (!fs.existsSync(root)) return [];
      return listFiles(root).map((file) =>
        path.relative(root, file).split(path.sep).join("/")
      ).sort();
    },
    clear() {
      fs.rmSync(root, { recursive: true, force: true });
      metadata.clear();
    }
  };
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else files.push(target);
  }
  return files;
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

function hashFiles(root, relativePaths) {
  return relativePaths
    .map((relativePath) => `${relativePath}:${sha256(fs.readFileSync(path.join(root, relativePath)))}`)
    .join("|");
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function load(relativePath) {
  return import(
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task5=${Math.random()}`
  );
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
