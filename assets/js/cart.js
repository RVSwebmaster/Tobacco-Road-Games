(() => {
  const STORAGE_KEY = "trg_cart_v1";
  const SCHEMA_VERSION = 1;
  const QUOTE_ENDPOINT = "/api/cart/quote";
  const DEFAULT_ESTIMATE_NOTE = "Final product availability and pricing will be verified during checkout.";
  const QUOTE_LOADING_NOTE = "Loading a verified quote from the store.";
  const QUOTE_FAILURE_NOTE = "We could not verify pricing right now. These browser values are estimates only until the store can refresh the cart quote.";
  const DEFAULT_EMPTY_STATUS = "Add a cart-ready product to load a verified quote.";
  const QUOTE_SUCCESS_STATUS = "Verified store pricing is shown below.";
  const QUOTE_PARTIAL_STATUS = "Some items need attention before checkout.";
  const QUOTE_FAILURE_STATUS = "Verified pricing is unavailable right now. Retry when ready.";

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeSlug(value) {
    return String(value || "").trim().toLowerCase();
  }

  function createEmptyCart() {
    return {
      version: SCHEMA_VERSION,
      items: [],
      updatedAt: nowIso()
    };
  }

  function isIsoLike(value) {
    return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
  }

  function sanitizeCart(input) {
    const fallback = createEmptyCart();
    if (!input || typeof input !== "object" || input.version !== SCHEMA_VERSION || !Array.isArray(input.items)) {
      return fallback;
    }

    const seen = new Set();
    const items = [];
    for (const entry of input.items) {
      const slug = normalizeSlug(entry?.slug);
      if (!slug || seen.has(slug)) {
        continue;
      }
      seen.add(slug);
      items.push({
        addedAt: isIsoLike(entry?.addedAt) ? String(entry.addedAt) : nowIso(),
        quantity: 1,
        slug
      });
    }

    return {
      version: SCHEMA_VERSION,
      items,
      updatedAt: isIsoLike(input.updatedAt) ? String(input.updatedAt) : nowIso()
    };
  }

  function getStorage() {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  function readCart(storage = getStorage()) {
    if (!storage) {
      return createEmptyCart();
    }

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) {
        const empty = createEmptyCart();
        storage.setItem(STORAGE_KEY, JSON.stringify(empty));
        return empty;
      }

      const parsed = JSON.parse(raw);
      const sanitized = sanitizeCart(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
        storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    } catch {
      const empty = createEmptyCart();
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(empty));
      } catch {
        // Best-effort reset only.
      }
      return empty;
    }
  }

  function writeCart(cart, storage = getStorage()) {
    const sanitized = sanitizeCart(cart);
    if (!storage) {
      return sanitized;
    }

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // Ignore storage write errors and keep the in-memory copy.
    }
    return sanitized;
  }

  function addItem(slug, storage = getStorage()) {
    const normalizedSlug = normalizeSlug(slug);
    const current = readCart(storage);
    if (!normalizedSlug || current.items.some((entry) => entry.slug === normalizedSlug)) {
      return current;
    }

    const stamp = nowIso();
    return writeCart({
      version: SCHEMA_VERSION,
      items: [
        ...current.items,
        {
          addedAt: stamp,
          quantity: 1,
          slug: normalizedSlug
        }
      ],
      updatedAt: stamp
    }, storage);
  }

  function removeItem(slug, storage = getStorage()) {
    const normalizedSlug = normalizeSlug(slug);
    const current = readCart(storage);
    const nextItems = current.items.filter((entry) => entry.slug !== normalizedSlug);
    if (nextItems.length === current.items.length) {
      return current;
    }

    return writeCart({
      version: SCHEMA_VERSION,
      items: nextItems,
      updatedAt: nowIso()
    }, storage);
  }

  function clearCart(storage = getStorage()) {
    return writeCart(createEmptyCart(), storage);
  }

  function countItems(storage = getStorage()) {
    return readCart(storage).items.length;
  }

  function parseCartCatalog(documentRef) {
    const catalogNode = documentRef?.getElementById?.("trg-cart-catalog");
    if (!catalogNode) {
      return new Map();
    }

    try {
      const parsed = JSON.parse(catalogNode.textContent || "[]");
      if (!Array.isArray(parsed)) {
        return new Map();
      }
      return new Map(parsed.map((entry) => [normalizeSlug(entry.slug), entry]));
    } catch {
      return new Map();
    }
  }

  function createQuoteRequest(cart) {
    const sanitized = sanitizeCart(cart);
    return {
      items: sanitized.items.map((entry) => ({
        quantity: 1,
        slug: entry.slug
      }))
    };
  }

  async function requestQuote(cart, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Verified quote fetch is unavailable.");
    }

    const response = await fetchImpl(QUOTE_ENDPOINT, {
      body: JSON.stringify(createQuoteRequest(cart)),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Leave payload null so the error path can use a generic message.
    }

    if (!response.ok) {
      const message = payload?.error || "Verified quote request failed.";
      throw new Error(String(message));
    }

    if (!payload || !Array.isArray(payload.items) || !Array.isArray(payload.unavailableItems)) {
      throw new Error("Verified quote response was not valid.");
    }

    return payload;
  }

  function formatCents(cents, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(Number(cents || 0) / 100);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateCartCount(documentRef, storage = getStorage()) {
    const count = countItems(storage);
    const badges = documentRef?.querySelectorAll?.("[data-cart-count]") || [];
    badges.forEach((badge) => {
      badge.textContent = String(count);
    });
  }

  function updateAddButtons(documentRef, storage = getStorage()) {
    const cart = readCart(storage);
    const buttons = documentRef?.querySelectorAll?.("[data-cart-add]") || [];
    buttons.forEach((button) => {
      const defaultLabel = button.dataset.cartDefaultLabel || button.textContent.trim() || "Add to Cart";
      button.dataset.cartDefaultLabel = defaultLabel;
      const slug = normalizeSlug(button.dataset.cartAdd);
      const inCart = cart.items.some((entry) => entry.slug === slug);
      button.disabled = inCart;
      button.setAttribute("aria-disabled", inCart ? "true" : "false");
      button.textContent = inCart ? "In Cart" : defaultLabel;
    });
  }

  function getCartPageNodes(documentRef) {
    const pageRoot = documentRef?.querySelector?.("[data-cart-page]");
    const itemsNode = documentRef?.querySelector?.("[data-cart-items]");
    const emptyNode = documentRef?.querySelector?.("[data-cart-empty]");
    const totalNode = documentRef?.querySelector?.("[data-cart-total]");
    if (!pageRoot || !itemsNode || !emptyNode || !totalNode) {
      return null;
    }

    return {
      emptyNode,
      itemsNode,
      noteNode: documentRef.querySelector?.("[data-cart-note]") || null,
      pageRoot,
      retryButton: documentRef.querySelector?.("[data-cart-retry]") || null,
      statusNode: documentRef.querySelector?.("[data-cart-status]") || null,
      totalLabelNode: documentRef.querySelector?.("[data-cart-total-label]") || null,
      totalNode,
      unavailableNode: documentRef.querySelector?.("[data-cart-unavailable]") || null
    };
  }

  function getCartPageState(pageRoot) {
    if (!pageRoot.__trgCartState) {
      pageRoot.__trgCartState = {
        requestId: 0
      };
    }
    return pageRoot.__trgCartState;
  }

  function buildEstimatedItem(entry, product) {
    if (!product) {
      return {
        coverUrl: "",
        meta: "This product is no longer available in the current generated cart catalog.",
        priceDisplay: "Unavailable",
        slug: entry.slug,
        title: entry.slug,
        url: ""
      };
    }

    const priceDisplay = product.priceDisplay || formatCents(product.priceCents, product.currency || "USD");
    return {
      coverUrl: product.cover || "/assets/logo.png",
      meta: `Estimated price: ${priceDisplay}`,
      priceDisplay,
      slug: product.slug,
      title: product.title,
      url: product.url || ""
    };
  }

  function buildEstimatedCartModel(cart, catalog) {
    let totalCents = 0;
    const items = cart.items.map((entry) => {
      const product = catalog.get(entry.slug);
      if (product && Number.isInteger(product.priceCents)) {
        totalCents += product.priceCents;
      }
      return buildEstimatedItem(entry, product);
    });

    return {
      items,
      note: DEFAULT_ESTIMATE_NOTE,
      retryHidden: true,
      status: cart.items.length ? QUOTE_LOADING_NOTE : DEFAULT_EMPTY_STATUS,
      totalCents,
      totalLabel: "Estimated Total",
      unavailableItems: []
    };
  }

  function buildFailureCartModel(cart, catalog) {
    const estimated = buildEstimatedCartModel(cart, catalog);
    return {
      ...estimated,
      note: QUOTE_FAILURE_NOTE,
      retryHidden: false,
      status: QUOTE_FAILURE_STATUS,
      totalLabel: "Estimated Total Only"
    };
  }

  function buildQuotedCartModel(quote, catalog) {
    const items = quote.items.map((item) => ({
      coverUrl: item.coverUrl || catalog.get(item.slug)?.cover || "/assets/logo.png",
      meta: `${item.saleActive ? "Verified sale price" : "Verified price"}: ${formatCents(item.effectivePriceCents, item.currency)}`,
      priceDisplay: formatCents(item.lineTotalCents, item.currency),
      slug: item.slug,
      title: item.title,
      url: catalog.get(item.slug)?.url || ""
    }));

    const unavailableItems = quote.unavailableItems.map((item) => {
      const fallback = catalog.get(item.slug);
      return {
        coverUrl: fallback?.cover || "",
        message: item.message || "This item is not available for checkout.",
        slug: item.slug,
        title: fallback?.title || item.slug
      };
    });

    return {
      items,
      note: quote.pricingNote || DEFAULT_ESTIMATE_NOTE,
      retryHidden: true,
      status: unavailableItems.length ? QUOTE_PARTIAL_STATUS : QUOTE_SUCCESS_STATUS,
      totalCents: Number.isInteger(quote.totalCents) ? quote.totalCents : 0,
      totalLabel: "Final Listed Total",
      unavailableItems
    };
  }

  function renderCartItemMarkup(item) {
    const media = item.coverUrl
      ? `
          <div class="cart-item__media">
            <img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} cover">
          </div>
        `
      : `<div class="cart-item__media cart-item__media--missing" aria-hidden="true"></div>`;
    const titleMarkup = item.url
      ? `<h2 class="cart-item__title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h2>`
      : `<h2 class="cart-item__title">${escapeHtml(item.title)}</h2>`;

    return `
      <article class="cart-item">
        ${media}
        <div class="cart-item__body">
          ${titleMarkup}
          <p class="cart-item__meta">${escapeHtml(item.meta)}</p>
        </div>
        <div class="cart-item__actions">
          <span class="cart-item__price">${escapeHtml(item.priceDisplay)}</span>
          <button type="button" class="button button--secondary" data-cart-remove="${escapeHtml(item.slug)}">Remove</button>
        </div>
      </article>
    `;
  }

  function renderUnavailableMarkup(items) {
    if (!items.length) {
      return "";
    }

    return `
      <div class="cart-unavailable__header">
        <p class="note-card__label">Needs Attention</p>
        <p class="cart-summary__copy">These items cannot be checked out until they are removed.</p>
      </div>
      <div class="cart-unavailable__list">
        ${items.map((item) => `
          <article class="cart-item cart-item--unavailable">
            ${item.coverUrl ? `
              <div class="cart-item__media">
                <img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} cover">
              </div>
            ` : `<div class="cart-item__media cart-item__media--missing" aria-hidden="true"></div>`}
            <div class="cart-item__body">
              <h2 class="cart-item__title">${escapeHtml(item.title)}</h2>
              <p class="cart-item__meta cart-item__meta--warning">${escapeHtml(item.message)}</p>
            </div>
            <div class="cart-item__actions">
              <span class="cart-item__price">Unavailable</span>
              <button type="button" class="button button--secondary" data-cart-remove="${escapeHtml(item.slug)}">Remove</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function bindCartButtons(nodes, documentRef, storage, options) {
    const containers = [nodes.itemsNode, nodes.unavailableNode].filter(Boolean);
    containers.forEach((container) => {
      const removeButtons = container.querySelectorAll ? container.querySelectorAll("[data-cart-remove]") : [];
      removeButtons.forEach((button) => {
        if (button.dataset.cartBound === "true") {
          return;
        }
        button.dataset.cartBound = "true";
        button.addEventListener("click", () => {
          removeItem(button.dataset.cartRemove, storage);
          void renderAll(documentRef, storage, options);
        });
      });
    });

    const clearButtons = documentRef.querySelectorAll ? documentRef.querySelectorAll("[data-cart-clear]") : [];
    clearButtons.forEach((button) => {
      if (button.dataset.cartBound === "true") {
        return;
      }
      button.dataset.cartBound = "true";
      button.addEventListener("click", () => {
        clearCart(storage);
        void renderAll(documentRef, storage, options);
      });
    });

    if (nodes.retryButton && nodes.retryButton.dataset.cartBound !== "true") {
      nodes.retryButton.dataset.cartBound = "true";
      nodes.retryButton.addEventListener("click", () => {
        void renderAll(documentRef, storage, options);
      });
    }
  }

  function applyCartModel(nodes, model) {
    nodes.itemsNode.innerHTML = model.items.map((item) => renderCartItemMarkup(item)).join("");
    nodes.emptyNode.hidden = model.items.length !== 0 || model.unavailableItems.length !== 0;
    nodes.totalNode.textContent = formatCents(model.totalCents);

    if (nodes.totalLabelNode) {
      nodes.totalLabelNode.textContent = model.totalLabel;
    }
    if (nodes.noteNode) {
      nodes.noteNode.textContent = model.note;
    }
    if (nodes.statusNode) {
      nodes.statusNode.textContent = model.status;
    }
    if (nodes.retryButton) {
      nodes.retryButton.hidden = Boolean(model.retryHidden);
    }
    if (nodes.unavailableNode) {
      nodes.unavailableNode.innerHTML = renderUnavailableMarkup(model.unavailableItems);
      nodes.unavailableNode.hidden = model.unavailableItems.length === 0;
    }
  }

  async function renderCartPage(documentRef, storage = getStorage(), options = {}) {
    const nodes = getCartPageNodes(documentRef);
    if (!nodes) {
      return;
    }

    const state = getCartPageState(nodes.pageRoot);
    const cart = readCart(storage);
    const catalog = parseCartCatalog(documentRef);
    const estimatedModel = buildEstimatedCartModel(cart, catalog);
    bindCartButtons(nodes, documentRef, storage, options);
    applyCartModel(nodes, estimatedModel);

    if (!cart.items.length) {
      return;
    }

    const requestId = state.requestId + 1;
    state.requestId = requestId;

    try {
      const quote = await requestQuote(cart, options.fetchImpl || globalThis.fetch);
      if (state.requestId !== requestId) {
        return;
      }
      applyCartModel(nodes, buildQuotedCartModel(quote, catalog));
      bindCartButtons(nodes, documentRef, storage, options);
    } catch {
      if (state.requestId !== requestId) {
        return;
      }
      applyCartModel(nodes, buildFailureCartModel(cart, catalog));
      bindCartButtons(nodes, documentRef, storage, options);
    }
  }

  async function renderAll(documentRef, storage = getStorage(), options = {}) {
    updateCartCount(documentRef, storage);
    updateAddButtons(documentRef, storage);
    await renderCartPage(documentRef, storage, options);
  }

  function initBrowserCart(options = {}) {
    const documentRef = options.document || globalThis.document;
    const windowRef = options.window || globalThis;
    const storage = options.storage || getStorage();
    if (!documentRef) {
      return null;
    }

    const addButtons = documentRef.querySelectorAll ? documentRef.querySelectorAll("[data-cart-add]") : [];
    addButtons.forEach((button) => {
      if (button.dataset.cartBound === "true") {
        return;
      }
      button.dataset.cartBound = "true";
      button.addEventListener("click", () => {
        addItem(button.dataset.cartAdd, storage);
        void renderAll(documentRef, storage, options);
      });
    });

    if (!windowRef.__trgCartStorageBound && typeof windowRef.addEventListener === "function") {
      windowRef.__trgCartStorageBound = true;
      windowRef.addEventListener("storage", (event) => {
        if (!event || event.key === STORAGE_KEY || event.key === null) {
          void renderAll(documentRef, storage, options);
        }
      });
    }

    void renderAll(documentRef, storage, options);
    return {
      render() {
        return renderAll(documentRef, storage, options);
      }
    };
  }

  const api = {
    QUOTE_ENDPOINT,
    STORAGE_KEY,
    addItem,
    clearCart,
    countItems,
    createEmptyCart,
    createQuoteRequest,
    formatCents,
    initBrowserCart,
    parseCartCatalog,
    readCart,
    removeItem,
    renderAll,
    requestQuote,
    sanitizeCart,
    writeCart
  };

  globalThis.TRGCart = api;

  if (typeof document !== "undefined") {
    initBrowserCart();
  }
})();
