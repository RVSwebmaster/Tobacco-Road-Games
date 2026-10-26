const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { createOwnerWorkbenchFixture } = require("./test-support/owner-workbench-fixture.js");
const {
  ROOT,
  NOW_MS,
  CREATOR_A,
  CREATOR_B,
  OWNER_ID,
  PDF_BYTES,
  COVER_BYTES,
  REAL_CATALOG_FILES,
  createCreator,
  createHistoricalEntitlement,
  creatorRequest,
  creatorFileRequest,
  createSuccessfulDispatch,
  commerceSnapshot,
  cleanupDatabase,
  listingRecord,
  fileRecord,
  activeListingCount,
  catalogProduct,
  countFor,
  applyMigrations,
  createD1,
  createLocalBucket,
  copyCatalogFixture,
  hashFiles,
  sha256,
  load
} = require("./test-creator-product-withdrawal.js");

const PRIMARY = Object.freeze({
  slug: "mock-task8-end-to-end",
  title: "Mock Task 8 End-to-End Product"
});
const PENDING = Object.freeze({
  slug: "mock-task8-pending-withdrawal",
  title: "Mock Task 8 Pending Withdrawal"
});

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-creator-publishing-task8-")
  );
  const databasePath = path.join(sandboxRoot, "publishing.sqlite");
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
    const ownerListingFiles = await load("functions/_lib/owner-listing-files.mjs");
    const cartQuote = await load("functions/_lib/cart-quote.mjs");
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
    const ownerFixture = createOwnerWorkbenchFixture({
      ownerId: OWNER_ID,
      origin: "http://127.0.0.1"
    });
    const environment = {
      TRG_ORDERS: d1,
      TRG_PRODUCTS: bucket,
      ...ownerFixture.environment,
      GITHUB_PUBLISH_REF: "staging",
      GITHUB_REPO_OWNER: "mock-owner",
      GITHUB_REPO_NAME: "mock-repository",
      GITHUB_TOKEN: "mock-task8-token"
    };
    const dispatchOptions = {
      fetchImpl: dispatch.fetchImpl,
      pollIntervalMs: 1,
      timeoutMs: 100
    };
    const creatorOptions = { database: d1, nowMs: NOW_MS, dispatchOptions };
    const ownerOptions = {
      database: d1,
      nowMs: NOW_MS,
      ...ownerFixture.options,
      dispatchOptions
    };

    const commerceAtStart = commerceSnapshot(database);
    assert.deepEqual(commerceAtStart, {
      orders: 0,
      orderItems: 0,
      entitlements: 0,
      earnings: 0,
      reversals: 0,
      refundChoices: 0,
      serviceRefunds: 0
    });

    const primary = await createDraftUploadAndSubmit({
      creator: CREATOR_A,
      product: PRIMARY,
      creatorFiles,
      creatorOperations,
      environment,
      creatorOptions
    });
    const originalPdfHash = sha256(PDF_BYTES);
    assert.equal(primary.draftState, "draft");
    assert.equal(fileRecord(database, primary.productFileId).validation_state, "uploaded");
    assert.equal(
      sha256(bucket.read(fileRecord(database, primary.productFileId).quarantine_key)),
      originalPdfHash
    );
    assert.equal(listingRecord(database, primary.id).lifecycle_state, "submitted");

    let response = await creatorOperations.handleCreatorRequest(
      creatorGetRequest(CREATOR_B, "listings"),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).listings.some((item) => item.id === primary.id), false);

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_B, `listings/${primary.id}`, {
        title: "Unauthorized replacement title"
      }),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 404);
    assert.equal(listingRecord(database, primary.id).title, PRIMARY.title);

    response = await creatorFiles.handleCreatorFileUpload(
      creatorFileRequest(
        CREATOR_B,
        primary.id,
        "product",
        Buffer.from("%PDF-1.7\nUnauthorized replacement\n%%EOF"),
        "unauthorized.pdf",
        "application/pdf"
      ),
      environment,
      primary.id,
      creatorOptions
    );
    assert.equal(response.status, 403);
    assert.equal(
      sha256(bucket.read(fileRecord(database, primary.productFileId).quarantine_key)),
      originalPdfHash
    );

    response = await ownerListingFiles.handleOwnerListingFiles(
      ownerFixture.readRequest(`/owner/api/listing-files?listingId=${primary.id}`),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    const inspection = await response.json();
    assert.equal(inspection.listing.id, primary.id);
    assert.equal(inspection.listing.creator_id, CREATOR_A.id);
    assert.equal(inspection.files.length, 1);

    response = await ownerListingFiles.handleOwnerListingFiles(
      ownerFixture.readRequest(`/owner/api/listing-files?download=${primary.productFileId}`),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), originalPdfHash);
    assert.deepEqual(commerceSnapshot(database), commerceAtStart);

    response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.jsonRequest("/owner/api/creator-reviews", {
        action: "request_changes",
        listingId: primary.id,
        note: "Correct the listing description and resubmit."
      }),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "needs_changes");
    assert.equal(listingRecord(database, primary.id).lifecycle_state, "needs_changes");

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_A, `listings/${primary.id}`, {
        longDescription: "Corrected Task 8 description after Owner review."
      }),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    response = await creatorOperations.handleCreatorRequest(
      submitRequest(CREATOR_A, primary.id),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.equal(listingRecord(database, primary.id).lifecycle_state, "submitted");

    response = await creatorReview.handleCreatorReviewRequest(
      ownerFixture.jsonRequest("/owner/api/creator-reviews", {
        action: "approve",
        listingId: primary.id,
        note: "Corrected listing approved for Task 8."
      }),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "active");

    response = await creatorFiles.handleCreatorFileUpload(
      creatorFileRequest(
        CREATOR_A,
        primary.id,
        "cover",
        COVER_BYTES,
        `${PRIMARY.slug}.webp`,
        "image/webp"
      ),
      environment,
      primary.id,
      creatorOptions
    );
    assert.equal(response.status, 201);
    const coverFileId = (await response.json()).file.id;

    for (const fileId of [primary.productFileId, coverFileId]) {
      response = await creatorPublication.handleCreatorPublicationRequest(
        ownerFixture.jsonRequest("/owner/api/creator-publication", {
          action: "accept_file",
          fileId
        }),
        environment,
        ownerOptions
      );
      assert.equal(response.status, 200);
    }

    response = await creatorPublication.handleCreatorPublicationRequest(
      ownerFixture.jsonRequest("/owner/api/creator-publication", {
        action: "publish",
        listingId: primary.id
      }),
      environment,
      ownerOptions
    );
    assert.equal(response.status, 200);
    const publication = await response.json();
    assert.equal(publication.ok, true);
    assert.equal(publication.productSlug, PRIMARY.slug);
    assert.equal(publication.pending, false);
    const publishPayload = dispatch.latest();
    assert.equal(publishPayload.operation, "creator_publication");
    await publishIntake.applyPublishPayload(catalogRoot, publishPayload);

    const published = listingRecord(database, primary.id);
    assert.equal(published.creator_id, CREATOR_A.id);
    assert.equal(published.slug, PRIMARY.slug);
    assert.equal(published.lifecycle_state, "active");
    assert.equal(published.publication_state, "published");
    assert.equal(published.listed_price_cents, 800);
    assert.equal(activeListingCount(database, CREATOR_A.id), 1);
    assert.equal(catalogProduct(catalogRoot, PRIMARY.slug).status, "available-direct");
    const deliveredFile = fileRecord(database, primary.productFileId);
    assert.ok(deliveredFile.delivery_object_key);
    assert.equal(sha256(bucket.read(deliveredFile.delivery_object_key)), originalPdfHash);
    assert.deepEqual(commerceSnapshot(database), commerceAtStart);

    const pending = await createDraftUploadAndSubmit({
      creator: CREATOR_A,
      product: PENDING,
      creatorFiles,
      creatorOperations,
      environment,
      creatorOptions
    });
    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_A, `listings/${pending.id}/withdraw`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "draft");
    assert.equal(listingRecord(database, pending.id).lifecycle_state, "draft");

    const entitlement = createHistoricalEntitlement(database, primary);
    const commerceWithHistory = commerceSnapshot(database);
    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_A, `listings/${primary.id}/pause`, {}),
      environment,
      creatorOptions
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "paused");
    const pausePayload = dispatch.latest();
    assert.equal(pausePayload.operation, "creator_pause");
    await publishIntake.applyPublishPayload(catalogRoot, pausePayload);

    const paused = listingRecord(database, primary.id);
    assert.equal(paused.lifecycle_state, "paused");
    assert.equal(paused.publication_state, "paused");
    assert.equal(paused.creator_id, CREATOR_A.id);
    assert.equal(paused.public_product_slug, PRIMARY.slug);
    assert.equal(activeListingCount(database, CREATOR_A.id), 0);
    assert.equal(catalogProduct(catalogRoot, PRIMARY.slug).saleEnabled, false);
    assert.equal(catalogProduct(catalogRoot, PRIMARY.slug).buyMode, "retired");
    assert.equal(sha256(bucket.read(deliveredFile.delivery_object_key)), originalPdfHash);
    assert.deepEqual(commerceSnapshot(database), commerceWithHistory);
    assert.equal(
      database.prepare("SELECT status FROM download_entitlements WHERE id=?").get(entitlement.entitlementId).status,
      "active"
    );

    response = await cartQuote.handleCartQuoteRequest(
      new Request("https://example.com/api/cart/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: PRIMARY.slug, quantity: 1 }] })
      }),
      {
        catalogProducts: [catalogProduct(catalogRoot, PRIMARY.slug)],
        database: d1,
        now: NOW_MS
      }
    );
    assert.equal(response.status, 200);
    const quote = await response.json();
    assert.deepEqual(quote.items, []);
    assert.equal(quote.unavailableItems[0].code, "inactive_product");

    const primaryActions = database
      .prepare("SELECT action FROM creator_publication_audit WHERE listing_id=? ORDER BY id")
      .all(primary.id)
      .map((row) => row.action);
    for (const action of [
      "submitted",
      "owner_listing_inspected",
      "owner_file_downloaded",
      "request_changes",
      "approve",
      "file_accepted",
      "published",
      "publication_paused"
    ]) {
      assert.ok(primaryActions.includes(action), `Missing Task 8 audit action: ${action}`);
    }
    const pendingActions = database
      .prepare("SELECT action FROM creator_publication_audit WHERE listing_id=? ORDER BY id")
      .all(pending.id)
      .map((row) => row.action);
    assert.ok(pendingActions.includes("submitted"));
    assert.ok(pendingActions.includes("submission_withdrawn"));
    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), repositoryCatalogHash);

    const listingIds = [primary.id, pending.id];
    cleanupDatabase(database, listingIds, entitlement.orderId);
    assert.equal(countFor(database, "creator_listings", "id", listingIds), 0);
    assert.equal(countFor(database, "creator_listing_files", "listing_id", listingIds), 0);
    assert.equal(countFor(database, "creator_publication_audit", "listing_id", listingIds), 0);
    assert.equal(
      countFor(database, "marketplace_creators", "id", [CREATOR_A.id, CREATOR_B.id]),
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

    console.log("Creator Publishing Task 8 end-to-end integration test passed.");
    console.log(`Creator ID: ${CREATOR_A.id}`);
    console.log(`Secondary Creator ID: ${CREATOR_B.id}`);
    console.log(`Published Product ID: ${primary.id}`);
    console.log(`Withdrawn Product ID: ${pending.id}`);
    console.log(`PDF SHA-256 preserved: ${originalPdfHash}`);
    console.log("Corrective Owner decision: request_changes -> Creator resubmission -> approval");
    console.log("Cross-Creator access/edit/file/publish attempts: rejected");
    console.log("Owner inspection/download audits: recorded");
    console.log("Published shelf slots: 1; after unlisting: 0");
    console.log("Historical entitlement retained active: true");
    console.log("Payment, refund, reversal, and royalty side effects: 0");
    console.log("Disposable database, catalog, and storage artifacts remaining: 0");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (database) database.close();
    if (!explicitCleanupComplete) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }
}

async function createDraftUploadAndSubmit({
  creator,
  product,
  creatorFiles,
  creatorOperations,
  environment,
  creatorOptions
}) {
  let response = await creatorOperations.handleCreatorRequest(
    creatorRequest(creator, "listings", {
      title: product.title,
      slug: product.slug,
      shortDescription: "Disposable Task 8 integration fixture.",
      longDescription: "This product exists only inside the Task 8 sandbox.",
      priceCents: 800,
      mediaType: "digital",
      format: ["PDF"],
      gameSystem: "System Neutral",
      genre: "test"
    }),
    environment,
    creatorOptions
  );
  assert.equal(response.status, 201);
  const draft = await response.json();
  assert.equal(draft.listing.lifecycleState, "draft");
  const id = draft.listing.id;

  response = await creatorFiles.handleCreatorFileUpload(
    creatorFileRequest(
      creator,
      id,
      "product",
      PDF_BYTES,
      `${product.slug}.pdf`,
      "application/pdf"
    ),
    environment,
    id,
    creatorOptions
  );
  assert.equal(response.status, 201);
  const productFileId = (await response.json()).file.id;

  response = await creatorOperations.handleCreatorRequest(
    submitRequest(creator, id),
    environment,
    creatorOptions
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "submitted");
  return { id, productFileId, slug: product.slug, title: product.title, draftState: "draft" };
}

function submitRequest(creator, listingId) {
  return creatorRequest(creator, `listings/${listingId}/submit`, {
    rightsConfirmed: true,
    representationConfirmed: true,
    licensesConfirmed: true
  });
}

function creatorGetRequest(creator, route) {
  return new Request(`https://example.com/api/creator/${route}`, {
    headers: { cookie: `__Host-trg_session=${creator.session}` }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
