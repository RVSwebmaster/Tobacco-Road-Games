const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATHS = [
  path.join(ROOT, "migrations", "001_direct_storefront.sql"),
  path.join(ROOT, "migrations", "003_checkout_attempt_idempotency.sql"),
  path.join(ROOT, "migrations", "004_verified_stripe_webhooks.sql")
];
const NOW = Date.parse("2026-07-14T16:00:00.000Z");
const WEBHOOK_SECRET = "whsec_test_signing_secret";
const STRIPE_API_VERSION = "2026-02-25.clover";
let fixtureSequence = 0;
let eventSequence = 0;

async function main() {
  const webhook = await importModule("functions/_lib/stripe-webhook.mjs");
  const ordersD1 = await importModule("functions/_lib/orders-d1.mjs");

  await testSignaturesAndCompletedUnpaid(webhook, ordersD1);
  await testCompletedPaidAndDuplicate(webhook, ordersD1);
  await testFailedProcessingThenRetry(webhook, ordersD1);
  await testAsyncSuccessAndFailure(webhook, ordersD1);
  await testUnknownOrder(webhook, ordersD1);
  await testReconciliationMismatches(webhook, ordersD1);
  await testLiveAndVersionRejection(webhook, ordersD1);
  await testExpirationAndFailureOrdering(webhook, ordersD1);

  console.log("Stripe webhook tests passed.");
}

async function testSignaturesAndCompletedUnpaid(webhook, ordersD1) {
  const fixture = await createFixture(ordersD1);
  const event = makeEvent(fixture.order, {
    paymentIntent: null,
    paymentStatus: "unpaid",
    type: "checkout.session.completed"
  });
  const rawBody = JSON.stringify(event);

  let response = await webhook.handleStripeWebhookRequest(new Request("https://example.com/api/stripe/webhook", {
    body: rawBody,
    headers: { "stripe-signature": `t=${Math.floor(NOW / 1000)},v1=${"0".repeat(64)}` },
    method: "POST"
  }), webhookEnv(fixture.d1), { nowMs: NOW });
  assert.equal(response.status, 400, "Invalid webhook signatures must be rejected.");
  assert.equal(await countRows(fixture.d1, "webhook_events"), 0, "Unverified payloads must not be recorded or processed.");

  response = await webhook.handleStripeWebhookRequest(new Request("https://example.com/api/stripe/webhook", {
    body: rawBody,
    method: "POST"
  }), webhookEnv(fixture.d1), { nowMs: NOW });
  assert.equal(response.status, 400, "Missing Stripe-Signature headers must be rejected.");

  response = await deliver(webhook, fixture.d1, event);
  assert.equal(response.status, 200, "A valid signed completed event should be accepted.");
  const body = await response.json();
  assert.equal(body.processingResult, "completed_unpaid", "A completed but unpaid Session must remain unpaid.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "pending", "Completed but unpaid Sessions must not mark orders paid.");

  const missingSecretResponse = await deliver(webhook, fixture.d1, makeEvent(fixture.order), {
    STRIPE_WEBHOOK_SECRET: ""
  });
  assert.equal(missingSecretResponse.status, 503, "The webhook must require STRIPE_WEBHOOK_SECRET.");
}

async function testCompletedPaidAndDuplicate(webhook, ordersD1) {
  const fixture = await createFixture(ordersD1);
  const event = makeEvent(fixture.order, { type: "checkout.session.completed" });

  let response = await deliver(webhook, fixture.d1, event);
  assert.equal(response.status, 200, "A verified paid completion should succeed.");
  let order = await getOrder(fixture.d1, fixture.order.id);
  assert.equal(order.payment_status, "paid", "A matching paid Session should mark the order paid.");
  assert.equal(order.stripe_payment_intent_id, event.data.object.payment_intent, "The Payment Intent ID should be attached to the paid order.");
  assert.equal(order.paid_at, new Date(event.created * 1000).toISOString(), "The paid timestamp should come from the verified Stripe Event.");

  response = await deliver(webhook, fixture.d1, event);
  assert.equal(response.status, 200, "Duplicate successful deliveries should return success.");
  const duplicateBody = await response.json();
  assert.equal(duplicateBody.duplicate, true, "Duplicate deliveries should be identified as no-ops.");
  assert.equal(await countRows(fixture.d1, "webhook_events"), 1, "Duplicate deliveries must keep one unique webhook record.");
  const record = await getOnlyWebhookEvent(fixture.d1);
  assert.equal(record.processing_status, "processed", "The unique webhook record should remain processed.");
  assert.equal(record.attempt_count, 1, "A duplicate processed event must not be processed twice.");
}

async function testFailedProcessingThenRetry(webhook, ordersD1) {
  const fixture = await createFixture(ordersD1);
  const event = makeEvent(fixture.order, { type: "checkout.session.completed" });
  let rejectNextBatch = true;
  const flakyD1 = {
    ...fixture.d1,
    async batch(statements) {
      if (rejectNextBatch) {
        rejectNextBatch = false;
        throw new Error("synthetic D1 finalization failure");
      }
      return fixture.d1.batch(statements);
    }
  };

  let response = await deliver(webhook, flakyD1, event);
  assert.equal(response.status, 500, "Atomic finalization failures should ask Stripe to retry.");
  let record = await getOnlyWebhookEvent(fixture.d1);
  assert.equal(record.processing_status, "failed", "A processing failure should remain recorded and retryable.");
  assert.equal(record.failure_code, "webhook_finalization_failed", "Retryable database failures should have a safe classification.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "pending", "A failed atomic finalization must leave the order unpaid.");

  response = await deliver(webhook, flakyD1, event);
  assert.equal(response.status, 200, "Stripe retry should be able to finish a previously failed event.");
  record = await getOnlyWebhookEvent(fixture.d1);
  assert.equal(record.processing_status, "processed", "The retried event should reach processed status.");
  assert.equal(record.attempt_count, 2, "The same unique event record should count both processing attempts.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "paid", "The successful retry should mark the original order paid.");
}

async function testAsyncSuccessAndFailure(webhook, ordersD1) {
  const successFixture = await createFixture(ordersD1);
  let response = await deliver(webhook, successFixture.d1, makeEvent(successFixture.order, {
    type: "checkout.session.async_payment_succeeded"
  }));
  assert.equal(response.status, 200, "Asynchronous payment success should be processed.");
  assert.equal((await getOrder(successFixture.d1, successFixture.order.id)).payment_status, "paid", "Asynchronous success should mark a matching paid Session paid.");

  const failureFixture = await createFixture(ordersD1);
  response = await deliver(webhook, failureFixture.d1, makeEvent(failureFixture.order, {
    paymentStatus: "unpaid",
    type: "checkout.session.async_payment_failed"
  }));
  assert.equal(response.status, 200, "Asynchronous payment failure should be processed.");
  assert.equal((await getOrder(failureFixture.d1, failureFixture.order.id)).payment_status, "failed", "Asynchronous failure should move a pending order to failed.");
}

async function testUnknownOrder(webhook, ordersD1) {
  const fixture = await createFixture(ordersD1);
  const event = makeEvent(fixture.order, {
    metadata: { trg_order_id: "999999" }
  });
  const response = await deliver(webhook, fixture.d1, event);
  assert.equal(response.status, 400, "Unknown TRG order metadata should fail safely.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "pending", "Unknown metadata must not alter another order.");
  const record = await getOnlyWebhookEvent(fixture.d1);
  assert.equal(record.processing_status, "failed", "Unknown order events should be reviewable failures.");
  assert.equal(record.failure_code, "unknown_trg_order", "Unknown order failures should have a safe classification.");
}

async function testReconciliationMismatches(webhook, ordersD1) {
  const scenarios = [
    ["checkout_session_id_mismatch", { session: { id: "cs_test_wrong" } }],
    ["amount_total_mismatch", { session: { amount_total: 401 } }],
    ["currency_mismatch", { session: { currency: "cad" } }],
    ["payment_intent_id_mismatch", { existingPaymentIntentId: "pi_test_original", paymentIntent: "pi_test_different" }]
  ];

  for (const [expectedCode, scenario] of scenarios) {
    const fixture = await createFixture(ordersD1);
    if (scenario.existingPaymentIntentId) {
      await ordersD1.updateOrderPaymentStatus(fixture.d1, Number(fixture.order.id), {
        stripePaymentIntentId: scenario.existingPaymentIntentId
      });
    }
    const event = makeEvent(fixture.order, {
      paymentIntent: scenario.paymentIntent,
      session: scenario.session
    });
    const response = await deliver(webhook, fixture.d1, event);
    assert.equal(response.status, 400, `${expectedCode} should fail safely.`);
    assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "pending", `${expectedCode} must leave the order unpaid.`);
    assert.equal((await getOnlyWebhookEvent(fixture.d1)).failure_code, expectedCode, `${expectedCode} should be reviewable in D1.`);
  }
}

async function testLiveAndVersionRejection(webhook, ordersD1) {
  let fixture = await createFixture(ordersD1);
  let response = await deliver(webhook, fixture.d1, makeEvent(fixture.order, {
    livemode: true,
    session: { livemode: true }
  }));
  assert.equal(response.status, 400, "Live-mode Events must be rejected by staging.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "pending", "Rejected live Events must leave staging orders unpaid.");
  assert.equal((await getOnlyWebhookEvent(fixture.d1)).failure_code, "live_mode_rejected", "Live-mode rejection should be reviewable.");

  fixture = await createFixture(ordersD1);
  response = await deliver(webhook, fixture.d1, makeEvent(fixture.order, {
    apiVersion: "2025-06-30.basil"
  }));
  assert.equal(response.status, 400, "Webhook Events using an unpinned API version must be rejected.");
  assert.equal((await getOnlyWebhookEvent(fixture.d1)).failure_code, "stripe_api_version_mismatch", "API version rejection should be reviewable.");
}

async function testExpirationAndFailureOrdering(webhook, ordersD1) {
  let fixture = await createFixture(ordersD1);
  let response = await deliver(webhook, fixture.d1, makeEvent(fixture.order, {
    paymentIntent: null,
    paymentStatus: "unpaid",
    type: "checkout.session.expired"
  }));
  assert.equal(response.status, 200, "Session expiration should be processed.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "expired", "Expiration before payment should expire a pending order.");

  fixture = await createFixture(ordersD1);
  await ordersD1.updateOrderPaymentStatus(fixture.d1, Number(fixture.order.id), {
    paidAt: "2026-07-14T15:59:00.000Z",
    paymentStatus: "paid",
    stripePaymentIntentId: "pi_test_paid_first"
  });
  response = await deliver(webhook, fixture.d1, makeEvent(fixture.order, {
    paymentIntent: "pi_test_paid_first",
    paymentStatus: "unpaid",
    type: "checkout.session.expired"
  }));
  assert.equal(response.status, 200, "Expiration after payment should be an accepted no-op.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "paid", "Expiration must never overwrite a paid order.");

  response = await deliver(webhook, fixture.d1, makeEvent(fixture.order, {
    paymentIntent: "pi_test_paid_first",
    paymentStatus: "unpaid",
    type: "checkout.session.async_payment_failed"
  }));
  assert.equal(response.status, 200, "Asynchronous failure after payment should be an accepted no-op.");
  assert.equal((await getOrder(fixture.d1, fixture.order.id)).payment_status, "paid", "Asynchronous failure must never overwrite a paid order.");
}

async function createFixture(ordersD1) {
  fixtureSequence += 1;
  const { d1 } = createD1Database();
  const suffix = String(fixtureSequence).padStart(4, "0");
  const order = await ordersD1.createPendingOrder(d1, {
    checkoutAttemptId: `trgca_00000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    checkoutRequestHash: String(fixtureSequence).padStart(64, "0"),
    currency: "USD",
    customerEmail: "buyer@example.com",
    customerEmailHash: `hash-${suffix}`,
    customerEmailNormalized: "buyer@example.com",
    publicId: `TRG-WEBHOOK-${suffix}`,
    subtotalCents: 400,
    totalCents: 400
  }, [{
    authorSlugsJson: JSON.stringify(["rv-sawyer"]),
    currency: "USD",
    effectiveUnitPriceCents: 400,
    lastUpdatedSnapshot: "2026-07-01",
    lineTotalCents: 400,
    listPriceCents: 500,
    primaryAuthorSlug: "rv-sawyer",
    productSlug: "agency",
    productTitleSnapshot: "Agency",
    quantity: 1,
    versionSnapshot: "2026.1"
  }]);
  const attached = await ordersD1.attachStripeCheckoutSession(d1, Number(order.id), {
    id: `cs_test_webhook_${suffix}`,
    url: `https://checkout.stripe.com/c/pay/cs_test_webhook_${suffix}`
  }, { updatedAt: "2026-07-14T15:55:00.000Z" });
  return { d1, order: attached };
}

function makeEvent(order, overrides = {}) {
  eventSequence += 1;
  const baseMetadata = {
    trg_checkout_attempt_id: order.checkout_attempt_id,
    trg_order_id: String(order.id),
    trg_order_public_id: order.public_id
  };
  const sessionOverrides = overrides.session || {};
  return {
    api_version: overrides.apiVersion || STRIPE_API_VERSION,
    created: Math.floor(NOW / 1000) + eventSequence,
    data: {
      object: {
        amount_total: 400,
        currency: "usd",
        id: order.stripe_checkout_session_id,
        livemode: false,
        metadata: { ...baseMetadata, ...(overrides.metadata || {}), ...(sessionOverrides.metadata || {}) },
        object: "checkout.session",
        payment_intent: overrides.paymentIntent === undefined ? `pi_test_${eventSequence}` : overrides.paymentIntent,
        payment_status: overrides.paymentStatus || "paid",
        ...sessionOverrides
      }
    },
    id: overrides.id || `evt_test_${String(eventSequence).padStart(6, "0")}`,
    livemode: overrides.livemode === undefined ? false : overrides.livemode,
    object: "event",
    type: overrides.type || "checkout.session.completed"
  };
}

async function deliver(webhook, d1, event, envOverrides = {}) {
  const rawBody = JSON.stringify(event);
  const signature = await signPayload(rawBody, WEBHOOK_SECRET, Math.floor(NOW / 1000));
  return webhook.handleStripeWebhookRequest(new Request("https://example.com/api/stripe/webhook", {
    body: rawBody,
    headers: { "stripe-signature": signature },
    method: "POST"
  }), { ...webhookEnv(d1), ...envOverrides }, { nowMs: NOW });
}

function webhookEnv(d1) {
  return {
    PAYMENT_PIPELINE_STAGE: "staging",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TRG_ORDERS: d1
  };
}

async function signPayload(rawBody, secret, timestamp) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  ));
  return `t=${timestamp},v1=${Buffer.from(signature).toString("hex")}`;
}

function createD1Database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const migrationPath of MIGRATION_PATHS) {
    raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  return { d1: createD1Adapter(raw), raw };
}

function createD1Adapter(raw) {
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE TRANSACTION");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      return createPreparedStatement(raw.prepare(sql));
    }
  };
}

function createPreparedStatement(statement, boundValues = []) {
  return {
    all() {
      return Promise.resolve({ results: statement.all(...boundValues) });
    },
    bind(...values) {
      return createPreparedStatement(statement, values);
    },
    first() {
      return Promise.resolve(statement.get(...boundValues) || null);
    },
    run() {
      const result = statement.run(...boundValues);
      return Promise.resolve({
        meta: {
          changes: Number(result.changes ?? 0),
          last_row_id: Number(result.lastInsertRowid ?? 0)
        }
      });
    }
  };
}

async function getOrder(d1, orderId) {
  return d1.prepare("SELECT * FROM orders WHERE id = ?").bind(Number(orderId)).first();
}

async function getOnlyWebhookEvent(d1) {
  const result = await d1.prepare("SELECT * FROM webhook_events").all();
  assert.equal(result.results.length, 1, "Expected exactly one webhook event record.");
  return result.results[0];
}

async function countRows(d1, tableName) {
  const row = await d1.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
  return Number(row?.count || 0);
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

