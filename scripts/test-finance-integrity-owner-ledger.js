const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite"),
  { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."),
  NOW = Date.parse("2026-09-01T12:00:00Z"),
  ISO = new Date(NOW).toISOString();
async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const f of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", f), "utf8"));
  const db = d1(raw),
    liability = await load("functions/_lib/creator-liability.mjs"),
    payout = await load("functions/_lib/creator-payout-readiness.mjs"),
    finance = await load("functions/_lib/creator-finance.mjs");
  raw
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at)VALUES('finance-user','finance@test.invalid',1,'active','user',?,?)",
    )
    .run(ISO, ISO);
  for (const [id, slug] of [
    ["a", "creator-a"],
    ["b", "creator-b"],
    ["c", "creator-c"],
    ["d", "creator-d"],
    ["e", "creator-e"],
    ["f", "creator-f"],
    ["g", "creator-g"],
  ])
    creator(raw, id, slug);
  earn(raw, "a", 10000);
  balanceTx(raw, "a", -4000, "purchase_debit", "a-debit");
  let a = await liability.getCreatorLiability(db, "a", { nowMs: NOW });
  assert.equal(a.currentNetLiabilityCents, 6000);
  assert.equal(a.payoutEligibleCents, 6000);
  assert.equal(
    (
      await payout.getCreatorPayoutStatus(db, "a", {
        env: { CREATOR_MINIMUM_PAYOUT_CENTS: "1" },
        nowMs: NOW,
      })
    ).eligibleAmountCents,
    6000,
  );
  await assert.rejects(
    () =>
      finance.recordManualPayout(db, {
        creatorId: "a",
        amountCents: 6001,
        idempotencyKey: "too-much",
        operatorActor: "owner",
        paidAt: ISO,
      }),
    /exceeds/i,
  );
  earn(raw, "b", 10000);
  reservePurchase(raw, "b", 3000, "b-res");
  assert.equal(
    (await liability.getCreatorLiability(db, "b", { nowMs: NOW }))
      .payoutEligibleCents,
    7000,
  );
  earn(raw, "c", 10000);
  await liability.reserveCreatorPayout(db, {
    creatorId: "c",
    amountCents: 8000,
    nowMs: NOW,
  });
  assert.equal(
    (await liability.getCreatorLiability(db, "c", { nowMs: NOW }))
      .payoutEligibleCents,
    2000,
  );
  await assert.rejects(
    () =>
      liability.reserveCreatorPayout(db, {
        creatorId: "c",
        amountCents: 3000,
        nowMs: NOW,
      }),
    /pending|exceeds/i,
  );
  earn(raw, "d", 10000);
  balanceTx(raw, "d", -2000, "service_debit", "d-debit");
  service(raw, "d", "svc-d", 2000, "creator_balance", "preferred_monthly");
  let d = await liability.getCreatorLiability(db, "d", { nowMs: NOW }),
    revenue = await liability.getTrgRevenueReport(db);
  assert.equal(d.currentNetLiabilityCents, 8000);
  assert.equal(revenue.serviceRevenue.creatorBalanceNetCents, 2000);
  assert.equal(revenue.serviceRevenue.stripeNetCents, 0);
  earn(raw, "e", 10000);
  balanceTx(raw, "e", -2000, "service_debit", "e-debit");
  balanceTx(raw, "e", 2000, "refund_credit", "e-credit");
  service(raw, "e", "svc-e", 2000, "creator_balance", "ad_credit_package");
  raw
    .prepare(
      "INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at)VALUES('svc-e','ad_credit_package','service_reversal',-2000,'USD','svc-e-reversal',?)",
    )
    .run(ISO);
  assert.equal(
    (await liability.getCreatorLiability(db, "e", { nowMs: NOW }))
      .currentNetLiabilityCents,
    10000,
  );
  revenue = await liability.getTrgRevenueReport(db);
  assert.equal(revenue.serviceRevenue.netCents, 2000);
  earn(raw, "f", 10000);
  earn(raw, "g", -2000);
  let market = await liability.getMarketplaceCreatorLiability(db, {
    nowMs: NOW,
  });
  assert.equal(market.totals.totalCreatorLiabilityCents, 54000);
  assert.equal(market.totals.negativeBalanceCents, 2000);
  creator(raw, "race", "creator-race");
  earn(raw, "race", 10000);
  await liability.reserveCreatorPayout(db, {
    creatorId: "race",
    amountCents: 8000,
    nowMs: NOW,
  });
  assert.throws(
    () => reservePurchase(raw, "race", 3000, "race-purchase"),
    /insufficient/i,
  );
  creator(raw, "race2", "creator-race2");
  earn(raw, "race2", 10000);
  reservePurchase(raw, "race2", 8000, "race2-purchase");
  await assert.rejects(
    () =>
      liability.reserveCreatorPayout(db, {
        creatorId: "race2",
        amountCents: 3000,
        nowMs: NOW,
      }),
    /exceeds|balance/i,
  );
  raw.exec("PRAGMA foreign_keys=OFF");
  creator(raw, "hold50", "creator-hold50");
  earn(raw, "hold50", 10000);
  const hold50 = await liability.reserveCreatorPayout(db, {
    creatorId: "hold50",
    amountCents: 8000,
    nowMs: NOW,
  });
  dispute(raw, "hold50", "dispute-50", 5000);
  let capacity = await liability.getPayoutCompletionCapacity(db, {
    payoutRequestId: hold50.requestId,
    creatorId: "hold50",
    nowMs: NOW,
  });
  assert.equal(capacity.rawCompletionCapacityCents, 5000);
  assert.equal(capacity.completionSafe, false);
  await assert.rejects(
    () => complete(finance, db, "hold50", hold50.requestId, "hold50"),
    /blocked/i,
  );
  assert.equal(payoutCount(raw, "hold50"), 0);
  assert.equal(payoutLedgerCount(raw, "hold50"), 0);
  assert.equal(reservationState(raw, hold50.requestId), "reserved");
  assert.throws(
    () => directPayout(raw, "hold50", 8000, "db-hold50"),
    /blocked by current financial state/i,
  );

  raw
    .prepare(
      "UPDATE creator_dispute_allocations SET status='released',updated_at=? WHERE dispute_id='dispute-50' AND status='held'",
    )
    .run(ISO);
  capacity = await liability.getPayoutCompletionCapacity(db, {
    payoutRequestId: hold50.requestId,
    creatorId: "hold50",
    nowMs: NOW,
  });
  assert.equal(capacity.rawCompletionCapacityCents, 10000);
  assert.equal(capacity.completionSafe, true);
  await complete(finance, db, "hold50", hold50.requestId, "hold50");
  assert.equal(payoutCount(raw, "hold50"), 1);
  assert.equal(payoutLedgerCount(raw, "hold50"), 1);
  assert.equal(reservationState(raw, hold50.requestId), "consumed");
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE creator_payout_requests SET status='failed' WHERE id=?",
        )
        .run(hold50.requestId),
    /immutable/i,
  );
  await assert.rejects(
    () => complete(finance, db, "hold50", hold50.requestId, "hold50-repeat"),
    /reservation/i,
  );
  assert.equal(payoutCount(raw, "hold50"), 1);

  creator(raw, "hold10", "creator-hold10");
  earn(raw, "hold10", 10000);
  const hold10 = await liability.reserveCreatorPayout(db, {
    creatorId: "hold10",
    amountCents: 8000,
    nowMs: NOW,
  });
  dispute(raw, "hold10", "dispute-10", 1000);
  capacity = await liability.getPayoutCompletionCapacity(db, {
    payoutRequestId: hold10.requestId,
    creatorId: "hold10",
    nowMs: NOW,
  });
  assert.equal(capacity.rawCompletionCapacityCents, 9000);
  assert.equal(capacity.completionSafe, true);
  // $90 remains payable, so the original $80 reservation is still safe.
  await complete(finance, db, "hold10", hold10.requestId, "hold10");

  creator(raw, "hold30", "creator-hold30");
  earn(raw, "hold30", 10000);
  const hold30 = await liability.reserveCreatorPayout(db, {
    creatorId: "hold30",
    amountCents: 8000,
    nowMs: NOW,
  });
  earn(raw, "hold30", -3000, "reversal-hold30");
  capacity = await liability.getPayoutCompletionCapacity(db, {
    payoutRequestId: hold30.requestId,
    creatorId: "hold30",
    nowMs: NOW,
  });
  assert.equal(capacity.rawCompletionCapacityCents, 7000);
  assert.equal(capacity.completionSafe, false);
  await assert.rejects(
    () => complete(finance, db, "hold30", hold30.requestId, "reversal"),
    /blocked/i,
  );
  balanceTx(raw, "hold30", 3000, "operator_correction", "restore-hold30");
  await complete(finance, db, "hold30", hold30.requestId, "restored");

  creator(raw, "db-race", "creator-db-race");
  earn(raw, "db-race", 10000);
  const dbRace = await liability.reserveCreatorPayout(db, {
    creatorId: "db-race",
    amountCents: 8000,
    nowMs: NOW,
  });
  assert.equal(
    (
      await liability.getPayoutCompletionCapacity(db, {
        payoutRequestId: dbRace.requestId,
        creatorId: "db-race",
        nowMs: NOW,
      })
    ).completionSafe,
    true,
  );
  dispute(raw, "db-race", "dispute-race", 5000);
  assert.throws(
    () => directPayout(raw, "db-race", 8000, "db-race"),
    /blocked by current financial state/i,
  );

  creator(raw, "future", "creator-future");
  const future = "2099-01-01T00:00:00.000Z";
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at)VALUES('future','sale_earning',8000,'USD',?,'pending','future','future-earn',?)",
    )
    .run(future, ISO);
  await assert.rejects(
    () =>
      finance.recordManualPayout(db, {
        creatorId: "future",
        amountCents: 8000,
        currency: "USD",
        reference: "future",
        idempotencyKey: "future",
        operatorActor: "owner",
        paidAt: future,
        nowMs: NOW,
      }),
    /exceeds/i,
  );
  raw
    .prepare(
      "INSERT INTO creator_payout_requests(id,creator_id,amount_cents,currency,request_kind,status,requested_at)VALUES('future-request','future',8000,'USD','normal','pending',?)",
    )
    .run(ISO);
  raw
    .prepare(
      "INSERT INTO creator_payout_reservations(payout_request_id,creator_id,amount_cents,status,created_at)VALUES('future-request','future',8000,'reserved',?)",
    )
    .run(future);
  assert.throws(
    () => directPayout(raw, "future", 8000, "future-direct", future),
    /blocked by current financial state/i,
  );
  const html = fs.readFileSync(path.join(ROOT, "owner/finance.html"), "utf8"),
    js = fs.readFileSync(path.join(ROOT, "assets/js/owner-finance.js"), "utf8"),
    api = fs.readFileSync(
      path.join(ROOT, "functions/owner/api/finance.js"),
      "utf8",
    );
  assert.match(html, /Total Creator Liability|Creator Money/i);
  assert.match(js, /owner\/api\/finance/);
  assert.match(js, /completion blocked by current hold/);
  assert.match(api, /verifySessionToken/);
  console.log("Finance integrity and owner ledger tests passed.");
}
function dispute(raw, creatorId, disputeId, amount) {
  raw
    .prepare(
      "INSERT INTO creator_dispute_allocations(dispute_id,order_id,creator_id,allocated_gross_cents,currency,status,provider_event_id,created_at,updated_at)VALUES(?,999,?,?,'USD','held',?, ?,?)",
    )
    .run(disputeId, creatorId, amount, `evt-${disputeId}`, ISO, ISO);
}
function complete(finance, db, creatorId, requestId, key) {
  return finance.recordManualPayout(db, {
    creatorId,
    amountCents: 8000,
    currency: "USD",
    reference: key,
    idempotencyKey: key,
    operatorActor: "owner",
    payoutRequestId: requestId,
    paidAt: ISO,
    nowMs: NOW,
  });
}
function directPayout(raw, creatorId, amount, key, paidAt = ISO) {
  return raw
    .prepare(
      "INSERT INTO creator_payouts(id,creator_id,amount_cents,currency,reference,idempotency_key,operator_actor,paid_at,created_at)VALUES(?,?,?,'USD',?,?,'owner',?,?)",
    )
    .run(key, creatorId, amount, key, key, paidAt, ISO);
}
function payoutCount(raw, creatorId) {
  return raw
    .prepare("SELECT COUNT(*) n FROM creator_payouts WHERE creator_id=?")
    .get(creatorId).n;
}
function payoutLedgerCount(raw, creatorId) {
  return raw
    .prepare(
      "SELECT COUNT(*) n FROM creator_earnings_ledger WHERE creator_id=? AND entry_type='payout'",
    )
    .get(creatorId).n;
}
function reservationState(raw, requestId) {
  return raw
    .prepare(
      "SELECT status FROM creator_payout_reservations WHERE payout_request_id=?",
    )
    .get(requestId).status;
}
function creator(raw, id, slug) {
  raw
    .prepare(
      "INSERT INTO marketplace_creators(id,slug,display_name,short_bio,marketplace_status,created_at,updated_at)VALUES(?,?,?,'Test','approved',?,?)",
    )
    .run(id, slug, slug, ISO, ISO);
}
function earn(raw, id, amount, key = `earn-${id}`) {
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at)VALUES(?,'manual_adjustment',?,'USD',?,'available','test',?,?)",
    )
    .run(id, amount, ISO, key, ISO);
}
function balanceTx(raw, id, amount, type, key) {
  raw
    .prepare(
      "INSERT INTO creator_balance_transactions(id,creator_id,user_id,transaction_type,amount_cents,currency,idempotency_key,description,created_at)VALUES(?,?,'finance-user',?,?,?,?, 'test',?)",
    )
    .run(key, id, type, amount, "USD", key, ISO);
}
function reservePurchase(raw, id, amount, key) {
  return raw
    .prepare(
      "INSERT INTO creator_balance_reservations(id,creator_id,user_id,amount_cents,currency,purpose,state,checkout_attempt_id,created_at)VALUES(?,?,'finance-user',?,'USD','product_purchase','reserved',?,?)",
    )
    .run(key, id, amount, key, ISO);
}
function service(raw, id, purchaseId, amount, source, sku) {
  const type = sku.startsWith("preferred_")
    ? "preferred_creator_fee"
    : sku === "ad_credit_package"
      ? "ad_credit_package"
      : "additional_creator_identity_fee";
  raw
    .prepare(
      "INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,status,idempotency_key,context_json,created_at,completed_at)VALUES(?,?,'finance-user',?,?,1,?,'USD',?,'internal_ledger','settled',?,'{}',?,?)",
    )
    .run(purchaseId, id, type, sku, amount, source, purchaseId, ISO, ISO);
  raw
    .prepare(
      "INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at)VALUES(?,?,'service_revenue',?,'USD',?,?)",
    )
    .run(purchaseId, type, amount, `${purchaseId}-revenue`, ISO);
}
function load(p) {
  return import(pathToFileURL(path.join(ROOT, p)).href + `?${Date.now()}`);
}
function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return raw.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: raw.prepare(sql).all(...values) };
        },
        async run() {
          return raw.prepare(sql).run(...values);
        },
      };
    },
    async batch(items) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = [];
        for (const item of items) out.push(await item.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
