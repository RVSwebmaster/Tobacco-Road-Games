const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const {
  ROOT,
  CREATOR_A,
  CREATOR_B,
  REAL_CATALOG_FILES,
  createCreator,
  creatorRequest,
  createD1,
  createLocalBucket,
  copyCatalogFixture,
  hashFiles,
  applyMigrations,
  load
} = require("./test-creator-product-withdrawal.js");
const { createOwnerWorkbenchFixture } = require("./test-support/owner-workbench-fixture.js");

const NOW_MS = Date.parse("2025-03-01T12:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const DAY = 86400000;
const PDF_BYTES = Buffer.from("%PDF-1.7\nShelf expiration fixture\n%%EOF");
const OWNER_ID = "owner-open-workbench";

async function main() {
  const sandboxRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "trg-shelf-expiration-task1-")
  );
  const storageRoot = path.join(sandboxRoot, "storage");
  const catalogRoot = path.join(sandboxRoot, "catalog");
  const repositoryCatalogHash = hashFiles(ROOT, REAL_CATALOG_FILES);
  let raw;
  let explicitCleanupComplete = false;

  try {
    const accountAuth = await load("functions/_lib/account-auth.mjs");
    const inactivity = await load("functions/_lib/product-inactivity.mjs");
    const creatorOperations = await load("functions/_lib/creator-operations.mjs");
    const creatorPublication = await load("functions/_lib/creator-publication.mjs");
    const creatorFinanceOwner = await load("functions/_lib/creator-finance-owner.mjs");
    const cartQuote = await load("functions/_lib/cart-quote.mjs");
    const publishIntake = require(path.join(ROOT, "scripts", "publish-intake.js"));

    raw = new DatabaseSync(path.join(sandboxRoot, "expiration.sqlite"));
    raw.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(raw);
    await createCreator(raw, accountAuth, CREATOR_A);
    await createCreator(raw, accountAuth, CREATOR_B);
    raw.prepare(
      `INSERT INTO creator_badge_awards(
        id,creator_id,badge_id,source,source_notes,awarded_at,awarded_by,created_at
      ) VALUES('task1-founder-award',?,'founding-creator','founding_window','',?,'owner',?)`
    ).run(CREATOR_A.id, NOW, NOW);

    const db = createD1(raw);
    const bucket = createLocalBucket(storageRoot);
    copyCatalogFixture(catalogRoot);
    const dispatch = createDispatch();
    const ownerFixture = createOwnerWorkbenchFixture({ ownerId: OWNER_ID });
    const environment = {
      TRG_ORDERS: db,
      TRG_PRODUCTS: bucket,
      GITHUB_PUBLISH_REF: "staging",
      GITHUB_REPO_OWNER: "mock-owner",
      GITHUB_REPO_NAME: "mock-repository",
      GITHUB_TOKEN: "mock-task1-token",
      ...ownerFixture.environment
    };
    const dispatchOptions = {
      fetchImpl: dispatch.fetchImpl,
      pollIntervalMs: 1,
      timeoutMs: 100
    };

    const fixtures = [
      ["founder-old", CREATOR_A.id, "fixed", "2023-01-01T12:00:00.000Z"],
      ["rv-sawyer-old", inactivity.RV_SAWYER_CREATOR_ID, "fixed", "2023-01-01T12:00:00.000Z"],
      ["trg-house-old", CREATOR_B.id, "fixed", "2023-01-01T12:00:00.000Z"],
      ["before-anniversary", CREATOR_B.id, "fixed", "2024-03-02T12:00:00.000Z"],
      ["publication-after-sale", CREATOR_B.id, "fixed", "2024-03-02T12:00:00.000Z"],
      ["at-anniversary", CREATOR_B.id, "fixed", "2024-03-01T12:00:00.000Z"],
      ["expire-after-grace", CREATOR_B.id, "fixed", "2023-03-01T12:00:00.000Z"],
      ["paid-restart", CREATOR_B.id, "fixed", "2023-01-01T12:00:00.000Z"],
      ["warning-paid", CREATOR_B.id, "fixed", "2023-01-01T12:00:00.000Z"],
      ["free-acquisition", CREATOR_B.id, "free", "2024-03-01T12:00:00.000Z"],
      ["fixed-zero-acquisition", CREATOR_B.id, "fixed", "2024-03-01T12:00:00.000Z"],
      ["pwyw-zero", CREATOR_B.id, "pwyw", "2024-03-01T12:00:00.000Z"],
      ["pwyw-positive", CREATOR_B.id, "pwyw", "2023-01-01T12:00:00.000Z"],
      ["leap-anniversary", CREATOR_B.id, "fixed", "2024-02-29T12:00:00.000Z"],
      ["manual-unlist", CREATOR_B.id, "fixed", "2025-02-01T12:00:00.000Z"],
      ["owner-moderation", CREATOR_B.id, "fixed", "2025-02-01T12:00:00.000Z"]
    ];
    for (const fixture of fixtures) {
      await seedPublishedListing(raw, bucket, ...fixture);
    }
    addCatalogFixtures(catalogRoot, fixtures.map(([slug]) => slug));

    assert.equal(
      count(raw, "creator_listings", "inactivity_exemption_kind<>'none'"),
      0,
      "Migration 053 must not reclassify existing listings."
    );
    let response = await creatorFinanceOwner.handleCreatorFinanceOwnerRequest(
      ownerFixture.jsonRequest("/owner/api/creator-finance", {
        action: "set_inactivity_exemption",
        listingId: "trg-house-old",
        exemptionKind: "trg_house"
      }),
      environment,
      { database: db, nowMs: NOW_MS, ...ownerFixture.options }
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, {
      listingId: "trg-house-old",
      exemptionKind: "trg_house",
      changed: true
    });
    assert.equal(listing(raw, "trg-house-old").inactivity_exemption_kind, "trg_house");
    const classificationAudit = raw.prepare(
      "SELECT actor_type,actor_id,context_json FROM creator_publication_audit WHERE listing_id='trg-house-old' AND action='inactivity_exemption_changed'"
    ).get();
    assert.equal(classificationAudit.actor_type, "operator");
    assert.equal(classificationAudit.actor_id, OWNER_ID);
    assert.deepEqual(JSON.parse(classificationAudit.context_json), {
      previousKind: "none",
      exemptionKind: "trg_house"
    });

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_B, "listings/trg-house-old", {
        inactivityExemptionKind: "none"
      }),
      environment,
      { database: db, nowMs: NOW_MS }
    );
    assert.equal(response.status, 400);
    assert.equal(
      listing(raw, "trg-house-old").inactivity_exemption_kind,
      "trg_house",
      "Creator metadata changes must not alter the Owner-controlled classification."
    );

    assert.equal(
      inactivity.oneCalendarYearAfter("2024-02-29T12:00:00.000Z"),
      "2025-02-28T12:00:00.000Z"
    );

    let result = await runCheck(inactivity, db, {
      nowMs: Date.parse("2025-02-27T12:00:00.000Z"),
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.equal(state(raw, "leap-anniversary"), "active");

    result = await runCheck(inactivity, db, {
      nowMs: Date.parse("2025-02-28T12:00:00.000Z"),
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.equal(state(raw, "leap-anniversary"), "warning");
    assert.equal(result.founderExempt, 1);
    assert.equal(result.rvSawyerExempt, 1);
    assert.equal(result.houseExempt, 1);
    assert.equal(state(raw, "founder-old"), "active");
    assert.equal(state(raw, "rv-sawyer-old"), "active");
    assert.equal(state(raw, "trg-house-old"), "active");
    assert.equal(
      count(
        raw,
        "creator_lifecycle_notices",
        "listing_id IN ('founder-old','rv-sawyer-old','trg-house-old') AND notice_type IN ('inactivity_warning','warning_expiring','inactivated')"
      ),
      0
    );

    const paidRestartOrder = order(raw, "paid-restart", "2025-02-28T18:00:00.000Z", 500);
    const publicationAfterSaleOrder = order(raw, "publication-after-sale", "2024-03-01T12:00:00.000Z", 500);
    const pwywPaidOrder = order(raw, "pwyw-positive", "2025-02-28T19:00:00.000Z", 100);
    const freeOrder = order(raw, "free-acquisition", "2025-02-28T20:00:00.000Z", 0);
    const fixedZeroOrder = order(raw, "fixed-zero-acquisition", "2025-02-28T20:30:00.000Z", 0);
    const pwywZeroOrder = order(raw, "pwyw-zero", "2025-02-28T21:00:00.000Z", 0);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: paidRestartOrder, nowMs: NOW_MS })).qualifying, 1);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: publicationAfterSaleOrder, nowMs: NOW_MS })).qualifying, 1);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: pwywPaidOrder, nowMs: NOW_MS })).qualifying, 1);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: freeOrder, nowMs: NOW_MS })).qualifying, 0);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: fixedZeroOrder, nowMs: NOW_MS })).qualifying, 0);
    assert.equal((await inactivity.recordQualifyingActivity(db, { orderId: pwywZeroOrder, nowMs: NOW_MS })).qualifying, 0);

    const entitlement = historicalEntitlement(
      raw,
      "expire-after-grace",
      "2024-03-01T12:00:00.000Z"
    );

    result = await runCheck(inactivity, db, {
      nowMs: NOW_MS,
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.equal(state(raw, "before-anniversary"), "active");
    assert.equal(
      state(raw, "publication-after-sale"),
      "active",
      "First publication must control when it is later than the latest paid sale."
    );
    assert.equal(state(raw, "at-anniversary"), "warning");
    assert.equal(state(raw, "expire-after-grace"), "warning");
    assert.equal(state(raw, "paid-restart"), "active");
    assert.equal(state(raw, "pwyw-positive"), "active");
    assert.equal(state(raw, "free-acquisition"), "warning");
    assert.equal(state(raw, "fixed-zero-acquisition"), "warning");
    assert.equal(state(raw, "pwyw-zero"), "warning");
    assert.equal(activityType(raw, freeOrder), "free_acquisition");
    assert.equal(activityType(raw, fixedZeroOrder), "free_acquisition");
    assert.equal(activityType(raw, pwywZeroOrder), "pwyw_free");
    assert.equal(activityType(raw, pwywPaidOrder), "pwyw_paid");

    const warningNotices = count(raw, "creator_lifecycle_notices", "notice_type='inactivity_warning'");
    await runCheck(inactivity, db, {
      nowMs: NOW_MS,
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.equal(
      count(raw, "creator_lifecycle_notices", "notice_type='inactivity_warning'"),
      warningNotices
    );

    const warningPaidOrder = order(raw, "warning-paid", "2025-03-02T12:00:00.000Z", 500);
    await inactivity.recordQualifyingActivity(db, {
      orderId: warningPaidOrder,
      nowMs: NOW_MS + DAY
    });
    assert.equal(state(raw, "warning-paid"), "active");
    assert.equal(
      raw.prepare("SELECT inactivity_grace_ends_at value FROM creator_listings WHERE id='warning-paid'").get().value,
      null
    );

    response = await creatorOperations.handleCreatorRequest(
      creatorRequest(CREATOR_B, "listings/manual-unlist/pause", {}),
      environment,
      { database: db, nowMs: NOW_MS, dispatchOptions }
    );
    assert.equal(response.status, 200);
    await publishIntake.applyPublishPayload(catalogRoot, dispatch.latest());
    assert.equal(listing(raw, "manual-unlist").publication_state, "paused");
    assert.equal(catalogProduct(catalogRoot, "manual-unlist").saleEnabled, false);

    response = await creatorPublication.handleCreatorPublicationRequest(
      ownerFixture.jsonRequest("/owner/api/creator-publication", {
        action: "pause_publication",
        listingId: "owner-moderation"
      }),
      environment,
      {
        database: db,
        nowMs: NOW_MS,
        dispatchOptions,
        ...ownerFixture.options
      }
    );
    assert.equal(response.status, 200);
    await publishIntake.applyPublishPayload(catalogRoot, dispatch.latest());
    assert.equal(listing(raw, "owner-moderation").publication_state, "paused");
    assert.equal(catalogProduct(catalogRoot, "owner-moderation").saleEnabled, false);
    assert.equal(
      count(
        raw,
        "creator_publication_audit",
        `listing_id='owner-moderation' AND actor_type='operator' AND actor_id='${OWNER_ID}' AND action='publication_paused'`
      ),
      1
    );

    const expireAt = NOW_MS + 30 * DAY;
    result = await runCheck(inactivity, db, {
      nowMs: expireAt,
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.ok(result.inactivated >= 1);
    assert.equal(state(raw, "expire-after-grace"), "inactive");
    assert.equal(listing(raw, "expire-after-grace").publication_state, "paused");
    assert.equal(catalogProduct(catalogRoot, "expire-after-grace").saleEnabled, false);
    for (const exemptSlug of ["founder-old", "rv-sawyer-old", "trg-house-old"]) {
      assert.equal(state(raw, exemptSlug), "active");
      assert.equal(listing(raw, exemptSlug).publication_state, "published");
    }
    assert.equal(
      count(
        raw,
        "creator_lifecycle_notices",
        "listing_id IN ('founder-old','rv-sawyer-old','trg-house-old') AND notice_type IN ('inactivity_warning','warning_expiring','inactivated')"
      ),
      0
    );
    assert.equal(
      raw.prepare("SELECT status FROM download_entitlements WHERE id=?").get(entitlement).status,
      "active"
    );

    response = await cartQuote.handleCartQuoteRequest(
      new Request("https://example.com/api/cart/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "expire-after-grace", quantity: 1 }] })
      }),
      {
        catalogProducts: [catalogProduct(catalogRoot, "expire-after-grace")],
        database: db,
        now: expireAt
      }
    );
    const quote = await response.json();
    assert.deepEqual(quote.items, []);
    assert.equal(quote.unavailableItems[0].code, "inactive_product");

    const transitionAudits = count(
      raw,
      "creator_publication_audit",
      "listing_id='expire-after-grace' AND action='inactivity_transitioned'"
    );
    await runCheck(inactivity, db, {
      nowMs: expireAt,
      environment,
      dispatchOptions,
      catalogRoot,
      creatorPublication,
      publishIntake,
      dispatch
    });
    assert.equal(
      count(
        raw,
        "creator_publication_audit",
        "listing_id='expire-after-grace' AND action='inactivity_transitioned'"
      ),
      transitionAudits
    );

    for (const slug of ["pause-failure", "pause-pending"]) {
      await seedPublishedListing(
        raw,
        bucket,
        slug,
        CREATOR_B.id,
        "fixed",
        "2023-01-01T12:00:00.000Z"
      );
      raw.prepare(
        "UPDATE creator_listings SET inactivity_state='warning',inactivity_warning_started_at=?,inactivity_grace_ends_at=? WHERE id=?"
      ).run(new Date(NOW_MS - 31 * DAY).toISOString(), new Date(NOW_MS - DAY).toISOString(), slug);
    }
    addCatalogFixtures(catalogRoot, ["pause-failure", "pause-pending"]);
    const pauseCalls = { failure: 0, pending: 0 };
    const safetyOptions = {
      nowMs: NOW_MS,
      env: environment,
      getCatalogProduct: (slug) => catalogProduct(catalogRoot, slug),
      pausePublication: async ({ listing: item }) => {
        if (item.id === "pause-failure") {
          pauseCalls.failure += 1;
          return json({ error: "Synthetic catalog failure." }, 502);
        }
        pauseCalls.pending += 1;
        return json({ ok: true, pending: true, runUrl: "https://example.invalid/run" }, 202);
      }
    };
    result = await inactivity.runInactivityCheck(db, safetyOptions);
    assert.ok(result.errors.some((entry) => entry.listingId === "pause-failure"));
    assert.equal(state(raw, "pause-failure"), "warning");
    assert.equal(listing(raw, "pause-failure").publication_state, "published");
    assert.equal(state(raw, "pause-pending"), "warning");
    assert.equal(listing(raw, "pause-pending").publication_state, "publishing");
    await inactivity.runInactivityCheck(db, safetyOptions);
    assert.equal(pauseCalls.pending, 1);
    assert.equal(state(raw, "pause-pending"), "warning");

    assert.equal(hashFiles(ROOT, REAL_CATALOG_FILES), repositoryCatalogHash);
    raw.close();
    raw = null;
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(sandboxRoot), false);
    explicitCleanupComplete = true;

    console.log("Shelf expiration policy tests passed.");
    console.log("Founding Creator permanent exemption: verified");
    console.log("RV Sawyer canonical Creator exemption: verified");
    console.log("Owner-classified Tobacco Road Games house exemption: verified");
    console.log("Owner-only classification and publication audit: verified");
    console.log("Calendar-year and leap-day anniversaries: verified");
    console.log("30-day warning and grace period: verified");
    console.log("Paid and positive PWYW clock resets: verified");
    console.log("Free and zero-dollar PWYW statistics without clock reset: verified");
    console.log("Catalog pause, cart exclusion, and shelf-slot release: verified");
    console.log("Failed/pending pause operations remain unexpired and idempotent: verified");
    console.log("Historical entitlement and product records preserved: verified");
    console.log("Manual Creator unlisting remains operational: verified");
    console.log("Ordinary Owner moderation remains operational: verified");
    console.log("Disposable database, catalog, and storage removed: true");
    console.log("Repository catalog unchanged: true");
  } finally {
    if (raw) raw.close();
    if (!explicitCleanupComplete)
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

async function runCheck(
  inactivity,
  database,
  {
    nowMs,
    environment,
    dispatchOptions,
    catalogRoot,
    creatorPublication,
    publishIntake,
    dispatch
  }
) {
  return inactivity.runInactivityCheck(database, {
    nowMs,
    env: environment,
    dispatchOptions,
    getCatalogProduct: (slug) => catalogProduct(catalogRoot, slug),
    pausePublication: async (input) => {
      const response = await creatorPublication.pauseListingPublication(input);
      const outcome = await response.clone().json();
      if (response.ok && outcome.ok && !outcome.pending)
        await publishIntake.applyPublishPayload(catalogRoot, dispatch.latest());
      return response;
    }
  });
}

async function seedPublishedListing(raw, bucket, slug, creatorId, model, firstPublishedAt) {
  raw.prepare(
    `INSERT INTO creator_listings(
      id,creator_id,slug,source_product_slug,public_product_slug,title,
      lifecycle_state,publication_state,listed_price_cents,media_type,
      pricing_model,first_published_at,published_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,'active','published',500,'digital',?,?,?,?,?)`
  ).run(
    slug,
    creatorId,
    slug,
    slug,
    slug,
    `Fixture ${slug}`,
    model,
    firstPublishedAt,
    firstPublishedAt,
    firstPublishedAt,
    firstPublishedAt
  );
  const key = `${slug}/product.pdf`;
  raw.prepare(
    `INSERT INTO creator_listing_files(
      id,listing_id,creator_id,purpose,original_filename,normalized_filename,
      content_type,size_bytes,quarantine_key,validation_state,
      validation_message,delivery_object_key,uploaded_at,validated_at
    ) VALUES(?,?,?,'product',?,?,'application/pdf',?,?, 'accepted','',?,?,?)`
  ).run(
    `file-${slug}`,
    slug,
    creatorId,
    `${slug}.pdf`,
    `${slug}.pdf`,
    PDF_BYTES.byteLength,
    `quarantine/${slug}.pdf`,
    key,
    firstPublishedAt,
    firstPublishedAt
  );
  await bucket.put(key, PDF_BYTES);
}

function order(raw, slug, paidAt, amount) {
  const orderId = Number(
    raw.prepare(
      `INSERT INTO orders(
        public_id,customer_email,customer_email_normalized,customer_email_hash,
        currency,subtotal_cents,total_cents,payment_status,fulfillment_status,
        email_status,created_at,paid_at
      ) VALUES(?,?,?,?,'USD',?,?,'paid','ready','sent',?,?)`
    ).run(
      `TRG-${crypto.randomUUID()}`,
      "buyer@example.invalid",
      "buyer@example.invalid",
      crypto.randomUUID(),
      amount,
      amount,
      paidAt,
      paidAt
    ).lastInsertRowid
  );
  raw.prepare(
    `INSERT INTO order_items(
      order_id,product_slug,product_title_snapshot,primary_author_slug,
      author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,
      line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at
    ) VALUES(?,?,?,'fixture','["fixture"]',1,?,?,?,'USD','1','2025',?)`
  ).run(orderId, slug, `Fixture ${slug}`, amount, amount, amount, paidAt);
  return orderId;
}

function historicalEntitlement(raw, slug, paidAt) {
  const orderId = order(raw, slug, paidAt, 500);
  const itemId = raw.prepare("SELECT id FROM order_items WHERE order_id=?").get(orderId).id;
  return Number(
    raw.prepare(
      `INSERT INTO download_entitlements(
        order_id,order_item_id,product_slug,r2_object_key,customer_filename,
        content_type,object_size_bytes,status,created_at
      ) VALUES(?,?,?,?,?,'application/pdf',?,'active',?)`
    ).run(
      orderId,
      itemId,
      slug,
      `${slug}/product.pdf`,
      `${slug}.pdf`,
      PDF_BYTES.byteLength,
      paidAt
    ).lastInsertRowid
  );
}

function createDispatch() {
  const payloads = [];
  return {
    latest: () => payloads.at(-1),
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
              id: `shelf-${payloads.length}`,
              html_url: `https://example.invalid/runs/${payloads.length}`,
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

function addCatalogFixtures(catalogRoot, slugs) {
  const target = path.join(catalogRoot, "data", "products.json");
  const products = JSON.parse(fs.readFileSync(target, "utf8"));
  for (const slug of slugs) {
    if (products.some((product) => product.slug === slug)) continue;
    products.push({
      slug,
      title: `Fixture ${slug}`,
      status: "available-direct",
      statusLabel: "Available Direct",
      buyMode: "cart",
      saleEnabled: true,
      price: "5.00",
      priceCents: 500,
      currency: "USD"
    });
  }
  fs.writeFileSync(target, `${JSON.stringify(products, null, 2)}\n`);
}

function catalogProduct(catalogRoot, slug) {
  return JSON.parse(
    fs.readFileSync(path.join(catalogRoot, "data", "products.json"), "utf8")
  ).find((product) => product.slug === slug);
}

function listing(raw, slug) {
  return raw.prepare("SELECT * FROM creator_listings WHERE id=?").get(slug);
}

function state(raw, slug) {
  return listing(raw, slug).inactivity_state;
}

function activityType(raw, orderId) {
  return raw.prepare(
    "SELECT activity_type FROM creator_product_activity_events WHERE order_id=?"
  ).get(orderId).activity_type;
}

function count(raw, table, where = "1=1") {
  return Number(raw.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get().count);
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
