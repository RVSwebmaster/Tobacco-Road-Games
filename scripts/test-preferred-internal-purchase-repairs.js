const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"),
  { DatabaseSync } = require("node:sqlite"), { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."), NOW = Date.parse("2026-09-07T12:00:00Z"), ISO = new Date(NOW).toISOString(), END = "2027-09-07T12:00:00.000Z";

async function main() {
  const raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort()) raw.exec(read(`migrations/${file}`));
  const db = d1(raw), auth = await load("functions/_lib/account-auth.mjs"), registration = await load("functions/_lib/creator-registration.mjs"), creatorRoute = await load("functions/_lib/creator-operations.mjs"), balanceRoute = await load("functions/_lib/creator-balance-route.mjs"), advertisingRoute = await load("functions/_lib/creator-advertising-route.mjs"), service = await load("functions/_lib/creator-service-purchases.mjs");
  await addUser(raw, auth, "operator", "operator@test.invalid"); await addUser(raw, auth, "intruder", "intruder@test.invalid");
  const standard = await registration.registerPrimaryCreator(db, { userId: "operator", email: "operator@test.invalid", body: creatorBody("Standard Studio", "standard-studio"), nowMs: NOW });
  const annual = await registration.createAdditionalCreatorIdentity(db, { userId: "operator", email: "operator@test.invalid", body: creatorBody("Annual Studio", "annual-studio"), billingCadence: "annual_prepaid", billingStatus: "current", nowMs: NOW });
  const initial = await registration.registerPrimaryCreator(db, { userId: "intruder", email: "intruder@test.invalid", body: creatorBody("Initial Studio", "initial-studio"), nowMs: NOW });
  for (const id of [standard.creatorId, annual.creatorId, initial.creatorId]) makeReady(raw, id);
  raw.prepare("UPDATE creator_identity_ownership SET billing_status='legacy_grandfathered',entitlement_source='legacy_grandfathered' WHERE creator_id=?").run(annual.creatorId);
  seedBalance(raw, standard.creatorId, 777, "standard-balance"); seedBalance(raw, annual.creatorId, 50000, "annual-balance"); seedBalance(raw, initial.creatorId, 50000, "initial-balance"); seedAnnual(raw, annual.creatorId, "operator");
  const env = { TRG_ORDERS: db, PAYMENT_PIPELINE_STAGE: "staging" };

  let response = await creatorRoute.handleCreatorRequest(get("operator", `preferred?creator=${annual.creatorId}`), env, { database: db, nowMs: NOW });
  assert.equal(response.status, 200); let payload = await response.json();
  assert.equal(payload.internalPurchase.monthlyEligible, false); assert.equal(payload.internalPurchase.annualRenewalEligible, true);
  const before = financialSnapshot(raw, annual.creatorId);
  response = await creatorRoute.handleCreatorRequest(post("operator", `preferred?creator=${annual.creatorId}`, { plan: "monthly_commitment", paymentSource: "creator_balance", idempotencyKey: "svc_00000000-0000-4000-8000-000000000111" }), env, { database: db, nowMs: NOW });
  assert.equal(response.status, 400); assert.match((await response.json()).error.message, /not eligible/i); assert.deepEqual(financialSnapshot(raw, annual.creatorId), before);
  assert.equal(raw.prepare("SELECT term_ends_at FROM creator_preferred_terms WHERE id='annual-term'").get().term_ends_at, END);
  await assert.rejects(() => service.purchaseServiceWithCreatorBalance(db, { creatorId: initial.creatorId, userId: "intruder", sku: "preferred_annual", idempotencyKey: "svc_00000000-0000-4000-8000-000000000112", nowMs: NOW }), /Initial Preferred activation requires external payment/);

  response = await creatorRoute.handleCreatorRequest(get("operator", "identity-options"), env, { database: db, nowMs: NOW });
  assert.deepEqual((await response.json()).creators.map((creator) => creator.id).sort(), [standard.creatorId, annual.creatorId].sort());
  assert.equal((await creatorRoute.handleCreatorRequest(get("operator", "preferred"), env, { database: db, nowMs: NOW })).status, 403);

  const product = { authorSlugs: ["seller"], buyMode: "cart", creatorId: annual.creatorId, currency: "USD", effectivePriceCents: 500, fulfillmentEligible: true, lastUpdated: "2026-09-07", listedPriceCents: 500, mediaType: "digital", priceCents: 500, saleEnabled: false, slug: "agency", status: "available-direct", title: "Identity Test Product", version: "1" }, catalogMap = new Map([["agency", product]]), deliveryHeads = { agency: { size: 100 } }, routeOptions = { database: db, nowMs: NOW, catalogMap, deliveryHeads, emailHashSecret: "identity-test-email-secret" };
  raw.prepare("UPDATE creator_listings SET creator_id=?,public_product_slug='agency',lifecycle_state='active',publication_state='published',updated_at=? WHERE source_product_slug='agency'").run(annual.creatorId, ISO);
  raw.prepare("UPDATE runtime_settings SET setting_value='OPEN',updated_at=?,updated_by='test' WHERE setting_key='store_state'").run(ISO);
  response = await balanceRoute.handleCreatorBalanceRequest(get("operator", `balance?creator=${annual.creatorId}&product=agency`), env, routeOptions); payload = await response.json();
  assert.equal(payload.internalPurchase.creator.id, annual.creatorId); assert.equal(payload.internalPurchase.canUseBalance, true); assert.equal(payload.internalPurchase.allProductsEligible, true); assert.equal(payload.balance.availableCents, 50000);
  response = await balanceRoute.handleCreatorBalanceRequest(get("operator", `balance?creator=${standard.creatorId}&product=agency`), env, routeOptions); payload = await response.json();
  assert.equal(payload.internalPurchase.creator.id, standard.creatorId); assert.equal(payload.internalPurchase.canUseBalance, false); assert.equal(payload.balance.availableCents, 777);
  response = await balanceRoute.handleCreatorBalanceRequest(post("operator", `balance?creator=${annual.creatorId}`, { checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000113", email: "operator@test.invalid", emailConfirmation: "operator@test.invalid", items: [{ quantity: 1, slug: "agency" }], paymentSource: "creator_balance" }), env, routeOptions);
  assert.equal(response.status, 201); assert.equal(raw.prepare("SELECT buyer_creator_id FROM creator_balance_settlements").get().buyer_creator_id, annual.creatorId);
  assert.equal(raw.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM creator_balance_transactions WHERE creator_id=?").get(standard.creatorId).n, 0);

  for (const [id, expected] of [[annual.creatorId, true], [standard.creatorId, false]]) {
    response = await advertisingRoute.handleCreatorAdvertisingRequest(get("operator", `advertising?creator=${id}`), env, { database: db, nowMs: NOW });
    assert.equal(response.status, 200); assert.equal((await response.json()).internalPurchase.canUseBalance, expected);
  }
  response = await registration.handleCreatorRegistrationRequest(post("operator", "creator-registration", { action: "purchase_identity_coverage_with_creator_balance", creatorId: annual.creatorId, plan: "monthly", paymentSource: "creator_balance", idempotencyKey: "svc_00000000-0000-4000-8000-000000000114" }), env, { database: db, nowMs: NOW });
  assert.equal(response.status, 201); assert.equal(raw.prepare("SELECT creator_id FROM marketplace_service_purchases WHERE idempotency_key='svc_00000000-0000-4000-8000-000000000114'").get().creator_id, annual.creatorId);

  for (const invoke of [
    () => balanceRoute.handleCreatorBalanceRequest(get("intruder", `balance?creator=${annual.creatorId}`), env, routeOptions),
    () => advertisingRoute.handleCreatorAdvertisingRequest(get("intruder", `advertising?creator=${annual.creatorId}`), env, { database: db, nowMs: NOW }),
    () => creatorRoute.handleCreatorRequest(get("intruder", `preferred?creator=${annual.creatorId}`), env, { database: db, nowMs: NOW }),
  ]) assert.equal((await invoke()).status, 403);
  assert.doesNotMatch(read("functions/_lib/creator-balance-route.mjs"), /owner_user_id=\?[\s\S]{0,100}LIMIT 1/);
  assert.doesNotMatch(read("functions/_lib/creator-advertising-route.mjs"), /cm\.user_id=\?[\s\S]{0,150}LIMIT 1/);
  console.log("Preferred internal purchasing repair tests passed.");
}

function creatorBody(creatorName, slug) { return { creatorName, slug, shortBio: `${creatorName} publishes tabletop games.`, legalName: "Test Operator", businessName: creatorName, businessType: "sole_proprietor", country: "US", stateRegion: "NC", addressLine1: "1 Test Way", city: "Raleigh", postalCode: "27601", contactEmail: "operator@test.invalid", acceptAgreement: true, confirmRights: true }; }
function makeReady(raw, creatorId) {
  raw.prepare("UPDATE marketplace_creators SET registration_status='active',registration_completed_at=?,marketplace_status='approved' WHERE id=?").run(ISO, creatorId);
  raw.prepare("UPDATE creator_payout_profiles SET onboarding_status='complete',verification_status='verified',payouts_enabled=1,status_updated_at=? WHERE creator_id=?").run(ISO, creatorId);
  raw.prepare("UPDATE creator_account_audit_states SET state='passed' WHERE creator_id=?").run(creatorId);
  const owner = raw.prepare("SELECT owner_user_id FROM creator_identity_ownership WHERE creator_id=?").get(creatorId);
  raw.prepare("INSERT INTO user_account_profiles(user_id,stripe_customer_reference,default_payment_method_reference,payment_method_status,created_at,updated_at) VALUES(?,?,?,'ready',?,?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_reference=excluded.stripe_customer_reference,default_payment_method_reference=excluded.default_payment_method_reference,payment_method_status='ready',updated_at=excluded.updated_at").run(owner.owner_user_id, `cus_${owner.owner_user_id}`, `pm_${owner.owner_user_id}`, ISO, ISO);
}
function seedBalance(raw, creatorId, amount, key) { raw.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'manual_adjustment',?,'USD',?,'available','fixture',?,?)").run(creatorId, amount, ISO, key, ISO); }
function seedAnnual(raw, creatorId, userId) {
  raw.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES('annual-term',?,'annual_prepaid',20000,?,?,'renews','active',?,?)").run(creatorId, ISO, END, ISO, ISO);
  raw.prepare("INSERT INTO preferred_billing_commitments(id,preferred_term_id,creator_id,owner_user_id,plan_type,commitment_starts_at,commitment_ends_at,paid_through_at,normal_payment_source,billing_state,renewal_state,grace_days,created_at,updated_at) VALUES('annual-commitment','annual-term',?,?,'annual_prepaid',?,?,?,'stripe','current','renewal_decision_required',7,?,?)").run(creatorId, userId, ISO, END, END, ISO, ISO);
}
function financialSnapshot(raw, creatorId) { const count = (table) => raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE creator_id=?`).get(creatorId).n; return { balanceTransactions: count("creator_balance_transactions"), reservations: count("creator_balance_reservations"), servicePurchases: count("marketplace_service_purchases"), commitments: count("preferred_billing_commitments"), terms: count("creator_preferred_terms"), revenue: raw.prepare("SELECT COUNT(*) n FROM marketplace_service_revenue_ledger r JOIN marketplace_service_purchases p ON p.id=r.service_purchase_id WHERE p.creator_id=?").get(creatorId).n }; }
async function addUser(raw, auth, id, email) { raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(id, email, ISO, ISO); raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${id}-session`, id, await auth.hashToken(`${id}-token`), await auth.hashToken(`${id}-csrf`), ISO, END, ISO); }
function get(user, route) { return new Request(`https://example.com/api/creator/${route}`, { headers: { cookie: `__Host-trg_session=${user}-token` } }); }
function post(user, route, body) { return new Request(`https://example.com/api/creator/${route}`, { method: "POST", headers: { origin: "https://example.com", cookie: `__Host-trg_session=${user}-token; trg_account_csrf=${user}-csrf`, "x-csrf-token": `${user}-csrf`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?repair=${Math.random()}`); }
function d1(raw) { return { prepare(sql) { let values = []; return { bind(...input) { values = input; return this; }, async first() { return raw.prepare(sql).get(...values) || null; }, async all() { return { results: raw.prepare(sql).all(...values) }; }, async run() { const result = raw.prepare(sql).run(...values); return { changes: Number(result.changes), meta: { changes: Number(result.changes) } }; } }; }, async batch(statements) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } }; }
main().catch((error) => { console.error(error); process.exitCode = 1; });
