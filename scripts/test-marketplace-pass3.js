const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-08-26T12:00:00Z");

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs"), orders = await load("functions/_lib/orders-d1.mjs"), library = await load("functions/_lib/account-library.mjs"), publish = await load("functions/_lib/owner-publish.mjs");
  const valid = new FormData(); valid.set("gmMode", "gm-less"); valid.set("prepBurden", "low"); valid.set("playMode", "one-shot"); valid.set("rulesComplexity", "light"); valid.set("mediaType", "digital"); valid.set("playerCountMin", "2"); valid.set("playerCountMax", "4");
  const metadata = {}, errors = []; publish.applyMarketplaceMetadata(valid, metadata, errors); assert.deepEqual(errors, []); assert.equal(metadata.playerCountMax, 4);
  const sparseErrors = []; publish.applyMarketplaceMetadata(new FormData(), {}, sparseErrors); assert.deepEqual(sparseErrors, []);
  const invalid = new FormData(); invalid.set("gmMode", "sometimes"); invalid.set("playerCountMin", "9"); invalid.set("playerCountMax", "2"); const invalidErrors = []; publish.applyMarketplaceMetadata(invalid, {}, invalidErrors); assert.ok(invalidErrors.length >= 2);
  const nonnumeric = new FormData(); nonnumeric.set("playerCountMin", "four"); const nonnumericErrors = []; publish.applyMarketplaceMetadata(nonnumeric, {}, nonnumericErrors); assert.ok(nonnumericErrors.some((error) => error.includes("playerCountMin")));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "functions/_lib/cart-checkout.mjs"), "utf8"), /genre|gmMode|prepBurden|rulesComplexity/);

  const raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON;");
  for (const name of ["001_direct_storefront.sql", "003_checkout_attempt_idempotency.sql", "004_verified_stripe_webhooks.sql", "005_secure_download_entitlements.sql", "007_shared_accounts.sql", "016_order_account_ownership.sql"]) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  const db = d1(raw), now = new Date(NOW).toISOString();
  for (const user of ["user-one", "user-two"]) { raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','user',?,?)").run(user, `${user}@example.com`, now, now); const token=`${user}-token`; raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${user}-session`,user,await auth.hashToken(token),await auth.hashToken(`${user}-csrf`),now,"2027-08-26T12:00:00Z",now); }
  const first=await createOrder(orders,db,"one","user-one"), second=await createOrder(orders,db,"two","user-two"), historical=await createOrder(orders,db,"historical",null);
  for(const order of [first,second]){const item=raw.prepare("SELECT * FROM order_items WHERE order_id=?").get(order.id);raw.prepare("INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at) VALUES(?,?,?,?,?,'application/pdf',10,'active',?)").run(order.id,item.id,"agency","agency/product.pdf","Agency.pdf",now);}
  assert.equal(raw.prepare("SELECT user_id FROM orders WHERE id=?").get(historical.id).user_id,null);
  const env={TRG_ORDERS:db,DOWNLOAD_SIGNING_SECRET:"pass-three-download-secret-long-enough"}; assert.equal((await library.handleAccountLibraryRequest(new Request("https://example.com/api/account/library"),env,{nowMs:NOW})).status,401);
  const body1=await (await library.handleAccountLibraryRequest(req("user-one-token"),env,{nowMs:NOW})).json(), body2=await (await library.handleAccountLibraryRequest(req("user-two-token"),env,{nowMs:NOW})).json();
  assert.equal(body1.items.length,1); assert.equal(body1.items[0].orderReference,first.public_id); assert.match(body1.items[0].downloadUrl,/^\/store\/download\?credential=/); assert.equal(body2.items.length,1); assert.equal(body2.items[0].orderReference,second.public_id); assert.notEqual(body2.items[0].orderReference,first.public_id);
  console.log("Marketplace Pass 3 tests passed.");
}
async function createOrder(orders,db,suffix,userId){return orders.createPendingOrder(db,{publicId:`TRG-${suffix}`,userId,customerEmail:`${suffix}@example.com`,customerEmailNormalized:`${suffix}@example.com`,customerEmailHash:`hash-${suffix}`,currency:"USD",subtotalCents:100,totalCents:100,paymentStatus:"paid",fulfillmentStatus:"ready",emailStatus:"sent",createdAt:new Date(NOW).toISOString()},[{productSlug:"agency",productTitleSnapshot:"Agency",primaryAuthorSlug:"rv-sawyer",authorSlugsJson:'["rv-sawyer"]',quantity:1,listPriceCents:100,effectiveUnitPriceCents:100,lineTotalCents:100,currency:"USD",versionSnapshot:"1.0",lastUpdatedSnapshot:"2026-06-24",createdAt:new Date(NOW).toISOString()}]);}
function req(token){return new Request("https://example.com/api/account/library",{headers:{cookie:`__Host-trg_session=${token}`}});}
function d1(raw){return{prepare(sql){let values=[];return{bind(...next){values=next;return this;},first:async()=>raw.prepare(sql).get(...values)||null,all:async()=>({results:raw.prepare(sql).all(...values)}),run:async()=>({meta:{changes:Number(raw.prepare(sql).run(...values).changes)}})};},async batch(statements){raw.exec("BEGIN");try{for(const statement of statements)await statement.run();raw.exec("COMMIT");}catch(error){raw.exec("ROLLBACK");throw error;}}};}
function load(relative){return import(pathToFileURL(path.join(ROOT,relative)).href+`?pass3=${Math.random()}`);}
main().catch((error)=>{console.error(error);process.exitCode=1;});
