const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const { createOwnerAuthFixture } = require("./test-support/owner-auth-fixture.js");
const NOW_MS = Date.parse("2026-10-18T22:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const STANDARD_CAP = 20;
const PREFERRED_CAP = 22;
const STANDARD_CREATOR = "creator-mock-shelf-standard";
const STANDARD_USER = "user-mock-shelf-standard";
const PREFERRED_CREATOR = "creator-mock-shelf-preferred";
const PREFERRED_USER = "user-mock-shelf-preferred";
const OWNER_ID = "rv-local-owner";
const OWNER_SESSION_SECRET = "mock-task6-owner-session-secret-32-bytes";
const OWNER_CSRF_SECRET = "mock-task6-owner-csrf-secret-32-bytes";
const REAL_CATALOG_FILES = Object.freeze([
  "data/products.json",
  "data/product-intake-map.json",
  "shared/product-folder-map.mjs"
]);

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-shelf-slots-task6-")
  );
  const databasePath = path.join(sandboxRoot, "shelf-slots.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogRoot = path.join(sandboxRoot, "catalog");
  const realCatalogHashes = hashFiles(ROOT, REAL_CATALOG_FILES);
  let database;
  let explicitCleanupComplete = false;

  try {
    const creatorPublication = await load(
      "functions/_lib/creator-publication.mjs"
    );
    const marketplacePolicy = await load(
      "functions/_lib/marketplace-policy.mjs"
    );
    const ownerAuth = await load("functions/_lib/owner-auth.mjs");
    const publishIntake = require(path.join(ROOT, "scripts", "publish-intake.js"));

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(database);

    const d1 = createD1(database);
    const bucket = createLocalBucket(storageRoot);
    await createEligibleCreator(database, {
      creatorId: STANDARD_CREATOR,
      userId: STANDARD_USER,
      slug: "mock-shelf-standard",
      preferred: false
    });
    await createEligibleCreator(database, {
      creatorId: PREFERRED_CREATOR,
      userId: PREFERRED_USER,
      slug: "mock-shelf-preferred",
      preferred: true
    });

    const standardCapacity = await marketplacePolicy.getCreatorCapacity(
      d1,
      STANDARD_CREATOR,
      NOW_MS
    );
    const preferredCapacity = await marketplacePolicy.getCreatorCapacity(
      d1,
      PREFERRED_CREATOR,
      NOW_MS
    );
    assert.deepEqual(
      {
        activeListingCap: standardCapacity.activeListingCap,
        ownerCatalogOverride: standardCapacity.ownerCatalogOverride,
        preferred: standardCapacity.preferred
      },
      { activeListingCap: STANDARD_CAP, ownerCatalogOverride: false, preferred: false }
    );
    assert.deepEqual(
      {
        activeListingCap: preferredCapacity.activeListingCap,
        ownerCatalogOverride: preferredCapacity.ownerCatalogOverride,
        preferred: preferredCapacity.preferred
      },
      { activeListingCap: PREFERRED_CAP, ownerCatalogOverride: false, preferred: true }
    );

    const standardListings = await seedApprovedListings(
      database,
      bucket,
      STANDARD_CREATOR,
      STANDARD_USER,
      "standard",
      STANDARD_CAP + 1
    );
    const preferredListings = await seedApprovedListings(
      database,
      bucket,
      PREFERRED_CREATOR,
      PREFERRED_USER,
      "preferred",
      PREFERRED_CAP + 1
    );
    copyCatalogFixture(catalogRoot);

    const ownerFixture = await createOwnerAuthFixture({
      ownerAuth,
      ownerId: OWNER_ID,
      nowMs: NOW_MS,
      sessionSecret: OWNER_SESSION_SECRET,
      csrfSecret: OWNER_CSRF_SECRET,
      origin: "http://127.0.0.1"
    });
    const environment = {
      TRG_ORDERS: d1,
      TRG_PRODUCTS: bucket,
      ...ownerFixture.environment,
      GITHUB_PUBLISH_REF: "staging",
      GITHUB_REPO_OWNER: "mock-owner",
      GITHUB_REPO_NAME: "mock-repository",
      GITHUB_TOKEN: "mock-task6-token"
    };
    const dispatch = createSuccessfulDispatch();
    const publicationOptions = {
      database: d1,
      nowMs: NOW_MS,
      ...ownerFixture.options,
      dispatchOptions: {
        fetchImpl: dispatch.fetchImpl,
        pollIntervalMs: 1,
        timeoutMs: 100
      }
    };
    const commerceBefore = commerceSnapshot(database);

    for (const listing of standardListings.slice(0, STANDARD_CAP)) {
      await publishListing({
        creatorPublication,
        dispatch,
        environment,
        listing,
        ownerFixture,
        publicationOptions,
        publishIntake,
        catalogRoot
      });
    }
    assert.equal(activeCount(database, STANDARD_CREATOR), STANDARD_CAP);
    assert.equal(activeCatalogCount(catalogRoot, STANDARD_CREATOR), STANDARD_CAP);

    const standardOverflow = standardListings.at(-1);
    const standardBlockedState = captureBlockedState(
      database,
      bucket,
      catalogRoot,
      standardListings.slice(0, STANDARD_CAP),
      standardOverflow
    );
    let response = await creatorPublication.handleCreatorPublicationRequest(
      ownerRequest(ownerFixture, {
        action: "publish",
        listingId: standardOverflow.id
      }),
      environment,
      publicationOptions
    );
    const standardOverflowStatus = response.status;
    const standardOverflowBody = await response.json();
    assert.equal(standardOverflowStatus, 409);
    assert.match(standardOverflowBody.error, /capacity is 20/i);
    assertBlockedStateUnchanged(
      database,
      bucket,
      catalogRoot,
      standardListings.slice(0, STANDARD_CAP),
      standardOverflow,
      standardBlockedState
    );

    await publishListing({
      creatorPublication,
      dispatch,
      environment,
      listing: preferredListings[0],
      ownerFixture,
      publicationOptions,
      publishIntake,
      catalogRoot
    });
    assert.equal(activeCount(database, STANDARD_CREATOR), STANDARD_CAP);
    assert.equal(activeCount(database, PREFERRED_CREATOR), 1);

    for (const listing of preferredListings.slice(1, PREFERRED_CAP)) {
      await publishListing({
        creatorPublication,
        dispatch,
        environment,
        listing,
        ownerFixture,
        publicationOptions,
        publishIntake,
        catalogRoot
      });
    }
    assert.equal(activeCount(database, PREFERRED_CREATOR), PREFERRED_CAP);
    assert.equal(activeCatalogCount(catalogRoot, PREFERRED_CREATOR), PREFERRED_CAP);

    const preferredOverflow = preferredListings.at(-1);
    const preferredBlockedState = captureBlockedState(
      database,
      bucket,
      catalogRoot,
      preferredListings.slice(0, PREFERRED_CAP),
      preferredOverflow
    );
    response = await creatorPublication.handleCreatorPublicationRequest(
      ownerRequest(ownerFixture, {
        action: "publish",
        listingId: preferredOverflow.id
      }),
      environment,
      publicationOptions
    );
    const preferredOverflowStatus = response.status;
    const preferredOverflowBody = await response.json();
    assert.equal(preferredOverflowStatus, 409);
    assert.match(preferredOverflowBody.error, /capacity is 22/i);
    assertBlockedStateUnchanged(
      database,
      bucket,
      catalogRoot,
      preferredListings.slice(0, PREFERRED_CAP),
      preferredOverflow,
      preferredBlockedState
    );

    const pausedListing = standardListings[0];
    const beforePause = listingRecord(database, pausedListing.id);
    const pausedPdfHash = sha256(bucket.read(`${pausedListing.slug}/product.pdf`));
    response = await creatorPublication.handleCreatorPublicationRequest(
      ownerRequest(ownerFixture, {
        action: "pause_publication",
        listingId: pausedListing.id
      }),
      environment,
      publicationOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "paused",
      pending: false
    });
    const pausePayload = dispatch.latest();
    assert.equal(pausePayload.operation, "creator_pause");
    assert.equal(pausePayload.metadata.slug, pausedListing.slug);
    await publishIntake.applyPublishPayload(catalogRoot, pausePayload);

    const afterPause = listingRecord(database, pausedListing.id);
    assert.equal(afterPause.creator_id, STANDARD_CREATOR);
    assert.equal(afterPause.lifecycle_state, "paused");
    assert.equal(afterPause.publication_state, "paused");
    assert.equal(afterPause.public_product_slug, beforePause.public_product_slug);
    assert.equal(afterPause.first_published_at, beforePause.first_published_at);
    assert.equal(afterPause.published_at, beforePause.published_at);
    assert.equal(
      sha256(bucket.read(`${pausedListing.slug}/product.pdf`)),
      pausedPdfHash
    );
    assert.equal(
      catalogProduct(catalogRoot, pausedListing.slug).status,
      "legacy-not-for-sale"
    );
    assert.equal(
      publicationAuditCount(database, pausedListing.id, "publication_paused"),
      1
    );
    assert.equal(activeCount(database, STANDARD_CREATOR), STANDARD_CAP - 1);

    const releasedCapacity = await marketplacePolicy.assertPublicationCapacity(
      d1,
      listingRecord(database, standardOverflow.id),
      NOW_MS
    );
    assert.equal(releasedCapacity.nextActive, STANDARD_CAP);
    await publishListing({
      creatorPublication,
      dispatch,
      environment,
      listing: standardOverflow,
      ownerFixture,
      publicationOptions,
      publishIntake,
      catalogRoot
    });
    assert.equal(activeCount(database, STANDARD_CREATOR), STANDARD_CAP);
    assert.equal(activeCatalogCount(catalogRoot, STANDARD_CREATOR), STANDARD_CAP);
    assert.equal(activeCount(database, PREFERRED_CREATOR), PREFERRED_CAP);

    for (const listing of [...standardListings, ...preferredListings]) {
      const row = listingRecord(database, listing.id);
      if (row.publication_state === "published" || row.publication_state === "paused") {
        assert.equal(
          sha256(bucket.read(`${listing.slug}/product.pdf`)),
          listing.pdfHash
        );
      }
    }
    assert.deepEqual(commerceSnapshot(database), commerceBefore);
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), realCatalogHashes);

    cleanupDatabase(database, [STANDARD_CREATOR, PREFERRED_CREATOR]);
    assert.deepEqual(remainingCounts(database), {
      creators: 0,
      users: 0,
      memberships: 0,
      ownerships: 0,
      profiles: 0,
      registrationDetails: 0,
      agreements: 0,
      payoutProfiles: 0,
      preferredTerms: 0,
      listings: 0,
      files: 0,
      declarations: 0,
      publicationAudits: 0
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

    console.log("Creator active shelf-slot enforcement test passed.");
    console.log(`Standard active listing allowance: ${STANDARD_CAP}`);
    console.log(`Preferred active listing allowance: ${PREFERRED_CAP}`);
    console.log(`Standard boundary: ${STANDARD_CAP} published; product ${STANDARD_CAP + 1} rejected (${standardOverflowStatus})`);
    console.log(`Preferred boundary: ${PREFERRED_CAP} published; product ${PREFERRED_CAP + 1} rejected (${preferredOverflowStatus})`);
    console.log("Second Creator capacity remained independent: true");
    console.log("Paused Standard product released one slot: true");
    console.log("Replacement Standard product published into released slot: true");
    console.log("PDF hashes unchanged: true");
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

async function createEligibleCreator(
  database,
  { creatorId, userId, slug, preferred }
) {
  const email = `${slug}@example.invalid`;
  database
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)"
    )
    .run(userId, email, NOW, NOW);
  database
    .prepare(
      `INSERT INTO marketplace_creators(
         id,slug,display_name,short_bio,long_bio,profile_template,
         marketplace_status,registration_status,registration_completed_at,
         intake_registration_completed_at,created_at,updated_at
       ) VALUES(?,?,?,?,?,'catalog','approved','active',?,?,?,?)`
    )
    .run(
      creatorId,
      slug,
      `Mock ${preferred ? "Preferred" : "Standard"} Shelf Creator`,
      "Disposable shelf-slot fixture.",
      "This Creator exists only inside the Task 6 sandbox.",
      NOW,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)"
    )
    .run(userId, creatorId, NOW);
  database
    .prepare(
      `INSERT INTO creator_identity_ownership(
         creator_id,owner_user_id,identity_type,account_status,billing_status,
         entitlement_source,created_at,updated_at
       ) VALUES(?,?,'primary','active','not_required','primary_free',?,?)`
    )
    .run(creatorId, userId, NOW, NOW);
  database
    .prepare(
      `INSERT INTO user_account_profiles(
         user_id,legal_name,payment_method_status,payment_method_status_updated_at,
         created_at,updated_at
       ) VALUES(?,?,'ready',?,?,?)`
    )
    .run(userId, `Mock ${slug}`, NOW, NOW, NOW);
  database
    .prepare(
      `INSERT INTO creator_registration_details(
         creator_id,legal_name,business_name,business_type,country,state_region,
         address_line1,city,postal_code,contact_email,rights_confirmation_at,
         created_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      creatorId,
      `Mock ${slug}`,
      "",
      "individual",
      "US",
      "NC",
      "6 Disposable Shelf Road",
      "Durham",
      "27701",
      email,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(
      `INSERT INTO creator_agreement_acceptances(
         creator_id,accepted_by_user_id,agreement_id,agreement_version,
         accepted_at,source_context
       ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task6_sandbox')`
    )
    .run(creatorId, userId, NOW);
  database
    .prepare(
      `INSERT INTO creator_payout_profiles(
         creator_id,provider,onboarding_status,payouts_enabled,
         verification_status,status_updated_at
       ) VALUES(?,'manual','complete',1,'verified',?)`
    )
    .run(creatorId, NOW);

  if (preferred) {
    database
      .prepare(
        `INSERT INTO creator_preferred_terms(
           id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,
           renewal_state,status,created_at,updated_at
         ) VALUES(?,?,'annual_prepaid',20000,?,?,'cancelled','active',?,?)`
      )
      .run(
        "term-mock-shelf-preferred",
        creatorId,
        new Date(NOW_MS - 86400000).toISOString(),
        new Date(NOW_MS + 300 * 86400000).toISOString(),
        NOW,
        NOW
      );
  }
}

async function seedApprovedListings(
  database,
  bucket,
  creatorId,
  userId,
  label,
  count
) {
  const listings = [];
  for (let index = 1; index <= count; index += 1) {
    const sequence = String(index).padStart(2, "0");
    const slug = `mock-shelf-${label}-${sequence}`;
    const id = `listing-${slug}`;
    const pdf = Buffer.from(
      `%PDF-1.7\nDisposable Task 6 ${label} shelf product ${sequence}\n%%EOF`,
      "utf8"
    );
    const cover = mockCover(index);
    const productFileId = `file-${slug}-product`;
    const coverFileId = `file-${slug}-cover`;
    const productKey = `creator-staging/${creatorId}/${id}/${productFileId}/product.pdf`;
    const coverKey = `creator-staging/${creatorId}/${id}/${coverFileId}/cover.webp`;

    database
      .prepare(
        `INSERT INTO creator_listings(
           id,creator_id,slug,title,short_description,long_description,
           lifecycle_state,publication_state,listed_price_cents,pricing_model,
           media_type,format_json,game_system,genre,discovery_json,reviewed_at,
           created_at,updated_at
         ) VALUES(?,?,?,?,?,?,'active','approved',1000,'fixed','digital','["PDF"]',
           'System Neutral','test','{"language":"English"}',?,?,?)`
      )
      .run(
        id,
        creatorId,
        slug,
        `Mock Shelf Product ${label} ${sequence}`,
        `Disposable ${label} shelf-slot fixture ${sequence}.`,
        `This approved product exists only inside the Task 6 ${label} sandbox.`,
        NOW,
        NOW,
        NOW
      );
    database
      .prepare(
        `INSERT INTO creator_listing_declarations(
           listing_id,creator_id,declared_by_user_id,submission_key,
           rights_confirmed,representation_confirmed,licenses_confirmed,declared_at
         ) VALUES(?,?,?,?,1,1,1,?)`
      )
      .run(id, creatorId, userId, `task6:${id}`, NOW);
    database
      .prepare(
        `INSERT INTO creator_listing_files(
           id,listing_id,creator_id,purpose,original_filename,normalized_filename,
           content_type,size_bytes,quarantine_key,validation_state,validated_at,uploaded_at
         ) VALUES(?,?,?,'product',?,?,'application/pdf',?,?,'accepted',?,?)`
      )
      .run(
        productFileId,
        id,
        creatorId,
        `${slug}.pdf`,
        "product.pdf",
        pdf.byteLength,
        productKey,
        NOW,
        NOW
      );
    database
      .prepare(
        `INSERT INTO creator_listing_files(
           id,listing_id,creator_id,purpose,original_filename,normalized_filename,
           content_type,size_bytes,quarantine_key,validation_state,validated_at,uploaded_at
         ) VALUES(?,?,?,'cover',?,?,'image/webp',?,?,'accepted',?,?)`
      )
      .run(
        coverFileId,
        id,
        creatorId,
        `${slug}.webp`,
        "cover.webp",
        cover.byteLength,
        coverKey,
        NOW,
        NOW
      );
    await bucket.put(productKey, pdf, {
      httpMetadata: { contentType: "application/pdf" }
    });
    await bucket.put(coverKey, cover, {
      httpMetadata: { contentType: "image/webp" }
    });
    listings.push({ id, slug, pdfHash: sha256(pdf) });
  }
  return listings;
}

async function publishListing({
  creatorPublication,
  dispatch,
  environment,
  listing,
  ownerFixture,
  publicationOptions,
  publishIntake,
  catalogRoot
}) {
  const beforeDispatch = dispatch.count();
  const response = await creatorPublication.handleCreatorPublicationRequest(
    ownerRequest(ownerFixture, {
      action: "publish",
      listingId: listing.id
    }),
    environment,
    publicationOptions
  );
  assert.equal(response.status, 200, await response.text());
  assert.equal(dispatch.count(), beforeDispatch + 1);
  const payload = dispatch.latest();
  assert.equal(payload.operation, "creator_publication");
  assert.equal(payload.metadata.productIdentityId, listing.id);
  assert.equal(payload.metadata.slug, listing.slug);
  await publishIntake.applyPublishPayload(catalogRoot, payload);
  const row = listingRecord(publicationOptions.database.raw, listing.id);
  assert.equal(row.publication_state, "published");
  assert.equal(row.lifecycle_state, "active");
  assert.equal(
    sha256(environment.TRG_PRODUCTS.read(`${listing.slug}/product.pdf`)),
    listing.pdfHash
  );
}

function createSuccessfulDispatch() {
  const payloads = [];
  let current = null;
  return {
    count: () => payloads.length,
    latest: () => payloads.at(-1),
    async fetchImpl(url, init = {}) {
      if (String(url).endsWith("/dispatches")) {
        current = JSON.parse(init.body).client_payload;
        payloads.push(current);
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: `task6-${payloads.length}`,
              html_url: `https://example.invalid/actions/runs/task6-${payloads.length}`,
              created_at: new Date().toISOString(),
              display_title: `Owner publish ${current.publish_id}`,
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

function ownerRequest(ownerFixture, body) {
  return ownerFixture.jsonRequest("/owner/api/creator-publication", body);
}

function captureBlockedState(
  database,
  bucket,
  catalogRoot,
  published,
  overflow
) {
  return {
    catalogHashes: hashFiles(catalogRoot, REAL_CATALOG_FILES),
    storageKeys: bucket.keys(),
    publishedPdfHashes: published.map((listing) =>
      sha256(bucket.read(`${listing.slug}/product.pdf`))
    ),
    overflowDeliveryKey: productFile(database, overflow.id).delivery_object_key
  };
}

function assertBlockedStateUnchanged(
  database,
  bucket,
  catalogRoot,
  published,
  overflow,
  before
) {
  assert.equal(hashFiles(catalogRoot, REAL_CATALOG_FILES), before.catalogHashes);
  assert.deepEqual(bucket.keys(), before.storageKeys);
  assert.deepEqual(
    published.map((listing) => sha256(bucket.read(`${listing.slug}/product.pdf`))),
    before.publishedPdfHashes
  );
  assert.equal(productFile(database, overflow.id).delivery_object_key, before.overflowDeliveryKey);
  assert.equal(before.overflowDeliveryKey, null);
  assert.equal(bucket.keys().includes(`${overflow.slug}/product.pdf`), false);
  assert.equal(listingRecord(database, overflow.id).publication_state, "approved");
}

function cleanupDatabase(database, creatorIds) {
  const placeholders = creatorIds.map(() => "?").join(",");
  database.exec("BEGIN;");
  try {
    for (const table of [
      "creator_review_audit",
      "creator_listing_declarations",
      "creator_publication_audit",
      "creator_listing_files",
      "creator_listings",
      "creator_preferred_terms",
      "creator_account_notices",
      "creator_account_audits",
      "creator_account_audit_states",
      "creator_agreement_acceptances",
      "creator_payout_profiles",
      "creator_registration_details",
      "creator_identity_ownership",
      "creator_memberships"
    ]) {
      database
        .prepare(`DELETE FROM ${table} WHERE creator_id IN (${placeholders})`)
        .run(...creatorIds);
    }
    const users = [STANDARD_USER, PREFERRED_USER];
    database
      .prepare(`DELETE FROM marketplace_creators WHERE id IN (${placeholders})`)
      .run(...creatorIds);
    database
      .prepare("DELETE FROM user_account_profiles WHERE user_id IN (?,?)")
      .run(...users);
    database.prepare("DELETE FROM sessions WHERE user_id IN (?,?)").run(...users);
    database.prepare("DELETE FROM users WHERE id IN (?,?)").run(...users);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function remainingCounts(database) {
  const creators = [STANDARD_CREATOR, PREFERRED_CREATOR];
  const users = [STANDARD_USER, PREFERRED_USER];
  return {
    creators: countIn(database, "marketplace_creators", "id", creators),
    users: countIn(database, "users", "id", users),
    memberships: countIn(database, "creator_memberships", "creator_id", creators),
    ownerships: countIn(database, "creator_identity_ownership", "creator_id", creators),
    profiles: countIn(database, "user_account_profiles", "user_id", users),
    registrationDetails: countIn(database, "creator_registration_details", "creator_id", creators),
    agreements: countIn(database, "creator_agreement_acceptances", "creator_id", creators),
    payoutProfiles: countIn(database, "creator_payout_profiles", "creator_id", creators),
    preferredTerms: countIn(database, "creator_preferred_terms", "creator_id", creators),
    listings: countIn(database, "creator_listings", "creator_id", creators),
    files: countIn(database, "creator_listing_files", "creator_id", creators),
    declarations: countIn(database, "creator_listing_declarations", "creator_id", creators),
    publicationAudits: countIn(database, "creator_publication_audit", "creator_id", creators)
  };
}

function activeCount(database, creatorId) {
  return Number(
    database
      .prepare(
        "SELECT COUNT(*) count FROM creator_listings WHERE creator_id=? AND publication_state='published'"
      )
      .get(creatorId).count
  );
}

function activeCatalogCount(catalogRoot, creatorId) {
  return readJson(path.join(catalogRoot, "data", "products.json")).filter(
    (product) => product.creatorId === creatorId && product.status === "available-direct"
  ).length;
}

function listingRecord(database, listingId) {
  return database.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
}

function productFile(database, listingId) {
  return database
    .prepare(
      "SELECT * FROM creator_listing_files WHERE listing_id=? AND purpose='product'"
    )
    .get(listingId);
}

function catalogProduct(catalogRoot, slug) {
  return readJson(path.join(catalogRoot, "data", "products.json")).find(
    (product) => product.slug === slug
  );
}

function publicationAuditCount(database, listingId, action) {
  return Number(
    database
      .prepare(
        "SELECT COUNT(*) count FROM creator_publication_audit WHERE listing_id=? AND action=?"
      )
      .get(listingId, action).count
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
    earningsCents: Number(earnings.cents),
    servicePurchases: countAll(database, "marketplace_service_purchases"),
    balanceReservations: countAll(database, "creator_balance_reservations"),
    webhookEvents: countAll(database, "webhook_events")
  };
}

function countAll(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
}

function countIn(database, table, column, values) {
  const placeholders = values.map(() => "?").join(",");
  return Number(
    database
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column} IN (${placeholders})`)
      .get(...values).count
  );
}

function applyMigrations(database) {
  for (const migration of fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8"));
  }
}

function copyCatalogFixture(catalogRoot) {
  for (const relativePath of REAL_CATALOG_FILES) {
    const target = path.join(catalogRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relativePath), target);
  }
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
    async get(key) {
      const target = storagePath(root, key);
      if (!fs.existsSync(target)) return null;
      const bytes = fs.readFileSync(target);
      return {
        body: bytes,
        size: bytes.byteLength,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    },
    read(key) {
      return fs.readFileSync(storagePath(root, key));
    },
    keys() {
      if (!fs.existsSync(root)) return [];
      return listFiles(root)
        .map((file) => path.relative(root, file).split(path.sep).join("/"))
        .sort();
    },
    clear() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function storagePath(root, key) {
  const target = path.resolve(root, ...String(key).split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`;
  assert.ok(target.startsWith(prefix), "Storage keys must remain inside the sandbox.");
  return target;
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

function mockCover(seed) {
  const bytes = Buffer.alloc(24, seed % 255);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(16, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8 ", 12, "ascii");
  return bytes;
}

function hashFiles(root, relativePaths) {
  return relativePaths
    .map(
      (relativePath) =>
        `${relativePath}:${sha256(fs.readFileSync(path.join(root, relativePath)))}`
    )
    .join("|");
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function load(relativePath) {
  return import(
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task6=${Math.random()}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
