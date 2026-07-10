const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  await testIntakeLabelsAndHelperText();
  await testIntakeModeSpecificLabels();
  await testExistingListingDraftRestoresAfterReload();
  await testExistingListingPublishOmitsUndefinedSeriesFields();
  await testExistingListingSuccessfulUpdateReturnsToPicker();
  await testIntakeReviewAndDiscardConfirmation();
  await testNonJsonPublishErrorsShowHttpDetails();
  console.log("Owner intake UI tests passed.");
}

async function testIntakeLabelsAndHelperText() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  assert.match(html, /Creating New Product/, "Product intake should show a clear new-product mode indicator.");
  assert.match(html, />Check New Listing</, "Product intake should expose a Check New Listing action.");
  assert.match(html, />Review New Product</, "Product intake should expose a Review New Product action.");
  assert.match(html, />Publish New Product</, "Product intake should expose a Publish New Product action.");
  assert.match(html, />Clear New Product Form</, "Product intake should expose a Clear New Product Form action.");
  assert.match(html, /Checks the form for missing or invalid information and refreshes advisory suggestions\. Does not save changes\./, "Product intake should explain the check action.");
  assert.match(html, /Shows the generated product data and file plan so you can confirm exactly what will be published\./, "Product intake should explain the review action.");
  assert.match(html, /Discards unsaved work from this form only\. Published data is not affected\./, "Product intake should explain the discard action.");
  assert.match(html, /aria-describedby="intake-check-help"/, "Product intake actions should expose accessible helper text.");
  assert.doesNotMatch(html, /Analyze Listing|Publish Product|Reset Form/, "Product intake should not keep the vague old action labels.");
}

async function testIntakeModeSpecificLabels() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Agency", "Loading an existing product should switch the prominent mode indicator.");
  assert.match(harness.outputs.outputHeading.textContent, /Review Listing Changes/, "Existing-listing mode should use a review heading for updates.");
  assert.equal(harness.buttons.analyze.textContent, "Check Existing Listing", "Existing-listing mode should relabel the check action.");
  assert.equal(harness.buttons.review.textContent, "Review Listing Changes", "Existing-listing mode should relabel the review action.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Existing-listing mode should relabel the publish action.");
  assert.equal(harness.buttons.reset.textContent, "Discard Listing Changes", "Existing-listing mode should relabel the discard action.");
  assert.match(harness.outputs.editMode.textContent, /Editing existing listing: Agency/i, "Existing-listing mode should explain that the owner is updating a current listing.");
}

async function testIntakeReviewAndDiscardConfirmation() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.buttons.review.click();
  assert.match(harness.outputs.status.textContent, /Review ready\./, "Review should clearly stay in a pre-publish state.");

  harness.confirmResponse = false;
  harness.buttons.reset.click();
  assert.equal(harness.confirmMessages.length, 1, "Discarding unsaved intake edits should require confirmation.");
  assert.equal(harness.fields.shortDescription.value, "Updated preview copy", "Declining discard should keep unsaved edits intact.");

  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.confirmResponse = true;
  harness.buttons.reset.click();
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Creating New Product", "Accepting discard should return the intake to new-product mode.");
  assert.equal(harness.fields.title.value, "", "Accepting discard should clear the form.");
  assert.match(harness.outputs.status.textContent, /Published data was not changed\./, "Discard confirmation should clearly state that published data was not changed.");
}

async function testExistingListingDraftRestoresAfterReload() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();

  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");
  harness.buttons.analyze.click();
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Checking an existing listing must not fall back to the new-product publish action.");
  assert.equal(harness.fields.slug.value, "ringbound", "Checking an existing listing must preserve the loaded slug.");
  const generatedBeforeReload = JSON.parse(harness.outputs.json.value);
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Ringbound", "Editing Ringbound should stay in existing-listing mode before reload.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Editing Ringbound should not offer a new-product publish action.");
  assert.equal(generatedBeforeReload.productLineSlug, "other-games-and-experiments", "Editing an existing listing should preserve the original product-line slug when the visible label is unchanged.");
  assert.equal(generatedBeforeReload.priceCents, null, "Editing an existing listing should not convert an empty regular price into zero cents.");
  assert.equal(generatedBeforeReload.salePriceCents, null, "Editing an existing listing should not convert an empty sale price into zero cents.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedBeforeReload, "series"), false, "Editing an existing listing should not invent empty series fields.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedBeforeReload, "seriesSlug"), false, "Editing an existing listing should not invent empty series slug fields.");

  const reloadedHarness = createHarness({
    sessionStorageStore: harness.sessionStorageStore
  });
  await reloadedHarness.flush();
  const generatedAfterReload = JSON.parse(reloadedHarness.outputs.json.value);

  assert.equal(reloadedHarness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Ringbound", "Reloading should restore the loaded Ringbound listing.");
  assert.equal(reloadedHarness.buttons.publish.textContent, "Update Existing Listing", "A restored existing listing must not show the new-product publish action.");
  assert.equal(reloadedHarness.buttons.reset.textContent, "Discard Listing Changes", "A restored existing listing must keep the existing-listing discard action.");
  assert.equal(reloadedHarness.fields.title.value, "Ringbound", "Reloading should preserve the loaded title.");
  assert.equal(reloadedHarness.fields.slug.value, "ringbound", "Reloading should preserve the loaded slug.");
  assert.equal(reloadedHarness.fields.pageCount.value, "12", "Reloading should preserve the unsaved page-count edit.");
  assert.match(reloadedHarness.outputs.status.textContent, /Restored Ringbound for editing after the page was reloaded\./, "Reloading should explain why the existing listing remained active.");
  assert.equal(reloadedHarness.api.hasUnsavedChanges(), true, "Reloading should preserve the unsaved-changes baseline.");
  assert.equal(reloadedHarness.api.validateRequiredFields().length, 0, "Reloading should not fall back to new-product validation errors for a restored existing listing.");
  assert.equal(generatedAfterReload.productLineSlug, "other-games-and-experiments", "Reloading should preserve the original product-line slug.");
  assert.equal(generatedAfterReload.priceCents, null, "Reloading should preserve an empty regular price as null cents.");
  assert.equal(generatedAfterReload.salePriceCents, null, "Reloading should preserve an empty sale price as null cents.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedAfterReload, "series"), false, "Reloading should not invent empty series fields.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedAfterReload, "seriesSlug"), false, "Reloading should not invent empty series slug fields.");

  reloadedHarness.buttons.review.click();
  assert.match(reloadedHarness.outputs.status.textContent, /Review ready\./, "Reviewing the restored Ringbound draft should still work.");
  assert.equal(reloadedHarness.buttons.publish.textContent, "Update Existing Listing", "Reviewing the restored draft must not relabel the publish action.");
}

async function testExistingListingPublishOmitsUndefinedSeriesFields() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();
  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");

  await harness.buttons.publish.click();
  await harness.flush();

  assert.ok(harness.lastPublishFormData, "Existing-listing publish should submit FormData.");
  assert.equal(harness.lastPublishFormData.get("series"), "", "Existing-listing publish should submit an empty series field instead of the string \"undefined\".");
  assert.equal(harness.lastPublishFormData.get("seriesSlug"), "", "Existing-listing publish should submit an empty series slug instead of the string \"undefined\".");
}

async function testExistingListingSuccessfulUpdateReturnsToPicker() {
  const harness = createHarness();
  const deferred = createDeferred();
  harness.mockPublishResponse = deferred.promise;
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();
  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");

  harness.buttons.publish.click();
  await harness.flush();

  assert.equal(harness.buttons.publish.textContent, "Updating...", "Existing-listing updates should show an Updating button state while the request is in flight.");
  assert.equal(harness.buttons.publish.disabled, true, "Existing-listing updates should disable the update button while the request is in flight.");
  assert.match(harness.outputs.status.textContent, /waiting for the existing-listing update workflow to finish/i, "Existing-listing updates should show an in-progress status.");

  deferred.resolve(createJsonResponse({
    message: "Files uploaded and the GitHub rebuild workflow was accepted.",
    ok: true,
    pending: true,
    runUrl: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/123"
  }, 202));
  await harness.flush();

  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Creating New Product", "A successful existing-listing update should close the editor and return to the picker state.");
  assert.equal(harness.fields.existingSelect.value, "", "A successful existing-listing update should clear the loaded listing selection.");
  assert.equal(harness.fields.title.value, "", "A successful existing-listing update should clear the form fields.");
  assert.equal(harness.fields.slug.value, "", "A successful existing-listing update should clear the loaded slug.");
  assert.equal(harness.buttons.publish.textContent, "Publish New Product", "A successful existing-listing update should restore the default publish action after returning to the picker.");
  assert.equal(harness.buttons.publish.disabled, false, "A successful existing-listing update should re-enable the publish button.");
  assert.match(harness.outputs.status.textContent, /Ringbound updated successfully\./, "A successful existing-listing update should show a clear success confirmation.");
  assert.match(harness.outputs.status.textContent, /back at the listing picker/i, "A successful existing-listing update should explain that the editor closed and returned to the picker.");
}

async function testNonJsonPublishErrorsShowHttpDetails() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();
  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.mockPublishResponse = createTextResponse("<!DOCTYPE html><html><body><h1>Failure</h1><p>Origin publish failed hard.</p></body></html>", 500, {
    "content-type": "text/html; charset=utf-8"
  });

  await harness.buttons.publish.click();
  await harness.flush();

  assert.match(harness.outputs.status.textContent, /HTTP 500/, "Non-JSON publish failures should include the HTTP status.");
  assert.match(harness.outputs.status.textContent, /text\/html/, "Non-JSON publish failures should include the response content type.");
  assert.match(harness.outputs.status.textContent, /Failure Origin publish failed hard/i, "Non-JSON publish failures should include a safe body summary.");
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Agency", "Failed existing-listing updates should keep the editor open.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Failed existing-listing updates should restore the update button label.");
  assert.equal(harness.buttons.publish.disabled, false, "Failed existing-listing updates should re-enable the update button.");
}

function createHarness(options = {}) {
  class FakeHTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName || "div").toUpperCase();
      this.checked = false;
      this.children = [];
      this.className = "";
      this.dataset = {};
      this.disabled = false;
      this.files = [];
      this.hidden = false;
      this.innerHTML = "";
      this.listeners = new Map();
      this.placeholder = "";
      this.src = "";
      this.textContent = "";
      this.type = this.tagName === "TEXTAREA" ? "textarea" : "";
      this._value = "";
      Object.defineProperty(this, "value", {
        get: () => this._value,
        set: (nextValue) => {
          this._value = nextValue === null || nextValue === undefined ? "" : String(nextValue);
        }
      });
      this.value = "";
    }

    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }

    append(child) {
      this.children.push(child);
    }

    click() {
      const handler = this.listeners.get("click");
      if (handler) {
        handler({ currentTarget: this, preventDefault() {}, target: this });
      }
    }

    dispatch(type) {
      const handler = this.listeners.get(type);
      if (handler) {
        handler({ currentTarget: this, preventDefault() {}, target: this });
      }
    }

    replaceChildren(...children) {
      this.children = children;
    }
  }

  const byId = new Map();
  const allElements = [];
  const register = (id, element) => {
    element.id = id;
    byId.set(id, element);
    allElements.push(element);
    return element;
  };
  const createElement = (tagName = "div") => new FakeHTMLElement(tagName);
  const createInput = (value = "", type = "text") => {
    const element = createElement("input");
    element.type = type;
    element.value = value;
    return element;
  };
  const createFileInput = () => {
    const element = createInput("", "file");
    element.files = [];
    return element;
  };
  const createCheckbox = (checked = false) => {
    const element = createInput("", "checkbox");
    element.checked = checked;
    return element;
  };

  const document = {
    cookie: "trg_owner_csrf=test-token",
    createElement,
    getElementById(id) {
      return byId.get(id) || null;
    },
    querySelectorAll() {
      return allElements;
    }
  };
  const sessionStorageStore = options.sessionStorageStore || new Map();
  const sessionStorage = {
    getItem(key) {
      return sessionStorageStore.has(key) ? sessionStorageStore.get(key) : null;
    },
    removeItem(key) {
      sessionStorageStore.delete(key);
    },
    setItem(key, value) {
      sessionStorageStore.set(key, String(value));
    }
  };

  const fields = {
    existingSelect: register("product-existing-select", createElement("select")),
    title: register("product-title", createInput("")),
    slug: register("product-slug", createInput("")),
    folder: register("product-folder", createInput("")),
    subtitle: register("product-subtitle", createInput("")),
    authors: register("product-authors", createInput("RV Sawyer")),
    publisher: register("product-publisher", createInput("Tobacco Road Games")),
    system: register("product-system", createInput("5E Compatible")),
    line: register("product-line", createInput("Fifth Edition Fantasy Roleplaying")),
    series: register("product-series", createElement("select")),
    format: register("product-format", createInput("PDF")),
    pageCount: register("product-page-count", createInput("24", "number")),
    price: register("product-price", createInput("4.99")),
    salePrice: register("product-sale-price", createInput("")),
    currency: register("product-currency", createInput("USD")),
    saleEnabled: register("product-sale-enabled", createCheckbox(false)),
    status: register("product-status", createElement("select")),
    buyMode: register("product-buy-mode", createElement("select")),
    buyUrl: register("product-buy-url", createInput("")),
    shortDescription: register("product-short-description", createElement("textarea")),
    longDescription: register("product-long-description", createElement("textarea")),
    features: register("product-features", createElement("textarea")),
    tags: register("product-tags", createInput("")),
    fulfillmentNote: register("product-fulfillment-note", createElement("textarea")),
    creationMethod: register("product-creation-method", createElement("textarea")),
    legalNote: register("product-legal-note", createElement("textarea")),
    version: register("product-version", createInput("1.0")),
    releaseDate: register("product-release-date", createInput("", "date")),
    lastUpdated: register("product-last-updated", createInput("", "date")),
    relatedSelect: register("product-related-select", createElement("select")),
    relatedList: register("product-related-list", createElement("div")),
    coverFile: register("product-cover-file", createFileInput()),
    previewFile: register("product-preview-file", createFileInput()),
    pdfFile: register("product-pdf-file", createFileInput())
  };
  fields.status.value = "preview-available";
  fields.buyMode.value = "preview-only";
  fields.shortDescription.value = "Original preview copy";
  fields.longDescription.value = "Long description";
  fields.features.value = "Feature one";
  fields.fulfillmentNote.value = "Manual note";
  fields.creationMethod.value = "Human-authored by RV Sawyer.";

  const outputs = {
    editMode: register("product-edit-mode", createElement("p")),
    modeIndicatorTitle: register("product-mode-indicator-title", createElement("span")),
    modeIndicatorCopy: register("product-mode-indicator-copy", createElement("span")),
    outputHeading: register("intake-output-heading", createElement("h2")),
    outputCopy: register("intake-output-copy", createElement("p")),
    status: register("intake-status", createElement("p")),
    advisorPanel: register("advisor-panel", createElement("section")),
    advisorSummaryCopy: register("advisor-summary-copy", createElement("p")),
    advisorSuggestedPrice: register("advisor-suggested-price", createElement("span")),
    advisorSuggestedSalePrice: register("advisor-suggested-sale-price", createElement("span")),
    advisorConfidence: register("advisor-confidence", createElement("span")),
    advisorProductType: register("advisor-product-type", createElement("span")),
    advisorSeriesFit: register("advisor-series-fit", createElement("span")),
    advisorAudience: register("advisor-audience", createElement("span")),
    advisorTags: register("advisor-tags-output", createElement("textarea")),
    advisorCrossSells: register("advisor-cross-sells-output", createElement("textarea")),
    advisorReasoningList: register("advisor-reasoning-list", createElement("ol")),
    advisorJson: register("advisor-json", createElement("textarea")),
    json: register("generated-json", createElement("textarea")),
    checklist: register("asset-checklist", createElement("pre")),
    assetFolder: register("asset-folder-output", createElement("p")),
    assetFileList: register("asset-file-list", createElement("div")),
    previewStatus: register("preview-status", createElement("span")),
    previewTitle: register("preview-title", createElement("h3")),
    previewSubtitle: register("preview-subtitle", createElement("p")),
    previewCopy: register("preview-copy", createElement("p")),
    previewCoverImage: register("preview-cover-image", createElement("img"))
  };

  const buttons = {
    analyze: register("analyze-listing-button", createElement("button")),
    applyAdvisor: register("apply-advisor-button", createElement("button")),
    ignoreAdvisor: register("ignore-advisor-button", createElement("button")),
    loadExisting: register("product-existing-load", createElement("button")),
    addRelated: register("product-related-add", createElement("button")),
    publish: register("publish-button", createElement("button")),
    review: register("review-listing-button", createElement("button")),
    reset: register("reset-intake-button", createElement("button"))
  };

  register("intake-check-label", createElement("strong"));
  register("intake-check-help", createElement("p"));
  register("intake-review-label", createElement("strong"));
  register("intake-review-help", createElement("p"));
  register("intake-publish-label", createElement("strong"));
  register("intake-publish-help", createElement("p"));
  register("intake-reset-label", createElement("strong"));
  register("intake-reset-help", createElement("p"));

  const products = [
    {
      buyMode: "preview-only",
      buyUrl: "",
      coverImage: "/product-assets/agency/cover.webp",
      creationMethod: "Human-authored by RV Sawyer.",
      currency: "USD",
      features: ["Feature one"],
      fileList: ["Agency.pdf"],
      folder: "agency",
      format: ["PDF"],
      fulfillmentNote: "Manual note",
      gameSystem: "5E Compatible",
      gameSystemSlug: "5e-compatible",
      lastUpdated: "",
      legalNote: "",
      longDescription: "Long description",
      pageCount: 24,
      price: "4.99",
      previewImage: "/product-assets/agency/preview.webp",
      previewImages: [],
      productLine: "Fifth Edition Fantasy Roleplaying",
      productLineSlug: "fifth-edition-fantasy-roleplaying",
      relatedProducts: [],
      releaseDate: "",
      saleEnabled: false,
      salePrice: "",
      series: "",
      seriesSlug: "",
      shortDescription: "Original preview copy",
      slug: "agency",
      status: "preview-available",
      subtitle: "A test product",
      tags: ["Test"],
      title: "Agency",
      version: "1.0"
    },
    {
      buyMode: "preview-only",
      buyUrl: "",
      coverImage: "/product-assets/ringbound/cover.webp",
      creationMethod: "Human-authored by RV Sawyer.",
      currency: "USD",
      features: [],
      fileList: ["PDF details coming soon"],
      folder: "ringbound",
      format: ["PDF"],
      fulfillmentNote: "",
      gameSystem: "System TBD",
      gameSystemSlug: "system-tbd",
      lastUpdated: "2026-06-17",
      legalNote: "",
      longDescription: "Product summary coming soon.",
      pageCount: null,
      price: "",
      previewImage: "/product-assets/ringbound/preview.webp",
      previewImages: [],
      productLine: "Other Games & Experiments",
      productLineSlug: "other-games-and-experiments",
      relatedProducts: [],
      releaseDate: "2026-06-17",
      saleEnabled: false,
      salePrice: "",
      shortDescription: "Product summary coming soon.",
      slug: "ringbound",
      status: "preview-available",
      subtitle: "A Tobacco Road Games catalog preview",
      tags: ["Preview"],
      title: "Ringbound",
      version: "2026 catalog preview"
    }
  ];
  const intakeMap = {
    products: [
      {
        folder: "agency",
        slug: "agency"
      },
      {
        folder: "ringbound",
        slug: "ringbound"
      }
    ]
  };

  const confirmMessages = [];
  const harness = {
    buttons,
    confirmMessages,
    confirmResponse: true,
    fields,
    flush,
    lastPublishFormData: null,
    mockPublishResponse: createJsonResponse({
      message: "Published."
    }),
    outputs,
    sessionStorageStore
  };

  const context = {
    Date,
    FormData,
    HTMLElement: FakeHTMLElement,
    JSON,
    URL: {
      createObjectURL() {
        return "blob:cover";
      },
      revokeObjectURL() {}
    },
    console,
    confirm(message) {
      confirmMessages.push(String(message));
      return harness.confirmResponse;
    },
    document,
    fetch: async (url, options = {}) => {
      if (String(url).includes("/data/products.json")) {
        return createJsonResponse(products);
      }
      if (String(url).includes("/data/product-intake-map.json")) {
        return createJsonResponse(intakeMap);
      }
      if (String(url).includes("/owner/api/publish")) {
        harness.lastPublishFormData = options.body || null;
        return harness.mockPublishResponse;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    globalThis: null,
    sessionStorage,
    setTimeout,
    window: {
      location: {
        assign() {}
      },
      sessionStorage,
      setTimeout
    }
  };
  context.globalThis = context;
  context.TRGProductAdvisor = {
    analyzeProductListing() {
      return {
        audience: ["GMs"],
        price_confidence: 0.8,
        product_type: "Guide",
        reasoning: ["Fixture reasoning"],
        series_fit: "",
        suggested_cross_sells: [],
        suggested_price: 4.99,
        suggested_sale_price: 2.99,
        suggested_tags: ["Test"]
      };
    }
  };

  const scriptPath = path.join(ROOT, "assets", "js", "product-intake.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  vm.runInNewContext(script, context, { filename: scriptPath });
  harness.api = context.TRGProductIntake;

  return harness;
}

function createJsonResponse(payload, status = 200) {
  return {
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : "";
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
    ok: status >= 200 && status < 300,
    status
  };
}

function createTextResponse(payload, status = 200, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );

  return {
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name || "").toLowerCase()) || "";
      }
    },
    async text() {
      return String(payload);
    },
    ok: status >= 200 && status < 300,
    status
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
