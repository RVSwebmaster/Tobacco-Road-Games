const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-19T22:00:00.000Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  await testHistoricalMigrationUpgrade();
  await testOwnerAssignmentLimitAndAudit();
  console.log("C2D policy upgrade and Founding-25 tests passed.");
}

async function testHistoricalMigrationUpgrade() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  const files = migrationFiles();
  for (const name of files.filter(x => !["075_creator_commission_and_stripe_fee_reconciliation.sql", "076_financial_classification_and_founding25_limit.sql"].includes(x))) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES('historical-user','hist@test.invalid',1,'active','user',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at) VALUES('historical-creator','historical-creator','Historical Creator','approved','active',?,?)").run(ISO, ISO);
  const orderInsert = raw.prepare(`INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,
    payment_status,fulfillment_status,email_status,created_at,paid_at,payment_source,settlement_method,catalog_source)
    VALUES('TRG-HISTORICAL','buyer@test.invalid','buyer@test.invalid','historical-hash','USD',10000,10000,'paid','ready','skipped',?,?,'stripe','external_provider','legacy')`).run(ISO, ISO);
  const orderId = Number(orderInsert.lastInsertRowid);
  const itemInsert = raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,
    list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at)
    VALUES(?,'historical-product','Historical Product','historical-author','[]',1,10000,10000,10000,'USD','1','2025.1',?)`).run(orderId, ISO);
  const itemId = Number(itemInsert.lastInsertRowid);
  raw.prepare(`INSERT INTO creator_sale_snapshots(order_id,order_item_id,creator_id,product_slug,product_title,unit_list_price_cents,unit_price_paid_cents,
    quantity,discount_cents,gross_cents,fee_basis_points,fixed_fee_cents,marketplace_fee_cents,creator_net_cents,currency,sold_at)
    VALUES(?,?,?,'historical-product','Historical Product',10000,10000,1,0,10000,2000,50,2050,7950,'USD',?)`).run(orderId, itemId, "historical-creator", ISO);
  raw.prepare(`INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at)
    VALUES('historical-creator','sale_earning',7950,'USD',?,?,'historical-product',?,'available','Historical terms','historical-sale-key',?)`).run(orderId, itemId, ISO, ISO);
  const before = raw.prepare(`SELECT o.total_cents,o.payment_status,s.gross_cents,s.fee_basis_points,s.fixed_fee_cents,s.marketplace_fee_cents,s.creator_net_cents,
    (SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE order_id=o.id) ledger_total FROM orders o JOIN creator_sale_snapshots s ON s.order_id=o.id WHERE o.id=?`).get(orderId);
  raw.exec(fs.readFileSync(path.join(ROOT, "migrations", "075_creator_commission_and_stripe_fee_reconciliation.sql"), "utf8"));
  raw.exec(fs.readFileSync(path.join(ROOT, "migrations", "076_financial_classification_and_founding25_limit.sql"), "utf8"));
  const after = raw.prepare(`SELECT o.total_cents,o.payment_status,s.gross_cents,s.fee_basis_points,s.fixed_fee_cents,s.marketplace_fee_cents,s.creator_net_cents,
    s.account_category,s.account_category_verified,(SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE order_id=o.id) ledger_total
    FROM orders o JOIN creator_sale_snapshots s ON s.order_id=o.id WHERE o.id=?`).get(orderId);
  assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => key !== "account_category" && key !== "account_category_verified")), Object.fromEntries(Object.entries(before)),
    "Policy and cap migrations must leave historical order amounts, terms, and ledger totals unchanged.");
  assert.equal(after.account_category, "standard", "Migration compatibility value is retained for existing readers.");
  assert.equal(after.account_category_verified, 0, "The synthetic migration default is explicitly marked unverified.");
  const finance = await load("functions/_lib/creator-finance.mjs");
  const exceptions = await finance.reconcileCreatorFinance(d1(raw));
  assert.ok(exceptions.some(row => row.code === "historical_sale_category_unverified" && row.order_item_id === itemId),
    "Owner reconciliation must surface the historical category as unverified instead of treating its default as fact.");
  raw.close();
}

async function testOwnerAssignmentLimitAndAudit() {
  const { raw, db } = database();
  seedAssignmentPrincipals(raw);
  const { handleFounding25OwnerRequest } = await load("functions/_lib/founding25-owner.mjs");
  const ownerSession = { valid: true, csrfToken: "owner-csrf", user: { id: "c2d-owner", role: "owner", status: "active" } };
  const common = { database: db, nowMs: NOW, getSession: async () => ownerSession, validateCsrf: async () => ({ valid: true }) };
  const ownerRequest = (method, body) => new Request("https://example.test/owner/api/founding25", {
    method, headers: { origin: "https://example.test", ...(method === "POST" ? { "content-type": "application/json", "x-csrf-token": "owner-csrf" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let denied = await handleFounding25OwnerRequest(ownerRequest("GET"), dbEnv(db), {
    ...common, getSession: async () => ({ valid: true, user: { id: "c2d-admin", role: "admin", status: "active" } })
  });
  assert.equal(denied.status, 403, "Admin must not receive the Owner-only assignment operation.");
  denied = await handleFounding25OwnerRequest(ownerRequest("POST", {
    action: "assign", creatorId: "seat-1", reason: "Approved pilot assignment", confirmation: "ASSIGN FOUNDING-25"
  }), dbEnv(db), { ...common, validateCsrf: async () => ({ valid: false }) });
  assert.equal(denied.status, 403, "State changes require the authenticated Owner CSRF token.");

  for (let index = 1; index <= 24; index += 1) {
    const response = await handleFounding25OwnerRequest(ownerRequest("POST", {
      action: "assign", creatorId: `seat-${index}`, reason: "Owner-approved financial classification", confirmation: "ASSIGN FOUNDING-25"
    }), dbEnv(db), common);
    assert.equal(response.status, 200);
  }
  const attempts = await Promise.all([25, 26].map(index => handleFounding25OwnerRequest(ownerRequest("POST", {
    action: "assign", creatorId: `seat-${index}`, reason: "Concurrent assignment capacity test", confirmation: "ASSIGN FOUNDING-25"
  }), dbEnv(db), common)));
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409], "The database cap must hold under concurrent assignment attempts.");
  assert.equal(raw.prepare("SELECT COUNT(DISTINCT creator_id) n FROM creator_commission_category_assignments WHERE revoked_at IS NULL").get().n, 25);

  const revoke = await handleFounding25OwnerRequest(ownerRequest("POST", {
    action: "revoke", creatorId: "seat-1", reason: "Owner-approved status change", confirmation: "REVOKE FOUNDING-25"
  }), dbEnv(db), common);
  assert.equal(revoke.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_commission_category_assignments WHERE creator_id='seat-1'").get().n, 1,
    "Revocation preserves the original assignment row.");
  assert.ok(raw.prepare("SELECT revoked_at FROM creator_commission_category_assignments WHERE creator_id='seat-1'").get().revoked_at);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_financial_audit WHERE action='founding25_commission_revoked' AND creator_id='seat-1'").get().n, 1,
    "Revocation records the Owner and reason in the financial audit.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_commission_category_assignments WHERE creator_id='seat-26' AND revoked_at IS NULL").get().n, 0,
    "A released seat is not automatically reallocated.");

  const assignedManually = await handleFounding25OwnerRequest(ownerRequest("POST", {
    action: "assign", creatorId: "seat-26", reason: "Owner explicitly assigns released place", confirmation: "ASSIGN FOUNDING-25"
  }), dbEnv(db), common);
  assert.equal(assignedManually.status, 200);
  const listing = await handleFounding25OwnerRequest(ownerRequest("GET"), dbEnv(db), common);
  const payload = await listing.json();
  assert.equal(payload.activeCount, 25);
  assert.equal(payload.limit, 25);
  assert.equal(payload.assignments.length, 26, "Owner listing includes both current assignments and revoked history.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_financial_audit WHERE action='founding25_commission_assigned'").get().n, 26);
  raw.close();
}

function seedAssignmentPrincipals(raw) {
  for (const [id, role] of [["c2d-owner", "owner"], ["c2d-admin", "admin"]]) {
    raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)")
      .run(id, `${id}@test.invalid`, role, ISO, ISO);
  }
  for (let index = 1; index <= 26; index += 1) {
    raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at) VALUES(?,?,?,'approved','active',?,?)")
      .run(`seat-${index}`, `seat-${index}`, `Seat ${index}`, ISO, ISO);
  }
}

function migrationFiles() { return fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort(); }
function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of migrationFiles()) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  return { raw, db: d1(raw) };
}
function d1(raw) {
  let batchTail = Promise.resolve();
  return { prepare(sql) {
    let values = [];
    return { bind(...next) { values = next; return this; },
      async first() { return raw.prepare(sql).get(...values) || null; },
      async all() { return { results: raw.prepare(sql).all(...values) }; },
      async run() { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; } };
  }, batch(statements) {
    const execute = async () => {
      raw.exec("BEGIN IMMEDIATE");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); raw.exec("COMMIT"); return result; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    };
    const result = batchTail.then(execute, execute);
    batchTail = result.catch(() => {});
    return result;
  } };
}
function dbEnv(db) { return { TRG_ORDERS: db }; }
function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
