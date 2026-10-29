(() => {
  const PAGE_SIZE = 100;
  const MAX_PRODUCTS = 2000;

  async function readCatalog() {
    const products = [];
    for (let offset = 0; offset < MAX_PRODUCTS; offset += PAGE_SIZE) {
      const response = await fetch(`/api/catalog?limit=${PAGE_SIZE}&offset=${offset}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("The live catalog could not be loaded.");
      const payload = await response.json();
      const page = Array.isArray(payload.products) ? payload.products : [];
      products.push(...page);
      if (Number(payload.scannedCount ?? page.length) < PAGE_SIZE) break;
    }
    return products.filter(product => product && product.storefrontVisibility === "listed");
  }

  async function hydrate(browsers) {
    if (!Array.isArray(browsers) || !browsers.length) return [];
    try {
      const products = await readCatalog();
      browsers.forEach(root => mergeBrowser(root, products));
      document.dispatchEvent(new CustomEvent("trg:d1-storefront-updated", { detail: { count: products.length } }));
      return products;
    } catch (error) {
      browsers.forEach(root => { root.dataset.liveCatalogUnavailable = "true"; });
      return [];
    }
  }

  function mergeBrowser(root, products) {
    const grid = root.querySelector("[data-store-grid]");
    const shelf = root.querySelector("[data-store-shelf]");
    for (const product of products) {
      const selector = `[data-product-card][data-slug="${cssEscape(product.slug)}"]`;
      root.querySelectorAll(selector).forEach(item => item.remove());
      if (grid) grid.appendChild(createCard(product));
      if (shelf) shelf.appendChild(createBook(product));
    }
    populateFilters(root, products);
  }

  function createCard(product) {
    const card = document.createElement("article");
    card.className = "product-card";
    applyDataset(card, product);
    card.dataset.nativeD1Product = "true";

    const media = document.createElement("div");
    media.className = "product-card__media";
    const image = document.createElement("img");
    image.src = product.coverUrl || "/assets/logo.png";
    image.alt = `${product.title} thumbnail`;
    image.loading = "lazy";
    image.decoding = "async";
    media.appendChild(image);

    const body = document.createElement("div");
    body.className = "product-card__body";
    const topline = document.createElement("div");
    topline.className = "product-card__topline";
    topline.appendChild(span(`status-badge status-badge--${product.status}`, statusLabel(product.status)));
    topline.appendChild(span("product-card__price", priceLabel(product)));
    body.append(topline);
    body.append(heading("h3", "product-card__title", product.title));
    if (product.subtitle) body.append(paragraph("product-card__subtitle", product.subtitle));
    body.append(paragraph("product-card__meta product-card__meta--byline", `By ${product.creatorName}`));
    body.append(paragraph("product-card__meta", catalogMeta(product)));
    body.append(paragraph("product-card__meta", formats(product).join(", ") || "Digital"));

    const actions = document.createElement("div");
    actions.className = "product-card__actions";
    const detail = document.createElement("a");
    detail.className = "button button--secondary product-card__button";
    detail.href = product.detailUrl;
    detail.textContent = "View Product";
    actions.appendChild(detail);
    body.appendChild(actions);
    card.append(media, body);
    return card;
  }

  function createBook(product) {
    const book = document.createElement("a");
    book.className = "bookshelf-book";
    book.href = product.detailUrl;
    book.setAttribute("aria-label", `Open ${product.title} product page`);
    applyDataset(book, product);
    book.dataset.nativeD1Product = "true";
    book.dataset.spineWidth = "42";
    book.dataset.spineSource = "d1-catalog";
    book.style.setProperty("--book-spine-width", "42px");
    book.style.setProperty("--book-height", "182px");

    const scene = span("bookshelf-book__scene", "");
    const spine = span("bookshelf-book__spine", "");
    spine.append(span("bookshelf-book__status", statusLabel(product.status)));
    spine.append(span("bookshelf-book__title", product.title));
    spine.append(span("bookshelf-book__author", product.creatorName));
    const coverFrame = span("bookshelf-book__cover-frame", "");
    const cover = document.createElement("img");
    cover.className = "bookshelf-book__cover";
    cover.src = product.coverUrl || "/assets/logo.png";
    cover.alt = `${product.title} cover`;
    cover.loading = "lazy";
    cover.decoding = "async";
    coverFrame.appendChild(cover);
    const details = span("bookshelf-book__details", "");
    details.append(heading("strong", "", product.title));
    details.append(span("", product.creatorName));
    details.append(span("", priceLabel(product)));
    details.append(span("", catalogMeta(product)));
    details.append(span("", product.shortDescription || "Open the full product page for details."));
    details.append(heading("em", "", "Open product page"));
    const mobile = span("bookshelf-book__mobile", "");
    const mobileMedia = span("bookshelf-book__mobile-media", "");
    const mobileCover = cover.cloneNode();
    mobileCover.alt = "";
    mobileMedia.appendChild(mobileCover);
    const mobileCopy = span("bookshelf-book__mobile-copy", "");
    mobileCopy.append(span(`status-badge status-badge--${product.status}`, statusLabel(product.status)));
    mobileCopy.append(span("bookshelf-book__mobile-title", product.title));
    mobileCopy.append(span("bookshelf-book__mobile-subtitle", product.subtitle || ""));
    mobileCopy.append(span("bookshelf-book__mobile-meta", catalogMeta(product)));
    mobile.append(mobileMedia, mobileCopy);
    scene.append(spine, coverFrame, details, mobile);
    book.appendChild(scene);
    return book;
  }

  function applyDataset(element, product) {
    const metadata = product.metadata || {};
    const authorSlug = product.creatorSlug || slugify(product.creatorName);
    const search = [product.title, product.subtitle, product.creatorName, product.publisher,
      product.gameSystem, product.productLine, metadata.series, ...(Array.isArray(metadata.tags) ? metadata.tags : [])]
      .filter(Boolean).join(" ").toLowerCase();
    const values = {
      productCard: "true", slug: product.slug, title: String(product.title || "").toLowerCase(),
      author: authorSlug, system: slugify(product.gameSystem), line: slugify(product.productLine),
      series: metadata.seriesSlug || slugify(metadata.series), status: product.status,
      format: formats(product).map(slugify).join("|"), priceType: priceType(product),
      priceCents: String(effectivePrice(product)), release: String(timestamp(metadata.releaseDate || product.publishedAt)),
      updated: String(timestamp(product.updatedAt)), saleActive: String(salePrice(product) !== null),
      genre: product.genre || "", playerCountMin: String(metadata.playerCountMin || ""),
      playerCountMax: String(metadata.playerCountMax || ""), gmMode: metadata.gmMode || "",
      prepBurden: metadata.prepBurden || "", playMode: metadata.playMode || "",
      rulesComplexity: metadata.rulesComplexity || "", mediaType: product.mediaType || "digital", search
    };
    Object.assign(element.dataset, values);
  }

  function populateFilters(root, products) {
    const specifications = [
      ["[data-filter-author]", product => [product.creatorSlug || slugify(product.creatorName), product.creatorName]],
      ["[data-filter-system]", product => [slugify(product.gameSystem), product.gameSystem]],
      ["[data-filter-line]", product => [slugify(product.productLine), product.productLine]],
      ["[data-filter-series]", product => [product.metadata?.seriesSlug || slugify(product.metadata?.series), product.metadata?.series]],
      ["[data-filter-status]", product => [product.status, statusLabel(product.status)]],
      ["[data-filter-format]", product => formats(product).map(value => [slugify(value), value])],
      ["[data-filter-price-type]", product => [priceType(product), priceTypeLabel(product)]],
      ["[data-filter-genre]", product => [product.genre, humanize(product.genre)]]
    ];
    for (const [selector, resolve] of specifications) {
      const select = root.querySelector(selector);
      if (!select) continue;
      const entries = new Map();
      products.forEach(product => {
        const resolved = resolve(product);
        const pairs = Array.isArray(resolved?.[0]) ? resolved : [resolved];
        pairs.forEach(([value, label]) => { if (value && label) entries.set(value, label); });
      });
      const existing = new Set(Array.from(select.options).map(option => option.value));
      [...entries].sort((left, right) => left[1].localeCompare(right[1])).forEach(([value, label]) => {
        if (existing.has(value)) return;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
    }
  }

  function formats(product) { return Array.isArray(product.metadata?.format) ? product.metadata.format.filter(Boolean) : []; }
  function statusLabel(status) { return humanize(status).replace("Pwyw", "Pay What You Want"); }
  function priceType(product) { return product.pricingModel === "pwyw" ? "pay-what-you-want" : product.pricingModel === "free" ? "free" : "fixed-price"; }
  function priceTypeLabel(product) { return product.pricingModel === "pwyw" ? "Pay What You Want" : product.pricingModel === "free" ? "Free" : "Fixed Price"; }
  function priceLabel(product) {
    if (product.pricingModel === "free") return "Free Download";
    if (product.pricingModel === "pwyw") return `PWYW · ${money(product.minimumPriceCents, product.currency)} minimum · ${money(product.suggestedPriceCents, product.currency)} suggested`;
    return money(effectivePrice(product), product.currency);
  }
  function salePrice(product) {
    const now = Date.now();
    if (!product.saleEnabled || !Number.isSafeInteger(product.salePriceCents)) return null;
    if (product.saleStart && Date.parse(product.saleStart) > now) return null;
    if (product.saleEnd && Date.parse(product.saleEnd) < now) return null;
    return product.salePriceCents;
  }
  function effectivePrice(product) { return salePrice(product) ?? Number(product.priceCents || 0); }
  function money(cents, currency = "USD") {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents || 0) / 100); }
    catch { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }
  }
  function catalogMeta(product) { return [product.gameSystem, product.productLine, product.metadata?.series].filter(Boolean).join(" | ") || product.mediaType || "Digital"; }
  function timestamp(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; }
  function slugify(value) { return String(value || "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function humanize(value) { return String(value || "").replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
  function cssEscape(value) { return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"); }
  function span(className, value) { const element = document.createElement("span"); if (className) element.className = className; element.textContent = value; return element; }
  function paragraph(className, value) { const element = document.createElement("p"); element.className = className; element.textContent = value; return element; }
  function heading(tag, className, value) { const element = document.createElement(tag); if (className) element.className = className; element.textContent = value; return element; }

  window.TRGD1Storefront = Object.freeze({ hydrate });
})();
