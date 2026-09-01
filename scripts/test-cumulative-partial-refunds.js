const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ISO = "2026-09-01T12:00:00.000Z";

async function main() {
  const finance = await load("functions/_lib/creator-finance.mjs");
  const provider = await load("functions/_lib/creator-provider-finance.mjs");
  const cases = [
    [101, 2000],
    [333, 2000],
    [1001, 2000],
    [2001, 2000],
    [101, 1000],
    [333, 1000],
    [1001, 1000],
    [2001, 1000],
  ];
  for (const [gross, feeBps] of cases) {
    for (const sequence of partitions(gross))
      await verifyDirect(finance, gross, feeBps, sequence);
  }
  await verifyDirect(finance, 1001, 2000, Array(1001).fill(1));
  await verifyProvider(provider, 1001, 2000, Array(1001).fill(1));
  await verifyProvider(provider, 1001, 2000, [1, 1000]);
  await verifyProvider(provider, 1001, 1000, [333, 333, 335]);
  await verifyConcurrency(finance);
  console.log("Cumulative partial-refund allocation tests passed.");
}

async function verifyDirect(finance, gross, feeBps, sequence) {
  const fixture = createFixture(gross, feeBps, `direct-${gross}-${feeBps}`);
  for (let index = 0; index < sequence.length; index++) {
    const eventId = `direct-${gross}-${feeBps}-${sequence.join("-")}-${index}`;
    const result = await finance.recordOrderReversal(fixture.db, {
      orderId: fixture.orderId,
      amountCents: sequence[index],
      eventId,
      createdAt: ISO,
    });
    if (index === 0) {
      const replay = await finance.recordOrderReversal(fixture.db, {
        orderId: fixture.orderId,
        amountCents: sequence[index],
        eventId,
        createdAt: ISO,
      });
      assert.deepEqual(replay, []);
    }
    assertEventConservation(fixture.raw, eventId, sequence[index]);
  }
  assertFinal(fixture);
  await assert.rejects(
    () =>
      finance.recordOrderReversal(fixture.db, {
        orderId: fixture.orderId,
        amountCents: 1,
        eventId: `over-${gross}-${feeBps}-${sequence.join("-")}`,
        createdAt: ISO,
      }),
    /exceeds/,
  );
}

async function verifyProvider(provider, gross, feeBps, sequence) {
  const fixture = createFixture(gross, feeBps, `provider-${gross}-${feeBps}`);
  for (let index = 0; index < sequence.length; index++) {
    const event = providerEvent(
      `provider-${gross}-${feeBps}-${index}`,
      fixture.paymentIntent,
      sequence[index],
    );
    const result = await provider.processStripeCreatorFinanceEvent(
      fixture.db,
      event,
      { createdAt: ISO },
    );
    assert.equal(result.duplicate, false);
    if (index === 0) {
      const replay = await provider.processStripeCreatorFinanceEvent(
        fixture.db,
        event,
        { createdAt: ISO },
      );
      assert.equal(replay.duplicate, true);
    }
    assertEventConservation(fixture.raw, event.id, sequence[index]);
  }
  assertFinal(fixture);
  await assert.rejects(
    () =>
      provider.processStripeCreatorFinanceEvent(
        fixture.db,
        providerEvent(
          `provider-over-${gross}-${feeBps}`,
          fixture.paymentIntent,
          1,
        ),
        { createdAt: ISO },
      ),
    /exceed/,
  );
}

async function verifyConcurrency(finance) {
  const fixture = createFixture(1001, 2000, "concurrency");
  const attempts = await Promise.allSettled([
    finance.recordOrderReversal(fixture.db, {
      orderId: fixture.orderId,
      amountCents: 333,
      eventId: "concurrent-a",
      createdAt: ISO,
    }),
    finance.recordOrderReversal(fixture.db, {
      orderId: fixture.orderId,
      amountCents: 333,
      eventId: "concurrent-b",
      createdAt: ISO,
    }),
  ]);
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((x) => x.status === "rejected").length, 1);
  const failedId =
    attempts[0].status === "rejected" ? "concurrent-a" : "concurrent-b";
  await finance.recordOrderReversal(fixture.db, {
    orderId: fixture.orderId,
    amountCents: 333,
    eventId: failedId,
    createdAt: ISO,
  });
  await finance.recordOrderReversal(fixture.db, {
    orderId: fixture.orderId,
    amountCents: 335,
    eventId: "concurrent-final",
    createdAt: ISO,
  });
  assertFinal(fixture);
}

function createFixture(gross, feeBps, label) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const creatorId = `creator-${label}`;
  const paymentIntent = `pi-${label}`;
  raw
    .prepare(
      "INSERT INTO marketplace_creators(id,slug,display_name,short_bio,marketplace_status,created_at,updated_at)VALUES(?,?,?,'test','approved',?,?)",
    )
    .run(creatorId, creatorId, creatorId, ISO, ISO);
  const orderId = Number(
    raw
      .prepare(
        "INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,stripe_payment_intent_id,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at)VALUES(?,'x@test.invalid','x@test.invalid','h',?,'USD',?,?,'paid','ready','sent',?,?)",
      )
      .run(`ORDER-${label}`, paymentIntent, gross, gross, ISO, ISO)
      .lastInsertRowid,
  );
  const itemId = Number(
    raw
      .prepare(
        "INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at)VALUES(?,'p','P',?,'[]',1,?,?,?,'USD','1',?,?)",
      )
      .run(orderId, creatorId, gross, gross, gross, ISO, ISO).lastInsertRowid,
  );
  const fee = Math.round((gross * feeBps) / 10000);
  const creatorNet = gross - fee;
  raw
    .prepare(
      "INSERT INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at,policy_reason)VALUES(?,?,?,'p','P',?,?,1,0,?,?,0,?,?,'USD',?,'fixture')",
    )
    .run(
      orderId,
      itemId,
      creatorId,
      gross,
      gross,
      gross,
      feeBps,
      fee,
      creatorNet,
      ISO,
    );
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at)VALUES(?,'sale_earning',?,'USD',?,?,'p',?,'available','sale',?,?)",
    )
    .run(creatorId, creatorNet, orderId, itemId, ISO, `sale:${label}`, ISO);
  return {
    raw,
    db: d1(raw),
    creatorId,
    orderId,
    itemId,
    paymentIntent,
    gross,
    fee,
    creatorNet,
  };
}

function assertEventConservation(raw, eventId, gross) {
  const row = raw
    .prepare(
      "SELECT COALESCE(SUM(gross_reversed_cents),0) gross,COALESCE(SUM(creator_net_reversed_cents),0) creator FROM creator_reversal_snapshots WHERE provider_event_id=?",
    )
    .get(eventId);
  assert.equal(Number(row.gross), gross);
  assert.ok(Number.isInteger(Number(row.creator)));
  assert.ok(Number(row.creator) >= 0);
  assert.ok(Number(row.creator) <= gross);
  assert.equal(Number(row.creator) + (gross - Number(row.creator)), gross);
}

function assertFinal(fixture) {
  const row = fixture.raw
    .prepare(
      "SELECT SUM(gross_reversed_cents) gross,SUM(creator_net_reversed_cents) creator,SUM(gross_reversed_cents-creator_net_reversed_cents) trg FROM creator_reversal_snapshots WHERE order_item_id=?",
    )
    .get(fixture.itemId);
  assert.equal(Number(row.gross), fixture.gross);
  assert.equal(Number(row.creator), fixture.creatorNet);
  assert.equal(Number(row.trg), fixture.fee);
  const ledger = fixture.raw
    .prepare(
      "SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE creator_id=?",
    )
    .get(fixture.creatorId);
  assert.equal(Number(ledger.amount), 0);
}

function partitions(gross) {
  const sequences = [[gross]];
  if (gross > 1) sequences.push([1, gross - 1]);
  const firstHalf = Math.floor(gross / 2);
  sequences.push([firstHalf, gross - firstHalf]);
  const third = Math.floor(gross / 3);
  sequences.push([third, third, gross - third * 2]);
  const hundreds = [];
  let remaining = gross;
  while (remaining > 100) {
    hundreds.push(100);
    remaining -= 100;
  }
  if (remaining) hundreds.push(remaining);
  sequences.push(hundreds);
  if (gross > 10) sequences.push([3, 7, gross - 10]);
  return sequences;
}

function providerEvent(id, paymentIntent, amount) {
  return {
    id,
    type: "refund.created",
    data: {
      object: {
        id: `re-${id}`,
        payment_intent: paymentIntent,
        currency: "usd",
        amount,
      },
    },
  };
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
          return { meta: { changes: Number(result.changes) } };
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

function load(file) {
  return import(
    pathToFileURL(path.join(ROOT, file)).href + `?${Math.random()}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
