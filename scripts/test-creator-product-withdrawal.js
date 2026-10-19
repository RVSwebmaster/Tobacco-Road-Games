const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const { createOwnerAuthFixture } = require("./test-support/owner-auth-fixture.js");
const NOW_MS = Date.parse("2026-10-19T02:30:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES_AT = "2027-10-19T02:30:00.000Z";
const CREATOR_A = Object.freeze({
  id: "creator-mock-withdrawal-a",
  userId: "user-mock-withdrawal-a",
  slug: "mock-withdrawal-a",
  session: "mock-withdrawal-a-session",
  csrf: "mock-withdrawal-a-csrf"
});
const CREATOR_B = Object.freeze({
  id: "creator-mock-withdrawal-b",
  userId: "user-mock-withdrawal-b",
  slug: "mock-withdrawal-b",
  session: "mock-withdrawal-b-session",
  csrf: "mock-withdrawal-b-csrf"
});
const OWNER_ID = "owner-withdrawal-task7@example.invalid";
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\nTobacco Road Games disposable Task 7 PDF\n%%EOF",
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
    path.join(os.tmpdir(), "trg-creator-withdrawal-task7-")
  );
  const databasePath = path.join(sandboxRoot, "withdrawal.sqlite");
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogRoot = path.join(sandboxRoot, "catalog");
  const repositoryCatalogHash = hashFiles(ROOT, REAL_CATALOG_FILES);
  let database;
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const creatorFiles = await load("functions/_lib/creator-files.mjs");
    const creatorOperations = await load("functions/_lib/creator-operations.mjs");
    const creatorPublication = await load("functions/_lib/creator-publication.mjs");
    const creatorReview = await load("functions/_lib/creator-review.mjs");
    const cartQuote = await load("functions/_lib/cart-quote.mjs");
    const ownerAuth = await load("functions/_lib/owner-auth.mjs");
    const publishIntake = require(path.join(ROOT, "scripts", "publish-intake.js"));

    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(database);
    await createCreator(database, accountAuth, CREATOR_A);
    await createCreator(database, accountAuth, CREATOR_B);

    const d1 = createD1(database);
    const bucket = createLocalBucket(storageRoot);
    copyCatalogFixture(catalogRoot);
    const dispatch = createSuccessfulDispatch();
    const ownerFixture = await createOwnerAuthFixture({
      ownerAuth,
      ownerId: OWNER_ID,
      nowMs: NOW_MS,
      sessionSecret: "mock-task7-owner-session-secret-32-bytes",
      csrfSecret: "mock-task7-owner-csrf-secret-32-bytes",
      origin: "http://127.0.0.1"
    });
    const environment = {
      TRG_ORDERS: d1,
      TRG_PRODUCTS: bucket,
      ...ownerFixture.environment,
      GITHUB_PUBLISH_REF: "staging",
      GITHUB_REPO_OWNER: "mock-owner",
      GITHUB_REPO_NAME: "mock-repository",
      GITHUB_TOKEN: "mock-task7-token"
    };
    const creatorOptions = {
      database: d1,
      nowMs: NOW_MS,
      dispatchOptions: {
        fetchImpl: dispatch.fetchImpl,
        pollIntervalMs: 1,
        timeoutMs: 100
      }
    };
    const ownerOptions = {
      database: d1,
      nowMs: NOW_MS,
      ...ownerFixture.options,
      dispatchOptions: creatorOptions.dispatchOptions
    };

    const withdrawn = await createSubmittedProduct({
      creator: CREATOR_A,
      slug: "mock-task7-withdrawn",
      title: "Mock Task 7 Withdrawn Submission",
      creatorFiles,
      creatorOperations,
      environment,
      creatorOptions,
      bucket
    });
    const withdrawnBefore = listingRecord(database, withdrawn.id);
    const withdrawnFileBefore = fileRecord(database, withdrawn.productFileId);
    const withdrawnPdfHash = sha256(bucket.read(withdrawnFileBefore.quarantine_key));

    let response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_B, `listings/${withdrawn.id}/withdraw`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 404);
    assert.deepEqual(listingRecord(database, withdrawn.id), withdrawnBefore);

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_A, `listings/${withdrawn.id}/withdraw`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: "draft" });
    const withdrawnAfter = listingRecord(database, withdrawn.id);
    assert.equal(withdrawnAfter.creator_id, CREATOR_A.id);
    assert.equal(withdrawnAfter.lifecycle_state, "draft");
    assert.equal(withdrawnAfter.publication_state, "not_approved");
    assert.equal(withdrawnAfter.submitted_at, withdrawnBefore.submitted_at);
    assert.equal(fileRecord(database, withdrawn.productFileId).id, withdrawn.productFileId);
    assert.equal(
      sha256(bucket.read(withdrawnFileBefore.quarantine_key)),
      withdrawnPdfHash
    );
    assertAudit(database, withdrawn.id, "creator", CREATOR_A.userId, "submission_withdrawn");
    assert.equal(catalogProduct(catalogRoot, withdrawn.slug), undefined);

    const creatorUnlisted = await createPublishedProduct({
      creator: CREATOR_A,
      slug: "mock-task7-creator-unlisted",
      title: "Mock Task 7 Creator Unlisted Product",
      creatorFiles,
      creatorOperations,
      creatorPublication,
      creatorReview,
      environment,
      creatorOptions,
      ownerFixture,
      ownerOptions,
      publishIntake,
      catalogRoot,
      dispatch,
      bucket
    });
    const ownerUnlisted = await createPublishedProduct({
      creator: CREATOR_A,
      slug: "mock-task7-owner-unlisted",
      title: "Mock Task 7 Owner Unlisted Product",
      creatorFiles,
      creatorOperations,
      creatorPublication,
      creatorReview,
      environment,
      creatorOptions,
      ownerFixture,
      ownerOptions,
      publishIntake,
      catalogRoot,
      dispatch,
      bucket
    });
    assert.equal(activeListingCount(database, CREATOR_A.id), 2);

    const entitlement = createHistoricalEntitlement(database, creatorUnlisted);
    const commerceBefore = commerceSnapshot(database);
    const creatorPublishedBefore = listingRecord(database, creatorUnlisted.id);
    const creatorPdfKey = fileRecord(
      database,
      creatorUnlisted.productFileId
    ).delivery_object_key;
    const creatorPdfHash = sha256(bucket.read(creatorPdfKey));

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_B, `listings/${creatorUnlisted.id}/pause`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 404);
    assert.equal(dispatch.countFor("creator_pause"), 0);
    assert.equal(
      listingRecord(database, creatorUnlisted.id).publication_state,
      "published"
    );

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_A, `listings/${creatorUnlisted.id}/pause`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "paused",
      pending: false
    });
    const creatorPausePayload = dispatch.latest();
    assert.equal(creatorPausePayload.operation, "creator_pause");
    assert.equal(creatorPausePayload.metadata.slug, creatorUnlisted.slug);
    assert.equal(creatorPausePayload.requested_by, CREATOR_A.userId);
    assert.equal(creatorPausePayload.ref, "staging");
    await publishIntake.applyPublishPayload(catalogRoot, creatorPausePayload);

    const creatorPaused = listingRecord(database, creatorUnlisted.id);
    assert.equal(creatorPaused.creator_id, CREATOR_A.id);
    assert.equal(creatorPaused.lifecycle_state, "paused");
    assert.equal(creatorPaused.publication_state, "paused");
    assert.equal(creatorPaused.public_product_slug, creatorPublishedBefore.public_product_slug);
    assert.equal(creatorPaused.first_published_at, creatorPublishedBefore.first_published_at);
    assert.equal(creatorPaused.published_at, creatorPublishedBefore.published_at);
    assert.equal(sha256(bucket.read(creatorPdfKey)), creatorPdfHash);
    assertAudit(database, creatorUnlisted.id, "creator", CREATOR_A.userId, "publication_paused");
    assert.equal(activeListingCount(database, CREATOR_A.id), 1);

    const inactiveCatalogProduct = catalogProduct(catalogRoot, creatorUnlisted.slug);
    assert.equal(inactiveCatalogProduct.status, "legacy-not-for-sale");
    assert.equal(inactiveCatalogProduct.buyMode, "retired");
    assert.equal(inactiveCatalogProduct.saleEnabled, false);
    response = await cartQuote.handleCartQuoteRequest(
      new Request("https://example.com/api/cart/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: creatorUnlisted.slug, quantity: 1 }] })
      }),
      { catalogProducts: [inactiveCatalogProduct], database: d1, now: NOW_MS }
    );
    assert.equal(response.status, 200);
    const quote = await response.json();
    assert.deepEqual(quote.items, []);
    assert.equal(quote.unavailableItems[0].code, "inactive_product");

    response = await creatorPublication.handleCreatorPublicationRequest(
      ownerFixture.jsonRequest("/owner/api/creator-publication", {
        action: "pause_publication",
        listingId: ownerUnlisted.id
      }),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: "paused",
      pending: false
    });
    const ownerPausePayload = dispatch.latest();
    assert.equal(ownerPausePayload.operation, "creator_pause");
    assert.equal(ownerPausePayload.metadata.slug, ownerUnlisted.slug);
    assert.equal(ownerPausePayload.requested_by, OWNER_ID);
    await publishIntake.applyPublishPayload(catalogRoot, ownerPausePayload);
    assert.equal(listingRecord(database, ownerUnlisted.id).publication_state, "paused");
    assertAudit(database, ownerUnlisted.id, "operator", OWNER_ID, "publication_paused");
    assert.equal(activeListingCount(database, CREATOR_A.id), 0);

    assert.deepEqual(commerceSnapshot(database), commerceBefore);
    const retainedEntitlement = database
      .prepare("SELECT * FROM download_entitlements WHERE id=?")
      .get(entitlement.entitlementId);
    assert.equal(retainedEntitlement.status, "active");
    assert.equal(retainedEntitlement.product_slug, creatorUnlisted.slug);
    assert.equal(
      database.prepare("SELECT payment_status FROM orders WHERE id=?").get(entitlement.orderId)
        .payment_status,
      "paid"
    );
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), repositoryCatalogHash);

    const listingIds = [withdrawn.id, creatorUnlisted.id, ownerUnlisted.id];
    cleanupDatabase(database, listingIds, entitlement.orderId);
    assert.equal(countFor(database, "creator_listings", "id", listingIds), 0);
    assert.equal(countFor(database, "creator_listing_files", "listing_id", listingIds), 0);
    assert.equal(countFor(database, "creator_publication_audit", "listing_id", listingIds), 0);
    assert.equal(countFor(database, "marketplace_creators", "id", [CREATOR_A.id, CREATOR_B.id]), 0);
    assert.equal(countFor(database, "users", "id", [CREATOR_A.userId, CREATOR_B.userId]), 0);
    assert.equal(
      Number(database.prepare("SELECT COUNT(*) count FROM orders WHERE id=?").get(entitlement.orderId).count),
      0
    );

    bucket.clear();
    assert.deepEqual(bucket.keys(), []);
    assert.equal(fs.existsSync(storageRoot), false);
    fs.rmSync(catalogRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(catalogRoot), false);
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), repositoryCatalogHash);

    database.close();
    database = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Creator product withdrawal and unlisting test passed.");
    console.log("Pending submission withdrawal: submitted -> draft (200)");
    console.log("Cross-Creator withdrawal attempt: rejected (404)");
    console.log("Cross-Creator unlisting attempt: rejected (404)");
    console.log("Creator unlisting: published -> paused and catalog retired (200)");
    console.log("Owner unlisting control: preserved and verified (200)");
    console.log("Active shelf slots after both unlistings: 0");
    console.log("Historical entitlement retained active: true");
    console.log("PDF hashes and product identities retained: true");
    console.log("Payment, refund, reversal, and royalty side effects: 0");
    console.log("Disposable database and storage records remaining: 0");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

async function createSubmittedProduct({
  creator,
  slug,
  title,
  creatorFiles,
  creatorOperations,
  environment,
  creatorOptions,
  bucket
}) {
  let response = await creatorOperations.handleCreatorRequest(
    creatorRequest(creator, "listings", {
      title,
      slug,
      shortDescription: "Disposable Task 7 withdrawal fixture.",
      longDescription: "This product exists only inside the Task 7 sandbox.",
      priceCents: 700,
      mediaType: "digital",
      format: ["PDF"],
      gameSystem: "System Neutral",
      genre: "test"
    }),
    environment,
    creatorOptions
  );
  assert.equal(response.status, 201);
  const id = (await response.json()).listing.id;
  response = await creatorFiles.handleCreatorFileUpload(
    creatorFileRequest(creator, id, "product", PDF_BYTES, `${slug}.pdf`, "application/pdf"),
    environment,
    id,
    creatorOptions
  );
  assert.equal(response.status, 201);
  const productFileId = (await response.json()).file.id;
  response = await creatorOperations.handleCreatorRequest(
    creatorRequest(creator, `listings/${id}/submit`, {
      rightsConfirmed: true,
      representationConfirmed: true,
      licensesConfirmed: true
    }),
    environment,
    creatorOptions
  );
  assert.equal(response.status, 200);
  assert.equal(listingRecordFromEnvironment(environment, id).lifecycle_state, "submitted");
  assert.ok(bucket.keys().some((key) => key.endsWith(`/${slug}.pdf`)));
  return { id, slug, title, productFileId };
}

async function createPublishedProduct(options) {
  const submitted = await createSubmittedProduct(options);
  let response = await options.creatorReview.handleCreatorReviewRequest(
    options.ownerFixture.jsonRequest("/owner/api/creator-reviews", {
      action: "approve",
      listingId: submitted.id,
      note: "Approved for the Task 7 disposable sandbox."
    }),
    options.environment,
    options.ownerOptions
  );
  assert.equal(response.status, 200);

  response = await options.creatorFiles.handleCreatorFileUpload(
    creatorFileRequest(
      options.creator,
      submitted.id,
      "cover",
      COVER_BYTES,
      `${submitted.slug}.webp`,
      "image/webp"
    ),
    options.environment,
    submitted.id,
    options.creatorOptions
  );
  assert.equal(response.status, 201);
  const coverFileId = (await response.json()).file.id;

  for (const fileId of [submitted.productFileId, coverFileId]) {
    response = await options.creatorPublication.handleCreatorPublicationRequest(
      options.ownerFixture.jsonRequest("/owner/api/creator-publication", {
        action: "accept_file",
        fileId
      }),
      options.environment,
      options.ownerOptions
    );
    assert.equal(response.status, 200);
  }

  response = await options.creatorPublication.handleCreatorPublicationRequest(
    options.ownerFixture.jsonRequest("/owner/api/creator-publication", {
      action: "publish",
      listingId: submitted.id
    }),
    options.environment,
    options.ownerOptions
  );
  assert.equal(response.status, 200);
  const publishPayload = options.dispatch.latest();
  assert.equal(publishPayload.operation, "creator_publication");
  await options.publishIntake.applyPublishPayload(options.catalogRoot, publishPayload);
  const listing = listingRecordFromEnvironment(options.environment, submitted.id);
  assert.equal(listing.lifecycle_state, "active");
  assert.equal(listing.publication_state, "published");
  assert.equal(catalogProduct(options.catalogRoot, submitted.slug).status, "available-direct");
  const productFile = fileRecordFromEnvironment(
    options.environment,
    submitted.productFileId
  );
  assert.equal(sha256(options.bucket.read(productFile.delivery_object_key)), sha256(PDF_BYTES));
  return { ...submitted, coverFileId };
}

async function createCreator(database, accountAuth, creator) {
  const email = `${creator.slug}@example.invalid`;
  database
    .prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)")
    .run(creator.userId, email, NOW, NOW);
  database
    .prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
    .run(
      `${creator.id}-session`,
      creator.userId,
      await accountAuth.hashToken(creator.session),
      await accountAuth.hashToken(creator.csrf),
      NOW,
      EXPIRES_AT,
      NOW
    );
  database
    .prepare(`INSERT INTO marketplace_creators(
      id,slug,display_name,short_bio,long_bio,profile_template,
      marketplace_status,registration_status,registration_completed_at,
      intake_registration_completed_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,'catalog','approved','active',?,?,?,?)`)
    .run(
      creator.id,
      creator.slug,
      `Mock ${creator.slug}`,
      "Disposable Task 7 Creator.",
      "This Creator exists only inside the Task 7 sandbox.",
      NOW,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)")
    .run(creator.userId, creator.id, NOW);
  database
    .prepare(`INSERT INTO creator_identity_ownership(
      creator_id,owner_user_id,identity_type,account_status,billing_status,
      entitlement_source,created_at,updated_at
    ) VALUES(?,?,'primary','active','not_required','primary_free',?,?)`)
    .run(creator.id, creator.userId, NOW, NOW);
  database
    .prepare(`INSERT INTO user_account_profiles(
      user_id,legal_name,payment_method_status,payment_method_status_updated_at,
      created_at,updated_at
    ) VALUES(?,?,'ready',?,?,?)`)
    .run(creator.userId, `Mock ${creator.slug}`, NOW, NOW, NOW);
  database
    .prepare(`INSERT INTO creator_registration_details(
      creator_id,legal_name,business_name,business_type,country,state_region,
      address_line1,city,postal_code,contact_email,rights_confirmation_at,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      creator.id,
      `Mock ${creator.slug}`,
      "",
      "individual",
      "US",
      "NC",
      "7 Disposable Road",
      "Durham",
      "27701",
      email,
      NOW,
      NOW,
      NOW
    );
  database
    .prepare(`INSERT INTO creator_agreement_acceptances(
      creator_id,accepted_by_user_id,agreement_id,agreement_version,
      accepted_at,source_context
    ) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task7_sandbox')`)
    .run(creator.id, creator.userId, NOW);
  database
    .prepare(`INSERT INTO creator_payout_profiles(
      creator_id,provider,onboarding_status,payouts_enabled,
      verification_status,status_updated_at
    ) VALUES(?,'manual','complete',1,'verified',?)`)
    .run(creator.id, NOW);
}

function createHistoricalEntitlement(database, product) {
  const orderId = Number(
    database
      .prepare(`INSERT INTO orders(
        public_id,customer_email,customer_email_normalized,customer_email_hash,
        currency,subtotal_cents,total_cents,payment_status,fulfillment_status,
        email_status,created_at,paid_at
      ) VALUES('TRG-TASK7','buyer@example.invalid','buyer@example.invalid',
        'task7-hash','USD',700,700,'paid','ready','sent',?,?)`)
      .run(NOW, NOW).lastInsertRowid
  );
  const orderItemId = Number(
    database
      .prepare(`INSERT INTO order_items(
        order_id,product_slug,product_title_snapshot,primary_author_slug,
        author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,
        line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at
      ) VALUES(?,?,?,'mock-withdrawal-a','["mock-withdrawal-a"]',1,700,700,
        700,'USD','1.0','2026-10-19',?)`)
      .run(orderId, product.slug, product.title, NOW).lastInsertRowid
  );
  const entitlementId = Number(
    database
      .prepare(`INSERT INTO download_entitlements(
        order_id,order_item_id,product_slug,r2_object_key,customer_filename,
        content_type,object_size_bytes,status,created_at
      ) VALUES(?,?,?,?,?,'application/pdf',?,'active',?)`)
      .run(
        orderId,
        orderItemId,
        product.slug,
        `${product.slug}/product.pdf`,
        `${product.title}.pdf`,
        PDF_BYTES.byteLength,
        NOW
      ).lastInsertRowid
  );
  return { orderId, orderItemId, entitlementId };
}

function creatorRequest(creator, route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${creator.session}; trg_account_csrf=${creator.csrf}`,
      "x-csrf-token": creator.csrf,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function creatorFileRequest(creator, listingId, purpose, bytes, filename, contentType) {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([bytes], filename, { type: contentType }));
  return new Request(`https://example.com/api/creator/listings/${listingId}/files`, {
    method: "POST",
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${creator.session}; trg_account_csrf=${creator.csrf}`,
      "x-csrf-token": creator.csrf
    },
    body: form
  });
}

function createSuccessfulDispatch() {
  const payloads = [];
  return {
    countFor(operation) {
      return payloads.filter((payload) => payload.operation === operation).length;
    },
    latest() {
      return payloads.at(-1);
    },
    async fetchImpl(url, init = {}) {
      if (String(url).endsWith("/dispatches")) {
        payloads.push(JSON.parse(init.body).client_payload);
        return new Response(null, { status: 204 });
      }
      const current = payloads.at(-1);
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: `task7-${payloads.length}`,
              html_url: `https://example.invalid/actions/runs/task7-${payloads.length}`,
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

function assertAudit(database, listingId, actorType, actorId, action) {
  const row = database
    .prepare(`SELECT * FROM creator_publication_audit
      WHERE listing_id=? AND actor_type=? AND actor_id=? AND action=?`)
    .get(listingId, actorType, actorId, action);
  assert.ok(row, `${action} audit must identify ${actorType} ${actorId}`);
  assert.ok(row.created_at);
}

function commerceSnapshot(database) {
  return {
    orders: countAll(database, "orders"),
    orderItems: countAll(database, "order_items"),
    entitlements: countAll(database, "download_entitlements"),
    earnings: countAll(database, "creator_earnings_ledger"),
    reversals: countAll(database, "creator_reversal_snapshots"),
    refundChoices: countAll(database, "customer_refund_choices"),
    serviceRefunds: countAll(database, "creator_service_refund_corrections")
  };
}

function cleanupDatabase(database, listingIds, orderId) {
  const listingMarks = listingIds.map(() => "?").join(",");
  const creatorIds = [CREATOR_A.id, CREATOR_B.id];
  const creatorMarks = creatorIds.map(() => "?").join(",");
  const userIds = [CREATOR_A.userId, CREATOR_B.userId];
  database.exec("BEGIN;");
  try {
    database.prepare("DELETE FROM download_entitlements WHERE order_id=?").run(orderId);
    database.prepare("DELETE FROM order_items WHERE order_id=?").run(orderId);
    database.prepare("DELETE FROM orders WHERE id=?").run(orderId);
    for (const table of [
      "creator_review_audit",
      "creator_listing_declarations",
      "creator_publication_audit",
      "creator_listing_files"
    ]) {
      database
        .prepare(`DELETE FROM ${table} WHERE listing_id IN (${listingMarks})`)
        .run(...listingIds);
    }
    database
      .prepare(`DELETE FROM creator_listings WHERE id IN (${listingMarks})`)
      .run(...listingIds);
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
      database
        .prepare(`DELETE FROM ${table} WHERE creator_id IN (${creatorMarks})`)
        .run(...creatorIds);
    }
    database
      .prepare(`DELETE FROM marketplace_creators WHERE id IN (${creatorMarks})`)
      .run(...creatorIds);
    database
      .prepare("DELETE FROM user_account_profiles WHERE user_id IN (?,?)")
      .run(...userIds);
    database.prepare("DELETE FROM sessions WHERE user_id IN (?,?)").run(...userIds);
    database.prepare("DELETE FROM users WHERE id IN (?,?)").run(...userIds);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function listingRecord(database, listingId) {
  return database.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
}

function fileRecord(database, fileId) {
  return database.prepare("SELECT * FROM creator_listing_files WHERE id=?").get(fileId);
}

function listingRecordFromEnvironment(environment, listingId) {
  return environment.TRG_ORDERS.raw
    .prepare("SELECT * FROM creator_listings WHERE id=?")
    .get(listingId);
}

function fileRecordFromEnvironment(environment, fileId) {
  return environment.TRG_ORDERS.raw
    .prepare("SELECT * FROM creator_listing_files WHERE id=?")
    .get(fileId);
}

function activeListingCount(database, creatorId) {
  return Number(
    database
      .prepare("SELECT COUNT(*) count FROM creator_listings WHERE creator_id=? AND publication_state='published'")
      .get(creatorId).count
  );
}

function catalogProduct(catalogRoot, slug) {
  return readJson(path.join(catalogRoot, "data", "products.json")).find(
    (product) => product.slug === slug
  );
}

function countFor(database, table, column, values) {
  const marks = values.map(() => "?").join(",");
  return Number(
    database
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column} IN (${marks})`)
      .get(...values).count
  );
}

function countAll(database, table) {
  return Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
}

function applyMigrations(database) {
  for (const migration of fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8"));
  }
}

function createD1(database) {
  const d1 = {
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
  return d1;
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
  assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`));
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

function copyCatalogFixture(catalogRoot) {
  for (const relativePath of REAL_CATALOG_FILES) {
    const target = path.join(catalogRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relativePath), target);
  }
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
    `${pathToFileURL(path.join(ROOT, relativePath)).href}?task7=${Math.random()}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
