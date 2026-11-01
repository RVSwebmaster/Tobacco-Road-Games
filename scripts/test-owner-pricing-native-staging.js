// Staging-only Task 2N-A proof through the actual Owner Pricing browser interface.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = process.env.TRG_WRANGLER_PATH;
const ORIGIN = process.env.TRG_STAGING_PAGES_URL;
const CONFIG = "ops/staging/wrangler.toml";
const DB_NAME = "trg-orders-staging";
const DB_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const WEBHOOK_SECRET = "whsec_task2na_isolated_preview_v1";
const suffix = randomUUID().replace(/-/g, "");
const id = `task2na-${suffix}`;
const slug = `task2na-pricing-${suffix}`;
const title = "Disposable Task 2N-A Pricing Product";
const attempt = `trgca_${randomUUID()}`;
const sessionId = `task2na-owner-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const stripeSessionId = `cs_test_task2na_${suffix}`;
const eventId = `evt_task2na_${suffix}_paid`;
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function cli(...args) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024
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
  if (result.length !== 1 || result[0].success !== true) throw new Error(`Staging D1 query failed: ${JSON.stringify(result)}`);
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
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function assertR2Missing(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 1, `${result.stdout || ""}\n${result.stderr || ""}`);
}
function publicationForm() {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id, slug, creatorId: "creator-rv-sawyer", title,
    subtitle: "Staging native pricing proof", shortDescription: "A disposable native pricing verification product.",
    longDescription: "This product verifies immediate D1 storefront and cart pricing updates without GitHub or redeployment.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", buyMode: "cart", pricingModel: "fixed", priceCents: 500,
    metadata: { task2naDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], "task2na-cover.webp", { type: "image/webp" }));
  data.set("pdf", new File([PDF], "task2na-delivery.pdf", { type: "application/pdf" }));
  return data;
}
function authHeaders() {
  return {
    origin: ORIGIN,
    cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`,
    "x-csrf-token": csrfToken
  };
}
async function postPricing(body) {
  return fetch(`${ORIGIN}/owner/api/pricing`, {
    method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify(body)
  });
}
function pricingInput(product, overrides = {}) {
  return {
    availability: product.publicationState === "published" ? "available" : "paused",
    currency: product.currency, expectedRevision: product.revision,
    minimumPriceCents: product.minimumPriceCents, priceCents: product.priceCents,
    pricingModel: product.pricingModel, saleEnabled: product.saleEnabled,
    saleEnd: product.saleEnd || "", saleLabel: String(product.metadata?.saleLabel || ""),
    salePriceCents: product.salePriceCents, saleStart: product.saleStart || "",
    slug: product.slug, suggestedPriceCents: product.suggestedPriceCents, ...overrides
  };
}

function findBrowserExecutable() {
  const candidates = [process.env.TRG_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(executable, "A Chromium browser is required for Task 2N-A staging verification.");
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
  for (let attemptNumber = 0; attemptNumber < attempts; attemptNumber += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); lastError = new Error(`HTTP ${response.status}`); }
    catch (error) { lastError = error; }
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
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("Unable to connect to Chromium DevTools.")); });
  return {
    close: () => socket.close(),
    async send(method, params = {}) {
      await ready;
      const idValue = ++nextId;
      const result = new Promise((resolve, reject) => pending.set(idValue, { resolve, reject }));
      socket.send(JSON.stringify({ id: idValue, method, params }));
      return result;
    }
  };
}
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}
async function waitFor(cdp, expression, message, attempts = 200) {
  for (let attemptNumber = 0; attemptNumber < attempts; attemptNumber += 1) {
    try { if (await evaluate(cdp, expression)) return; } catch {}
    await delay(100);
  }
  throw new Error(message);
}
async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, "document.readyState === 'complete'", `Page did not load: ${url}`);
}
async function setField(cdp, idValue, value, eventType = "input") {
  await evaluate(cdp, `(() => { const field=document.getElementById(${JSON.stringify(idValue)}); field.value=${JSON.stringify(value)}; field.dispatchEvent(new Event(${JSON.stringify(eventType)},{bubbles:true})); })()`);
}
async function reviewAndPublish(cdp, expectedRevision) {
  await evaluate(cdp, `document.getElementById("pricing-review-button").click()`);
  await waitFor(cdp, `document.getElementById("pricing-publish-button").disabled === false`, "Pricing review did not enable update.");
  await evaluate(cdp, `document.getElementById("pricing-publish-button").click()`);
  await waitFor(cdp, `document.getElementById("pricing-status").textContent.includes("Revision ${expectedRevision} is now authoritative")`, `Pricing revision ${expectedRevision} was not confirmed.`, 300);
}
function removeDirectoryWithRetries(directory) {
  for (let attemptNumber = 0; attemptNumber < 20; attemptNumber += 1) {
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
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
  assert.equal(originalStoreState, "CLOSED");
  const owner = query("SELECT id,email_normalized,email_verified FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner.email_verified, 1);
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const nativeOrders = await import(pathToFileURL(path.join(ROOT, "functions/_lib/native-orders-d1.mjs")).href);
  const now = new Date();
  query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
    ${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(new Date(now.getTime() + 30 * 60_000).toISOString())},${sql(now.toISOString())})`);
  let product = null;
  let order = null;
  let coverKey = "";
  let deliveryKey = "";
  let snapshotBefore = null;
  let entitlementBefore = null;
  let mainError = null;
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2na-browser-"));
  const debuggingPort = await getOpenPort();
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-gpu",
    "--headless=new", "--no-first-run", `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`, `${ORIGIN}/owner/pricing.html`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", chunk => { browserErrors += chunk.toString(); });
  let cdp;
  try {
    let response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, { method: "POST", body: publicationForm(), headers: authHeaders() });
    assert.equal(response.status, 201, await response.text());
    product = await catalog.getProductById(db, id);
    coverKey = product.coverR2Key;
    deliveryKey = product.deliveryR2Key;
    console.log(`Publication: ${id} reached native staging D1/R2 at revision 1.`);

    query("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
    response = await fetch(`${ORIGIN}/api/cart/prepare-order`, {
      method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({
        checkoutAttemptId: attempt, email: owner.email_normalized, emailConfirmation: owner.email_normalized,
        items: [{ slug, quantity: 1, priceCents: 1 }]
      })
    });
    const prepared = await response.json();
    assert.equal(response.status, 201, JSON.stringify(prepared));
    assert.equal(prepared.totalCents, 500);
    order = query(`SELECT * FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0];
    order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(order.id), {
      id: stripeSessionId, url: `https://checkout.stripe.test/${stripeSessionId}`
    });
    response = await sendEvent(stripeEvent(order));
    assert.equal(response.status, 200, await response.text());
    query("UPDATE runtime_settings SET setting_value='CLOSED' WHERE setting_key='store_state'");
    snapshotBefore = query(`SELECT catalog_revision,pricing_model_snapshot,selected_price_cents,delivery_r2_key_snapshot FROM order_items WHERE order_id=${Number(order.id)}`).results[0];
    entitlementBefore = query(`SELECT catalog_revision_snapshot,pricing_model_snapshot,selected_price_cents_snapshot,status FROM native_product_entitlements WHERE order_id=${Number(order.id)}`).results[0];
    assert.equal(snapshotBefore.catalog_revision, 1);
    assert.equal(entitlementBefore.selected_price_cents_snapshot, 500);
    console.log("Snapshot fixture: paid order and entitlement captured immutable revision-1 pricing before edits; staging returned to CLOSED.");

    let targets;
    try { targets = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/list`); }
    catch (error) { throw new Error(`Chromium did not start. ${browserErrors.trim() || error.message}`); }
    const page = targets.find(target => target.type === "page");
    assert.ok(page?.webSocketDebuggerUrl);
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable");
    for (const cookie of [
      { name: "__Host-trg_session", value: sessionToken, httpOnly: true },
      { name: "trg_account_csrf", value: csrfToken, httpOnly: false }
    ]) {
      const result = await cdp.send("Network.setCookie", { ...cookie, url: ORIGIN, path: "/", secure: true, sameSite: "Lax" });
      assert.equal(result.success, true);
    }
    await navigate(cdp, `${ORIGIN}/owner/pricing.html`);
    await waitFor(cdp, "document.documentElement.dataset.ownerPricingRuntime === 'ready'", "Owner Pricing did not initialize.");
    await waitFor(cdp, `document.querySelector('#pricing-product-select option[value="${slug}"]') !== null`, "Native product did not appear in Owner Pricing.");
    await evaluate(cdp, `(() => { const select=document.getElementById("pricing-product-select"); select.value=${JSON.stringify(slug)}; document.getElementById("pricing-load-button").click(); })()`);
    let ui = await evaluate(cdp, `({ source:document.getElementById("pricing-current-source").textContent, revision:document.getElementById("pricing-current-revision").textContent, price:document.getElementById("pricing-regular-price").value })`);
    assert.deepEqual(ui, { source: "Native D1", revision: "1", price: "5.00" });

    await setField(cdp, "pricing-regular-price", "7.25");
    await reviewAndPublish(cdp, 2);
    product = await catalog.getProductById(db, id);
    assert.equal(product.priceCents, 725);
    assert.equal(product.revision, 2);
    console.log("Owner Pricing UI: fixed price changed from $5.00 to $7.25 using revision checking.");

    await navigate(cdp, `${ORIGIN}/store/products/${slug}/`);
    await waitFor(cdp, `document.getElementById("product-title")?.textContent === ${JSON.stringify(title)}`, "Product detail did not load.");
    assert.match(await evaluate(cdp, "document.body.innerText"), /\$7\.25/);
    response = await fetch(`${ORIGIN}/api/cart/quote`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ slug, quantity: 1 }] })
    });
    let quote = await response.json();
    assert.equal(response.status, 200);
    assert.equal(quote.items[0].effectivePriceCents, 725);
    assert.equal(quote.items[0].catalogRevision, 2);
    console.log("Immediate visibility: storefront and new cart quote both returned $7.25/revision 2 without redeployment.");

    response = await postPricing(pricingInput(product, { priceCents: 775 }));
    assert.equal(response.status, 200, await response.text());
    await navigate(cdp, `${ORIGIN}/owner/pricing.html`);
    await waitFor(cdp, "document.documentElement.dataset.ownerPricingRuntime === 'ready'", "Owner Pricing did not reload.");
    await evaluate(cdp, `(() => { const select=document.getElementById("pricing-product-select"); select.value=${JSON.stringify(slug)}; document.getElementById("pricing-load-button").click(); })()`);
    // Force a stale revision after the UI has loaded revision 3.
    product = await catalog.getProductById(db, id);
    response = await postPricing(pricingInput(product, { priceCents: 800 }));
    assert.equal(response.status, 200, await response.text());
    await setField(cdp, "pricing-regular-price", "9.00");
    await evaluate(cdp, `document.getElementById("pricing-review-button").click()`);
    await waitFor(cdp, `document.getElementById("pricing-publish-button").disabled === false`, "Stale review did not enable update.");
    await evaluate(cdp, `document.getElementById("pricing-publish-button").click()`);
    await waitFor(cdp, `document.getElementById("pricing-status").textContent.includes("changed after it was loaded")`, "Revision conflict was not reported.", 300);
    ui = await evaluate(cdp, `({ revision:document.getElementById("pricing-current-revision").textContent, price:document.getElementById("pricing-regular-price").value })`);
    assert.deepEqual(ui, { revision: "4", price: "8.00" });
    assert.equal((await catalog.getProductById(db, id)).priceCents, 800);
    console.log("Conflict: stale browser revision was rejected and refreshed to authoritative revision 4 without overwrite.");

    await setField(cdp, "pricing-regular-price", "0.00");
    await evaluate(cdp, `document.getElementById("pricing-review-button").click()`);
    assert.match(await evaluate(cdp, `document.getElementById("pricing-status").textContent`), /greater than zero/);
    await setField(cdp, "pricing-model", "free", "change");
    await reviewAndPublish(cdp, 5);
    product = await catalog.getProductById(db, id);
    assert.equal(product.pricingModel, "free");
    assert.equal(product.priceCents, 0);
    await setField(cdp, "pricing-model", "pwyw", "change");
    await setField(cdp, "pricing-suggested-price", "5.00");
    await setField(cdp, "pricing-minimum-price", "6.00");
    await evaluate(cdp, `document.getElementById("pricing-review-button").click()`);
    assert.match(await evaluate(cdp, `document.getElementById("pricing-status").textContent`), /at or above its minimum/);
    await setField(cdp, "pricing-minimum-price", "0.00");
    await reviewAndPublish(cdp, 6);
    product = await catalog.getProductById(db, id);
    assert.equal(product.pricingModel, "pwyw");
    assert.equal(product.suggestedPriceCents, 500);
    assert.equal(product.minimumPriceCents, 0);
    console.log("Models: UI saved free pricing, rejected invalid PWYW bounds, then saved explicit $5.00 suggested/$0.00 minimum PWYW.");

    response = await postPricing(pricingInput(product, { suggestedPriceCents: 100, priceCents: 100, minimumPriceCents: 200 }));
    assert.equal(response.status, 400);
    assert.equal((await catalog.getProductById(db, id)).revision, 6);
    await setField(cdp, "pricing-availability", "paused", "change");
    await reviewAndPublish(cdp, 7);
    product = await catalog.getProductById(db, id);
    assert.equal(product.publicationState, "paused");
    assert.equal((await fetch(`${ORIGIN}/store/products/${slug}/`)).status, 404);
    response = await fetch(`${ORIGIN}/api/cart/quote`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ slug, quantity: 1, amountCents: 250 }] })
    });
    quote = await response.json();
    assert.equal(quote.unavailableItems[0].code, "paused_product");
    console.log("Availability: pausing through Owner Pricing immediately hid the detail route and rejected new cart quotes.");

    const snapshotAfter = query(`SELECT catalog_revision,pricing_model_snapshot,selected_price_cents,delivery_r2_key_snapshot FROM order_items WHERE order_id=${Number(order.id)}`).results[0];
    const entitlementAfter = query(`SELECT catalog_revision_snapshot,pricing_model_snapshot,selected_price_cents_snapshot,status FROM native_product_entitlements WHERE order_id=${Number(order.id)}`).results[0];
    assert.deepEqual(snapshotAfter, snapshotBefore);
    assert.deepEqual(entitlementAfter, entitlementBefore);
    console.log("Durability: paid order snapshot and entitlement remained byte-for-byte unchanged through repricing and pause.");
  } catch (error) {
    mainError = error;
  }

  try {
    if (order?.id) {
      query(`DELETE FROM native_download_attempts WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM native_product_entitlements WHERE order_id=${Number(order.id)}`);
      query(`DELETE FROM webhook_events WHERE provider_event_id=${sql(eventId)}`);
      query(`DELETE FROM orders WHERE id=${Number(order.id)}`);
    }
    product = await catalog.getProductById(db, id);
    if (product) {
      coverKey ||= product.coverR2Key;
      deliveryKey ||= product.deliveryR2Key;
      if (product.publicationState !== "draft") product = await catalog.updateProduct(db, id, { publicationState: "draft" }, { expectedRevision: product.revision });
      assert.equal(await catalog.deleteDraftProduct(db, id), true);
    }
    if (coverKey) r2Delete(coverKey);
    if (deliveryKey) r2Delete(deliveryKey);
    if (coverKey) assertR2Missing(coverKey);
    if (deliveryKey) assertR2Missing(deliveryKey);
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id=${sql(id)}`).results[0].n, 0);
    assert.equal(query(`SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=${sql(attempt)}`).results[0].n, 0);
    console.log("Cleanup: product, paid snapshot, entitlement, webhook event, and exact R2 objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    query(`UPDATE runtime_settings SET setting_value=${sql(originalStoreState)} WHERE setting_key='store_state'`);
    assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
    cdp?.close();
    if (process.platform === "win32" && browser.pid) childProcess.spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" }); else browser.kill("SIGKILL");
    removeDirectoryWithRetries(profileDirectory);
    console.log("Cleanup: disposable Owner session removed; staging remains CLOSED.");
  }
  if (mainError) throw mainError;
  console.log("Task 2N-A authenticated Owner Pricing browser verification passed.");
}

function stripeEvent(order) {
  return {
    api_version: "2026-06-24.dahlia", created: Math.floor(Date.now() / 1000),
    data: { object: {
      amount_total: Number(order.total_cents), currency: "usd", id: order.stripe_checkout_session_id,
      livemode: false, metadata: { trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id), trg_order_public_id: order.public_id, trg_order_source: "native_d1" },
      object: "checkout.session", payment_intent: `pi_test_task2na_${suffix}`, payment_status: "paid", ui_mode: "hosted_page"
    } },
    id: eventId, livemode: false, object: "event", type: "checkout.session.completed"
  };
}
async function sendEvent(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sign(body, timestamp);
  return fetch(`${ORIGIN}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body });
}
async function sign(body, timestamp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  return Buffer.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))).toString("hex");
}
function makePdf() {
  const objects = ["1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n", "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n", "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"];
  let body = "%PDF-1.4\n"; const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const start = Buffer.byteLength(body); body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
