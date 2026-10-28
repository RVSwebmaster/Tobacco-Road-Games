(() => {
  const CART_BUY_MODE = "cart";
  const ALLOWED_BUY_MODES = new Set([
    "available-direct",
    "cart",
    "coming-soon",
    "fixed-price",
    "free-download",
    "manual-invoice",
    "pay-what-you-want",
    "preview-only",
    "retired"
  ]);
  const CART_BUY_URL_PLACEHOLDER = "No buy URL needed for cart products.";
  const DISCARD_LISTING_CHANGES_MESSAGE = "Discard unsaved work? Any unpublished listing changes will be lost.";
  const EXISTING_LISTING_DRAFT_KEY = "trg_owner_existing_listing_draft_v1";
  const PRODUCT_LINE_LIBRARY_KEY = "trg_owner_product_lines_v1";
  const TAG_LIBRARY_KEY = "trg_owner_tag_library_v1";
  const DEFAULT_PRODUCT_LINES = ["Tablecraft"];
  const DEFAULT_TAG_GROUPS = Object.freeze([
    Object.freeze({ name: "Product Lines", tags: Object.freeze(["Tablecraft", "Gazetteer", "Familiar Faces", "Nippon Folio"]) }),
    Object.freeze({ name: "Genre", tags: Object.freeze(["Family Gaming", "Fantasy", "Historical", "Horror", "Modern", "Science Fiction", "Other"]) }),
    Object.freeze({ name: "Product Type", tags: Object.freeze(["Core Rules", "Supplement", "Rules Supplement", "Scenario", "Item", "Monster"]) }),
    Object.freeze({ name: "Game System", tags: Object.freeze(["Dungeons & Dragons", "SRD 5.1", "SRD 5.21", "OGL", "Threshold Engine", "GURPS", "Champions", "Big Damn Sci-Fi", "System Agnostic", "Other System", "Traveller", "Call of Cthulhu", "Syzygy"]) })
  ]);
  const PDF_PREFILL_FIELDS = Object.freeze({
    title: Object.freeze({ field: "title", label: "Title" }),
    subtitle: Object.freeze({ field: "subtitle", label: "Subtitle" }),
    pageCount: Object.freeze({ field: "pageCount", label: "Page count" }),
    format: Object.freeze({ field: "format", label: "Format" }),
    system: Object.freeze({ field: "system", label: "Game system" }),
    line: Object.freeze({ field: "line", label: "Product line" }),
    series: Object.freeze({ field: "series", label: "Series" }),
    version: Object.freeze({ field: "version", label: "Version" }),
    language: Object.freeze({ field: "language", label: "Language" }),
    releaseDate: Object.freeze({ field: "releaseDate", label: "Publication date" }),
    genre: Object.freeze({ field: "genre", label: "Genre" }),
    contentDescriptors: Object.freeze({ field: "contentDescriptors", label: "Content descriptors", join: ", " }),
    features: Object.freeze({ field: "features", label: "Features", join: "\n" }),
    tags: Object.freeze({ field: "tags", label: "Tags", join: ", " }),
    shortDescription: Object.freeze({ field: "shortDescription", label: "Short description" }),
    longDescription: Object.freeze({ field: "longDescription", label: "Long description" }),
    legalNote: Object.freeze({ field: "legalNote", label: "Legal note or license" })
  });
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
    genre: document.getElementById("product-genre"),
    playerCountMin: document.getElementById("product-player-min"),
    playerCountMax: document.getElementById("product-player-max"),
    gmMode: document.getElementById("product-gm-mode"),
    prepBurden: document.getElementById("product-prep-burden"),
    playDuration: document.getElementById("product-play-duration"),
    playMode: document.getElementById("product-play-mode"),
    rulesComplexity: document.getElementById("product-rules-complexity"),
    mediaType: document.getElementById("product-media-type"),
    language: document.getElementById("product-language"),
    contentDescriptors: document.getElementById("product-content-descriptors"),
    line: document.getElementById("product-line"),
    series: document.getElementById("product-series"),
    productLineManagerInput: document.getElementById("product-line-manager-input"),
    tagManagerGroupInput: document.getElementById("tag-manager-group-input"),
    tagManagerGroupSelect: document.getElementById("tag-manager-group-select"),
    tagManagerTagInput: document.getElementById("tag-manager-tag-input"),
    format: document.getElementById("product-format"),
    pageCount: document.getElementById("product-page-count"),
    price: document.getElementById("product-price"),
    salePrice: document.getElementById("product-sale-price"),
    currency: document.getElementById("product-currency"),
    saleEnabled: document.getElementById("product-sale-enabled"),
    openRulesEligible: document.getElementById("product-open-rules-eligible"),
    status: document.getElementById("product-status"),
    buyMode: document.getElementById("product-buy-mode"),
    buyUrl: document.getElementById("product-buy-url"),
    shortDescription: document.getElementById("product-short-description"),
    longDescription: document.getElementById("product-long-description"),
    features: document.getElementById("product-features"),
    tags: document.getElementById("product-tags"),
    fulfillmentNote: document.getElementById("product-fulfillment-note"),
    teaserVideo: document.getElementById("product-teaser-video"),
    creationMethod: document.getElementById("product-creation-method"),
    legalNote: document.getElementById("product-legal-note"),
    version: document.getElementById("product-version"),
    releaseDate: document.getElementById("product-release-date"),
    lastUpdated: document.getElementById("product-last-updated"),
    relatedSelect: document.getElementById("product-related-select"),
    relatedList: document.getElementById("product-related-list"),
    coverFile: document.getElementById("product-cover-file"),
    pdfFile: document.getElementById("product-pdf-file"),
    reviewPdfFile: document.getElementById("review-pdf-file"),
    pdfFrontPage: document.getElementById("pdf-front-page"),
    pdfBackPage: document.getElementById("pdf-back-page")
  };

  const outputs = {
    editMode: document.getElementById("product-edit-mode"),
    listingDetails: document.getElementById("listing-details-section"),
    pdfPrefillFileStatus: document.getElementById("pdf-prefill-file-status"),
    pdfPrefillStatus: document.getElementById("pdf-prefill-status"),
    pdfPrefillSummary: document.getElementById("pdf-prefill-summary"),
    pdfPrefillPopulatedList: document.getElementById("pdf-prefill-populated-list"),
    pdfPrefillManualList: document.getElementById("pdf-prefill-manual-list"),
    pdfPrefillReview: document.getElementById("pdf-prefill-review"),
    pdfPrefillReviewList: document.getElementById("pdf-prefill-review-list"),
    pdfPrefillWarningList: document.getElementById("pdf-prefill-warning-list"),
    pdfReviewField: document.getElementById("review-pdf-field"),
    pdfReviewStatus: document.getElementById("pdf-review-status"),
    pdfImagePanel: document.getElementById("pdf-image-extraction-panel"),
    pdfImageStatus: document.getElementById("pdf-image-extraction-status"),
    pdfFrontImage: document.getElementById("pdf-front-image"),
    pdfBackImage: document.getElementById("pdf-back-image"),
    pdfFrontPlaceholder: document.getElementById("pdf-front-placeholder"),
    pdfBackPlaceholder: document.getElementById("pdf-back-placeholder"),
    pdfFrontDetails: document.getElementById("pdf-front-details"),
    pdfBackDetails: document.getElementById("pdf-back-details"),
    productLineManagerList: document.getElementById("product-line-manager-list"),
    productLineManagerPanel: document.getElementById("product-line-manager-panel"),
    productLineManagerStatus: document.getElementById("product-line-manager-status"),
    tagManagerList: document.getElementById("tag-manager-list"),
    tagManagerPanel: document.getElementById("tag-manager-panel"),
    tagManagerStatus: document.getElementById("tag-manager-status"),
    tagPreservedNote: document.getElementById("product-tag-preserved-note"),
    tagSelector: document.getElementById("product-tag-selector"),
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
    feedbackPanel: document.getElementById("intake-action-feedback"),
    feedbackHeading: document.getElementById("intake-feedback-heading"),
    status: document.getElementById("intake-status"),
    validationList: document.getElementById("intake-validation-list"),
    reviewSummary: document.getElementById("intake-review-summary"),
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
    addProductLine: document.getElementById("add-product-line-button"),
    addTag: document.getElementById("add-tag-button"),
    addTagGroup: document.getElementById("add-tag-group-button"),
    ignoreAdvisor: document.getElementById("ignore-advisor-button"),
    leaveListing: document.getElementById("leave-listing-button"),
    loadExisting: document.getElementById("product-existing-load"),
    manageProductLines: document.getElementById("manage-product-lines-button"),
    manageTags: document.getElementById("manage-tags-button"),
    readPdfPrefill: document.getElementById("read-pdf-prefill-button"),
    openPdfReview: document.getElementById("open-pdf-review-button"),
    downloadPdfReview: document.getElementById("download-pdf-review-button"),
    pdfFrontReplace: document.getElementById("pdf-front-replace"),
    pdfFrontDownload: document.getElementById("pdf-front-download"),
    pdfFrontAccept: document.getElementById("pdf-front-accept"),
    pdfBackReplace: document.getElementById("pdf-back-replace"),
    pdfBackDownload: document.getElementById("pdf-back-download"),
    pdfBackAccept: document.getElementById("pdf-back-accept"),
    applyPdfPrefill: document.getElementById("apply-pdf-prefill-button"),
    startNew: document.getElementById("start-new-listing-button"),
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
  let ownerProductLines = [...DEFAULT_PRODUCT_LINES];
  let ownerTagGroups = DEFAULT_TAG_GROUPS.map((group) => ({ name: group.name, tags: [...group.tags] }));
  let selectedTagKeys = new Set();
  let preservedUnknownTags = [];
  let pdfPrefillBusy = false;
  let pdfPrefillSuggestions = new Map();
  let pdfImageBusy = false;
  let pdfImageSession = null;
  let pdfImageSourceFile = null;
  const pdfImageCandidates = new Map();

  const getPdfReviewFile = () => isEditingLoadedListing()
    ? fields.reviewPdfFile?.files?.[0] || null
    : fields.pdfFile?.files?.[0] || null;

  const updatePdfReviewControls = () => {
    const file = getPdfReviewFile();
    const enabled = Boolean(file);
    if (buttons.openPdfReview) buttons.openPdfReview.disabled = !enabled;
    if (buttons.downloadPdfReview) buttons.downloadPdfReview.disabled = !enabled;
    if (outputs.pdfReviewField) outputs.pdfReviewField.hidden = !isEditingLoadedListing();
    if (!outputs.pdfReviewStatus) return;
    outputs.pdfReviewStatus.textContent = file
      ? `${file.name} is ready for exact-byte local review. Nothing has been uploaded or published.`
      : (isEditingLoadedListing()
        ? "Select a local review copy. It will not replace the published PDF or enter the publishing payload."
        : "Select the Product PDF File to enable local review.");
  };

  const withLocalPdfUrl = (callback) => {
    const file = getPdfReviewFile();
    if (!file) {
      updatePdfReviewControls();
      return false;
    }
    const url = URL.createObjectURL(file);
    callback(url, file);
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  };

  const openPdfForReview = () => withLocalPdfUrl((url, file) => {
    globalThis.open(url, "_blank", "noopener");
    outputs.pdfReviewStatus.textContent = `Opened ${file.name} for closer review. Nothing was uploaded or published.`;
  });

  const downloadPdfForReview = () => withLocalPdfUrl((url, file) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    link.click();
    outputs.pdfReviewStatus.textContent = `Prepared the unchanged ${file.name} for download. Nothing was uploaded or published.`;
  });

  const pdfImageRoleControls = Object.freeze({
    front: Object.freeze({
      page: fields.pdfFrontPage,
      image: outputs.pdfFrontImage,
      placeholder: outputs.pdfFrontPlaceholder,
      details: outputs.pdfFrontDetails,
      replace: buttons.pdfFrontReplace,
      download: buttons.pdfFrontDownload,
      accept: buttons.pdfFrontAccept
    }),
    back: Object.freeze({
      page: fields.pdfBackPage,
      image: outputs.pdfBackImage,
      placeholder: outputs.pdfBackPlaceholder,
      details: outputs.pdfBackDetails,
      replace: buttons.pdfBackReplace,
      download: buttons.pdfBackDownload,
      accept: buttons.pdfBackAccept
    })
  });

  const clearPdfImageCandidate = (role) => {
    const candidate = pdfImageCandidates.get(role);
    if (candidate?.url) URL.revokeObjectURL(candidate.url);
    pdfImageCandidates.delete(role);
    const controls = pdfImageRoleControls[role];
    if (!controls) return;
    controls.image.removeAttribute?.("src");
    controls.image.hidden = true;
    controls.placeholder.hidden = false;
    controls.placeholder.textContent = role === "front"
      ? "No front cover extracted"
      : "No back cover extracted";
    controls.download.disabled = true;
    controls.accept.disabled = true;
    controls.accept.setAttribute?.("aria-pressed", "false");
    if (role === "back") controls.accept.textContent = "Mark Back Cover Reviewed";
    controls.details.textContent = "Not generated.";
  };

  const clearPdfImageExtraction = ({ hidePanel = false } = {}) => {
    for (const role of Object.keys(pdfImageRoleControls)) clearPdfImageCandidate(role);
    if (pdfImageSession) void pdfImageSession.destroy();
    pdfImageSession = null;
    pdfImageSourceFile = null;
    pdfImageBusy = false;
    if (outputs.pdfImagePanel) outputs.pdfImagePanel.hidden = hidePanel;
    if (outputs.pdfImageStatus) outputs.pdfImageStatus.textContent = "Select a PDF to process its front and back covers automatically.";
    updatePdfReviewControls();
  };

  const setPdfImageCandidate = async (role, rendered, makeFilename) => {
    const controls = pdfImageRoleControls[role];
    if (!controls || !rendered?.blob) return null;
    clearPdfImageCandidate(role);
    const candidate = {
      ...rendered,
      accepted: false,
      fileName: makeFilename(role, rendered.pageNumber),
      url: URL.createObjectURL(rendered.blob)
    };
    pdfImageCandidates.set(role, candidate);
    controls.image.src = candidate.url;
    controls.image.hidden = false;
    controls.placeholder.hidden = true;
    try {
      if (typeof controls.image.decode === "function") {
        await controls.image.decode();
      }
    } catch (error) {
      clearPdfImageCandidate(role);
      throw new Error(`The generated ${role}-cover WebP could not be displayed: ${error?.message || "image decoding failed"}`);
    }
    controls.download.disabled = false;
    controls.accept.disabled = false;
    controls.details.textContent = `PDF page ${candidate.pageNumber} - ${candidate.width} x ${candidate.height}px WebP - ${Math.max(1, Math.round(candidate.blob.size / 1024))} KB.`;
    return candidate;
  };

  const renderPdfImageCandidate = async (role) => {
    const controls = pdfImageRoleControls[role];
    if (!pdfImageSession || !controls || pdfImageBusy) return null;
    const requestedPage = Number(controls.page.value);
    clearPdfImageCandidate(role);
    pdfImageBusy = true;
    updatePdfReviewControls();
    controls.replace.disabled = true;
    controls.details.textContent = `Rendering PDF page ${requestedPage}...`;
    controls.placeholder.hidden = false;
    controls.placeholder.textContent = `Rendering PDF page ${requestedPage}...`;
    outputs.pdfImageStatus.textContent = `Rendering PDF page ${requestedPage} locally for the ${role}-cover candidate...`;
    try {
      const module = await import("/assets/js/product-pdf-images.mjs?v=20261026a");
      const rendered = await pdfImageSession.renderPage(requestedPage);
      controls.page.value = String(rendered.pageNumber);
      const candidate = await setPdfImageCandidate(role, rendered, module.makePdfWebpFilename);
      outputs.pdfImageStatus.textContent = `Generated ${candidate.fileName} locally. Review it before accepting or downloading it.`;
      return candidate;
    } catch (error) {
      const message = error?.message || "unknown rendering error";
      controls.details.textContent = `Could not generate this image: ${message}`;
      controls.placeholder.hidden = false;
      controls.placeholder.textContent = `Cover extraction failed: ${message}`;
      outputs.pdfImageStatus.textContent = `PDF page extraction failed: ${message}. Nothing was uploaded or published.`;
      return null;
    } finally {
      pdfImageBusy = false;
      controls.replace.disabled = false;
      updatePdfReviewControls();
    }
  };

  const extractPdfImages = async () => {
    const file = getPdfReviewFile();
    if (!file || pdfImageBusy) {
      updatePdfReviewControls();
      return null;
    }
    clearPdfImageExtraction({ hidePanel: false });
    pdfImageBusy = true;
    pdfImageSourceFile = file;
    outputs.pdfImagePanel.hidden = false;
    outputs.pdfImageStatus.textContent = "Opening the local PDF and reading its page count...";
    updatePdfReviewControls();
    try {
      const module = await import("/assets/js/product-pdf-images.mjs?v=20261026a");
      const session = await module.openPdfImageExtraction(file);
      if (getPdfReviewFile() !== file) {
        await session.destroy();
        outputs.pdfImageStatus.textContent = "The selected PDF changed during extraction. Start again with the current selection.";
        return null;
      }
      pdfImageSession = session;
      fields.pdfFrontPage.max = String(session.pageCount);
      fields.pdfBackPage.max = String(session.pageCount);
      fields.pdfFrontPage.value = String(session.defaults.frontPage);
      fields.pdfBackPage.value = String(session.defaults.backPage);
      outputs.pdfImageStatus.textContent = `Opened ${file.name}: ${session.pageCount} pages. Generating the front and back covers locally...`;
      pdfImageBusy = false;
      const frontCandidate = await renderPdfImageCandidate("front");
      const backCandidate = await renderPdfImageCandidate("back");
      if (!frontCandidate || !backCandidate) {
        const failed = [!frontCandidate && "front cover", !backCandidate && "back cover"].filter(Boolean).join(" and ");
        outputs.pdfImageStatus.textContent = `Could not generate the ${failed}. Review the error shown with the affected image and try another page or PDF. Nothing was uploaded or published.`;
        return session;
      }
      outputs.pdfImageStatus.textContent = `Generated the front cover from page ${fields.pdfFrontPage.value} and the back cover from page ${fields.pdfBackPage.value}. Nothing has been assigned, uploaded, or published.`;
      return session;
    } catch (error) {
      outputs.pdfImageStatus.textContent = `The PDF could not be opened for image extraction: ${error?.message || "unknown extraction error"}. Nothing was uploaded or published.`;
      return null;
    } finally {
      pdfImageBusy = false;
      updatePdfReviewControls();
    }
  };

  const downloadPdfImageCandidate = (role) => {
    const candidate = pdfImageCandidates.get(role);
    if (!candidate) return false;
    const link = document.createElement("a");
    link.href = candidate.url;
    link.download = candidate.fileName;
    link.rel = "noopener";
    link.click();
    outputs.pdfImageStatus.textContent = `Prepared ${candidate.fileName} for local download. Nothing was uploaded or published.`;
    return true;
  };

  const placeFileInInput = (field, file) => {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    field.files = transfer.files;
    field.dispatchEvent?.(new Event("change", { bubbles: true }));
  };

  const assignPdfImageCandidate = (role, target) => {
    const candidate = pdfImageCandidates.get(role);
    if (!candidate) return false;
    if (role === "back" || target === "back") {
      candidate.accepted = true;
      buttons.pdfBackAccept.textContent = "Back Cover Reviewed";
      buttons.pdfBackAccept.setAttribute?.("aria-pressed", "true");
      buttons.pdfBackAccept.disabled = true;
      outputs.pdfBackDetails.textContent = `Back cover from PDF page ${candidate.pageNumber} marked reviewed. It remains separate from cover.webp.`;
      outputs.pdfImageStatus.textContent = "Back cover marked reviewed. It was not assigned to cover.webp and was not added to the publishing payload.";
      return true;
    }
    const field = fields.coverFile;
    const fileName = "cover.webp";
    if (field.files?.length && !globalThis.confirm(`Replace the currently selected ${fileName} with PDF page ${candidate.pageNumber}?`)) {
      outputs.pdfImageStatus.textContent = `${fileName} was not changed.`;
      return false;
    }
    const file = new File([candidate.blob], fileName, { type: "image/webp", lastModified: Date.now() });
    placeFileInInput(field, file);
    candidate.accepted = true;
    outputs.pdfImageStatus.textContent = `Assigned PDF page ${candidate.pageNumber} to ${fileName}. The original PDF remains selected, and nothing has been uploaded or published.`;
    updatePreview();
    return true;
  };

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

  const normalizePdfPrefillValue = (value, join = "") =>
    Array.isArray(value)
      ? value.map((entry) => String(entry || "").trim()).filter(Boolean).join(join || ", ")
      : String(value ?? "").trim();

  const getPdfPrefillCurrentValue = (fieldKey) => {
    const config = PDF_PREFILL_FIELDS[fieldKey];
    if (!config) return "";
    if (fieldKey === "tags") return getCurrentTagValues().join(", ");
    return String(fields[config.field]?.value ?? "").trim();
  };

  const ensureProductLineValue = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || !fields.line) return;
    const existing = [...fields.line.options].some((option) => option.value === normalized);
    if (!existing) {
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      option.dataset.pdfPrefill = "true";
      fields.line.append(option);
    }
  };

  const setPdfPrefillFieldValue = (fieldKey, suggestion) => {
    const config = PDF_PREFILL_FIELDS[fieldKey];
    if (!config) return false;
    const value = normalizePdfPrefillValue(suggestion?.value, config.join);
    if (!value) return false;
    if (fieldKey === "tags") {
      applyTagValues(value);
      renderTagSelector();
      renderTagManager();
      return true;
    }
    if (fieldKey === "line") ensureProductLineValue(value);
    const field = fields[config.field];
    if (!field) return false;
    field.value = value;
    return true;
  };

  const makePdfPrefillListItem = (text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  };

  const clearPdfPrefillResults = ({ keepFileStatus = true } = {}) => {
    pdfPrefillSuggestions = new Map();
    outputs.pdfPrefillSummary.hidden = true;
    outputs.pdfPrefillReview.hidden = true;
    outputs.pdfPrefillWarningList.hidden = true;
    outputs.pdfPrefillPopulatedList.replaceChildren();
    outputs.pdfPrefillManualList.replaceChildren();
    outputs.pdfPrefillReviewList.replaceChildren();
    outputs.pdfPrefillWarningList.replaceChildren();
    if (!keepFileStatus) outputs.pdfPrefillFileStatus.textContent = "No PDF selected.";
  };

  const renderPdfPrefillReview = () => {
    const entries = [...pdfPrefillSuggestions.entries()];
    outputs.pdfPrefillReview.hidden = entries.length === 0;
    outputs.pdfPrefillReviewList.replaceChildren(...entries.map(([fieldKey, suggestion]) => {
      const config = PDF_PREFILL_FIELDS[fieldKey];
      const label = document.createElement("label");
      label.className = "pdf-prefill__suggestion";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.pdfPrefillField = fieldKey;
      const copy = document.createElement("span");
      const value = normalizePdfPrefillValue(suggestion.value, config.join);
      const title = document.createElement("strong");
      title.textContent = `${config.label}: ${value}`;
      const detail = document.createElement("small");
      detail.textContent = `Current value kept: ${getPdfPrefillCurrentValue(fieldKey) || "blank"}. Source: ${suggestion.source}.`;
      copy.append(title, detail);
      label.append(checkbox, copy);
      return label;
    }));
  };

  const renderPdfPrefillSummary = ({ populated = [], extractedFields = {}, warnings = [], pageCount = 0, sampledPageCount = 0 } = {}) => {
    outputs.pdfPrefillSummary.hidden = false;
    outputs.pdfPrefillPopulatedList.replaceChildren(...(populated.length
      ? populated.map(makePdfPrefillListItem)
      : [makePdfPrefillListItem("No blank fields were changed automatically.")]));

    const missing = Object.entries(PDF_PREFILL_FIELDS)
      .filter(([fieldKey]) => !extractedFields[fieldKey])
      .map(([, config]) => config.label);
    const manualItems = [
      ...missing,
      "Price, sale settings, buy mode, and store status",
      "Cover WebP file"
    ];
    outputs.pdfPrefillManualList.replaceChildren(...manualItems.map(makePdfPrefillListItem));

    outputs.pdfPrefillWarningList.replaceChildren(...warnings.map(makePdfPrefillListItem));
    outputs.pdfPrefillWarningList.hidden = warnings.length === 0;
    outputs.pdfPrefillStatus.textContent = `Read ${sampledPageCount} selected page${sampledPageCount === 1 ? "" : "s"} from a ${pageCount}-page PDF. Review editable form values and any preserved-value suggestions before publishing.`;
  };

  const applyPdfPrefillResults = (result) => {
    const populated = [];
    pdfPrefillSuggestions = new Map();
    for (const [fieldKey, suggestion] of Object.entries(result.fields || {})) {
      const config = PDF_PREFILL_FIELDS[fieldKey];
      if (!config) continue;
      const nextValue = normalizePdfPrefillValue(suggestion.value, config.join);
      const currentValue = getPdfPrefillCurrentValue(fieldKey);
      if (!nextValue) continue;
      if (!currentValue) {
        if (setPdfPrefillFieldValue(fieldKey, suggestion)) populated.push(`${config.label} - ${suggestion.source}`);
        continue;
      }
      if (currentValue.toLocaleLowerCase() === nextValue.toLocaleLowerCase()) {
        populated.push(`${config.label} - already matched the PDF`);
        continue;
      }
      pdfPrefillSuggestions.set(fieldKey, suggestion);
    }
    updateAutoFields();
    renderPdfPrefillReview();
    renderPdfPrefillSummary({
      populated,
      extractedFields: result.fields || {},
      warnings: result.warnings || [],
      pageCount: result.pageCount,
      sampledPageCount: result.sampledPageCount
    });
    return { populated, preserved: [...pdfPrefillSuggestions.keys()] };
  };

  const applySelectedPdfPrefillSuggestions = () => {
    const checked = [...outputs.pdfPrefillReviewList.querySelectorAll("input[data-pdf-prefill-field]:checked")];
    if (!checked.length) {
      outputs.pdfPrefillStatus.textContent = "No preserved values were selected for replacement.";
      return [];
    }
    const applied = [];
    for (const checkbox of checked) {
      const fieldKey = checkbox.dataset.pdfPrefillField;
      const suggestion = pdfPrefillSuggestions.get(fieldKey);
      if (!suggestion || !setPdfPrefillFieldValue(fieldKey, suggestion)) continue;
      applied.push(PDF_PREFILL_FIELDS[fieldKey].label);
      pdfPrefillSuggestions.delete(fieldKey);
    }
    updateAutoFields();
    renderPdfPrefillReview();
    outputs.pdfPrefillStatus.textContent = `Applied ${applied.join(", ")} from the PDF. The values remain editable and nothing has been uploaded.`;
    return applied;
  };

  const readPdfAndPrefillListing = async () => {
    if (pdfPrefillBusy) return null;
    const file = getPdfReviewFile();
    if (!file) {
      outputs.pdfPrefillStatus.textContent = isEditingLoadedListing()
        ? "Choose a local review PDF before reading it."
        : "Choose a product PDF before reading it.";
      return null;
    }
    pdfPrefillBusy = true;
    buttons.readPdfPrefill.disabled = true;
    clearPdfPrefillResults();
    outputs.pdfPrefillStatus.textContent = "Loading the local PDF parser...";
    try {
      const { readProductPdf } = await import("/assets/js/product-pdf-autofill.mjs?v=20261026a");
      const result = await readProductPdf(file, {
        onProgress: ({ current, total, pageNumber }) => {
          outputs.pdfPrefillStatus.textContent = `Reading selected page ${current} of ${total} (PDF page ${pageNumber})...`;
        }
      });
      if (getPdfReviewFile() !== file) {
        outputs.pdfPrefillStatus.textContent = "The selected PDF changed during analysis. Read the newly selected file when ready.";
        return null;
      }
      applyPdfPrefillResults(result);
      outputs.pdfPrefillFileStatus.textContent = isEditingLoadedListing()
        ? `${file.name} remains selected for local review only and will not replace the published PDF.`
        : `${file.name} remains selected for publishing.`;
      return result;
    } catch (error) {
      outputs.pdfPrefillStatus.textContent = isEditingLoadedListing()
        ? `The PDF could not be read: ${error?.message || "unknown extraction error"}. The local review file remains separate from the publishing workflow.`
        : `The PDF could not be read: ${error?.message || "unknown extraction error"}. The file remains selected and may still be used by the normal publishing workflow.`;
      outputs.pdfPrefillFileStatus.textContent = isEditingLoadedListing()
        ? `${file.name} remains selected for local review only and will not replace the published PDF.`
        : `${file.name} remains selected for publishing.`;
      return null;
    } finally {
      pdfPrefillBusy = false;
      buttons.readPdfPrefill.disabled = false;
    }
  };

  let automaticPdfProcessorsForTests = null;

  const processSelectedPdf = async () => {
    const file = getPdfReviewFile();
    if (!file) {
      updatePdfReviewControls();
      return null;
    }

    outputs.pdfPrefillStatus.textContent = "Processing PDF...";
    outputs.pdfImageStatus.textContent = "Processing PDF...";

    const prefillProcessor = automaticPdfProcessorsForTests?.prefill || readPdfAndPrefillListing;
    const coverProcessor = automaticPdfProcessorsForTests?.covers || extractPdfImages;
    await prefillProcessor(file);
    if (getPdfReviewFile() !== file) return null;
    await coverProcessor(file);
    return file;
  };

  const normalizeProductLineName = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  const canonicalizeProductLineName = (value) =>
    normalizeProductLineName(value).toLowerCase();

  const normalizeTagGroupName = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  const canonicalizeTagGroupName = (value) =>
    normalizeTagGroupName(value).toLowerCase();

  const normalizeTagName = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");

  const canonicalizeTagName = (value) =>
    normalizeTagName(value).toLowerCase();

  const cloneTagGroups = (groups) =>
    Array.isArray(groups)
      ? groups.map((group) => ({
        name: normalizeTagGroupName(group?.name),
        tags: Array.isArray(group?.tags) ? group.tags.map((tag) => normalizeTagName(tag)).filter(Boolean) : []
      })).filter((group) => group.name)
      : [];

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

  const clearFieldValidation = () => {
    for (const field of Object.values(fields)) {
      field?.removeAttribute?.("aria-invalid");
    }
  };

  const renderValidationIssues = (issues = []) => {
    if (!outputs.validationList) return;
    outputs.validationList.hidden = !issues.length;
    outputs.validationList.replaceChildren(...issues.map((issue) => {
      const item = document.createElement("li");
      if (!issue.field?.id) {
        item.textContent = issue.message;
        return item;
      }
      const link = document.createElement("button");
      link.type = "button";
      link.className = "intake-validation-link";
      link.dataset.validationTarget = issue.field.id;
      link.textContent = issue.message;
      item.append(link);
      return item;
    }));
  };

  const renderReviewSummary = (items = []) => {
    if (!outputs.reviewSummary) return;
    outputs.reviewSummary.hidden = !items.length;
    outputs.reviewSummary.replaceChildren(...items.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  };

  const showActionFeedback = ({
    kind = "info",
    heading = "Action result",
    message = "",
    issues = [],
    reviewItems = [],
    bringIntoView = true
  } = {}) => {
    clearFieldValidation();
    for (const issue of issues) {
      issue.field?.setAttribute?.("aria-invalid", "true");
    }
    if (outputs.feedbackPanel) {
      outputs.feedbackPanel.hidden = false;
      outputs.feedbackPanel.dataset.kind = kind;
    }
    if (outputs.feedbackHeading) outputs.feedbackHeading.textContent = heading;
    if (outputs.status) outputs.status.textContent = message;
    renderValidationIssues(issues);
    renderReviewSummary(reviewItems);
    if (bringIntoView && outputs.feedbackPanel) {
      outputs.feedbackPanel.scrollIntoView?.({ behavior: "smooth", block: "center" });
      outputs.feedbackPanel.focus?.({ preventScroll: true });
    }
  };

  const clearActionFeedback = () => {
    clearFieldValidation();
    if (outputs.feedbackPanel) {
      outputs.feedbackPanel.hidden = true;
      outputs.feedbackPanel.dataset.kind = "";
    }
    if (outputs.feedbackHeading) outputs.feedbackHeading.textContent = "Action result";
    if (outputs.status) outputs.status.textContent = "";
    renderValidationIssues([]);
    renderReviewSummary([]);
  };

  const setListingDetailsVisibility = (visible) => {
    if (outputs.listingDetails) {
      outputs.listingDetails.hidden = !visible;
    }
  };

  const setProductLineManagerVisibility = (visible) => {
    if (outputs.productLineManagerPanel) {
      outputs.productLineManagerPanel.hidden = !visible;
    }
    if (buttons.manageProductLines) {
      buttons.manageProductLines.setAttribute("aria-expanded", visible ? "true" : "false");
    }
  };

  const setTagManagerVisibility = (visible) => {
    if (outputs.tagManagerPanel) {
      outputs.tagManagerPanel.hidden = !visible;
    }
    if (buttons.manageTags) {
      buttons.manageTags.setAttribute("aria-expanded", visible ? "true" : "false");
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
        openRulesEligible: fields.openRulesEligible.checked,
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
    price: fields.price.value,
    relatedProducts: [...selectedRelatedProducts],
    releaseDate: fields.releaseDate.value,
    saleEnabled: fields.saleEnabled.checked,
    openRulesEligible: fields.openRulesEligible.checked,
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
      ? " Because the slug or folder changed, the next update needs a full replacement set of cover and PDF files."
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
      interior_image_count: loadedProductRecord?.previewImages?.length || 0,
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
    const validationIssues = validateListingIssues();
    if (validationIssues.length) {
      clearAdvisorPanel();
      showActionFeedback({
        kind: "error",
        heading: `Validation failed - ${validationIssues.length} requirement${validationIssues.length === 1 ? "" : "s"} need attention`,
        message: "Nothing was published. Select any requirement below to move to the affected field.",
        issues: validationIssues
      });
      return;
    }

    if (!globalThis.TRGProductAdvisor?.analyzeProductListing) {
      showActionFeedback({
        kind: "success",
        heading: "Validation passed",
        message: "All publishing requirements are satisfied. The optional pricing advisor is unavailable, but Review and Publish remain available."
      });
      return;
    }

    try {
      const advisorRun = globalThis.TRGProductAdvisor.analyzeProductListing(buildAdvisorInput(), {
        catalog: availableProducts
      });
      latestAdvisorRun = advisorRun;
      renderAdvisorPanel(advisorRun);
      showActionFeedback({
        kind: "success",
        heading: "Validation passed",
        message: "All publishing requirements are satisfied. Advisory suggestions are available below; they do not change the listing unless you apply them."
      });
    } catch (error) {
      clearAdvisorPanel();
      showActionFeedback({
        kind: "error",
        heading: "Validation passed, but the advisor failed",
        message: `The listing itself is valid. The optional pricing advisor could not finish: ${error?.message || "unknown advisor error"}.`
      });
    }
  };

  const reviewCurrentListing = () => {
    const validationIssues = validateListingIssues();
    if (validationIssues.length) {
      showActionFeedback({
        kind: "error",
        heading: `Review blocked - ${validationIssues.length} requirement${validationIssues.length === 1 ? "" : "s"} need attention`,
        message: "Nothing was published. Correct the listed requirements, then run Review again.",
        issues: validationIssues
      });
      return;
    }

    updatePreview();
    const payload = buildPayload();
    setJsonVisibility(true);
    setChecklistVisibility(true);
    showActionFeedback({
      kind: "success",
      heading: isEditingLoadedListing() ? "Listing update review ready" : "New product review ready",
      message: isEditingLoadedListing()
        ? "Review ready. No changes have been published. The exact metadata and replacement-file plan are open below."
        : "Review ready. Nothing has been published. The exact metadata and required-file plan are open below.",
      reviewItems: buildReviewSummary(payload)
    });
  };

  const applyAdvisorSuggestions = () => {
    if (!latestAdvisorRun) {
      showActionFeedback({
        kind: "error",
        heading: "No advisor results are available",
        message: `Run ${getModeLabels().checkButton} first.`
      });
      return;
    }

    fields.price.value = formatMoney(latestAdvisorRun.suggested_price);
    fields.salePrice.value = formatMoney(latestAdvisorRun.suggested_sale_price);

    if (latestAdvisorRun.series_fit) {
      fields.series.value = latestAdvisorRun.series_fit;
      refreshProductLineUi();
    }

    applyTagValues(latestAdvisorRun.suggested_tags, { mergePreservedUnknown: true });
    renderTagSelector();
    renderTagManager();
    selectedRelatedProducts = [...latestAdvisorRun.suggested_cross_sells];
    syncRelatedPicker();
    updatePreview();
    showActionFeedback({
      kind: "success",
      heading: "Advisor suggestions applied",
      message: "The suggestions are now editable form values. Nothing was published."
    });
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

    refreshProductLineUi();
    renderTagManager();
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
      genre: fields.genre?.value.trim() || "",
      playerCountMin: fields.playerCountMin?.value ? Number(fields.playerCountMin.value) : null,
      playerCountMax: fields.playerCountMax?.value ? Number(fields.playerCountMax.value) : null,
      gmMode: fields.gmMode?.value || "",
      prepBurden: fields.prepBurden?.value || "",
      playDuration: fields.playDuration?.value || "",
      playMode: fields.playMode?.value || "",
      rulesComplexity: fields.rulesComplexity?.value || "",
      mediaType: fields.mediaType?.value || "",
      language: fields.language?.value.trim() || "",
      contentDescriptors: parseList(fields.contentDescriptors?.value || ""),
      features: parseLines(fields.features.value),
      fileList,
      folder,
      format: parseList(fields.format.value).length ? parseList(fields.format.value) : ["PDF"],
      fulfillmentNote: fields.fulfillmentNote.value.trim(),
      teaserVideo: fields.teaserVideo?.value.trim() || "",
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
      openRulesEligible: fields.openRulesEligible.checked,
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
      tags: getCurrentTagValues(),
      title,
      version: fields.version.value.trim() || "1.0"
    };

    if (!series) {
      delete payload.series;
    }
    if (!payload.seriesSlug) {
      delete payload.seriesSlug;
    }
    for (const field of ["genre", "gmMode", "prepBurden", "playDuration", "playMode", "rulesComplexity", "mediaType", "language"]) {
      if (!payload[field]) delete payload[field];
    }
    if (payload.playerCountMin === null) delete payload.playerCountMin;
    if (payload.playerCountMax === null) delete payload.playerCountMax;
    if (!payload.contentDescriptors.length) delete payload.contentDescriptors;

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
        ? "- One PDF product file"
        : "- Product PDF only if you want to replace the current private PDF",
      ...(existingMode && !requiresFiles
        ? ["", "Leave file inputs blank to preserve the current bucket assets."]
        : []),
      "",
      "Internal bucket object paths after publish:",
      `- ${payload.folder}/cover.webp`,
      `- ${payload.folder}/product.pdf`,
      "",
      "Published public asset paths:",
      `/product-assets/${payload.slug}/cover.webp`,
      "",
      "Repo publish path after upload:",
      "- Update shared folder map",
      "- Update data/product-intake-map.json",
      "- Update data/products.json",
      "- Run node scripts/build-store.js",
      "- Commit and push to main"
    ].join("\n");
  }

  function buildReviewSummary(payload) {
    const existingMode = isEditingLoadedListing();
    const selectedPdf = fields.pdfFile.files[0]?.name || "";
    const currentPdf = Array.isArray(loadedProductRecord?.fileList) && loadedProductRecord.fileList.length
      ? loadedProductRecord.fileList.join(", ")
      : "current private product PDF";
    return [
      `Mode: ${existingMode ? `Update ${loadedProductRecord?.title || loadedProductSlug}` : "Create a new listing"}.`,
      `Product: ${payload.title} (${payload.slug}).`,
      `Storefront state: ${payload.statusLabel}; buy mode: ${payload.buyMode}.`,
      `R2 folder: ${payload.folder}.`,
      `Product PDF: ${selectedPdf || (existingMode ? `preserve ${currentPdf}` : "not selected")}.`,
      `cover.webp: ${fields.coverFile.files[0]?.name || (existingMode ? "preserve current cover" : "not selected")}.`,
      "Back-cover review image: never included in the publishing payload.",
      `Tags: ${payload.tags.length ? payload.tags.join(", ") : "none selected"}.`
    ];
  }

  function renderAssetFileList(payload) {
    const items = [
      ...payload.fileList,
      `${payload.folder}/cover.webp`,
      `${payload.folder}/product.pdf`,
      `/product-assets/${payload.slug}/cover.webp`
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

  function getPublishFailureHeading(stage) {
    return ({
      validation: "Server validation failed",
      configuration: "Publishing configuration failed",
      upload: "R2 file upload failed",
      "catalog-deployment": "Catalog update or deployment failed",
      unexpected: "Publishing failed"
    })[stage] || "Publishing failed";
  }

  function setPublishBusyState(busy) {
    publishBusy = busy;
    buttons.publish.disabled = busy;
    for (const button of [buttons.analyze, buttons.review, buttons.reset]) {
      if (button) button.disabled = busy;
    }
    outputs.feedbackPanel?.setAttribute?.("aria-busy", busy ? "true" : "false");
  }

  async function publishProduct() {
    if (publishBusy) {
      return;
    }

    const validationIssues = validateListingIssues();
    if (validationIssues.length) {
      showActionFeedback({
        kind: "error",
        heading: `Publish blocked - ${validationIssues.length} requirement${validationIssues.length === 1 ? "" : "s"} need attention`,
        message: "No request was sent and nothing was uploaded. Correct every listed requirement, then run Review before publishing.",
        issues: validationIssues
      });
      return;
    }

    setPublishBusyState(true);
    buttons.publish.textContent = getSubmitProgressLabel();
    showActionFeedback({
      kind: "progress",
      heading: isEditingLoadedListing() ? "Updating listing" : "Publishing new product",
      message: isEditingLoadedListing()
        ? "Preparing metadata, uploading any selected replacement files to R2, and waiting for the existing-listing update workflow to finish..."
        : "Preparing metadata, uploading the two required files to R2, and waiting for the new-listing publish workflow to finish..."
    });

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
      formData.set("openRulesEligible", payload.openRulesEligible ? "true" : "false");
      formData.set("currency", payload.currency);
      for (const field of ["genre", "playerCountMin", "playerCountMax", "gmMode", "prepBurden", "playDuration", "playMode", "rulesComplexity", "mediaType", "language"]) {
        formData.set(field, Object.prototype.hasOwnProperty.call(payload, field) ? String(payload[field]) : "");
      }
      formData.set("contentDescriptors", (payload.contentDescriptors || []).join(", "));
      formData.set("status", payload.status);
      formData.set("buyMode", payload.buyMode);
      formData.set("buyUrl", payload.buyUrl);
      formData.set("shortDescription", payload.shortDescription);
      formData.set("longDescription", payload.longDescription);
      formData.set("features", payload.features.join("\n"));
      formData.set("tags", payload.tags.join(", "));
      formData.set("fulfillmentNote", payload.fulfillmentNote);
      formData.set("teaserVideo", payload.teaserVideo);
      formData.set("creationMethod", payload.creationMethod);
      formData.set("legalNote", payload.legalNote);
      formData.set("version", payload.version);
      formData.set("releaseDate", payload.releaseDate);
      formData.set("lastUpdated", payload.lastUpdated);
      formData.set("relatedProducts", payload.relatedProducts.join(", "));

      if (fields.coverFile.files[0]) {
        formData.set("coverFile", fields.coverFile.files[0]);
      }
      if (fields.pdfFile.files[0]) {
        formData.set("productFile", fields.pdfFile.files[0]);
      }

      const response = await fetch("/owner/api/publish", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
        redirect: "manual"
      });

      const responsePayload = await readResponsePayload(response);

      if (!response.ok) {
        const errorMessage = responsePayload.json.error || formatUnexpectedResponseError("Publish", responsePayload);
        const uploadedFiles = Array.isArray(responsePayload.json.filesUploaded) && responsePayload.json.filesUploaded.length
          ? ` R2 accepted these files before the later failure: ${responsePayload.json.filesUploaded.join(", ")}.`
          : "";
        showActionFeedback({
          kind: "error",
          heading: getPublishFailureHeading(responsePayload.json.stage),
          message: `${errorMessage}${uploadedFiles}`
        });
        return;
      }

      if (startedInExistingMode) {
        const updatedTitle = loadedProductRecord?.title || payload.title || payload.slug || "The listing";
        resetFormToDefaults();
        showActionFeedback({
          kind: "success",
          heading: "Existing listing updated",
          message: formatPublishSuccessMessage(updatedTitle, responsePayload)
        });
        if (typeof fields.existingSelect?.focus === "function") {
          fields.existingSelect.focus();
        }
        return;
      }

      showActionFeedback({
        kind: "success",
        heading: responsePayload.json.pending ? "Publish accepted - catalog workflow still running" : "Product published successfully",
        message: responsePayload.json.runUrl
          ? `${responsePayload.json.message} Workflow: ${responsePayload.json.runUrl}`
          : responsePayload.json.message
      });
      markDraftBaseline();
      persistExistingListingDraft();
    } catch (error) {
      showActionFeedback({
        kind: "error",
        heading: "Publish request could not reach the server",
        message: `The browser did not receive a server response: ${error?.message || "network request failed"}. No success was reported. Review the current listing and try again.`
      });
    } finally {
      setPublishBusyState(false);
      updateActionLabels();
    }
  }

  function validateListingIssues() {
    const issues = [];
    const requireFiles = requiresFullAssetSet();
    const requiredTextFields = [
      [fields.title, "Title"],
      [fields.slug, "Slug"],
      [fields.folder, "R2 folder name"],
      [fields.subtitle, "Subtitle"],
      [fields.system, "Game system"],
      [fields.line, "Product line"],
      [fields.shortDescription, "Short description"],
      [fields.longDescription, "Long description"],
      [fields.status, "Status"],
      [fields.buyMode, "Buy mode"]
    ];

    for (const [field, label] of requiredTextFields) {
      if (!field.value.trim()) {
        issues.push({ field, label, message: `${label} is required.` });
      }
    }

    const slug = fields.slug.value.trim();
    if (slug && slugify(slug) !== slug) {
      issues.push({ field: fields.slug, label: "Slug", message: "Slug must use lowercase letters, numbers, and single hyphens only." });
    }

    const folder = fields.folder.value.trim();
    if (folder && (folder.includes("/") || folder.includes("\\") || folder.includes("..") || !/^[A-Za-z0-9 _-]+$/.test(folder))) {
      issues.push({ field: fields.folder, label: "R2 folder name", message: "R2 folder name may use only letters, numbers, spaces, underscores, and hyphens." });
    }

    if (!parseList(fields.format.value).length) {
      issues.push({ field: fields.format, label: "Format", message: "At least one format is required." });
    }

    if (fields.status.value && !statusLabels[fields.status.value]) {
      issues.push({ field: fields.status, label: "Status", message: "Choose a supported storefront status." });
    }

    if (fields.buyMode.value && !ALLOWED_BUY_MODES.has(fields.buyMode.value)) {
      issues.push({ field: fields.buyMode, label: "Buy mode", message: "Choose a supported buy mode." });
    }

    const pageCountText = fields.pageCount.value.trim();
    if (pageCountText && (!Number.isInteger(Number(pageCountText)) || Number(pageCountText) < 1)) {
      issues.push({ field: fields.pageCount, label: "Page count", message: "Page count must be a positive whole number." });
    }

    const minimumPlayers = fields.playerCountMin?.value ? Number(fields.playerCountMin.value) : null;
    const maximumPlayers = fields.playerCountMax?.value ? Number(fields.playerCountMax.value) : null;
    if (minimumPlayers !== null && (!Number.isInteger(minimumPlayers) || minimumPlayers < 1 || minimumPlayers > 100)) {
      issues.push({ field: fields.playerCountMin, label: "Minimum players", message: "Minimum players must be a whole number from 1 to 100." });
    }
    if (maximumPlayers !== null && (!Number.isInteger(maximumPlayers) || maximumPlayers < 1 || maximumPlayers > 100)) {
      issues.push({ field: fields.playerCountMax, label: "Maximum players", message: "Maximum players must be a whole number from 1 to 100." });
    }
    if (minimumPlayers !== null && maximumPlayers !== null && minimumPlayers > maximumPlayers) {
      issues.push({ field: fields.playerCountMax, label: "Maximum players", message: "Maximum players cannot be lower than minimum players." });
    }

    for (const [field, label] of [[fields.price, "Price"], [fields.salePrice, "Sale price"]]) {
      const value = field.value.trim();
      if (value && (parsePriceNumber(value) === null || parsePriceNumber(value) < 0)) {
        issues.push({ field, label, message: `${label} must be a valid nonnegative amount.` });
      }
    }

    const validateSelectedFile = (field, label, expectedType, extension) => {
      const file = field.files?.[0];
      if (!file) {
        if (requireFiles) issues.push({ field, label, message: `${label} is required.` });
        return;
      }
      const name = String(file.name || "").toLowerCase();
      const type = String(file.type || "").toLowerCase();
      if (!file.size) {
        issues.push({ field, label, message: `${label} is empty.` });
      } else if (!name.endsWith(extension) || (type && type !== expectedType)) {
        issues.push({ field, label, message: `${label} must be a ${expectedType === "application/pdf" ? "PDF file" : "WebP image"}.` });
      }
    };

    validateSelectedFile(fields.coverFile, "Cover image", "image/webp", ".webp");
    validateSelectedFile(fields.pdfFile, "Product PDF", "application/pdf", ".pdf");

    if (fields.buyMode.value === CART_BUY_MODE) {
      if (fields.status.value !== "available-direct") {
        issues.push({ field: fields.status, label: "Status", message: "Cart products must use Available Direct status." });
      }
      const parsedPrice = parsePriceNumber(fields.price.value);
      if (parsedPrice === null || parsedPrice <= 0) {
        issues.push({ field: fields.price, label: "Price", message: "Cart products require a positive price." });
      }
    }

    return issues;
  }

  function validateRequiredFields() {
    return validateListingIssues().map((issue) => issue.message);
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
      showActionFeedback({ kind: "error", heading: "No listing selected", message: "Pick a listing first." });
      return;
    }

    const product = findAvailableProduct(slug);
    if (!product) {
      showActionFeedback({
        kind: "error",
        heading: "Listing could not be loaded",
        message: "That listing is not present in the current catalog data."
      });
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
    if (fields.genre) fields.genre.value = product.genre || "";
    if (fields.playerCountMin) fields.playerCountMin.value = product.playerCountMin ?? "";
    if (fields.playerCountMax) fields.playerCountMax.value = product.playerCountMax ?? "";
    if (fields.gmMode) fields.gmMode.value = product.gmMode || "";
    if (fields.prepBurden) fields.prepBurden.value = product.prepBurden || "";
    if (fields.playDuration) fields.playDuration.value = product.playDuration || "";
    if (fields.playMode) fields.playMode.value = product.playMode || "";
    if (fields.rulesComplexity) fields.rulesComplexity.value = product.rulesComplexity || "";
    if (fields.mediaType) fields.mediaType.value = product.mediaType || "";
    if (fields.language) fields.language.value = product.language || "";
    if (fields.contentDescriptors) fields.contentDescriptors.value = Array.isArray(product.contentDescriptors) ? product.contentDescriptors.join(", ") : "";
    fields.line.value = product.productLine || "";
    fields.series.value = product.series || "";
    fields.format.value = formatListValue(product.format) || "PDF";
    fields.pageCount.value = product.pageCount ?? "";
    fields.price.value = product.price || "";
    fields.salePrice.value = product.salePrice || "";
    fields.currency.value = product.currency || "USD";
    fields.saleEnabled.checked = Boolean(product.saleEnabled);
    fields.openRulesEligible.checked = Boolean(product.openRulesEligible);
    fields.status.value = product.status || "coming-soon";
    fields.buyMode.value = product.buyMode || "coming-soon";
    fields.buyUrl.value = product.buyUrl || "";
    if (fields.teaserVideo) fields.teaserVideo.value = product.teaserVideo || "";
    syncBuyModeUi();
    fields.shortDescription.value = product.shortDescription || "";
    fields.longDescription.value = product.longDescription || "";
    fields.features.value = Array.isArray(product.features) ? product.features.join("\n") : "";
    applyTagValues(Array.isArray(product.tags) ? product.tags : []);
    fields.fulfillmentNote.value = product.fulfillmentNote || "";
    fields.creationMethod.value = product.creationMethod || "Human-authored by RV Sawyer.";
    fields.legalNote.value = product.legalNote || "";
    fields.version.value = product.version || "";
    fields.releaseDate.value = product.releaseDate || "";
    fields.lastUpdated.value = product.lastUpdated || "";
    fields.coverFile.value = "";
    fields.pdfFile.value = "";
    if (fields.reviewPdfFile) fields.reviewPdfFile.value = "";
    clearPdfImageExtraction();
    clearPdfPrefillResults({ keepFileStatus: false });
    outputs.pdfPrefillStatus.textContent = "Choose a readable PDF to begin. Scanned image-only documents will still provide page count and format.";
    selectedRelatedProducts = Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : [];
    slugTouched = true;
    folderTouched = true;

    clearAdvisorPanel();
    refreshProductLineUi();
    renderTagSelector();
    renderTagManager();
    syncRelatedPicker();
    updateRelatedSelectOptions();
    setListingDetailsVisibility(true);
    updateEditModeCopy();
    updatePreview();
    updatePdfReviewControls();
    markDraftBaseline();
    persistExistingListingDraft();
    showActionFeedback({
      kind: "success",
      heading: "Existing listing loaded",
      message: `Loaded ${product.title} for editing. No changes have been published.`
    });
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
    fields.openRulesEligible.checked = Boolean(Object.prototype.hasOwnProperty.call(draft, "openRulesEligible") ? draft.openRulesEligible : product.openRulesEligible);
    fields.status.value = draft.status ?? product.status ?? "coming-soon";
    fields.buyMode.value = draft.buyMode ?? product.buyMode ?? "coming-soon";
    fields.buyUrl.value = draft.buyUrl ?? product.buyUrl ?? "";
    syncBuyModeUi();
    fields.shortDescription.value = draft.shortDescription ?? product.shortDescription ?? "";
    fields.longDescription.value = draft.longDescription ?? product.longDescription ?? "";
    fields.features.value = draft.features ?? (Array.isArray(product.features) ? product.features.join("\n") : "");
    applyTagValues(draft.tags ?? (Array.isArray(product.tags) ? product.tags : []));
    fields.fulfillmentNote.value = draft.fulfillmentNote ?? product.fulfillmentNote ?? "";
    fields.creationMethod.value = draft.creationMethod ?? product.creationMethod ?? "Human-authored by RV Sawyer.";
    fields.legalNote.value = draft.legalNote ?? product.legalNote ?? "";
    fields.version.value = draft.version ?? product.version ?? "";
    fields.releaseDate.value = draft.releaseDate ?? product.releaseDate ?? "";
    fields.lastUpdated.value = draft.lastUpdated ?? product.lastUpdated ?? "";
    fields.coverFile.value = "";
    fields.pdfFile.value = "";
    if (fields.reviewPdfFile) fields.reviewPdfFile.value = "";
    clearPdfImageExtraction();
    clearPdfPrefillResults({ keepFileStatus: false });
    outputs.pdfPrefillStatus.textContent = "Choose a readable PDF to begin. Scanned image-only documents will still provide page count and format.";
    if (fields.existingSelect) {
      fields.existingSelect.value = persisted.existingSelectValue || loadedProductSlug;
    }
    selectedRelatedProducts = Array.isArray(draft.selectedRelatedProducts)
      ? [...draft.selectedRelatedProducts]
      : (Array.isArray(product.relatedProducts) ? [...product.relatedProducts] : []);
    slugTouched = draft.slugTouched !== undefined ? Boolean(draft.slugTouched) : true;
    folderTouched = draft.folderTouched !== undefined ? Boolean(draft.folderTouched) : true;

    clearAdvisorPanel();
    refreshProductLineUi();
    renderTagSelector();
    renderTagManager();
    syncRelatedPicker();
    updateRelatedSelectOptions();
    setListingDetailsVisibility(true);
    updateEditModeCopy();
    updatePreview();
    updatePdfReviewControls();
    draftBaseline = typeof persisted.draftBaseline === "string" && persisted.draftBaseline
      ? persisted.draftBaseline
      : captureDraftState();
    persistExistingListingDraft();
    showActionFeedback({
      kind: "info",
      heading: "Unsaved listing draft restored",
      message: `Restored ${loadedProductRecord?.title || loadedProductSlug} for editing after the page was reloaded.`
    });
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
  fields.pdfFile?.addEventListener("change", () => {
    clearPdfImageExtraction();
    clearPdfPrefillResults();
    const file = fields.pdfFile.files[0];
    outputs.pdfPrefillFileStatus.textContent = file
      ? `${file.name} selected for analysis and publishing.`
      : "No PDF selected.";
    outputs.pdfPrefillStatus.textContent = file
      ? "Ready to read the selected PDF. Nothing will upload until the normal Publish action."
      : "Choose a readable PDF to begin. Scanned image-only documents will still provide page count and format.";
    updatePreview();
    updatePdfReviewControls();
    if (file) void processSelectedPdf();
  });
  fields.reviewPdfFile?.addEventListener("change", () => {
    clearPdfImageExtraction();
    clearPdfPrefillResults();
    updatePdfReviewControls();
    if (fields.reviewPdfFile.files[0]) void processSelectedPdf();
  });
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
  buttons.readPdfPrefill?.addEventListener("click", readPdfAndPrefillListing);
  buttons.openPdfReview?.addEventListener("click", openPdfForReview);
  buttons.downloadPdfReview?.addEventListener("click", downloadPdfForReview);
  buttons.pdfFrontReplace?.addEventListener("click", () => renderPdfImageCandidate("front"));
  buttons.pdfBackReplace?.addEventListener("click", () => renderPdfImageCandidate("back"));
  buttons.pdfFrontDownload?.addEventListener("click", () => downloadPdfImageCandidate("front"));
  buttons.pdfBackDownload?.addEventListener("click", () => downloadPdfImageCandidate("back"));
  buttons.pdfFrontAccept?.addEventListener("click", () => assignPdfImageCandidate("front", "cover"));
  buttons.pdfBackAccept?.addEventListener("click", () => assignPdfImageCandidate("back", "back"));
  buttons.applyPdfPrefill?.addEventListener("click", applySelectedPdfPrefillSuggestions);
  buttons.addProductLine?.addEventListener("click", () => {
    addOwnerProductLine();
  });
  buttons.addTag?.addEventListener("click", () => {
    addOwnerTag();
  });
  buttons.addTagGroup?.addEventListener("click", () => {
    addOwnerTagGroup();
  });
  buttons.applyAdvisor?.addEventListener("click", applyAdvisorSuggestions);
  buttons.ignoreAdvisor?.addEventListener("click", () => {
    clearAdvisorPanel();
    showActionFeedback({
      kind: "success",
      heading: "Advisor suggestions cleared",
      message: "The listing values were not changed."
    });
  });
  buttons.publish.addEventListener("click", publishProduct);
  buttons.loadExisting?.addEventListener("click", loadExistingProductIntoForm);
  buttons.manageProductLines?.addEventListener("click", () => {
    setProductLineManagerVisibility(Boolean(outputs.productLineManagerPanel?.hidden));
  });
  buttons.manageTags?.addEventListener("click", () => {
    setTagManagerVisibility(Boolean(outputs.tagManagerPanel?.hidden));
  });
  buttons.leaveListing?.addEventListener("click", () => {
    if (hasUnsavedChanges() && !confirmDiscardChanges()) {
      showActionFeedback({ kind: "info", heading: "Changes preserved", message: "Unsaved listing changes are still in place." });
      return;
    }

    resetFormToDefaults({ hideDetails: true });
    showActionFeedback({
      kind: "success",
      heading: "Returned to listing picker",
      message: "Returned to the listing picker. Published data was not changed."
    });
    if (typeof fields.existingSelect?.focus === "function") {
      fields.existingSelect.focus();
    }
  });
  buttons.startNew?.addEventListener("click", () => {
    const wasEditing = isEditingLoadedListing();
    if (hasUnsavedChanges() && !confirmDiscardChanges()) {
      showActionFeedback({ kind: "info", heading: "Changes preserved", message: "Unsaved listing changes are still in place." });
      return;
    }

    resetFormToDefaults({ hideDetails: false });
    showActionFeedback({
      kind: "info",
      heading: "New listing workspace ready",
      message: wasEditing
        ? "Existing-listing edits were discarded. You are now creating a new product."
        : "Nothing has been published yet."
    });
    if (typeof fields.title?.focus === "function") {
      fields.title.focus();
    }
  });
  buttons.addRelated.addEventListener("click", addRelatedProduct);
  buttons.review?.addEventListener("click", reviewCurrentListing);
  buttons.toggleJson?.addEventListener("click", () => {
    setJsonVisibility(Boolean(outputs.jsonPanel?.hidden));
  });
  buttons.toggleChecklist?.addEventListener("click", () => {
    setChecklistVisibility(Boolean(outputs.checklistPanel?.hidden));
  });
  outputs.validationList?.addEventListener("click", (event) => {
    const targetId = event.target?.dataset?.validationTarget || "";
    if (!targetId) return;
    const field = document.getElementById(targetId);
    field?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    field?.focus?.({ preventScroll: true });
  });

  fields.productLineManagerInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addOwnerProductLine();
  });

  fields.tagManagerTagInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addOwnerTag();
  });

  fields.tagManagerGroupInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addOwnerTagGroup();
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

  const resetFormToDefaults = ({ hideDetails = true } = {}) => {
    clearActionFeedback();
    document.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "file") {
        field.value = "";
      }
    });
    clearPdfImageExtraction();
    clearPdfPrefillResults({ keepFileStatus: false });
    outputs.pdfPrefillStatus.textContent = "Choose a readable PDF to begin. Scanned image-only documents will still provide page count and format.";
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
    fields.openRulesEligible.checked = false;
    fields.status.value = "coming-soon";
    fields.buyMode.value = "coming-soon";
    fields.buyUrl.value = "";
    syncBuyModeUi();
    fields.shortDescription.value = "";
    fields.longDescription.value = "";
    fields.features.value = "";
    applyTagValues([]);
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
    refreshProductLineUi();
    renderTagSelector();
    renderTagManager();
    syncRelatedPicker();
    setListingDetailsVisibility(!hideDetails);
    updateEditModeCopy();
    updatePreview();
    updatePdfReviewControls();
    markDraftBaseline();
  };

  const getLocalStorage = () => {
    try {
      return globalThis.localStorage || globalThis.window?.localStorage || null;
    } catch {
      return null;
    }
  };

  const persistOwnerProductLines = () => {
    const storage = getLocalStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(PRODUCT_LINE_LIBRARY_KEY, JSON.stringify(ownerProductLines));
    } catch {}
  };

  const readOwnerProductLines = () => {
    const storage = getLocalStorage();
    if (!storage) {
      return [...DEFAULT_PRODUCT_LINES];
    }

    try {
      const raw = storage.getItem(PRODUCT_LINE_LIBRARY_KEY);
      if (!raw) {
        return [...DEFAULT_PRODUCT_LINES];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [...DEFAULT_PRODUCT_LINES];
      }

      const merged = new Map();
      [...DEFAULT_PRODUCT_LINES, ...parsed]
        .map((entry) => normalizeProductLineName(entry))
        .filter(Boolean)
        .forEach((entry) => {
          const key = canonicalizeProductLineName(entry);
          if (!merged.has(key)) {
            merged.set(key, entry);
          }
        });
      return [...merged.values()];
    } catch {
      return [...DEFAULT_PRODUCT_LINES];
    }
  };

  const persistOwnerTagGroups = () => {
    const storage = getLocalStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(TAG_LIBRARY_KEY, JSON.stringify(ownerTagGroups));
    } catch {}
  };

  const readOwnerTagGroups = () => {
    const storage = getLocalStorage();
    if (!storage) {
      return cloneTagGroups(DEFAULT_TAG_GROUPS);
    }

    try {
      const raw = storage.getItem(TAG_LIBRARY_KEY);
      if (!raw) {
        return cloneTagGroups(DEFAULT_TAG_GROUPS);
      }
      const parsed = JSON.parse(raw);
      const groups = cloneTagGroups(parsed);
      if (!groups.length) {
        return cloneTagGroups(DEFAULT_TAG_GROUPS);
      }

      return groups.map((group) => {
        const seen = new Set();
        return {
          name: group.name,
          tags: group.tags.filter((tag) => {
            const key = canonicalizeTagName(tag);
            if (!key || seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          })
        };
      });
    } catch {
      return cloneTagGroups(DEFAULT_TAG_GROUPS);
    }
  };

  const getKnownTagMap = () => {
    const known = new Map();
    ownerTagGroups.forEach((group) => {
      group.tags.forEach((tag) => {
        const key = canonicalizeTagName(tag);
        if (key && !known.has(key)) {
          known.set(key, normalizeTagName(tag));
        }
      });
    });
    return known;
  };

  const getSelectableTagGroups = () =>
    cloneTagGroups(ownerTagGroups).map((group) => ({
      name: group.name,
      tags: group.tags.filter(Boolean)
    }));

  const getUsedTagUsage = () => {
    const usage = new Map();
    availableProducts.forEach((product) => {
      const productTags = Array.isArray(product.tags) ? product.tags : [];
      productTags.forEach((tag) => {
        const normalized = normalizeTagName(tag);
        const key = canonicalizeTagName(normalized);
        if (!key) {
          return;
        }
        const current = usage.get(key) || { count: 0, name: normalized };
        current.count += 1;
        usage.set(key, current);
      });
    });
    return usage;
  };

  const getCurrentKnownTagsInOrder = () => {
    const tags = [];
    const appended = new Set();
    ownerTagGroups.forEach((group) => {
      group.tags.forEach((tag) => {
        const key = canonicalizeTagName(tag);
        if (!key || !selectedTagKeys.has(key) || appended.has(key)) {
          return;
        }
        appended.add(key);
        tags.push(normalizeTagName(tag));
      });
    });
    return tags;
  };

  const getCurrentTagValues = () =>
    [...getCurrentKnownTagsInOrder(), ...preservedUnknownTags];

  const syncTagsFieldValue = () => {
    if (!fields.tags) {
      return;
    }
    fields.tags.value = getCurrentTagValues().join(", ");
  };

  const updatePreservedTagNote = () => {
    if (!outputs.tagPreservedNote) {
      return;
    }

    outputs.tagPreservedNote.textContent = preservedUnknownTags.length
      ? `Additional existing tags preserved on update: ${preservedUnknownTags.join(", ")}.`
      : "Only the selected checkbox tags will be published.";
  };

  const applyTagValues = (tags, options = {}) => {
    const knownTags = getKnownTagMap();
    const nextSelected = new Set();
    const nextPreserved = [];
    const seenUnknown = new Set();
    const mergePreservedUnknown = Boolean(options.mergePreservedUnknown);

    parseList(Array.isArray(tags) ? tags.join(", ") : tags).forEach((tag) => {
      const normalized = normalizeTagName(tag);
      const key = canonicalizeTagName(normalized);
      if (!key) {
        return;
      }
      if (knownTags.has(key)) {
        nextSelected.add(key);
        return;
      }
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key);
        nextPreserved.push(normalized);
      }
    });

    if (mergePreservedUnknown) {
      preservedUnknownTags.forEach((tag) => {
        const normalized = normalizeTagName(tag);
        const key = canonicalizeTagName(normalized);
        if (!key || seenUnknown.has(key)) {
          return;
        }
        seenUnknown.add(key);
        nextPreserved.push(normalized);
      });
    }

    selectedTagKeys = nextSelected;
    preservedUnknownTags = nextPreserved;
    syncTagsFieldValue();
    updatePreservedTagNote();
  };

  const renderTagSelector = () => {
    if (!outputs.tagSelector) {
      return;
    }

    const groups = getSelectableTagGroups();
    outputs.tagSelector.replaceChildren(
      ...groups.map((group) => {
        const card = document.createElement("section");
        card.className = "tag-selector__group";

        const title = document.createElement("strong");
        title.className = "tag-selector__group-title";
        title.textContent = group.name;
        card.append(title);

        const optionGrid = document.createElement("div");
        optionGrid.className = "tag-selector__options";

        group.tags.forEach((tag) => {
          const key = canonicalizeTagName(tag);
          const option = document.createElement("label");
          option.className = "tag-selector__option";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selectedTagKeys.has(key);
          checkbox.dataset.tagKey = key;
          checkbox.dataset.tagLabel = tag;
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              selectedTagKeys.add(key);
            } else {
              selectedTagKeys.delete(key);
            }
            syncTagsFieldValue();
            updatePreservedTagNote();
            updatePreview();
          });

          const labelText = document.createElement("span");
          labelText.textContent = tag;

          option.append(checkbox);
          option.append(labelText);
          optionGrid.append(option);
        });

        card.append(optionGrid);
        return card;
      })
    );
  };

  const renderTagManager = () => {
    if (fields.tagManagerGroupSelect) {
      const previousValue = fields.tagManagerGroupSelect.value;
      const options = [];
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Select a tag group";
      options.push(emptyOption);

      ownerTagGroups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.name;
        option.textContent = group.name;
        options.push(option);
      });

      fields.tagManagerGroupSelect.replaceChildren(...options);
      if (ownerTagGroups.some((group) => group.name === previousValue)) {
        fields.tagManagerGroupSelect.value = previousValue;
      }
    }

    if (!outputs.tagManagerList) {
      return;
    }

    const usage = getUsedTagUsage();
    outputs.tagManagerList.replaceChildren(
      ...ownerTagGroups.map((group) => {
        const groupCard = document.createElement("section");
        groupCard.className = "tag-manager__group";

        const title = document.createElement("strong");
        title.className = "tag-manager__group-title";
        title.textContent = group.name;
        groupCard.append(title);

        if (!group.tags.length) {
          const empty = document.createElement("p");
          empty.className = "tag-manager__group-empty";
          empty.textContent = "No tags in this group yet.";
          groupCard.append(empty);
          return groupCard;
        }

        group.tags.forEach((tag) => {
          const item = document.createElement("div");
          item.className = "tag-manager__item";

          const copy = document.createElement("div");
          copy.className = "tag-manager__item-copy";

          const name = document.createElement("span");
          name.className = "tag-manager__item-name";
          name.textContent = tag;
          copy.append(name);

          const note = document.createElement("span");
          note.className = "tag-manager__item-note";
          const key = canonicalizeTagName(tag);
          const tagUsage = usage.get(key);
          note.textContent = tagUsage
            ? `Used by ${tagUsage.count} product${tagUsage.count === 1 ? "" : "s"}. Remove it from those listings before deleting it here.`
            : "Unused owner tag. Safe to remove without changing any published listing.";
          copy.append(note);

          const removeButton = document.createElement("button");
          removeButton.className = "button button--secondary";
          removeButton.type = "button";
          removeButton.textContent = "Remove";
          removeButton.disabled = Boolean(tagUsage);
          removeButton.addEventListener("click", () => {
            removeOwnerTag(group.name, tag);
          });

          item.append(copy);
          item.append(removeButton);
          groupCard.append(item);
        });

        return groupCard;
      })
    );
  };

  const refreshTagUi = () => {
    const currentTags = parseList(fields.tags?.value || "");
    applyTagValues(currentTags);
    renderTagSelector();
    renderTagManager();
  };

  const addOwnerTagGroup = () => {
    const groupName = normalizeTagGroupName(fields.tagManagerGroupInput?.value || "");
    if (!groupName) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = "Enter a group name before adding it.";
      }
      return false;
    }

    const key = canonicalizeTagGroupName(groupName);
    if (ownerTagGroups.some((group) => canonicalizeTagGroupName(group.name) === key)) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = `${groupName} is already available in the tag group list.`;
      }
      return false;
    }

    ownerTagGroups = [...ownerTagGroups, { name: groupName, tags: [] }];
    if (fields.tagManagerGroupInput) {
      fields.tagManagerGroupInput.value = "";
    }
    persistOwnerTagGroups();
    refreshTagUi();
    if (fields.tagManagerGroupSelect) {
      fields.tagManagerGroupSelect.value = groupName;
    }
    if (outputs.tagManagerStatus) {
      outputs.tagManagerStatus.textContent = `${groupName} added. You can add tags to it now.`;
    }
    return true;
  };

  const addOwnerTag = () => {
    const groupName = normalizeTagGroupName(fields.tagManagerGroupSelect?.value || "");
    const tagName = normalizeTagName(fields.tagManagerTagInput?.value || "");
    if (!groupName) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = "Choose a tag group before adding a tag.";
      }
      return false;
    }
    if (!tagName) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = "Enter a tag name before adding it.";
      }
      return false;
    }

    const tagKey = canonicalizeTagName(tagName);
    if (ownerTagGroups.some((group) => group.tags.some((tag) => canonicalizeTagName(tag) === tagKey))) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = `${tagName} is already available in the tag selector.`;
      }
      return false;
    }

    ownerTagGroups = ownerTagGroups.map((group) =>
      group.name === groupName
        ? { ...group, tags: [...group.tags, tagName] }
        : group
    );
    if (fields.tagManagerTagInput) {
      fields.tagManagerTagInput.value = "";
    }
    persistOwnerTagGroups();
    refreshTagUi();
    if (outputs.tagManagerStatus) {
      outputs.tagManagerStatus.textContent = `${tagName} added to ${groupName}. It is available in the checkbox selector now.`;
    }
    return true;
  };

  const removeOwnerTag = (groupName, tagName) => {
    const normalizedGroupName = normalizeTagGroupName(groupName);
    const normalizedTagName = normalizeTagName(tagName);
    const tagKey = canonicalizeTagName(normalizedTagName);
    const usage = getUsedTagUsage().get(tagKey);
    if (usage) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = `${normalizedTagName} cannot be removed because ${usage.count} product${usage.count === 1 ? "" : "s"} still use it.`;
      }
      return false;
    }

    let removed = false;
    ownerTagGroups = ownerTagGroups.map((group) => {
      if (canonicalizeTagGroupName(group.name) !== canonicalizeTagGroupName(normalizedGroupName)) {
        return group;
      }
      const nextTags = group.tags.filter((tag) => {
        const matches = canonicalizeTagName(tag) === tagKey;
        if (matches) {
          removed = true;
        }
        return !matches;
      });
      return { ...group, tags: nextTags };
    });

    if (!removed) {
      if (outputs.tagManagerStatus) {
        outputs.tagManagerStatus.textContent = `${normalizedTagName} is not available in the removable tag list.`;
      }
      return false;
    }

    selectedTagKeys.delete(tagKey);
    preservedUnknownTags = preservedUnknownTags.filter((tag) => canonicalizeTagName(tag) !== tagKey);
    syncTagsFieldValue();
    persistOwnerTagGroups();
    refreshTagUi();
    updatePreview();
    if (outputs.tagManagerStatus) {
      outputs.tagManagerStatus.textContent = `${normalizedTagName} removed from the tag selector. No published listing was changed.`;
    }
    return true;
  };

  const getUsedProductLineUsage = () => {
    const usage = new Map();
    availableProducts.forEach((product) => {
      const name = normalizeProductLineName(product.productLine);
      if (!name) {
        return;
      }
      const key = canonicalizeProductLineName(name);
      const current = usage.get(key) || { count: 0, name };
      current.count += 1;
      usage.set(key, current);
    });
    return usage;
  };

  const getSelectableProductLines = () => {
    const merged = new Map();
    [...DEFAULT_PRODUCT_LINES, ...ownerProductLines]
      .map((entry) => normalizeProductLineName(entry))
      .filter(Boolean)
      .forEach((entry) => {
        const key = canonicalizeProductLineName(entry);
        if (!merged.has(key)) {
          merged.set(key, entry);
        }
      });

    availableProducts.forEach((product) => {
      const entry = normalizeProductLineName(product.productLine);
      if (!entry) {
        return;
      }
      const key = canonicalizeProductLineName(entry);
      if (!merged.has(key)) {
        merged.set(key, entry);
      }
    });

    const currentValue = normalizeProductLineName(fields.line?.value || "");
    if (currentValue) {
      const key = canonicalizeProductLineName(currentValue);
      if (!merged.has(key)) {
        merged.set(key, currentValue);
      }
    }

    return [...merged.values()].sort((left, right) => left.localeCompare(right));
  };

  const syncProductLineOptions = () => {
    if (!fields.line) {
      return;
    }

    const previousValue = fields.line.value;
    const selectableProductLines = getSelectableProductLines();
    const options = [];

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-";
    options.push(emptyOption);

    selectableProductLines.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry;
      option.textContent = entry;
      options.push(option);
    });

    fields.line.replaceChildren(...options);
    fields.line.value = selectableProductLines.includes(previousValue) ? previousValue : "";
  };

  const renderProductLineManager = () => {
    if (!outputs.productLineManagerList) {
      return;
    }

    const usage = getUsedProductLineUsage();
    const productLines = getSelectableProductLines();
    outputs.productLineManagerList.replaceChildren();

    productLines.forEach((name) => {
      const item = document.createElement("div");
      item.className = "product-line-manager__item";

      const copy = document.createElement("div");
      copy.className = "product-line-manager__item-copy";

      const title = document.createElement("span");
      title.className = "product-line-manager__item-name";
      title.textContent = name;
      copy.append(title);

      const note = document.createElement("span");
      note.className = "product-line-manager__item-note";
      const usageRecord = usage.get(canonicalizeProductLineName(name));
      note.textContent = usageRecord
        ? `Used by ${usageRecord.count} product${usageRecord.count === 1 ? "" : "s"}. Remove it from those listings before deleting it here.`
        : "Unused owner product line. Safe to remove without changing any published listing.";
      copy.append(note);
      item.append(copy);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "button button--secondary";
      removeButton.textContent = "Remove";
      removeButton.disabled = Boolean(usageRecord);
      removeButton.addEventListener("click", () => {
        removeOwnerProductLine(name);
      });
      item.append(removeButton);

      outputs.productLineManagerList.append(item);
    });
  };

  const refreshProductLineUi = () => {
    syncProductLineOptions();
    renderProductLineManager();
  };

  const addOwnerProductLine = (value) => {
    const name = normalizeProductLineName(value ?? (fields.productLineManagerInput?.value || ""));
    if (!name) {
      if (outputs.productLineManagerStatus) {
        outputs.productLineManagerStatus.textContent = "Enter a product line name before adding it.";
      }
      return false;
    }

    const key = canonicalizeProductLineName(name);
    if (getSelectableProductLines().some((entry) => canonicalizeProductLineName(entry) === key)) {
      if (outputs.productLineManagerStatus) {
        outputs.productLineManagerStatus.textContent = `${name} is already available in the product line list.`;
      }
      return false;
    }

    ownerProductLines = [...ownerProductLines, name];
    persistOwnerProductLines();
    refreshProductLineUi();
    if (fields.productLineManagerInput) {
      fields.productLineManagerInput.value = "";
    }
    if (outputs.productLineManagerStatus) {
      outputs.productLineManagerStatus.textContent = `${name} added. You can select it from the product line list now.`;
    }
    return true;
  };

  const removeOwnerProductLine = (value) => {
    const name = normalizeProductLineName(value);
    const key = canonicalizeProductLineName(name);
    const usage = getUsedProductLineUsage().get(key);
    if (usage) {
      if (outputs.productLineManagerStatus) {
        outputs.productLineManagerStatus.textContent = `${name} cannot be removed because ${usage.count} product${usage.count === 1 ? "" : "s"} still use it.`;
      }
      return false;
    }

    const beforeCount = ownerProductLines.length;
    ownerProductLines = ownerProductLines.filter((entry) => canonicalizeProductLineName(entry) !== key);
    if (ownerProductLines.length === beforeCount) {
      if (outputs.productLineManagerStatus) {
        outputs.productLineManagerStatus.textContent = `${name} is not in the removable owner product line list.`;
      }
      return false;
    }

    if (canonicalizeProductLineName(fields.line?.value || "") === key) {
      fields.line.value = "";
    }
    persistOwnerProductLines();
    refreshProductLineUi();
    updatePreview();
    if (outputs.productLineManagerStatus) {
      outputs.productLineManagerStatus.textContent = `${name} removed from the owner product line list. No published listing was changed.`;
    }
    return true;
  };

  buttons.reset.addEventListener("click", () => {
    const wasEditing = isEditingLoadedListing();
    if (hasUnsavedChanges() && !confirmDiscardChanges()) {
      showActionFeedback({ kind: "info", heading: "Changes preserved", message: "Unsaved listing changes are still in place." });
      return;
    }

    resetFormToDefaults({ hideDetails: wasEditing });
    showActionFeedback({
      kind: "success",
      heading: wasEditing ? "Listing changes discarded" : "New product form cleared",
      message: wasEditing
        ? "You are back at the listing picker. Published data was not changed."
        : "Published data was not changed."
    });
  });

  clearAdvisorPanel();
  ownerProductLines = readOwnerProductLines();
  ownerTagGroups = readOwnerTagGroups();
  globalThis.TRGProductIntake = {
    addOwnerProductLine,
    addOwnerTag,
    addOwnerTagGroup,
    applyPdfPrefillResultsForTests: applyPdfPrefillResults,
    applySelectedPdfPrefillSuggestionsForTests: applySelectedPdfPrefillSuggestions,
    clearPdfPrefillResultsForTests: clearPdfPrefillResults,
    getPdfReviewFileForTests: getPdfReviewFile,
    downloadPdfForReviewForTests: downloadPdfForReview,
    assignPdfImageCandidateForTests: assignPdfImageCandidate,
    clearPdfImageExtractionForTests: clearPdfImageExtraction,
    setPdfImageCandidateForTests: (role, candidate) => setPdfImageCandidate(role, candidate, (candidateRole, pageNumber) => `${candidateRole}-page-${pageNumber}.webp`),
    setAutomaticPdfProcessorsForTests: (processors) => {
      automaticPdfProcessorsForTests = processors || null;
    },
    getModeLabels,
    getPreservedUnknownTags: () => [...preservedUnknownTags],
    getSelectableProductLines,
    getSelectableTagGroups,
    loadAvailableProductsForTests: loadAvailableProducts,
    loadExistingProductIntoFormForTests: loadExistingProductIntoForm,
    getUsedTagUsage,
    getCurrentTagValues,
    getUsedProductLineUsage,
    getPdfPrefillSuggestions: () => new Map(pdfPrefillSuggestions),
    hasUnsavedChanges,
    removeOwnerProductLine,
    removeOwnerTag,
    validateRequiredFields
  };
  void loadAvailableProducts().then(() => {
    restorePersistedExistingListingDraft();
  });
  syncRelatedPicker();
  syncBuyModeUi();
  refreshProductLineUi();
  refreshTagUi();
  setProductLineManagerVisibility(false);
  setTagManagerVisibility(false);
  setJsonVisibility(false);
  setChecklistVisibility(false);
  setListingDetailsVisibility(false);
  updateActionLabels();
  updatePreview();
  updatePdfReviewControls();
  markDraftBaseline();
})();
