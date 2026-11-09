// Staging-only assisted batch intake through the deployed Admin Product Intake Bench.
// This deliberately drives the ordinary browser UI so PDF prefill, cover extraction,
// validation, review, authorization, and native D1/R2 publication remain authoritative.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const CONFIG = "ops/staging/wrangler.pages.toml";
const DATABASE = "trg-orders-staging";
const DATABASE_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const BUCKET = "trg-products-staging";
const EXPECTED_PUBLISHER = "Tobacco Road Games";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function parseArguments(argv) {
  const options = { manifestPath: "", verifyOnly: false, resume: false, onlySlugs: [] };
  for (const argument of argv) {
    if (argument === "--verify-only") options.verifyOnly = true;
    else if (argument === "--resume") options.resume = true;
    else if (argument.startsWith("--only=")) {
      options.onlySlugs = argument.slice("--only=".length).split(",").map(value => value.trim()).filter(Boolean);
    }
    else if (!options.manifestPath) options.manifestPath = path.resolve(argument);
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!options.manifestPath) {
    throw new Error("Usage: node scripts/import-admin-publications-staging.js <manifest.json> [--resume|--verify-only] [--only=slug,...]");
  }
  return options;
}

function normalizeManifest(raw, manifestPath) {
  assert.equal(raw?.schemaVersion, 1, "The import manifest must use schemaVersion 1.");
  const operatorUserId = String(raw.operatorUserId || "").trim();
  assert.ok(operatorUserId, "The import manifest must name an existing Admin or Owner operatorUserId.");
  assert.ok(Array.isArray(raw.products) && raw.products.length, "The import manifest must contain products.");
  const seen = new Set();
  const products = raw.products.map((entry, index) => {
    const label = `products[${index}]`;
    const product = {
      pdfPath: path.resolve(path.dirname(manifestPath), String(entry.pdfPath || "")),
      slug: String(entry.slug || "").trim(),
      title: String(entry.title || "").trim(),
      subtitle: String(entry.subtitle || "").trim(),
      authors: Array.isArray(entry.authors) ? entry.authors.map(value => String(value).trim()).filter(Boolean) : [],
      pageCount: Number(entry.pageCount),
      gameSystem: String(entry.gameSystem || "5E Compatible").trim(),
      productLine: String(entry.productLine || "").trim(),
      series: String(entry.series || "").trim(),
      volume: String(entry.volume || "").trim(),
      shortDescription: String(entry.shortDescription || "").trim(),
      longDescription: String(entry.longDescription || "").trim(),
      features: Array.isArray(entry.features) ? entry.features.map(value => String(value).trim()).filter(Boolean) : [],
      legalNote: String(entry.legalNote || "").trim(),
      language: String(entry.language || "English").trim(),
      version: String(entry.version || "1.0").trim(),
      tags: Array.isArray(entry.tags) ? entry.tags.map(value => String(value).trim()).filter(Boolean) : []
    };
    assert.ok(fs.existsSync(product.pdfPath), `${label}.pdfPath does not exist: ${product.pdfPath}`);
    assert.match(product.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${label}.slug must be a URL-safe slug.`);
    assert.ok(!seen.has(product.slug), `Duplicate manifest slug: ${product.slug}`);
    seen.add(product.slug);
    assert.ok(product.title, `${label}.title is required.`);
    assert.ok(product.authors.length, `${label}.authors is required.`);
    assert.ok(Number.isInteger(product.pageCount) && product.pageCount > 1, `${label}.pageCount must describe a multi-page PDF.`);
    assert.ok(product.productLine, `${label}.productLine is required.`);
    assert.ok(product.shortDescription, `${label}.shortDescription is required.`);
    assert.ok(product.longDescription, `${label}.longDescription is required.`);
    assert.ok(product.features.length, `${label}.features is required.`);
    return product;
  });
  return { operatorUserId, products };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function cli(...args) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function query(command) {
  const response = JSON.parse(cli("d1", "execute", DATABASE, "--remote", "--config", CONFIG, "--json", "--command", command));
  assert.equal(response.length, 1);
  assert.equal(response[0].success, true, JSON.stringify(response));
  return response[0];
}

function r2Get(key) {
  const result = childProcess.spawnSync(process.execPath, [WRANGLER, "r2", "object", "get", `${BUCKET}/${key}`,
    "--remote", "--config", CONFIG, "--pipe"], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`R2 read failed: ${String(result.stderr || result.stdout)}`);
  return Buffer.from(result.stdout);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
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
  assert.ok(executable, "A Chromium browser is required for Admin publication intake.");
  return executable;
}

async function getOpenPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function fetchJson(url, attempts = 160) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
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
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    }
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Browser evaluation failed.");
  }
  return response.result?.value;
}

async function waitFor(cdp, expression, message, attempts = 400, interval = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // Navigation can replace the execution context between polls.
    }
    await delay(interval);
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

function removeTemporaryProfile(browser, profileDirectory) {
  if (process.platform === "win32" && browser.pid) {
    childProcess.spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    browser.kill("SIGKILL");
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY"].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  console.warn(`Temporary browser profile remains locked: ${profileDirectory}`);
}

function setFieldsExpression(product) {
  const fields = {
    "product-title": product.title,
    "product-slug": product.slug,
    "product-folder": product.slug,
    "product-subtitle": product.subtitle,
    "product-authors": product.authors.join(", "),
    "product-system": product.gameSystem,
    "product-line": product.productLine,
    "product-series": product.series,
    "product-volume": product.volume,
    "product-media-type": "digital",
    "product-format": "PDF",
    "product-page-count": String(product.pageCount),
    "product-price": "0.00",
    "product-sale-price": "",
    "product-status": "preview-only",
    "product-buy-mode": "preview-only",
    "product-short-description": product.shortDescription,
    "product-long-description": product.longDescription,
    "product-features": product.features.join("\n"),
    "product-language": product.language,
    "product-legal-note": product.legalNote,
    "product-version": product.version,
    "product-tags": product.tags.join(", ")
  };
  return `(() => {
    globalThis.TRGProductIntake.addOwnerProductLine(${JSON.stringify(product.productLine)});
    const values = ${JSON.stringify(fields)};
    for (const [id, value] of Object.entries(values)) {
      const field = document.getElementById(id);
      if (!field) throw new Error('Missing Intake field: ' + id);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const openRules = document.getElementById('product-open-rules-eligible');
    openRules.checked = true;
    openRules.dispatchEvent(new Event('change', { bubbles: true }));
    const sale = document.getElementById('product-sale-enabled');
    sale.checked = false;
    sale.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      status: document.getElementById('product-status').value,
      buyMode: document.getElementById('product-buy-mode').value,
      openRules: openRules.checked,
      saleEnabled: sale.checked
    };
  })()`;
}

async function importProduct(cdp, origin, product, operatorRole) {
  await navigate(cdp, `${origin}/owner/product-intake.html`);
  await waitFor(cdp, "document.documentElement?.dataset?.ownerIntakeRuntime === 'ready'", "Admin Intake did not initialize.");
  assert.equal(await evaluate(cdp, `fetch('/api/account/me').then(r => r.json()).then(x => x.user?.role)`), operatorRole);
  await evaluate(cdp, "document.getElementById('start-new-listing-button').click()");
  await setFile(cdp, "#product-pdf-file", product.pdfPath);
  await waitFor(cdp, `document.getElementById('product-page-count').value === ${JSON.stringify(String(product.pageCount))} &&
    document.getElementById('pdf-front-image').hidden === false &&
    document.getElementById('pdf-back-image').hidden === false`,
  `PDF prefill or first/final-page extraction did not finish for ${product.slug}.`, 2400, 250);
  const protectedState = await evaluate(cdp, setFieldsExpression(product));
  assert.deepEqual(protectedState, { status: "preview-only", buyMode: "preview-only", openRules: true, saleEnabled: false });
  await evaluate(cdp, "document.getElementById('analyze-listing-button').click()");
  await waitFor(cdp, "/Validation (passed|failed)/.test(document.getElementById('intake-feedback-heading').textContent)",
    `Validation did not finish for ${product.slug}.`);
  const validation = await evaluate(cdp, `({
    heading: document.getElementById('intake-feedback-heading').textContent,
    issues: [...document.querySelectorAll('#intake-validation-list li')].map(item => item.textContent)
  })`);
  assert.match(validation.heading, /Validation passed/, `${product.slug}: ${JSON.stringify(validation)}`);
  await evaluate(cdp, "document.getElementById('review-listing-button').click()");
  assert.match(await evaluate(cdp, "document.getElementById('intake-feedback-heading').textContent"), /review ready/i);
  await evaluate(cdp, "document.getElementById('publish-button').click()");
  await waitFor(cdp, `(() => {
    const heading = document.getElementById('intake-feedback-heading').textContent;
    return heading === 'Product published successfully' || document.getElementById('intake-action-feedback').dataset.kind === 'error';
  })()`, `Publication did not finish for ${product.slug}.`, 4000, 250);
  const result = await evaluate(cdp, `({
    heading: document.getElementById('intake-feedback-heading').textContent,
    message: document.getElementById('intake-status').textContent,
    kind: document.getElementById('intake-action-feedback').dataset.kind
  })`);
  assert.equal(result.heading, "Product published successfully", `${product.slug}: ${JSON.stringify(result)}`);
  return result;
}

function verifyD1AndR2(product, operatorUserId, operatorRole) {
  const rows = query(`SELECT p.*,u.role managing_role FROM marketplace_products p
    LEFT JOIN users u ON u.id=p.managed_by_user_id WHERE p.slug=${sql(product.slug)}`).results;
  assert.equal(rows.length, 1, `Expected one D1 product for ${product.slug}.`);
  const row = rows[0];
  const metadata = JSON.parse(row.metadata_json);
  assert.equal(row.managed_by_user_id, operatorUserId);
  assert.equal(row.managing_role, operatorRole);
  assert.equal(row.publisher, EXPECTED_PUBLISHER);
  assert.equal(row.status, "preview-only");
  assert.equal(row.buy_mode, "preview-only");
  assert.equal(row.sale_enabled, 0);
  assert.equal(row.price_cents, 0);
  assert.equal(row.publication_state, "published");
  assert.equal(metadata.openRulesEligible, true);
  assert.equal(metadata.pageCount, product.pageCount);
  assert.deepEqual(metadata.authors, product.authors);
  assert.equal(metadata.series || "", product.series);
  assert.equal(metadata.volume || "", product.volume);
  const localPdf = fs.readFileSync(product.pdfPath);
  const remotePdf = r2Get(row.delivery_r2_key);
  const cover = r2Get(row.cover_r2_key);
  const back = r2Get(row.back_cover_r2_key);
  assert.equal(hash(remotePdf), hash(localPdf));
  assert.equal(cover.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(back.subarray(0, 4).toString("ascii"), "RIFF");
  assert.notEqual(hash(cover), hash(back));
  return {
    productId: row.id,
    slug: row.slug,
    title: row.title,
    pageCount: metadata.pageCount,
    coverR2Key: row.cover_r2_key,
    backCoverR2Key: row.back_cover_r2_key,
    deliveryR2Key: row.delivery_r2_key,
    pdfSha256: hash(remotePdf)
  };
}

function angleDifference(first, second) {
  return Math.abs((((second - first) % 360) + 540) % 360 - 180);
}

async function verifyManualIntakeEditability(cdp, origin, products) {
  for (const product of products) {
    await navigate(cdp, `${origin}/owner/product-intake.html`);
    await waitFor(cdp, `document.documentElement?.dataset?.ownerIntakeRuntime === 'ready' &&
      [...document.querySelectorAll('#product-existing-select option')].some(option => option.value === ${JSON.stringify(product.slug)})`,
    `${product.slug} did not appear in the ordinary Admin Intake listing picker.`);
    const loaded = await evaluate(cdp, `(() => {
      const select = document.getElementById('product-existing-select');
      select.value = ${JSON.stringify(product.slug)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('product-existing-load').click();
      return {
        detailsVisible: !document.getElementById('listing-details-section').hidden,
        title: document.getElementById('product-title').value,
        slug: document.getElementById('product-slug').value,
        status: document.getElementById('product-status').value,
        buyMode: document.getElementById('product-buy-mode').value
      };
    })()`);
    assert.deepEqual(loaded, {
      detailsVisible: true,
      title: product.title,
      slug: product.slug,
      status: "preview-only",
      buyMode: "preview-only"
    });
  }
  return "all products loaded in ordinary Admin Intake edit mode";
}

async function captureBook(cdp, outputPath) {
  const rect = await evaluate(cdp, `(() => {
    const value = document.querySelector('.product-book__stage').getBoundingClientRect();
    return { x: value.left + scrollX, y: value.top + scrollY, width: value.width, height: value.height };
  })()`);
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
  });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
}

async function verifyRotation(cdp, origin, product, screenshotDirectory) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
  });
  const url = `${origin}/store/products/${product.slug}/`;
  await navigate(cdp, url);
  await waitFor(cdp, `document.getElementById('product-title')?.textContent === ${JSON.stringify(product.title)} &&
    document.querySelector('.product-book__auto-toggle')?.textContent === 'Pause rotation'`,
  `Normal-motion book did not initialize for ${product.slug}.`);
  const initial = await evaluate(cdp, `(() => {
    const media = document.querySelector('[data-product-book]');
    const book = document.querySelector('.product-book');
    return {
      angle: parseFloat(getComputedStyle(book).getPropertyValue('--book-angle')),
      auto: media.dataset.autoRotate,
      front: document.querySelector('.product-book__front img')?.getAttribute('src') || '',
      back: document.querySelector('.product-book__back img')?.getAttribute('src') || '',
      spineTitle: document.querySelector('.product-book__spine-title')?.textContent || '',
      spineCredit: document.querySelector('.product-book__spine-credit')?.textContent || '',
      depth: parseFloat(getComputedStyle(book).getPropertyValue('--book-depth')),
      pageEdges: Boolean(document.querySelector('.product-book__pages')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`);
  assert.equal(initial.auto, "true");
  assert.equal(initial.front, `/product-assets/${product.slug}/cover.webp`);
  assert.equal(initial.back, `/product-assets/${product.slug}/back-cover.webp`);
  assert.equal(initial.spineTitle, product.title);
  assert.ok(initial.spineCredit, `${product.slug} is missing its generated spine credit.`);
  assert.ok(initial.depth >= 12, `${product.slug} is missing representative thickness.`);
  assert.equal(initial.pageEdges, true);
  assert.equal(initial.overflow, false);
  await delay(1200);
  const advanced = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(initial.angle, advanced) >= 8, `${product.slug} did not visibly advance under normal motion.`);

  await evaluate(cdp, "document.querySelector('.product-book__auto-toggle').click()");
  const paused = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  await delay(700);
  const pausedLater = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(paused, pausedLater) < 0.5, `${product.slug} did not pause.`);
  assert.equal(await evaluate(cdp, "document.querySelector('.product-book__auto-toggle').textContent"), "Resume rotation");
  await evaluate(cdp, "document.querySelector('.product-book__auto-toggle').click()");
  const resumedAt = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(paused, resumedAt) < 1, `${product.slug} snapped when rotation resumed.`);
  await delay(1000);
  const resumedLater = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(resumedAt, resumedLater) >= 6, `${product.slug} did not resume.`);

  const views = [
    [0, "front", "Front cover"],
    [90, "spine", "Spine"],
    [180, "back", "Back cover"],
    [270, "pages", "Page edges"]
  ];
  const screenshots = [];
  for (const [angle, label, expectedLabel] of views) {
    const outputPath = path.join(screenshotDirectory, `${product.slug}-${label}.png`);
    const output = await evaluate(cdp, `(() => {
      const slider = document.querySelector('.product-book__control input[type="range"]');
      slider.value = ${JSON.stringify(String(angle))};
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector('.product-book__control output').value;
    })()`);
    assert.match(output, new RegExp(`^${expectedLabel.replace(" ", "\\s")}`));
    await delay(150);
    await captureBook(cdp, outputPath);
    screenshots.push({ angle, label, path: outputPath });
  }

  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  await navigate(cdp, url);
  await waitFor(cdp, "document.querySelector('.product-book__auto-toggle')?.textContent === 'Resume rotation'",
    `Reduced-motion book did not start paused for ${product.slug}.`);
  const reducedStart = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  await delay(900);
  const reducedStill = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(reducedStart, reducedStill) < 0.5, `${product.slug} ignored reduced motion at startup.`);
  await evaluate(cdp, "document.querySelector('.product-book__auto-toggle').click()");
  await delay(1000);
  const reducedExplicitResume = await evaluate(cdp, "parseFloat(getComputedStyle(document.querySelector('.product-book')).getPropertyValue('--book-angle'))");
  assert.ok(angleDifference(reducedStart, reducedExplicitResume) >= 6,
    `${product.slug} did not honor an explicit Resume action under reduced motion.`);
  return { url, screenshots, normalMotion: "automatic; Pause and Resume passed", reducedMotion: "started paused; explicit Resume passed" };
}

async function buildContactSheet(cdp, rotationResults, outputPath) {
  const cards = rotationResults.flatMap(result => result.screenshots.map(screenshot => {
    const data = fs.readFileSync(screenshot.path).toString("base64");
    return `<figure><img src="data:image/png;base64,${data}"><figcaption>${result.slug} - ${screenshot.label} (${screenshot.angle}°)</figcaption></figure>`;
  })).join("");
  const html = `<!doctype html><style>
    body{margin:0;padding:20px;background:#ede6d8;color:#24180e;font:14px Arial,sans-serif}
    h1{margin:0 0 16px;font:700 24px Georgia,serif}
    main{display:grid;grid-template-columns:repeat(4,250px);gap:18px}
    figure{margin:0;padding:10px;background:white;border:1px solid #9a7f54;border-radius:8px}
    img{display:block;width:230px;height:230px;object-fit:contain;background:#f4f0e8}
    figcaption{padding-top:8px;overflow-wrap:anywhere}
  </style><h1>Open Rules Library - real staging Product Identity rotation views</h1><main>${cards}</main>`;
  await navigate(cdp, "about:blank");
  await evaluate(cdp, `document.open();document.write(${JSON.stringify(html)});document.close();`);
  await waitFor(cdp, "[...document.images].every(image => image.complete)", "Contact-sheet images did not load.");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = normalizeManifest(JSON.parse(fs.readFileSync(options.manifestPath, "utf8")), options.manifestPath);
  if (options.onlySlugs.length) {
    const requested = new Set(options.onlySlugs);
    const available = new Set(manifest.products.map(product => product.slug));
    for (const slug of requested) assert.ok(available.has(slug), `The manifest does not contain --only slug ${slug}.`);
    manifest.products = manifest.products.filter(product => requested.has(product.slug));
  }
  const origin = String(process.env.TRG_STAGING_PAGES_URL || "").replace(/\/$/, "");
  assert.ok(new URL(origin).hostname.endsWith(".tobacco-road-games-staging.pages.dev"),
    "TRG_STAGING_PAGES_URL must be a deployment of the staging Pages project.");
  assert.ok(fs.existsSync(WRANGLER), "Install the repository dependencies before running the assisted importer.");
  const info = JSON.parse(cli("d1", "info", DATABASE, "--json", "--config", CONFIG));
  assert.equal(info.uuid, DATABASE_ID, "The configured D1 database is not the staging catalog.");
  assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
  const operator = query(`SELECT id,role,status FROM users WHERE id=${sql(manifest.operatorUserId)}`).results[0];
  assert.equal(operator?.id, manifest.operatorUserId);
  assert.ok(["admin", "owner"].includes(operator?.role), "The assisted Intake operator must be an Admin or Owner.");
  assert.equal(operator?.status, "active");

  const sessionId = `admin-assisted-intake-${randomUUID()}`;
  const sessionToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const csrfToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const now = new Date();
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-admin-assisted-intake-"));
  const debuggingPort = await getOpenPort();
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking", "--disable-component-update", "--disable-crash-reporter",
    "--disable-default-apps", "--disable-extensions", "--disable-features=Crashpad", "--disable-gpu",
    "--headless=new", "--no-first-run", "--no-sandbox", `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`, `${origin}/owner/product-intake.html`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", chunk => { browserErrors += chunk.toString(); });
  let cdp;
  try {
    query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(
      ${sql(sessionId)},${sql(manifest.operatorUserId)},${sql(hash(sessionToken))},${sql(hash(csrfToken))},${sql(now.toISOString())},
      ${sql(new Date(now.getTime() + 4 * 60 * 60_000).toISOString())},${sql(now.toISOString())})`);
    const targets = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/list`)
      .catch(error => { throw new Error(`Chromium did not start: ${browserErrors.trim() || error.message}`); });
    const page = targets.find(target => target.type === "page");
    assert.ok(page?.webSocketDebuggerUrl, "Chromium did not expose the Admin Intake page.");
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");
    for (const cookie of [
      { name: "__Host-trg_session", value: sessionToken, httpOnly: true },
      { name: "trg_account_csrf", value: csrfToken, httpOnly: false }
    ]) {
      const response = await cdp.send("Network.setCookie", { ...cookie, url: origin, path: "/", secure: true, sameSite: "Lax" });
      assert.equal(response.success, true);
    }

    const imported = [];
    for (const product of manifest.products) {
      const existing = query(`SELECT id,title,status,buy_mode,publisher,managed_by_user_id FROM marketplace_products WHERE id=${sql(product.slug)} OR slug=${sql(product.slug)}`).results;
      if (existing.length) {
        assert.equal(existing.length, 1, `Multiple existing records match ${product.slug}.`);
        const row = existing[0];
        const safeToResume = row.id === product.slug && row.title === product.title && row.status === "preview-only" &&
          row.buy_mode === "preview-only" && row.publisher === EXPECTED_PUBLISHER && row.managed_by_user_id === manifest.operatorUserId;
        assert.ok((options.resume || options.verifyOnly) && safeToResume,
          `Refusing to duplicate or overwrite the existing product ${product.slug}. Use --resume only for an exact prior import.`);
        console.log(`RESUME ${product.slug}: exact existing Admin publication retained.`);
      } else {
        assert.equal(options.verifyOnly, false, `Verification-only mode cannot find ${product.slug}.`);
        console.log(`INTAKE ${product.slug}: ${product.pageCount} pages through the Admin Product Intake Bench.`);
        await importProduct(cdp, origin, product, operator.role);
        console.log(`PUBLISHED ${product.slug}`);
      }
      imported.push(verifyD1AndR2(product, manifest.operatorUserId, operator.role));
    }

    const manualIntake = await verifyManualIntakeEditability(cdp, origin, manifest.products);

    const screenshotDirectory = path.join(ROOT, "tmp", "admin-publication-rotation");
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const rotations = [];
    for (const product of manifest.products) {
      console.log(`ROTATION ${product.slug}: normal and reduced motion.`);
      rotations.push({ slug: product.slug, ...(await verifyRotation(cdp, origin, product, screenshotDirectory)) });
    }
    const contactSheet = path.join(ROOT, "tmp", "admin-publication-rotation-contact-sheet.png");
    await buildContactSheet(cdp, rotations, contactSheet);
    const report = { origin, imported, manualIntake, rotations, contactSheet, storeState: "CLOSED" };
    const reportPath = path.join(ROOT, "tmp", "admin-publication-import-results.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, contactSheet, imported: imported.length, storeState: "CLOSED" }, null, 2));
  } finally {
    cdp?.close();
    try {
      query(`DELETE FROM sessions WHERE id=${sql(sessionId)}`);
      assert.equal(query(`SELECT COUNT(*) n FROM sessions WHERE id=${sql(sessionId)}`).results[0].n, 0);
      assert.equal(query("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").results[0].setting_value, "CLOSED");
    } finally {
      removeTemporaryProfile(browser, profileDirectory);
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { normalizeManifest, parseArguments };
