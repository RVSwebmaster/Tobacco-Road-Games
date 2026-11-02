(() => {
  const SHELVES = Object.freeze({
    featuredCreator: "featured-creator-wall-heading",
    newThisWeek: "new-this-week-wall-heading",
    bestSellers: "best-sellers-wall-heading",
    freePwyw: "free-pwyw-wall-heading"
  });

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
