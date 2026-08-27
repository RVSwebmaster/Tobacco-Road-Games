const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite"),
  { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."),
  NOW = Date.parse("2028-08-27T12:00:00Z"),
  DAY = 86400000;
async function main() {
  const registration = await load("functions/_lib/creator-registration.mjs"),
    profile = await load("functions/_lib/account-profile.mjs"),
    audits = await load("functions/_lib/creator-account-audits.mjs"),
    policy = await load("functions/_lib/marketplace-policy.mjs"),
    publication = await load("functions/_lib/publication-readiness.mjs"),
    reports = await load("functions/_lib/creator-business-report.mjs"),
    raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of migrations()) raw.exec(file(name));
  const db = d1(raw),
    now = new Date(NOW).toISOString();
  user(raw, "seller", "seller@trg.test", now);
  user(raw, "staff", "staff@trg.test", now);
  const body = {
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
  const primary = await registration.registerPrimaryCreator(db, {
    userId: "seller",
    email: "seller@trg.test",
    body,
    nowMs: NOW,
  });
  const additional = await registration.createAdditionalCreatorIdentity(db, {
    userId: "seller",
    email: "seller@trg.test",
    body: { ...body, creatorName: "Second Brand", slug: "second-brand" },
    billingCadence: "monthly",
    billingStatus: "current",
    nowMs: NOW,
  });
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_account_audit_states WHERE creator_id IN (?,?)",
      )
      .get(primary.creatorId, additional.creatorId).n,
    2,
  );
  assert.equal(
    audits.addUtcMonths("2028-08-31T12:00:00Z", 6),
    "2029-02-28T12:00:00.000Z",
  );
  user(raw, "edge-seller", "edge@trg.test", now);
  const edge = await registration.registerPrimaryCreator(db, {
    userId: "edge-seller",
    email: "edge@trg.test",
    body: {
      ...body,
      creatorName: "Calendar Edge Studio",
      slug: "calendar-edge-studio",
      contactEmail: "edge@trg.test",
    },
    nowMs: Date.parse("2028-08-31T12:00:00Z"),
  });
  assert.equal(
    raw
      .prepare(
        "SELECT next_audit_due_at FROM creator_account_audit_states WHERE creator_id=?",
      )
      .get(edge.creatorId).next_audit_due_at,
    "2029-02-28 00:00:00",
  );
  await policy.createPreferredTerm(db, {
    creatorId: primary.creatorId,
    paymentCadence: "annual_prepaid",
    operatorActor: "owner",
    nowMs: NOW,
  });
  assert.equal(
    (await audits.assessCreatorAccount(db, primary.creatorId, { nowMs: NOW }))
      .checks.preferredCoherent,
    true,
  );
  raw
    .prepare(
      "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('staff',?,'editor',?)",
    )
    .run(primary.creatorId, now);
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_identity_ownership WHERE owner_user_id='staff'",
      )
      .get().n,
    0,
  );
  await profile.recordPaymentMethodReadiness(db, {
    userId: "seller",
    stripeCustomerReference: "cus_safe",
    paymentMethodReference: "pm_safe",
    brand: "visa",
    last4: "4242",
    status: "ready",
    nowMs: NOW,
  });
  raw
    .prepare(
      "INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,listed_price_cents,pricing_model,created_at,updated_at) VALUES('paid',?,'paid','Paid','draft','approved',500,'fixed',?,?)",
    )
    .run(primary.creatorId, now, now);
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET next_audit_due_at=? WHERE creator_id=?",
    )
    .run(now, primary.creatorId);
  let result = await audits.runDueCreatorAudits(db, {
    env: { CREATOR_AUDIT_CURE_DAYS: "14" },
    nowMs: NOW,
  });
  assert.equal(result.processed, 1);
  assert.match(
    result.results[0].reasonCodes.join(","),
    /connect_payout_not_ready/,
  );
  assert.equal(
    result.results[0].reasonCodes.includes("payment_method_not_ready"),
    false,
  );
  raw
    .prepare(
      "UPDATE creator_payout_profiles SET onboarding_status='complete',verification_status='verified',payouts_enabled=1 WHERE creator_id=?",
    )
    .run(primary.creatorId);
  assert.equal(
    (
      await audits.runCreatorAudit(db, {
        creatorId: primary.creatorId,
        nowMs: NOW + DAY,
      })
    ).result,
    "cleared",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT state FROM creator_account_audit_states WHERE creator_id=?",
      )
      .get(primary.creatorId).state,
    "passed",
  );
  await publication.recordListingDeclaration(db, {
    listingId: "paid",
    creatorId: primary.creatorId,
    userId: "seller",
    rightsConfirmed: true,
    representationConfirmed: true,
    licensesConfirmed: true,
    nowMs: NOW + DAY,
  });
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='restricted' WHERE creator_id=?",
    )
    .run(primary.creatorId);
  await assert.rejects(
    publication.assertCreatorPublicationReadiness(
      db,
      raw.prepare("SELECT * FROM creator_listings WHERE id='paid'").get(),
    ),
    /audit restriction blocks new paid publication/,
  );
  assert.equal(
    raw
      .prepare("SELECT inactivity_state FROM creator_listings WHERE id='paid'")
      .get().inactivity_state,
    "active",
  );
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='passed' WHERE creator_id=?",
    )
    .run(primary.creatorId);
  raw
    .prepare(
      "UPDATE creator_agreement_acceptances SET superseded_at=? WHERE creator_id=?",
    )
    .run(new Date(NOW + DAY).toISOString(), additional.creatorId);
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='scheduled',next_audit_due_at=? WHERE creator_id=?",
    )
    .run(new Date(NOW + DAY).toISOString(), additional.creatorId);
  result = await audits.runCreatorAudit(db, {
    creatorId: additional.creatorId,
    nowMs: NOW + DAY,
  });
  assert.ok(result.reasonCodes.includes("agreement_reacceptance_required"));
  await registration.acceptCreatorAgreement(db, {
    creatorId: additional.creatorId,
    userId: "seller",
    sourceContext: "audit_cure",
    nowMs: NOW + DAY + 1,
  });
  assert.equal(
    (
      await audits.runCreatorAudit(db, {
        creatorId: additional.creatorId,
        nowMs: NOW + DAY + 1,
      })
    ).result,
    "cleared",
  );
  await profile.recordPaymentMethodReadiness(db, {
    userId: "seller",
    stripeCustomerReference: "cus_safe",
    paymentMethodReference: "pm_safe",
    status: "missing",
    nowMs: NOW + 2 * DAY,
  });
  raw
    .prepare(
      "UPDATE creator_account_audit_states SET state='scheduled',next_audit_due_at=? WHERE creator_id=?",
    )
    .run(new Date(NOW + 2 * DAY).toISOString(), additional.creatorId);
  result = await audits.runCreatorAudit(db, {
    creatorId: additional.creatorId,
    env: { CREATOR_AUDIT_CURE_DAYS: "10" },
    nowMs: NOW + 2 * DAY,
  });
  assert.deepEqual(result.reasonCodes, ["payment_method_not_ready"]);
  const auditCount = raw
    .prepare("SELECT COUNT(*) n FROM creator_account_audits WHERE creator_id=?")
    .get(additional.creatorId).n;
  await audits.runCreatorAudit(db, {
    creatorId: additional.creatorId,
    env: { CREATOR_AUDIT_CURE_DAYS: "10" },
    nowMs: NOW + 3 * DAY,
  });
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_account_audits WHERE creator_id=?",
      )
      .get(additional.creatorId).n,
    auditCount,
  );
  assert.equal(
    (
      await audits.runCreatorAudit(db, {
        creatorId: additional.creatorId,
        env: { CREATOR_AUDIT_CURE_DAYS: "10" },
        nowMs: NOW + 13 * DAY,
      })
    ).result,
    "restricted",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT state FROM creator_account_audit_states WHERE creator_id=?",
      )
      .get(additional.creatorId).state,
    "restricted",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE id='paid'").get()
      .n,
    1,
  );
  assert.ok(
    raw.prepare("SELECT COUNT(*) n FROM creator_account_notices").get().n >= 4,
  );
  await profile.recordPaymentMethodReadiness(db, {
    userId: "seller",
    stripeCustomerReference: "cus_safe",
    paymentMethodReference: "pm_safe",
    status: "ready",
    nowMs: NOW + 14 * DAY,
  });
  assert.equal(
    (
      await audits.runCreatorAudit(db, {
        creatorId: additional.creatorId,
        nowMs: NOW + 14 * DAY,
      })
    ).result,
    "cleared",
  );
  const order = insertOrder(raw, "TRG-P14", now),
    one = item(raw, order, "paid", 1000, 800, now),
    two = item(raw, order, "second", 2000, 2000, now);
  snapshot(raw, {
    order,
    item: one,
    creator: primary.creatorId,
    slug: "paid",
    title: "Paid",
    gross: 800,
    discount: 200,
    fee: 80,
    net: 720,
    bps: 1000,
    reason: "launch",
    now,
  });
  snapshot(raw, {
    order,
    item: two,
    creator: additional.creatorId,
    slug: "second",
    title: "Second",
    gross: 2000,
    discount: 0,
    fee: 400,
    net: 1600,
    bps: 2000,
    reason: "standard",
    now,
  });
  raw
    .prepare(
      "INSERT INTO creator_reversal_snapshots(order_id,order_item_id,creator_id,reversal_type,gross_reversed_cents,creator_net_reversed_cents,currency,provider_event_id,created_at) VALUES(?,?,?,'refund_reversal',100,90,'USD','refund-1',?)",
    )
    .run(order, one, primary.creatorId, now);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'refund_reversal',-90,'USD',?,?,'paid',?,'available','refund','refund:1',?)",
    )
    .run(primary.creatorId, order, one, now, now);
  raw
    .prepare(
      "INSERT INTO creator_payouts(id,creator_id,amount_cents,currency,reference,status,idempotency_key,operator_actor,paid_at,created_at) VALUES('payout-1',?,100,'USD','external','paid','p14','owner',?,?)",
    )
    .run(primary.creatorId, now, now);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'payout',-100,'USD',?,'paid','payout','payout:p14',?)",
    )
    .run(primary.creatorId, now, now);
  const month = reports.resolveReportPeriod({
      period: "month",
      value: "2028-08",
      nowMs: NOW,
    }),
    report = await reports.getCreatorBusinessReport(
      db,
      primary.creatorId,
      month,
    );
  assert.equal(report.reconciliation.ok, true);
  assert.equal(report.totals.grossSalesCents, 800);
  assert.equal(report.totals.trgFeesCents, 80);
  assert.equal(report.totals.refundsGrossCents, 100);
  assert.equal(report.totals.netPayoutsCents, 100);
  assert.equal(report.sales[0].policy_reason, "launch");
  assert.equal(
    report.sales.some((row) => row.creator_id === additional.creatorId),
    false,
  );
  const csv = reports.creatorBusinessReportCsv(
    { id: primary.creatorId, display_name: "Seller Studio" },
    report,
  );
  assert.match(csv, /Order reference/);
  assert.match(csv, /Sale policy\/split snapshot/);
  assert.match(csv, /TRG fees cents,80/);
  const ytd = await reports.getCreatorBusinessReport(
    db,
    primary.creatorId,
    reports.resolveReportPeriod({ period: "ytd", nowMs: NOW }),
  );
  assert.equal(ytd.totals.grossSalesCents, 800);
  const empty = await reports.getCreatorBusinessReport(
    db,
    primary.creatorId,
    reports.resolveReportPeriod({ period: "year", value: "2027", nowMs: NOW }),
  );
  assert.equal(empty.totals.grossSalesCents, 0);
  assert.equal(empty.reconciliation.ok, true);
  raw
    .prepare(
      "UPDATE creator_earnings_ledger SET amount_cents=719 WHERE creator_id=? AND entry_type='sale_earning'",
    )
    .run(primary.creatorId);
  assert.equal(
    (await reports.getCreatorBusinessReport(db, primary.creatorId, month))
      .reconciliation.ok,
    false,
  );
  const sources = [
    "functions/_lib/creator-account-audits.mjs",
    "migrations/027_creator_audits_reporting.sql",
  ]
    .map((n) => fs.readFileSync(path.join(ROOT, n), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    sources,
    /artistic|ideological|ai[_ -]?(use|content|disclosure)/i,
  );
  console.log("Marketplace Pass 14 tests passed.");
}
function snapshot(r, x) {
  r.prepare(
    "INSERT INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at,policy_reason) VALUES(?,?,?,?,?,1000,800,1,?,?,?,?,?,?,'USD',?,?)",
  ).run(
    x.order,
    x.item,
    x.creator,
    x.slug,
    x.title,
    x.discount,
    x.gross,
    x.bps,
    0,
    x.fee,
    x.net,
    x.now,
    x.reason,
  );
  r.prepare(
    "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'sale_earning',?,'USD',?,?,?,?,'available','sale',?,?)",
  ).run(
    x.creator,
    x.net,
    x.order,
    x.item,
    x.slug,
    x.now,
    `sale:${x.item}`,
    x.now,
  );
}
function insertOrder(r, id, n) {
  return Number(
    r
      .prepare(
        "INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at) VALUES(?,'buyer@example.com','buyer@example.com','hash','USD',2800,2800,'paid','ready','sent',?,?)",
      )
      .run(id, n, n).lastInsertRowid,
  );
}
function item(r, o, s, l, p, n) {
  return Number(
    r
      .prepare(
        "INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES(?,?,?,'author','[]',1,?,?,?,'USD','1','2028-08-27',?)",
      )
      .run(o, s, s, l, p, p, n).lastInsertRowid,
  );
}
function user(r, id, email, n) {
  r.prepare(
    "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)",
  ).run(id, email, n, n);
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
  ];
}
function file(n) {
  return fs.readFileSync(path.join(ROOT, "migrations", n), "utf8");
}
function load(n) {
  return import(
    pathToFileURL(path.join(ROOT, n)).href + `?p14=${Math.random()}`
  );
}
function d1(r) {
  return {
    prepare(s) {
      let v = [];
      return {
        bind(...n) {
          v = n;
          return this;
        },
        first: async () => r.prepare(s).get(...v) || null,
        all: async () => ({ results: r.prepare(s).all(...v) }),
        run: async () => {
          const x = r.prepare(s).run(...v);
          return {
            meta: { changes: Number(x.changes) },
            changes: Number(x.changes),
          };
        },
      };
    },
    async batch(ss) {
      r.exec("BEGIN");
      try {
        for (const s of ss) await s.run();
        r.exec("COMMIT");
      } catch (e) {
        r.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
