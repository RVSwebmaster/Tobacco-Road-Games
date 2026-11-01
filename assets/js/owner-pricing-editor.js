(() => {
  const PRICING_ENDPOINT = "/owner/api/pricing";
  const LEGACY_CATALOG_ENDPOINT = "/data/products.json";
  const DISCARD_PRICING_CHANGES_MESSAGE = "Discard unsaved pricing changes? Any unsaved pricing edits will be lost.";
  const PRICE_FIELDS = [
    "pricingModel", "availability", "priceCents", "suggestedPriceCents",
    "minimumPriceCents", "currency", "saleEnabled", "salePriceCents",
    "saleStart", "saleEnd", "saleLabel"
  ];

  const fields = {
    availability: document.getElementById("pricing-availability"),
    confirmBody: document.getElementById("pricing-confirmation-body"),
    confirmCurrentEffective: document.getElementById("pricing-confirm-current-effective"),
    confirmCurrentSaleState: document.getElementById("pricing-confirm-current-sale-state"),
    confirmEmpty: document.getElementById("pricing-confirmation-empty"),
    confirmNextEffective: document.getElementById("pricing-confirm-next-effective"),
    confirmNextSaleState: document.getElementById("pricing-confirm-next-sale-state"),
    confirmPanel: document.getElementById("pricing-confirmation"),
    confirmPreservation: document.getElementById("pricing-confirm-preservation"),
    confirmSlug: document.getElementById("pricing-confirm-slug"),
    confirmTable: document.getElementById("pricing-confirmation-table"),
    confirmTitle: document.getElementById("pricing-confirm-title"),
    currency: document.getElementById("pricing-currency"),
    currentBuyMode: document.getElementById("pricing-current-buy-mode"),
    currentDisplay: document.getElementById("pricing-current-display"),
    currentEffective: document.getElementById("pricing-current-effective"),
    currentRevision: document.getElementById("pricing-current-revision"),
    currentSlug: document.getElementById("pricing-current-slug"),
    currentSource: document.getElementById("pricing-current-source"),
    currentStatus: document.getElementById("pricing-current-status"),
    currentTitle: document.getElementById("pricing-current-title"),
    editorPanel: document.getElementById("pricing-editor-panel"),
    existingSelect: document.getElementById("pricing-product-select"),
    loadCopy: document.getElementById("pricing-load-copy"),
    minimumPrice: document.getElementById("pricing-minimum-price"),
    modeIndicator: document.getElementById("pricing-mode-indicator"),
    nextDisplay: document.getElementById("pricing-next-display"),
    nextEffective: document.getElementById("pricing-next-effective"),
    nonPurchasableConfirm: document.getElementById("pricing-nonpurchasable-confirm"),
    previewCopy: document.getElementById("pricing-preview-copy"),
    pricingModel: document.getElementById("pricing-model"),
    pricingStatus: document.getElementById("pricing-status"),
    regularPrice: document.getElementById("pricing-regular-price"),
    regularPriceLabel: document.getElementById("pricing-regular-price-label"),
    saleEnabled: document.getElementById("pricing-sale-enabled"),
    saleEnd: document.getElementById("pricing-sale-end"),
    saleLabel: document.getElementById("pricing-sale-label"),
    salePrice: document.getElementById("pricing-sale-price"),
    saleStart: document.getElementById("pricing-sale-start"),
    saleWarning: document.getElementById("pricing-sale-warning"),
    suggestedPrice: document.getElementById("pricing-suggested-price")
  };
  const buttons = {
    cancelReview: document.getElementById("pricing-cancel-review-button"),
    check: document.getElementById("pricing-check-button"),
    load: document.getElementById("pricing-load-button"),
    publish: document.getElementById("pricing-publish-button"),
    reset: document.getElementById("pricing-reset-button"),
    review: document.getElementById("pricing-review-button")
  };

  let availableProducts = [];
  let csrfToken = "";
  let loadedProduct = null;
  let pendingPatch = null;
  let publishBusy = false;

  function normalizeMoneyText(value) {
    return String(value || "").trim().replace(/\$/g, "").replace(/,/g, "");
  }
  function isMoneyLike(value) {
    return /^\d+(?:\.\d{1,2})?$/.test(String(value || ""));
  }
  function deriveMoneyCents(value) {
    const normalized = normalizeMoneyText(value);
    if (!normalized || !isMoneyLike(normalized)) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
  }
  function formatMoneyText(cents) {
    return Number.isInteger(cents) ? (cents / 100).toFixed(2) : "";
  }
  function formatCents(cents, currency = "USD") {
    if (!Number.isInteger(cents)) return "Not set";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
  }
  function parseDateStamp(value) {
    const stamp = value ? Date.parse(value) : 0;
    return Number.isFinite(stamp) ? stamp : 0;
  }
  function isValidDateText(value) {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function isSaleActive(product, now = Date.now()) {
    if (!product.saleEnabled || !Number.isInteger(product.salePriceCents) || product.pricingModel !== "fixed") return false;
    const start = parseDateStamp(product.saleStart);
    const end = parseDateStamp(product.saleEnd);
    return (!start || now >= start) && (!end || now <= end + 86400000 - 1);
  }
  function getEffectivePriceCents(product, now = Date.now()) {
    if (product.pricingModel === "free") return 0;
    if (product.pricingModel === "pwyw") return product.suggestedPriceCents;
    return isSaleActive(product, now) ? product.salePriceCents : product.priceCents;
  }
  function buildProductSelectLabel(product) {
    const source = product.source === "native-d1" ? "Native D1" : "Legacy · read only";
    return `[${source}] ${product.title} (${product.slug})`;
  }
  function createCurrentPricingView(product) {
    return {
      availability: product.availability || (product.publicationState === "published" ? "available" : "paused"),
      currency: String(product.currency || "USD").trim().toUpperCase(),
      minimumPriceCents: integerOrNull(product.minimumPriceCents),
      priceCents: integerOrNull(product.priceCents),
      pricingModel: String(product.pricingModel || "fixed"),
      saleEnabled: Boolean(product.saleEnabled),
      saleEnd: String(product.saleEnd || ""),
      saleLabel: String(product.saleLabel || ""),
      salePriceCents: integerOrNull(product.salePriceCents),
      saleStart: String(product.saleStart || ""),
      suggestedPriceCents: integerOrNull(product.suggestedPriceCents)
    };
  }
  function integerOrNull(value) {
    return Number.isSafeInteger(value) ? value : null;
  }
  function buildDraftFromInputs() {
    const pricingModel = fields.pricingModel.value;
    const fixedPrice = deriveMoneyCents(fields.regularPrice.value);
    const suggestedPriceCents = deriveMoneyCents(fields.suggestedPrice.value);
    const minimumPriceCents = deriveMoneyCents(fields.minimumPrice.value);
    return {
      availability: fields.availability.value,
      currency: String(fields.currency.value || "").trim().toUpperCase(),
      minimumPriceCents: pricingModel === "pwyw" ? minimumPriceCents : null,
      priceCents: pricingModel === "free" ? 0 : pricingModel === "pwyw" ? suggestedPriceCents : fixedPrice,
      pricingModel,
      saleConfirmed: Boolean(fields.nonPurchasableConfirm.checked),
      saleEnabled: pricingModel === "fixed" && Boolean(fields.saleEnabled.checked),
      saleEnd: pricingModel === "fixed" ? String(fields.saleEnd.value || "").trim() : "",
      saleLabel: pricingModel === "fixed" ? String(fields.saleLabel.value || "").trim() : "",
      salePriceCents: pricingModel === "fixed" && fields.saleEnabled.checked ? deriveMoneyCents(fields.salePrice.value) : null,
      saleStart: pricingModel === "fixed" ? String(fields.saleStart.value || "").trim() : "",
      suggestedPriceCents: pricingModel === "pwyw" ? suggestedPriceCents : null
    };
  }
  function validateDraft(product, draft) {
    const errors = [];
    if (!product?.slug || product.source !== "native-d1") errors.push("Load an editable native D1 product first.");
    if (!product?.editable) errors.push("This native product is not in an editable published or paused state.");
    if (!["fixed", "free", "pwyw"].includes(draft.pricingModel)) errors.push("Choose a valid pricing model.");
    if (!["available", "paused"].includes(draft.availability)) errors.push("Choose Available or Paused storefront availability.");
    if (!/^[A-Z]{3}$/.test(draft.currency)) errors.push("Currency must be a three-letter code such as USD.");
    if (draft.pricingModel === "fixed" && (!Number.isInteger(draft.priceCents) || draft.priceCents <= 0)) {
      errors.push("Fixed price must be a valid amount greater than zero.");
    }
    if (draft.pricingModel === "pwyw") {
      if (!Number.isInteger(draft.suggestedPriceCents) || draft.suggestedPriceCents < 0) errors.push("PWYW suggested price must be a valid nonnegative amount.");
      if (!Number.isInteger(draft.minimumPriceCents) || draft.minimumPriceCents < 0) errors.push("PWYW minimum price must be a valid nonnegative amount.");
      if (Number.isInteger(draft.suggestedPriceCents) && Number.isInteger(draft.minimumPriceCents)
        && draft.suggestedPriceCents < draft.minimumPriceCents) errors.push("PWYW suggested price must be at or above its minimum.");
    }
    if (draft.pricingModel === "fixed" && draft.saleEnabled) {
      if (!Number.isInteger(draft.salePriceCents) || draft.salePriceCents <= 0) errors.push("Sale price must be a valid amount greater than zero.");
      else if (Number.isInteger(draft.priceCents) && draft.salePriceCents >= draft.priceCents) errors.push("Sale price must be lower than the fixed price.");
      if (!draft.saleConfirmed) errors.push("Confirm the reviewed fixed-price sale fields before saving.");
    }
    if (!isValidDateText(draft.saleStart)) errors.push("Sale start must be a valid date.");
    if (!isValidDateText(draft.saleEnd)) errors.push("Sale end must be a valid date.");
    if (draft.saleStart && draft.saleEnd && parseDateStamp(draft.saleEnd) < parseDateStamp(draft.saleStart)) {
      errors.push("Sale end cannot be earlier than sale start.");
    }
    return errors;
  }
  function buildPatch(product, draft) {
    return { current: createCurrentPricingView(product), next: { ...draft }, slug: product.slug, expectedRevision: product.revision };
  }
  function buildFieldChanges(patch) {
    return PRICE_FIELDS.filter(name => normalizeCompareValue(patch.current[name]) !== normalizeCompareValue(patch.next[name]))
      .map(fieldName => ({ fieldName, current: patch.current[fieldName], next: patch.next[fieldName] }));
  }
  function normalizeCompareValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }
  function formatFieldValue(fieldName, value, currency) {
    if (fieldName.endsWith("Cents")) return Number.isInteger(value) ? `${value} (${formatCents(value, currency)})` : "Not set";
    if (fieldName === "saleEnabled") return value ? "true" : "false";
    return String(value || "Not set");
  }
  function buildSaleStateLabel(product) {
    if (product.pricingModel !== "fixed") return "Sales do not apply";
    if (!product.saleEnabled) return "Sale disabled";
    return `Sale enabled at ${formatCents(product.salePriceCents, product.currency)}. Window: ${product.saleStart || "no start"} to ${product.saleEnd || "no end"}`;
  }

  function syncModelControls({ preserveValues = true } = {}) {
    const model = fields.pricingModel.value;
    const fixed = model === "fixed";
    const pwyw = model === "pwyw";
    fields.regularPrice.disabled = !fixed;
    fields.regularPriceLabel.textContent = fixed ? "Fixed Price (USD style)" : model === "free" ? "Price (Free)" : "Listed Price (matches PWYW suggested)";
    fields.suggestedPrice.disabled = !pwyw;
    fields.minimumPrice.disabled = !pwyw;
    for (const field of [fields.saleEnabled, fields.salePrice, fields.saleStart, fields.saleEnd, fields.saleLabel]) field.disabled = !fixed;
    if (!preserveValues) {
      if (model === "free") fields.regularPrice.value = "0.00";
      if (!pwyw) {
        fields.suggestedPrice.value = "";
        fields.minimumPrice.value = "";
      }
      if (!fixed) {
        fields.saleEnabled.checked = false;
        fields.salePrice.value = "";
        fields.saleStart.value = "";
        fields.saleEnd.value = "";
        fields.saleLabel.value = "";
      }
    }
  }
  function updateWarningState(draft) {
    const needsConfirmation = draft.pricingModel === "fixed" && draft.saleEnabled;
    fields.saleWarning.hidden = !needsConfirmation;
    if (!needsConfirmation) fields.nonPurchasableConfirm.checked = false;
  }
  function updatePreview() {
    if (!loadedProduct?.editable) return;
    const current = createCurrentPricingView(loadedProduct);
    const draft = buildDraftFromInputs();
    fields.currentDisplay.textContent = formatCents(current.priceCents, current.currency);
    fields.currentEffective.textContent = formatCents(getEffectivePriceCents(current), current.currency);
    fields.nextDisplay.textContent = formatCents(draft.priceCents, draft.currency);
    fields.nextEffective.textContent = formatCents(getEffectivePriceCents(draft), draft.currency);
    fields.previewCopy.textContent = draft.availability === "paused"
      ? "The product will be hidden from active storefront discovery and rejected by new cart quotes."
      : "The resulting native price will be visible to the storefront and authoritative for new cart quotes immediately after save.";
    updateWarningState(draft);
  }
  function hasUnsavedChanges() {
    if (!loadedProduct?.editable) return false;
    return buildFieldChanges(buildPatch(loadedProduct, buildDraftFromInputs())).length > 0;
  }
  function confirmDiscardPricingChanges() {
    return typeof globalThis.confirm !== "function" || globalThis.confirm(DISCARD_PRICING_CHANGES_MESSAGE);
  }

  function populateLoadedProduct(product) {
    loadedProduct = product;
    pendingPatch = null;
    fields.confirmPanel.hidden = true;
    fields.currentTitle.textContent = product.title;
    fields.currentSlug.textContent = product.slug;
    fields.currentStatus.textContent = `${product.publicationState || "legacy"} · ${product.status || "not set"}`;
    fields.currentBuyMode.textContent = product.buyMode || "Not set";
    fields.currentSource.textContent = product.source === "native-d1" ? "Native D1" : "Legacy generated catalog (read only)";
    fields.currentRevision.textContent = Number.isInteger(product.revision) ? String(product.revision) : "Not applicable";
    fields.modeIndicator.textContent = `Editing Existing Listing: ${product.title}`;
    if (product.source !== "native-d1") {
      fields.editorPanel.hidden = true;
      fields.loadCopy.textContent = `${product.title} is legacy-only and remains read-only until migration into the native D1 catalog.`;
      fields.pricingStatus.textContent = "Legacy-only products cannot be changed by this native pricing editor.";
      return;
    }
    if (!product.editable) {
      fields.editorPanel.hidden = true;
      fields.loadCopy.textContent = `${product.title} is a native D1 product, but its ${product.publicationState} state is not editable here.`;
      fields.pricingStatus.textContent = "Only published and paused native products can be managed by this editor.";
      return;
    }
    fields.editorPanel.hidden = false;
    fields.loadCopy.textContent = `Loaded native D1 product ${product.title} at revision ${product.revision}.`;
    resetEditorFromLoadedProduct();
  }
  function resetEditorFromLoadedProduct() {
    if (!loadedProduct?.editable) return;
    const current = createCurrentPricingView(loadedProduct);
    fields.pricingModel.value = current.pricingModel;
    fields.availability.value = current.availability;
    fields.regularPrice.value = formatMoneyText(current.priceCents);
    fields.suggestedPrice.value = formatMoneyText(current.suggestedPriceCents);
    fields.minimumPrice.value = formatMoneyText(current.minimumPriceCents);
    fields.currency.value = current.currency;
    fields.saleEnabled.checked = current.saleEnabled;
    fields.salePrice.value = formatMoneyText(current.salePriceCents);
    fields.saleStart.value = current.saleStart;
    fields.saleEnd.value = current.saleEnd;
    fields.saleLabel.value = current.saleLabel;
    fields.nonPurchasableConfirm.checked = false;
    fields.pricingStatus.textContent = "";
    fields.confirmPanel.hidden = true;
    pendingPatch = null;
    buttons.publish.disabled = true;
    syncModelControls();
    updatePreview();
  }

  async function loadAvailableProducts() {
    fields.pricingStatus.textContent = "Loading native and legacy catalog identities...";
    try {
      const [nativeResponse, legacyResponse] = await Promise.all([
        fetch(PRICING_ENDPOINT, { credentials: "same-origin", headers: { accept: "application/json" } }),
        fetch(LEGACY_CATALOG_ENDPOINT, { cache: "no-store", credentials: "same-origin" }).catch(() => null)
      ]);
      const nativePayload = await nativeResponse.json();
      if (!nativeResponse.ok) throw new Error(nativePayload.error || "Native pricing catalog could not be loaded.");
      csrfToken = String(nativePayload.csrfToken || "");
      if (!csrfToken) throw new Error("Owner pricing security token was not returned.");
      const nativeProducts = Array.isArray(nativePayload.products) ? nativePayload.products : [];
      const nativeSlugs = new Set(nativeProducts.map(product => product.slug));
      let legacyProducts = [];
      if (legacyResponse?.ok) {
        const legacyPayload = await legacyResponse.json();
        if (Array.isArray(legacyPayload)) {
          legacyProducts = legacyPayload.filter(product => product?.slug && !nativeSlugs.has(product.slug)).map(legacyProduct);
        }
      }
      availableProducts = [...nativeProducts, ...legacyProducts].sort((left, right) => {
        if (left.source !== right.source) return left.source === "native-d1" ? -1 : 1;
        return left.title.localeCompare(right.title);
      });
      fields.existingSelect.innerHTML = [
        `<option value="">${availableProducts.length ? "Select an existing product" : "No products available"}</option>`,
        ...availableProducts.map(product => `<option value="${escapeHtml(product.slug)}">${escapeHtml(buildProductSelectLabel(product))}</option>`)
      ].join("");
      fields.pricingStatus.textContent = "";
    } catch (error) {
      availableProducts = [];
      fields.existingSelect.innerHTML = `<option value="">Native pricing unavailable</option>`;
      fields.pricingStatus.textContent = error?.message || "Native pricing catalog could not be loaded.";
    }
  }
  function legacyProduct(product) {
    return {
      buyMode: String(product.buyMode || ""), currency: String(product.currency || "USD"), editable: false,
      priceCents: Number.isInteger(product.priceCents) ? product.priceCents : deriveMoneyCents(product.price),
      pricingModel: String(product.pricingModel || (product.status === "pay-what-you-want" ? "pwyw" : "fixed")),
      publicationState: "legacy-only", revision: null, slug: String(product.slug), source: "legacy",
      status: String(product.status || ""), title: String(product.title || product.slug)
    };
  }
  function loadSelectedProduct() {
    const slug = String(fields.existingSelect.value || "").trim();
    const product = availableProducts.find(entry => entry.slug === slug);
    if (!slug) fields.pricingStatus.textContent = "Select an existing product first.";
    else if (!product) fields.pricingStatus.textContent = "That product could not be loaded from the current catalogs.";
    else populateLoadedProduct(product);
  }

  function checkPricing() {
    if (!loadedProduct?.editable) return void (fields.pricingStatus.textContent = "Load an editable native D1 product first.");
    const errors = validateDraft(loadedProduct, buildDraftFromInputs());
    fields.confirmPanel.hidden = true;
    pendingPatch = null;
    buttons.publish.disabled = true;
    fields.pricingStatus.textContent = errors.length ? errors.join(" ") : "Pricing and availability are valid. Nothing has been saved yet.";
  }
  function reviewChanges() {
    if (!loadedProduct?.editable) return void (fields.pricingStatus.textContent = "Load an editable native D1 product first.");
    const draft = buildDraftFromInputs();
    const errors = validateDraft(loadedProduct, draft);
    if (errors.length) {
      fields.pricingStatus.textContent = errors.join(" ");
      fields.confirmPanel.hidden = true;
      pendingPatch = null;
      buttons.publish.disabled = true;
      return;
    }
    renderConfirmation(buildPatch(loadedProduct, draft));
  }
  function renderConfirmation(patch) {
    const changes = buildFieldChanges(patch);
    fields.confirmBody.replaceChildren();
    fields.confirmTitle.textContent = loadedProduct.title;
    fields.confirmSlug.textContent = loadedProduct.slug;
    fields.confirmCurrentEffective.textContent = formatCents(getEffectivePriceCents(patch.current), patch.current.currency);
    fields.confirmNextEffective.textContent = formatCents(getEffectivePriceCents(patch.next), patch.next.currency);
    fields.confirmCurrentSaleState.textContent = buildSaleStateLabel(patch.current);
    fields.confirmNextSaleState.textContent = buildSaleStateLabel(patch.next);
    fields.confirmPreservation.textContent = "Stable product ID, slug, Creator ownership, R2 references, descriptions, prior orders, and entitlements will not change.";
    fields.confirmPanel.hidden = false;
    fields.confirmEmpty.hidden = Boolean(changes.length);
    fields.confirmTable.hidden = !changes.length;
    fields.confirmEmpty.textContent = changes.length ? "" : "No pricing or availability changes are queued.";
    pendingPatch = changes.length ? patch : null;
    buttons.publish.disabled = !pendingPatch;
    fields.pricingStatus.textContent = changes.length
      ? `Review ${changes.length} change${changes.length === 1 ? "" : "s"} from native revision ${patch.expectedRevision}. Nothing has been saved yet.`
      : "No pricing or availability changes are queued.";
    for (const change of changes) {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(change.fieldName)}</td><td>${escapeHtml(formatFieldValue(change.fieldName, change.current, patch.current.currency))}</td><td>${escapeHtml(formatFieldValue(change.fieldName, change.next, patch.next.currency))}</td>`;
      fields.confirmBody.append(row);
    }
  }
  async function publishPricingUpdate() {
    if (!pendingPatch || publishBusy) return;
    publishBusy = true;
    buttons.publish.disabled = true;
    fields.pricingStatus.textContent = `Updating native revision ${pendingPatch.expectedRevision}...`;
    const requestPatch = pendingPatch;
    try {
      const response = await fetch(PRICING_ENDPOINT, {
        body: JSON.stringify({
          ...requestPatch.next,
          expectedRevision: requestPatch.expectedRevision,
          saleConfirmed: undefined,
          slug: requestPatch.slug
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        method: "POST",
        redirect: "manual"
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        if (response.status === 409 && payload.json.product) {
          replaceAvailableProduct(payload.json.product);
          populateLoadedProduct(payload.json.product);
          fields.pricingStatus.textContent = payload.json.error || "Revision conflict. Current native values were reloaded.";
        } else {
          fields.pricingStatus.textContent = payload.json.error || formatUnexpectedResponseError("Pricing update", payload);
        }
        return;
      }
      if (!payload.json.product?.revision || payload.json.product.slug !== requestPatch.slug) {
        throw new Error("The server did not return the updated native product revision.");
      }
      replaceAvailableProduct(payload.json.product);
      populateLoadedProduct(payload.json.product);
      fields.pricingStatus.textContent = `${payload.json.message} Revision ${payload.json.product.revision} is now authoritative.`;
    } catch (error) {
      fields.pricingStatus.textContent = `The pricing update request failed before a verified response: ${error?.message || "network failure"}`;
    } finally {
      publishBusy = false;
      buttons.publish.disabled = true;
    }
  }
  function replaceAvailableProduct(product) {
    const index = availableProducts.findIndex(entry => entry.slug === product.slug);
    if (index >= 0) availableProducts[index] = product;
    else availableProducts.unshift(product);
  }

  async function readResponsePayload(response) {
    const rawText = await response.text().catch(() => "");
    let json = {};
    try { json = JSON.parse(rawText); } catch {}
    return { bodySummary: summarizeResponseBody(rawText), contentType: String(response.headers?.get?.("content-type") || "unknown"), json, status: Number(response.status || 0) };
  }
  function formatUnexpectedResponseError(label, payload) {
    return `${label} failed with HTTP ${payload.status || "unknown"}. ${payload.bodySummary || "No response body was returned."}`;
  }
  function summarizeResponseBody(value) {
    const cleaned = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
  }
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  for (const field of [fields.availability, fields.currency, fields.minimumPrice, fields.regularPrice,
    fields.saleEnd, fields.saleLabel, fields.salePrice, fields.saleStart, fields.suggestedPrice]) {
    field?.addEventListener("input", updatePreview);
    field?.addEventListener("change", updatePreview);
  }
  fields.pricingModel?.addEventListener("change", () => { syncModelControls({ preserveValues: false }); updatePreview(); });
  fields.saleEnabled?.addEventListener("change", updatePreview);
  fields.nonPurchasableConfirm?.addEventListener("change", updatePreview);
  buttons.load?.addEventListener("click", loadSelectedProduct);
  buttons.check?.addEventListener("click", checkPricing);
  buttons.review?.addEventListener("click", reviewChanges);
  buttons.publish?.addEventListener("click", publishPricingUpdate);
  buttons.reset?.addEventListener("click", () => {
    if (hasUnsavedChanges() && !confirmDiscardPricingChanges()) return void (fields.pricingStatus.textContent = "Pricing edits are still in place.");
    resetEditorFromLoadedProduct();
    fields.pricingStatus.textContent = "Loaded native pricing values restored. D1 was not changed.";
  });
  buttons.cancelReview?.addEventListener("click", () => {
    fields.confirmPanel.hidden = true;
    pendingPatch = null;
    buttons.publish.disabled = true;
    fields.pricingStatus.textContent = "Pricing review closed. You can keep editing.";
  });

  globalThis.TRGPricingEditor = {
    PRICE_FIELDS, buildFieldChanges, buildPatch, buildProductSelectLabel, createCurrentPricingView,
    deriveMoneyCents, formatCents, formatMoneyText, getEffectivePriceCents, hasUnsavedChanges,
    isMoneyLike, isSaleActive, validateDraft, buildSaleStateLabel
  };
  fields.modeIndicator.textContent = "Editing Existing Listing: Select a product to begin.";
  void loadAvailableProducts().finally(() => {
    if (document.documentElement?.dataset) document.documentElement.dataset.ownerPricingRuntime = "ready";
  });
})();
