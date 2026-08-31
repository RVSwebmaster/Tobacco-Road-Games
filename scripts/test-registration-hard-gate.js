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
  assert.equal(operations.requiresCurrentEligibility("GET", "listings"), false);
  assert.equal(operations.requiresCurrentEligibility("POST", "profile"), false);
  assert.equal(
    operations.requiresCurrentEligibility("POST", "remediations/correction"),
    false,
  );
  assert.equal(
    operations.requiresCurrentEligibility("POST", "listings/item/pause"),
    false,
  );
  for (const route of [
    "listings",
    "listings/item",
    "listings/item/submit",
    "listings/item/reactivate",
    "bundles",
    "preferred",
    "payout-request",
  ])
    assert.equal(
      operations.requiresCurrentEligibility("POST", route),
      true,
      `${route} must require current eligibility.`,
    );
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of migrations()) raw.exec(readMigration(name));
  const db = d1(raw);
  const now = new Date(NOW).toISOString();
  insertUser(raw, "seller", "seller@trg.test", now);
  insertUser(raw, "owner", "owner@trg.test", now, "owner");
  insertUser(raw, "staff", "staff@trg.test", now);
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
  assert.equal(
    response.status,
    200,
    "Listing history must remain available for remediation and records.",
  );
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
  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "Connect Blocked Draft",
    priceCents: 0,
    pricingModel: "free",
  });
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
  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "Agreement Blocked Draft",
    priceCents: 0,
    pricingModel: "free",
  });
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
  const historicalCompletion = raw
    .prepare(
      "SELECT intake_registration_completed_at FROM marketplace_creators WHERE id=?",
    )
    .get(creator.creatorId).intake_registration_completed_at;
  assert.ok(historicalCompletion);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'manual_adjustment',1250,'usd',?,'available','preservation fixture','eligibility-history-fixture',?)",
    )
    .run(creator.creatorId, now, now);
  raw
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('staff',?,'editor',?)",
    )
    .run(creator.creatorId, now);
  const staffSession = await session(raw, auth, "staff", "staff-token", now);

  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: "UPDATE users SET email_verified=0 WHERE id='seller'",
    restoreSql: "UPDATE users SET email_verified=1 WHERE id='seller'",
    reason: "account_or_email_required",
  });
  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: `UPDATE creator_agreement_acceptances SET superseded_at='${now}' WHERE creator_id='${creator.creatorId}'`,
    restoreSql: `UPDATE creator_agreement_acceptances SET superseded_at=NULL WHERE creator_id='${creator.creatorId}'`,
    reason: "agreement_update_required",
  });
  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: "UPDATE user_account_profiles SET payment_method_status='expired' WHERE user_id='seller'",
    restoreSql: "UPDATE user_account_profiles SET payment_method_status='ready' WHERE user_id='seller'",
    reason: "payment_method_required",
  });
  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: `UPDATE creator_payout_profiles SET payouts_enabled=0 WHERE creator_id='${creator.creatorId}'`,
    restoreSql: `UPDATE creator_payout_profiles SET payouts_enabled=1 WHERE creator_id='${creator.creatorId}'`,
    reason: "connect_or_payout_readiness_required",
  });
  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: `UPDATE creator_identity_ownership SET identity_type='additional',billing_status='past_due' WHERE creator_id='${creator.creatorId}'`,
    restoreSql: `UPDATE creator_identity_ownership SET identity_type='primary',billing_status='legacy_grandfathered' WHERE creator_id='${creator.creatorId}'`,
    reason: "creator_identity_inactive",
  });
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='cure_required' WHERE creator_id=?",
    )
    .run(creator.creatorId);
  assert.equal(
    (await registration.getCreatorOperationalEligibility(db, creator.creatorId))
      .eligible,
    true,
    "The established cure window must remain operational until restriction.",
  );
  await assertEligibilityToggle({
    raw,
    registration,
    creatorId: creator.creatorId,
    failSql: `UPDATE creator_account_audit_states SET state='restricted' WHERE creator_id='${creator.creatorId}'`,
    restoreSql: `UPDATE creator_account_audit_states SET state='passed' WHERE creator_id='${creator.creatorId}'`,
    reason: "account_remediation_required",
  });
  assert.equal(
    raw
      .prepare(
        "SELECT intake_registration_completed_at FROM marketplace_creators WHERE id=?",
      )
      .get(creator.creatorId).intake_registration_completed_at,
    historicalCompletion,
    "Current eligibility changes must not rewrite historical completion.",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM creator_earnings_ledger WHERE idempotency_key='eligibility-history-fixture'",
      )
      .get().amount_cents,
    1250,
    "Eligibility changes must preserve historical financial ledger entries.",
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
  response = await creatorRequest(operations, db, sellerSession, "listings", {
    title: "Restricted Draft",
    priceCents: 0,
    pricingModel: "free",
  });
  assert.equal(
    response.status,
    403,
    "Historical completion must not authorize a new listing after eligibility lapses.",
  );
  response = await creatorRequest(operations, db, staffSession, "listings", {
    title: "Staff Cannot Bypass",
    priceCents: 0,
    pricingModel: "free",
  });
  assert.equal(
    response.status,
    403,
    "A staff membership must not bypass creator-wide current eligibility.",
  );
  response = await creatorRequest(operations, db, staffSession, "listings");
  assert.equal(response.status, 200, "Staff may still access retained history.");

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
    dashboard.indexOf('api("listings")') <
      dashboard.indexOf("if (!summary.intakeAccess) return;"),
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, "creator/index.html"), "utf8"),
    /id="creator-listings" hidden/,
  );
  const advertisingSource = fs.readFileSync(
    path.join(ROOT, "functions/_lib/creator-advertising-route.mjs"),
    "utf8",
  );
  const balanceSource = fs.readFileSync(
    path.join(ROOT, "functions/_lib/creator-balance-route.mjs"),
    "utf8",
  );
  const publicationSource = fs.readFileSync(
    path.join(ROOT, "functions/_lib/publication-readiness.mjs"),
    "utf8",
  );
  for (const source of [advertisingSource, balanceSource, publicationSource])
    assert.match(source, /getCreatorOperationalEligibility/);
  assert.match(advertisingSource, /request\.method !== "GET" && !readiness\.eligible/);
  assert.match(balanceSource, /request\.method !== "GET" && !ready\.eligible/);
  assert.doesNotMatch(
    publicationSource,
    /if \(!listingCanCharge\(listing\)\) return/,
    "Free publication must not bypass current eligibility.",
  );
  console.log("Registration hard-gate tests passed.");
}

async function assertEligibilityToggle({
  raw,
  registration,
  creatorId,
  failSql,
  restoreSql,
  reason,
}) {
  raw.exec(failSql);
  let state = await registration.getCreatorOperationalEligibility(
    d1(raw),
    creatorId,
  );
  assert.equal(state.eligible, false);
  assert.equal(state.historicallyCompleted, true);
  assert.ok(state.reasonCodes.includes(reason));
  raw.exec(restoreSql);
  state = await registration.getCreatorOperationalEligibility(d1(raw), creatorId);
  assert.equal(state.eligible, true);
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
