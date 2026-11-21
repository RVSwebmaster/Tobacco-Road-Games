import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || "");
const site = path.join(root, "site");
const importSite = (file) => import(pathToFileURL(path.join(site, file)));
const db = new DatabaseSync(":memory:");
const sqliteFiles = fs.readdirSync(path.join(site, "migrations"))
  .filter(file => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0,3)) <= 72)
  .sort();
assert.equal(sqliteFiles.length,72);
for (const file of sqliteFiles) db.exec(fs.readFileSync(path.join(site, "migrations", file), "utf8"));
const now = new Date().toISOString(), past = new Date(Date.now()-86400000).toISOString(), future = new Date(Date.now()+86400000).toISOString();
db.exec("PRAGMA foreign_keys=ON");

function prepare(sql, params = []) {
  const execute = () => db.prepare(sql);
  return {
    bind: (...values) => prepare(sql,values),
    async first() { return execute().get(...params) || null; },
    async all() { return {results:execute().all(...params)}; },
    async run() {
      const r = execute().run(...params);
      return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};
    }
  };
}

const adapter = {
  prepare,
  async batch(statements) {
    db.exec("BEGIN");
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      db.exec("COMMIT");
      return out;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
};
const env={TRG_ORDERS:adapter};
const auth=await importSite("functions/_lib/account-auth.mjs");
const library=await importSite("functions/_lib/account-library.mjs");
const navigation=await importSite("functions/_lib/progressive-navigation.mjs");
const profile=await importSite("functions/_lib/account-profile.mjs");
const origin="http://127.0.0.1";
const pin=randomBytes(24).toString("base64url")+"!xQ4";
const email=(label)=>`rehearsal-${label.toLowerCase()}@example.invalid`;
const hash=await auth.hashPassword(pin);
const tiers=[
  ["customer","user","/customer-profile/","customer.png"],
  ["creator","user","/creator/","creator.png"],
  ["founding25","user","/founding-25-profile/","founding-25.png"],
  ["premiumCreator","user","/premium-creator-profile/","premium-creator.png"],
  ["admin","admin","/admin-profile/","admin.png"],
  ["owner","owner","/owner-profile/","owner.png"],
];
for(const [label,role] of tiers){
  db.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)").run(label,email(label),role,now,now);
  db.prepare("INSERT INTO user_account_profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)").run(label,`Release ${label}`,now,now);
  db.prepare("INSERT INTO password_credentials(user_id,password_hash,created_at,updated_at) VALUES(?,?,?,?)").run(label,hash,now,now);
}
for(const id of ["creator","founding25","premiumCreator"]){
  db.prepare("INSERT INTO marketplace_creators(id,slug,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,id.toLowerCase(),id,now,now);
  db.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)").run(id,id,now);
  db.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','not_required','primary_free',?,?)").run(id,id,now,now);
}
db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,created_at,updated_at) VALUES('term','premiumCreator','annual_prepaid',20000,?,?,?,?)").run(past,future,now,now);
const trackedSchema=()=>db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
const objectsBefore=trackedSchema(), usersBefore=db.prepare("SELECT * FROM users ORDER BY id").all();
const credentialsBefore=db.prepare("SELECT * FROM password_credentials ORDER BY user_id").all();
db.exec(fs.readFileSync(path.join(scripts,"account-profile-072.sql"),"utf8"));
const objectsAfter=trackedSchema();
assert.deepEqual(objectsAfter.filter(o=>objectsBefore.some(b=>b.name===o.name)),objectsBefore);
assert.deepEqual(objectsAfter.filter(o=>!objectsBefore.some(b=>b.name===o.name)).map(o=>o.name),[
  "creator_commission_category_assignments","customer_registration_states","idx_creator_commission_assignments_current"
]);
assert.deepEqual(db.prepare("SELECT * FROM users ORDER BY id").all(),usersBefore);
assert.deepEqual(db.prepare("SELECT * FROM password_credentials ORDER BY user_id").all(),credentialsBefore);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM creator_commission_category_assignments").get().n,0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customer_registration_states").get().n,0);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
db.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES('designation','founding25','founding25',?,'owner','Synthetic rehearsal',?)").run(past,now);

const require=createRequire(import.meta.url);
const esbuild=require("esbuild");
async function importPageFunction(file) {
  const compiled = await esbuild.build({
    entryPoints: [path.join(site, "functions", file)], bundle: true, platform: "node", format: "esm", write: false,
  });
  const moduleFile = path.join(root, `rehearsal-${path.basename(file, ".js")}.mjs`);
  fs.writeFileSync(moduleFile, compiled.outputFiles[0].contents);
  return import(pathToFileURL(moduleFile));
}
const middleware = await importPageFunction("_middleware.js");

const config = await importSite("functions/_lib/homepage-config-d1.mjs");
const service = await importSite("functions/_lib/homepage-shelves.mjs");
const shelfEndpoint = await importPageFunction("api/homepage-shelves.js");
const shelfResponse = await shelfEndpoint.onRequestGet({ env });
assert.equal(shelfResponse.status, 200);
assert.equal(shelfResponse.headers.get("cache-control"), "public, max-age=60");
assert.deepEqual((await shelfResponse.json()).shelves.openRulesLibraryUpper.products, []);
const shelfSettings = config.defaultHomepageConfiguration();
shelfSettings.shelves.openRulesLibraryUpper.productIds = ["second", "first"];
db.prepare("UPDATE homepage_configurations SET configuration_json=?, revision=2").run(JSON.stringify(shelfSettings));
const catalog = ["first", "second", "unselected"].map(id => ({
  id, slug: id, title: id, buyMode: "preview-only", status: "preview-only",
  metadata: { openRulesEligible: true }, priceCents: 0,
}));
const shelves = await service.getHomepageShelves(adapter, { catalog });
assert.equal(shelves.configurationRevision, 2);
assert.deepEqual(shelves.shelves.openRulesLibraryUpper.products.map(({ id }) => id), ["second", "first"]);
assert.deepEqual(shelves.shelves.openRulesLibraryLower.products, []);
const unavailable = await shelfEndpoint.onRequestGet({ env: { TRG_ORDERS: null } });
assert.equal(unavailable.headers.get("cache-control"), "no-store");
assert.equal((await unavailable.json()).unavailable, true);

const dashboardAsset = "assets/js/creator-dashboard.js";
const dashboard = fs.readFileSync(path.join(site, "temp-creator/index.html"), "utf8");
assert.ok(dashboard.includes(`src="/${dashboardAsset}?`));
assert.match(dashboard, /id="creator-pdf-draft-form"/);
const gitBlob = (ref, file) => execFileSync("git", ["show", `${ref}:${file}`]);
for (const [ref, files] of [
  ["25f23d0ffba1d023da7ffed193fb9d3fcfda6fdc", [dashboardAsset]],
  ["f7ab9891933be571daf02e5204a16303b8f64afd", ["functions/_lib/homepage-config-d1.mjs", "functions/_lib/homepage-shelves.mjs", "functions/api/homepage-shelves.js"]],
]) {
  for (const file of files) assert.deepEqual(fs.readFileSync(path.join(site, file)), gitBlob(ref, file), file);
}
assert.match(fs.readFileSync(path.join(site, "styles.css"), "utf8"), /\.button:active:not\(:disabled\)\s*\{\s*transform: translateY\(1px\);\s*\}/);
globalThis.HTMLRewriter=class {
  on(){return this;}
  transform(response){return response;}
};
const req=(route,{method="GET",cookie="",body,ip="192.0.2.1",csrf}={})=>new Request(origin+route,{
  method, headers:{
    "cf-connecting-ip":ip,
    ...(cookie?{cookie}:{}),
    ...(method!=="GET"?{origin,"content-type":"application/json"}:{}),
    ...(csrf?{"x-csrf-token":csrf}:{})
  },
  ...(body?{body:JSON.stringify(body)}:{})
});
const cookieOf=(r)=>r.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const rendered=()=>Promise.resolve(new Response("Customer storefront",{headers:{"content-type":"text/html"}}));
const router=JSON.parse(fs.readFileSync(path.join(site,"_routes.json"),"utf8"));
for(const route of ["/customer","/customer/","/customer.html"]){
  assert.ok(router.include.includes(route));
  const response=await middleware.onRequest({request:req(route),env,next(){throw Error("Signed-out request reached Customer markup");}});
  assert.equal(response.status,302);
  assert.equal(response.headers.get("location"),origin+"/guest/");
}

let routeMap;
const storefront=fs.readFileSync(path.join(site,"customer.html"),"utf8");
routeMap=JSON.parse(storefront.match(/data-member-profile-routes="([^"]+)"/)[1].replaceAll("&quot;",'"'));
assert.ok(!storefront.includes("Login/Signup"));
for(const [label,,route,badge] of tiers){
  const login=await auth.handleAccountAuthRequest(req("/api/auth/login",{method:"POST",body:{email:email(label),password:pin}}),env);
  assert.equal(login.status,200,label);
  assert.equal((await login.json()).user.customerPrivilegesActive,true);
  const cookie=cookieOf(login);
  const home=await middleware.onRequest({request:req("/customer",{cookie}),env,next:rendered});
  assert.equal(home.status,200);
  assert.equal(home.headers.get("cache-control"),"no-store");
  const me=await auth.handleAccountMeRequest(req("/api/account/me",{cookie}),env);
  const m=await me.json();
  assert.equal(m.authenticated,true);
  assert.equal(m.user.accountClass,label);
  assert.equal(m.user.displayName,`Release ${label}`);
  assert.equal(routeMap[m.user.accountClass],route);
  const nav=await navigation.handleProgressiveNavigationRequest(req("/api/navigation",{cookie}),env);
  assert.equal((await nav.json()).authenticated,true);
  const accountProfile=await profile.handleAccountProfileRequest(req("/api/account/profile",{cookie}),env);
  assert.equal(accountProfile.status,200);
  const personalLibrary=await library.handleAccountLibraryRequest(req("/api/account/library",{cookie}),env);
  assert.equal(personalLibrary.status,200);
  assert.deepEqual((await personalLibrary.json()).items,[]);
  const logout=await auth.handleAccountAuthRequest(req("/api/auth/logout",{method:"POST",cookie,body:{}}),env);
  assert.equal(logout.status,200);
  assert.equal((await logout.json()).ok,true);
  assert.ok(logout.headers.getSetCookie().some(v=>v.startsWith("__Host-trg_session=")&&v.includes("Max-Age=0")));
  assert.equal((await (await auth.handleAccountMeRequest(req("/api/account/me",{cookie}),env)).json()).authenticated,false);
  const html=fs.readFileSync(path.join(site,route.slice(1),"index.html"),"utf8");
  assert.equal((html.match(/data-member-tier-badge/g)||[]).length,1);
  assert.equal(html.replaceAll("\r\n", "\n"), gitBlob("efb16dce8b3489193241809baeb6091b763e1071", `${route.slice(1)}index.html`).toString().replaceAll("\r\n", "\n"));
  assert.equal(fs.readFileSync(path.join(site,"assets/images/member-tier-badges",badge)).readUInt32BE(16),512);
}

db.prepare("INSERT INTO customer_registration_states(user_id,state,created_at,updated_at) VALUES('customer','pending',?,?)").run(now,now);
const pendingLogin=await auth.handleAccountAuthRequest(req("/api/auth/login",{method:"POST",body:{email:email("customer"),password:pin}}),env);
assert.equal(pendingLogin.status,200);
assert.equal((await pendingLogin.json()).user.customerPrivilegesActive,false);
assert.equal((await library.handleAccountLibraryRequest(req("/api/account/library",{cookie:cookieOf(pendingLogin)}),env)).status,403);
db.prepare("UPDATE creator_commission_category_assignments SET revoked_at=? WHERE id='designation'").run(now);
assert.equal((await (await importSite("functions/_lib/member-profile-access.mjs")).resolveMemberProfileAccess(adapter,{id:"founding25",role:"user"})).accountClass,"creator");

const newEmail=email("new");
const sent=[];
const emailProvider={async send(message){sent.push(message);}};
const registered=await auth.handleAccountAuthRequest(req("/api/auth/register",{method:"POST",body:{email:newEmail,password:pin,passwordConfirmation:pin}}),env,{emailProvider});
assert.equal(registered.status,201,await registered.clone().text());
const newRow=db.prepare("SELECT id FROM users WHERE email_normalized=?").get(newEmail);
assert.ok(newRow);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customer_registration_states WHERE user_id=?").get(newRow.id).n,0);
assert.equal(sent.length,1);
const verifyUrl=sent[0].text.match(/https?:\/\/\S+/)[0];
const verified=await auth.handleAccountAuthRequest(req("/api/auth/verify-email",{method:"POST",body:{token:new URL(verifyUrl).searchParams.get("verify")}}),env);
assert.equal(verified.status,200);
const reset=await auth.handleAccountAuthRequest(req("/api/auth/request-password-reset",{method:"POST",body:{email:newEmail}}),env,{emailProvider});
assert.equal(reset.status,200);
assert.equal(sent.length,2);
const wrong=await auth.handleAccountAuthRequest(req("/api/auth/login",{method:"POST",body:{email:newEmail,password:"wrong-test-password"}}),env);
assert.equal(wrong.status,401);

const guest=fs.readFileSync(path.join(site,"guest/index.html"),"utf8");
assert.match(guest,/id="guest-login"/);
assert.match(guest,/href="\/account.html#register-form"/);
assert.match(guest,/href="\/account.html#forgot-form"/);
assert.match(fs.readFileSync(path.join(site,"assets/js/progressive-navigation.js"),"utf8"),/location\.replace\("https:\/\/tobaccoroadgames\.com\/"\)/);
assert.match(fs.readFileSync(path.join(site,"_redirects"),"utf8"),/\/creator-dashboard\/ \/temp-creator\/ 302/);

const base="a0758e3c4a27800878ac7ed77becb86acfdf0414";
const baseEntries=new Map(execFileSync("git",["ls-tree","-rz",base],{encoding:"utf8",maxBuffer:10*1024*1024})
  .split("\0").filter(Boolean).map(entry=>{const [mode,file]=entry.split("\t"); return [file,mode.split(" ")[2]];})
  .filter(([file])=>!file.startsWith(".wrangler/")));
const blobHash=buffer=>createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
const changed=[];
const siteFiles=fs.readdirSync(site,{recursive:true})
  .map(file=>String(file).replaceAll("\\","/"))
  .filter(file=>file!==".wrangler"&&!file.startsWith(".wrangler/")&&fs.statSync(path.join(site,file)).isFile());
for (const file of siteFiles) {
  const contents = fs.readFileSync(path.join(site,file));
  const baseline = baseEntries.get(file);
  if (blobHash(contents) === baseline) continue;
  // Git archive on this Windows checkout expands the line endings of text blobs.
  if (!contents.includes(0)) {
    const original = contents.toString("utf8");
    if (Buffer.from(original,"utf8").equals(contents) && blobHash(Buffer.from(original.replaceAll("\r\n","\n"))) === baseline) continue;
  }
  changed.push(file);
}
const deleted=[...baseEntries.keys()].filter(file=>!siteFiles.includes(file));
assert.deepEqual(deleted.sort(), ["assets/css/creator-dashboard.css", "assets/js/creator-open-rules.js"]);
const manifest=fs.readFileSync(path.join(root,"release-files.txt"),"utf8").trim().split(/\r?\n/);
assert.deepEqual([
  ...changed.map(file => `${baseEntries.has(file) ? "M" : "A"}\t${file}`),
  ...deleted.map(file => `D\t${file}`),
].sort(), manifest.sort(), "Release manifest differs from baseline comparison");
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
assert.equal(db.prepare("PRAGMA quick_check").get().quick_check,"ok");
console.log(JSON.stringify({migrations:72,onlyNewSchema:3,approvedRouteMappings:tiers.length,successfulPasswordLogins:tiers.length,pendingAccess:"preserved",revokedDesignation:"fell back to Creator",signedOutRedirects:3,logoutRevocations:tiers.length,legacySignupVerificationAndResetRequest:"passed with stubbed email",credentialPreservation:"passed",openRules:"configured order, empty and unavailable shelves and cache policy verified",creatorDashboard:"exact live draft script",changedApplicationFiles:manifest.length,excludedMarketplaceAndPaymentFiles:"identical to live baseline"},null,2));

// Exercise the normal browser UI against the same local database, with network
// destinations outside loopback blocked by the browser rehearsal.
db.prepare("DELETE FROM customer_registration_states WHERE user_id='customer'").run();
const publicRoot=path.join(site,".wrangler","focused-pages-output");
const mime={
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",
  ".js":"application/javascript",".json":"application/json",".png":"image/png",
  ".webp":"image/webp",".svg":"image/svg+xml",".jpg":"image/jpeg"
};
let loopback;
function asset(pathname) {
  if (pathname==="/creator-dashboard/") return Response.redirect(loopback+"/temp-creator/",302);
  const route=pathname==="/"?"/guest/":pathname==="/customer"?"/customer.html":pathname;
  const file=path.resolve(publicRoot, "."+(route.endsWith("/")?route+"index.html":route));
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return new Response("Not found",{status:404});
  return new Response(fs.readFileSync(file),{headers:{"content-type":mime[path.extname(file)]||"application/octet-stream"}});
}
const server=createServer(async (incoming,outgoing)=>{
  try {
    const url=new URL(incoming.url,loopback);
    if(url.origin!==loopback) {outgoing.writeHead(400).end();return;}
    const chunks=[];
    for await(const chunk of incoming) chunks.push(chunk);
    const body=chunks.length?Buffer.concat(chunks):undefined;
    const request=new Request(url,{method:incoming.method,headers:incoming.headers,body});
    let response;
    if(url.pathname.startsWith("/api/auth/")) response=await auth.handleAccountAuthRequest(request,env,{emailProvider});
    else if(url.pathname==="/api/account/me") response=await auth.handleAccountMeRequest(request,env);
    else if(url.pathname==="/api/account/library") response=await library.handleAccountLibraryRequest(request,env);
    else if(url.pathname==="/api/account/profile") response=await profile.handleAccountProfileRequest(request,env);
    else if(url.pathname==="/api/navigation") response=await navigation.handleProgressiveNavigationRequest(request,env);
    else if(url.pathname.startsWith("/api/")) response=Response.json({}, {status:404});
    else response=await middleware.onRequest({request,env,next:()=>asset(url.pathname)});
    response.headers.forEach((value,name)=>{if(name!=="set-cookie")outgoing.setHeader(name,value);});
    const cookies=response.headers.getSetCookie();
    if(cookies.length)outgoing.setHeader("set-cookie",cookies);
    outgoing.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {
    console.error("Loopback route failed:",error.message);
    if(!outgoing.headersSent)outgoing.writeHead(500);
    outgoing.end();
  }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
loopback="http://127.0.0.1:"+server.address().port;
try {
  const rc=await new Promise((resolve,reject)=>{
    const browser=spawn(process.execPath,[path.join(scripts,"browser-rehearsal.cjs")],{
      cwd:root,stdio:"inherit",
      env:{...process.env,TRG_REHEARSAL_ORIGIN:loopback,TRG_REHEARSAL_PASSWORD:pin}
    });
    browser.on("error",reject);
    browser.on("exit",resolve);
  });
  assert.equal(rc,0,"Loopback Chromium rehearsal failed");
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
