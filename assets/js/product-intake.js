(() => {
  const CART_BUY_MODE = "cart";
  const CART_BUY_URL_PLACEHOLDER = "No buy URL needed for cart products.";
  const DISCARD_LISTING_CHANGES_MESSAGE = "Discard unsaved work? Any unpublished listing changes will be lost.";
  const EXISTING_LISTING_DRAFT_KEY = "trg_owner_existing_listing_draft_v1";
  const statusLabels = {
    "available-direct": "Available Direct",
    "coming-soon": "Coming Soon",
    "preview-available": "Preview Available",
    "preview-only": "Preview Only",
    "revised-edition-pending": "Revised Edition Pending",
    "legacy-edition": "Legacy Edition",
    "legacy-not-for-sale": "Legacy Not For Sale",
    retired: "Retired",
    "free-download": "Free Download",
    "pay-what-you-want": "Pay What You Want"
  };

  const fields = {
    existingSelect: document.getElementById("product-existing-select"),
    title: document.getElementById("product-title"),
    slug: document.getElementById("product-slug"),
    folder: document.getElementById("product-folder"),
    subtitle: document.getElementById("product-subtitle"),
    authors: document.getElementById("product-authors"),
    publisher: document.getElementById("product-publisher"),
    system: document.getElementById("product-system"),
    line: document.getElementById("product-line"),
    series: document.getElementById("product-series"),
    format: document.getElementById("product-format"),
    pageCount: document.getElementById("product-page-count"),
    price: document.getElementById("product-price"),
    salePrice: document.getElementById("product-sale-price"),
    currency: document.getElementById("product-currency"),
    saleEnabled: document.getElementById("product-sale-enabled"),
    status: document.getElementById("product-status"),
    buyMode: document.getElementById("product-buy-mode"),
    buyUrl: document.getElementById("product-buy-url"),
    shortDescription: document.getElementById("product-short-description"),
    longDescription: document.getElementById("product-long-description"),
    features: document.getElementById("product-features"),
    tags: document.getElementById("product-tags"),
    fulfillmentNote: document.getElementById("product-fulfillment-note"),
    creationMethod: document.getElementById("product-creation-method"),
    legalNote: document.getElementById("product-legal-note"),
    version: document.getElementById("product-version"),
    releaseDate: document.getElementById("product-release-date"),
    lastUpdated: document.getElementById("product-last-updated"),
    relatedSelect: document.getElementById("product-related-select"),
    relatedList: document.getElementById("product-related-list"),
    coverFile: document.getElementById("product-cover-file"),
    previewFile: document.getElementById("product-preview-file"),
    pdfFile: document.getElementById("product-pdf-file")
  };

  const outputs = {
    editMode: document.getElementById("product-edit-mode"),
    modeIndicatorTitle: document.getElementById("product-mode-indicator-title"),
    modeIndicatorCopy: document.getElementById("product-mode-indicator-copy"),
    advisorPanel: document.getElementById("advisor-panel"),
    advisorSummaryCopy: document.getElementById("advisor-summary-copy"),
    advisorSuggestedPrice: document.getElementById("advisor-suggested-price"),
    advisorSuggestedSalePrice: document.getElementById("advisor-suggested-sale-price"),
    advisorConfidence: document.getElementById("advisor-confidence"),
    advisorProductType: document.getElementById("advisor-product-type"),
    advisorSeriesFit: document.getElementById("advisor-series-fit"),
    advisorAudience: document.getElementById("advisor-audience"),
    advisorTags: document.getElementById("advisor-tags-output"),
    advisorCrossSells: document.getElementById("advisor-cross-sells-output"),
    advisorReasoningList: document.getElementById("advisor-reasoning-list"),
    advisorJson: document.getElementById("advisor-json"),
    jsonPanel: document.getElementById("generated-json-panel"),
    json: document.getElementById("generated-json"),
    checklistPanel: document.getElementById("asset-checklist-panel"),
    checklist: document.getElementById("asset-checklist"),
    outputHeading: document.getElementById("intake-output-heading"),
    outputCopy: document.getElementById("intake-output-copy"),
    status: document.getElementById("intake-status"),
    assetFolder: document.getElementById("asset-folder-output"),
    assetFileList: document.getElementById("asset-file-list"),
    previewStatus: document.getElementById("preview-status"),
    previewTitle: document.getElementById("preview-title"),
    previewSubtitle: document.getElementById("preview-subtitle"),
    previewCopy: document.getElementById("preview-copy"),
    previewCoverImage: document.getElementById("preview-cover-image")
  };

  const buttons = {
    analyze: document.getElementById("analyze-listing-button"),
    applyAdvisor: document.getElementById("apply-advisor-button"),
    ignoreAdvisor: document.getElementById("ignore-advisor-button"),
    loadExisting: document.getElementById("product-existing-load"),
    addRelated: document.getElementById("product-related-add"),
    publish: document.getElementById("publish-button"),
    review: document.getElementById("review-listing-button"),
    reset: document.getElementById("reset-intake-button"),
    toggleJson: document.getElementById("toggle-generated-json"),
    toggleChecklist: document.getElementById("toggle-asset-checklist")
  };

  let coverObjectUrl = "";
  let slugTouched = false;
  let folderTouched = false;
  let publishBusy = false;
  let availableProducts = [];
  let selectedRelatedProducts = [];
  let loadedProductSlug = "";
  let loadedProductFolder = "";
  let loadedProductRecord = null;
  let latestAdvisorRun = null;
  let draftBaseline = "";

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const parseList = (value) =>
    String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const parseLines = (value) =>
    String(value || "")
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);

  const normalizeMoneyText = (value) =>
    String(value || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "");

  const parsePriceNumber = (value) => {
    const normalized = normalizeMoneyText(value);
    if (!normalized) {
      return null;
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const formatMoney = (value) =>
    value === null || value === undefined || Number.isNaN(value)
      ? ""
      : Number(value).toFixed(2);

  const formatListValue = (value) =>
    Array.isArray(value)
      ? value.join(", ")
      : String(value || "").trim();

  const setJsonVisibility = (visible) => {
    if (outputs.jsonPanel) {
      outputs.jsonPanel.hidden = !visible;
    }
    if (buttons.toggleJson) {
      buttons.toggleJson.textContent = visible ? "Hide JSON" : "View JSON";
      buttons.toggleJson.setAttribute("aria-expanded", visible ? "true" : "false");
    }
  };

  const setChecklistVisibility = (visible) => {
    if (outputs.checklistPanel) {
      outputs.checklistPanel.hidden = !visible;
    }
    if (buttons.toggleChecklist) {
      buttons.toggleChecklist.textContent = visible ? "Hide Asset Checklist" : "View Asset Checklist";
      buttons.toggleChecklist.setAttribute("aria-expanded", visible ? "true" : "false");
    }
  };

  const isEditingLoadedListing = () =>
    Boolean(loadedProductSlug);

  const getSessionStorage = () => {
    try {
      return globalThis.sessionStorage || globalThis.window?.sessionStorage || null;
    } catch {
      return null;
    }
  };

  const clearPersistedExistingListingDraft = () => {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    try {
      storage.removeItem(EXISTING_LISTING_DRAFT_KEY);
    } catch {}
  };

  const buildPersistedExistingListingDraft = () => {
    if (!isEditingLoadedListing()) {
      return null;
    }

    return {
      draft: {
        buyMode: fields.buyMode.value,
        buyUrl: fields.buyUrl.value,
        creationMethod: fields.creationMethod.value,
        currency: fields.currency.value,
        features: fields.features.value,
        folder: fields.folder.value,
        format: fields.format.value,
        fulfillmentNote: fields.fulfillmentNote.value,
        gameSystem: fields.system.value,
        lastUpdated: fields.lastUpdated.value,
        legalNote: fields.legalNote.value,
        line: fields.line.value,
        longDescription: fields.longDescription.value,
        pageCount: fields.pageCount.value,
        price: fields.price.value,
        releaseDate: fields.releaseDate.value,
        saleEnabled: fields.saleEnabled.checked,
        salePrice: fields.salePrice.value,
        selectedRelatedProducts: [...selectedRelatedProducts],
        series: fields.series.value,
        shortDescription: fields.shortDescription.value,
        slug: fields.slug.value,
        slugTouched,
        status: fields.status.value,
        subtitle: fields.subtitle.value,
        tags: fields.tags.value,
        title: fields.title.value,
        version: fields.version.value,
        folderTouched
      },
      existingSelectValue: fields.existingSelect?.value || loadedProductSlug,
      draftBaseline,
      loadedProductFolder,
      loadedProductRecord,
      loadedProductSlug,
      savedAt: new Date().toISOString(),
      version: 1
    };
  };

  const persistExistingListingDraft = () => {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }

    const payload = buildPersistedExistingListingDraft();
    if (!payload) {
      return;
    }

    try {
      storage.setItem(EXISTING_LISTING_DRAFT_KEY, JSON.stringify(payload));
    } catch {}
  };

  const readPersistedExistingListingDraft = () => {
    const storage = getSessionStorage();
    if (!storage) {
      return null;
    }

    try {
      const raw = storage.getItem(EXISTING_LISTING_DRAFT_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.loadedProductSlug || !parsed.draft) {
        clearPersistedExistingListingDraft();
        return null;
      }
      return parsed;
    } catch {
      clearPersistedExistingListingDraft();
      return null;
    }
  };

  const getModeLabels = () => isEditingLoadedListing()
    ? {
      checkButton: "Check Existing Listing",
      checkHelp: "Checks the form for missing or invalid information and refreshes advisory suggestions. Does not save changes.",
      editMode: `Editing existing listing: ${loadedProductRecord?.title || loadedProductSlug}. Load another listing to switch targets, or keep editing this one.`,
      modeCopy: "Publishing will update only this existing listing. Unchanged fields remain as they are in the source catalog.",
      modeTitle: `Editing Existing Listing: ${loadedProductRecord?.title || loadedProductSlug}`,
      outputCopy: "Check for missing or invalid information, then review the generated catalog entry and update plan before publishing changes.",
      outputHeading: "Review Listing Changes",
      publishButton: "Update Existing Listing",
      publishHelp: "Updates the existing listing, uploads only selected replacement files, rebuilds the store, and returns you to the listing picker after success.",
      publishLabel: "Update Existing Listing",
      resetButton: "Discard Listing Changes",
      resetHelp: "Discards unsaved edits for the loaded listing. Published data is not affected.",
      resetLabel: "Discard Listing Changes",
      reviewButton: "Review Listing Changes",
      reviewHelp: "Shows the generated product data and file plan so you can confirm exactly what will change before updating the listing.",
      reviewLabel: "Review Listing Changes"
    }
    : {
      checkButton: "Check New Listing",
      checkHelp: "Checks the form for missing or invalid information and refreshes advisory suggestions. Does not save changes.",
      editMode: "Creating a new listing. Load an existing one only when you intend to update a current product or replace selected files.",
      modeCopy: "Publishing will create a new listing from the form values and selected files.",
      modeTitle: "Creating New Product",
      outputCopy: "Check for missing or invalid information, then review the generated catalog entry and file plan before publishing.",
      outputHeading: "Review New Product",
      publishButton: "Publish New Product",
      publishHelp: "Creates a new listing, uploads the selected files, and rebuilds the store.",
      publishLabel: "Publish New Product",
      resetButton: "Clear New Product Form",
      resetHelp: "Clears unsaved work from the new-product form only. Published data is not affected.",
      resetLabel: "Clear New Product Form",
      reviewButton: "Review New Product",
      reviewHelp: "Shows the generated product data and file plan so you can confirm exactly what will be published.",
      reviewLabel: "Review New Product"
    };

  const requiresFullAssetSet = () => {
    if (!isEditingLoadedListing()) {
      return true;
    }

    const currentSlug = fields.slug.value.trim() || slugify(fields.title.value);
    const currentFolder = fields.folder.value.trim() || currentSlug;
    return currentSlug !== loadedProductSlug || currentFolder !== loadedProductFolder;
  };

  const updateActionLabels = () => {
    const labels = getModeLabels();
    if (outputs.editMode) {
      outputs.editMode.textContent = labels.editMode;
    }
    if (outputs.modeIndicatorTitle) {
      outputs.modeIndicatorTitle.textContent = labels.modeTitle;
    }
    if (outputs.modeIndicatorCopy) {
      outputs.modeIndicatorCopy.textContent = labels.modeCopy;
    }
    if (outputs.outputHeading) {
      outputs.outputHeading.textContent = labels.outputHeading;
    }
    if (outputs.outputCopy) {
      outputs.outputCopy.textContent = labels.outputCopy;
    }

    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) {
        node.textContent = value;
      }
    };

    if (buttons.analyze) {
      buttons.analyze.textContent = labels.checkButton;
    }
    if (buttons.review) {
      buttons.review.textContent = labels.reviewButton;
    }
    if (buttons.publish) {
      buttons.publish.textContent = labels.publishButton;
    }
    if (buttons.reset) {
      buttons.reset.textContent = labels.resetButton;
    }

    setText("intake-check-label", labels.checkButton);
    setText("intake-check-help", labels.checkHelp);
    setText("intake-review-label", labels.reviewLabel);
    setText("intake-review-help", labels.reviewHelp);
    setText("intake-publish-label", labels.publishLabel);
    setText("intake-publish-help", labels.publishHelp);
    setText("intake-reset-label", labels.resetLabel);
    setText("intake-reset-help", labels.resetHelp);
  };

  const captureDraftState = () => JSON.stringify({
    buyMode: fields.buyMode.value,
    buyUrl: fields.buyUrl.value,
    coverFileName: fields.coverFile.files[0]?.name || "",
    currency: fields.currency.value,
    folder: fields.folder.value,
    format: fields.format.value,
    fulfillmentNote: fields.fulfillmentNote.value,
    gameSystem: fields.system.value,
    lastUpdated: fields.lastUpdated.value,
    legalNote: fields.legalNote.value,
    line: fields.line.value,
    longDescription: fields.longDescription.value,
    pageCount: fields.pageCount.value,
    pdfFileName: fields.pdfFile.files[0]?.name || "",
    previewFileName: fields.previewFile.files[0]?.name || "",
    price: fields.price.value,
    relatedProducts: [...selectedRelatedProducts],
    releaseDate: fields.releaseDate.value,
    saleEnabled: fields.saleEnabled.checked,
    salePrice: fields.salePrice.value,
    series: fields.series.value,
    shortDescription: fields.shortDescription.value,
    slug: fields.slug.value,
    status: fields.status.value,
    subtitle: fields.subtitle.value,
    tags: fields.tags.value,
    title: fields.title.value,
    version: fields.version.value
  });

  const markDraftBaseline = () => {
    draftBaseline = captureDraftState();
  };

  const hasUnsavedChanges = () => captureDraftState() !== draftBaseline;

  const confirmDiscardChanges = () => {
    const confirmFn = globalThis.confirm;
    if (typeof confirmFn !== "function") {
      return true;
    }
    return confirmFn(DISCARD_LISTING_CHANGES_MESSAGE);
  };

  const findAvailableProduct = (slug) =>
    availableProducts.find((product) => product.slug === slug) || null;

  const isCartModeSelected = () => fields.buyMode.value === CART_BUY_MODE;

  const syncBuyModeUi = () => {
    const cartMode = isCartModeSelected();
    if (cartMode) {
      fields.buyUrl.value = "";
      fields.buyUrl.disabled = true;
      fields.buyUrl.placeholder = CART_BUY_URL_PLACEHOLDER;
      return;
    }

    fields.buyUrl.disabled = false;
    fields.buyUrl.placeholder = "https://...";
  };

  const updateEditModeCopy = () => {
    updateActionLabels();
    if (!outputs.editMode || !isEditingLoadedListing()) {
      return;
    }

    const renameWarning = requiresFullAssetSet()
      ? " Because the slug or folder changed, the next update needs a full replacement set of cover, preview, and PDF files."
      : " Leave file inputs blank to keep the live assets, or choose only the replacement files you want to swap in.";
    outputs.editMode.textContent = `${getModeLabels().editMode}${renameWarning}`;
  };

  const formatConfidenceLabel = (value) => {
    if (value >= 0.8) {
      return `High (${Math.round(value * 100)}%)`;
    }
    if (value >= 0.6) {
      return `Medium (${Math.round(value * 100)}%)`;
    }
    return `Low (${Math.round(value * 100)}%)`;
  };

  const buildAdvisorInput = () => {
    const payload = buildPayload();
    return {
      author: "RV Sawyer",
      category: payload.productLine,
      coverImage: fields.coverFile.files[0]?.name || loadedProductRecord?.coverImage || "",
      current_price: payload.price,
      gameSystem: payload.gameSystem,
      interior_image_count: (loadedProductRecord?.previewImages?.length || 0) + (fields.previewFile.files[0] ? 1 : 0),
      long_description: payload.longDescription,
      page_count: payload.pageCount,
      pdf_file: fields.pdfFile.files[0]?.name || payload.fileList[0] || "",
      previewImages: loadedProductRecord?.previewImages || [],
      productLine: payload.productLine,
      series: payload.series,
      short_description: payload.shortDescription,
      slug: payload.slug,
      subtitle: payload.subtitle,
      system: payload.gameSystem,
      tags: payload.tags,
      title: payload.title,
      features: payload.features
    };
  };

  const clearAdvisorPanel = () => {
    latestAdvisorRun = null;
    outputs.advisorPanel.hidden = true;
    outputs.advisorSummaryCopy.textContent = "Tiny robot accountant, not dictator.";
    outputs.advisorReasoningList.replaceChildren();
    outputs.advisorTags.value = "";
    outputs.advisorCrossSells.value = "";
    outputs.advisorJson.value = "";
  };

  const renderAdvisorPanel = (advisorRun) => {
    outputs.advisorPanel.hidden = false;
    outputs.advisorSuggestedPrice.textContent = advisorRun.suggested_price === null ? "No price" : `$${formatMoney(advisorRun.suggested_price)}`;
    outputs.advisorSuggestedSalePrice.textContent = advisorRun.suggested_sale_price === null ? "No sale" : `$${formatMoney(advisorRun.suggested_sale_price)}`;
    outputs.advisorConfidence.textContent = formatConfidenceLabel(advisorRun.price_confidence);
    outputs.advisorProductType.textContent = advisorRun.product_type || "Not classified";
    outputs.advisorSeriesFit.textContent = advisorRun.series_fit || "No strong series fit";
    outputs.advisorAudience.textContent = advisorRun.audience.length ? advisorRun.audience.join(", ") : "No audience signal";
    outputs.advisorTags.value = advisorRun.suggested_tags.join(", ");
    outputs.advisorCrossSells.value = advisorRun.suggested_cross_sells.join(", ");
    outputs.advisorJson.value = JSON.stringify(advisorRun, null, 2);
    outputs.advisorSummaryCopy.textContent = advisorRun.suggested_sale_price === null
      ? "This is an advisory pass only. Nothing changes until you click Apply Suggestions."
      : "Suggested sale price is advisory too. Applying it fills the field, but it does not turn a sale on by itself.";

    outputs.advisorReasoningList.replaceChildren(
      ...advisorRun.reasoning.map((reason) => {
        const item = document.createElement("li");
        item.textContent = reason;
        return item;
      })
    );
  };

  const analyzeCurrentListing = () => {
    const validationErrors = validateRequiredFields();
    if (validationErrors.length) {
      clearAdvisorPanel();
      outputs.status.textContent = validationErrors.join(" ");
      return;
    }

    if (!globalThis.TRGProductAdvisor?.analyzeProductListing) {
      outputs.status.textContent = "Listing information looks valid so far. The pricing advisor is not available on this page right now.";
      return;
    }

    const advisorRun = globalThis.TRGProductAdvisor.analyzeProductListing(buildAdvisorInput(), {
      catalog: availableProducts
    });
    latestAdvisorRun = advisorRun;
    renderAdvisorPanel(advisorRun);
    outputs.status.textContent = "Listing information looks valid so far. Review the generated output and any advisory suggestions before publishing.";
  };

  const reviewCurrentListing = () => {
    const validationErrors = validateRequiredFields();
    if (validationErrors.length) {
      outputs.status.textContent = validationErrors.join(" ");
      return;
    }

    updatePreview();
    outputs.status.textContent = isEditingLoadedListing()
      ? "Review ready. No changes have been published yet. Confirm the listing update details below before you update the existing listing."
      : "Review ready. No changes have been published yet. Confirm the new product details below before you publish the listing.";
  };

  const applyAdvisorSuggestions = () => {
    if (!latestAdvisorRun) {
      outputs.status.textContent = `Run ${getModeLabels().checkButton} first.`;
      return;
    }

    fields.price.value = formatMoney(latestAdvisorRun.suggested_price);
    fields.salePrice.value = formatMoney(latestAdvisorRun.suggested_sale_price);

    if (latestAdvisorRun.series_fit) {
      fields.series.value = latestAdvisorRun.series_fit;
    }

    fields.tags.value = latestAdvisorRun.suggested_tags.join(", ");
    selectedRelatedProducts = [...latestAdvisorRun.suggested_cross_sells];
    syncRelatedPicker();
    updatePreview();
    outputs.status.textContent = "Advisor suggestions applied to the form. You can still edit every field.";
  };

  const updateRelatedSelectOptions = () => {
    if (!fields.relatedSelect) {
      return;
    }

    const currentSlug = (fields.slug.value.trim() || slugify(fields.title.value)).trim();
    const products = availableProducts
      .filter((product) => product.slug && product.slug !== currentSlug)
      .filter((product) => !selectedRelatedProducts.includes(product.slug));

    const previousValue = fields.relatedSelect.value;
    const placeholderLabel = availableProducts.length ? "Select a related product" : "No products available";
    const options = [
      `<option value="">${placeholderLabel}</option>`,
      ...products.map((product) => `<option value="${product.slug}">${product.title} (${product.slug})</option>`)
    ];

    fields.relatedSelect.innerHTML = options.join("");
    if (products.some((product) => product.slug === previousValue)) {
      fields.relatedSelect.value = previousValue;
    }
  };

  const renderSelectedRelatedProducts = () => {
    if (!fields.relatedList) {
      return;
    }

    fields.relatedList.replaceChildren();

    if (!selectedRelatedProducts.length) {
      const empty = document.createElement("p");
      empty.className = "intake-help";
      empty.textContent = "No related products selected yet.";
      fields.relatedList.append(empty);
      return;
    }

    selectedRelatedProducts.forEach((slug) => {
      const product = availableProducts.find((entry) => entry.slug === slug);
      const item = document.createElement("div");
      item.className = "intake-selection-item";

      const label = document.createElement("span");
      label.textContent = product ? `${product.title} (${product.slug})` : slug;
      item.append(label);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "button button--secondary";
      removeButton.dataset.relatedRemove = slug;
      removeButton.textContent = "Remove";
      item.append(removeButton);

      fields.relatedList.append(item);
    });
  };

  const syncRelatedPicker = () => {
    updateRelatedSelectOptions();
    renderSelectedRelatedProducts();
  };

  const addRelatedProduct = () => {
    const slug = fields.relatedSelect?.value || "";
    if (!slug || selectedRelatedProducts.includes(slug)) {
      return;
    }

    selectedRelatedProducts.push(slug);
    syncRelatedPicker();
    updatePreview();
  };

  const removeRelatedProduct = (slug) => {
    selectedRelatedProducts = selectedRelatedProducts.filter((entry) => entry !== slug);
    syncRelatedPicker();
    updatePreview();
  };

  async function loadAvailableProducts() {
    try {
      const [productsResponse, intakeResponse] = await Promise.all([
        fetch("/data/products.json", {
          cache: "no-store",
          credentials: "same-origin"
        }),
        fetch("/data/product-intake-map.json", {
          cache: "no-store",
          credentials: "same-origin"
        })
      ]);

      if (!productsResponse.ok || !intakeResponse.ok) {
        throw new Error("Product intake sources failed to load.");
      }

      const productsPayload = await productsResponse.json();
      const intakePayload = await intakeResponse.json();
      const intakeProducts = Array.isArray(intakePayload?.products) ? intakePayload.products : [];
      const intakeBySlug = new Map(
        intakeProducts.map((product) => [String(product.slug || "").trim(), product])
      );

      availableProducts = Array.isArray(productsPayload)
        ? productsPayload
          .map((product) => {
            const slug = String(product.slug || "").trim();
            const intakeProduct = intakeBySlug.get(slug) || {};
            return {
              buyMode: String(product.buyMode || "").trim(),
              buyUrl: String(product.buyUrl || "").trim(),
              coverImage: String(product.coverImage || "").trim(),
              creationMethod: String(product.creationMethod || "").trim(),
              currency: String(product.currency || "USD").trim() || "USD",
              features: Array.isArray(product.features) ? [...product.features] : [],
              fileList: Array.isArray(product.fileList) ? [...product.fileList] : [],
              folder: String(intakeProduct.folder || slug).trim() || slug,
              format: Array.isArray(product.format) ? [...product.format] : [],
              fulfillmentNote: String(product.fulfillmentNote || "").trim(),
              gameSystem: String(product.gameSystem || "").trim(),
              gameSystemSlug: String(product.gameSystemSlug || "").trim(),
              lastUpdated: String(product.lastUpdated || "").trim(),
              legalNote: String(product.legalNote || "").trim(),
              longDescription: String(product.longDescription || "").trim(),
              pageCount: product.pageCount ?? null,
              price: String(product.price || "").trim(),
              previewImage: String(product.previewImage || "").trim(),
              previewImages: Array.isArray(product.previewImages) ? [...product.previewImages] : [],
              productLine: String(product.productLine || "").trim(),
              productLineSlug: String(product.productLineSlug || "").trim(),
              relatedProducts: Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : [],
              releaseDate: String(product.releaseDate || "").trim(),
              saleEnabled: Boolean(product.saleEnabled),
              salePrice: String(product.salePrice || "").trim(),
              series: String(product.series || "").trim(),
              seriesSlug: String(product.seriesSlug || "").trim(),
              shortDescription: String(product.shortDescription || "").trim(),
              slug,
              status: String(product.status || "").trim(),
              subtitle: String(product.subtitle || "").trim(),
              tags: Array.isArray(product.tags) ? [...product.tags] : [],
              title: String(product.title || product.slug || "").trim(),
              version: String(product.version || "").trim()
            };
          })
          .filter((product) => product.slug && product.title)
          .sort((left, right) => left.title.localeCompare(right.title))
        : [];
    } catch {
      availableProducts = [];
    }

    if (fields.existingSelect) {
      const options = [
        `<option value="">${availableProducts.length ? "Select a listing to edit" : "No listings available"}</option>`,
        ...availableProducts.map((product) => `<option value="${product.slug}">${product.title} (${product.slug})</option>`)
      ];
      fields.existingSelect.innerHTML = options.join("");
    }

    syncRelatedPicker();
    updateEditModeCopy();
  }

  const buildPayload = () => {
    const title = fields.title.value.trim();
    const slug = fields.slug.value.trim() || slugify(title) || "untitled-product";
    const folder = fields.folder.value.trim() || slug;
    const gameSystem = fields.system.value.trim();
    const productLine = fields.line.value.trim();
    const series = fields.series.value.trim();
    const existingGameSystem = String(loadedProductRecord?.gameSystem || "").trim();
    const existingGameSystemSlug = String(loadedProductRecord?.gameSystemSlug || "").trim();
    const existingProductLine = String(loadedProductRecord?.productLine || "").trim();
    const existingProductLineSlug = String(loadedProductRecord?.productLineSlug || "").trim();
    const existingSeries = String(loadedProductRecord?.series || "").trim();
    const existingSeriesSlug = String(loadedProductRecord?.seriesSlug || "").trim();
    const pageCountRaw = fields.pageCount.value.trim();
    const priceRaw = normalizeMoneyText(fields.price.value);
    const priceCents = parsePriceNumber(priceRaw) === null ? null : Math.round(parsePriceNumber(priceRaw) * 100);
    const salePriceRaw = normalizeMoneyText(fields.salePrice.value);
    const salePriceCents = parsePriceNumber(salePriceRaw) === null ? null : Math.round(parsePriceNumber(salePriceRaw) * 100);
    const selectedPdfName = fields.pdfFile.files[0]?.name?.trim() || "";
    const fileList = selectedPdfName
      ? [selectedPdfName]
      : (isEditingLoadedListing() && !requiresFullAssetSet() && Array.isArray(loadedProductRecord?.fileList) && loadedProductRecord.fileList.length
        ? [...loadedProductRecord.fileList]
        : [`${title || "Untitled Product"}.pdf`]);

    const payload = {
      authorSlugs: ["rv-sawyer"],
      authors: ["RV Sawyer"],
      buyMode: fields.buyMode.value,
      buyUrl: fields.buyMode.value === CART_BUY_MODE ? "" : fields.buyUrl.value.trim(),
      creationMethod: fields.creationMethod.value.trim() || "Human-authored by RV Sawyer.",
      currency: fields.currency.value.trim() || "USD",
      features: parseLines(fields.features.value),
      fileList,
      folder,
      format: parseList(fields.format.value).length ? parseList(fields.format.value) : ["PDF"],
      fulfillmentNote: fields.fulfillmentNote.value.trim(),
      gameSystem,
      gameSystemSlug: isEditingLoadedListing() && gameSystem === existingGameSystem
        ? (existingGameSystemSlug || slugify(gameSystem))
        : slugify(gameSystem),
      lastUpdated: fields.lastUpdated.value,
      legalNote: fields.legalNote.value.trim(),
      longDescription: fields.longDescription.value.trim(),
      pageCount: pageCountRaw ? Number(pageCountRaw) : null,
      price: priceRaw,
      priceCents,
      productLine,
      productLineSlug: isEditingLoadedListing() && productLine === existingProductLine
        ? (existingProductLineSlug || slugify(productLine))
        : slugify(productLine),
      saleEnabled: fields.saleEnabled.checked,
      salePrice: salePriceRaw,
      salePriceCents,
      series,
      seriesSlug: isEditingLoadedListing() && series === existingSeries
        ? (existingSeriesSlug || (series ? slugify(series) : ""))
        : slugify(series),
      publisher: "Tobacco Road Games",
      relatedProducts: [...selectedRelatedProducts],
      releaseDate: fields.releaseDate.value,
      shortDescription: fields.shortDescription.value.trim(),
      slug,
      status: fields.status.value,
      statusLabel: statusLabels[fields.status.value] || "Unavailable",
      subtitle: fields.subtitle.value.trim(),
      tags: parseList(fields.tags.value),
      title,
      version: fields.version.value.trim() || "1.0"
    };

    if (!series) {
      delete payload.series;
    }
    if (!payload.seriesSlug) {
      delete payload.seriesSlug;
    }

    return payload;
  };

  const updatePreview = () => {
    const payload = buildPayload();
    outputs.previewStatus.textContent = payload.statusLabel;
    outputs.previewStatus.className = `status-badge status-badge--${payload.status}`;
    outputs.previewTitle.textContent = payload.title || "Untitled Product";
    outputs.previewSubtitle.textContent = payload.subtitle || "Subtitle will appear here.";
    outputs.previewCopy.textContent = payload.shortDescription || "Short description preview will appear here.";
    outputs.assetFolder.textContent = `R2 folder: ${payload.folder || "untitled-product"}`;
    outputs.json.value = `${JSON.stringify(payload, null, 2)}`;
    outputs.checklist.textContent = buildChecklist(payload);
    renderAssetFileList(payload);
    updateCoverPreview();
    persistExistingListingDraft();
  };

  function buildChecklist(payload) {
    const existingMode = isEditingLoadedListing();
    const requiresFiles = requiresFullAssetSet();

    return [
      `R2 folder: ${payload.folder}`,
      existingMode ? `Editing existing listing: ${loadedProductRecord?.title || loadedProductSlug}` : "Creating new listing",
      "",
      requiresFiles ? "Required uploaded files:" : "Optional replacement files:",
      requiresFiles
        ? "- One WebP cover image"
        : "- Cover WebP only if you want to replace the current live cover",
      requiresFiles
        ? "- One WebP preview image"
        : "- Preview WebP only if you want to replace the current live preview",
      requiresFiles
        ? "- One PDF product file"
        : "- Product PDF only if you want to replace the current private PDF",
      ...(existingMode && !requiresFiles
        ? ["", "Leave file inputs blank to preserve the current bucket assets."]
        : []),
      "",
      "Internal bucket object paths after publish:",
      `- ${payload.folder}/cover.webp`,
      `- ${payload.folder}/preview.webp`,
      `- ${payload.folder}/product.pdf`,
      "",
      "Published public asset paths:",
      `/product-assets/${payload.slug}/cover.webp`,
      `/product-assets/${payload.slug}/preview.webp`,
      "",
      "Repo publish path after upload:",
      "- Update shared folder map",
      "- Update data/product-intake-map.json",
      "- Update data/products.json",
      "- Run node scripts/build-store.js",
      "- Commit and push to main"
    ].join("\n");
  }

  function renderAssetFileList(payload) {
    const items = [
      ...payload.fileList,
      `${payload.folder}/cover.webp`,
      `${payload.folder}/preview.webp`,
      `${payload.folder}/product.pdf`,
      `/product-assets/${payload.slug}/cover.webp`,
      `/product-assets/${payload.slug}/preview.webp`
    ];

    outputs.assetFileList.replaceChildren(
      ...items.map((item) => {
        const chip = document.createElement("span");
        chip.textContent = item;
        return chip;
      })
    );
  }

  function updateCoverPreview() {
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = "";
    }

    if (fields.coverFile.files.length) {
      coverObjectUrl = URL.createObjectURL(fields.coverFile.files[0]);
      outputs.previewCoverImage.src = coverObjectUrl;
      outputs.previewCoverImage.alt = "Selected product cover preview";
      return;
    }

    if (loadedProductRecord?.coverImage) {
      outputs.previewCoverImage.src = loadedProductRecord.coverImage;
      outputs.previewCoverImage.alt = `${loadedProductRecord.title || "Current"} cover preview`;
      return;
    }

    outputs.previewCoverImage.src = "../assets/logo.png";
    outputs.previewCoverImage.alt = "Tobacco Road Games logo fallback";
  }

  function getCookie(name) {
    const cookies = document.cookie.split(";").map((entry) => entry.trim()).filter(Boolean);
    for (const cookie of cookies) {
      const separator = cookie.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const cookieName = cookie.slice(0, separator);
      if (cookieName === name) {
        return cookie.slice(separator + 1);
      }
    }
    return "";
  }

  function getSubmitProgressLabel() {
    return isEditingLoadedListing()
      ? "Updating..."
      : "Publishing...";
  }

  function formatPublishSuccessMessage(productTitle, responsePayload) {
    const liveNote = responsePayload.json.pending
      ? " The live store may take another minute to catch up."
      : "";
    const workflowNote = responsePayload.json.runUrl
      ? ` Workflow: ${responsePayload.json.runUrl}`
      : "";
    return `${productTitle} updated successfully. The editor is closed and you are back at the listing picker.${liveNote}${workflowNote}`;
  }

  async function publishProduct() {
    if (publishBusy) {
      return;
    }

    const missingTextErrors = validateRequiredFields();
    if (missingTextErrors.length) {
      outputs.status.textContent = missingTextErrors.join(" ");
      return;
    }

    const csrfToken = getCookie("trg_owner_csrf");
    if (!csrfToken) {
      outputs.status.textContent = "Your login security token is missing. Reload the page and sign in again if needed.";
      return;
    }

    publishBusy = true;
    buttons.publish.disabled = true;
    buttons.publish.textContent = getSubmitProgressLabel();
    outputs.status.textContent = isEditingLoadedListing()
      ? "Uploading any selected replacement files and waiting for the existing-listing update workflow to finish..."
      : "Uploading files and waiting for the new-listing publish workflow to finish...";

    try {
      const startedInExistingMode = isEditingLoadedListing();
      const payload = buildPayload();
      const formData = new FormData();
      formData.set("title", payload.title);
      formData.set("slug", payload.slug);
      formData.set("folder", payload.folder);
      formData.set("subtitle", payload.subtitle);
      formData.set("gameSystem", payload.gameSystem);
      formData.set("gameSystemSlug", payload.gameSystemSlug);
      formData.set("productLine", payload.productLine);
      formData.set("productLineSlug", payload.productLineSlug);
      formData.set("series", Object.prototype.hasOwnProperty.call(payload, "series") ? payload.series : "");
      formData.set("seriesSlug", Object.prototype.hasOwnProperty.call(payload, "seriesSlug") ? payload.seriesSlug : "");
      formData.set("format", payload.format.join(", "));
      formData.set("pageCount", payload.pageCount === null ? "" : String(payload.pageCount));
      formData.set("price", payload.price);
      formData.set("salePrice", payload.salePrice);
      formData.set("saleEnabled", payload.saleEnabled ? "true" : "false");
      formData.set("currency", payload.currency);
      formData.set("status", payload.status);
      formData.set("buyMode", payload.buyMode);
      formData.set("buyUrl", payload.buyUrl);
      formData.set("shortDescription", payload.shortDescription);
      formData.set("longDescription", payload.longDescription);
      formData.set("features", payload.features.join("\n"));
      formData.set("tags", payload.tags.join(", "));
      formData.set("fulfillmentNote", payload.fulfillmentNote);
      formData.set("creationMethod", payload.creationMethod);
      formData.set("legalNote", payload.legalNote);
      formData.set("version", payload.version);
      formData.set("releaseDate", payload.releaseDate);
      formData.set("lastUpdated", payload.lastUpdated);
      formData.set("relatedProducts", payload.relatedProducts.join(", "));

      if (fields.coverFile.files[0]) {
        formData.set("coverFile", fields.coverFile.files[0]);
      }
      if (fields.previewFile.files[0]) {
        formData.set("previewFile", fields.previewFile.files[0]);
      }
      if (fields.pdfFile.files[0]) {
        formData.set("productFile", fields.pdfFile.files[0]);
      }

      const response = await fetch("/owner/api/publish", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-CSRF-Token": csrfToken
        },
        body: formData,
        redirect: "manual"
      });

      const responsePayload = await readResponsePayload(response);

      if (response.status === 401 || response.status === 403) {
        outputs.status.textContent = responsePayload.json.error || "Your owner access session is no longer valid. Reloading the protected route...";
        window.setTimeout(() => {
          window.location.assign("/owner/");
        }, 600);
        return;
      }

      if (!response.ok) {
        outputs.status.textContent = responsePayload.json.error || formatUnexpectedResponseError("Publish", responsePayload);
        return;
      }

      if (startedInExistingMode) {
        const updatedTitle = loadedProductRecord?.title || payload.title || payload.slug || "The listing";
        resetFormToDefaults();
        outputs.status.textContent = formatPublishSuccessMessage(updatedTitle, responsePayload);
        if (typeof fields.existingSelect?.focus === "function") {
          fields.existingSelect.focus();
        }
        return;
      }

      outputs.status.textContent = responsePayload.json.runUrl
        ? `${responsePayload.json.message} Workflow: ${responsePayload.json.runUrl}`
        : responsePayload.json.message;
      markDraftBaseline();
      persistExistingListingDraft();
    } catch {
      outputs.status.textContent = "The publish request failed before the server could answer. Please try again.";
    } finally {
      publishBusy = false;
      buttons.publish.disabled = false;
      updateActionLabels();
    }
  }

  function validateRequiredFields() {
    const errors = [];
    const requireFiles = requiresFullAssetSet();
    const requiredTextFields = [
      [fields.title, "Title"],
      [fields.slug, "Slug"],
      [fields.folder, "R2 folder name"],
      [fields.subtitle, "Subtitle"],
      [fields.system, "Game system"],
      [fields.line, "Product line"],
      [fields.shortDescription, "Short description"],
      [fields.longDescription, "Long description"]
    ];

    for (const [field, label] of requiredTextFields) {
      if (!field.value.trim()) {
        errors.push(`${label} is required.`);
      }
    }

    if (requireFiles && !fields.coverFile.files.length) {
      errors.push("A cover WebP is required.");
    }
    if (requireFiles && !fields.previewFile.files.length) {
      errors.push("A preview WebP is required.");
    }
    if (requireFiles && !fields.pdfFile.files.length) {
      errors.push("A product PDF is required.");
    }

    if (fields.buyMode.value === CART_BUY_MODE) {
      if (fields.status.value !== "available-direct") {
        errors.push("Cart products must use Available Direct status.");
      }
      const parsedPrice = parsePriceNumber(fields.price.value);
      if (parsedPrice === null || parsedPrice <= 0) {
        errors.push("Cart products require a positive price.");
      }
    }

    return errors;
  }

  async function readResponsePayload(response) {
    let rawText = "";
    try {
      rawText = await response.text();
    } catch {
      rawText = "";
    }

    let json = {};
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        json = parsed;
      }
    } catch {
      json = {};
    }

    return {
      bodySummary: summarizeResponseBody(rawText),
      contentType: String(response.headers?.get?.("content-type") || "unknown").toLowerCase(),
      json,
      status: Number(response.status || 0)
    };
  }

  function formatUnexpectedResponseError(actionLabel, payload) {
    const statusText = payload.status ? `HTTP ${payload.status}` : "an unknown HTTP status";
    const contentType = payload.contentType || "unknown";
    const summary = payload.bodySummary || "No response body was returned.";
    return `${actionLabel} failed with ${statusText}. Response type: ${contentType}. Response summary: ${summary}`;
  }

  function summarizeResponseBody(value) {
    const cleaned = String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      return "";
    }

    return cleaned.length > 180
      ? `${cleaned.slice(0, 177)}...`
      : cleaned;
  }

  function updateAutoFields() {
    if (!slugTouched && fields.title.value.trim()) {
      fields.slug.value = slugify(fields.title.value);
    }

    if (!folderTouched && fields.slug.value.trim()) {
      fields.folder.value = fields.slug.value.trim();
    }

    updateRelatedSelectOptions();
    updateEditModeCopy();
    updatePreview();
  }

  function loadExistingProductIntoForm() {
    const slug = fields.existingSelect?.value || "";
    if (!slug) {
      outputs.status.textContent = "Pick a listing first.";
      return;
    }

    const product = findAvailableProduct(slug);
    if (!product) {
      outputs.status.textContent = "That listing could not be loaded from the current catalog data.";
      return;
    }

    loadedProductSlug = product.slug;
    loadedProductFolder = product.folder || product.slug;
    loadedProductRecord = product;

    fields.title.value = product.title || "";
    fields.slug.value = product.slug || "";
    fields.folder.value = product.folder || product.slug || "";
    fields.subtitle.value = product.subtitle || "";
    fields.authors.value = "RV Sawyer";
    fields.publisher.value = "Tobacco Road Games";
    fields.system.value = product.gameSystem || "";
    fields.line.value = product.productLine || "";
    fields.series.value = product.series || "";
    fields.format.value = formatListValue(product.format) || "PDF";
    fields.pageCount.value = product.pageCount ?? "";
    fields.price.value = product.price || "";
    fields.salePrice.value = product.salePrice || "";
    fields.currency.value = product.currency || "USD";
    fields.saleEnabled.checked = Boolean(product.saleEnabled);
    fields.status.value = product.status || "coming-soon";
    fields.buyMode.value = product.buyMode || "coming-soon";
    fields.buyUrl.value = product.buyUrl || "";
    syncBuyModeUi();
    fields.shortDescription.value = product.shortDescription || "";
    fields.longDescription.value = product.longDescription || "";
    fields.features.value = Array.isArray(product.features) ? product.features.join("\n") : "";
    fields.tags.value = Array.isArray(product.tags) ? product.tags.join(", ") : "";
    fields.fulfillmentNote.value = product.fulfillmentNote || "";
    fields.creationMethod.value = product.creationMethod || "Human-authored by RV Sawyer.";
    fields.legalNote.value = product.legalNote || "";
    fields.version.value = product.version || "";
    fields.releaseDate.value = product.releaseDate || "";
    fields.lastUpdated.value = product.lastUpdated || "";
    fields.coverFile.value = "";
    fields.previewFile.value = "";
    fields.pdfFile.value = "";
    selectedRelatedProducts = Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : [];
    slugTouched = true;
    folderTouched = true;

    clearAdvisorPanel();
    syncRelatedPicker();
    updateRelatedSelectOptions();
    updateEditModeCopy();
    updatePreview();
    markDraftBaseline();
    persistExistingListingDraft();
    outputs.status.textContent = `Loaded ${product.title} for editing.`;
  }

  function restorePersistedExistingListingDraft() {
    const persisted = readPersistedExistingListingDraft();
    if (!persisted) {
      return false;
    }

    const fallbackRecord = persisted.loadedProductRecord && typeof persisted.loadedProductRecord === "object"
      ? persisted.loadedProductRecord
      : null;
    const product = findAvailableProduct(persisted.loadedProductSlug) || fallbackRecord;
    if (!product) {
      clearPersistedExistingListingDraft();
      return false;
    }

    const draft = persisted.draft || {};
    loadedProductSlug = String(persisted.loadedProductSlug || product.slug || "").trim();
    loadedProductFolder = String(persisted.loadedProductFolder || product.folder || loadedProductSlug).trim() || loadedProductSlug;
    loadedProductRecord = product;

    fields.title.value = draft.title ?? product.title ?? "";
    fields.slug.value = draft.slug ?? product.slug ?? "";
    fields.folder.value = draft.folder ?? product.folder ?? product.slug ?? "";
    fields.subtitle.value = draft.subtitle ?? product.subtitle ?? "";
    fields.authors.value = "RV Sawyer";
    fields.publisher.value = "Tobacco Road Games";
    fields.system.value = draft.gameSystem ?? product.gameSystem ?? "";
    fields.line.value = draft.line ?? product.productLine ?? "";
    fields.series.value = draft.series ?? product.series ?? "";
    fields.format.value = draft.format ?? formatListValue(product.format) ?? "PDF";
    fields.pageCount.value = draft.pageCount ?? (product.pageCount ?? "");
    fields.price.value = draft.price ?? product.price ?? "";
    fields.salePrice.value = draft.salePrice ?? product.salePrice ?? "";
    fields.currency.value = draft.currency ?? product.currency ?? "USD";
    fields.saleEnabled.checked = Boolean(Object.prototype.hasOwnProperty.call(draft, "saleEnabled") ? draft.saleEnabled : product.saleEnabled);
    fields.status.value = draft.status ?? product.status ?? "coming-soon";
    fields.buyMode.value = draft.buyMode ?? product.buyMode ?? "coming-soon";
    fields.buyUrl.value = draft.buyUrl ?? product.buyUrl ?? "";
    syncBuyModeUi();
    fields.shortDescription.value = draft.shortDescription ?? product.shortDescription ?? "";
    fields.longDescription.value = draft.longDescription ?? product.longDescription ?? "";
    fields.features.value = draft.features ?? (Array.isArray(product.features) ? product.features.join("\n") : "");
    fields.tags.value = draft.tags ?? (Array.isArray(product.tags) ? product.tags.join(", ") : "");
    fields.fulfillmentNote.value = draft.fulfillmentNote ?? product.fulfillmentNote ?? "";
    fields.creationMethod.value = draft.creationMethod ?? product.creationMethod ?? "Human-authored by RV Sawyer.";
    fields.legalNote.value = draft.legalNote ?? product.legalNote ?? "";
    fields.version.value = draft.version ?? product.version ?? "";
    fields.releaseDate.value = draft.releaseDate ?? product.releaseDate ?? "";
    fields.lastUpdated.value = draft.lastUpdated ?? product.lastUpdated ?? "";
    fields.coverFile.value = "";
    fields.previewFile.value = "";
    fields.pdfFile.value = "";
    if (fields.existingSelect) {
      fields.existingSelect.value = persisted.existingSelectValue || loadedProductSlug;
    }
    selectedRelatedProducts = Array.isArray(draft.selectedRelatedProducts)
      ? [...draft.selectedRelatedProducts]
      : (Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : []);
    slugTouched = draft.slugTouched !== undefined ? Boolean(draft.slugTouched) : true;
    folderTouched = draft.folderTouched !== undefined ? Boolean(draft.folderTouched) : true;

    clearAdvisorPanel();
    syncRelatedPicker();
    updateRelatedSelectOptions();
    updateEditModeCopy();
    updatePreview();
    draftBaseline = typeof persisted.draftBaseline === "string" && persisted.draftBaseline
      ? persisted.draftBaseline
      : captureDraftState();
    persistExistingListingDraft();
    outputs.status.textContent = `Restored ${loadedProductRecord?.title || loadedProductSlug} for editing after the page was reloaded.`;
    return true;
  }

  fields.slug.addEventListener("input", () => {
    slugTouched = fields.slug.value.trim().length > 0;
    if (!folderTouched) {
      fields.folder.value = fields.slug.value.trim();
    }
    updateRelatedSelectOptions();
    updateEditModeCopy();
    updatePreview();
  });

  fields.folder.addEventListener("input", () => {
    folderTouched = fields.folder.value.trim().length > 0;
    updateEditModeCopy();
    updatePreview();
  });

  fields.title.addEventListener("input", updateAutoFields);
  fields.buyMode.addEventListener("change", () => {
    syncBuyModeUi();
    updatePreview();
  });

  Object.values(fields).forEach((field) => {
    if (!field || field === fields.slug || field === fields.title || field === fields.folder) {
      return;
    }

    field.addEventListener("input", updatePreview);
    field.addEventListener("change", updatePreview);
  });

  buttons.analyze?.addEventListener("click", analyzeCurrentListing);
  buttons.applyAdvisor?.addEventListener("click", applyAdvisorSuggestions);
  buttons.ignoreAdvisor?.addEventListener("click", () => {
    clearAdvisorPanel();
    outputs.status.textContent = "Advisor suggestions cleared.";
  });
  buttons.publish.addEventListener("click", publishProduct);
  buttons.loadExisting?.addEventListener("click", loadExistingProductIntoForm);
  buttons.addRelated.addEventListener("click", addRelatedProduct);
  buttons.review?.addEventListener("click", reviewCurrentListing);
  buttons.toggleJson?.addEventListener("click", () => {
    setJsonVisibility(Boolean(outputs.jsonPanel?.hidden));
  });
  buttons.toggleChecklist?.addEventListener("click", () => {
    setChecklistVisibility(Boolean(outputs.checklistPanel?.hidden));
  });

  fields.relatedList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const slug = target.dataset.relatedRemove || "";
    if (!slug) {
      return;
    }

    removeRelatedProduct(slug);
  });

  const resetFormToDefaults = () => {
    document.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "file") {
        field.value = "";
      }
    });
    fields.title.value = "";
    fields.slug.value = "";
    fields.folder.value = "";
    fields.subtitle.value = "";
    fields.authors.value = "RV Sawyer";
    fields.publisher.value = "Tobacco Road Games";
    fields.system.value = "5E Compatible";
    fields.line.value = "Fifth Edition Fantasy Roleplaying";
    fields.series.value = "";
    fields.format.value = "PDF";
    fields.pageCount.value = "";
    fields.price.value = "";
    fields.salePrice.value = "";
    fields.currency.value = "USD";
    fields.saleEnabled.checked = false;
    fields.status.value = "coming-soon";
    fields.buyMode.value = "coming-soon";
    fields.buyUrl.value = "";
    syncBuyModeUi();
    fields.shortDescription.value = "";
    fields.longDescription.value = "";
    fields.features.value = "";
    fields.tags.value = "";
    fields.fulfillmentNote.value = "";
    fields.creationMethod.value = "Human-authored by RV Sawyer.";
    fields.legalNote.value = "";
    fields.version.value = "";
    fields.releaseDate.value = "";
    fields.lastUpdated.value = "";
    if (fields.existingSelect) {
      fields.existingSelect.value = "";
    }
    selectedRelatedProducts = [];
    loadedProductSlug = "";
    loadedProductFolder = "";
    loadedProductRecord = null;
    slugTouched = false;
    folderTouched = false;
    clearAdvisorPanel();
    clearPersistedExistingListingDraft();
    syncRelatedPicker();
    updateEditModeCopy();
    updatePreview();
    markDraftBaseline();
  };

  buttons.reset.addEventListener("click", () => {
    const wasEditing = isEditingLoadedListing();
    if (hasUnsavedChanges() && !confirmDiscardChanges()) {
      outputs.status.textContent = "Unsaved listing changes are still in place.";
      return;
    }

    resetFormToDefaults();
    outputs.status.textContent = wasEditing
      ? "Listing changes discarded. You are now creating a new product. Published data was not changed."
      : "New product form cleared. Published data was not changed.";
  });

  clearAdvisorPanel();
  globalThis.TRGProductIntake = {
    getModeLabels,
    hasUnsavedChanges,
    validateRequiredFields
  };
  void loadAvailableProducts().then(() => {
    restorePersistedExistingListingDraft();
  });
  syncRelatedPicker();
  syncBuyModeUi();
  setJsonVisibility(false);
  setChecklistVisibility(false);
  updateActionLabels();
  updatePreview();
  markDraftBaseline();
})();
