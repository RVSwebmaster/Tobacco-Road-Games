const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-08-26T15:00:00Z");
const ACCESS_SECRET = "pass-four-order-access-secret-long-enough";

async function main() { testDiscovery(); await testHistoricalClaim(); console.log("Marketplace Pass 4 tests passed."); }
function testDiscovery() {
  const { queryMarketplace } = require(path.join(ROOT, "shared", "marketplace-discovery.js"));
  const products = [
    { slug:"alpha", genre:"horror", playerCountMin:2, playerCountMax:5, gmMode:"gm-less", prepBurden:"low", playMode:"one-shot", rulesComplexity:"light", mediaType:"digital" },
    { slug:"beta", genre:"fantasy", playerCountMin:4, playerCountMax:6, gmMode:"required", prepBurden:"low", playMode:"either", rulesComplexity:"medium", mediaType:"hybrid" },
    { slug:"rv-product", authorSlugs:["rv-sawyer"] }, { slug:"other-product", authorSlugs:["other-creator"] }
  ];
  assert.deepEqual(queryMarketplace(products,{genre:"horror"}).map(id),["alpha"]);
  assert.deepEqual(queryMarketplace(products,{playerCount:4}).map(id),["alpha","beta"]);
  assert.deepEqual(queryMarketplace(products,{gmMode:"gm-less"}).map(id),["alpha"]);
  assert.deepEqual(queryMarketplace(products,{prepBurden:"low",playMode:"one-shot"}).map(id),["alpha","beta"]);
  assert.deepEqual(queryMarketplace(products,{genre:"horror",playerCount:4}).map(id),["alpha"]);
  assert.deepEqual(queryMarketplace(products,{rulesComplexity:"light"}).map(id),["alpha"]);
  assert.deepEqual(queryMarketplace(products,{}).map(id),products.map(id));
  assert.deepEqual(queryMarketplace(products,{genre:"romance"}),[]);
  assert.deepEqual(queryMarketplace(products,{}).slice(-2).map(id),["rv-product","other-product"],"RV Sawyer receives no ranking preference.");
}
async function testHistoricalClaim() {
  const auth=await load("functions/_lib/account-auth.mjs"), access=await load("functions/_lib/order-access.mjs"), claim=await load("functions/_lib/account-order-claim.mjs"), library=await load("functions/_lib/account-library.mjs");
  const raw=new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON;");
  for(const name of ["001_direct_storefront.sql","003_checkout_attempt_idempotency.sql","004_verified_stripe_webhooks.sql","005_secure_download_entitlements.sql","006_customer_delivery_owner_controls.sql","007_shared_accounts.sql","016_order_account_ownership.sql","017_historical_order_claims.sql"]) raw.exec(fs.readFileSync(path.join(ROOT,"migrations",name),"utf8"));
  const db=d1(raw), now=new Date(NOW).toISOString(); await user(raw,auth,"claimant","buyer@example.com",now); await user(raw,auth,"other","other@example.com",now);
  const historical=order(raw,"TRG-HIST","buyer@example.com",null,now), mismatch=order(raw,"TRG-MISMATCH","different@example.com",null,now), owned=order(raw,"TRG-OWNED","buyer@example.com","other",now);
  const item=Number(raw.prepare("INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES(?,'agency','Agency','rv-sawyer','[\"rv-sawyer\"]',1,100,100,100,'USD','1.0','2026-06-24',?)").run(historical,now).lastInsertRowid); raw.prepare("INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at) VALUES(?,?, 'agency','agency/file.pdf','Agency.pdf','application/pdf',10,'active',?)").run(historical,item,now);
  const historicalToken=(await access.ensureActiveOrderAccessCredential(db,{id:historical,payment_status:"paid"},ACCESS_SECRET,{nowMs:NOW})).token;
  const mismatchToken=(await access.ensureActiveOrderAccessCredential(db,{id:mismatch,payment_status:"paid"},ACCESS_SECRET,{nowMs:NOW})).token;
  const ownedToken=(await access.ensureActiveOrderAccessCredential(db,{id:owned,payment_status:"paid"},ACCESS_SECRET,{nowMs:NOW})).token;
  const env={TRG_ORDERS:db,ORDER_ACCESS_SIGNING_SECRET:ACCESS_SECRET};
  assert.equal((await claim.handleAccountOrderClaimRequest(req("claimant-token","claimant-csrf",historicalToken,false),env,{nowMs:NOW})).status,403);
  assert.equal((await claim.handleAccountOrderClaimRequest(req("claimant-token","claimant-csrf","altered",true),env,{nowMs:NOW})).status,400);
  assert.equal((await claim.handleAccountOrderClaimRequest(req("claimant-token","claimant-csrf",mismatchToken,true),env,{nowMs:NOW})).status,400); assert.equal(raw.prepare("SELECT user_id FROM orders WHERE id=?").get(mismatch).user_id,null);
  assert.equal((await claim.handleAccountOrderClaimRequest(req("claimant-token","claimant-csrf",ownedToken,true),env,{nowMs:NOW})).status,400); assert.equal(raw.prepare("SELECT user_id FROM orders WHERE id=?").get(owned).user_id,"other");
  assert.equal((await claim.handleAccountOrderClaimRequest(req("claimant-token","claimant-csrf",historicalToken,true),env,{nowMs:NOW})).status,200); assert.equal(raw.prepare("SELECT user_id FROM orders WHERE id=?").get(historical).user_id,"claimant");
  const libraryResponse=await library.handleAccountLibraryRequest(new Request("https://example.com/api/account/library",{headers:{cookie:"__Host-trg_session=claimant-token"}}),{...env,DOWNLOAD_SIGNING_SECRET:"pass-four-download-secret-long-enough"},{nowMs:NOW}); assert.equal((await libraryResponse.json()).items[0].orderReference,"TRG-HIST");
  const audits=raw.prepare("SELECT outcome,verification_method,reason_code FROM historical_order_claim_audit ORDER BY id").all(); assert.deepEqual(audits.map(row=>row.outcome),["rejected","rejected","succeeded"]); assert.ok(audits.every(row=>row.verification_method==="verified_email_and_order_access")); assert.doesNotMatch(JSON.stringify(audits),/oa1\.|credential|token/i);
}
function id(product){return product.slug;}
async function user(raw,auth,idValue,email,now){raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(idValue,email,now,now);raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${idValue}-session`,idValue,await auth.hashToken(`${idValue}-token`),await auth.hashToken(`${idValue}-csrf`),now,"2027-08-26T15:00:00Z",now);}
function order(raw,reference,email,userId,now){return Number(raw.prepare("INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,user_id) VALUES(?,?,?,?,'USD',100,100,'paid','fulfilled','sent',?,?)").run(reference,email,email,`hash-${reference}`,now,userId).lastInsertRowid);}
function req(token,csrf,credential,sameOrigin){return new Request("https://example.com/api/account/claim-order",{method:"POST",headers:{cookie:`__Host-trg_session=${token}; trg_account_csrf=${csrf}`,"content-type":"application/json","x-csrf-token":csrf,origin:sameOrigin?"https://example.com":"https://evil.example"},body:JSON.stringify({credential})});}
function d1(raw){return{prepare(sql){let values=[];return{bind(...next){values=next;return this;},first:async()=>raw.prepare(sql).get(...values)||null,all:async()=>({results:raw.prepare(sql).all(...values)}),run:async()=>{const result=raw.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)},changes:Number(result.changes)}}};},async batch(statements){raw.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec("COMMIT");return results;}catch(error){raw.exec("ROLLBACK");throw error;}}};}
function load(relative){return import(pathToFileURL(path.join(ROOT,relative)).href+`?pass4=${Math.random()}`);}
main().catch(error=>{console.error(error);process.exitCode=1;});
