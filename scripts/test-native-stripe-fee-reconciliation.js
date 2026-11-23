const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-18T20:00:00.000Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  const fees = await load("functions/_lib/stripe-order-fees.mjs");
  const policy = await load("functions/_lib/marketplace-policy.mjs");
  const finance = await load("functions/_lib/creator-finance.mjs");
  const provider = await load("functions/_lib/creator-provider-finance.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  seedAccounts(raw);

  const categories = ["standard", "founding25", "premier", "owner", "admin"];
  const categoryRates = { standard: 1000, founding25: 500, premier: 500, owner: 10000, admin: 10000 };
  const ids = ["creator-standard", "creator-founder", "creator-premier", "creator-owner", "creator-admin"];
  const actor = raw.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get().id;
  await policy.assignFounding25CommissionCategory(db, {
    creatorId: ids[1], actorUserId: actor, reason: "Explicit isolated Founding-25 award", nowMs: NOW
  });
  raw.prepare(`INSERT INTO creator_preferred_terms(
    id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at
  ) VALUES('fee-premier-term',?,'annual_prepaid',20000,?,'2027-01-01T00:00:00.000Z','renews','active',?,?)`)
    .run(ids[2], "2026-01-01T00:00:00.000Z", ISO, ISO);
  for (let index = 0; index < categories.length; index += 1) {
    const resolved = await policy.resolveSalePolicy(db, { creatorId: ids[index], nowMs: NOW });
    assert.equal(resolved.category, categories[index]);
    assert.equal(resolved.basisPoints, categoryRates[categories[index]]);
    assert.equal(resolved.policyVersion, "owner-approved-commission-v1");
  }
  await assert.rejects(() => policy.assignFounding25CommissionCategory(db, {
    creatorId: ids[0], actorUserId: raw.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get().id,
    reason: "Must be Owner", nowMs: NOW
  }), /Only an active Owner/);

  const items = categories.map((category, index) => ({
    creatorId: ids[index], category, amount: 101 + index,
    commission: Math.round((101 + index) * categoryRates[category] / 10000),
    title: `${category} item`,
  }));
  for (const item of [items[3], items[4]]) {
    const houseOrder = seedOrder(raw, [{ ...item, orderItemId: null }], 0, `house-${item.category}`);
    const orderRow = raw.prepare("SELECT * FROM orders WHERE id=?").get(houseOrder.id);
    const statements = await finance.creatorSaleStatements(db, orderRow, { reserveDays: 14 }, ISO);
    await db.batch(statements);
    const houseSale = raw.prepare("SELECT * FROM creator_sale_snapshots WHERE order_id=?").get(houseOrder.id);
    assert.equal(houseSale.account_category, item.category);
    assert.equal(houseSale.marketplace_fee_cents, item.amount);
    assert.equal(houseSale.creator_net_cents, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND entry_type='sale_earning'").get(houseOrder.id).n, 0);
  }
  const order = seedOrder(raw, items, 5, "fee-mixed", 3);
  raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
    VALUES(?,? ,520,'USD','pending',?)`).run(order.id, order.paymentIntentId, ISO);
  for (const item of items) seedSale(raw, order.id, item);

  // The signed charge update may arrive before Stripe has attached a Balance
  // Transaction. It must be a successful pending state, not a failed sale.
  const waiting = await fees.processStripeOrderFeeEvent(db, stripeChargeEvent(order, null), {
    createdAt: ISO,
  });
  assert.equal(waiting.action, "fee_pending");
  assert.equal(raw.prepare("SELECT status FROM stripe_order_fee_reconciliations WHERE order_id=?").get(order.id).status, "pending");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND payout_state='held'").get(order.id).n, 3);

  const balanceTransaction = {
    id: "txn_feeReconcile001", object: "balance_transaction", source: order.chargeId,
    amount: 520, currency: "usd", fee: 10, net: 510,
    fee_details: [
      { type: "stripe_fee", amount: 7, currency: "usd" },
      { type: "application_fee", amount: 1, currency: "usd" },
      { type: "tax", amount: 2, currency: "usd" },
    ],
  };
  const verifiedWebhook = await deliverChargeUpdate(webhook, db, stripeChargeEvent(order, "txn_feeReconcile001"), async url => {
    assert.match(String(url), /\/balance_transactions\/txn_feeReconcile001$/);
    return json(balanceTransaction);
  });
  assert.equal(verifiedWebhook.status, 200);
  const response = await verifiedWebhook.json();
  assert.equal(response.processingResult, "fee_reconciled");
  const reconciled = raw.prepare("SELECT * FROM stripe_order_fee_reconciliations WHERE order_id=?").get(order.id);
  assert.equal(reconciled.total_fee_cents, 10);
  assert.equal(reconciled.processing_fee_cents, 7);
  assert.equal(reconciled.non_processing_fee_cents, 3);
  assert.equal(reconciled.non_product_amount_cents, 5);
  assert.equal(reconciled.non_product_processing_fee_cents, 0);
  assert.equal(reconciled.tax_amount_cents, 3);
  assert.equal(reconciled.tax_processing_fee_cents, 0);
  assert.equal(reconciled.other_non_product_amount_cents, 2);
  assert.equal(reconciled.other_non_product_processing_fee_cents, 0);
  const allocations = raw.prepare("SELECT processing_fee_cents,creator_absorbed_fee_cents,trg_absorbed_fee_cents FROM stripe_order_fee_allocations WHERE order_id=? ORDER BY order_item_id").all(order.id);
  assert.deepEqual(allocations.map(line => line.processing_fee_cents), [1, 1, 1, 2, 2]);
  assert.deepEqual(allocations.map(line => line.creator_absorbed_fee_cents), [1, 1, 1, 0, 0]);
  assert.deepEqual(allocations.map(line => line.trg_absorbed_fee_cents), [0, 0, 0, 2, 2]);
  assert.equal(raw.prepare("SELECT processor_fee_cents FROM orders WHERE id=?").get(order.id).processor_fee_cents, 10);
  assert.equal(raw.prepare("SELECT SUM(processing_fee_cents) amount FROM stripe_order_fee_allocations WHERE order_id=?").get(order.id).amount, 7);
  assert.equal(raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_id=? AND entry_type='manual_adjustment'").get(order.id).amount, -3);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND payout_state='held'").get(order.id).n, 0);
  for (let index = 0; index < 3; index += 1) {
    const ledger = raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_item_id=?").get(items[index].orderItemId);
    assert.equal(ledger.amount, items[index].amount - items[index].commission - (index < 3 ? 1 : 0));
  }
  const replay = await fees.processStripeOrderFeeEvent(db, stripeChargeEvent(order, "txn_feeReconcile001"), {
    createdAt: ISO,
    fetchImpl: async () => json(balanceTransaction),
  });
  assert.equal(replay.action, "already_reconciled");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND reason='Stripe transaction processing fee allocation'").get(order.id).n, 3);

  // Larger Stripe fee allocation proves tax and other non-product amounts
  // receive positive processing-fee shares through the persisted webhook path.
  const nonProductOrder = seedOrder(raw, items, 500, "fee-positive-nonproduct", 300);
  raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
    VALUES(?,?,?,'USD','pending',?)`).run(nonProductOrder.id, nonProductOrder.paymentIntentId, 1015, ISO);
  for (const item of nonProductOrder.items) seedSale(raw, nonProductOrder.id, item);
  const nonProductEvent = await deliverChargeUpdate(webhook, db, stripeChargeEvent(nonProductOrder, "txn_positiveNonProduct001"), async () => json({
    id: "txn_positiveNonProduct001", object: "balance_transaction", source: nonProductOrder.chargeId,
    amount: 1015, currency: "usd", fee: 103, net: 912,
    fee_details: [
      { type: "stripe_fee", amount: 100, currency: "usd" },
      { type: "application_fee", amount: 1, currency: "usd" },
      { type: "tax", amount: 2, currency: "usd" },
    ],
  }));
  assert.equal(nonProductEvent.status, 200);
  const nonProductState = raw.prepare("SELECT * FROM stripe_order_fee_reconciliations WHERE order_id=?").get(nonProductOrder.id);
  assert.equal(nonProductState.status, "reconciled");
  assert.equal(nonProductState.total_fee_cents, 103);
  assert.equal(nonProductState.processing_fee_cents, 100);
  assert.equal(nonProductState.non_processing_fee_cents, 3);
  assert.equal(nonProductState.tax_amount_cents, 300);
  assert.equal(nonProductState.other_non_product_amount_cents, 200);
  assert.ok(nonProductState.tax_processing_fee_cents > 0);
  assert.ok(nonProductState.other_non_product_processing_fee_cents > 0);
  assert.equal(raw.prepare("SELECT SUM(processing_fee_cents) value FROM stripe_order_fee_allocations WHERE order_id=?").get(nonProductOrder.id).value
    + nonProductState.tax_processing_fee_cents + nonProductState.other_non_product_processing_fee_cents, 100);
  assert.equal(raw.prepare("SELECT SUM(creator_absorbed_fee_cents) value FROM stripe_order_fee_allocations WHERE order_id=?").get(nonProductOrder.id).value, 30);
  assert.equal(raw.prepare("SELECT SUM(trg_absorbed_fee_cents) value FROM stripe_order_fee_allocations WHERE order_id=?").get(nonProductOrder.id).value, 20);
  assert.equal(raw.prepare("SELECT processor_fee_cents FROM orders WHERE id=?").get(nonProductOrder.id).processor_fee_cents, 103);

  for (const [label, feeDetails, totalFee] of [
    ["currency", [{ type: "stripe_fee", amount: 3, currency: "eur" }], 3],
    ["detail-total", [{ type: "stripe_fee", amount: 2, currency: "usd" }], 3],
  ]) {
    const safeLabel = label.replace(/[^A-Za-z0-9]/g, "");
    const invalidOrder = seedOrder(raw, [{ ...items[0], orderItemId: null }], 0, `fee-invalid-${safeLabel}`);
    raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
      VALUES(?,?,?,'USD','pending',?)`).run(invalidOrder.id, invalidOrder.paymentIntentId, invalidOrder.total, ISO);
    seedSale(raw, invalidOrder.id, invalidOrder.items[0]);
    const invalidResult = await fees.processStripeOrderFeeEvent(db, stripeChargeEvent(invalidOrder, `txn_invalid${safeLabel}001`), {
      createdAt: ISO, balanceTransaction: { id: `txn_invalid${safeLabel}001`, source: invalidOrder.chargeId,
        amount: invalidOrder.total, currency: "usd", fee: totalFee, fee_details: feeDetails },
    });
    assert.equal(invalidResult.action, "fee_needs_review");
    assert.equal(raw.prepare("SELECT status FROM stripe_order_fee_reconciliations WHERE order_id=?").get(invalidOrder.id).status, "needs_review");
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM stripe_order_fee_allocations WHERE order_id=?").get(invalidOrder.id).n, 0);
    assert.equal(raw.prepare("SELECT payout_state FROM creator_earnings_ledger WHERE order_id=? AND entry_type='sale_earning'").get(invalidOrder.id).payout_state, "held");
  }

  const recoveryItem = { ...items[0], orderItemId: null };
  const ownerRecoveryOrder = seedOrder(raw, [recoveryItem], 0, "fee-owner-recovery");
  raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
    VALUES(?,?,?,'USD','pending',?)`).run(ownerRecoveryOrder.id, ownerRecoveryOrder.paymentIntentId, ownerRecoveryOrder.total, ISO);
  seedSale(raw, ownerRecoveryOrder.id, recoveryItem);
  const ownerRecovery = await fees.recoverNativeOrderProcessingFee(db, ownerRecoveryOrder.id, {
    secretKey: "sk_test_isolated", nowMs: NOW,
    fetchImpl: async url => {
      assert.match(String(url), /\/payment_intents\/pi_/);
      return json({ id: ownerRecoveryOrder.paymentIntentId, latest_charge: {
        id: ownerRecoveryOrder.chargeId, payment_intent: ownerRecoveryOrder.paymentIntentId,
        balance_transaction: { id: "txn_ownerRecovery01", source: ownerRecoveryOrder.chargeId,
          amount: ownerRecoveryOrder.total, currency: "usd", fee: 3,
          fee_details: [{ type: "stripe_fee", amount: 3, currency: "usd" }] }
      } });
    }
  });
  assert.equal(ownerRecovery.action, "fee_reconciled");
  assert.equal(raw.prepare("SELECT status FROM stripe_order_fee_reconciliations WHERE order_id=?").get(ownerRecoveryOrder.id).status, "reconciled");
  assert.equal(raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_id=? AND reason='Stripe transaction processing fee allocation'").get(ownerRecoveryOrder.id).amount, -3);
  assert.equal((await fees.recoverNativeOrderProcessingFee(db, ownerRecoveryOrder.id, {
    secretKey: "sk_test_isolated", nowMs: NOW, fetchImpl: async () => { throw new Error("A reconciled order must not be fetched again."); }
  })).action, "already_reconciled");

  const unknownTaxOrder = seedOrder(raw, [items[0]], 5, "fee-unknown-tax", 0);
  raw.prepare("UPDATE orders SET included_tax_cents=NULL WHERE id=?").run(unknownTaxOrder.id);
  raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
    VALUES(?,?,?,'USD','pending',?)`).run(unknownTaxOrder.id, unknownTaxOrder.paymentIntentId, unknownTaxOrder.total, ISO);
  seedSale(raw, unknownTaxOrder.id, unknownTaxOrder.items[0]);
  const unknownTaxResult = await fees.processStripeOrderFeeEvent(db,
    stripeChargeEvent(unknownTaxOrder, "txn_unknownTax001"), {
      createdAt: ISO,
      balanceTransaction: { id: "txn_unknownTax001", object: "balance_transaction", source: unknownTaxOrder.chargeId,
        amount: unknownTaxOrder.total, currency: "usd", fee: 3,
        fee_details: [{ type: "stripe_fee", amount: 3, currency: "usd" }] },
    });
  assert.equal(unknownTaxResult.action, "fee_needs_review");
  assert.equal(raw.prepare("SELECT status FROM stripe_order_fee_reconciliations WHERE order_id=?").get(unknownTaxOrder.id).status, "needs_review");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM stripe_order_fee_allocations WHERE order_id=?").get(unknownTaxOrder.id).n, 0);
  assert.equal(raw.prepare("SELECT payout_state FROM creator_earnings_ledger WHERE order_id=? AND entry_type='sale_earning'").get(unknownTaxOrder.id).payout_state, "held");

  // Refund a transaction whose charge still includes a non-product amount.
  // Full refund reverses the Creator's sale share but retains actual Stripe
  // processing fees as unrecovered Creator deductions; Owner/Admin have no payables.
  const partial = await provider.processStripeCreatorFinanceEvent(db, refundEvent(order, "evt_fee_refund_part", 260), { createdAt: ISO });
  assert.equal(partial.action, "refund_reversed");
  const full = await provider.processStripeCreatorFinanceEvent(db, refundEvent(order, "evt_fee_refund_rest", 260), { createdAt: ISO });
  assert.equal(full.action, "refund_reversed");
  assert.equal(raw.prepare("SELECT payment_status FROM orders WHERE id=?").get(order.id).payment_status, "refunded");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND entry_type='refund_reversal'").get(order.id).n, 6);
  assert.equal(raw.prepare("SELECT SUM(amount_cents) amount FROM creator_earnings_ledger WHERE order_id=? AND entry_type IN ('sale_earning','refund_reversal','manual_adjustment')").get(order.id).amount, -3);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE creator_id IN (?,?) AND order_id=? AND entry_type='sale_earning'").get(ids[3], ids[4], order.id).n, 0);
  assert.equal(raw.prepare("SELECT SUM(gross_reversed_cents) amount FROM creator_reversal_snapshots WHERE order_id=?").get(order.id).amount, 515);

  // Minor-unit allocator is deterministic for low prices and ties, and conserves cents.
  const allocation = fees.allocateMinorUnits(2, [
    { id: "b", weight: 1 }, { id: "a", weight: 1 }, { id: "zero", weight: 0 },
  ]);
  assert.deepEqual(allocation, [
    { id: "b", weight: 1, amountCents: 1 },
    { id: "a", weight: 1, amountCents: 1 },
    { id: "zero", weight: 0, amountCents: 0 },
  ]);
  assert.equal(allocation.reduce((sum, row) => sum + row.amountCents, 0), 2);

  // Duplicate fee event and refund event delivery cannot double the ledger.
  assert.equal((await provider.processStripeCreatorFinanceEvent(db, refundEvent(order, "evt_fee_refund_rest", 260), { createdAt: ISO })).duplicate, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=? AND reason='Stripe transaction processing fee allocation'").get(order.id).n, 3);

  // Disputes hold Creator balances only; house product attribution remains TRG.
  const disputed = seedOrder(raw, items.slice(0, 3), 0, "fee-dispute");
  raw.prepare(`INSERT INTO stripe_order_fee_reconciliations(order_id,payment_intent_id,transaction_amount_cents,currency,status,created_at)
    VALUES(?,?,306,'USD','pending',?)`).run(disputed.id, disputed.paymentIntentId, ISO);
  for (const item of items.slice(0, 3)) seedSale(raw, disputed.id, item);
  const dispute = await provider.processStripeCreatorFinanceEvent(db, {
    id: "evt_fee_dispute", type: "charge.dispute.created", data: { object: {
      id: "dp_fee_dispute", amount: 306, currency: "usd", payment_intent: disputed.paymentIntentId
    } }
  }, { createdAt: ISO });
  assert.equal(dispute.action, "dispute_held");
  assert.equal(raw.prepare("SELECT payment_status FROM orders WHERE id=?").get(disputed.id).payment_status, "disputed");

  raw.close();
  console.log("Native Stripe fee reconciliation tests passed.");
}

function seedAccounts(raw) {
  const people = [
    ["commission-owner", "owner"], ["commission-admin", "admin"],
    ["seller-standard-user", "user"], ["seller-founder-user", "user"], ["seller-premier-user", "user"],
    ["seller-owner-user", "owner"], ["seller-admin-user", "admin"],
  ];
  for (const [id, role] of people) raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)")
    .run(id, `${id}@test.invalid`, role, ISO, ISO);
  const creators = [
    ["creator-standard", "seller-standard-user"], ["creator-founder", "seller-founder-user"],
    ["creator-premier", "seller-premier-user"], ["creator-owner", "seller-owner-user"], ["creator-admin", "seller-admin-user"],
  ];
  for (const [id, owner] of creators) {
    raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at) VALUES(?,?,?,'approved','active',?,?)").run(id, id, id, ISO, ISO);
    raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','not_required','primary_free',?,?)").run(id, owner, ISO, ISO);
  }
}

function seedOrder(raw, items, nonProduct, prefix = "fee-mixed", taxAmount = nonProduct) {
  const idSuffix = `${prefix}-${items.map(item => item.category).join("-")}-${Math.random().toString(16).slice(2, 8)}`;
  const total = items.reduce((sum, item) => sum + item.amount, 0) + nonProduct;
  const pi = `pi_${idSuffix.replace(/[^A-Za-z0-9]/g, "")}`;
  const inserted = raw.prepare(`INSERT INTO orders(
    public_id,customer_email,customer_email_normalized,customer_email_hash,stripe_payment_intent_id,currency,
    subtotal_cents,included_tax_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at,
    payment_source,settlement_method,catalog_source,native_order_state,native_prepared_at,native_entitlement_status,native_payment_expires_at
  ) VALUES(?,?,?,?,?,'USD',?, ?,?,'paid','ready','skipped',?,?,'stripe','external_provider','native_d1','paid',?,'pending',?)`)
    .run(`TRG-${idSuffix}`, "buyer@test.invalid", "buyer@test.invalid", `hash-${idSuffix}`, pi,
      total - taxAmount, taxAmount, total, ISO, ISO, ISO, "2026-11-19T20:00:00.000Z");
  const orderId = Number(inserted.lastInsertRowid);
  const createdItems = items.map((item, index) => {
    const insertedItem = raw.prepare(`INSERT INTO order_items(
      order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,
      list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at,
      catalog_source,native_product_id,native_creator_id,catalog_revision,pricing_model_snapshot,selected_price_cents,
      publication_state_snapshot,product_status_snapshot,delivery_r2_key_snapshot,delivery_filename_snapshot,
      delivery_content_type_snapshot,creator_fee_basis_points_snapshot,creator_fixed_fee_cents_snapshot,
      creator_reserve_days_snapshot,creator_fee_policy_reason_snapshot,creator_commission_category_snapshot,
      creator_commission_policy_version_snapshot
    ) VALUES(?,?,?,?,'[]',1,?,?,?,'USD','1','',?,'native_d1',?,?,1,'fixed',?,'published','available-direct',?,?,
      'application/pdf',?,0,14,?,?,?)`).run(orderId, `${item.category}-${index}`, item.title, item.creatorId,
        item.amount, item.amount, item.amount, ISO, `${item.category}-${index}`, item.creatorId, item.amount,
        `private/${item.category}-${index}.pdf`, `${item.category}-${index}.pdf`, categoryBps(item.category),
        `category:${item.category}`, item.category, "owner-approved-commission-v1");
    item.orderItemId = Number(insertedItem.lastInsertRowid);
    return item;
  });
  return { id: orderId, paymentIntentId: pi, chargeId: `ch_${idSuffix.replace(/[^A-Za-z0-9]/g, "")}`, total, items: createdItems };
}

function seedSale(raw, orderId, item) {
  raw.prepare(`INSERT INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,
    unit_list_price_cents,unit_price_paid_cents,quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,
    marketplace_fee_cents,creator_net_cents,currency,sold_at,account_category)
    VALUES(?,?,?,?,?,?,?,1,0,?,?,0,?,?, 'USD',?,?)`)
    .run(orderId, item.orderItemId, item.creatorId, item.category, item.title, item.amount, item.amount,
      item.amount, 10000 - categoryBps(item.category), item.commission, item.amount - item.commission, ISO, item.category);
  if (["standard", "founding25", "premier"].includes(item.category)) raw.prepare(`INSERT INTO creator_earnings_ledger(
    creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at
  ) VALUES(?,'sale_earning',?,'USD',?,?,?,?,'held','Creator sale earning',?,?)`)
    .run(item.creatorId, item.amount - item.commission, orderId, item.orderItemId, item.category, "2026-12-02T20:00:00.000Z",
      `sale:${orderId}:${item.orderItemId}`, ISO);
}

function categoryBps(category) {
  return { standard: 1000, founding25: 500, premier: 500, owner: 10000, admin: 10000 }[category];
}
function stripeChargeEvent(order, balanceId) {
  return { id: `evt${order.id}${balanceId || "pending"}`, type: "charge.updated", created: Math.floor(NOW / 1000),
    data: { object: { object: "charge", id: order.chargeId, payment_intent: order.paymentIntentId,
      amount: order.total, amount_captured: order.total, currency: "usd", balance_transaction: balanceId } } };
}
async function deliverChargeUpdate(webhook, db, event, fetchImpl) {
  event.api_version = "2026-06-24.dahlia";
  event.livemode = false;
  const body = JSON.stringify(event), timestamp = Math.floor(NOW / 1000), secret = "whsec_fee_reconciliation_isolated";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const header = `t=${timestamp},v1=${Buffer.from(new Uint8Array(signature)).toString("hex")}`;
  return webhook.handleStripeWebhookRequest(new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": header }, body,
  }), { TRG_ORDERS: db, STRIPE_WEBHOOK_SECRET: secret, STRIPE_SECRET_KEY: "sk_test_isolated", PAYMENT_PIPELINE_STAGE: "staging" }, {
    nowMs: NOW, stripeFetchImpl: fetchImpl,
  });
}
function refundEvent(order, id, amount) {
  return { id, type: "refund.created", created: Math.floor(NOW / 1000), data: { object: {
    id: `re_${id}`, amount, currency: "usd", payment_intent: order.paymentIntentId,
  } } };
}
function json(value) { return { ok: true, status: 200, async json() { return value; } }; }
function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  const db = {
    prepare(sql) {
      let binds = [];
      return { bind(...args) { binds = args; return this; },
        async first() { return raw.prepare(sql).get(...binds) || null; },
        async all() { return { results: raw.prepare(sql).all(...binds) }; },
        async run() { return raw.prepare(sql).run(...binds); } };
    },
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map(statement => raw.prepare(statement.sql).run(...statement.values));
        raw.exec("COMMIT");
        return result;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    }
  };
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    let binds = [];
    return { sql, values: binds, bind(...args) { binds = args; this.values = args; return this; },
      async first() { return raw.prepare(sql).get(...binds) || null; },
      async all() { return { results: raw.prepare(sql).all(...binds) }; },
      async run() { return raw.prepare(sql).run(...binds); } };
  };
  return { raw, db };
}
async function load(relative) { return import(pathToFileURL(path.join(ROOT, relative)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
