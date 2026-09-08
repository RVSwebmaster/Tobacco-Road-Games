const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-09-07T15:00:00Z"), ISO = new Date(NOW).toISOString();

async function main() {
  const raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort()) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  seed(raw);
  const db = d1(raw), bucket = r2(), env = { TRG_ORDERS: db, TRG_PRODUCTS: bucket, OWNER_SESSION_SECRET: "session-secret", OWNER_CSRF_SECRET: "csrf-secret" };
  const auth = await load("functions/_lib/owner-auth.mjs"), maintenance = await load("functions/_lib/owner-listing-files.mjs"), creatorFiles = await load("functions/_lib/creator-files.mjs");
  const ownerCookie = `${auth.SESSION_COOKIE_NAME}=${await auth.createSessionToken("owner@test.invalid", env.OWNER_SESSION_SECRET, NOW)}`;
  const adminCookie = `${auth.SESSION_COOKIE_NAME}=${await auth.createSessionToken("admin@test.invalid", env.OWNER_SESSION_SECRET, NOW)}`;

  let response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?q=Support"), env, { nowMs: NOW });
  assert.equal(response.status, 403, "Unauthenticated requests must fail.");
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?q=Support", { headers: { cookie: "trg_account_session=creator-session" } }), env, { nowMs: NOW });
  assert.equal(response.status, 403, "Creator login alone must not grant owner maintenance.");
  for (const cookie of [ownerCookie, adminCookie]) {
    response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?q=Support", { headers: { cookie } }), env, { nowMs: NOW });
    assert.equal(response.status, 200);
  }
  let payload = await response.json();
  assert.equal(payload.listings.length, 2); const found = payload.listings.find((listing) => listing.id === "listing-one"); assert.equal(found.creator_name, "Creator Support Test"); assert.equal(found.title, "Support Product");

  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?listingId=listing-one", { headers: { cookie: ownerCookie } }), env, { nowMs: NOW });
  payload = await response.json(); assert.equal(response.status, 200); assert.equal(payload.files.length, 1); assert.equal(payload.files[0].secureDeliveryState, "ready"); assert.equal(payload.files[0].storageState, "present");
  assert.match(payload.files[0].downloadUrl, /^\/owner\/api\/listing-files\?download=/); assert.equal(payload.files[0].quarantine_key, undefined); assert.doesNotMatch(JSON.stringify(payload), /r2\.cloudflarestorage|https:\/\/.*product\.pdf/);

  const holdBefore = snapshot(raw), holdCsrf = await auth.createCsrfToken("owner@test.invalid", env.OWNER_CSRF_SECRET, NOW);
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${holdCsrf}`, origin: "https://example.test", "x-csrf-token": holdCsrf, "content-type": "application/json" }, body: JSON.stringify({ action: "place_review_hold", listingId: "listing-one", reason: "Needs corrective product metadata.", correctiveActionExpected: true }) }), env, { nowMs: NOW });
  assert.equal(response.status, 200); let held = raw.prepare("SELECT owner_review_hold,owner_review_hold_reason,owner_review_hold_corrective_action_expected FROM creator_listings WHERE id='listing-one'").get(); assert.equal(held.owner_review_hold, 1); assert.equal(held.owner_review_hold_reason, "Needs corrective product metadata."); assert.equal(held.owner_review_hold_corrective_action_expected, 1); assert.equal(snapshot(raw).earningsCents, holdBefore.earningsCents); assert.equal(snapshot(raw).entitlements, holdBefore.entitlements);
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${holdCsrf}`, origin: "https://example.test", "x-csrf-token": holdCsrf, "content-type": "application/json" }, body: JSON.stringify({ action: "restore_review_hold", listingId: "listing-one" }) }), env, { nowMs: NOW });
  assert.equal(response.status, 200); held = raw.prepare("SELECT owner_review_hold,owner_review_hold_reason FROM creator_listings WHERE id='listing-one'").get(); assert.equal(held.owner_review_hold, 0); assert.equal(held.owner_review_hold_reason, "");
  raw.prepare("UPDATE creator_listings SET owner_review_hold=1,owner_review_hold_reason='Inactivity also applies',owner_review_hold_started_at=?,owner_review_hold_corrective_action_expected=0,inactivity_state='inactive' WHERE id='listing-one'").run(ISO);
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${holdCsrf}`, origin: "https://example.test", "x-csrf-token": holdCsrf, "content-type": "application/json" }, body: JSON.stringify({ action: "restore_review_hold", listingId: "listing-one" }) }), env, { nowMs: NOW });
  assert.equal(response.status, 200); held = raw.prepare("SELECT owner_review_hold,inactivity_state FROM creator_listings WHERE id='listing-one'").get(); assert.equal(held.owner_review_hold, 0); assert.equal(held.inactivity_state, "inactive");

  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?download=file-old"), env, { nowMs: NOW }); assert.equal(response.status, 403);
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?download=file-old", { headers: { cookie: ownerCookie } }), env, { nowMs: NOW });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /old-product\.pdf/); assert.equal(await response.text(), "%PDF-1.7 old");

  const before = snapshot(raw), csrf = await auth.createCsrfToken("owner@test.invalid", env.OWNER_CSRF_SECRET, NOW), form = new FormData();
  form.set("listingId", "listing-one"); form.set("fileId", "file-old"); form.set("file", new File(["%PDF-1.7 replacement"], "Support Update.pdf", { type: "application/pdf" }));
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${csrf}`, origin: "https://example.test", "x-csrf-token": csrf }, body: form }), env, { nowMs: NOW });
  payload = await response.json(); assert.equal(response.status, 201, JSON.stringify(payload)); assert.equal(payload.file.state, "accepted"); assert.equal(payload.file.secureDeliveryState, "ready");
  const next = snapshot(raw); assert.equal(next.orders, before.orders); assert.equal(next.items, before.items); assert.equal(next.entitlements, before.entitlements); assert.equal(next.earningsRows, before.earningsRows); assert.equal(next.earningsCents, before.earningsCents); assert.equal(next.creatorId, before.creatorId); assert.equal(next.entitlementKey, "support-product/product.pdf");
  assert.equal(raw.prepare("SELECT validation_state FROM creator_listing_files WHERE id='file-old'").get().validation_state, "superseded");
  const current = raw.prepare("SELECT * FROM creator_listing_files WHERE listing_id='listing-one' AND validation_state='accepted'").get(); assert.equal(current.id, payload.file.id); assert.equal(current.delivery_object_key, "support-product/product.pdf"); assert.equal(new TextDecoder().decode(bucket.bytes("support-product/product.pdf")), "%PDF-1.7 replacement");
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files?download=file-old", { headers: { cookie: ownerCookie } }), env, { nowMs: NOW }); assert.equal(await response.text(), "%PDF-1.7 old", "Superseded records must download their preserved quarantine copy, not masquerade as the current delivery.");
  const audit = raw.prepare("SELECT * FROM creator_publication_audit WHERE action='owner_file_replaced'").get(); assert.equal(audit.actor_type, "operator"); assert.equal(audit.actor_id, "owner@test.invalid"); assert.equal(audit.creator_id, "creator-support"); assert.deepEqual(JSON.parse(audit.context_json).beforeFileId, "file-old");

  const invalid = new FormData(); invalid.set("listingId", "listing-one"); invalid.set("fileId", current.id); invalid.set("file", new File([new Uint8Array([137,80,78,71,13,10,26,10])], "wrong.pdf", { type: "application/pdf" }));
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${csrf}`, origin: "https://example.test", "x-csrf-token": csrf }, body: invalid }), env, { nowMs: NOW }); assert.equal(response.status, 415);
  const cross = new FormData(); cross.set("listingId", "listing-two"); cross.set("fileId", current.id); cross.set("file", new File(["%PDF-1.7 cross"], "cross.pdf", { type: "application/pdf" }));
  response = await maintenance.handleOwnerListingFiles(request("/owner/api/listing-files", { method: "POST", headers: { cookie: `${ownerCookie}; ${auth.CSRF_COOKIE_NAME}=${csrf}`, origin: "https://example.test", "x-csrf-token": csrf }, body: cross }), env, { nowMs: NOW }); assert.equal(response.status, 409); assert.equal(snapshot(raw).auditRows, next.auditRows);
  await assert.rejects(() => creatorFiles.prepareCreatorListingFile(new File([new Uint8Array(creatorFiles.CREATOR_FILE_LIMITS.product + 1)], "huge.pdf", { type: "application/pdf" }), "product"), /smaller than 50 MB/);

  const source = read("functions/_lib/owner-listing-files.mjs"), page = read("owner/listing-files.html"), route = read("functions/owner/api/listing-files.js"), dashboard = read("owner/index.html"), holdMigration = read("migrations/051_creator_listing_review_hold.sql"), storefront = read("assets/js/storefront.js");
  assert.match(source, /verifyAuthenticatedOwnerMutationRequest/); assert.match(source, /prepareCreatorListingFile/); assert.doesNotMatch(source, /\.delete\(/); assert.match(route, /handleOwnerListingFiles/); assert.match(page, /Listing File Maintenance/); assert.match(dashboard, /Maintain Listing Files/);
  assert.match(holdMigration, /owner_review_hold/); assert.match(source, /place_review_hold/); assert.match(source, /restore_review_hold/); assert.match(storefront, /listing-availability/); assert.match(read("functions/_lib/cart-checkout.mjs"), /owner_review_hold/); assert.match(read("functions/_lib/marketplace-discovery-labels.mjs"), /owner_review_hold=0/);
  console.log("Owner listing file maintenance tests passed.");
}

function seed(raw) {
  for (const [id, title] of [["listing-one", "Support Product"], ["listing-two", "Other Product"]]) {
    if (id === "listing-one") raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at)VALUES('creator-support','creator-support','Creator Support Test','approved','active',?,?)").run(ISO,ISO);
    raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,source_product_slug,public_product_slug,title,lifecycle_state,publication_state,inactivity_state,media_type,created_at,updated_at)VALUES(?,'creator-support',?,?,?,?, 'active','published','active','digital',?,?)").run(id, id === "listing-one" ? "support-product" : "other-product", id === "listing-one" ? "support-product" : "other-product", id === "listing-one" ? "support-product" : "other-product", title, ISO, ISO);
  }
  raw.prepare("INSERT INTO creator_listing_files(id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,validation_state,validation_message,delivery_object_key,uploaded_at,validated_at)VALUES('file-old','listing-one','creator-support','product','Old Product.pdf','old-product.pdf','application/pdf',12,'creator-quarantine/creator-support/listing-one/file-old/old-product.pdf','accepted','','support-product/product.pdf',?,?)").run(ISO,ISO);
  const orderId=Number(raw.prepare("INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at)VALUES('TRG-MAINT','buyer@test.invalid','buyer@test.invalid','hash','USD',1000,1000,'paid','ready','sent',?,?)").run(ISO,ISO).lastInsertRowid);
  const itemId=Number(raw.prepare("INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at)VALUES(?,'support-product','Support Product','creator-support','[\"creator-support\"]',1,1000,1000,1000,'USD','1','2026-09-07',?)").run(orderId,ISO).lastInsertRowid);
  raw.prepare("INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at)VALUES(?,?,'support-product','support-product/product.pdf','Support Product.pdf','application/pdf',12,'active',?)").run(orderId,itemId,ISO);
  raw.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,order_item_id,product_slug,available_at,payout_state,reason,idempotency_key,created_at)VALUES('creator-support','sale_earning',800,'USD',?,?,'support-product',?,'available','fixture','maintenance-sale',?)").run(orderId,itemId,ISO,ISO);
}
function snapshot(raw){return{orders:count(raw,"orders"),items:count(raw,"order_items"),entitlements:count(raw,"download_entitlements"),earningsRows:count(raw,"creator_earnings_ledger"),earningsCents:raw.prepare("SELECT SUM(amount_cents)n FROM creator_earnings_ledger").get().n,creatorId:raw.prepare("SELECT creator_id FROM creator_listings WHERE id='listing-one'").get().creator_id,entitlementKey:raw.prepare("SELECT r2_object_key FROM download_entitlements").get().r2_object_key,auditRows:count(raw,"creator_publication_audit")};}
function r2(){const map=new Map([["support-product/product.pdf",record("%PDF-1.7 old","application/pdf")],["creator-quarantine/creator-support/listing-one/file-old/old-product.pdf",record("%PDF-1.7 old","application/pdf")]]);return{async put(key,body,options={}){const bytes=body instanceof Uint8Array?body:new Uint8Array(await new Response(body).arrayBuffer());map.set(key,{bytes,httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{},uploaded:new Date(NOW)});},async head(key){const value=map.get(key);return value?{size:value.bytes.byteLength,objectSize:value.bytes.byteLength,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata,uploaded:value.uploaded}:null;},async get(key){const value=map.get(key);return value?{body:value.bytes,size:value.bytes.byteLength,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata}:null;},bytes(key){return map.get(key)?.bytes;}};}
function record(text,type){return{bytes:new TextEncoder().encode(text),httpMetadata:{contentType:type},customMetadata:{},uploaded:new Date(NOW)};}
function request(url,options={}){return new Request(`https://example.test${url}`,options);}
function count(raw,table){return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;}
function read(file){return fs.readFileSync(path.join(ROOT,file),"utf8");}
function load(file){return import(pathToFileURL(path.join(ROOT,file)).href+`?${Math.random()}`);}
function d1(raw){return{prepare(sql){let values=[];return{bind(...next){values=next;return this;},first:async()=>raw.prepare(sql).get(...values)||null,all:async()=>({results:raw.prepare(sql).all(...values)}),run:async()=>raw.prepare(sql).run(...values)};},async batch(statements){raw.exec("BEGIN");try{for(const statement of statements)await statement.run();raw.exec("COMMIT");}catch(error){raw.exec("ROLLBACK");throw error;}}};}
main().catch((error)=>{console.error(error);process.exitCode=1;});
