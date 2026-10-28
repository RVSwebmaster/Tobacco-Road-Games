const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function findBrowserExecutable() {
  const candidates = [
    process.env.TRG_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(executable, "A Chromium browser is required for the Owner Intake browser regression test.");
  return executable;
}

async function getOpenPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function createStaticServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/owner/product-intake" || pathname === "/owner/product-intake/") {
      pathname = "/owner/product-intake.html";
    }
    const relativePath = pathname.replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream"
    });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/owner/product-intake` };
}

async function fetchJson(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
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
  socket.onmessage = (event) => {
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
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // Navigation may briefly replace the execution context.
    }
    await delay(100);
  }
  throw new Error(message);
}

async function removeTemporaryProfile(browser, profileDirectory) {
  if (process.platform === "win32" && browser.pid) {
    childProcess.spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    browser.kill("SIGKILL");
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(profileDirectory, { force: true, recursive: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error.code) || attempt === 19) throw error;
      await delay(100);
    }
  }
}

async function run() {
  const staticSite = process.argv[2] ? null : await createStaticServer();
  const targetUrl = process.argv[2] || staticSite.url;
  const debuggingPort = await getOpenPort();
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "trg-owner-intake-browser-"));
  const browser = childProcess.spawn(findBrowserExecutable(), [
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--headless=new",
    "--no-first-run",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    targetUrl
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserErrors = "";
  browser.stderr.on("data", (chunk) => {
    browserErrors += chunk.toString();
  });
  let cdp;

  try {
    let targets;
    try {
      targets = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/list`);
    } catch (error) {
      throw new Error(`Chromium did not start its DevTools endpoint. ${browserErrors.trim() || error.message}`);
    }
    const page = targets.find((target) => target.type === "page");
    assert.ok(page?.webSocketDebuggerUrl, "Chromium did not expose the Owner Intake page target.");
    cdp = connectCdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: targetUrl });
    await waitFor(cdp, "document.documentElement?.dataset?.ownerIntakeRuntime === 'ready'", "Owner Intake did not initialize successfully in Chromium.");

    const setup = await evaluate(cdp, `(() => {
      document.getElementById("start-new-listing-button").click();
      const setValue = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue("product-title", "Browser Regression Listing");
      setValue("product-short-description", "Temporary browser-level description retained across every non-reset action.");
      setValue("product-long-description", "A detailed tabletop supplement used only to verify the deployed Owner Intake controls in a real Chromium session.");
      setValue("product-status", "pay-what-you-want");
      setValue("product-buy-mode", "cart");
      document.getElementById("request-pricing-estimate-button").click();
      return {
        runtime: document.documentElement.dataset.ownerIntakeRuntime,
        scriptUrl: performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes("product-intake.js")) || ""
      };
    })()`);
    assert.equal(setup.runtime, "ready");
    assert.match(setup.scriptUrl, /product-intake\.js\?v=sha256-[a-f0-9]{16}$/);
    await waitFor(cdp, "document.getElementById('advisor-panel').hidden === false", "Request Pricing Estimate did not reveal Product Intelligence results.");

    const afterEstimate = await evaluate(cdp, `(() => ({
      heading: document.getElementById("intake-feedback-heading").textContent,
      title: document.getElementById("product-title").value,
      description: document.getElementById("product-short-description").value,
      advisor: document.getElementById("advisor-panel").hidden === false
    }))()`);
    assert.match(afterEstimate.heading, /Pricing estimate ready/i);
    assert.equal(afterEstimate.title, "Browser Regression Listing");
    assert.match(afterEstimate.description, /retained across every non-reset action/);
    assert.equal(afterEstimate.advisor, true);

    const afterCheck = await evaluate(cdp, `(() => {
      document.getElementById("analyze-listing-button").click();
      return {
        heading: document.getElementById("intake-feedback-heading").textContent,
        title: document.getElementById("product-title").value,
        description: document.getElementById("product-short-description").value,
        validationCount: document.querySelectorAll("#intake-validation-list li").length
      };
    })()`);
    assert.match(afterCheck.heading, /Validation failed/i);
    assert.ok(afterCheck.validationCount > 0, "Check New Listing must show visible validation errors.");
    assert.equal(afterCheck.title, "Browser Regression Listing");
    assert.match(afterCheck.description, /retained across every non-reset action/);

    const afterReview = await evaluate(cdp, `(() => {
      document.getElementById("review-listing-button").click();
      return {
        heading: document.getElementById("intake-feedback-heading").textContent,
        title: document.getElementById("product-title").value,
        description: document.getElementById("product-short-description").value
      };
    })()`);
    assert.match(afterReview.heading, /Review blocked/i);
    assert.equal(afterReview.title, "Browser Regression Listing");
    assert.match(afterReview.description, /retained across every non-reset action/);

    const afterReset = await evaluate(cdp, `(() => {
      window.confirm = () => true;
      document.getElementById("reset-intake-button").click();
      return {
        heading: document.getElementById("intake-feedback-heading").textContent,
        title: document.getElementById("product-title").value,
        description: document.getElementById("product-short-description").value
      };
    })()`);
    assert.match(afterReset.heading, /New product form cleared/i);
    assert.equal(afterReset.title, "");
    assert.equal(afterReset.description, "");

    console.log(JSON.stringify({
      afterCheck,
      afterEstimate,
      afterReset,
      scriptUrl: setup.scriptUrl,
      targetUrl
    }, null, 2));
    console.log("Owner Intake Chromium regression passed.");
  } finally {
    cdp?.close();
    if (staticSite) await new Promise((resolve) => staticSite.server.close(resolve));
    await removeTemporaryProfile(browser, profileDirectory);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
