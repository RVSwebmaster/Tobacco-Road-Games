(() => {
  const CART_BUY_MODE = "cart";
  const CART_BUY_URL_PLACEHOLDER = "No buy URL needed for cart products.";
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
    json: document.getElementById("generated-json"),
    checklist: document.getElementById("asset-checklist"),
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
    reset: document.getElementById("reset-intake-button")
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
    const numeric = Number(normalizeMoneyText(value));
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

  const isEditingLoadedListing = () =>
    Boolean(loadedProductSlug);

  const requiresFullAssetSet = () => {
    if (!isEditingLoadedListing()) {
      return true;
    }

    const currentSlug = fields.slug.value.trim() || slugify(fields.title.value);
    const currentFolder = fields.folder.value.trim() || currentSlug;
    return currentSlug !== loadedProductSlug || currentFolder !== loadedProductFolder;
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
    if (!outputs.editMode) {
      return;
    }

    if (!isEditingLoadedListing()) {
      outputs.editMode.textContent = "Creating a new listing. Load an existing one to revise metadata or replace only the files you choose.";
      return;
    }

    const renameWarning = requiresFullAssetSet()
      ? " Because the slug or folder changed, the next publish needs a full replacement set of cover, preview, and PDF files."
      : " Leave file inputs blank to keep the live assets, or choose only the replacement files you want to swap in.";
    outputs.editMode.textContent = `Editing ${loadedProductRecord?.title || loadedProductSlug}.${renameWarning}`;
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
    if (!globalThis.TRGProductAdvisor?.analyzeProductListing) {
      outputs.status.textContent = "The pricing advisor is not available on this page right now.";
      return;
    }

    const advisorRun = globalThis.TRGProductAdvisor.analyzeProductListing(buildAdvisorInput(), {
      catalog: availableProducts
    });
    latestAdvisorRun = advisorRun;
    renderAdvisorPanel(advisorRun);
    outputs.status.textContent = "Listing analysis is ready. Review the suggestions, then apply or ignore them.";
  };

  const applyAdvisorSuggestions = () => {
    if (!latestAdvisorRun) {
      outputs.status.textContent = "Run Analyze Listing first.";
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
              lastUpdated: String(product.lastUpdated || "").trim(),
              legalNote: String(product.legalNote || "").trim(),
              longDescription: String(product.longDescription || "").trim(),
              pageCount: product.pageCount ?? null,
              price: String(product.price || "").trim(),
              previewImage: String(product.previewImage || "").trim(),
              previewImages: Array.isArray(product.previewImages) ? [...product.previewImages] : [],
              productLine: String(product.productLine || "").trim(),
              relatedProducts: Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : [],
              releaseDate: String(product.releaseDate || "").trim(),
              saleEnabled: Boolean(product.saleEnabled),
              salePrice: String(product.salePrice || "").trim(),
              series: String(product.series || "").trim(),
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

    return {
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
      gameSystemSlug: slugify(gameSystem),
      lastUpdated: fields.lastUpdated.value,
      legalNote: fields.legalNote.value.trim(),
      longDescription: fields.longDescription.value.trim(),
      pageCount: pageCountRaw ? Number(pageCountRaw) : null,
      price: priceRaw,
      priceCents,
      productLine,
      productLineSlug: slugify(productLine),
      saleEnabled: fields.saleEnabled.checked,
      salePrice: salePriceRaw,
      salePriceCents,
      series,
      seriesSlug: slugify(series),
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
  };

  function buildChecklist(payload) {
    const existingMode = isEditingLoadedListing();
    const requiresFiles = requiresFullAssetSet();

    return [
      `R2 folder: ${payload.folder}`,
      existingMode ? `Editing existing listing: ${loadedProductRecord?.title || loadedProductSlug}` : "Publishing mode: New listing",
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
    outputs.status.textContent = "Uploading to R2 and waiting for the GitHub publish workflow to finish...";

    try {
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
      formData.set("series", payload.series);
      formData.set("seriesSlug", payload.seriesSlug);
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

      if (response.status === 401 || response.status === 403) {
        const payload = await safeJson(response);
        outputs.status.textContent = payload.error || "Your owner access session is no longer valid. Reloading the protected route...";
        window.setTimeout(() => {
          window.location.assign("/owner/");
        }, 600);
        return;
      }

      const responsePayload = await safeJson(response);
      if (!response.ok) {
        outputs.status.textContent = responsePayload.error || "Publish failed.";
        return;
      }

      outputs.status.textContent = responsePayload.runUrl
        ? `${responsePayload.message} Workflow: ${responsePayload.runUrl}`
        : responsePayload.message;
    } catch {
      outputs.status.textContent = "The publish request failed before the server could answer. Please try again.";
    } finally {
      publishBusy = false;
      buttons.publish.disabled = false;
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

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
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
    outputs.status.textContent = `Loaded ${product.title} for editing.`;
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

  buttons.reset.addEventListener("click", () => {
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
    outputs.status.textContent = "Form reset.";
    clearAdvisorPanel();
    syncRelatedPicker();
    updateEditModeCopy();
    updatePreview();
  });

  clearAdvisorPanel();
  void loadAvailableProducts();
  syncRelatedPicker();
  syncBuyModeUi();
  updatePreview();
})();
