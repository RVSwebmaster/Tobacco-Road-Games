const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-18T20:00:00.000Z");
const EMAIL_SECRET = "isolated-native-earnings-email";
const COOKIE_SECRET = "isolated-native-earnings-cookie";
const WEBHOOK_SECRET = "whsec_native_earnings_isolated";
const API_VERSION = "2026-06-24.dahlia";
let sequence = 0;

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const preparation = await load("functions/_lib/native-order-preparation.mjs");
  const payment = await load("functions/_lib/native-stripe-payment.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const finance = await load("functions/_lib/creator-finance.mjs");
  const providerFinance = await load("functions/_lib/creator-provider-finance.mjs");
  const stripeFees = await load("functions/_lib/stripe-order-fees.mjs");
  const freeAcquisition = await load("functions/_lib/native-free-acquisition.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  raw.prepare(`INSERT INTO marketplace_creators(
    id,slug,display_name,short_bio,marketplace_status,registration_status,closure_state,created_at,updated_at
  ) VALUES('creator-earnings-b','earnings-b','Earnings Creator B','Isolated test seller','approved','active','active',?,?)`)
    .run(ISO(), ISO());

  const product = (id, creatorId, slug, title, overrides = {}) => catalog.createProduct(db, {
    id, slug, creatorId, title, publicationState: "published", status: "available-direct", buyMode: "cart",
    pricingModel: "fixed", priceCents: 1001, currency: "USD", publishedAt: "2020-01-01T00:00:00.000Z",
    coverR2Key: `catalog-publications/native-earnings/${slug}/cover.webp`,
    deliveryR2Key: `catalog-publications/native-earnings/${slug}/delivery.pdf`,
    deliveryFilename: `${slug}.pdf`, deliveryContentType: "application/pdf",
    metadata: { authors: [creatorId], authorSlugs: [creatorId], version: "1.0" },
    ...overrides
  }, { nowMs: NOW });

  await product("earnings-single", "creator-rv-sawyer", "earnings-single", "Single Creator Fixed");
  await product("earnings-mixed-b", "creator-earnings-b", "earnings-mixed-b", "Mixed Creator B", { priceCents: 777 });
  await product("earnings-pwyw", "creator-rv-sawyer", "earnings-pwyw", "Positive PWYW", {
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 700,
    minimumPriceCents: 250, suggestedPriceCents: 700
  });
  await product("earnings-free", "creator-earnings-b", "earnings-free", "Zero Price", {
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0
  });
  await product("earnings-departure", "creator-earnings-b", "earnings-departure", "Creator Departure Snapshot", { priceCents: 1000 });
  await product("earnings-dispute-won", "creator-rv-sawyer", "earnings-dispute-won", "Dispute Won", { priceCents: 1000 });
  await product("earnings-dispute-lost", "creator-rv-sawyer", "earnings-dispute-lost", "Dispute Lost", { priceCents: 1000 });

  // Single-Creator fixed-price sale: the existing fee schedule, integer rounding,
  // sale statement, and ledger are written from the verified paid webhook.
  const single = await prepareOrder(preparation, db, [{ slug: "earnings-single" }]);
  const singlePaid = await payAndSettle(payment, webhook, db, single, stripeFees);
  assert.deepEqual(singlePaid.sales.map(row => [row.creator_id, row.gross_cents, row.marketplace_fee_cents, row.creator_net_cents]), [
    ["creator-rv-sawyer", 1001, 100, 901]
  ]);
  const noOpRecovery = await finance.repairNativePaidOrderAccounting(db, single.order.id, { nowMs: NOW });
  assert.equal(noOpRecovery.ready, true);
  assert.equal(noOpRecovery.repaired, false, "Repeated Owner accounting recovery must be a no-op when entries already exist.");
  assertOrderReconciles(raw, single.order.id);

  // Mixed-Creator cart and concurrent/duplicate paid events remain one order,
  // one immutable sale per item, and one ledger earning per item.
  const mixed = await prepareOrder(preparation, db, [{ slug: "earnings-single" }, { slug: "earnings-mixed-b" }]);
  const mixedSession = await startPayment(payment, db, mixed);
  const mixedStored = orderByAttempt(raw, mixed.attempt);
  const eventA = stripeEvent(mixedStored, `evt_native_earnings_concurrent_a_${++sequence}`);
  const eventB = stripeEvent(mixedStored, `evt_native_earnings_concurrent_b_${++sequence}`);
  const concurrent = await Promise.all([deliverWebhook(webhook, db, eventA), deliverWebhook(webhook, db, eventB)]);
  for (const response of concurrent) assert.ok([200, 409].includes(response.status), `Concurrent delivery returned ${response.status}: ${await response.clone().text()}`);
  for (let index = 0; index < concurrent.length; index += 1) {
    if (concurrent[index].status === 409) concurrent[index] = await deliverWebhook(webhook, db, index === 0 ? eventA : eventB);
    assert.equal(concurrent[index].status, 200);
  }
  await deliverWebhook(webhook, db, eventA);
  await reconcileTestFee(stripeFees, db, mixedStored);
  assert.equal(mixedSession.calls.length, 1);
  assert.equal(count(raw, "orders", "checkout_attempt_id", mixed.attempt), 1);
  assert.equal(count(raw, "creator_sale_snapshots", "order_id", mixedStored.id), 2);
  assert.equal(count(raw, "creator_earnings_ledger", "order_id", mixedStored.id, "sale_earning"), 2);
  assert.deepEqual(raw.prepare("SELECT creator_id,gross_cents,marketplace_fee_cents,creator_net_cents FROM creator_sale_snapshots WHERE order_id=? ORDER BY order_item_id")
    .all(mixedStored.id).map(row => [row.creator_id, row.gross_cents, row.marketplace_fee_cents, row.creator_net_cents]), [
      ["creator-rv-sawyer", 1001, 100, 901], ["creator-earnings-b", 777, 78, 699]
    ]);
  assertOrderReconciles(raw, mixedStored.id);

  // Positive PWYW earns on the actual selected cents. Zero-price acquisition
  // creates the ordinary entitlement but never invents Creator earnings.
  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at)
    VALUES('native-free-buyer','native-free-buyer@example.test',1,'active','user',?,?)`).run(ISO(), ISO());
  const freeAttempt = checkoutAttempt(++sequence);
  const freeResponse = await freeAcquisition.handleNativeFreeAcquisitionRequest(new Request("https://example.test/api/cart/acquire-free", {
    method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ checkoutAttemptId: freeAttempt, email: "native-free-buyer@example.test",
      emailConfirmation: "native-free-buyer@example.test", items: [{ slug: "earnings-free", quantity: 1 }] })
  }), { ...baseEnv(db), TRG_PRODUCTS: bucket() }, {
    accountSession: { valid: true, user: { id: "native-free-buyer", email: "native-free-buyer@example.test", email_verified: 1 } },
    now: NOW, skipIdentityChecks: true
  });
  assert.equal(freeResponse.status, 201, JSON.stringify(await freeResponse.clone().json()));
  const freeOrder = orderByAttempt(raw, freeAttempt);
  assert.equal(freeOrder.native_order_state, "free_acquired");
  assert.equal(count(raw, "creator_sale_snapshots", "order_id", freeOrder.id), 0);
  assert.equal(count(raw, "creator_earnings_ledger", "order_id", freeOrder.id, "sale_earning"), 0);

  const pwyw = await prepareOrder(preparation, db, [{ slug: "earnings-pwyw", amountCents: 525 }]);
  const pwywPaid = await payAndSettle(payment, webhook, db, pwyw, stripeFees);
  assert.deepEqual(pwywPaid.sales.map(row => [row.gross_cents, row.marketplace_fee_cents, row.creator_net_cents]), [[525, 53, 472]]);
  assertOrderReconciles(raw, pwyw.order.id);

  // The fee terms and Creator attribution are fixed in the immutable order-item
  // snapshot. Subsequent catalog revision and Creator departure do not change it.
  raw.prepare(`INSERT INTO creator_preferred_terms(
    id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at
  ) VALUES('earnings-preferred-term','creator-earnings-b','annual_prepaid',20000,'2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z','renews','active',?,?)`)
    .run(ISO(), ISO());
  const departure = await prepareOrder(preparation, db, [{ slug: "earnings-departure" }]);
  const departureSession = await startPayment(payment, db, departure);
  const departureOrder = orderByAttempt(raw, departure.attempt);
  const departureItem = raw.prepare("SELECT * FROM order_items WHERE order_id=?").get(departureOrder.id);
  assert.equal(departureItem.native_creator_id, "creator-earnings-b");
  assert.equal(departureItem.creator_fee_basis_points_snapshot, 500);
  assert.equal(departureItem.creator_fee_policy_reason_snapshot, "premier");
  assert.throws(() => raw.prepare("UPDATE order_items SET creator_fee_basis_points_snapshot=2000 WHERE id=?").run(departureItem.id),
    /immutable|snapshot/i, "Stored checkout accounting terms must not be editable after preparation.");
  const currentProduct = await catalog.getProductById(db, "earnings-departure");
  await catalog.updateProduct(db, currentProduct.id, { priceCents: 2500, title: "Revised After Checkout" }, {
    expectedRevision: currentProduct.revision, nowMs: NOW + 1000
  });
  raw.prepare("UPDATE creator_preferred_terms SET status='inactive',updated_at=? WHERE id='earnings-preferred-term'").run(new Date(NOW + 1000).toISOString());
  raw.prepare("UPDATE marketplace_creators SET marketplace_status='suspended',registration_status='suspended',updated_at=? WHERE id='creator-earnings-b'")
    .run(new Date(NOW + 1000).toISOString());
  const departureResult = await deliverWebhook(webhook, db, stripeEvent(departureOrder, `evt_native_departure_${++sequence}`));
  assert.equal(departureResult.status, 200);
  await reconcileTestFee(stripeFees, db, departureOrder);
  const departureSale = raw.prepare("SELECT * FROM creator_sale_snapshots WHERE order_id=?").get(departureOrder.id);
  assert.deepEqual([departureSale.creator_id, departureSale.product_title, departureSale.gross_cents,
    departureSale.fee_basis_points, departureSale.policy_reason, departureSale.marketplace_fee_cents, departureSale.creator_net_cents],
    ["creator-earnings-b", "Creator Departure Snapshot", 1000, 500, "premier", 50, 950]);
  assert.equal(departureSession.calls.length, 1);
  assertOrderReconciles(raw, departureOrder.id);

  // If sale-statement insertion fails, D1 rolls back the payment transition and
  // Stripe's retryable event can safely settle the same order exactly once.
  raw.prepare("UPDATE marketplace_creators SET marketplace_status='approved',registration_status='active',updated_at=? WHERE id='creator-earnings-b'")
    .run(new Date(NOW + 2000).toISOString());
  const interrupted = await prepareOrder(preparation, db, [{ slug: "earnings-mixed-b" }]);
  await startPayment(payment, db, interrupted);
  const interruptedOrder = orderByAttempt(raw, interrupted.attempt);
  const interruptedEvent = stripeEvent(interruptedOrder, `evt_native_accounting_retry_${++sequence}`);
  db.failAccountingOnce = true;
  let interruptedResponse = await deliverWebhook(webhook, db, interruptedEvent);
  assert.equal(interruptedResponse.status, 500);
  assert.equal(orderByAttempt(raw, interrupted.attempt).payment_status, "pending");
  assert.equal(count(raw, "creator_sale_snapshots", "order_id", interruptedOrder.id), 0);
  assert.equal(count(raw, "creator_earnings_ledger", "order_id", interruptedOrder.id, "sale_earning"), 0);
  interruptedResponse = await deliverWebhook(webhook, db, interruptedEvent);
  assert.equal(interruptedResponse.status, 200);
  assert.equal(orderByAttempt(raw, interrupted.attempt).payment_status, "paid");
  assert.equal(count(raw, "creator_sale_snapshots", "order_id", interruptedOrder.id), 1);
  assert.equal(count(raw, "creator_earnings_ledger", "order_id", interruptedOrder.id, "sale_earning"), 1);
  await reconcileTestFee(stripeFees, db, interruptedOrder);
  assertOrderReconciles(raw, interruptedOrder.id);

  // Partial and full refunds reuse the existing provider allocation and reversal
  // ledger. Replayed provider events do not add another reversal.
  const refundOrder = orderByAttempt(raw, mixed.attempt);
  const refund1 = providerEvent(`evt_native_refund_part_${++sequence}`, "refund.created", refundOrder, {
    id: `re_native_part_${sequence}`, amount: 500
  });
  const firstRefund = await providerFinance.processStripeCreatorFinanceEvent(db, refund1, { createdAt: ISO() });
  assert.equal(firstRefund.action, "refund_reversed");
  assert.equal((await providerFinance.processStripeCreatorFinanceEvent(db, refund1, { createdAt: ISO() })).duplicate, true);
  const refund2 = providerEvent(`evt_native_refund_rest_${++sequence}`, "refund.created", refundOrder, {
    id: `re_native_rest_${sequence}`, amount: Number(refundOrder.total_cents) - 500
  });
  assert.equal((await providerFinance.processStripeCreatorFinanceEvent(db, refund2, { createdAt: ISO() })).action, "refund_reversed");
  assert.equal(raw.prepare("SELECT payment_status FROM orders WHERE id=?").get(refundOrder.id).payment_status, "refunded");
  assert.equal(raw.prepare("SELECT SUM(gross_reversed_cents) gross,SUM(creator_net_reversed_cents) net FROM creator_reversal_snapshots WHERE order_id=?")
    .get(refundOrder.id).gross, refundOrder.total_cents);
  for (const sale of raw.prepare("SELECT order_item_id,creator_net_cents FROM creator_sale_snapshots WHERE order_id=?").all(refundOrder.id)) {
    assert.equal(raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_item_id=? AND entry_type IN ('sale_earning','refund_reversal','manual_adjustment')")
      .get(sale.order_item_id).amount, -Number(raw.prepare("SELECT creator_absorbed_fee_cents FROM stripe_order_fee_allocations WHERE order_item_id=?").get(sale.order_item_id)?.creator_absorbed_fee_cents || 0), "A full refund retains the original nonrefundable processing fee allocation.");
    assert.equal(raw.prepare("SELECT SUM(creator_net_reversed_cents) amount FROM creator_reversal_snapshots WHERE order_item_id=?")
      .get(sale.order_item_id).amount, sale.creator_net_cents);
  }

  const won = await prepareOrder(preparation, db, [{ slug: "earnings-dispute-won" }]);
  await payAndSettle(payment, webhook, db, won, stripeFees);
  let wonOrder = orderByAttempt(raw, won.attempt);
  let eventResult = await providerFinance.processStripeCreatorFinanceEvent(db, providerEvent(
    `evt_native_dispute_open_won_${++sequence}`, "charge.dispute.created", wonOrder,
    { id: `dp_native_won_${sequence}`, amount: Number(wonOrder.total_cents) }
  ), { createdAt: ISO() });
  assert.equal(eventResult.action, "dispute_held");
  eventResult = await providerFinance.processStripeCreatorFinanceEvent(db, providerEvent(
    `evt_native_dispute_closed_won_${++sequence}`, "charge.dispute.closed", wonOrder,
    { id: `dp_native_won_${sequence - 1}`, amount: Number(wonOrder.total_cents), status: "won" }
  ), { createdAt: ISO() });
  assert.equal(eventResult.action, "dispute_released");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_reversal_snapshots WHERE order_id=?").get(wonOrder.id).n, 0);
  assert.equal(raw.prepare("SELECT payment_status FROM orders WHERE id=?").get(wonOrder.id).payment_status, "paid");

  const lost = await prepareOrder(preparation, db, [{ slug: "earnings-dispute-lost" }]);
  await payAndSettle(payment, webhook, db, lost, stripeFees);
  const lostOrder = orderByAttempt(raw, lost.attempt);
  const disputeId = `dp_native_lost_${++sequence}`;
  eventResult = await providerFinance.processStripeCreatorFinanceEvent(db, providerEvent(
    `evt_native_dispute_open_lost_${sequence}`, "charge.dispute.created", lostOrder,
    { id: disputeId, amount: Number(lostOrder.total_cents) }
  ), { createdAt: ISO() });
  assert.equal(eventResult.action, "dispute_held");
  eventResult = await providerFinance.processStripeCreatorFinanceEvent(db, providerEvent(
    `evt_native_dispute_closed_lost_${sequence}`, "charge.dispute.closed", lostOrder,
    { id: disputeId, amount: Number(lostOrder.total_cents), status: "lost", responsibility: "creator" }
  ), { createdAt: ISO() });
  assert.equal(eventResult.action, "creator_dispute_lost_reversed");
  assert.equal(raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_id=? AND entry_type IN ('sale_earning','chargeback_reversal','manual_adjustment')")
    .get(lostOrder.id).amount, -Number(raw.prepare("SELECT SUM(creator_absorbed_fee_cents) amount FROM stripe_order_fee_allocations WHERE order_id=?").get(lostOrder.id).amount || 0));
  assert.equal(raw.prepare("SELECT SUM(creator_net_reversed_cents) amount FROM creator_reversal_snapshots WHERE order_id=?").get(lostOrder.id).amount, 900);

  // A TRG-owned legacy line with no Creator identity remains house revenue and
  // never enters a Creator sale statement or earnings ledger.
  const houseOrder = insertTrgOwnedOrder(raw);
  const legacyStatements = await finance.creatorSaleStatements(db, houseOrder, {
    basisPoints: 2000, fixedLineFeeCents: 0, reserveDays: 14
  }, houseOrder.paid_at);
  assert.equal(legacyStatements.length, 0);
  const report = await finance.getOperatorFinance(db, { nowMs: NOW });
  assert.equal(report.houseRevenueCents, 900);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND entry_type='sale_earning'").get(houseOrder.id).n, 0);

  // Owner's existing financial report and reconciliation include native sales.
  const ownerReport = await finance.getOperatorFinance(db, { nowMs: NOW + 30 * 86400000 });
  const sellerA = ownerReport.balances.find(row => row.id === "creator-rv-sawyer");
  const sellerB = ownerReport.balances.find(row => row.id === "creator-earnings-b");
  assert.ok(sellerA && sellerB);
  assert.ok(sellerA.grossSalesCents >= 1001 + 525);
  assert.ok(sellerB.grossSalesCents >= 777 + 1000, JSON.stringify(sellerB));
  assert.equal(ownerReport.reconciliation.length, 0, JSON.stringify(ownerReport.reconciliation));

  // A legacy native paid order without the new policy snapshot is surfaced for
  // Owner review; the repair helper refuses to invent a rate or backfill it.
  const historical = insertHistoricalNativeOrder(raw);
  const candidates = await finance.reconcileCreatorFinance(db);
  assert.ok(candidates.some(item => item.code === "native_sale_policy_snapshot_missing" && item.order_id === historical.orderId));
  const heldRepair = await finance.repairNativePaidOrderAccounting(db, historical.orderId, { nowMs: NOW });
  assert.equal(heldRepair.ready, false);
  assert.equal(heldRepair.reason, "native_sale_policy_snapshot_missing");
  assert.equal(count(raw, "creator_sale_snapshots", "order_id", historical.orderId), 0);

  raw.close();
  console.log("Native Creator earnings integration tests passed.");
}

async function prepareOrder(preparation, db, items) {
  sequence += 1;
  const attempt = checkoutAttempt(sequence);
  const response = await preparation.handleNativeOrderPreparationRequest(new Request("https://example.test/api/cart/prepare-order", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkoutAttemptId: attempt, email: `buyer-${sequence}@example.test`, emailConfirmation: `buyer-${sequence}@example.test`, items: items.map(item => ({ quantity: 1, ...item })) })
  }), baseEnv(db), { accountSession: null, includeNative: true, now: NOW, skipIdentityChecks: true, publicIdGenerator: () => `TRG-NE-${String(sequence).padStart(5, "0")}` });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return { attempt, publicId: body.publicOrderReference, order: orderByAttempt(db.raw, attempt) };
}

async function startPayment(payment, db, fixture) {
  const calls = [];
  const response = await payment.handleNativeStripePaymentRequest(new Request("https://example.test/api/cart/pay-order", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkoutAttemptId: fixture.attempt, publicOrderReference: fixture.publicId,
      email: `buyer-${sequence}@example.test`, emailConfirmation: `buyer-${sequence}@example.test` })
  }), { ...baseEnv(db), CHECKOUT_ACCESS_COOKIE_SECRET: COOKIE_SECRET, PAYMENT_PIPELINE_STAGE: "staging", STRIPE_SECRET_KEY: "sk_test_native_earnings" }, {
    accountSession: null, now: NOW, skipIdentityChecks: true,
    stripeFetchImpl: async (url, init) => {
      const form = new URLSearchParams(String(init.body || ""));
      calls.push({ form });
      return new Response(JSON.stringify({ id: `cs_native_earnings_${fixture.attempt}`, livemode: false, ui_mode: "hosted_page", url: "https://checkout.stripe.test/native-earnings" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.ok([200, 201].includes(response.status), await response.text());
  return { calls };
}

async function payAndSettle(payment, webhook, db, fixture, stripeFees) {
  const session = await startPayment(payment, db, fixture);
  const order = orderByAttempt(db.raw, fixture.attempt);
  const response = await deliverWebhook(webhook, db, stripeEvent(order, `evt_native_earnings_paid_${++sequence}`));
  assert.equal(response.status, 200, await response.clone().text());
  await reconcileTestFee(stripeFees, db, order);
  return { order, sales: db.raw.prepare("SELECT * FROM creator_sale_snapshots WHERE order_id=? ORDER BY order_item_id").all(order.id), session };
}

async function reconcileTestFee(stripeFees, db, order) {
  const stored = db.raw.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
  const chargeId = `ch_nativeorder${order.id}`;
  return stripeFees.reconcileOrderProcessingFee(db, {
    order: stored,
    chargeId,
    charge: { id: chargeId, payment_intent: stored.stripe_payment_intent_id },
    balanceTransaction: {
      id: `txn_nativeorder${order.id}`, source: chargeId, amount: Number(order.total_cents),
      currency: String(order.currency).toLowerCase(), fee: 3,
      fee_details: [{ type: "stripe_fee", amount: 3, currency: String(order.currency).toLowerCase() }],
    },
    providerEventId: `evt_fee_nativeorder${order.id}`,
    createdAt: ISO(),
  });
}

function stripeEvent(order, id) {
  return {
    api_version: API_VERSION, created: Math.floor(NOW / 1000), id, livemode: false, object: "event",
    type: "checkout.session.completed",
    data: { object: {
      amount_total: Number(order.total_cents), currency: String(order.currency).toLowerCase(),
      id: order.stripe_checkout_session_id, livemode: false, object: "checkout.session",
      payment_intent: order.stripe_payment_intent_id || `pi_native_order_${order.id}`, payment_status: "paid", ui_mode: "hosted_page",
      client_reference_id: order.public_id,
      metadata: { trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id),
        trg_order_public_id: order.public_id, trg_order_source: "native_d1" }
    } }
  };
}

function providerEvent(id, type, order, values = {}) {
  return { id, type, created: Math.floor(NOW / 1000), data: { object: {
    amount: values.amount, currency: String(order.currency).toLowerCase(), id: values.id || id,
    payment_intent: order.stripe_payment_intent_id, status: values.status,
    metadata: values.responsibility ? { trg_responsibility: values.responsibility } : {}
  } } };
}

async function deliverWebhook(webhook, db, event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const header = `t=${timestamp},v1=${Buffer.from(new Uint8Array(signature)).toString("hex")}`;
  return webhook.handleStripeWebhookRequest(new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": header }, body
  }), { ...baseEnv(db), PAYMENT_PIPELINE_STAGE: "staging", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TRG_PRODUCTS: bucket() }, { nowMs: NOW });
}

function insertTrgOwnedOrder(raw) {
  const now = ISO();
  const order = raw.prepare(`INSERT INTO orders(
    public_id,customer_email,customer_email_normalized,customer_email_hash,stripe_payment_intent_id,
    currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at,
    payment_source,settlement_method,catalog_source
  ) VALUES('TRG-OWNED-ISOLATED','house@example.test','house@example.test','house-hash','pi_house_isolated',
    'USD',900,900,'paid','ready','pending',?,?,'stripe','external_provider','legacy')`).run(now, now);
  const orderId = Number(order.lastInsertRowid);
  raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,
    author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,
    version_snapshot,last_updated_snapshot,created_at) VALUES(?, 'trg-house-product','TRG House Product','trg',
    '[]',1,900,900,900,'USD','1','',?)`).run(orderId, now);
  return { id: orderId, catalog_source: "legacy", paid_at: now };
}

function insertHistoricalNativeOrder(raw) {
  const now = ISO();
  const orderResult = raw.prepare(`INSERT INTO orders(
    public_id,checkout_attempt_id,checkout_request_hash,checkout_session_status,checkout_updated_at,
    customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,
    payment_status,fulfillment_status,email_status,created_at,paid_at,payment_source,settlement_method,
    catalog_source,native_order_state,native_prepared_at,native_payment_expires_at,native_entitlement_status
  ) VALUES('TRG-OLD-NATIVE-ISOLATED','trgca_00000099-0000-4000-8000-000000000099',?, 'active',?,
    'old@example.test','old@example.test','old-hash','USD',700,700,'paid','pending','pending',?,?,'stripe',
    'external_provider','native_d1','paid',?,?,'pending')`).run("a".repeat(64), now, now, now, now, new Date(NOW + 3600000).toISOString());
  const orderId = Number(orderResult.lastInsertRowid);
  raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,
    author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,
    version_snapshot,last_updated_snapshot,created_at,catalog_source,native_product_id,native_creator_id,
    catalog_revision,pricing_model_snapshot,selected_price_cents,publication_state_snapshot,
    product_status_snapshot,delivery_r2_key_snapshot,delivery_filename_snapshot,delivery_content_type_snapshot)
    VALUES(?,'old-native-product','Old Native Purchase','earnings-b','[]',1,700,700,700,'USD','1','',?,'native_d1',
      'old-native-product','creator-earnings-b',1,'fixed',700,'published','available-direct','old/file.pdf','old.pdf','application/pdf')`)
    .run(orderId, now);
  return { orderId };
}

function assertOrderReconciles(raw, orderId) {
  const order = raw.prepare("SELECT total_cents FROM orders WHERE id=?").get(orderId);
  const itemTotals = raw.prepare("SELECT COALESCE(SUM(line_total_cents),0) amount FROM order_items WHERE order_id=?").get(orderId).amount;
  const sales = raw.prepare("SELECT COALESCE(SUM(gross_cents),0) gross,COALESCE(SUM(marketplace_fee_cents),0) fees,COALESCE(SUM(creator_net_cents),0) net FROM creator_sale_snapshots WHERE order_id=?").get(orderId);
  assert.equal(itemTotals, order.total_cents, "Order items must reconcile to the charged whole-cent total.");
  assert.equal(sales.gross, itemTotals, "Creator-attributed native lines must reconcile to the paid order total.");
  assert.equal(sales.fees + sales.net, sales.gross, "Whole-cent marketplace fees and Creator net must conserve gross.");
}

function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  let batchQueue = Promise.resolve();
  const db = {
    failAccountingOnce: false,
    prepare(sql) {
      let values = [];
      return {
        sql,
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() {
          if (db.failAccountingOnce && /INSERT OR IGNORE INTO creator_sale_snapshots/i.test(sql)) {
            db.failAccountingOnce = false;
            throw new Error("Injected accounting write failure.");
          }
          const result = raw.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        }
      };
    },
    batch(statements) {
      const execute = async () => {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const result = [];
          for (const statement of statements) result.push(await statement.run());
          raw.exec("COMMIT");
          return result;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      };
      const pending = batchQueue.then(execute, execute);
      batchQueue = pending.catch(() => {});
      return pending;
    },
    raw
  };
  return { raw, db };
}

function baseEnv(db) { return { ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, NATIVE_GUEST_CHECKOUT_ENABLED: "true", TRG_ORDERS: db }; }
function bucket() { return { async head(key) { return { key, size: 1, httpMetadata: { contentType: "application/pdf" } }; } }; }
function orderByAttempt(raw, attempt) { return raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(attempt); }
function count(raw, table, column, value, type = null) {
  const where = type ? `${column}=? AND entry_type=?` : `${column}=?`;
  return raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...(type ? [value, type] : [value])).n;
}
function checkoutAttempt(value) { return `trgca_2${String(value).padStart(7, "0")}-0000-4000-8000-${String(value).padStart(12, "0")}`; }
function ISO() { return new Date(NOW).toISOString(); }
function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
