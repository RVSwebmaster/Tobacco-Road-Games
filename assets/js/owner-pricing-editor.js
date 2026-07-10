(() => {
  const PRICING_ENDPOINT = "/owner/api/pricing";
  const DISCARD_PRICING_CHANGES_MESSAGE = "Discard unsaved pricing changes? Any unpublished pricing edits will be lost.";
  const PRICE_FIELDS = [
    "price",
    "priceCents",
    "currency",
    "regularPrice",
    "regularPriceCents",
    "saleEnabled",
    "salePrice",
    "salePriceCents",
    "saleStart",
    "saleEnd",
    "saleLabel"
  ];
  const PAID_INTENT_BUY_MODES = new Set(["cart", "fixed-price", "manual-invoice", "pay-what-you-want"]);

  const fields = {
    checkHelp: document.getElementById("pricing-check-help"),
    checkButton: document.getElementById("pricing-check-button"),
    currentBuyMode: document.getElementById("pricing-current-buy-mode"),
    currentDisplay: document.getElementById("pricing-current-display"),
    currentEffective: document.getElementById("pricing-current-effective"),
    currentSlug: document.getElementById("pricing-current-slug"),
    currentStatus: document.getElementById("pricing-current-status"),
    currentTitle: document.getElementById("pricing-current-title"),
    confirmCurrentEffective: document.getElementById("pricing-confirm-current-effective"),
    confirmCurrentSaleState: document.getElementById("pricing-confirm-current-sale-state"),
    currency: document.getElementById("pricing-currency"),
    confirmNextEffective: document.getElementById("pricing-confirm-next-effective"),
    confirmNextSaleState: document.getElementById("pricing-confirm-next-sale-state"),
    confirmPreservation: document.getElementById("pricing-confirm-preservation"),
    confirmSlug: document.getElementById("pricing-confirm-slug"),
    confirmTitle: document.getElementById("pricing-confirm-title"),
    editorPanel: document.getElementById("pricing-editor-panel"),
    existingSelect: document.getElementById("pricing-product-select"),
    loadCopy: document.getElementById("pricing-load-copy"),
    modeIndicator: document.getElementById("pricing-mode-indicator"),
    nextDisplay: document.getElementById("pricing-next-display"),
    nextEffective: document.getElementById("pricing-next-effective"),
    nonPurchasableConfirm: document.getElementById("pricing-nonpurchasable-confirm"),
    previewCopy: document.getElementById("pricing-preview-copy"),
    pricingStatus: document.getElementById("pricing-status"),
    regularPrice: document.getElementById("pricing-regular-price"),
    saleEnabled: document.getElementById("pricing-sale-enabled"),
    saleEnd: document.getElementById("pricing-sale-end"),
    saleLabel: document.getElementById("pricing-sale-label"),
    salePrice: document.getElementById("pricing-sale-price"),
    saleStart: document.getElementById("pricing-sale-start"),
    saleWarning: document.getElementById("pricing-sale-warning"),
    confirmBody: document.getElementById("pricing-confirmation-body"),
    confirmEmpty: document.getElementById("pricing-confirmation-empty"),
    confirmPanel: document.getElementById("pricing-confirmation"),
    confirmTable: document.getElementById("pricing-confirmation-table")
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
  let loadedProduct = null;
  let pendingPatch = null;
  let publishBusy = false;

  function normalizeMoneyText(value) {
    return String(value || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "");
  }

  function isMoneyLike(value) {
    return /^\d+(?:\.\d{1,2})?$/.test(String(value || ""));
  }

  function deriveMoneyCents(value) {
    const numeric = Number(normalizeMoneyText(value));
    return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
  }

  function formatMoneyText(value) {
    if (value === null || value === undefined) {
      return "";
    }
    const normalized = typeof value === "string" ? normalizeMoneyText(value) : value;
    if (normalized === "") {
      return "";
    }
    const cents = Number.isInteger(normalized) ? normalized : deriveMoneyCents(normalized);
    if (!Number.isInteger(cents)) {
      return "";
    }
    return (cents / 100).toFixed(2);
  }

  function formatCents(cents, currency = "USD") {
    if (!Number.isInteger(cents)) {
      return "Not set";
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").trim() || "USD"
    }).format(cents / 100);
  }

  function normalizeDateText(value) {
    return String(value || "").trim();
  }

  function isValidDateText(value) {
    if (!value) {
      return true;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    return !Number.isNaN(Date.parse(value));
  }

  function parseDateStamp(value) {
    if (!value) {
      return 0;
    }
    const stamp = Date.parse(value);
    return Number.isNaN(stamp) ? 0 : stamp;
  }

  function isSaleActive(product, now = Date.now()) {
    if (!product.saleEnabled || !Number.isInteger(product.salePriceCents) || product.salePriceCents <= 0) {
      return false;
    }

    const start = parseDateStamp(product.saleStart);
    const end = parseDateStamp(product.saleEnd);
    if (start && now < start) {
      return false;
    }
    if (end && now > end + 86400000 - 1) {
      return false;
    }

    return true;
  }

  function getEffectivePriceCents(product, now = Date.now()) {
    return isSaleActive(product, now) ? product.salePriceCents : product.priceCents;
  }

  function usesPaidPricingIntent(product) {
    return product?.status === "available-direct" || PAID_INTENT_BUY_MODES.has(String(product?.buyMode || "").trim());
  }

  function hasAnySaleField(draft) {
    return Boolean(
      draft.saleEnabled
      || draft.salePrice
      || draft.saleStart
      || draft.saleEnd
      || draft.saleLabel
    );
  }

  function buildSaleStateLabel(product) {
    if (!product.saleEnabled) {
      return "Sale disabled";
    }

    const salePriceLabel = Number.isInteger(product.salePriceCents)
      ? formatCents(product.salePriceCents, product.currency)
      : "No sale price set";
    const start = normalizeDateText(product.saleStart);
    const end = normalizeDateText(product.saleEnd);
    const windowText = start || end
      ? `Window: ${start || "no start"} to ${end || "no end"}`
      : "Window: no schedule";

    return `Sale enabled at ${salePriceLabel}. ${windowText}`;
  }

  function getCookie(name) {
    const cookies = document.cookie.split(";").map((entry) => entry.trim()).filter(Boolean);
    for (const cookie of cookies) {
      const separator = cookie.indexOf("=");
      if (separator === -1) {
        continue;
      }
      if (cookie.slice(0, separator) === name) {
        return cookie.slice(separator + 1);
      }
    }
    return "";
  }

  function buildProductSelectLabel(product) {
    return `${product.title} (${product.slug})`;
  }

  function createCurrentPricingView(product) {
    return {
      buyMode: String(product.buyMode || "").trim(),
      currency: String(product.currency || "USD").trim() || "USD",
      price: normalizeMoneyText(product.price),
      priceCents: Number.isInteger(product.priceCents) ? product.priceCents : deriveMoneyCents(product.price),
      regularPrice: normalizeMoneyText(product.regularPrice) || normalizeMoneyText(product.price),
      regularPriceCents: Number.isInteger(product.regularPriceCents) ? product.regularPriceCents : (Number.isInteger(product.priceCents) ? product.priceCents : deriveMoneyCents(product.price)),
      saleEnabled: Boolean(product.saleEnabled),
      saleEnd: normalizeDateText(product.saleEnd),
      saleLabel: String(product.saleLabel || "").trim(),
      salePrice: normalizeMoneyText(product.salePrice),
      salePriceCents: Number.isInteger(product.salePriceCents) ? product.salePriceCents : deriveMoneyCents(product.salePrice),
      saleStart: normalizeDateText(product.saleStart),
      slug: String(product.slug || "").trim(),
      status: String(product.status || "").trim(),
      title: String(product.title || product.slug || "").trim()
    };
  }

  function buildDraftFromInputs() {
    const price = normalizeMoneyText(fields.regularPrice.value);
    const salePrice = normalizeMoneyText(fields.salePrice.value);
    const currency = String(fields.currency.value || "").trim().toUpperCase();
    return {
      currency,
      nonPurchasableSaleConfirmed: Boolean(fields.nonPurchasableConfirm.checked),
      price,
      priceCents: deriveMoneyCents(price),
      regularPrice: price,
      regularPriceCents: deriveMoneyCents(price),
      saleEnabled: Boolean(fields.saleEnabled.checked),
      saleEnd: normalizeDateText(fields.saleEnd.value),
      saleLabel: String(fields.saleLabel.value || "").trim(),
      salePrice,
      salePriceCents: salePrice ? deriveMoneyCents(salePrice) : null,
      saleStart: normalizeDateText(fields.saleStart.value),
      slug: loadedProduct?.slug || ""
    };
  }

  function validateDraft(product, draft) {
    const errors = [];
    if (!product?.slug) {
      errors.push("Load an existing product first.");
    }
    if (!draft.price) {
      errors.push("Regular price is required.");
    } else if (!isMoneyLike(draft.price)) {
      errors.push("Regular price must be a valid dollar amount.");
    } else if (!Number.isInteger(draft.priceCents) || draft.priceCents <= 0) {
      errors.push("Regular price must be a positive amount greater than zero.");
    }

    if (!/^[A-Z]{3}$/.test(draft.currency)) {
      errors.push("Currency must be a three-letter code such as USD.");
    }

    if (draft.salePrice) {
      if (!isMoneyLike(draft.salePrice)) {
        errors.push("Sale price must be a valid dollar amount.");
      } else if (!Number.isInteger(draft.salePriceCents) || draft.salePriceCents <= 0) {
        errors.push("Sale price must be a positive amount greater than zero.");
      } else if (Number.isInteger(draft.priceCents) && draft.salePriceCents >= draft.priceCents) {
        errors.push("Sale price must be lower than the regular price.");
      }
    }

    if (draft.saleEnabled && !draft.salePrice) {
      errors.push("A sale price is required when sale mode is enabled.");
    }

    if (!isValidDateText(draft.saleStart)) {
      errors.push("Sale start must be a valid date.");
    }
    if (!isValidDateText(draft.saleEnd)) {
      errors.push("Sale end must be a valid date.");
    }
    if (draft.saleStart && draft.saleEnd && parseDateStamp(draft.saleEnd) < parseDateStamp(draft.saleStart)) {
      errors.push("Sale end cannot be earlier than sale start.");
    }

    if (!usesPaidPricingIntent(product) && hasAnySaleField(draft) && !draft.nonPurchasableSaleConfirmed) {
      errors.push("Confirm catalog-only sale metadata before saving sale fields on a product that is not currently in a paid storefront mode.");
    }

    return errors;
  }

  function buildPatch(product, draft) {
    return {
      current: createCurrentPricingView(product),
      next: {
        currency: draft.currency,
        price: draft.price,
        priceCents: draft.priceCents,
        regularPrice: draft.price,
        regularPriceCents: draft.priceCents,
        saleEnabled: draft.saleEnabled,
        saleEnd: draft.saleEnd,
        saleLabel: draft.saleLabel,
        salePrice: draft.salePrice,
        salePriceCents: draft.salePriceCents,
        saleStart: draft.saleStart,
        slug: draft.slug
      },
      nonPurchasableSaleConfirmed: draft.nonPurchasableSaleConfirmed,
      slug: product.slug
    };
  }

  function buildFieldChanges(patch) {
    return PRICE_FIELDS
      .filter((fieldName) => normalizeCompareValue(patch.current[fieldName]) !== normalizeCompareValue(patch.next[fieldName]))
      .map((fieldName) => ({
        fieldName,
        current: patch.current[fieldName],
        next: patch.next[fieldName]
      }));
  }

  function normalizeCompareValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function formatFieldValue(fieldName, value, currency) {
    if (fieldName.endsWith("Cents")) {
      return Number.isInteger(value) ? `${value} (${formatCents(value, currency)})` : "Not set";
    }
    if (fieldName === "saleEnabled") {
      return value ? "true" : "false";
    }
    return String(value || "Not set");
  }

  function updateWarningState(draft) {
    const needsConfirmation = Boolean(loadedProduct && !usesPaidPricingIntent(loadedProduct) && hasAnySaleField(draft));
    fields.saleWarning.hidden = !needsConfirmation;
    if (!needsConfirmation) {
      fields.nonPurchasableConfirm.checked = false;
    }
  }

  function updatePreview() {
    if (!loadedProduct) {
      return;
    }

    const currentView = createCurrentPricingView(loadedProduct);
    const draft = buildDraftFromInputs();
    const projected = buildPatch(loadedProduct, draft).next;
    const now = Date.now();
    fields.currentDisplay.textContent = formatCents(currentView.priceCents, currentView.currency);
    fields.currentEffective.textContent = formatCents(getEffectivePriceCents(currentView, now), currentView.currency);
    fields.nextDisplay.textContent = formatCents(projected.priceCents, projected.currency);
    fields.nextEffective.textContent = formatCents(getEffectivePriceCents(projected, now), projected.currency);
    fields.previewCopy.textContent = projected.saleEnabled
      ? "Sale scheduling is previewed against the current date. Store pages will still verify the effective price during regeneration."
      : "The regular listed price will be used until a valid sale is enabled and scheduled.";
    updateWarningState(draft);
  }

  function hasUnsavedChanges() {
    if (!loadedProduct) {
      return false;
    }

    const patch = buildPatch(loadedProduct, buildDraftFromInputs());
    return buildFieldChanges(patch).length > 0;
  }

  function confirmDiscardPricingChanges() {
    const confirmFn = globalThis.confirm;
    if (typeof confirmFn !== "function") {
      return true;
    }
    return confirmFn(DISCARD_PRICING_CHANGES_MESSAGE);
  }

  function resetEditorFromLoadedProduct() {
    if (!loadedProduct) {
      return;
    }
    fields.regularPrice.value = formatMoneyText(loadedProduct.price);
    fields.currency.value = String(loadedProduct.currency || "USD").trim() || "USD";
    fields.saleEnabled.checked = Boolean(loadedProduct.saleEnabled);
    fields.salePrice.value = formatMoneyText(loadedProduct.salePrice);
    fields.saleStart.value = normalizeDateText(loadedProduct.saleStart);
    fields.saleEnd.value = normalizeDateText(loadedProduct.saleEnd);
    fields.saleLabel.value = String(loadedProduct.saleLabel || "").trim();
    fields.nonPurchasableConfirm.checked = false;
    fields.pricingStatus.textContent = "";
    pendingPatch = null;
    fields.confirmPanel.hidden = true;
    updatePreview();
  }

  function populateLoadedProduct(product) {
    loadedProduct = product;
    fields.editorPanel.hidden = false;
    if (fields.modeIndicator) {
      fields.modeIndicator.textContent = `Editing Existing Listing: ${product.title}`;
    }
    fields.currentTitle.textContent = product.title;
    fields.currentSlug.textContent = product.slug;
    fields.currentStatus.textContent = product.status || "Not set";
    fields.currentBuyMode.textContent = product.buyMode || "Not set";
    fields.loadCopy.textContent = `Loaded ${product.title}. Only pricing fields will be changed by this editor.`;
    resetEditorFromLoadedProduct();
  }

  async function loadAvailableProducts() {
    try {
      const response = await fetch("/data/products.json", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error("Product data failed to load.");
      }
      const payload = await response.json();
      availableProducts = Array.isArray(payload)
        ? payload
          .map((product) => ({
            buyMode: String(product.buyMode || "").trim(),
            currency: String(product.currency || "USD").trim() || "USD",
            price: normalizeMoneyText(product.price),
            priceCents: Number.isInteger(product.priceCents) ? product.priceCents : deriveMoneyCents(product.price),
            regularPrice: normalizeMoneyText(product.regularPrice),
            regularPriceCents: Number.isInteger(product.regularPriceCents) ? product.regularPriceCents : deriveMoneyCents(product.regularPrice),
            saleEnabled: Boolean(product.saleEnabled),
            saleEnd: normalizeDateText(product.saleEnd),
            saleLabel: String(product.saleLabel || "").trim(),
            salePrice: normalizeMoneyText(product.salePrice),
            salePriceCents: Number.isInteger(product.salePriceCents) ? product.salePriceCents : deriveMoneyCents(product.salePrice),
            saleStart: normalizeDateText(product.saleStart),
            slug: String(product.slug || "").trim(),
            status: String(product.status || "").trim(),
            title: String(product.title || product.slug || "").trim()
          }))
          .filter((product) => product.slug && product.title)
          .sort((left, right) => left.title.localeCompare(right.title))
        : [];
    } catch {
      availableProducts = [];
    }

    const options = [
      `<option value="">${availableProducts.length ? "Select an existing product" : "No products available"}</option>`,
      ...availableProducts.map((product) => `<option value="${product.slug}">${buildProductSelectLabel(product)}</option>`)
    ];
    fields.existingSelect.innerHTML = options.join("");
  }

  function loadSelectedProduct() {
    const slug = String(fields.existingSelect.value || "").trim();
    if (!slug) {
      fields.pricingStatus.textContent = "Select an existing product first.";
      return;
    }
    const product = availableProducts.find((entry) => entry.slug === slug);
    if (!product) {
      fields.pricingStatus.textContent = "That product could not be loaded from the current catalog.";
      return;
    }
    populateLoadedProduct(product);
  }

  function renderConfirmation(patch) {
    const changes = buildFieldChanges(patch);
    fields.confirmBody.replaceChildren();
    if (fields.confirmTitle) {
      fields.confirmTitle.textContent = patch.current.title || "Not loaded";
    }
    if (fields.confirmSlug) {
      fields.confirmSlug.textContent = patch.current.slug || "-";
    }
    if (fields.confirmCurrentEffective) {
      fields.confirmCurrentEffective.textContent = formatCents(getEffectivePriceCents(patch.current), patch.current.currency);
    }
    if (fields.confirmNextEffective) {
      fields.confirmNextEffective.textContent = formatCents(getEffectivePriceCents(patch.next), patch.next.currency);
    }
    if (fields.confirmCurrentSaleState) {
      fields.confirmCurrentSaleState.textContent = buildSaleStateLabel(patch.current);
    }
    if (fields.confirmNextSaleState) {
      fields.confirmNextSaleState.textContent = buildSaleStateLabel(patch.next);
    }
    if (fields.confirmPreservation) {
      fields.confirmPreservation.textContent = "Status, purchase mode, availability, files, artwork, descriptions, authors, and fulfillment settings will not change.";
    }

    if (!changes.length) {
      fields.confirmEmpty.textContent = "No pricing changes are queued yet.";
      fields.confirmEmpty.hidden = false;
      fields.confirmTable.hidden = true;
      fields.confirmPanel.hidden = false;
      pendingPatch = null;
      return;
    }

    fields.confirmEmpty.hidden = true;
    fields.confirmTable.hidden = false;
    fields.confirmPanel.hidden = false;
    pendingPatch = patch;

    changes.forEach((change) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(change.fieldName)}</td>
        <td>${escapeHtml(formatFieldValue(change.fieldName, change.current, patch.current.currency))}</td>
        <td>${escapeHtml(formatFieldValue(change.fieldName, change.next, patch.next.currency))}</td>
      `;
      fields.confirmBody.append(row);
    });
  }

  function checkPricing() {
    if (!loadedProduct) {
      fields.pricingStatus.textContent = "Load an existing product first.";
      return;
    }

    const draft = buildDraftFromInputs();
    const errors = validateDraft(loadedProduct, draft);
    if (errors.length) {
      fields.pricingStatus.textContent = errors.join(" ");
      fields.confirmPanel.hidden = true;
      pendingPatch = null;
      return;
    }

    fields.confirmPanel.hidden = true;
    pendingPatch = null;
    fields.pricingStatus.textContent = "Pricing looks valid so far. Nothing has been saved or published.";
  }

  function reviewChanges() {
    if (!loadedProduct) {
      fields.pricingStatus.textContent = "Load an existing product first.";
      return;
    }

    const draft = buildDraftFromInputs();
    const errors = validateDraft(loadedProduct, draft);
    if (errors.length) {
      fields.pricingStatus.textContent = errors.join(" ");
      fields.confirmPanel.hidden = true;
      pendingPatch = null;
      return;
    }

    fields.pricingStatus.textContent = "Review the pricing summary below. Nothing has been published yet.";
    renderConfirmation(buildPatch(loadedProduct, draft));
  }

  async function publishPricingUpdate() {
    if (!pendingPatch || publishBusy) {
      return;
    }

    const csrfToken = getCookie("trg_owner_csrf");
    if (!csrfToken) {
      fields.pricingStatus.textContent = "Your login security token is missing. Reload the page and sign in again if needed.";
      return;
    }

    publishBusy = true;
    buttons.publish.disabled = true;
    fields.pricingStatus.textContent = "Publishing pricing update through the GitHub rebuild workflow...";

    try {
      const response = await fetch(PRICING_ENDPOINT, {
        body: JSON.stringify({
          currency: pendingPatch.next.currency,
          nonPurchasableSaleConfirmed: pendingPatch.nonPurchasableSaleConfirmed,
          price: pendingPatch.next.price,
          priceCents: pendingPatch.next.priceCents,
          saleEnabled: pendingPatch.next.saleEnabled,
          saleEnd: pendingPatch.next.saleEnd,
          saleLabel: pendingPatch.next.saleLabel,
          salePrice: pendingPatch.next.salePrice,
          salePriceCents: pendingPatch.next.salePriceCents,
          saleStart: pendingPatch.next.saleStart,
          slug: pendingPatch.slug
        }),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken
        },
        method: "POST",
        redirect: "manual"
      });

      const payload = await safeJson(response);
      if (!response.ok) {
        fields.pricingStatus.textContent = payload.error || "Pricing update failed.";
        return;
      }

      fields.pricingStatus.textContent = payload.runUrl
        ? `${payload.message} Workflow: ${payload.runUrl}`
        : payload.message;
    } catch {
      fields.pricingStatus.textContent = "The pricing update request failed before the server could answer. Please try again.";
    } finally {
      publishBusy = false;
      buttons.publish.disabled = false;
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  [fields.regularPrice, fields.currency, fields.salePrice, fields.saleStart, fields.saleEnd, fields.saleLabel].forEach((field) => {
    field?.addEventListener("input", updatePreview);
    field?.addEventListener("change", updatePreview);
  });
  fields.saleEnabled?.addEventListener("change", updatePreview);
  fields.nonPurchasableConfirm?.addEventListener("change", updatePreview);

  buttons.load?.addEventListener("click", loadSelectedProduct);
  buttons.check?.addEventListener("click", checkPricing);
  buttons.reset?.addEventListener("click", () => {
    if (hasUnsavedChanges() && !confirmDiscardPricingChanges()) {
      fields.pricingStatus.textContent = "Pricing edits are still in place.";
      return;
    }
    resetEditorFromLoadedProduct();
    fields.pricingStatus.textContent = "Loaded pricing values restored. Published data was not changed.";
  });
  buttons.review?.addEventListener("click", reviewChanges);
  buttons.publish?.addEventListener("click", publishPricingUpdate);
  buttons.cancelReview?.addEventListener("click", () => {
    fields.confirmPanel.hidden = true;
    pendingPatch = null;
    fields.pricingStatus.textContent = "Pricing review closed. You can keep editing.";
  });

  const api = {
    PRICE_FIELDS,
    buildFieldChanges,
    buildPatch,
    buildProductSelectLabel,
    createCurrentPricingView,
    deriveMoneyCents,
    formatCents,
    formatMoneyText,
    getEffectivePriceCents,
    hasAnySaleField,
    hasUnsavedChanges,
    isMoneyLike,
    isSaleActive,
    usesPaidPricingIntent,
    validateDraft,
    buildSaleStateLabel
  };

  globalThis.TRGPricingEditor = api;

  if (fields.modeIndicator) {
    fields.modeIndicator.textContent = "Editing Existing Listing: Select a product to begin.";
  }
  void loadAvailableProducts();
})();
