const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  await testPricingEditorLabels();
  await testPricingEditorLoadsExistingProduct();
  await testPricingEditorReviewAndPublish();
  await testPricingEditorConfirmationAndDiscard();
  await testPricingEditorValidation();
  console.log("Owner pricing editor tests passed.");
}

async function testPricingEditorLabels() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "pricing.html"), "utf8");
  assert.match(html, /Editing Existing Listing: Select a product to begin\./, "Pricing editor should show a clear existing-listing mode indicator.");
  assert.match(html, />Check Pricing</, "Pricing editor should expose a Check Pricing action.");
  assert.match(html, />Review Pricing Changes</, "Pricing editor should expose a Review Pricing Changes action.");
  assert.match(html, />Update Pricing</, "Pricing editor should expose an Update Pricing action.");
  assert.match(html, />Discard Pricing Changes</, "Pricing editor should expose a Discard Pricing Changes action.");
  assert.match(html, /Checks pricing fields for missing or invalid information\. Does not save changes\./, "Pricing editor should describe the check action.");
  assert.match(html, /Shows exactly what will change before anything is published\./, "Pricing editor should describe the review action.");
  assert.match(html, /Clears unsaved pricing edits and restores the loaded values\. Published data is not affected\./, "Pricing editor should describe the discard action.");
  assert.match(html, /Status, purchase mode, availability, files, artwork, descriptions, authors, and fulfillment settings will not change\./, "Pricing editor should state which unrelated fields stay unchanged.");
  assert.doesNotMatch(html, /Publish Product/, "Pricing editor should not use the vague Publish Product label.");
}

async function testPricingEditorLoadsExistingProduct() {
  const products = [
    {
      buyMode: "preview-only",
      currency: "USD",
      price: "4.99",
      priceCents: 499,
      saleEnabled: false,
      saleEnd: "",
      saleLabel: "",
      salePrice: "",
      salePriceCents: null,
      saleStart: "",
      slug: "agency",
      status: "coming-soon",
      title: "Agency"
    }
  ];

  const harness = createHarness(products);
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.load.click();

  assert.equal(harness.fields.currentTitle.textContent, "Agency", "Loading a product should show the current title.");
  assert.equal(harness.fields.currentSlug.textContent, "agency", "Loading a product should show the current slug.");
  assert.equal(harness.inputs.regularPrice.value, "4.99", "Loading a product should hydrate the current regular price.");
  assert.equal(harness.inputs.currency.value, "USD", "Loading a product should hydrate the current currency.");
  assert.equal(harness.inputs.saleEnabled.checked, false, "Loading a product should hydrate the current sale flag.");
}

async function testPricingEditorReviewAndPublish() {
  const products = [
    {
      buyMode: "preview-only",
      currency: "USD",
      price: "4.99",
      priceCents: 499,
      saleEnabled: false,
      saleEnd: "",
      saleLabel: "",
      salePrice: "",
      salePriceCents: null,
      saleStart: "",
      slug: "agency",
      status: "coming-soon",
      title: "Agency"
    }
  ];

  const requests = [];
  const harness = createHarness(products, async (url, options = {}) => {
    if (String(url).includes("/data/products.json")) {
      return createJsonResponse(products);
    }
    requests.push({ url: String(url), options });
    return createJsonResponse({
      message: "Pricing update published successfully.",
      ok: true,
      runUrl: "https://example.com/run"
    });
  });
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.load.click();

  harness.inputs.regularPrice.value = "6.99";
  harness.inputs.regularPrice.dispatch("input");
  harness.inputs.saleEnabled.checked = true;
  harness.inputs.saleEnabled.dispatch("change");
  harness.inputs.salePrice.value = "4.99";
  harness.inputs.salePrice.dispatch("input");
  harness.inputs.saleStart.value = "2026-08-01";
  harness.inputs.saleStart.dispatch("change");
  harness.inputs.saleEnd.value = "2026-08-15";
  harness.inputs.saleEnd.dispatch("change");
  harness.inputs.saleLabel.value = "Event Sale";
  harness.inputs.saleLabel.dispatch("input");
  harness.inputs.nonPurchasableConfirm.checked = true;
  harness.inputs.nonPurchasableConfirm.dispatch("change");

  harness.buttons.review.click();
  assert.equal(harness.fields.confirmPanel.hidden, false, "Reviewing a valid change should show the confirmation panel.");
  assert.ok(harness.fields.confirmBody.children.length >= 6, "Confirmation should list the concrete pricing fields that will change.");
  assert.equal(harness.fields.pricingStatus.textContent, "Review the pricing summary below. Nothing has been published yet.", "Pricing review should clearly stay in preview mode.");

  harness.buttons.publish.click();
  await harness.flush();

  assert.equal(requests.length, 1, "Publishing should send a single pricing update request.");
  assert.equal(requests[0].url, "/owner/api/pricing", "Pricing editor should post to the dedicated pricing endpoint.");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.slug, "agency", "Pricing editor should publish the loaded product slug.");
  assert.equal(body.price, "6.99", "Pricing editor should publish the revised regular price.");
  assert.equal(body.priceCents, 699, "Pricing editor should derive integer regular-price cents.");
  assert.equal(body.salePrice, "4.99", "Pricing editor should publish the revised sale price.");
  assert.equal(body.salePriceCents, 499, "Pricing editor should derive integer sale-price cents.");
  assert.equal(body.saleStart, "2026-08-01", "Pricing editor should publish scheduled sale dates.");
  assert.equal(body.saleEnd, "2026-08-15", "Pricing editor should publish scheduled sale dates.");
  assert.equal(body.saleLabel, "Event Sale", "Pricing editor should publish the sale label.");
  assert.ok(!("status" in body), "Pricing editor must not publish product status changes.");
  assert.ok(!("buyMode" in body), "Pricing editor must not publish buy mode changes.");
}

async function testPricingEditorConfirmationAndDiscard() {
  const products = [
    {
      buyMode: "preview-only",
      currency: "USD",
      price: "4.99",
      priceCents: 499,
      saleEnabled: false,
      saleEnd: "",
      saleLabel: "",
      salePrice: "",
      salePriceCents: null,
      saleStart: "",
      slug: "agency",
      status: "coming-soon",
      title: "Agency"
    }
  ];

  const harness = createHarness(products);
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.load.click();

  assert.equal(harness.fields.modeIndicator.textContent, "Editing Existing Listing: Agency", "Loading a product should update the mode indicator.");

  harness.inputs.regularPrice.value = "6.99";
  harness.inputs.regularPrice.dispatch("input");
  harness.buttons.check.click();
  assert.equal(harness.fields.pricingStatus.textContent, "Pricing looks valid so far. Nothing has been saved or published.", "Check Pricing should validate without publishing.");

  harness.buttons.review.click();
  assert.equal(harness.fields.confirmTitle.textContent, "Agency", "Confirmation should include the product title.");
  assert.equal(harness.fields.confirmSlug.textContent, "agency", "Confirmation should include the product slug.");
  assert.equal(harness.fields.confirmCurrentEffective.textContent, "$4.99", "Confirmation should include the current effective price.");
  assert.equal(harness.fields.confirmNextEffective.textContent, "$6.99", "Confirmation should include the resulting effective price.");
  assert.match(harness.fields.confirmPreservation.textContent, /will not change/i, "Confirmation should include the unrelated-field preservation statement.");
  assert.match(harness.fields.confirmBody.children[0].innerHTML, /Current|4\.99|499/, "Confirmation rows should render concrete before values.");

  harness.confirmResponse = false;
  harness.buttons.reset.click();
  assert.equal(harness.confirmMessages.length, 1, "Discarding unsaved pricing changes should require confirmation.");
  assert.equal(harness.inputs.regularPrice.value, "6.99", "Declining the discard confirmation should preserve unsaved edits.");

  harness.confirmResponse = true;
  harness.buttons.reset.click();
  assert.equal(harness.inputs.regularPrice.value, "4.99", "Accepting the discard confirmation should restore the loaded value.");
}

async function testPricingEditorValidation() {
  const products = [
    {
      buyMode: "fixed-price",
      currency: "USD",
      price: "4.99",
      priceCents: 499,
      saleEnabled: false,
      saleEnd: "",
      saleLabel: "",
      salePrice: "",
      salePriceCents: null,
      saleStart: "",
      slug: "agency",
      status: "available-direct",
      title: "Agency"
    }
  ];

  const harness = createHarness(products);
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.load.click();

  harness.inputs.regularPrice.value = "4.999";
  harness.inputs.regularPrice.dispatch("input");
  harness.buttons.review.click();
  assert.match(harness.fields.pricingStatus.textContent, /valid dollar amount/i, "Malformed regular prices should be rejected.");

  harness.inputs.regularPrice.value = "4.99";
  harness.inputs.regularPrice.dispatch("input");
  harness.inputs.saleEnabled.checked = true;
  harness.inputs.saleEnabled.dispatch("change");
  harness.inputs.salePrice.value = "4.99";
  harness.inputs.salePrice.dispatch("input");
  harness.buttons.review.click();
  assert.match(harness.fields.pricingStatus.textContent, /lower than the regular price/i, "Sale prices at or above the regular price should be rejected.");

  harness.inputs.salePrice.value = "3.99";
  harness.inputs.salePrice.dispatch("input");
  harness.inputs.saleStart.value = "2026-08-15";
  harness.inputs.saleStart.dispatch("change");
  harness.inputs.saleEnd.value = "2026-08-01";
  harness.inputs.saleEnd.dispatch("change");
  harness.buttons.review.click();
  assert.match(harness.fields.pricingStatus.textContent, /Sale end cannot be earlier than sale start/i, "Invalid sale schedules should be rejected.");
}

function createHarness(products, fetchImpl) {
  const document = createDocument();
  const fields = {
    modeIndicator: createElement("span"),
    existingSelect: createElement("select"),
    currentTitle: createElement("span"),
    currentSlug: createElement("span"),
    currentStatus: createElement("span"),
    currentBuyMode: createElement("span"),
    currentDisplay: createElement("span"),
    currentEffective: createElement("span"),
    nextDisplay: createElement("span"),
    nextEffective: createElement("span"),
    editorPanel: createElement("div"),
    loadCopy: createElement("p"),
    previewCopy: createElement("p"),
    pricingStatus: createElement("p"),
    saleWarning: createElement("div"),
    confirmPanel: createElement("section"),
    confirmEmpty: createElement("div"),
    confirmTable: createElement("table"),
    confirmBody: createElement("tbody"),
    confirmTitle: createElement("span"),
    confirmSlug: createElement("span"),
    confirmCurrentEffective: createElement("span"),
    confirmNextEffective: createElement("span"),
    confirmCurrentSaleState: createElement("span"),
    confirmNextSaleState: createElement("span"),
    confirmPreservation: createElement("p")
  };

  const inputs = {
    regularPrice: createInput(""),
    currency: createInput("USD"),
    saleEnabled: createCheckbox(false),
    salePrice: createInput(""),
    saleStart: createInput(""),
    saleEnd: createInput(""),
    saleLabel: createInput(""),
    nonPurchasableConfirm: createCheckbox(false)
  };

  const buttons = {
    check: createButton(),
    load: createButton(),
    reset: createButton(),
    review: createButton(),
    publish: createButton(),
    cancelReview: createButton()
  };

  const confirmMessages = [];

  document.cookie = "trg_owner_csrf=test-csrf";
  document.register("pricing-mode-indicator", fields.modeIndicator);
  document.register("pricing-product-select", fields.existingSelect);
  document.register("pricing-current-title", fields.currentTitle);
  document.register("pricing-current-slug", fields.currentSlug);
  document.register("pricing-current-status", fields.currentStatus);
  document.register("pricing-current-buy-mode", fields.currentBuyMode);
  document.register("pricing-current-display", fields.currentDisplay);
  document.register("pricing-current-effective", fields.currentEffective);
  document.register("pricing-next-display", fields.nextDisplay);
  document.register("pricing-next-effective", fields.nextEffective);
  document.register("pricing-editor-panel", fields.editorPanel);
  document.register("pricing-load-copy", fields.loadCopy);
  document.register("pricing-preview-copy", fields.previewCopy);
  document.register("pricing-status", fields.pricingStatus);
  document.register("pricing-sale-warning", fields.saleWarning);
  document.register("pricing-confirmation", fields.confirmPanel);
  document.register("pricing-confirmation-empty", fields.confirmEmpty);
  document.register("pricing-confirmation-table", fields.confirmTable);
  document.register("pricing-confirmation-body", fields.confirmBody);
  document.register("pricing-confirm-title", fields.confirmTitle);
  document.register("pricing-confirm-slug", fields.confirmSlug);
  document.register("pricing-confirm-current-effective", fields.confirmCurrentEffective);
  document.register("pricing-confirm-next-effective", fields.confirmNextEffective);
  document.register("pricing-confirm-current-sale-state", fields.confirmCurrentSaleState);
  document.register("pricing-confirm-next-sale-state", fields.confirmNextSaleState);
  document.register("pricing-confirm-preservation", fields.confirmPreservation);
  document.register("pricing-regular-price", inputs.regularPrice);
  document.register("pricing-currency", inputs.currency);
  document.register("pricing-sale-enabled", inputs.saleEnabled);
  document.register("pricing-sale-price", inputs.salePrice);
  document.register("pricing-sale-start", inputs.saleStart);
  document.register("pricing-sale-end", inputs.saleEnd);
  document.register("pricing-sale-label", inputs.saleLabel);
  document.register("pricing-nonpurchasable-confirm", inputs.nonPurchasableConfirm);
  document.register("pricing-check-button", buttons.check);
  document.register("pricing-load-button", buttons.load);
  document.register("pricing-reset-button", buttons.reset);
  document.register("pricing-review-button", buttons.review);
  document.register("pricing-publish-button", buttons.publish);
  document.register("pricing-cancel-review-button", buttons.cancelReview);

  const scriptPath = path.join(ROOT, "assets", "js", "owner-pricing-editor.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = {
    console,
    Intl,
    JSON,
    Date,
    Request,
    Response,
    document,
    fetch: fetchImpl || (async (url) => {
      if (String(url).includes("/data/products.json")) {
        return createJsonResponse(products);
      }
      return createJsonResponse({ ok: true });
    }),
    globalThis: null
  };
  context.globalThis = context;
  context.confirm = (message) => {
    confirmMessages.push(String(message));
    return harness.confirmResponse;
  };
  vm.runInNewContext(script, context, { filename: scriptPath });

  const harness = {
    buttons,
    confirmMessages,
    confirmResponse: true,
    fields,
    flush,
    inputs
  };
  return harness;
}

function createDocument() {
  const byId = new Map();
  return {
    cookie: "",
    createElement(tagName) {
      return createElement(tagName);
    },
    getElementById(id) {
      return byId.get(id) || null;
    },
    register(id, element) {
      byId.set(id, element);
    }
  };
}

function createElement(tagName = "div") {
  return {
    checked: false,
    children: [],
    className: "",
    dataset: {},
    hidden: false,
    innerHTML: "",
    listeners: new Map(),
    tagName: String(tagName || "div").toUpperCase(),
    textContent: "",
    value: "",
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    append(child) {
      this.children.push(child);
    },
    click() {
      const handler = this.listeners.get("click");
      if (handler) {
        handler({ currentTarget: this, preventDefault() {} });
      }
    },
    dispatch(type) {
      const handler = this.listeners.get(type);
      if (handler) {
        handler({ currentTarget: this, preventDefault() {} });
      }
    },
    replaceChildren(...children) {
      this.children = children;
    }
  };
}

function createInput(value) {
  const element = createElement("input");
  element.value = value;
  return element;
}

function createCheckbox(checked) {
  const element = createElement("input");
  element.checked = checked;
  return element;
}

function createButton() {
  return createElement("button");
}

function createJsonResponse(payload, status = 200) {
  return {
    async json() {
      return payload;
    },
    ok: status >= 200 && status < 300,
    status
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
