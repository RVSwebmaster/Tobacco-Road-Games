// Staging-only Task 2N-B proof through the actual Owner Homepage Editor.
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
const fixtures = [
  { id: `task2nb-a-${suffix}`, slug: `task2nb-homepage-a-${suffix}`, title: "Disposable Task 2N-B Alpha", priceCents: 650 },
  { id: `task2nb-b-${suffix}`, slug: `task2nb-homepage-b-${suffix}`, title: "Disposable Task 2N-B Bravo", priceCents: 875 }
];
const sessionId = `task2nb-owner-session-${suffix}`;
const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const csrfToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
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
function authHeaders() {
  return {
    origin: ORIGIN,
    cookie: `__Host-trg_session=${sessionToken}; trg_account_csrf=${csrfToken}`,
    "x-csrf-token": csrfToken
  };
}
function publicationForm(fixture) {
  const data = new FormData();
  data.set("metadata", JSON.stringify({
    id: fixture.id, slug: fixture.slug, creatorId: "creator-rv-sawyer", title: fixture.title,
    subtitle: "Staging native homepage proof",
    shortDescription: "A disposable native homepage merchandising verification product.",
    longDescription: "This disposable product verifies live D1 homepage selection, ordering, and removal without GitHub or redeployment.",
    publisher: "Tobacco Road Games", gameSystem: "System Neutral", productLine: "Reconstruction Proofs",
    mediaType: "digital", status: "available-direct", buyMode: "cart", pricingModel: "fixed",
    priceCents: fixture.priceCents,
    metadata: { task2nbDisposable: true, authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }));
  data.set("cover", new File([WEBP], `${fixture.slug}-cover.webp`, { type: "image/webp" }));
  data.set("pdf", new File([PDF], `${fixture.slug}-delivery.pdf`, { type: "application/pdf" }));
  return data;
}
async function ownerPost(body, headers = authHeaders()) {
  return fetch(`${ORIGIN}/owner/api/homepage`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body)
  });
}
function r2Delete(key) { cli("r2", "object", "delete", `${BUCKET}/${key}`, "--remote", "--config", CONFIG); }
function assertR2Missing(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 1, `${result.stdout || ""}\n${result.stderr || ""}`);
}

function findBrowserExecutable() {
  const candidates = [process.env.TRG_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(executable, "A Chromium browser is required for Task 2N-B staging verification.");
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
async function waitFor(cdp, expression, message, attempts = 240) {
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
async function openEditor(cdp) {
  await navigate(cdp, `${ORIGIN}/owner/homepage.html`);
  await waitFor(cdp, "document.documentElement.dataset.ownerHomepageRuntime === 'ready'", "Owner Homepage Editor did not initialize.");
}
async function clickProduct(cdp, productId, checked) {
  const result = await evaluate(cdp, `(() => {
    const row = document.querySelector('[data-shelf="newThisWeek"] [data-product-id=${JSON.stringify(productId)}]');
    const input = row?.querySelector('input[type="checkbox"]');
    if (!input) return "missing";
    if (input.checked !== ${checked ? "true" : "false"}) input.click();
    return "ok";
  })()`);
  assert.equal(result, "ok", `Homepage choice ${productId} was unavailable in the editor.`);
}
async function clearNewShelf(cdp) {
  for (let guard = 0; guard < 50; guard += 1) {
    const selected = await evaluate(cdp, `document.querySelector('[data-shelf="newThisWeek"] [data-product-id] input:checked')?.closest('[data-product-id]')?.dataset.productId || ""`);
    if (!selected) return;
    await clickProduct(cdp, selected, false);
  }
  throw new Error("Could not clear the New This Week shelf.");
}
async function saveEditor(cdp) {
  const priorRevision = Number(await evaluate(cdp, "document.getElementById('homepage-revision').textContent"));
  await waitFor(cdp, "document.getElementById('homepage-publish').disabled === false", "Homepage save did not become available.");
  await evaluate(cdp, "document.getElementById('homepage-publish').click()");
  await waitFor(cdp, `document.getElementById('homepage-status').textContent.includes('revision ${priorRevision + 1} is now authoritative')`, "Homepage save was not confirmed.");
  return priorRevision + 1;
}
async function homepageOrder(cdp) {
  await navigate(cdp, `${ORIGIN}/`);
  await waitFor(cdp, "document.documentElement.dataset.homepageShelvesRuntime === 'ready'", "Public homepage shelves did not initialize.");
  return evaluate(cdp, `(() => {
    const bay=document.querySelector('[aria-labelledby="new-this-week-wall-heading"]');
    const ordered = [
      ...bay.querySelectorAll('.shop-wall-hero-bay [data-product-card]'),
      ...bay.querySelectorAll('[data-spine-run="left"] [data-product-card]'),
      ...bay.querySelectorAll('[data-spine-run="right"] [data-product-card]')
    ];
    return {
      hidden: bay.hidden,
      ids: ordered.map(node => node.dataset.productId),
      slugs: ordered.map(node => node.dataset.slug),
      previews: ordered.map(node => JSON.parse(node.dataset.guestProductPreview || "{}")),
      text: bay.innerText,
      html: bay.innerHTML
    };
  })()`);
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
  const originalStoreState = query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value;
  assert.equal(originalStoreState, "CLOSED");
  const originalConfig = query("SELECT * FROM homepage_configurations WHERE id='storefront'").results[0];
  assert.ok(originalConfig);
  const owner = query("SELECT id,email_verified FROM users WHERE role='owner' AND status='active' LIMIT 1").results[0];
  assert.equal(owner.email_verified, 1);
  const now = new Date();
  query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
    ${sql(sessionId)},${sql(owner.id)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},${sql(new Date(now.getTime() + 30 * 60_000).toISOString())},${sql(now.toISOString())})`);

  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const created = [];
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-task2nb-browser-"));
  const debuggingPort = await getOpenPort();
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-gpu",
    "--headless=new", "--no-first-run", `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`, `${ORIGIN}/owner/homepage.html`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", chunk => { browserErrors += chunk.toString(); });
  let cdp;
  let mainError = null;
  try {
    for (const fixture of fixtures) {
      const response = await fetch(`${ORIGIN}/owner/api/catalog-publication`, {
        method: "POST", body: publicationForm(fixture), headers: authHeaders()
      });
      assert.equal(response.status, 201, await response.text());
      const product = await catalog.getProductById(db, fixture.id);
      assert.equal(product.publicationState, "published");
      created.push(product);
    }
    console.log("Publication: two disposable native products reached staging D1 and private R2.");

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

    await openEditor(cdp);
    assert.equal(Number(await evaluate(cdp, "document.getElementById('homepage-revision').textContent")), Number(originalConfig.revision));
    await clearNewShelf(cdp);
    await clickProduct(cdp, fixtures[0].id, true);
    await clickProduct(cdp, fixtures[1].id, true);
    let revision = await saveEditor(cdp);
    let saved = JSON.parse(query("SELECT configuration_json FROM homepage_configurations WHERE id='storefront'").results[0].configuration_json);
    assert.deepEqual(saved.shelves.newThisWeek.productIds, fixtures.map(fixture => fixture.id));
    assert.equal(saved.shelves.newThisWeek.managed, true);
    console.log(`Owner Homepage UI: loaded revision ${originalConfig.revision}, selected two products, and committed revision ${revision}.`);

    let publicShelf = await homepageOrder(cdp);
    assert.deepEqual(publicShelf.ids.slice(0, 2), fixtures.map(fixture => fixture.id));
    assert.equal(publicShelf.previews[0].title, fixtures[0].title);
    assert.equal(publicShelf.previews[0].creator, "RV Sawyer");
    assert.equal(publicShelf.previews[0].priceLabel, "$6.50");
    assert.equal(publicShelf.previews[0].fullUrl, `/store/products/${fixtures[0].slug}/`);
    assert.equal(publicShelf.previews[0].cover, `/product-assets/${fixtures[0].slug}/cover.webp`);
    assert.doesNotMatch(publicShelf.html, /catalog-publications|delivery\.pdf/);
    const publicCover = await fetch(`${ORIGIN}/product-assets/${fixtures[0].slug}/cover.webp`);
    assert.equal(publicCover.status, 200);
    assert.deepEqual(Buffer.from(await publicCover.arrayBuffer()), WEBP);
    assert.equal((await fetch(`${ORIGIN}/product-assets/${fixtures[0].slug}/delivery.pdf`)).status, 404);
    console.log("Public homepage: D1 order, current title/price metadata, public cover, and private-delivery isolation appeared without redeployment.");

    await openEditor(cdp);
    await evaluate(cdp, `document.querySelector('[data-shelf="newThisWeek"] [data-product-id=${JSON.stringify(fixtures[1].id)}] button[aria-label="Move earlier"]').click()`);
    revision = await saveEditor(cdp);
    publicShelf = await homepageOrder(cdp);
    assert.deepEqual(publicShelf.ids.slice(0, 2), [fixtures[1].id, fixtures[0].id]);
    console.log(`Ordering: the actual editor moved Bravo before Alpha and public revision ${revision} reflected it immediately.`);

    await openEditor(cdp);
    const staleRevision = Number(await evaluate(cdp, "document.getElementById('homepage-revision').textContent"));
    const currentState = await (await fetch(`${ORIGIN}/owner/api/homepage`, { headers: authHeaders() })).json();
    currentState.configuration.shelves.newThisWeek.productIds = [fixtures[0].id, fixtures[1].id];
    let response = await ownerPost({ expectedRevision: currentState.revision, shelves: currentState.configuration.shelves });
    assert.equal(response.status, 200, await response.text());
    await evaluate(cdp, `document.querySelector('[data-shelf="newThisWeek"] [data-shelf-visibility="newThisWeek"]').click()`);
    await evaluate(cdp, "document.getElementById('homepage-publish').click()");
    await waitFor(cdp, "document.getElementById('homepage-status').textContent.includes('changed after this editor loaded')", "Stale editor conflict was not reported.");
    assert.equal(Number(query("SELECT revision FROM homepage_configurations WHERE id='storefront'").results[0].revision), staleRevision + 1);
    console.log("Conflict: a stale browser revision was rejected and refreshed without overwriting the concurrent D1 update.");

    let product = await catalog.getProductById(db, fixtures[0].id);
    await catalog.updateProduct(db, product.id, { publicationState: "paused" }, { expectedRevision: product.revision });
    publicShelf = await homepageOrder(cdp);
    assert.ok(!publicShelf.ids.includes(fixtures[0].id));
    assert.equal(publicShelf.ids[0], fixtures[1].id);
    await openEditor(cdp);
    assert.match(await evaluate(cdp, `document.querySelector('[data-shelf="newThisWeek"] [data-product-id=${JSON.stringify(fixtures[0].id)}]')?.innerText || ""`), /Currently unavailable/);
    response = await ownerPost({
      expectedRevision: Number(query("SELECT revision FROM homepage_configurations WHERE id='storefront'").results[0].revision),
      shelves: { ...saved.shelves, newThisWeek: { visible: true, managed: true, productIds: [fixtures[0].id] } }
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ineligible_product");
    response = await ownerPost({ expectedRevision: 1, shelves: saved.shelves }, { origin: ORIGIN, "content-type": "application/json" });
    assert.equal(response.status, 401);
    console.log("Availability/security: paused product vanished publicly; invalid and unauthenticated changes were rejected.");

    await clickProduct(cdp, fixtures[0].id, false);
    await clickProduct(cdp, fixtures[1].id, false);
    await saveEditor(cdp);
    publicShelf = await homepageOrder(cdp);
    assert.ok(!publicShelf.ids.includes(fixtures[0].id) && !publicShelf.ids.includes(fixtures[1].id));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.shop-wall-bay--products').length"), 4);
    console.log("Removal/compatibility: both selections disappeared immediately while all four existing storefront shelf bays remained functional.");
  } catch (error) {
    mainError = error;
  }

  try {
    query(`UPDATE homepage_configurations SET configuration_json=${sql(originalConfig.configuration_json)},revision=${sql(Number(originalConfig.revision))},created_at=${sql(originalConfig.created_at)},updated_at=${sql(originalConfig.updated_at)} WHERE id='storefront'`);
    const restored = query("SELECT * FROM homepage_configurations WHERE id='storefront'").results[0];
    assert.deepEqual(restored, originalConfig);
    for (const fixture of fixtures) {
      let product = await catalog.getProductById(db, fixture.id);
      if (!product) continue;
      const coverKey = product.coverR2Key;
      const deliveryKey = product.deliveryR2Key;
      if (product.publicationState !== "draft") {
        product = await catalog.updateProduct(db, product.id, { publicationState: "draft" }, { expectedRevision: product.revision });
      }
      assert.equal(await catalog.deleteDraftProduct(db, product.id), true);
      r2Delete(coverKey); r2Delete(deliveryKey);
      assertR2Missing(coverKey); assertR2Missing(deliveryKey);
    }
    assert.equal(query(`SELECT COUNT(*) n FROM marketplace_products WHERE id IN (${fixtures.map(fixture => sql(fixture.id)).join(",")})`).results[0].n, 0);
    console.log("Cleanup: original homepage row restored byte-for-byte; disposable D1 products and exact R2 objects removed.");
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
    console.log("Cleanup: disposable Owner session removed; staging remained CLOSED.");
  }
  if (mainError) throw mainError;
  console.log("Task 2N-B authenticated Owner Homepage browser verification passed.");
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
