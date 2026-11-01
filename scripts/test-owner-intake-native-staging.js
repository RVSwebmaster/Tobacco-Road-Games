// Staging-only Task 2M proof through the actual Owner Product Intake browser interface.
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
const suffix = randomUUID().replace(/-/g, "");
const slug = `task2m-owner-intake-${suffix}`;
const failedSlug = `task2m-failed-${suffix}`;
const title = "Disposable Task 2M Owner Intake Product";
const sessionId = `task2m-owner-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const PDF = makePdf();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function removeDirectoryWithRetries(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(directory, { force: true, recursive: true });
      return;
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  fs.rmSync(directory, { force: true, recursive: true });
}

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
function r2Get(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`R2 get failed: ${String(result.stderr || result.stdout)}`);
  return Buffer.from(result.stdout);
}
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function assertR2Missing(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 1, `${result.stdout || ""}\n${result.stderr || ""}`);
}

function findBrowserExecutable() {
  const candidates = [
    process.env.TRG_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(executable, "A Chromium browser is required for Task 2M staging verification.");
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
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}
async function waitFor(cdp, expression, message, attempts = 160) {
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
async function setFile(cdp, selector, filePath) {
  const document = await cdp.send("DOM.getDocument", { depth: 1 });
  const target = await cdp.send("DOM.querySelector", { nodeId: document.root.nodeId, selector });
  assert.ok(target.nodeId, `File input not found: ${selector}`);
  await cdp.send("DOM.setFileInputFiles", { files: [filePath], nodeId: target.nodeId });
}
function formExpression(fixture) {
  return `(() => {
    document.getElementById("start-new-listing-button").click();
    const set = (id, value) => {
      const field = document.getElementById(id);
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("product-title", ${JSON.stringify(fixture.title)});
    set("product-slug", ${JSON.stringify(fixture.slug)});
    set("product-folder", ${JSON.stringify(fixture.slug)});
    set("product-subtitle", "A staging-native Owner Intake proof");
    set("product-system", "System Neutral");
    set("product-line", "Tablecraft");
    set("product-media-type", "digital");
    set("product-page-count", "1");
    set("product-status", ${JSON.stringify(fixture.status)});
    set("product-buy-mode", ${JSON.stringify(fixture.buyMode)});
    set("product-price", ${JSON.stringify(fixture.price)});
    set("product-suggested-price", ${JSON.stringify(fixture.suggestedPrice || "")});
    set("product-minimum-price", ${JSON.stringify(fixture.minimumPrice || "")});
    set("product-short-description", "Published directly from the deployed Owner Product Intake interface.");
    set("product-long-description", "This disposable staging product verifies that the existing Owner interface publishes directly into Cloudflare D1 and private R2 without a build, repository catalog update, or GitHub operation.");
    set("product-features", "Native D1 catalog record\\nPrivate R2 delivery file\\nImmediate storefront visibility");
    set("product-version", "1.0");
    return document.documentElement.dataset.ownerIntakeRuntime;
  })()`;
}
async function prepareBrowserForm(cdp, fixture, coverPath, pdfPath) {
  await navigate(cdp, `${ORIGIN}/owner/product-intake.html`);
  await waitFor(cdp, "document.documentElement?.dataset?.ownerIntakeRuntime === 'ready'", "Owner Intake did not initialize.");
  assert.equal(await evaluate(cdp, formExpression(fixture)), "ready");
  await setFile(cdp, "#product-cover-file", coverPath);
  await setFile(cdp, "#product-pdf-file", pdfPath);
  await delay(200);
}
async function checkListing(cdp) {
  await evaluate(cdp, `document.getElementById("analyze-listing-button").click()`);
  await waitFor(cdp, "/Validation (passed|failed)/.test(document.getElementById('intake-feedback-heading').textContent)", "Listing check did not finish.");
  return evaluate(cdp, `({
    heading: document.getElementById("intake-feedback-heading").textContent,
    message: document.getElementById("intake-status").textContent,
    issues: [...document.querySelectorAll("#intake-validation-list li")].map(item => item.textContent)
  })`);
}
async function clickPublish(cdp) {
  await evaluate(cdp, `document.getElementById("publish-button").click()`);
  await waitFor(cdp, `!document.getElementById("intake-feedback-heading").textContent.match(/Publishing new product/)`, "Publication did not finish.", 300);
  return evaluate(cdp, `({
    heading: document.getElementById("intake-feedback-heading").textContent,
    message: document.getElementById("intake-status").textContent,
    summary: [...document.querySelectorAll("#intake-review-summary li")].map(item => item.textContent),
    publishDisabled: document.getElementById("publish-button").disabled,
    publishLabel: document.getElementById("publish-button").textContent
  })`);
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
  const now = new Date();
  query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
    ${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(new Date(now.getTime() + 30 * 60_000).toISOString())},${sql(now.toISOString())})`);

  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2m-"));
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2m-browser-"));
  const coverPath = path.join(fixtureDirectory, "cover.webp");
  const badCoverPath = path.join(fixtureDirectory, "invalid-cover.webp");
  const pdfPath = path.join(fixtureDirectory, "product.pdf");
  fs.writeFileSync(coverPath, WEBP);
  fs.writeFileSync(badCoverPath, Buffer.from("not a webp"));
  fs.writeFileSync(pdfPath, PDF);
  const debuggingPort = await getOpenPort();
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-gpu",
    "--headless=new", "--no-first-run", `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`, `${ORIGIN}/owner/product-intake.html`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", chunk => { browserErrors += chunk.toString(); });
  let cdp;
  let product = null;
  let coverKey = "";
  let deliveryKey = "";
  let mainError = null;
  try {
    let targets;
    try { targets = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/list`); }
    catch (error) { throw new Error(`Chromium did not start. ${browserErrors.trim() || error.message}`); }
    const page = targets.find(target => target.type === "page");
    assert.ok(page?.webSocketDebuggerUrl);
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");
    for (const cookie of [
      { name: "__Host-trg_session", value: sessionToken, httpOnly: true },
      { name: "trg_account_csrf", value: csrfToken, httpOnly: false }
    ]) {
      const result = await cdp.send("Network.setCookie", { ...cookie, url: ORIGIN, path: "/", secure: true, sameSite: "Lax" });
      assert.equal(result.success, true);
    }

    await prepareBrowserForm(cdp, { title, slug, status: "available-direct", buyMode: "cart", price: "6.25" }, coverPath, pdfPath);
    let result = await checkListing(cdp);
    assert.match(result.heading, /Validation passed/);
    await evaluate(cdp, `document.getElementById("review-listing-button").click()`);
    assert.match(await evaluate(cdp, `document.getElementById("intake-feedback-heading").textContent`), /review ready/i);
    result = await clickPublish(cdp);
    assert.equal(result.heading, "Product published successfully");
    assert.match(result.message, new RegExp(`published as ${slug} \\(${slug}\\)`));
    assert.ok(result.summary.includes(`Storefront URL: /store/products/${slug}/`));
    assert.equal(result.publishDisabled, true);
    assert.equal(result.publishLabel, "Product Published");
    console.log("Owner Intake UI: fixed-price product published with verified success identity and storefront URL.");

    const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
    product = await catalog.getProductById(db, slug);
    assert.equal(product.slug, slug);
    assert.equal(product.title, title);
    assert.equal(product.creatorId, "creator-rv-sawyer");
    assert.equal(product.status, "available-direct");
    assert.equal(product.pricingModel, "fixed");
    assert.equal(product.priceCents, 625);
    assert.equal(product.publicationState, "published");
    coverKey = product.coverR2Key;
    deliveryKey = product.deliveryR2Key;
    assert.deepEqual(r2Get(coverKey), WEBP);
    assert.deepEqual(r2Get(deliveryKey), PDF);
    console.log(`D1/R2: ${product.id} recorded explicit verified cover and delivery keys.`);

    await navigate(cdp, `${ORIGIN}/store/products/${slug}/`);
    await waitFor(cdp, `document.getElementById("product-title")?.textContent === ${JSON.stringify(title)}`, "Public product detail did not appear.");
    const storefront = await evaluate(cdp, `({
      title: document.getElementById("product-title").textContent,
      body: document.body.innerText,
      cover: document.querySelector(".product-cover")?.getAttribute("src") || ""
    })`);
    assert.equal(storefront.title, title);
    assert.match(storefront.body, /Published directly from the deployed Owner Product Intake interface/);
    assert.match(storefront.body, /RV Sawyer/);
    assert.match(storefront.body, /\$6\.25/);
    assert.equal(storefront.cover, `/product-assets/${slug}/cover.webp`);
    const publicCover = await fetch(`${ORIGIN}${storefront.cover}`);
    assert.equal(publicCover.status, 200);
    assert.deepEqual(Buffer.from(await publicCover.arrayBuffer()), WEBP);
    assert.doesNotMatch(storefront.body, /catalog-publications|delivery\.pdf/);
    assert.equal((await fetch(`${ORIGIN}/product-assets/${slug}/delivery.pdf`)).status, 404);
    console.log("Storefront: title, description, Creator, $6.25 price, and public cover appeared without redeployment; private delivery remained inaccessible.");

    await prepareBrowserForm(cdp, { title, slug, status: "available-direct", buyMode: "cart", price: "6.25" }, coverPath, pdfPath);
    result = await checkListing(cdp);
    assert.match(result.heading, /Validation passed/);
    result = await clickPublish(cdp);
    assert.equal(result.heading, "Product already exists");
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id=${sql(slug)}`).results[0].n, 1);
    assert.deepEqual(r2Get(coverKey), WEBP);
    assert.deepEqual(r2Get(deliveryKey), PDF);
    console.log("Duplicate handling: second UI submission failed accurately and did not replace the published record or objects.");

    await prepareBrowserForm(cdp, { title: "Disposable Invalid Task 2M", slug: failedSlug, status: "available-direct", buyMode: "cart", price: "4.00" }, badCoverPath, pdfPath);
    result = await checkListing(cdp);
    assert.match(result.heading, /Validation passed/);
    result = await clickPublish(cdp);
    assert.equal(result.heading, "File validation failed");
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id=${sql(failedSlug)}`).results[0].n, 0);
    console.log("Failure handling: invalid WebP bytes failed server validation through the UI with no D1 product.");

    for (const fixture of [
      { title: "Disposable Free Validation", slug: `${slug}-free`, status: "free-download", buyMode: "free-download", price: "0.00" },
      { title: "Disposable PWYW Validation", slug: `${slug}-pwyw`, status: "pay-what-you-want", buyMode: "cart", price: "", suggestedPrice: "5.00", minimumPrice: "0.00" }
    ]) {
      await prepareBrowserForm(cdp, fixture, coverPath, pdfPath);
      result = await checkListing(cdp);
      assert.match(result.heading, /Validation passed/, JSON.stringify(result));
    }
    console.log("UI validation: fixed, free, and zero-minimum PWYW configurations passed with explicit prices.");
  } catch (error) {
    mainError = error;
  }

  try {
    const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
    product = await catalog.getProductById(db, slug);
    if (product) {
      coverKey ||= product.coverR2Key;
      deliveryKey ||= product.deliveryR2Key;
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, slug, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      assert.equal(await catalog.deleteDraftProduct(db, slug), true);
    }
    if (coverKey) r2Delete(coverKey);
    if (deliveryKey) r2Delete(deliveryKey);
    if (coverKey) assertR2Missing(coverKey);
    if (deliveryKey) assertR2Missing(deliveryKey);
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id IN (${sql(slug)},${sql(failedSlug)})`).results[0].n, 0);
    console.log("Cleanup: disposable D1 product and exact R2 cover/PDF objects removed.");
  } catch (cleanupError) {
    if (mainError) console.error("Original staging failure:", mainError);
    throw cleanupError;
  } finally {
    cdp?.close();
    if (process.platform === "win32" && browser.pid) childProcess.spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    else browser.kill("SIGKILL");
    query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
    assert.equal(query(`SELECT COUNT(*) n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
    assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
    removeDirectoryWithRetries(profileDirectory);
    removeDirectoryWithRetries(fixtureDirectory);
    console.log("Cleanup: disposable Owner session removed; staging remained CLOSED.");
  }
  if (mainError) throw mainError;
  console.log("Task 2M authenticated Owner Intake browser verification passed.");
}

function makePdf() {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer<</Size 4/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
