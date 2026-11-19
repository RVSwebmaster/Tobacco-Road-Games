const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-18T20:00:00Z");

async function main() {
  await testCsv();
  await testDashboard();
  console.log("C2B Express Dashboard and financial CSV tests passed.");
}

async function testCsv() {
  const csv = await load("functions/_lib/financial-csv.mjs"),
    finance = await load("functions/_lib/creator-finance.mjs"),
    report = await load("functions/_lib/creator-business-report.mjs");
  for (const value of ["=1+1", "+SUM(A1:A2)", "-1+1", "@cmd", "\t=1+1", " =1+1"])
    assert.equal(csv.financialCsvCell(value), `'${value}`);
  assert.equal(csv.financialCsvCell("\r=1+1"), `"'\r=1+1"`);
  assert.equal(csv.financialCsvCell(-125), "-125", "negative financial integers remain numeric");
  assert.equal(csv.financialCsvCell(125), "125");
  assert.equal(csv.financialCsvCell("a,b\"c"), '"a,b""c"');
  assert.equal(csv.financialCsvCell("=1,2"), '"\'=1,2"');
  const statement = finance.statementCsv(
    { display_name: "=Creator" },
    { from: "2026-11-01", to: "2026-12-01" },
    {
      sales: [{ sold_at: "2026-11-18", product_title: "=2+2", quantity: 1, gross_cents: 1250, marketplace_fee_cents: 125, creator_net_cents: 1125, currency: "USD" }],
      entries: [{ created_at: "2026-11-18", entry_type: "sale_earning", product_slug: "@SUM", amount_cents: -125, currency: "USD", reason: "+note" }],
      summary: { unpaidBalanceCents: 1000 },
    },
  );
  assert.match(statement, /Creator,'=Creator\r\n/);
  assert.match(statement, /2026-11-18,'=2\+2,1,1250,125,1125,USD/);
  assert.match(statement, /sale_earning,'@SUM,-125,USD,'\+note/);
  const businessCsv = report.creatorBusinessReportCsv(
    { display_name: "@Creator", id: "creator-1" },
    {
      reconciliation: { ok: true },
      period: { label: "2026-11", from: "2026-11-01", to: "2026-12-01" },
      sales: [{ sold_at: "2026-11-18", order_reference: "=A1", order_id: 1, listing_title: "+Product", quantity: 1, gross_cents: 1250, discount_cents: 0, marketplace_fee_cents: 125, creator_net_cents: 1125, currency: "USD", fee_basis_points: 1000, policy_reason: "@policy" }],
      reversals: [], payouts: [], ledger: [],
      totals: { grossSalesCents: 1250, discountsCents: 0, trgFeesCents: 125, creatorShareCents: 1125, refundsGrossCents: 0, chargebacksGrossCents: 0, netPayoutsCents: 0, ledgerNetCents: 1125 },
    },
  );
  assert.match(businessCsv, /Creator,'@Creator\r\n/);
  assert.match(businessCsv, /sale,'=A1,1,'\+Product,1,1250,0,125,1125/);
  assert.match(businessCsv, /1250\r\n/);
  const ownerSource = fs.readFileSync(path.join(ROOT, "functions/_lib/creator-finance-owner.mjs"), "utf8");
  assert.doesNotMatch(ownerSource, /text\/csv|content-disposition:.*\.csv/i, "TRG currently exposes no Owner financial CSV exporter");
}

async function testDashboard() {
  const auth = await load("functions/_lib/account-auth.mjs"),
    handler = await load("functions/_lib/creator-connect.mjs"),
    stripeConnect = await load("functions/_lib/stripe-connect-sandbox.mjs"),
    raw = new DatabaseSync(":memory:");
  const dashboardMarkup = fs.readFileSync(path.join(ROOT, "creator-dashboard/index.html"), "utf8"),
    dashboardScript = fs.readFileSync(path.join(ROOT, "assets/js/creator-dashboard.js"), "utf8");
  assert.match(dashboardMarkup, /id="creator-connect-dashboard" hidden/);
  assert.match(dashboardScript, /action:\s*"dashboard"/);
  raw.exec("PRAGMA foreign_keys=ON");
  for (const migration of [
    "001_direct_storefront.sql", "003_checkout_attempt_idempotency.sql", "004_verified_stripe_webhooks.sql",
    "005_secure_download_entitlements.sql", "006_customer_delivery_owner_controls.sql", "007_shared_accounts.sql",
    "016_order_account_ownership.sql", "017_historical_order_claims.sql", "018_creator_operations.sql",
    "019_creator_publication_pipeline.sql", "020_creator_financial_accounting.sql", "021_provider_finance_and_payout_readiness.sql",
    "022_connect_sandbox_and_payout_batches.sql", "074_native_creator_sale_policy_snapshots.sql",
    "075_creator_commission_and_stripe_fee_reconciliation.sql",
  ]) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8"));
  const now = new Date(NOW).toISOString();
  await insertUser(raw, auth, "creator-user", now);
  await insertUser(raw, auth, "other-user", now);
  for (const [id, slug, display] of [["creator-a", "creator-a", "Creator A"], ["creator-b", "creator-b", "Creator B"]]) {
    raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, slug, display, now, now);
    raw.prepare("INSERT INTO creator_payout_profiles(creator_id,provider,provider_account_reference,onboarding_status,payouts_enabled,verification_status,country,currency,account_exists,status_updated_at) VALUES(?,'stripe_connect',?,'complete',1,'verified','US','USD',1,?)").run(id, id === "creator-a" ? "acct_ownedA" : "acct_ownedB", now);
  }
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('creator-user','creator-a','manager',?)").run(now);
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('other-user','creator-b','manager',?)").run(now);
  const db = d1(raw), env = { TRG_ORDERS: db, STRIPE_CONNECT_SECRET_KEY: "sk_test_c2b", PAYMENT_PIPELINE_STAGE: "staging" }, calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url); calls.push({ path: parsed.pathname, method: init.method, body: init.body });
    if (parsed.pathname === "/v1/accounts/acct_ownedA/login_links") return json({ url: "https://stripe.com/express/LnSensitiveOneTimeToken" });
    if (parsed.pathname === "/v1/accounts/acct_ownedB/login_links") return json({ url: "https://stripe.com/express/LnOtherToken" });
    return json({ error: { message: "unexpected request" } }, 404);
  };
  let response = await handler.handleCreatorConnectRequest(request("creator-user", "creator-user-csrf", { action: "dashboard", creatorId: "creator-b" }), env, { database: db, nowMs: NOW, fetchImpl });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0, "cross-Creator request must not call Stripe");
  response = await handler.handleCreatorConnectRequest(request("creator-user", "wrong-csrf", { action: "dashboard", creatorId: "creator-a" }), env, { database: db, nowMs: NOW, fetchImpl });
  assert.equal(response.status, 403);
  response = await handler.handleCreatorConnectRequest(request("creator-user", "creator-user-csrf", { action: "dashboard", creatorId: "creator-a" }), env, { database: db, nowMs: NOW, fetchImpl });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const payload = await response.json();
  assert.equal(payload.dashboardUrl, "https://stripe.com/express/LnSensitiveOneTimeToken");
  assert.deepEqual(calls, [{ path: "/v1/accounts/acct_ownedA/login_links", method: "POST", body: undefined }]);
  const auditRows = raw.prepare("SELECT action,context_json FROM creator_financial_audit WHERE creator_id='creator-a'").all();
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "connect_dashboard_login_link_generated");
  assert.doesNotMatch(JSON.stringify(auditRows), /LnSensitiveOneTimeToken/);
  assert.throws(() => stripeConnect.requireConnectSandbox({ ...env, STRIPE_CONNECT_SECRET_KEY: "sk_live_forbidden" }), /sandbox/i);
  assert.throws(() => stripeConnect.requireConnectSandbox({ ...env, PAYMENT_PIPELINE_STAGE: "production" }), /sandbox/i);
  await assert.rejects(() => stripeConnect.createConnectDashboardLoginLink(env, "acct_ownedA", { fetchImpl: async () => json({ url: "https://evil.example/express/token" }) }), /invalid Express Dashboard/i);
  raw.close();
}

async function insertUser(raw, auth, id, now) {
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(id, `${id}@example.test`, now, now);
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${id}-session`, id, await auth.hashToken(id), await auth.hashToken(`${id}-csrf`), now, "2027-11-18T20:00:00Z", now);
}
function request(token, csrf, body) {
  return new Request("https://trg.example/api/creator/connect", { method: "POST", headers: { origin: "https://trg.example", cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return { bind(...next) { values = next; return this; }, first: async () => raw.prepare(sql).get(...values) || null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }), run: async () => { const out = raw.prepare(sql).run(...values); return { meta: { changes: Number(out.changes) } }; } };
    },
    async batch(statements) { raw.exec("BEGIN"); try { for (const statement of statements) await statement.run(); raw.exec("COMMIT"); } catch (error) { raw.exec("ROLLBACK"); throw error; } },
  };
}
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?c2b=${Math.random()}`); }
main().catch((error) => { console.error(error); process.exitCode = 1; });
