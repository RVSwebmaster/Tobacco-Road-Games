const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite"),
  { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."),
  NOW = Date.parse("2028-09-01T12:00:00Z"),
  DAY = 86400000;
async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const n of fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((n) => /^\d+_.+\.sql$/.test(n))
    .sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", n), "utf8"));
  const db = d1(raw),
    ops = await load("functions/_lib/marketplace-operations.mjs"),
    tx = await load("functions/_lib/transaction-policy.mjs"),
    now = new Date(NOW).toISOString();
  raw
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES('seller','seller@test',1,'active','user',?,?),('buyer','buyer@test',1,'active','user',?,?)",
    )
    .run(now, now, now, now);
  raw
    .prepare(
      "INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,created_at,updated_at) VALUES('creator','creator','Creator','approved',?,?)",
    )
    .run(now, now);
  raw
    .prepare(
      "INSERT INTO creator_listings(id,creator_id,slug,title,source_product_slug,lifecycle_state,publication_state,listed_price_cents,created_at,updated_at) VALUES('listing','creator','game','Game','game','active','published',1000,?,?)",
    )
    .run(now, now);
  const oid = Number(
      raw
        .prepare(
          "INSERT INTO orders(public_id,user_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at) VALUES('ORDER','buyer','buyer@test','buyer@test','buyerhash','USD',1000,1000,'paid','ready','sent',?,?)",
        )
        .run(now, now).lastInsertRowid,
    ),
    itemId = Number(
      raw
        .prepare(
          "INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES(?,'game','Game','creator','[]',1,1000,1000,1000,'USD','1','2028-09-01',?)",
        )
        .run(oid, now).lastInsertRowid,
    );
  raw
    .prepare(
      "INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at) VALUES(?,?,'game','old.pdf','game.pdf','application/pdf',10,'active',?)",
    )
    .run(oid, itemId, now);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES('creator','sale_earning',4000,'USD',?,'available','sale','sale:ops',?)",
    )
    .run(now, now);
  let c = await ops.openRemediation(db, {
    listingId: "listing",
    reason: "wrong_file",
    requiredCorrection: "Upload correct file.",
    actorId: "owner",
    nowMs: NOW,
  });
  assert.equal(c.affectedOrders, 1);
  assert.equal(Date.parse(c.repairDueAt) - NOW, 30 * DAY);
  await ops.chooseRemediation(db, {
    caseId: c.id,
    orderId: oid,
    userId: "buyer",
    emailHash: "buyerhash",
    choice: "wait_for_repair",
    nowMs: NOW,
  });
  assert.equal(
    raw.prepare("SELECT r2_object_key FROM download_entitlements").get()
      .r2_object_key,
    "old.pdf",
  );
  await ops.submitRemediationCorrection(db, {
    caseId: c.id,
    creatorId: "creator",
    objectKey: "corrected.pdf",
    nowMs: NOW + DAY,
  });
  await ops.reviewRemediationCorrection(db, {
    caseId: c.id,
    accepted: true,
    actorId: "owner",
    nowMs: NOW + 2 * DAY,
  });
  assert.equal(
    raw.prepare("SELECT r2_object_key FROM download_entitlements").get()
      .r2_object_key,
    "corrected.pdf",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT lifecycle_state FROM creator_listings WHERE id='listing'",
      )
      .get().lifecycle_state,
    "paused",
  );
  raw
    .prepare(
      "UPDATE creator_listings SET lifecycle_state='active',publication_state='published' WHERE id='listing'",
    )
    .run();
  let expired = await ops.openRemediation(db, {
    listingId: "listing",
    reason: "corrupt_file",
    actorId: "owner",
    nowMs: NOW,
  });
  await ops.chooseRemediation(db, {
    caseId: expired.id,
    orderId: oid,
    userId: "buyer",
    emailHash: "buyerhash",
    choice: "wait_for_repair",
    nowMs: NOW,
  });
  assert.equal(
    (await ops.processExpiredRemediations(db, { nowMs: NOW + 31 * DAY }))
      .processed,
    1,
  );
  assert.equal(
    (await ops.processExpiredRemediations(db, { nowMs: NOW + 31 * DAY }))
      .processed,
    0,
  );
  assert.ok(
    raw
      .prepare(
        "SELECT refund_required_at FROM customer_refund_choices WHERE remediation_case_id=?",
      )
      .get(expired.id).refund_required_at,
  );
  await ops.allocateProviderCost(db, {
    providerEventId: "refund-creator",
    eventKind: "refund",
    orderId: oid,
    creatorId: "creator",
    responsibility: "creator",
    actualCostCents: 37,
    actorId: "owner",
    reason: "creator defect",
    nowMs: NOW,
  });
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM creator_earnings_ledger WHERE idempotency_key='provider-cost:refund:refund-creator'",
      )
      .get().amount_cents,
    -37,
  );
  let a = await ops.allocateProviderCost(db, {
    providerEventId: "refund-trg",
    eventKind: "refund",
    orderId: oid,
    responsibility: "marketplace",
    actualCostCents: 41,
    actorId: "owner",
    reason: "TRG failure",
    nowMs: NOW,
  });
  assert.equal(a.creatorLedgerId, null);
  await ops.allocateProviderCost(db, {
    providerEventId: "ordinary-fraud",
    eventKind: "dispute",
    orderId: oid,
    responsibility: "marketplace",
    actualCostCents: 1500,
    actorId: "owner",
    reason: "ordinary fraud",
    nowMs: NOW,
  });
  await ops.allocateProviderCost(db, {
    providerEventId: "creator-dispute",
    eventKind: "dispute",
    orderId: oid,
    creatorId: "creator",
    responsibility: "creator",
    actualCostCents: 1500,
    actorId: "owner",
    reason: "creator fraud",
    nowMs: NOW,
  });
  assert.equal(
    raw
      .prepare(
        "SELECT actual_provider_cost_cents FROM marketplace_provider_cost_allocations WHERE provider_event_id='creator-dispute'",
      )
      .get().actual_provider_cost_cents,
    1500,
  );
  await ops.createFraudBlock(db, {
    emailHash: "buyerhash",
    userId: "buyer",
    reason: "confirmed fraud",
    actorId: "owner",
    nowMs: NOW,
  });
  assert.equal(
    raw.prepare("SELECT status FROM users WHERE id='buyer'").get().status,
    "disabled",
  );
  await assert.rejects(
    tx.assertNotFraudBlocked(db, { emailHash: "buyerhash", userId: "buyer" }),
    /cannot complete/,
  );
  const block = raw.prepare("SELECT id FROM marketplace_fraud_blocks").get();
  await ops.reverseFraudBlock(db, {
    blockId: block.id,
    actorId: "owner",
    nowMs: NOW,
  });
  assert.equal(
    raw.prepare("SELECT status FROM users WHERE id='buyer'").get().status,
    "active",
  );
  await assert.rejects(
    ops.recordRiskSignal(db, {
      subjectType: "ip_network",
      subjectReference: "hash",
      signalType: "velocity",
      severity: "temporary_block",
      actorId: "owner",
    }),
    /cannot create an indefinite/,
  );
  assert.equal(
    (
      await ops.recordRiskSignal(db, {
        subjectType: "ip_network",
        subjectReference: "hash",
        signalType: "velocity",
        severity: "review",
        actorId: "owner",
      })
    ).permanentIdentityBlock,
    false,
  );
  await assert.rejects(
    ops.requestPayout(db, {
      creatorId: "creator",
      amountCents: 999,
      nowMs: NOW,
    }),
    /at least \$10/,
  );
  let p = await ops.requestPayout(db, {
    creatorId: "creator",
    amountCents: 1000,
    nowMs: NOW,
  });
  await assert.rejects(
    ops.requestPayout(db, {
      creatorId: "creator",
      amountCents: 1000,
      nowMs: NOW,
    }),
    /pending/,
  );
  await ops.failPayout(db, {
    requestId: p.id,
    reason: "provider failure",
    actorId: "owner",
    nowMs: NOW,
  });
  assert.equal(
    raw
      .prepare(
        "SELECT status FROM creator_payout_reservations WHERE payout_request_id=?",
      )
      .get(p.id).status,
    "released",
  );
  let close = await ops.requestPayout(db, {
    creatorId: "creator",
    accountClosure: true,
    nowMs: NOW,
  });
  assert.ok(close.amountCents > 0);
  assert.equal(close.externalTransferExecuted, false);
  const listed = await ops.listOperations(db, { creatorId: "creator" });
  assert.equal(listed.remediations.length, 2);
  assert.ok(
    raw.prepare("SELECT COUNT(*) n FROM marketplace_notice_outbox").get().n >=
      8,
  );
  assert.ok(
    raw.prepare("SELECT COUNT(*) n FROM marketplace_operations_audit").get()
      .n >= 5,
  );
  console.log("Marketplace operations completion tests passed.");
}
function load(n) {
  return import(pathToFileURL(path.join(ROOT, n)).href + `?x=${Math.random()}`);
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
            meta: {
              changes: Number(x.changes),
              last_row_id: Number(x.lastInsertRowid),
            },
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
