const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  testPricingEditorMarkup();
  await testNativeAndLegacyLoading();
  await testFixedPriceRevisionUpdate();
  await testFreeAndPwywValidation();
  await testConflictRefreshAndInvalidSale();
  console.log("Owner pricing editor tests passed.");
}

function testPricingEditorMarkup() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "pricing.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "assets", "js", "owner-pricing-editor.js"), "utf8").replace(/\r\n/g, "\n");
  const version = crypto.createHash("sha256").update(script).digest("hex").slice(0, 16);
  assert.match(html, new RegExp(`owner-pricing-editor\\.js\\?v=sha256-${version}`));
  assert.match(html, /Load a native D1 product/);
  assert.match(html, /Legacy-only products remain visible.*read-only/i);
  assert.match(html, /id="pricing-model"/);
  assert.match(html, /id="pricing-availability"/);
  assert.match(html, /id="pricing-suggested-price"/);
  assert.match(html, /id="pricing-minimum-price"/);
  assert.match(html, />Update Pricing</);
  assert.doesNotMatch(html, /Publication Temporarily Unavailable/);
  assert.match(html, /Stable product ID, slug, Creator ownership, R2 references/);
}

async function testNativeAndLegacyLoading() {
  const harness = createHarness({ nativeProducts: [nativeProduct()], legacyProducts: [
    { slug: "legacy-only", title: "Legacy Only", price: "4.99", currency: "USD", status: "available-direct", buyMode: "cart" },
    { slug: "native-product", title: "Conflicting Legacy", price: "1.00" }
  ] });
  await harness.flush();
  assert.match(harness.fields.existingSelect.innerHTML, /\[Native D1\] Native Product/);
  assert.match(harness.fields.existingSelect.innerHTML, /\[Legacy · read only\] Legacy Only/);
  assert.doesNotMatch(harness.fields.existingSelect.innerHTML, /Conflicting Legacy/);
  harness.fields.existingSelect.value = "native-product";
  harness.buttons.load.click();
  assert.equal(harness.fields.currentSource.textContent, "Native D1");
  assert.equal(harness.fields.currentRevision.textContent, "3");
  assert.equal(harness.fields.regularPrice.value, "5.00");
  assert.equal(harness.fields.editorPanel.hidden, false);
  harness.fields.existingSelect.value = "legacy-only";
  harness.buttons.load.click();
  assert.equal(harness.fields.editorPanel.hidden, true);
  assert.match(harness.fields.pricingStatus.textContent, /Legacy-only products cannot be changed/);
}

async function testFixedPriceRevisionUpdate() {
  const requests = [];
  const harness = createHarness({
    nativeProducts: [nativeProduct()],
    post: async body => {
      requests.push(body);
      return response({ ok: true, message: "Pricing for Native Product was updated in the native catalog.",
        product: nativeProduct({ priceCents: 725, revision: 4 }) });
    }
  });
  await harness.flush();
  loadNative(harness);
  harness.fields.regularPrice.value = "7.25";
  harness.fields.regularPrice.dispatch("input");
  harness.buttons.check.click();
  assert.match(harness.fields.pricingStatus.textContent, /valid.*Nothing has been saved/i);
  harness.buttons.review.click();
  assert.equal(harness.fields.confirmPanel.hidden, false);
  assert.equal(harness.buttons.publish.disabled, false);
  assert.match(harness.fields.pricingStatus.textContent, /native revision 3/);
  harness.buttons.publish.click();
  await harness.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].slug, "native-product");
  assert.equal(requests[0].expectedRevision, 3);
  assert.equal(requests[0].priceCents, 725);
  assert.equal(requests[0].pricingModel, "fixed");
  assert.equal(harness.lastPostHeaders["x-csrf-token"], "pricing-csrf");
  assert.equal(harness.fields.currentRevision.textContent, "4");
  assert.equal(harness.fields.regularPrice.value, "7.25");
  assert.match(harness.fields.pricingStatus.textContent, /Revision 4 is now authoritative/);
}

async function testFreeAndPwywValidation() {
  const requests = [];
  const harness = createHarness({ nativeProducts: [nativeProduct()], post: async body => {
    requests.push(body);
    return response({ ok: true, message: "Updated.", product: nativeProduct({ ...body, revision: body.expectedRevision + 1,
      status: body.pricingModel === "free" ? "free-download" : "pay-what-you-want",
      buyMode: body.pricingModel === "free" ? "free-download" : "cart" }) });
  } });
  await harness.flush();
  loadNative(harness);
  harness.fields.pricingModel.value = "free";
  harness.fields.pricingModel.dispatch("change");
  harness.buttons.review.click();
  assert.equal(harness.buttons.publish.disabled, false);
  harness.buttons.publish.click();
  await harness.flush();
  assert.equal(requests[0].pricingModel, "free");
  assert.equal(requests[0].priceCents, 0);
  assert.equal(requests[0].suggestedPriceCents, null);

  const pwywHarness = createHarness({ nativeProducts: [nativeProduct()] });
  await pwywHarness.flush();
  loadNative(pwywHarness);
  pwywHarness.fields.pricingModel.value = "pwyw";
  pwywHarness.fields.pricingModel.dispatch("change");
  pwywHarness.fields.suggestedPrice.value = "5.00";
  pwywHarness.fields.minimumPrice.value = "6.00";
  pwywHarness.buttons.review.click();
  assert.match(pwywHarness.fields.pricingStatus.textContent, /at or above its minimum/i);
  pwywHarness.fields.minimumPrice.value = "0.00";
  pwywHarness.buttons.review.click();
  assert.equal(pwywHarness.buttons.publish.disabled, false);
}

async function testConflictRefreshAndInvalidSale() {
  const harness = createHarness({ nativeProducts: [nativeProduct()], post: async () => response({
    code: "revision_conflict",
    error: "This product changed after it was loaded. Reload its current pricing before trying again.",
    product: nativeProduct({ priceCents: 600, revision: 4 })
  }, 409) });
  await harness.flush();
  loadNative(harness);
  harness.fields.regularPrice.value = "7.25";
  harness.buttons.review.click();
  harness.buttons.publish.click();
  await harness.flush();
  assert.equal(harness.fields.currentRevision.textContent, "4");
  assert.equal(harness.fields.regularPrice.value, "6.00");
  assert.match(harness.fields.pricingStatus.textContent, /changed after it was loaded/);

  harness.fields.saleEnabled.checked = true;
  harness.fields.saleEnabled.dispatch("change");
  harness.fields.salePrice.value = "6.00";
  harness.fields.nonPurchasableConfirm.checked = true;
  harness.buttons.review.click();
  assert.match(harness.fields.pricingStatus.textContent, /lower than the fixed price/i);
}

function nativeProduct(overrides = {}) {
  return {
    availability: "available", buyMode: "cart", currency: "USD", editable: true,
    id: "native-product", minimumPriceCents: null, priceCents: 500, pricingModel: "fixed",
    publicationState: "published", revision: 3, saleEnabled: false, saleEnd: "", saleLabel: "",
    salePriceCents: null, saleStart: "", slug: "native-product", source: "native-d1",
    status: "available-direct", suggestedPriceCents: null, title: "Native Product", updatedAt: "2026-11-01T00:00:00Z",
    ...overrides
  };
}

function loadNative(harness) {
  harness.fields.existingSelect.value = "native-product";
  harness.buttons.load.click();
}

function createHarness({ nativeProducts = [], legacyProducts = [], post } = {}) {
  const document = createDocument();
  const ids = [
    "pricing-availability", "pricing-confirmation-body", "pricing-confirm-current-effective",
    "pricing-confirm-current-sale-state", "pricing-confirmation-empty", "pricing-confirm-next-effective",
    "pricing-confirm-next-sale-state", "pricing-confirmation", "pricing-confirm-preservation",
    "pricing-confirm-slug", "pricing-confirmation-table", "pricing-confirm-title", "pricing-currency",
    "pricing-current-buy-mode", "pricing-current-display", "pricing-current-effective", "pricing-current-revision",
    "pricing-current-slug", "pricing-current-source", "pricing-current-status", "pricing-current-title",
    "pricing-editor-panel", "pricing-product-select", "pricing-load-copy", "pricing-minimum-price",
    "pricing-mode-indicator", "pricing-next-display", "pricing-next-effective", "pricing-nonpurchasable-confirm",
    "pricing-preview-copy", "pricing-model", "pricing-status", "pricing-regular-price", "pricing-regular-price-label",
    "pricing-sale-enabled", "pricing-sale-end", "pricing-sale-label", "pricing-sale-price", "pricing-sale-start",
    "pricing-sale-warning", "pricing-suggested-price", "pricing-cancel-review-button", "pricing-check-button",
    "pricing-load-button", "pricing-publish-button", "pricing-reset-button", "pricing-review-button"
  ];
  for (const id of ids) document.register(id, createElement(id.includes("button") ? "button" : id.includes("select") || id === "pricing-model" || id === "pricing-availability" ? "select" : "div"));
  const fields = {
    availability: document.getElementById("pricing-availability"), confirmPanel: document.getElementById("pricing-confirmation"),
    currentRevision: document.getElementById("pricing-current-revision"), currentSource: document.getElementById("pricing-current-source"),
    editorPanel: document.getElementById("pricing-editor-panel"), existingSelect: document.getElementById("pricing-product-select"),
    minimumPrice: document.getElementById("pricing-minimum-price"), nonPurchasableConfirm: document.getElementById("pricing-nonpurchasable-confirm"),
    pricingModel: document.getElementById("pricing-model"), pricingStatus: document.getElementById("pricing-status"),
    regularPrice: document.getElementById("pricing-regular-price"), saleEnabled: document.getElementById("pricing-sale-enabled"),
    salePrice: document.getElementById("pricing-sale-price"), suggestedPrice: document.getElementById("pricing-suggested-price")
  };
  const buttons = {
    load: document.getElementById("pricing-load-button"), publish: document.getElementById("pricing-publish-button"),
    review: document.getElementById("pricing-review-button"), check: document.getElementById("pricing-check-button")
  };
  document.getElementById("pricing-currency").value = "USD";
  document.getElementById("pricing-model").value = "fixed";
  document.getElementById("pricing-availability").value = "available";
  const harness = { buttons, fields, flush, lastPostHeaders: null };
  const fetchImpl = async (url, options = {}) => {
    if (String(url) === "/owner/api/pricing" && (!options.method || options.method === "GET")) {
      return response({ csrfToken: "pricing-csrf", products: nativeProducts });
    }
    if (String(url) === "/data/products.json") return response(legacyProducts);
    harness.lastPostHeaders = options.headers;
    const body = JSON.parse(options.body);
    return post ? post(body) : response({ ok: true, message: "Updated.", product: nativeProduct({ ...body, revision: body.expectedRevision + 1 }) });
  };
  const context = { console, Date, document, fetch: fetchImpl, Intl, JSON, Request, Response, globalThis: null };
  context.globalThis = context;
  context.confirm = () => true;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/js/owner-pricing-editor.js"), "utf8"), context);
  return harness;
}

function createDocument() {
  const byId = new Map();
  return {
    documentElement: { dataset: {} },
    createElement: tag => createElement(tag),
    getElementById: id => byId.get(id) || null,
    register(id, element) { byId.set(id, element); }
  };
}
function createElement(tagName = "div") {
  return {
    checked: false, children: [], disabled: false, hidden: false, innerHTML: "", listeners: new Map(),
    tagName: String(tagName).toUpperCase(), textContent: "", value: "",
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    append(child) { this.children.push(child); },
    click() { const handler = this.listeners.get("click"); if (handler) handler({ preventDefault() {} }); },
    dispatch(type) { const handler = this.listeners.get(type); if (handler) handler({ preventDefault() {} }); },
    replaceChildren(...children) { this.children = children; }
  };
}
function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
