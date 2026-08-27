const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2028-09-01T12:00:00Z");

async function main() {
  const registration = await load("functions/_lib/creator-registration.mjs");
  const profile = await load("functions/_lib/account-profile.mjs");
  const operations = await load("functions/_lib/creator-operations.mjs");
  const files = await load("functions/_lib/creator-files.mjs");
  const auth = await load("functions/_lib/account-auth.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of migrations()) raw.exec(readMigration(name));
  const db = d1(raw);
  const now = new Date(NOW).toISOString();
  insertUser(raw, "seller", "seller@trg.test", now);
  insertUser(raw, "owner", "owner@trg.test", now, "owner");
  raw
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('owner','creator-rv-sawyer','manager',?)",
    )
    .run(now);
  raw
    .prepare(
      "INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES('creator-rv-sawyer','owner','primary','active','legacy_grandfathered','legacy_grandfathered',?,?)",
    )
    .run(now, now);
  raw
    .prepare(
      "UPDATE marketplace_creators SET registration_status='active',registration_completed_at=?,intake_registration_completed_at=? WHERE id='creator-rv-sawyer'",
    )
    .run(now, now);

  const creator = await registration.registerPrimaryCreator(db, {
    userId: "seller",
    email: "seller@trg.test",
    body: registrationBody(),
    nowMs: NOW,
  });
  assert.equal(creator.registrationStatus, "incomplete");
  raw
    .prepare(
      "UPDATE marketplace_creators SET registration_completed_at=? WHERE id=?",
    )
    .run(now, creator.creatorId);
  const sellerSession = await session(raw, auth, "seller", "seller-token", now);

  let response = await creatorRequest(
    operations,
    db,
    sellerSession,
    "overview",
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).intakeAccess, false);

  response = await creatorRequest(operations, db, sellerSession, "listings");
  assert.equal(response.status, 403, "Direct listing access must be gated.");
  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "Free Draft",
    priceCents: 0,
    pricingModel: "free",
  });
  assert.equal(response.status, 403, "Free draft creation must be gated.");
  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "PWYW Draft",
    priceCents: 0,
    pricingModel: "pwyw",
  });
  assert.equal(response.status, 403, "PWYW draft creation must be gated.");

  raw
    .prepare(
      "INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,pricing_model,listed_price_cents,created_at,updated_at) VALUES('blocked-upload',?,'blocked-upload','Blocked Upload','draft','not_approved','free',0,?,?)",
    )
    .run(creator.creatorId, now, now);
  const bucket = {
    puts: 0,
    async put() {
      this.puts += 1;
    },
  };
  const upload = new FormData();
  upload.set("purpose", "product");
  upload.set(
    "file",
    new File(["%PDF-1.7\n"], "game.pdf", { type: "application/pdf" }),
  );
  response = await files.handleCreatorFileUpload(
    verifiedRequest(
      "/api/creator/listings/blocked-upload/files",
      sellerSession,
      {
        method: "POST",
        body: upload,
      },
    ),
    { TRG_ORDERS: db, TRG_PRODUCTS: bucket },
    "blocked-upload",
    { database: db, nowMs: NOW },
  );
  assert.equal(response.status, 403);
  assert.equal(bucket.puts, 0);

  let readiness = await registration.getCreatorAccountReadiness(
    db,
    creator.creatorId,
  );
  assert.equal(readiness.checks.paymentMethodReady, false);
  assert.equal(readiness.checks.payoutReady, false);
  await profile.recordPaymentMethodReadiness(db, {
    userId: "seller",
    stripeCustomerReference: "cus_ready",
    paymentMethodReference: "pm_ready",
    status: "ready",
    nowMs: NOW,
  });
  response = await creatorRequest(operations, db, sellerSession, "listings");
  assert.equal(
    response.status,
    403,
    "Missing Connect readiness must block intake.",
  );

  raw
    .prepare(
      "UPDATE creator_payout_profiles SET onboarding_status='complete',verification_status='verified',payouts_enabled=1 WHERE creator_id=?",
    )
    .run(creator.creatorId);
  raw
    .prepare(
      "UPDATE creator_agreement_acceptances SET superseded_at=? WHERE creator_id=?",
    )
    .run(now, creator.creatorId);
  response = await creatorRequest(operations, db, sellerSession, "listings");
  assert.equal(
    response.status,
    403,
    "Missing current agreement must block intake.",
  );
  await registration.acceptCreatorAgreement(db, {
    creatorId: creator.creatorId,
    userId: "seller",
    sourceContext: "registration_completion",
    nowMs: NOW + 1,
  });

  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "Eligible Free Draft",
    priceCents: 0,
    pricingModel: "free",
  });
  assert.equal(response.status, 201);
  assert.ok(
    raw
      .prepare(
        "SELECT registration_completed_at FROM marketplace_creators WHERE id=?",
      )
      .get(creator.creatorId).registration_completed_at,
  );

  raw
    .prepare(
      "UPDATE creator_identity_ownership SET account_status='restricted' WHERE creator_id=?",
    )
    .run(creator.creatorId);
  raw
    .prepare(
      "UPDATE marketplace_creators SET registration_status='restricted' WHERE id=?",
    )
    .run(creator.creatorId);
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='restricted' WHERE creator_id=?",
    )
    .run(creator.creatorId);
  response = await creatorRequest(operations, db, sellerSession, "listings");
  assert.equal(
    response.status,
    200,
    "A later audit restriction must retain listing history access.",
  );

  const ownerSession = await session(raw, auth, "owner", "owner-token", now);
  response = await creatorRequest(operations, db, ownerSession, "listings");
  assert.equal(
    response.status,
    200,
    "The grandfathered RV Sawyer Creator must remain usable.",
  );

  const dashboard = fs.readFileSync(
    path.join(ROOT, "assets/js/creator-dashboard.js"),
    "utf8",
  );
  assert.match(dashboard, /if \(!summary\.intakeAccess\) return;/);
  assert.ok(
    dashboard.indexOf("if (!summary.intakeAccess) return;") <
      dashboard.indexOf('api("listings")'),
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, "creator/index.html"), "utf8"),
    /id="creator-listings" hidden/,
  );
  console.log("Registration hard-gate tests passed.");
}

async function creatorRequest(module, db, sessionData, route, body) {
  return module.handleCreatorRequest(
    verifiedRequest(`/api/creator/${route}`, sessionData, {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      json: Boolean(body),
    }),
    { TRG_ORDERS: db },
    { database: db, nowMs: NOW },
  );
}
function verifiedRequest(
  route,
  sessionData,
  { method = "GET", body, json = false } = {},
) {
  const headers = {
    cookie: `__Host-trg_session=${sessionData.token}; trg_account_csrf=csrf`,
    origin: "https://trg.test",
  };
  if (method !== "GET") headers["x-csrf-token"] = "csrf";
  if (json) headers["content-type"] = "application/json";
  return new Request(`https://trg.test${route}`, { method, headers, body });
}
async function session(raw, auth, userId, token, now) {
  raw
    .prepare(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      `${userId}-session`,
      userId,
      await auth.hashToken(token),
      await auth.hashToken("csrf"),
      now,
      "2029-09-01T00:00:00.000Z",
      now,
    );
  return { token };
}
function registrationBody() {
  return {
    creatorName: "Seller Studio",
    slug: "seller-studio",
    shortBio: "Independent tabletop work.",
    legalName: "Seller Person",
    businessName: "Seller Studio LLC",
    businessType: "llc",
    country: "US",
    stateRegion: "NC",
    addressLine1: "1 Main St",
    city: "Raleigh",
    postalCode: "27601",
    contactEmail: "seller@trg.test",
    acceptAgreement: true,
    confirmRights: true,
  };
}
function insertUser(raw, id, email, now, role = "user") {
  raw
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)",
    )
    .run(id, email, role, now, now);
}
function readMigration(name) {
  return fs.readFileSync(path.join(ROOT, "migrations", name), "utf8");
}
function load(name) {
  return import(
    pathToFileURL(path.join(ROOT, name)).href + `?gate=${Math.random()}`
  );
}
function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        first: async () => raw.prepare(sql).get(...values) || null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }),
        run: async () => {
          const result = raw.prepare(sql).run(...values);
          return {
            meta: { changes: Number(result.changes) },
            changes: Number(result.changes),
          };
        },
      };
    },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
function migrations() {
  return [
    "001_direct_storefront.sql",
    "003_checkout_attempt_idempotency.sql",
    "004_verified_stripe_webhooks.sql",
    "005_secure_download_entitlements.sql",
    "006_customer_delivery_owner_controls.sql",
    "007_shared_accounts.sql",
    "016_order_account_ownership.sql",
    "017_historical_order_claims.sql",
    "018_creator_operations.sql",
    "019_creator_publication_pipeline.sql",
    "020_creator_financial_accounting.sql",
    "021_provider_finance_and_payout_readiness.sql",
    "022_connect_sandbox_and_payout_batches.sql",
    "023_marketplace_policy_alignment.sql",
    "024_product_inactivity_lifecycle.sql",
    "025_creator_advertising.sql",
    "026_account_creator_registration.sql",
    "027_creator_audits_reporting.sql",
    "028_creator_intake_registration_gate.sql",
  ];
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
