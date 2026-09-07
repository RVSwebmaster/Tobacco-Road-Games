const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-08-31T12:00:00Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const db = d1(raw);
  seed(raw);
  const policy = await load("functions/_lib/creator-internal-purchase-policy.mjs");
  const service = await load("functions/_lib/creator-service-purchases.mjs");

  assert.deepEqual(await policy.getCreatorInternalPurchasePrivilege(db, { creatorId: "preferred", userId: "preferred-user", nowMs: NOW }), { allowed: true, preferred: true, ownerException: false });
  assert.equal((await policy.getCreatorInternalPurchasePrivilege(db, { creatorId: "standard", userId: "standard-user", nowMs: NOW })).allowed, false);
  assert.equal((await policy.getCreatorInternalPurchasePrivilege(db, { creatorId: "expired", userId: "expired-user", nowMs: NOW })).allowed, false);
  assert.deepEqual(await policy.getCreatorInternalPurchasePrivilege(db, { creatorId: policy.OWNER_CREATOR_ID, userId: "rv-owner", nowMs: NOW }), { allowed: true, preferred: false, ownerException: true });
  assert.equal((await policy.getCreatorInternalPurchasePrivilege(db, { creatorId: "owner-lookalike", userId: "rv-owner", nowMs: NOW })).allowed, false, "The owner exception must not become a generic role bypass.");

  const delivery = { r2ObjectKey: "creator/product.pdf", customerFilename: "product.pdf", contentType: "application/pdf" };
  const digital = { slug: "digital", creatorId: "seller", mediaType: "digital", fulfillmentEligible: true };
  assert.doesNotThrow(() => policy.assertDigitalCreatorProduct(digital, delivery));
  for (const product of [
    { ...digital, mediaType: "physical" },
    { ...digital, mediaType: "hybrid" },
    { ...digital, outsideVendor: true },
    { ...digital, externalFulfillment: true },
    { ...digital, fulfillmentMode: "external" },
    { ...digital, creatorId: "" },
    { ...digital, fulfillmentEligible: false },
  ]) assert.throws(() => policy.assertDigitalCreatorProduct(product, delivery), /internally fulfilled digital Creator products/);

  const beforeExpired = available(raw, "expired");
  for (const sku of ["preferred_monthly", "preferred_annual", "ad_credit_package"])
    await assert.rejects(() => service.purchaseServiceWithCreatorBalance(db, {
      creatorId: sku === "ad_credit_package" ? "standard" : "expired",
      userId: sku === "ad_credit_package" ? "standard-user" : "expired-user",
      sku, idempotencyKey: nextKey(), nowMs: NOW,
    }), /active Preferred|Initial Preferred activation/);
  assert.equal(available(raw, "expired"), beforeExpired);
  assert.equal(count(raw, "marketplace_service_purchases"), 0);
  assert.equal(count(raw, "creator_balance_reservations"), 0);

  const preferredAd = await service.purchaseServiceWithCreatorBalance(db, { creatorId: "preferred", userId: "preferred-user", sku: "ad_credit_package", idempotencyKey: nextKey(), nowMs: NOW });
  assert.equal(preferredAd.creditsIssued, 5);
  assert.equal(preferredAd.paymentSource, "creator_balance");
  const ownerAd = await service.purchaseServiceWithCreatorBalance(db, { creatorId: policy.OWNER_CREATOR_ID, userId: "rv-owner", sku: "ad_credit_package", idempotencyKey: nextKey(), nowMs: NOW });
  assert.equal(ownerAd.creditsIssued, 5);

  await assert.rejects(() => service.purchaseServiceWithCreatorBalance(db, { creatorId: "standard-additional", userId: "standard-user", sku: "additional_identity_monthly", idempotencyKey: nextKey(), nowMs: NOW }), /active Preferred Creator account is required/);
  const identity = await service.purchaseServiceWithCreatorBalance(db, { creatorId: "preferred-additional", userId: "preferred-user", sku: "additional_identity_monthly", idempotencyKey: nextKey(), nowMs: NOW });
  assert.equal(identity.amountCents, 1000);
  assert.equal(identity.paymentSource, "creator_balance");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_service_purchases WHERE payment_source='creator_balance' AND (provider_payment_reference IS NOT NULL OR stripe_checkout_session_id IS NOT NULL)").get().n, 0);
  assert.equal(count(raw, "orders"), 0, "Services do not become product GMV.");
  console.log("Preferred Creator internal purchasing policy tests passed.");
}

let keyNumber = 1000;
function nextKey() { keyNumber += 1; return `svc_00000000-0000-4000-8000-${String(keyNumber).padStart(12, "0")}`; }
function seed(raw) {
  for (const [userId, role] of [["preferred-user", "user"], ["standard-user", "user"], ["expired-user", "user"], ["rv-owner", "owner"]])
    raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at)VALUES(?,?,1,'active',?,?,?)").run(userId, `${userId}@test.invalid`, role, ISO, ISO);
  for (const [creatorId, userId, identityType] of [["preferred", "preferred-user", "primary"], ["standard", "standard-user", "primary"], ["expired", "expired-user", "primary"], ["creator-rv-sawyer", "rv-owner", "primary"], ["owner-lookalike", "rv-owner", "additional"], ["standard-additional", "standard-user", "additional"], ["preferred-additional", "preferred-user", "additional"]]) {
    if (creatorId !== "creator-rv-sawyer")
      raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at)VALUES(?,?,?,'approved','active',?,?)").run(creatorId, creatorId, creatorId, ISO, ISO);
    else
      raw.prepare("UPDATE marketplace_creators SET registration_status='active',updated_at=? WHERE id=?").run(ISO, creatorId);
    raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at)VALUES(?,?,?,'active',?,?,?,?)").run(creatorId, userId, identityType, identityType === "additional" ? "current" : "not_required", identityType === "additional" ? "additional_paid" : "primary_free", ISO, ISO);
    raw.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at)VALUES(?,'manual_adjustment',30000,'USD',?,'available','fixture',?,?)").run(creatorId, ISO, `balance:${creatorId}`, ISO);
  }
  for (const creatorId of ["preferred", "preferred-additional"]) preferredTerm(raw, creatorId, "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
  preferredTerm(raw, "expired", "2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}
function preferredTerm(raw, creatorId, starts, ends) { raw.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at)VALUES(?,?,'annual_prepaid',20000,?,?,'renews','active',?,?)").run(`preferred:${creatorId}`, creatorId, starts, ends, ISO, ISO); }
function available(raw, creatorId) { return Number(raw.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM creator_earnings_ledger WHERE creator_id=?").get(creatorId).n) + Number(raw.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM creator_balance_transactions WHERE creator_id=?").get(creatorId).n); }
function count(raw, table) { return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; }
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?${Math.random()}`); }
function d1(raw) { return { prepare(sql) { let values=[]; return { bind(...next){values=next;return this;}, first:async()=>raw.prepare(sql).get(...values)||null, all:async()=>({results:raw.prepare(sql).all(...values)}), run:async()=>raw.prepare(sql).run(...values) }; }, async batch(statements){raw.exec("BEGIN");try{for(const statement of statements)await statement.run();raw.exec("COMMIT");}catch(error){raw.exec("ROLLBACK");throw error;}} }; }
main().catch((error) => { console.error(error); process.exitCode = 1; });
