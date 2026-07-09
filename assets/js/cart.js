(() => {
  const STORAGE_KEY = "trg_cart_v1";
  const SCHEMA_VERSION = 1;

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

  function renderCartPage(documentRef, storage = getStorage()) {
    const pageRoot = documentRef?.querySelector?.("[data-cart-page]");
    const itemsNode = documentRef?.querySelector?.("[data-cart-items]");
    const emptyNode = documentRef?.querySelector?.("[data-cart-empty]");
    const totalNode = documentRef?.querySelector?.("[data-cart-total]");
    if (!pageRoot || !itemsNode || !emptyNode || !totalNode) {
      return;
    }

    const cart = readCart(storage);
    const catalog = parseCartCatalog(documentRef);
    let totalCents = 0;
    const markup = cart.items.map((entry) => {
      const product = catalog.get(entry.slug);
      if (!product) {
        return `
          <article class="cart-item">
            <div class="cart-item__media cart-item__media--missing"></div>
            <div class="cart-item__body">
              <h2 class="cart-item__title">${escapeHtml(entry.slug)}</h2>
              <p class="cart-item__meta">This product is no longer available in the current generated cart catalog.</p>
            </div>
            <div class="cart-item__actions">
              <span class="cart-item__price">Unavailable</span>
              <button type="button" class="button button--secondary" data-cart-remove="${escapeHtml(entry.slug)}">Remove</button>
            </div>
          </article>
        `;
      }

      totalCents += Number(product.priceCents || 0);
      const estimatedPrice = product.priceDisplay || formatCents(product.priceCents, product.currency || "USD");
      return `
        <article class="cart-item">
          <div class="cart-item__media">
            <img src="${escapeHtml(product.cover || "/assets/logo.png")}" alt="${escapeHtml(product.title)} cover">
          </div>
          <div class="cart-item__body">
            <h2 class="cart-item__title"><a href="${escapeHtml(product.url || "#")}">${escapeHtml(product.title)}</a></h2>
            <p class="cart-item__meta">Estimated price: ${escapeHtml(estimatedPrice)}</p>
          </div>
          <div class="cart-item__actions">
            <span class="cart-item__price">${escapeHtml(estimatedPrice)}</span>
            <button type="button" class="button button--secondary" data-cart-remove="${escapeHtml(product.slug)}">Remove</button>
          </div>
        </article>
      `;
    }).join("");

    itemsNode.innerHTML = markup;
    emptyNode.hidden = cart.items.length !== 0;
    totalNode.textContent = formatCents(totalCents);

    const removeButtons = itemsNode.querySelectorAll ? itemsNode.querySelectorAll("[data-cart-remove]") : [];
    removeButtons.forEach((button) => {
      if (button.dataset.cartBound === "true") {
        return;
      }
      button.dataset.cartBound = "true";
      button.addEventListener("click", () => {
        removeItem(button.dataset.cartRemove, storage);
        renderAll(documentRef, storage);
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
        renderAll(documentRef, storage);
      });
    });
  }

  function renderAll(documentRef, storage = getStorage()) {
    updateCartCount(documentRef, storage);
    updateAddButtons(documentRef, storage);
    renderCartPage(documentRef, storage);
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
        renderAll(documentRef, storage);
      });
    });

    if (!windowRef.__trgCartStorageBound && typeof windowRef.addEventListener === "function") {
      windowRef.__trgCartStorageBound = true;
      windowRef.addEventListener("storage", (event) => {
        if (!event || event.key === STORAGE_KEY || event.key === null) {
          renderAll(documentRef, storage);
        }
      });
    }

    renderAll(documentRef, storage);
    return {
      render() {
        renderAll(documentRef, storage);
      }
    };
  }

  const api = {
    STORAGE_KEY,
    addItem,
    clearCart,
    countItems,
    createEmptyCart,
    initBrowserCart,
    readCart,
    removeItem,
    sanitizeCart,
    writeCart
  };

  globalThis.TRGCart = api;

  if (typeof document !== "undefined") {
    initBrowserCart();
  }
})();
