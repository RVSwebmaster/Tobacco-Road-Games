(() => {
  const SHELVES = Object.freeze({
    openRulesLibrary: "open-rules-library-heading",
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

  function createOpenRulesSpine(product) {
    const link = document.createElement("a");
    const pageCount = Number(product.metadata?.pageCount);
    const shelfWidth = Math.max(10, Math.round(depthForPages(pageCount) * 188 / 340));
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

    const cover = document.createElement("img");
    cover.src = product.cover || "/assets/tobacco-road-games-logo.png";
    cover.alt = "";
    cover.loading = "lazy";
    cover.decoding = "async";
    cover.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "homepage-open-rules-book__title";
    title.textContent = product.title;
    title.setAttribute("aria-hidden", "true");

    const publisher = document.createElement("span");
    publisher.className = "homepage-open-rules-book__publisher";
    publisher.textContent = product.creator;
    publisher.setAttribute("aria-hidden", "true");
    link.append(cover, title, publisher);
    return link;
  }

  function hydrateGuestOpenRulesLibrary(rows, products) {
    rows.forEach((row, rowIndex) => {
      const shelfProducts = products.slice(rowIndex * 6, rowIndex * 6 + 6);
      const books = Array.from(row.querySelectorAll("[data-magical-book]")).slice(0, 6);
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

        const cover = document.createElement("img");
        cover.className = "guest-open-rules-real-book__cover";
        cover.src = product.cover || "/assets/tobacco-road-games-logo.png";
        cover.alt = "";
        cover.loading = "lazy";
        cover.decoding = "async";
        cover.setAttribute("aria-hidden", "true");

        const title = document.createElement("span");
        title.className = "guest-open-rules-real-book__title";
        title.textContent = product.title;
        title.setAttribute("aria-hidden", "true");

        const publisher = document.createElement("span");
        publisher.className = "guest-open-rules-real-book__publisher";
        publisher.textContent = product.creator;
        publisher.setAttribute("aria-hidden", "true");
        link.append(cover, title, publisher);
        book.replaceChildren(link);
      });
    });
    return true;
  }

  function hydrateOpenRulesLibrary(bay, payload = {}) {
    const products = Array.isArray(payload.products) ? payload.products.slice(0, 12) : [];
    const guestRows = Array.from(bay.querySelectorAll(".guest-open-rules-books"));
    if (guestRows.length === 2) hydrateGuestOpenRulesLibrary(guestRows, products);
    const rows = Array.from(bay.querySelectorAll("[data-fill-library]"));
    if (guestRows.length !== 2 && rows.length !== 2) return false;
    rows.forEach((row, index) => {
      const render = () => row.replaceChildren(
        ...products.slice(index * 6, index * 6 + 6).map(createOpenRulesSpine)
      );
      render();
      if (typeof ResizeObserver === "function") new ResizeObserver(render).observe(row.parentElement);
      else window.addEventListener("resize", render);
    });
    document.dispatchEvent(new CustomEvent("trg:homepage-shelves-updated", {
      detail: { shelf: "openRulesLibrary", count: products.length }
    }));
    return true;
  }

  function hydrateShelf(key, payload = {}) {
    const headingId = SHELVES[key];
    const bay = headingId ? document.querySelector(`[aria-labelledby="${headingId}"]`) : null;
    if (!bay) return false;
    bay.hidden = payload.visible === false;
    if (payload.visible === false || !payload.managed) return true;
    if (key === "openRulesLibrary") return hydrateOpenRulesLibrary(bay, payload);

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
      for (const key of Object.keys(SHELVES)) hydrateShelf(key, payload.shelves[key]);
      return;
    }
    hydrateBestSellers(payload?.bestSellers || []);
  }

  window.TRGHomepageShelves = Object.freeze({ hydrateBestSellers, hydratePayload, hydrateShelf });
  fetch("/api/homepage-shelves", { cache: "no-store", credentials: "same-origin" })
    .then((response) => response.ok ? response.json() : { bestSellers: [] })
    .then(hydratePayload)
    .catch(() => {})
    .finally(() => { document.documentElement.dataset.homepageShelvesRuntime = "ready"; });
})();
