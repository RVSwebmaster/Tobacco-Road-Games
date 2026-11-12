(() => {
  const SHELVES = Object.freeze({
    featuredCreator: "featured-creator-wall-heading",
    newThisWeek: "new-this-week-wall-heading",
    bestSellers: "best-sellers-wall-heading",
    freePwyw: "free-pwyw-wall-heading"
  });

  function depthForPages(rawPageCount) {
    const pages = Number(rawPageCount);
    if (!Number.isInteger(pages) || pages < 1) return 24;
    return Math.min(60, Math.max(16, Math.round(24 + (pages - 100) * 0.1)));
  }

  function previewPayload(product) {
    return JSON.stringify({
      slug: product.slug,
      title: product.title,
      creator: product.creator,
      priceLabel: product.priceLabel,
      description: product.description,
      cover: product.cover,
      fullUrl: product.fullUrl
    });
  }

  function createSpine(product) {
    const link = document.createElement("a");
    link.className = "shop-wall-sale-spine";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.slug = product.slug;
    link.dataset.productId = product.id || product.slug;
    link.dataset.guestProductPreview = previewPayload(product);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = product.title;
    const label = document.createElement("span");
    label.setAttribute("aria-hidden", "true");
    label.textContent = product.title;
    link.append(label);
    return link;
  }

  function createHero(product) {
    const link = document.createElement("a");
    link.className = "shop-wall-hero-book";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.slug = product.slug;
    link.dataset.productId = product.id || product.slug;
    link.dataset.guestProductPreview = previewPayload(product);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = product.title;
    const image = document.createElement("img");
    image.src = product.cover || "/assets/tobacco-road-games-logo.png";
    image.alt = `${product.title} cover`;
    image.loading = "lazy";
    image.decoding = "async";
    link.append(image);
    return link;
  }

  function createStockSpine() {
    const stock = document.createElement("figure");
    stock.className = "shop-wall-stock-spine";
    stock.dataset.decorativeStock = "";
    stock.setAttribute("aria-hidden", "true");
    return stock;
  }

  function createStockHero() {
    const stock = document.createElement("figure");
    stock.className = "shop-wall-hero-book shop-wall-hero-book--stock";
    stock.dataset.decorativeStock = "";
    stock.setAttribute("aria-hidden", "true");
    const cover = document.createElement("div");
    cover.className = "shop-wall-stock-cover";
    cover.setAttribute("aria-hidden", "true");
    const image = document.createElement("img");
    image.src = "/assets/tobacco-road-games-logo.png";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    cover.append(image);
    stock.append(cover);
    return stock;
  }

  function createRotationSpine(product) {
    const panel = document.createElement("span");
    panel.className = "product-book__spine-art";
    const title = document.createElement("strong");
    title.className = "product-book__spine-title";
    title.textContent = product.title;
    title.title = product.title;
    const credit = document.createElement("span");
    credit.className = "product-book__spine-credit";
    credit.textContent = product.creator || "Tobacco Road Games";
    credit.title = credit.textContent;
    panel.append(title, credit);
    return panel;
  }

  function createRotationBook(product, spineWidth) {
    const stage = document.createElement("span");
    stage.className = "homepage-open-rules-book__rotation";
    stage.setAttribute("aria-hidden", "true");

    const book = document.createElement("span");
    book.className = "product-book homepage-open-rules-book__product";
    book.style.setProperty("--book-angle", "88deg");
    const depth = Math.max(10, Number(spineWidth) || 12);
    book.style.setProperty("--book-depth", `${depth}px`);
    book.style.setProperty("--book-width", `${Math.max(80, depth * 8)}px`);

    const front = document.createElement("span");
    front.className = "product-book__face product-book__front";
    const cover = document.createElement("img");
    cover.className = "product-cover";
    cover.src = product.cover || "/assets/tobacco-road-games-logo.png";
    cover.alt = "";
    cover.loading = "lazy";
    cover.decoding = "async";
    front.append(cover);

    const spine = document.createElement("span");
    spine.className = "product-book__face product-book__spine";
    spine.append(createRotationSpine(product));

    const pages = document.createElement("span");
    pages.className = "product-book__face product-book__pages";

    book.append(front, spine, pages);
    stage.append(book);
    return stage;
  }

  function createOpenRulesSpine(product) {
    const link = document.createElement("a");
    const pageCount = Number(product.metadata?.pageCount);
    const shelfWidth = Math.max(12, Math.round(depthForPages(pageCount) * 220 / 340));
    link.className = "shop-wall-product-mock shop-wall-product-mock--spine homepage-library-book homepage-open-rules-book";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.productId = product.id || product.slug;
    link.dataset.slug = product.slug;
    link.dataset.pageCount = Number.isInteger(pageCount) && pageCount > 0 ? String(pageCount) : "";
    link.dataset.guestProductPreview = previewPayload(product);
    link.style.setProperty("--open-rules-spine-width", `${shelfWidth}px`);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = `${product.title} — ${product.creator}`;

    link.append(createRotationBook(product, shelfWidth));
    return link;
  }

  function hydrateGuestOpenRulesShelf(row, products) {
    const shelfProducts = products.slice(0, 18);
    const books = Array.from(row.querySelectorAll("[data-magical-book]")).slice(0, 18);
    books.forEach((book, index) => {
      const product = shelfProducts[index];
      if (!product) return;
      const pageCount = Number(product.metadata?.pageCount);
      const depth = depthForPages(pageCount);
      book.classList.add("guest-open-rules-real-book");
      book.removeAttribute("aria-hidden");
      book.removeAttribute("data-mock-open-rule");
      book.dataset.productId = product.id || product.slug;
      book.dataset.slug = product.slug;
      book.dataset.pageCount = Number.isInteger(pageCount) && pageCount > 0 ? String(pageCount) : "";
      book.style.setProperty("--open-rules-spine-ratio", String(depth / 24));

      const link = document.createElement("a");
      link.className = "guest-open-rules-real-book__link";
      link.href = product.fullUrl;
      link.dataset.guestProductPreview = previewPayload(product);
      link.setAttribute("aria-label", `Open ${product.title} product page`);
      link.title = `${product.title} — ${product.creator}`;

      const baseWidth = Number.parseFloat(getComputedStyle(book).getPropertyValue("--guest-library-book-width")) || 12;
      link.append(createRotationBook(product, baseWidth * depth / 24));
      book.replaceChildren(link);
    });
    return true;
  }

  function hydrateOpenRulesLibrary(upperPayload = {}, lowerPayload = {}) {
    const bay = document.querySelector('[aria-labelledby="open-rules-library-heading"]');
    if (!bay) return false;
    const upperProducts = Array.isArray(upperPayload.products) ? upperPayload.products.slice(0, 18) : [];
    const lowerProducts = Array.isArray(lowerPayload.products) ? lowerPayload.products.slice(0, 18) : [];
    const visible = upperPayload.visible !== false || lowerPayload.visible !== false;
    bay.hidden = !visible;
    if (!visible) return true;
    const guestRows = Array.from(bay.querySelectorAll(".guest-open-rules-books"));
    if (guestRows.length === 2) {
      if (upperPayload.managed) hydrateGuestOpenRulesShelf(guestRows[0], upperProducts);
      if (lowerPayload.managed) hydrateGuestOpenRulesShelf(guestRows[1], lowerProducts);
    }
    const rows = Array.from(bay.querySelectorAll("[data-fill-library]"));
    if (guestRows.length !== 2 && rows.length !== 2) return false;
    [[rows[0], upperPayload, upperProducts], [rows[1], lowerPayload, lowerProducts]].forEach(([row, payload, products]) => {
      if (!row || !payload.managed) return;
      const render = () => row.replaceChildren(...products.map(createOpenRulesSpine));
      render();
      if (typeof ResizeObserver === "function") new ResizeObserver(render).observe(row.parentElement);
      else window.addEventListener("resize", render);
    });
    for (const [shelf, products] of [["openRulesLibraryUpper", upperProducts], ["openRulesLibraryLower", lowerProducts]]) {
      document.dispatchEvent(new CustomEvent("trg:homepage-shelves-updated", { detail: { shelf, count: products.length } }));
    }
    return true;
  }

  function hydrateShelf(key, payload = {}) {
    const headingId = SHELVES[key];
    const bay = headingId ? document.querySelector(`[aria-labelledby="${headingId}"]`) : null;
    if (!bay) return false;
    bay.hidden = payload.visible === false;
    if (payload.visible === false || !payload.managed) return true;
    const row = bay.querySelector(".shop-wall-product-row--hero");
    const heroBay = row?.querySelector(".shop-wall-hero-bay");
    const leftRun = row?.querySelector('[data-spine-run="left"]');
    const rightRun = row?.querySelector('[data-spine-run="right"]');
    if (!heroBay || !leftRun || !rightRun) return false;

    const nativeProducts = Array.isArray(payload.products) ? payload.products : [];
    const nativeSlugs = new Set(nativeProducts.map((product) => product.slug));
    const suppressedSlugs = new Set(Array.isArray(payload.suppressedSlugs) ? payload.suppressedSlugs : []);
    const legacyProducts = readExistingProducts(row).filter((product) =>
      !nativeSlugs.has(product.slug) && !suppressedSlugs.has(product.slug));
    const products = [...nativeProducts, ...legacyProducts].slice(0, 43);
    heroBay.replaceChildren(products[0] ? createHero(products[0]) : createStockHero());
    const spines = products.slice(1);
    replaceRun(leftRun, spines.slice(0, 21));
    replaceRun(rightRun, spines.slice(21, 42));
    document.dispatchEvent(new CustomEvent("trg:homepage-shelves-updated", {
      detail: { shelf: key, count: products.length }
    }));
    return true;
  }

  function readExistingProducts(row) {
    const products = [];
    const seen = new Set();
    for (const link of row.querySelectorAll('[data-product-card="true"], [data-product-card]')) {
      let preview = {};
      try { preview = JSON.parse(link.dataset.guestProductPreview || "{}"); } catch {}
      const slug = String(link.dataset.slug || preview.slug || "").trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      products.push({
        id: String(link.dataset.productId || slug),
        slug,
        title: String(preview.title || link.title || slug),
        creator: String(preview.creator || "Tobacco Road Games"),
        priceLabel: String(preview.priceLabel || ""),
        description: String(preview.description || "Product details available on the full product page."),
        cover: String(preview.cover || link.querySelector("img")?.getAttribute("src") || "/assets/tobacco-road-games-logo.png"),
        fullUrl: String(preview.fullUrl || link.getAttribute("href") || `/store/products/${encodeURIComponent(slug)}/`)
      });
    }
    return products;
  }

  function replaceRun(run, products) {
    run.replaceChildren(...Array.from({ length: 21 }, (_, index) =>
      products[index] ? createSpine(products[index]) : createStockSpine()));
  }

  function hydrateBestSellers(products) {
    return hydrateShelf("bestSellers", { managed: Array.isArray(products) && products.length > 0, products, visible: true });
  }

  function hydratePayload(payload) {
    if (payload?.shelves) {
      hydrateOpenRulesLibrary(payload.shelves.openRulesLibraryUpper, payload.shelves.openRulesLibraryLower);
      for (const key of Object.keys(SHELVES)) hydrateShelf(key, payload.shelves[key]);
      return;
    }
    hydrateBestSellers(payload?.bestSellers || []);
  }

  window.TRGHomepageShelves = Object.freeze({ hydrateBestSellers, hydrateOpenRulesLibrary, hydratePayload, hydrateShelf });
  fetch("/api/homepage-shelves", { cache: "no-store", credentials: "same-origin" })
    .then((response) => response.ok ? response.json() : { bestSellers: [] })
    .then(hydratePayload)
    .catch(() => {})
    .finally(() => { document.documentElement.dataset.homepageShelvesRuntime = "ready"; });
})();
