const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATHS = [
  path.join(ROOT, "migrations", "001_direct_storefront.sql"),
  path.join(ROOT, "migrations", "003_checkout_attempt_idempotency.sql")
];
const TAX_NOTE = "The listed price is the final price. Any applicable sales tax is included.";

async function main() {
  const ordersD1 = await importModule("functions/_lib/orders-d1.mjs");
  const ordersPending = await importModule("functions/_lib/orders-pending.mjs");

  testMigrationValidity();
  await testRepositoryRoundTrip(ordersD1);
  await testRepositoryRollbackSafety(ordersD1);
  await testPendingOrderEndpoint(ordersPending);
  await testPendingOrderValidation(ordersPending);

  console.log("Orders D1 tests passed.");
}

function testMigrationValidity() {
  const { raw } = createD1Database();
  const tables = raw.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map((row) => row.name);

  assert.ok(tables.includes("orders"), "Migration should create the orders table.");
  assert.ok(tables.includes("order_items"), "Migration should create the order_items table.");
  assert.ok(tables.includes("webhook_events"), "Migration should create the webhook_events table.");
  assert.ok(!tables.includes("customers"), "Migration must not create customer-account tables.");
  assert.ok(!tables.includes("accounts"), "Migration must not create account tables.");

  raw.exec(`
    INSERT INTO orders (
      public_id,
      customer_email,
      customer_email_normalized,
      customer_email_hash,
      currency,
      subtotal_cents,
      included_tax_cents,
      total_cents,
      processor_fee_cents,
      net_proceeds_cents,
      payment_status,
      fulfillment_status,
      email_status,
      created_at
    ) VALUES (
      'TRG-ONE',
      'Customer@example.com',
      'customer@example.com',
      'hash-one',
      'USD',
      400,
      NULL,
      400,
      NULL,
      NULL,
      'pending',
      'pending',
      'pending',
      '2026-07-09T00:00:00.000Z'
    );
  `);

  assert.throws(() => {
    raw.exec(`
      INSERT INTO orders (
        public_id,
        customer_email,
        customer_email_normalized,
        customer_email_hash,
        currency,
        subtotal_cents,
        included_tax_cents,
        total_cents,
        processor_fee_cents,
        net_proceeds_cents,
        payment_status,
        fulfillment_status,
        email_status,
        created_at
      ) VALUES (
        'TRG-ONE',
        'dup@example.com',
        'dup@example.com',
        'hash-two',
        'USD',
        400,
        NULL,
        400,
        NULL,
        NULL,
        'pending',
        'pending',
        'pending',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /UNIQUE|unique/i, "orders.public_id must be unique.");

  raw.exec(`
    INSERT INTO orders (
      public_id,
      customer_email,
      customer_email_normalized,
      customer_email_hash,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      currency,
      subtotal_cents,
      included_tax_cents,
      total_cents,
      processor_fee_cents,
      net_proceeds_cents,
      payment_status,
      fulfillment_status,
      email_status,
      created_at
    ) VALUES (
      'TRG-TWO',
      'second@example.com',
      'second@example.com',
      'hash-three',
      'cs_test_1',
      'pi_test_1',
      'USD',
      500,
      NULL,
      500,
      NULL,
      NULL,
      'pending',
      'pending',
      'pending',
      '2026-07-09T00:00:00.000Z'
    );
  `);

  assert.throws(() => {
    raw.exec(`
      INSERT INTO orders (
        public_id,
        customer_email,
        customer_email_normalized,
        customer_email_hash,
        stripe_checkout_session_id,
        currency,
        subtotal_cents,
        included_tax_cents,
        total_cents,
        processor_fee_cents,
        net_proceeds_cents,
        payment_status,
        fulfillment_status,
        email_status,
        created_at
      ) VALUES (
        'TRG-THREE',
        'third@example.com',
        'third@example.com',
        'hash-four',
        'cs_test_1',
        'USD',
        500,
        NULL,
        500,
        NULL,
        NULL,
        'pending',
        'pending',
        'pending',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /UNIQUE|unique/i, "orders.stripe_checkout_session_id must be unique when present.");

  assert.throws(() => {
    raw.exec(`
      INSERT INTO orders (
        public_id,
        customer_email,
        customer_email_normalized,
        customer_email_hash,
        stripe_payment_intent_id,
        currency,
        subtotal_cents,
        included_tax_cents,
        total_cents,
        processor_fee_cents,
        net_proceeds_cents,
        payment_status,
        fulfillment_status,
        email_status,
        created_at
      ) VALUES (
        'TRG-FOUR',
        'fourth@example.com',
        'fourth@example.com',
        'hash-five',
        'pi_test_1',
        'USD',
        500,
        NULL,
        500,
        NULL,
        NULL,
        'pending',
        'pending',
        'pending',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /UNIQUE|unique/i, "orders.stripe_payment_intent_id must be unique when present.");

  assert.throws(() => {
    raw.exec(`
      INSERT INTO orders (
        public_id,
        customer_email,
        customer_email_normalized,
        customer_email_hash,
        currency,
        subtotal_cents,
        included_tax_cents,
        total_cents,
        processor_fee_cents,
        net_proceeds_cents,
        payment_status,
        fulfillment_status,
        email_status,
        created_at
      ) VALUES (
        'TRG-NEGATIVE',
        'negative@example.com',
        'negative@example.com',
        'hash-six',
        'USD',
        500,
        NULL,
        -1,
        NULL,
        NULL,
        'pending',
        'pending',
        'pending',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /CHECK|constraint/i, "orders.total_cents must not be negative.");

  raw.exec(`
    INSERT INTO order_items (
      order_id,
      product_slug,
      product_title_snapshot,
      primary_author_slug,
      author_slugs_json,
      quantity,
      list_price_cents,
      effective_unit_price_cents,
      line_total_cents,
      currency,
      version_snapshot,
      last_updated_snapshot,
      created_at
    ) VALUES (
      1,
      'agency',
      'Agency',
      'rv-sawyer',
      '["rv-sawyer"]',
      1,
      500,
      400,
      400,
      'USD',
      '2026.1',
      '2026-07-01',
      '2026-07-09T00:00:00.000Z'
    );
  `);

  assert.throws(() => {
    raw.exec(`
      INSERT INTO order_items (
        order_id,
        product_slug,
        product_title_snapshot,
        primary_author_slug,
        author_slugs_json,
        quantity,
        list_price_cents,
        effective_unit_price_cents,
        line_total_cents,
        currency,
        version_snapshot,
        last_updated_snapshot,
        created_at
      ) VALUES (
        1,
        'agency',
        'Agency',
        'rv-sawyer',
        '["rv-sawyer"]',
        1,
        500,
        400,
        400,
        'USD',
        '2026.1',
        '2026-07-01',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /UNIQUE|unique/i, "One product slug may appear only once per order.");

  assert.throws(() => {
    raw.exec(`
      INSERT INTO order_items (
        order_id,
        product_slug,
        product_title_snapshot,
        primary_author_slug,
        author_slugs_json,
        quantity,
        list_price_cents,
        effective_unit_price_cents,
        line_total_cents,
        currency,
        version_snapshot,
        last_updated_snapshot,
        created_at
      ) VALUES (
        1,
        'bad-quantity',
        'Bad Quantity',
        'rv-sawyer',
        '["rv-sawyer"]',
        2,
        500,
        400,
        400,
        'USD',
        '2026.1',
        '2026-07-01',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /CHECK|constraint/i, "order_items.quantity must be fixed at 1.");

  assert.throws(() => {
    raw.exec(`
      INSERT INTO order_items (
        order_id,
        product_slug,
        product_title_snapshot,
        primary_author_slug,
        author_slugs_json,
        quantity,
        list_price_cents,
        effective_unit_price_cents,
        line_total_cents,
        currency,
        version_snapshot,
        last_updated_snapshot,
        created_at
      ) VALUES (
        1,
        'bad-money',
        'Bad Money',
        'rv-sawyer',
        '["rv-sawyer"]',
        1,
        500.5,
        400,
        400,
        'USD',
        '2026.1',
        '2026-07-01',
        '2026-07-09T00:00:00.000Z'
      );
    `);
  }, /CHECK|constraint/i, "Monetary values must be stored as integer cents.");

  raw.exec(`
    INSERT INTO webhook_events (
      provider,
      provider_event_id,
      event_type,
      processing_status,
      internal_order_id,
      error_text,
      received_at,
      processed_at
    ) VALUES (
      'stripe',
      'evt_1',
      'checkout.session.completed',
      'pending',
      1,
      NULL,
      '2026-07-09T00:00:00.000Z',
      NULL
    );
  `);
  assert.throws(() => {
    raw.exec(`
      INSERT INTO webhook_events (
        provider,
        provider_event_id,
        event_type,
        processing_status,
        internal_order_id,
        error_text,
        received_at,
        processed_at
      ) VALUES (
        'stripe',
        'evt_1',
        'checkout.session.completed',
        'pending',
        1,
        NULL,
        '2026-07-09T00:00:00.000Z',
        NULL
      );
    `);
  }, /UNIQUE|unique/i, "webhook_events provider and provider event ID must be unique.");
}

async function testRepositoryRoundTrip(ordersD1) {
  const { d1 } = createD1Database();
  const order = await ordersD1.createPendingOrder(d1, {
    currency: "USD",
    customerEmail: "Customer@example.com",
    customerEmailHash: "hash-value",
    customerEmailNormalized: "customer@example.com",
    includedTaxCents: null,
    netProceedsCents: null,
    processorFeeCents: null,
    subtotalCents: 700,
    totalCents: 700
  }, [
    {
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
    },
    {
      authorSlugsJson: JSON.stringify(["rv-sawyer"]),
      currency: "USD",
      effectiveUnitPriceCents: 300,
      lastUpdatedSnapshot: "2026-07-02",
      lineTotalCents: 300,
      listPriceCents: 300,
      primaryAuthorSlug: "rv-sawyer",
      productSlug: "sirrocans",
      productTitleSnapshot: "Sirrocans",
      quantity: 1,
      versionSnapshot: "2026.2"
    }
  ]);

  assert.equal(order.payment_status, "pending", "Pending orders should start with payment_status pending.");
  assert.equal(order.fulfillment_status, "pending", "Pending orders should start with fulfillment_status pending.");
  assert.equal(order.email_status, "pending", "Pending orders should start with email_status pending.");
  assert.equal(order.included_tax_cents, null, "Pending orders should not record included tax yet.");
  assert.equal(order.processor_fee_cents, null, "Pending orders should not record processor fees yet.");
  assert.equal(order.net_proceeds_cents, null, "Pending orders should not record net proceeds yet.");
  assert.match(order.public_id, /^TRG-[A-F0-9]{12}-[A-F0-9]{8}$/, "Pending orders should use a non-sequential public order reference.");

  const byId = await ordersD1.getOrderById(d1, Number(order.id));
  const byPublicId = await ordersD1.getOrderByPublicId(d1, order.public_id);
  assert.equal(byId.public_id, order.public_id, "Orders should be retrievable by internal ID.");
  assert.equal(byPublicId.id, order.id, "Orders should be retrievable by public ID.");

  const items = await ordersD1.getOrderItems(d1, Number(order.id));
  assert.equal(items.length, 2, "Pending orders should insert their full item snapshot set.");
  assert.equal(items[0].quantity, 1, "Stored order items should keep quantity fixed at one.");

  const secondOrder = await ordersD1.createPendingOrder(d1, {
    currency: "USD",
    customerEmail: "other@example.com",
    customerEmailHash: "hash-value-two",
    customerEmailNormalized: "other@example.com",
    includedTaxCents: null,
    netProceedsCents: null,
    processorFeeCents: null,
    subtotalCents: 400,
    totalCents: 400
  }, [
    {
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
    }
  ]);
  assert.notEqual(order.public_id, secondOrder.public_id, "Public order references should be unique across orders.");

  const attached = await ordersD1.attachStripeCheckoutSessionId(d1, Number(order.id), "cs_test_attach");
  assert.equal(attached.stripe_checkout_session_id, "cs_test_attach", "Orders should support attaching a checkout session ID later.");
  const bySession = await ordersD1.getOrderByStripeCheckoutSessionId(d1, "cs_test_attach");
  assert.equal(bySession.id, order.id, "Orders should be retrievable by Stripe Checkout Session ID later.");

  const updated = await ordersD1.updateOrderPaymentStatus(d1, Number(order.id), {
    includedTaxCents: 0,
    netProceedsCents: 380,
    paidAt: "2026-07-10T00:00:00.000Z",
    paymentStatus: "paid",
    processorFeeCents: 20,
    stripePaymentIntentId: "pi_test_attach"
  });
  assert.equal(updated.payment_status, "paid", "Orders should support later payment-status updates.");
  assert.equal(updated.processor_fee_cents, 20, "Orders should support later processor-fee updates.");

  const event = await ordersD1.recordWebhookEvent(d1, {
    eventType: "checkout.session.completed",
    internalOrderId: Number(order.id),
    processedAt: null,
    processingStatus: "pending",
    provider: "stripe",
    providerEventId: "evt_test_1",
    receivedAt: "2026-07-10T00:00:00.000Z"
  });
  assert.equal(event.provider_event_id, "evt_test_1", "Webhook events should be recordable for later phases.");
}

async function testRepositoryRollbackSafety(ordersD1) {
  const { d1, raw } = createD1Database();

  await assert.rejects(
    ordersD1.createPendingOrder(d1, {
      currency: "USD",
      customerEmail: "rollback@example.com",
      customerEmailHash: "rollback-hash",
      customerEmailNormalized: "rollback@example.com",
      includedTaxCents: null,
      netProceedsCents: null,
      processorFeeCents: null,
      subtotalCents: 800,
      totalCents: 800
    }, [
      {
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
      },
      {
        authorSlugsJson: JSON.stringify(["rv-sawyer"]),
        currency: "USD",
        effectiveUnitPriceCents: 400,
        lastUpdatedSnapshot: "2026-07-01",
        lineTotalCents: 400,
        listPriceCents: 500,
        primaryAuthorSlug: "rv-sawyer",
        productSlug: "agency",
        productTitleSnapshot: "Agency Duplicate",
        quantity: 1,
        versionSnapshot: "2026.1"
      }
    ]),
    /UNIQUE|unique/i,
    "Item insertion failures should surface to callers."
  );

  const orderCount = raw.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
  const itemCount = raw.prepare("SELECT COUNT(*) AS count FROM order_items").get().count;
  assert.equal(orderCount, 0, "Failed item insertion should roll back the parent order.");
  assert.equal(itemCount, 0, "Failed item insertion should roll back partial order items.");
}

async function testPendingOrderEndpoint(ordersPending) {
  const { d1 } = createD1Database();
  const catalogProducts = [
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "cart",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: true,
      saleEnd: "2026-07-31",
      salePriceCents: 400,
      saleStart: "2026-07-01",
      slug: "agency",
      status: "available-direct",
      title: "Agency",
      version: "2026.1"
    }
  ];

  const response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: " Customer@Example.com ",
      emailConfirmation: "customer@example.com",
      items: [
        { priceCents: 1, quantity: 1, slug: "agency" }
      ]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: d1
  }, {
    catalogProducts,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });

  assert.equal(response.status, 201, "Valid pending order requests should create a pending ledger record.");
  const payload = await response.json();
  assert.match(payload.publicOrderReference, /^TRG-[A-F0-9]{12}-[A-F0-9]{8}$/, "Pending order responses should expose only the public order reference.");
  assert.equal(payload.currency, "USD", "Pending order responses should expose the order currency.");
  assert.equal(payload.subtotalCents, 400, "Pending order responses should use server-authoritative sale pricing.");
  assert.equal(payload.totalCents, 400, "Pending order totals should preserve the tax-inclusive advertised price.");
  assert.equal(payload.taxInclusive, true, "Pending order responses should preserve tax-inclusive pricing policy.");
  assert.equal(payload.pricingNote, TAX_NOTE, "Pending order responses should include the exact pricing note.");
  assert.equal(payload.paymentStatus, "pending", "Pending order responses should report the pending payment status.");
  assert.equal(payload.items.length, 1, "Pending order responses should return safe item summaries only.");
  assert.equal(payload.items[0].effectiveUnitPriceCents, 400, "Pending order item summaries should expose the effective sale price.");
  assert.equal(payload.items[0].regularPriceCents, 500, "Pending order item summaries should preserve the regular list price snapshot.");
  assert.ok(!("id" in payload), "Pending order responses must not expose internal database IDs.");
  assert.ok(!("customerEmailNormalized" in payload), "Pending order responses must not expose normalized email.");
  assert.ok(!("customerEmailHash" in payload), "Pending order responses must not expose email hashes.");

  const storedOrder = await findSingleRow(d1, "SELECT * FROM orders");
  assert.equal(storedOrder.customer_email, "Customer@Example.com", "Orders should preserve the customer-entered email form after trimming.");
  assert.equal(storedOrder.customer_email_normalized, "customer@example.com", "Orders should normalize email addresses consistently for matching.");
  assert.notEqual(storedOrder.customer_email_hash, "customer@example.com", "Orders should store a private keyed hash instead of the raw normalized email.");
  assert.equal(storedOrder.included_tax_cents, null, "Pending orders should start with null included tax.");
  assert.equal(storedOrder.processor_fee_cents, null, "Pending orders should start with null processor fee.");
  assert.equal(storedOrder.net_proceeds_cents, null, "Pending orders should start with null net proceeds.");

  const storedItem = await findSingleRow(d1, "SELECT * FROM order_items");
  assert.equal(storedItem.effective_unit_price_cents, 400, "Stored order items should snapshot the effective sale price.");
  assert.equal(storedItem.list_price_cents, 500, "Stored order items should snapshot the regular list price.");
  assert.equal(storedItem.quantity, 1, "Stored order items should keep quantity fixed at one.");
}

async function testPendingOrderValidation(ordersPending) {
  const invalidEmailDb = createD1Database().d1;
  const validCatalog = [
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "cart",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: false,
      salePriceCents: null,
      slug: "agency",
      status: "available-direct",
      title: "Agency",
      version: "2026.1"
    },
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "fixed-price",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: false,
      salePriceCents: null,
      slug: "fixed-mode",
      status: "available-direct",
      title: "Fixed Mode",
      version: "2026.1"
    },
    {
      authorDisplay: "RV Sawyer",
      authorSlugs: ["rv-sawyer"],
      buyMode: "cart",
      currency: "USD",
      lastUpdated: "2026-07-01",
      priceCents: 500,
      saleEnabled: false,
      salePriceCents: null,
      slug: "coming-soon",
      status: "coming-soon",
      title: "Coming Soon",
      version: "2026.1"
    }
  ];

  let response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "not-an-email",
      emailConfirmation: "not-an-email",
      items: [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: invalidEmailDb
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Invalid email addresses should be rejected.");

  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "other@example.com",
      items: [{ quantity: 1, slug: "agency" }]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Mismatched email confirmation should be rejected.");

  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "customer@example.com",
      items: [{ quantity: 1, slug: "unknown" }]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Unknown products should be rejected.");
  let payload = await response.json();
  assert.equal(payload.unavailableItems[0].code, "unknown_slug", "Unknown product rejections should report safe unavailability details.");

  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "customer@example.com",
      items: [{ quantity: 1, slug: "coming-soon" }]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Inactive products should be rejected.");
  payload = await response.json();
  assert.equal(payload.unavailableItems[0].code, "inactive_product", "Inactive product rejections should report a safe inactive code.");

  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "customer@example.com",
      items: [{ quantity: 1, slug: "fixed-mode" }]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Non-cart products should be rejected.");
  payload = await response.json();
  assert.equal(payload.unavailableItems[0].code, "not_cart_mode", "Non-cart rejections should report the cart-mode mismatch.");

  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "customer@example.com",
      items: []
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: createD1Database().d1
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 400, "Empty orders should be rejected.");

  const duplicateDb = createD1Database().d1;
  response = await ordersPending.handlePendingOrderRequest(new Request("https://example.com/api/orders/pending", {
    body: JSON.stringify({
      email: "customer@example.com",
      emailConfirmation: "customer@example.com",
      items: [
        { quantity: 1, slug: "agency" },
        { quantity: 1, slug: "agency" }
      ]
    }),
    method: "POST"
  }), {
    ORDER_EMAIL_HASH_SECRET: "phase-3a-secret",
    TRG_ORDERS: duplicateDb
  }, {
    catalogProducts: validCatalog,
    now: Date.parse("2026-07-09T12:00:00.000Z")
  });
  assert.equal(response.status, 201, "Duplicate slugs should normalize to one pending order item.");
  const duplicateItemCount = await countRows(duplicateDb, "order_items");
  assert.equal(duplicateItemCount, 1, "Duplicate slugs should not create duplicate item snapshots.");
}

function createD1Database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const migrationPath of MIGRATION_PATHS) {
    raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  return {
    d1: createD1Adapter(raw),
    raw
  };
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
    async exec(sql) {
      raw.exec(sql);
      return { success: true };
    },
    prepare(sql) {
      const statement = raw.prepare(sql);
      return createPreparedStatement(statement);
    }
  };
}

function createPreparedStatement(statement, boundValues = []) {
  return {
    all() {
      const results = statement.all(...boundValues);
      return Promise.resolve({ results });
    },
    bind(...values) {
      return createPreparedStatement(statement, values);
    },
    first() {
      const result = statement.get(...boundValues);
      return Promise.resolve(result || null);
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

async function findSingleRow(d1, query) {
  const result = await d1.prepare(query).all();
  assert.equal(result.results.length, 1, `Expected one row for query: ${query}`);
  return result.results[0];
}

async function countRows(d1, tableName) {
  const result = await d1.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
  return Number(result?.count || 0);
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
