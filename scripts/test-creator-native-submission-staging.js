// Staging-only Task 2O-A proof through the actual Creator and Owner review interfaces.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = process.env.TRG_WRANGLER_PATH || process.argv[2];
const ORIGIN = process.env.TRG_STAGING_PAGES_URL || process.argv[3];
const CONFIG = "ops/staging/wrangler.toml";
const DB_NAME = "trg-orders-staging";
const DB_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const suffix = randomUUID().replace(/-/g, "");
const userId = `task2oa-user-${suffix}`;
const ownerId = `task2oa-owner-${suffix}`;
const creatorId = `task2oa-creator-${suffix}`;
const creatorSlug = `task2oa-creator-${suffix}`;
const sessionId = `task2oa-session-${suffix}`;
const ownerSessionId = `task2oa-owner-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const ownerSessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const ownerCsrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const title = `Disposable Creator Submission ${suffix.slice(0, 8)}`;
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const freeTitle = `Disposable Free Creator ${suffix.slice(0, 8)}`;
const pwywTitle = `Disposable PWYW Creator ${suffix.slice(0, 8)}`;
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = Buffer.from("%PDF-1.7\nTask 2O-A disposable Creator product\n%%EOF", "utf8");
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function cli(...args) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
function query(command) {
  const result = JSON.parse(cli("d1", "execute", DB_NAME, "--remote", "--config", CONFIG, "--json", "--command", command));
  if (result.length !== 1 || result[0].success !== true)
    throw new Error(`Staging D1 query failed: ${JSON.stringify(result)}`);
  return result[0];
}
const db = {
  prepare(statement) {
    let values = [];
    return {
      bind(...items) { values = items; return this; },
      async first() { return query(bound()).results[0] || null; },
      async all() { return { results: query(bound()).results }; },
      async run() { return { meta: { changes: query(bound()).meta.changes } }; }
    };
    function bound() {
      let index = 0;
      const rendered = statement.replace(/\?/g, () => sql(values[index++]));
      if (index !== values.length) throw new Error("Staging D1 bind count mismatch.");
      return rendered;
    }
  }
};
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function authHeaders(token = sessionToken, csrf = csrfToken) {
  return {
    origin: ORIGIN,
    cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}`,
    "x-csrf-token": csrf
  };
}
function r2Delete(key) {
  cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG);
}
function r2Get(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: null, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, Buffer.from(result.stderr || "").toString());
  return Buffer.from(result.stdout);
}
function assertR2Missing(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: null, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 1);
}
function findBrowserExecutable() {
  const candidates = [process.env.TRG_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(executable, "A Chromium browser is required for Task 2O-A staging verification.");
  return executable;
}
async function getOpenPort() {
  const http = require("node:http");
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fetchJson(url, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}
function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
  };
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Unable to connect to Chromium DevTools."));
  });
  return {
    close: () => socket.close(),
    async send(method, params = {}) {
      await ready;
      const id = ++nextId;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    }
  };
}
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}
async function waitFor(cdp, expression, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await evaluate(cdp, expression)) return; } catch {}
    await delay(100);
  }
  throw new Error(message);
}
async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, "document.readyState === 'complete'", `Page did not load: ${url}`);
}
async function setIdentityCookies(cdp, token, csrf) {
  for (const cookie of [
    { name: "__Host-trg_session", value: token, httpOnly: true },
    { name: "trg_account_csrf", value: csrf, httpOnly: false }
  ]) {
    const result = await cdp.send("Network.setCookie", { ...cookie, url: ORIGIN, path: "/", secure: true, sameSite: "Lax" });
    assert.equal(result.success, true);
  }
}
async function setFile(cdp, filename) {
  const document = await cdp.send("DOM.getDocument", { depth: -1 });
  const node = await cdp.send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: "#creator-file-form input[type=file]"
  });
  assert.ok(node.nodeId, "Creator file input was not found.");
  await cdp.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filename] });
}
async function fillDraft(cdp, values) {
  await evaluate(cdp, `(() => {
    const form = document.getElementById('creator-draft-form');
    const values = ${JSON.stringify(values)};
    for (const [key, value] of Object.entries(values)) if (form.elements[key]) form.elements[key].value = value;
    form.pricingModel.dispatchEvent(new Event('change'));
    form.requestSubmit();
  })()`);
}
async function uploadFromUi(cdp, listingId, purpose, filename) {
  await evaluate(cdp, `(() => {
    const form = document.getElementById('creator-file-form');
    form.listingId.value = ${JSON.stringify(listingId)};
    form.purpose.value = ${JSON.stringify(purpose)};
  })()`);
  await setFile(cdp, filename);
  await evaluate(cdp, "document.getElementById('creator-file-form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))");
}
function removeDirectoryWithRetries(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(directory, { force: true, recursive: true }); return; }
    catch (error) {
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  fs.rmSync(directory, { force: true, recursive: true });
}

async function main() {
  assert.ok(WRANGLER, "TRG_WRANGLER_PATH is required.");
  assert.ok(new URL(ORIGIN || "").hostname.endsWith(".tobacco-road-games-staging.pages.dev"));
  const info = JSON.parse(cli("d1", "info", DB_NAME, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DB_ID);
  assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
  assert.equal(query("SELECT COUNT(*) n FROM d1_migrations WHERE name='064_creator_native_submission_pricing.sql'").results[0].n, 1);
  const now = new Date();
  const expires = new Date(now.getTime() + 45 * 60_000).toISOString();
  query(`INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES
    (${sql(userId)},${sql(`${userId}@example.invalid`)},1,'active','user',${sql(now.toISOString())},${sql(now.toISOString())}),
    (${sql(ownerId)},${sql(`${ownerId}@example.invalid`)},1,'active','owner',${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES
    (${sql(sessionId)},${sql(userId)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(expires)},${sql(now.toISOString())}),
    (${sql(ownerSessionId)},${sql(ownerId)},${sql(hash(ownerSessionToken))},${sql(hash(ownerCsrfToken))},${sql(now.toISOString())},${sql(expires)},${sql(now.toISOString())})`);
  query(`INSERT INTO marketplace_creators(id,slug,display_name,short_bio,long_bio,profile_template,marketplace_status,registration_status,registration_completed_at,intake_registration_completed_at,created_at,updated_at)
    VALUES(${sql(creatorId)},${sql(creatorSlug)},'Task 2O-A Creator','Disposable staging Creator.','Disposable staging Creator identity for Task 2O-A.','catalog','approved','active',${sql(now.toISOString())},${sql(now.toISOString())},${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(${sql(userId)},${sql(creatorId)},'manager',${sql(now.toISOString())})`);
  query(`INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at)
    VALUES(${sql(creatorId)},${sql(userId)},'primary','active','not_required','primary_free',${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO user_account_profiles(user_id,legal_name,payment_method_status,payment_method_status_updated_at,created_at,updated_at)
    VALUES(${sql(userId)},'Task 2O-A Creator','ready',${sql(now.toISOString())},${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO creator_registration_details(creator_id,legal_name,business_name,business_type,country,state_region,address_line1,city,postal_code,contact_email,rights_confirmation_at,created_at,updated_at)
    VALUES(${sql(creatorId)},'Task 2O-A Creator','','individual','US','NC','1 Disposable Road','Durham','27701',${sql(`${userId}@example.invalid`)},${sql(now.toISOString())},${sql(now.toISOString())},${sql(now.toISOString())})`);
  query(`INSERT INTO creator_agreement_acceptances(creator_id,accepted_by_user_id,agreement_id,agreement_version,accepted_at,source_context)
    VALUES(${sql(creatorId)},${sql(userId)},'trg-creator-marketplace-agreement','2026-08-27',${sql(now.toISOString())},'task2oa_staging')`);
  query(`INSERT INTO creator_payout_profiles(creator_id,provider,onboarding_status,payouts_enabled,verification_status,status_updated_at)
    VALUES(${sql(creatorId)},'manual','complete',1,'verified',${sql(now.toISOString())})`);

  const mediaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2oa-media-"));
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2oa-browser-"));
  const pdfPath = path.join(mediaDirectory, "task2oa-product.pdf");
  const webpPath = path.join(mediaDirectory, "task2oa-cover.webp");
  fs.writeFileSync(pdfPath, PDF);
  fs.writeFileSync(webpPath, WEBP);
  const debuggingPort = await getOpenPort();
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-gpu",
    "--headless=new", "--no-first-run", `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`, `${ORIGIN}/creator/`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", chunk => { browserErrors += chunk.toString(); });
  let cdp;
  let mainError = null;
  const objectKeys = [];
  try {
    let targets;
    try { targets = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/list`); }
    catch (error) { throw new Error(`Chromium did not start. ${browserErrors.trim() || error.message}`); }
    const page = targets.find(target => target.type === "page");
    assert.ok(page?.webSocketDebuggerUrl);
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("DOM.enable");
    await setIdentityCookies(cdp, sessionToken, csrfToken);
    await navigate(cdp, `${ORIGIN}/creator/`);
    await waitFor(cdp, "document.getElementById('creator-listings')?.hidden === false && document.getElementById('creator-draft-form')?.hidden === false", "Creator dashboard did not unlock product intake.");

    await fillDraft(cdp, {
      title, shortDescription: "Disposable native Creator submission.",
      longDescription: "This product exists only for the Task 2O-A staging verification.",
      pricingModel: "fixed", priceCents: "725", mediaType: "digital", format: "PDF",
      gameSystem: "System Neutral", genre: "test"
    });
    await waitFor(cdp, "document.getElementById('creator-draft-status').textContent === 'Draft created.'", "Creator UI did not create the draft.");
    const listing = query(`SELECT * FROM creator_listings WHERE creator_id=${sql(creatorId)} AND slug=${sql(slug)}`).results[0];
    assert.ok(listing);
    assert.equal(listing.listed_price_cents, 725);
    assert.equal(listing.pricing_model, "fixed");
    console.log(`Creator UI: created fixed-price draft ${listing.id}.`);

    await uploadFromUi(cdp, listing.id, "product", webpPath);
    await waitFor(cdp, "document.getElementById('creator-file-status').textContent.trim().length > 0", "Invalid Creator file produced no UI response.");
    const invalidFileMessage = await evaluate(cdp, "document.getElementById('creator-file-status').textContent");
    assert.match(invalidFileMessage, /contents and declared type/i);
    assert.equal(query(`SELECT COUNT(*) n FROM creator_listing_files WHERE listing_id=${sql(listing.id)}`).results[0].n, 0);

    await uploadFromUi(cdp, listing.id, "product", pdfPath);
    await waitFor(cdp, "document.getElementById('creator-file-status').textContent.includes('uploaded privately')", "Creator PDF upload did not complete.");
    await uploadFromUi(cdp, listing.id, "cover", webpPath);
    await waitFor(cdp, "document.getElementById('creator-file-status').textContent.includes('uploaded privately')", "Creator WebP upload did not complete.");
    const files = query(`SELECT purpose,content_type,quarantine_key,validation_state FROM creator_listing_files WHERE listing_id=${sql(listing.id)} ORDER BY purpose`).results;
    assert.equal(files.length, 2);
    for (const file of files) {
      assert.equal(file.validation_state, "uploaded");
      objectKeys.push(file.quarantine_key);
      assert.deepEqual(r2Get(file.quarantine_key), file.purpose === "cover" ? WEBP : PDF);
    }
    console.log("Creator UI: invalid file rejected; PDF and WebP stored in private staging R2 and recorded in D1.");

    await evaluate(cdp, "window.confirm = () => true");
    const clickResult = await evaluate(cdp, `(() => {
      const card = [...document.querySelectorAll('#creator-listing-list article')].find(node => node.querySelector('h3')?.textContent === ${JSON.stringify(title)});
      const button = [...(card?.querySelectorAll('button') || [])].find(node => node.textContent === 'Submit for Review');
      if (!button) return 'missing'; button.click(); return 'clicked';
    })()`);
    assert.equal(clickResult, "clicked");
    await waitFor(cdp, `document.getElementById('creator-listing-list').innerText.includes(${JSON.stringify(`${title}\nsubmitted`)}) || document.getElementById('creator-listing-list').innerText.includes('submitted · publication not_approved')`, "Creator UI did not enter review state.");
    const submitted = query(`SELECT lifecycle_state,publication_state,public_product_slug FROM creator_listings WHERE id=${sql(listing.id)}`).results[0];
    assert.deepEqual(submitted, { lifecycle_state: "submitted", publication_state: "not_approved", public_product_slug: null });
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE slug=${sql(slug)}`).results[0].n, 0);
    assert.equal((await fetch(`${ORIGIN}/api/catalog?slug=${encodeURIComponent(slug)}`)).status, 404);
    console.log("Review hold: submission is submitted/not_approved and absent from the public D1 catalog.");

    let response = await fetch(`${ORIGIN}/api/creator/listings/${listing.id}/submit`, {
      method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true })
    });
    assert.equal(response.status, 400);
    const duplicateForm = new FormData();
    duplicateForm.set("metadata", "{}");
    response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", headers: authHeaders(), body: duplicateForm });
    assert.equal(response.status, 403);
    console.log("Security/idempotency: repeat submission rejected; Creator session denied Owner publication endpoint (403).");

    await fillDraft(cdp, {
      title: freeTitle, shortDescription: "Disposable free product.", longDescription: "Task 2O-A free pricing fixture.",
      pricingModel: "free", mediaType: "digital", format: "PDF", gameSystem: "System Neutral", genre: "test"
    });
    await waitFor(cdp, "document.getElementById('creator-draft-status').textContent === 'Draft created.'", "Free draft was not created.");
    const free = query(`SELECT pricing_model,listed_price_cents FROM creator_listings WHERE creator_id=${sql(creatorId)} AND title=${sql(freeTitle)}`).results[0];
    assert.equal(free.pricing_model, "free"); assert.equal(free.listed_price_cents, 0);

    await fillDraft(cdp, {
      title: pwywTitle, shortDescription: "Disposable PWYW product.", longDescription: "Task 2O-A PWYW pricing fixture.",
      pricingModel: "pwyw", minimumPriceCents: "600", suggestedPriceCents: "500", mediaType: "digital", format: "PDF",
      gameSystem: "System Neutral", genre: "test"
    });
    await waitFor(cdp, "document.getElementById('creator-draft-status').textContent.includes('suggested price must be')", "Invalid PWYW pricing was not rejected.");
    await fillDraft(cdp, {
      title: pwywTitle, shortDescription: "Disposable PWYW product.", longDescription: "Task 2O-A PWYW pricing fixture.",
      pricingModel: "pwyw", minimumPriceCents: "0", suggestedPriceCents: "500", mediaType: "digital", format: "PDF",
      gameSystem: "System Neutral", genre: "test"
    });
    await waitFor(cdp, "document.getElementById('creator-draft-status').textContent === 'Draft created.'", "Valid PWYW draft was not created.");
    const pwyw = query(`SELECT pricing_model,listed_price_cents,minimum_price_cents,suggested_price_cents FROM creator_listings WHERE creator_id=${sql(creatorId)} AND title=${sql(pwywTitle)}`).results[0];
    assert.deepEqual(pwyw, { pricing_model: "pwyw", listed_price_cents: 500, minimum_price_cents: 0, suggested_price_cents: 500 });
    const policy = await import(pathToFileURL(path.join(ROOT, "functions/_lib/marketplace-policy.mjs")).href);
    const capacity = await policy.getCreatorCapacity(db, creatorId, Date.now());
    assert.equal(capacity.activeListingCap, 20); assert.equal(capacity.pwywCap, 1);
    console.log("Pricing/policy: fixed, free, and PWYW validations passed; Standard caps remained 20 active / 1 PWYW.");

    await setIdentityCookies(cdp, ownerSessionToken, ownerCsrfToken);
    await navigate(cdp, `${ORIGIN}/owner/creator-reviews.html`);
    await waitFor(cdp, `document.getElementById('review-queue').innerText.includes(${JSON.stringify(title)})`, "Owner review UI did not show the Creator submission.");
    const ownerReviewText = await evaluate(cdp, `([...document.querySelectorAll('#review-queue article')].find(node => node.querySelector('h2')?.textContent === ${JSON.stringify(title)}) || {}).innerText || ''`);
    assert.match(ownerReviewText, /review submitted/);
    assert.match(ownerReviewText, /publication not_approved/);
    assert.match(ownerReviewText, /product:.*uploaded/i);
    assert.match(ownerReviewText, /cover:.*uploaded/i);
    assert.match(ownerReviewText, /Compliance Check Passed/);
    console.log("Owner review UI: authenticated Owner identity saw metadata, both private files, and the existing approval controls.");
  } catch (error) {
    mainError = error;
  }

  try {
    for (const key of objectKeys) { r2Delete(key); assertR2Missing(key); }
    query(`DELETE FROM creator_listing_declarations WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_review_audit WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_publication_audit WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_listing_files WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_listings WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_account_notices WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_account_audit_states WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_agreement_acceptances WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_payout_profiles WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_registration_details WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_identity_ownership WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM creator_memberships WHERE creator_id=${sql(creatorId)}`);
    query(`DELETE FROM marketplace_creators WHERE id=${sql(creatorId)}`);
    query(`DELETE FROM sessions WHERE id IN (${sql(sessionId)},${sql(ownerSessionId)})`);
    query(`DELETE FROM user_account_profiles WHERE user_id=${sql(userId)}`);
    query(`DELETE FROM users WHERE id IN (${sql(userId)},${sql(ownerId)})`);
    assert.equal(query(`SELECT COUNT(*) n FROM creator_listings WHERE creator_id=${sql(creatorId)}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM creator_listing_files WHERE creator_id=${sql(creatorId)}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM users WHERE id IN (${sql(userId)},${sql(ownerId)})`).results[0].n, 0);
    assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
    console.log("Cleanup: disposable listings, identities, sessions, audit rows, and exact R2 objects removed; staging remained CLOSED.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    cdp?.close();
    if (process.platform === "win32" && browser.pid)
      childProcess.spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    else browser.kill("SIGKILL");
    removeDirectoryWithRetries(profileDirectory);
    removeDirectoryWithRetries(mediaDirectory);
  }
  if (mainError) throw mainError;
  console.log("Task 2O-A authenticated Creator submission browser verification passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
