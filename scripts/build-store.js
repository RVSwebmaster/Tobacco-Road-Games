const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "products.json");
const BUNDLE_RULES_PATH = path.join(ROOT, "data", "bundle-rules.json");
const STORE_DIR = path.join(ROOT, "store");
const BASE_URL = "https://tobaccoroadgames.com";
const CACHE_BUST = "20260604e";
const SITE_NAME = "Tobacco Road Games";
const STORE_TITLE = "Tobacco Road Games Store";
const SUPPORT_URL = "/support.html";

const STATUS_LABELS = {
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

const PRICE_TYPE_LABELS = {
  "fixed-price": "Fixed Price",
  "free-download": "Free Download",
  "pay-what-you-want": "Pay What You Want",
  "manual-invoice": "Manual Invoice",
  "coming-soon": "Coming Soon",
  "preview-only": "Preview Only",
  retired: "Retired"
};

const LEGACY_BUY_MODE_MAP = {
  "paypal-manual": "manual-invoice",
  "external-link": "fixed-price",
  none: "coming-soon"
};

function main() {
  const products = loadProducts();
  const bundleRules = loadBundleRules();
  const indexes = buildIndexes(products);

  fs.rmSync(STORE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });

  writeFile("store/index.html", renderStoreHome(products, indexes));
  writeFile("store/catalog/index.html", renderCatalogPage(products, indexes));

  for (const product of products) {
    writeFile(`store/products/${product.slug}/index.html`, renderProductPage(product, products));
  }

  for (const author of indexes.authors) {
    writeFile(`store/authors/${author.slug}/index.html`, renderCollectionPage({
      title: author.name,
      kicker: "Author",
      description: `Browse Tobacco Road Games titles by ${author.name}.`,
      canonicalPath: `/store/authors/${author.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: "Author" },
        { label: author.name }
      ],
      cards: author.products.map((product) => renderProductCard(product))
    }));
  }

  for (const system of indexes.systems) {
    writeFile(`store/systems/${system.slug}/index.html`, renderCollectionPage({
      title: system.name,
      kicker: "Game System",
      description: `Browse Tobacco Road Games titles built for ${system.name}.`,
      canonicalPath: `/store/systems/${system.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: "Game System" },
        { label: system.name }
      ],
      cards: system.products.map((product) => renderProductCard(product))
    }));
  }

  for (const line of indexes.lines) {
    writeFile(`store/lines/${line.slug}/index.html`, renderCollectionPage({
      title: line.name,
      kicker: "Product Line",
      description: `Browse Tobacco Road Games titles filed under ${line.name}.`,
      canonicalPath: `/store/lines/${line.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: "Product Line" },
        { label: line.name }
      ],
      cards: line.products.map((product) => renderProductCard(product))
    }));
  }

  for (const status of indexes.statuses) {
    writeFile(`store/status/${status.slug}/index.html`, renderCollectionPage({
      title: status.label,
      kicker: "Release Status",
      description: `Browse Tobacco Road Games titles currently marked ${status.label.toLowerCase()}.`,
      canonicalPath: `/store/status/${status.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: "Status" },
        { label: status.label }
      ],
      cards: status.products.map((product) => renderProductCard(product))
    }));
  }

  writeFile(
    "store/bundles/bundle-what-you-want/index.html",
    renderBundlePlanningPage(bundleRules, products)
  );
  writeFile("store/sitemap.xml", renderStoreSitemap(products, indexes, bundleRules));

  console.log(`Storefront generated for ${products.length} products.`);
}

function loadProducts() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  return raw.map((product) => {
    const normalized = {
      ...product,
      authors: ensureArray(product.authors),
      format: ensureArray(product.format),
      fileList: ensureArray(product.fileList),
      previewImages: ensureArray(product.previewImages),
      features: ensureArray(product.features),
      tags: ensureArray(product.tags),
      relatedProducts: ensureArray(product.relatedProducts),
      currency: product.currency || "USD",
      status: product.status || "coming-soon",
      statusLabel: product.statusLabel || STATUS_LABELS[product.status] || "Unavailable",
      price: product.price || "",
      priceCents: normalizeCents(product.priceCents, product.price),
      minimumPrice: product.minimumPrice || "",
      minimumPriceCents: normalizeCents(product.minimumPriceCents, product.minimumPrice),
      suggestedPrice: product.suggestedPrice || "",
      suggestedPriceCents: normalizeCents(product.suggestedPriceCents, product.suggestedPrice),
      libraryEligible: Boolean(product.libraryEligible),
      updateEligible: Boolean(product.updateEligible),
      bundleEligible: Boolean(product.bundleEligible),
      bundleMinPriceCents: normalizeInteger(product.bundleMinPriceCents, 100),
      bundleGroup: product.bundleGroup || "standard-digital",
      allowSeasonalBundle: Boolean(product.allowSeasonalBundle),
      excludeFromBundles: Boolean(product.excludeFromBundles),
      buyMode: normalizeBuyMode(product.buyMode || inferBuyMode(product)),
      fulfillmentNote: product.fulfillmentNote || "",
      creationMethod: product.creationMethod || "",
      legalNote: product.legalNote || "",
      version: product.version || "",
      releaseDate: product.releaseDate || "",
      lastUpdated: product.lastUpdated || ""
    };

    normalized.url = `/store/products/${normalized.slug}/`;
    normalized.authorSlugs = normalized.authors.map((author) => slugify(author));
    normalized.assetSet = resolveProductAssets(normalized);
    normalized.releaseStamp = parseDate(normalized.releaseDate);
    normalized.updatedStamp = parseDate(normalized.lastUpdated);
    normalized.priceType = resolvePriceType(normalized);
    normalized.priceTypeLabel = PRICE_TYPE_LABELS[normalized.priceType] || "Not For Sale";
    normalized.availabilityLabel = normalized.statusLabel;

    return normalized;
  });
}

function loadBundleRules() {
  if (!fs.existsSync(BUNDLE_RULES_PATH)) {
    return {
      bundleName: "Bundle What You Want",
      shortName: "BWYW",
      active: false,
      seasonalOnly: true,
      season: "pre-christmas",
      minItems: 2,
      maxItems: 5,
      minimumEligiblePriceCents: 100,
      discounts: { "2": 10, "3": 15, "4": 20, "5": 25 },
      excludedStatuses: [
        "coming-soon",
        "preview-only",
        "retired",
        "legacy-not-for-sale",
        "free-download",
        "pay-what-you-want"
      ],
      allowCouponStacking: false
    };
  }

  return JSON.parse(fs.readFileSync(BUNDLE_RULES_PATH, "utf8"));
}

function buildIndexes(products) {
  const authorMap = new Map();
  const systemMap = new Map();
  const lineMap = new Map();
  const statusMap = new Map();
  const formatMap = new Map();
  const priceTypeMap = new Map();

  for (const product of products) {
    for (const author of product.authors) {
      const slug = slugify(author);
      if (!authorMap.has(slug)) {
        authorMap.set(slug, { slug, name: author, products: [] });
      }
      authorMap.get(slug).products.push(product);
    }

    collectIndex(systemMap, product.gameSystemSlug, product.gameSystem, product);
    collectIndex(lineMap, product.productLineSlug, product.productLine, product);
    collectIndex(statusMap, product.status, product.statusLabel, product, "label");
    collectIndex(priceTypeMap, product.priceType, product.priceTypeLabel, product, "label");

    for (const format of product.format) {
      const slug = slugify(format);
      collectIndex(formatMap, slug, format, product);
    }
  }

  return {
    authors: sortByName([...authorMap.values()]),
    systems: sortByName([...systemMap.values()]),
    lines: sortByName([...lineMap.values()]),
    statuses: sortByName([...statusMap.values()], "label"),
    formats: sortByName([...formatMap.values()]),
    priceTypes: sortByName([...priceTypeMap.values()], "label")
  };
}

function renderStoreHome(products, indexes) {
  const featured = chooseFeaturedProduct(products);
  const availableDirect = filterByStatus(products, "available-direct");
  const previewAvailable = filterByStatus(products, "preview-available");
  const comingSoon = filterByStatus(products, "coming-soon");

  return renderLayout({
    pageTitle: `${STORE_TITLE} | Digital Roleplaying Titles and Previews`,
    description: "Browse digital roleplaying titles, previews, and upcoming releases from Tobacco Road Games.",
    canonicalPath: "/store/",
    ogImage: featured?.assetSet.cover || "/assets/logo.png",
    currentNav: "store",
    structuredData: renderWebPageSchema({
      name: STORE_TITLE,
      description: "Browse digital roleplaying titles, previews, and upcoming releases from Tobacco Road Games.",
      url: `${BASE_URL}/store/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store" }])}

        <section class="store-hero store-section" aria-labelledby="store-home-heading">
          <div class="store-hero__copy">
            <p class="section-heading__kicker">Store</p>
            <h1 id="store-home-heading">Tobacco Road Games Store</h1>
            <p class="hero__lead">Browse digital roleplaying titles, previews, and upcoming releases from Tobacco Road Games. New direct-release titles will appear here first as the catalog is rebuilt.</p>
            <div class="hero__actions">
              <a class="button button--primary" href="/store/catalog/">Browse the Catalog</a>
              ${featured ? `<a class="button button--secondary" href="${featured.url}">Meet ${escapeHtml(featured.title)}</a>` : ""}
            </div>
          </div>
          <aside class="store-hero__aside">
            <article class="note-card">
              <p class="note-card__label">Direct Storefront</p>
              <h2>Digital titles, previews, and releases</h2>
              <p>Product pages lead the store, with clear buyer facts, useful previews, and direct-release titles added as the catalog returns.</p>
            </article>
            <article class="creation-standard-placard">
              <p class="creation-standard-title">Our Creation Standard</p>
              <p class="creation-standard-copy">Tobacco Road Games is not anti AI or pro AI. We are pro honesty, pro rights, pro quality, and pro customer choice.</p>
              <p class="creation-standard-copy">We do not reject tools. We reject deception, theft, spam, and lazy shovelware.</p>
              <p class="creation-standard-motto">Tell the truth. Own your work. Respect the buyer. Make something worth buying.</p>
            </article>
          </aside>
        </section>

        ${featured ? `
          <section class="store-feature store-section" aria-labelledby="featured-product-heading">
            <div class="section-heading">
              <p class="section-heading__kicker">Featured Title</p>
              <h2 id="featured-product-heading">${escapeHtml(featured.title)}</h2>
              <p>${escapeHtml(featured.shortDescription)}</p>
            </div>
            ${renderFeatureSpotlight(featured)}
          </section>
        ` : ""}

        <section class="store-section" aria-labelledby="purchase-promise-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Store Policy</p>
            <h2 id="purchase-promise-heading">Digital Purchase Promise</h2>
          </div>
          <div class="about__panel">
            <p>Tobacco Road Games sells digital roleplaying material for personal tabletop use.</p>
            <p>Files are provided without DRM.</p>
            <p>Product pages show format, version, and update information.</p>
            <p>If something goes wrong with delivery, contact Tobacco Road Games for help.</p>
          </div>
        </section>

        ${renderStoreSection("available-direct-products-heading", "Available Direct", "Available Direct", availableDirect)}
        ${renderStoreSection("preview-available-products-heading", "Preview Available", "Preview Available", previewAvailable)}
        ${renderStoreSection("coming-soon-products-heading", "Coming Soon", "Coming Soon", comingSoon)}

        ${renderBrowseSection("Browse by Game System", indexes.systems, "systems")}
        ${renderBrowseSection("Browse by Product Line", indexes.lines, "lines")}
        ${renderBrowseSection("Browse by Author", indexes.authors, "authors")}

        <section class="store-section store-callout" aria-labelledby="catalog-link-heading">
          <div class="store-callout__copy">
            <p class="section-heading__kicker">Catalog</p>
            <h2 id="catalog-link-heading">Search and browse the full Tobacco Road Games catalog.</h2>
            <p>Search titles by author, game system, product line, status, format, and price type from one clean catalog page.</p>
          </div>
          <div class="store-callout__panel">
            <p class="note-card__label">Catalog Access</p>
            <a class="button button--primary button--wide" href="/store/catalog/">Open the Catalog</a>
          </div>
        </section>
      </main>
    `
  });
}

function renderCatalogPage(products, indexes) {
  const sortedProducts = sortProducts(products, "title");
  const initials = buildTitleIndex(sortedProducts);

  return renderLayout({
    pageTitle: `${STORE_TITLE} Catalog | Search and Browse Titles`,
    description: "Search and browse Tobacco Road Games titles by author, game system, product line, release status, and title.",
    canonicalPath: "/store/catalog/",
    ogImage: sortedProducts[0]?.assetSet.cover || "/assets/logo.png",
    currentNav: "catalog",
    extraScripts: ["/assets/js/storefront.js?v=" + CACHE_BUST],
    structuredData: renderWebPageSchema({
      name: `${STORE_TITLE} Catalog`,
      description: "Search and browse Tobacco Road Games titles by author, game system, product line, release status, and title.",
      url: `${BASE_URL}/store/catalog/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store", href: "/store/" }, { label: "Catalog" }])}

        <section class="store-section" aria-labelledby="catalog-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Catalog</p>
            <h1 id="catalog-heading">Search and browse Tobacco Road Games titles.</h1>
            <p>Browse by author, game system, product line, release status, format, and price type.</p>
          </div>

          <div class="catalog-controls" id="catalog-controls">
            <label class="catalog-control">
              <span>Title Search</span>
              <input id="catalog-search" class="dock-input" type="search" placeholder="Search titles, authors, systems, tags">
            </label>

            <label class="catalog-control">
              <span>Author</span>
              <select id="catalog-author" class="dock-input">
                <option value="">All Authors</option>
                ${indexes.authors.map((author) => `<option value="${escapeAttribute(author.slug)}">${escapeHtml(author.name)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Game System</span>
              <select id="catalog-system" class="dock-input">
                <option value="">All Game Systems</option>
                ${indexes.systems.map((system) => `<option value="${escapeAttribute(system.slug)}">${escapeHtml(system.name)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Product Line</span>
              <select id="catalog-line" class="dock-input">
                <option value="">All Product Lines</option>
                ${indexes.lines.map((line) => `<option value="${escapeAttribute(line.slug)}">${escapeHtml(line.name)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Status</span>
              <select id="catalog-status" class="dock-input">
                <option value="">All Statuses</option>
                ${indexes.statuses.map((status) => `<option value="${escapeAttribute(status.slug)}">${escapeHtml(status.label)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Format</span>
              <select id="catalog-format" class="dock-input">
                <option value="">All Formats</option>
                ${indexes.formats.map((format) => `<option value="${escapeAttribute(format.slug)}">${escapeHtml(format.name)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Price Type</span>
              <select id="catalog-price-type" class="dock-input">
                <option value="">All Price Types</option>
                ${indexes.priceTypes.map((entry) => `<option value="${escapeAttribute(entry.slug)}">${escapeHtml(entry.label)}</option>`).join("")}
              </select>
            </label>

            <label class="catalog-control">
              <span>Sort</span>
              <select id="catalog-sort" class="dock-input">
                <option value="title">Title A to Z</option>
                <option value="newest">Newest</option>
                <option value="updated">Recently Updated</option>
                <option value="price-low">Price Low to High</option>
                <option value="price-high">Price High to Low</option>
              </select>
            </label>
          </div>

          <div class="catalog-tools">
            <p id="catalog-count" class="catalog-count">${sortedProducts.length} titles in the catalog</p>
            <div class="title-index" aria-label="Title index">
              ${initials.map((entry) => `<a class="title-index__link" href="#product-${escapeAttribute(entry.slug)}">${escapeHtml(entry.letter)}</a>`).join("")}
            </div>
          </div>

          <div id="catalog-empty" class="initiative-empty" hidden>No titles match the current search and filters.</div>

          <div id="catalog-grid" class="product-card-grid">
            ${sortedProducts.map((product) => renderProductCard(product, { withDataset: true, includeAnchorId: true })).join("")}
          </div>
        </section>
      </main>
    `
  });
}

function renderProductPage(product, products) {
  const relatedProducts = resolveRelatedProducts(product, products);
  const buyUi = renderBuyUi(product);
  const previewSection = renderPreviewSection(product);
  const detailsItems = [
    renderIdentityItem("Author", product.authors.join(", ")),
    renderIdentityItem("Game System", product.gameSystem),
    renderIdentityItem("Product Line", product.productLine),
    renderIdentityItem("Format", product.format.join(", ") || "TBD"),
    renderIdentityItem("Pages", product.pageCount ? String(product.pageCount) : "TBD"),
    renderIdentityItem("Status", product.statusLabel),
    renderIdentityItem("Version", product.version || "TBD"),
    renderIdentityItem("Last Updated", product.lastUpdated || "TBD"),
    renderIdentityItem("Delivery", renderDeliveryLabel(product)),
    renderIdentityItem("Price", renderDisplayPrice(product))
  ];

  const detailPanels = [
    renderFactCard("What You Are Getting", renderPurchaseSummary(product)),
    renderFactCard(product.buyMode === "preview-only" ? "Planned Release Format" : "Files Included", renderFileListSummary(product)),
    renderDigitalPurchasePromise()
  ];

  const afterPurchaseSection = buyUi.afterPurchase
    ? `
      <section class="store-section" aria-labelledby="after-purchase-heading">
        <div class="section-heading">
          <p class="section-heading__kicker">After Purchase</p>
          <h2 id="after-purchase-heading">After Purchase</h2>
        </div>
        <div class="product-support-grid">
          ${buyUi.afterPurchase}
          ${renderSupportCard()}
        </div>
      </section>
    `
    : "";

  const creationSection = product.creationMethod
    ? `
      <section class="store-section" aria-labelledby="creation-notes-heading">
        <div class="section-heading">
          <p class="section-heading__kicker">Creation Notes</p>
          <h2 id="creation-notes-heading">Creation Notes</h2>
        </div>
        <div class="about__panel">
          <p>${escapeHtml(product.creationMethod)}</p>
        </div>
      </section>
    `
    : "";

  const legalSection = product.legalNote
    ? `
      <section class="store-section" aria-labelledby="legal-notes-heading">
        <div class="section-heading">
          <p class="section-heading__kicker">Legal Notes</p>
          <h2 id="legal-notes-heading">Legal Notes</h2>
        </div>
        <div class="about__panel">
          <p>${escapeHtml(product.legalNote)}</p>
        </div>
      </section>
    `
    : "";

  return renderLayout({
    pageTitle: `${product.title} | ${STORE_TITLE}`,
    description: product.shortDescription,
    canonicalPath: product.url,
    ogImage: product.assetSet.cover,
    currentNav: "store",
    structuredData: [
      renderBreadcrumbSchema([
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: product.title, href: product.url }
      ]),
      renderProductSchema(product)
    ],
    content: `
      <main id="top">
        ${renderBreadcrumbs([
          { label: "Store", href: "/store/" },
          { label: "Catalog", href: "/store/catalog/" },
          { label: product.title }
        ])}

        <section class="product-hero store-section" aria-labelledby="product-title">
          <div class="product-hero__media">
            <img class="product-cover" src="${escapeAttribute(product.assetSet.cover)}" alt="${escapeAttribute(product.title)} front cover">
          </div>
          <div class="product-hero__copy">
            <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
            <p class="section-heading__kicker">${escapeHtml(product.gameSystem)}</p>
            <h1 id="product-title">${escapeHtml(product.title)}</h1>
            <p class="product-subtitle">${escapeHtml(product.subtitle)}</p>
            <div class="product-hero__meta">
              <span>${escapeHtml(renderDisplayPrice(product))}</span>
              <span>${escapeHtml(product.format.join(", ") || "Format TBD")}</span>
              <span>${escapeHtml(product.pageCount ? `${product.pageCount} pages` : "Page count TBD")}</span>
              <span>${escapeHtml(product.productLine)}</span>
              <span>${escapeHtml(product.version || "Version TBD")}</span>
              <span>${escapeHtml(product.lastUpdated || "Update date TBD")}</span>
            </div>
            <div class="hero__actions">
              ${buyUi.primary}
              ${product.assetSet.previewPdf ? `<a class="button button--secondary" href="${escapeAttribute(product.assetSet.previewPdf)}" target="_blank" rel="noopener noreferrer">Open Preview PDF</a>` : ""}
            </div>
            <p class="fulfillment-note">${escapeHtml(product.shortDescription)}</p>
          </div>
        </section>

        <section class="store-section" aria-labelledby="details-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Details</p>
            <h2 id="details-heading">Details</h2>
          </div>
          <dl class="identity-strip">
            ${detailsItems.join("")}
          </dl>
          <div class="product-support-grid">
            ${detailPanels.join("")}
          </div>
        </section>

        <section class="store-section" aria-labelledby="overview-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Overview</p>
            <h2 id="overview-heading">Overview</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(product.shortDescription)}</p>
          </div>
        </section>

        <section class="store-section" aria-labelledby="about-book-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">About This Book</p>
            <h2 id="about-book-heading">About This Book</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(product.longDescription || product.shortDescription)}</p>
          </div>
        </section>

        ${product.features.length ? `
          <section class="store-section" aria-labelledby="contents-heading">
            <div class="section-heading">
              <p class="section-heading__kicker">What's Inside</p>
              <h2 id="contents-heading">What's Inside</h2>
            </div>
            <ul class="feature-list">
              ${product.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
          </section>
        ` : ""}

        ${previewSection}
        ${afterPurchaseSection}
        ${creationSection}
        ${legalSection}

        <section class="store-section" aria-labelledby="related-titles-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Related Titles</p>
            <h2 id="related-titles-heading">Related Titles</h2>
          </div>
          ${renderRelatedProducts(relatedProducts)}
        </section>
      </main>
    `
  });
}

function renderCollectionPage({ title, kicker, description, canonicalPath, breadcrumbs, cards }) {
  return renderLayout({
    pageTitle: `${title} | ${STORE_TITLE}`,
    description,
    canonicalPath,
    ogImage: "/assets/logo.png",
    currentNav: "store",
    structuredData: renderBreadcrumbSchema(breadcrumbs),
    content: `
      <main id="top">
        ${renderBreadcrumbs(breadcrumbs)}
        <section class="store-section" aria-labelledby="${slugify(title)}-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">${escapeHtml(kicker)}</p>
            <h1 id="${slugify(title)}-heading">${escapeHtml(title)}</h1>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="product-card-grid">
            ${cards.join("")}
          </div>
        </section>
      </main>
    `
  });
}

function renderBundlePlanningPage(bundleRules, products) {
  const eligibleProducts = products.filter((product) => isBundleEligible(product, bundleRules));
  return renderLayout({
    pageTitle: `${bundleRules.bundleName} | ${STORE_TITLE}`,
    description: `${bundleRules.bundleName} planning page for future Tobacco Road Games seasonal bundle events.`,
    canonicalPath: "/store/bundles/bundle-what-you-want/",
    ogImage: "/assets/logo.png",
    currentNav: "store",
    metaRobots: "noindex, nofollow",
    content: `
      <main id="top">
        ${renderBreadcrumbs([
          { label: "Store", href: "/store/" },
          { label: "Bundles" },
          { label: bundleRules.bundleName }
        ])}

        <section class="store-section" aria-labelledby="bundle-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Seasonal Bundle Planning</p>
            <h1 id="bundle-heading">${escapeHtml(bundleRules.bundleName)}</h1>
            <p>This planning page is kept off the public store navigation until the seasonal bundle is activated.</p>
          </div>
          <div class="about__panel">
            <p>Active now: ${bundleRules.active ? "Yes" : "No"}</p>
            <p>Eligible item count: ${eligibleProducts.length}</p>
            <p>Discount ladder: ${Object.entries(bundleRules.discounts).map(([count, discount]) => `${count} items, ${discount} percent off`).join(" | ")}</p>
            <p>Season: ${escapeHtml(bundleRules.season || "seasonal")}</p>
          </div>
        </section>
      </main>
    `
  });
}

function renderLayout({
  pageTitle,
  description,
  canonicalPath,
  ogImage,
  currentNav,
  structuredData,
  extraScripts = [],
  metaRobots = "",
  content
}) {
  const canonicalUrl = `${BASE_URL}${canonicalPath}`;
  const resolvedOgImage = `${BASE_URL}${ogImage || "/assets/logo.png"}`;
  const nav = renderStoreNav(currentNav);
  const structuredDataBlocks = Array.isArray(structuredData)
    ? structuredData.filter(Boolean)
    : structuredData
      ? [structuredData]
      : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttribute(description)}">
  <link rel="canonical" href="${escapeAttribute(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeAttribute(SITE_NAME)}">
  <meta property="og:title" content="${escapeAttribute(pageTitle)}">
  <meta property="og:description" content="${escapeAttribute(description)}">
  <meta property="og:url" content="${escapeAttribute(canonicalUrl)}">
  <meta property="og:image" content="${escapeAttribute(resolvedOgImage)}">
  <meta name="theme-color" content="#120c08">
  ${metaRobots ? `<meta name="robots" content="${escapeAttribute(metaRobots)}">` : ""}
  <link rel="icon" type="image/png" href="/assets/logo.png?v=${CACHE_BUST}">
  <link rel="stylesheet" href="/styles.css?v=${CACHE_BUST}">
  ${structuredDataBlocks.map((block) => `<script type="application/ld+json">${block}</script>`).join("\n  ")}
  ${extraScripts.map((src) => `<script src="${escapeAttribute(src)}" defer></script>`).join("\n  ")}
</head>
<body class="view-section">
  <div class="page-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="Tobacco Road Games home">
        <img class="brand__logo" src="/assets/logo.png?v=${CACHE_BUST}" alt="Tobacco Road Games logo">
        <div class="brand__copy">
          <span class="brand__name">Tobacco Road Games</span>
          <span class="brand__tag">Publisher-owned store and workshop catalog</span>
        </div>
      </a>

      ${nav}
    </header>

    ${content}

    <footer class="site-footer">
      <a class="footer-mark" href="/ad-depot.html" title="Ad depot" aria-label="Ad depot">
        <img src="/assets/logo.png?v=${CACHE_BUST}" alt="">
      </a>
      <p>&copy; 2026 Tobacco Road Games.</p>
      <p>Published by RV Sawyer, built for tables that still surprise the person running them.</p>
      <a class="footer-link" href="/ai-statement.html">Read the AI Statement</a>
    </footer>
  </div>
</body>
</html>`;
}

function renderStoreNav(currentNav) {
  const items = [
    { key: "home", href: "/", label: "Home" },
    { key: "store", href: "/store/", label: "Store" },
    { key: "catalog", href: "/store/catalog/", label: "Catalog" },
    { key: "ai", href: "/ai-statement.html", label: "AI Statement" }
  ];

  return `
    <nav class="site-nav" aria-label="Store navigation">
      ${items.map((item) => `<a href="${item.href}"${currentNav === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}
    </nav>
  `;
}

function renderFeatureSpotlight(product) {
  return `
    <article class="store-spotlight">
      <div class="store-spotlight__media">
        <img src="${escapeAttribute(product.assetSet.cover)}" alt="${escapeAttribute(product.title)} cover">
      </div>
      <div class="store-spotlight__copy">
        <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
        <h3>${escapeHtml(product.title)}</h3>
        <p class="product-subtitle">${escapeHtml(product.subtitle)}</p>
        <p>${escapeHtml(product.shortDescription)}</p>
        <div class="hero__actions">
          <a class="button button--primary" href="${product.url}">Open Product Page</a>
          <a class="button button--secondary" href="/store/catalog/">Open the Catalog</a>
        </div>
      </div>
    </article>
  `;
}

function renderProductCard(product, options = {}) {
  const { withDataset = false, includeAnchorId = false } = options;
  const searchText = [
    product.title,
    product.subtitle,
    product.authors.join(" "),
    product.gameSystem,
    product.productLine,
    product.tags.join(" "),
    product.statusLabel,
    product.priceTypeLabel
  ].join(" ").toLowerCase();

  const dataset = withDataset
    ? [
        `data-product-card="true"`,
        `data-title="${escapeAttribute(product.title.toLowerCase())}"`,
        `data-author="${escapeAttribute(product.authorSlugs.join("|"))}"`,
        `data-system="${escapeAttribute(product.gameSystemSlug)}"`,
        `data-line="${escapeAttribute(product.productLineSlug)}"`,
        `data-status="${escapeAttribute(product.status)}"`,
        `data-format="${escapeAttribute(product.format.map(slugify).join("|"))}"`,
        `data-price-type="${escapeAttribute(slugify(product.priceTypeLabel))}"`,
        `data-price-cents="${escapeAttribute(String(product.priceCents ?? -1))}"`,
        `data-release="${escapeAttribute(String(product.releaseStamp))}"`,
        `data-updated="${escapeAttribute(String(product.updatedStamp))}"`,
        `data-search="${escapeAttribute(searchText)}"`
      ].join(" ")
    : "";
  const cardId = includeAnchorId ? `id="product-${escapeAttribute(product.slug)}"` : "";

  return `
    <article class="product-card" ${cardId} ${dataset}>
      <div class="product-card__media">
        <img src="${escapeAttribute(product.assetSet.thumb)}" alt="${escapeAttribute(product.title)} thumbnail">
      </div>
      <div class="product-card__body">
        <div class="product-card__topline">
          <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
          <span class="product-card__price">${escapeHtml(renderCardPrice(product))}</span>
        </div>
        <h3 class="product-card__title">${escapeHtml(product.title)}</h3>
        <p class="product-card__subtitle">${escapeHtml(product.subtitle)}</p>
        <p class="product-card__meta">${escapeHtml(product.authors.join(", "))}</p>
        <p class="product-card__meta">${escapeHtml(product.gameSystem)} | ${escapeHtml(product.productLine)}</p>
        <p class="product-card__meta">${escapeHtml(product.format.join(", ") || "Format TBD")}</p>
        <div class="product-card__actions">
          <a class="button button--secondary product-card__button" href="${product.url}">View Product</a>
        </div>
      </div>
    </article>
  `;
}

function renderBrowseCard(title, note, href) {
  return `
    <a class="browse-card" href="${href}">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(note)}</p>
    </a>
  `;
}

function renderStoreSection(id, kicker, title, products) {
  if (!products.length) {
    return "";
  }

  return `
    <section class="store-section" aria-labelledby="${id}">
      <div class="section-heading">
        <p class="section-heading__kicker">${escapeHtml(kicker)}</p>
        <h2 id="${id}">${escapeHtml(title)}</h2>
      </div>
      <div class="product-card-grid">
        ${products.map((product) => renderProductCard(product)).join("")}
      </div>
    </section>
  `;
}

function renderBrowseSection(title, entries, segment) {
  if (!entries.length) {
    return "";
  }

  return `
    <section class="store-section" aria-labelledby="${slugify(title)}-heading">
      <div class="section-heading">
        <p class="section-heading__kicker">Browse</p>
        <h2 id="${slugify(title)}-heading">${escapeHtml(title)}</h2>
      </div>
      <div class="browse-card-grid">
        ${entries.map((entry) => renderBrowseCard(entry.name, `${entry.products.length} title${entry.products.length === 1 ? "" : "s"}`, `/store/${segment}/${entry.slug}/`)).join("")}
      </div>
    </section>
  `;
}

function renderPreviewSection(product) {
  const previews = product.assetSet.previewImages;
  const teaser = product.assetSet.teaserVideo;
  const sample = product.assetSet.previewPdf;

  if (!previews.length && !teaser && !sample) {
    return "";
  }

  return `
    <section class="store-section" aria-labelledby="preview-heading">
      <div class="section-heading">
        <p class="section-heading__kicker">Preview</p>
        <h2 id="preview-heading">Preview</h2>
      </div>
      <div class="preview-panel">
        ${teaser ? `
          <div class="preview-video">
            <video controls preload="metadata" playsinline>
              <source src="${escapeAttribute(teaser)}" type="video/mp4">
              Your browser does not support embedded video.
            </video>
          </div>
        ` : ""}
        ${previews.length ? `
          <div class="preview-grid">
            ${previews.map((preview, index) => `
              <figure class="preview-figure">
                <img src="${escapeAttribute(preview)}" alt="${escapeAttribute(product.title)} preview page ${index + 1}">
              </figure>
            `).join("")}
          </div>
        ` : ""}
        ${sample ? `
          <div class="hero__actions">
            <a class="button button--secondary" href="${escapeAttribute(sample)}" target="_blank" rel="noopener noreferrer">Open Preview PDF</a>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderBuyUi(product) {
  const active = isBuyModeActive(product.buyMode);
  const supportLink = `<a class="inline-link" href="${SUPPORT_URL}">Questions about an order? Contact Tobacco Road Games.</a>`;

  if (product.buyMode === "fixed-price" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Buy Now</a>`,
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">After Purchase</p>
          <p>Digital orders are currently fulfilled by email after payment confirmation. You will receive the listed files or download link at the email address associated with your order.</p>
          <p>${supportLink}</p>
        </article>
      `,
      active
    };
  }

  if (product.buyMode === "manual-invoice" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Order Direct</a>`,
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">After Purchase</p>
          <p>Digital orders are currently fulfilled by email after payment confirmation. You will receive the listed files or download link at the email address associated with your order.</p>
          <p>${escapeHtml(product.fulfillmentNote || "Manual fulfillment details will be confirmed when the order is received.")}</p>
          <p>${supportLink}</p>
        </article>
      `,
      active
    };
  }

  if (product.buyMode === "free-download" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}">Download Free</a>`,
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">After Purchase</p>
          <p>Your download should begin immediately from the product page or linked file. Version and update information remain listed here for future reference.</p>
          <p>${supportLink}</p>
        </article>
      `,
      active
    };
  }

  if (product.buyMode === "pay-what-you-want" && product.buyUrl) {
    const guidance = renderPayWhatYouWantGuidance(product);
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Pay What You Want</a>`,
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">After Purchase</p>
          <p>Digital orders are currently fulfilled by email after payment confirmation. You will receive the listed files or download link at the email address associated with your order.</p>
          ${guidance ? `<p>${escapeHtml(guidance)}</p>` : ""}
          <p>${supportLink}</p>
        </article>
      `,
      active
    };
  }

  return {
    primary: `<span class="button button--secondary button--pending" aria-disabled="true">${escapeHtml(product.statusLabel)}</span>`,
    afterPurchase: "",
    active
  };
}

function renderIdentityItem(label, value) {
  return `
    <div class="identity-strip__item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderBreadcrumbs(items) {
  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      ${items.map((item, index) => {
        const content = item.href
          ? `<a href="${item.href}">${escapeHtml(item.label)}</a>`
          : `<span aria-current="page">${escapeHtml(item.label)}</span>`;
        return `${content}${index < items.length - 1 ? '<span class="breadcrumbs__sep">/</span>' : ""}`;
      }).join("")}
    </nav>
  `;
}

function renderWebPageSchema({ name, description, url }) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url
  });
}

function renderBreadcrumbSchema(items) {
  const list = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.label,
    item: item.href ? `${BASE_URL}${item.href}` : undefined
  })).map((entry) => {
    if (!entry.item) {
      delete entry.item;
    }
    return entry;
  });

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list
  });
}

function renderProductSchema(product) {
  const imageList = [
    product.assetSet.cover,
    ...product.assetSet.previewImages
  ].filter(Boolean).map((sitePath) => `${BASE_URL}${sitePath}`);

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.shortDescription,
    image: imageList,
    brand: {
      "@type": "Brand",
      name: product.publisher
    },
    sku: product.slug,
    category: product.productLine,
    url: `${BASE_URL}${product.url}`
  };

  if (product.priceCents !== null && product.currency && product.buyUrl && isBuyModeActive(product.buyMode)) {
    schema.offers = {
      "@type": "Offer",
      price: centsToDecimal(product.priceCents),
      priceCurrency: product.currency,
      availability: product.status === "available-direct" ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
      url: product.buyUrl
    };
  }

  return JSON.stringify(schema);
}

function renderStoreSitemap(products, indexes, bundleRules) {
  const urls = [
    "/store/",
    "/store/catalog/",
    ...products.map((product) => product.url),
    ...indexes.authors.map((author) => `/store/authors/${author.slug}/`),
    ...indexes.systems.map((system) => `/store/systems/${system.slug}/`),
    ...indexes.lines.map((line) => `/store/lines/${line.slug}/`),
    ...indexes.statuses.map((status) => `/store/status/${status.slug}/`)
  ];

  if (bundleRules.active) {
    urls.push("/store/bundles/bundle-what-you-want/");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${BASE_URL}${url}</loc></url>`).join("\n")}
</urlset>`;
}

function resolveRelatedProducts(product, products) {
  const explicit = product.relatedProducts
    .map((slug) => products.find((candidate) => candidate.slug === slug))
    .filter(Boolean);

  if (explicit.length) {
    return explicit.slice(0, 3);
  }

  return products
    .filter((candidate) => candidate.slug !== product.slug)
    .filter((candidate) =>
      candidate.gameSystemSlug === product.gameSystemSlug ||
      candidate.productLineSlug === product.productLineSlug
    )
    .slice(0, 3);
}

function chooseFeaturedProduct(products) {
  return products.find((product) => product.status === "available-direct")
    || products.find((product) => product.status === "preview-available")
    || sortProducts(products, "updated")[0]
    || null;
}

function sortProducts(products, mode) {
  const list = [...products];

  if (mode === "newest") {
    return list.sort((a, b) => (b.releaseStamp || b.updatedStamp) - (a.releaseStamp || a.updatedStamp));
  }

  if (mode === "updated") {
    return list.sort((a, b) => b.updatedStamp - a.updatedStamp);
  }

  if (mode === "price-low") {
    return list.sort((a, b) => comparePriceCents(a.priceCents, b.priceCents));
  }

  if (mode === "price-high") {
    return list.sort((a, b) => comparePriceCents(b.priceCents, a.priceCents));
  }

  return list.sort((a, b) => a.title.localeCompare(b.title));
}

function buildTitleIndex(products) {
  const seen = new Set();
  const entries = [];
  for (const product of products) {
    const letter = product.title.charAt(0).toUpperCase();
    if (!seen.has(letter)) {
      seen.add(letter);
      entries.push({ letter, slug: product.slug });
    }
  }
  return entries;
}

function resolveProductAssets(product) {
  const cover = pickExisting(product.frontCoverImage, product.thumbnailImage, "/assets/logo.png");
  const thumb = pickExisting(product.thumbnailImage, product.frontCoverImage, "/assets/logo.png");
  const previewImages = product.previewImages.filter((sitePath) => sitePath && sitePathExists(sitePath));
  const previewPdf = sitePathExists(product.previewPdf) ? product.previewPdf : "";
  const teaserVideo = sitePathExists(product.teaserVideo) ? product.teaserVideo : "";

  return { cover, thumb, previewImages, previewPdf, teaserVideo };
}

function pickExisting(...pathsToTry) {
  for (const sitePath of pathsToTry) {
    if (sitePath && sitePathExists(sitePath)) {
      return sitePath;
    }
  }
  return "/assets/logo.png";
}

function sitePathExists(sitePath) {
  if (!sitePath) {
    return false;
  }
  const localPath = path.join(ROOT, sitePath.replace(/^\/+/, ""));
  return fs.existsSync(localPath);
}

function parseDate(value) {
  if (!value) {
    return 0;
  }
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? 0 : stamp;
}

function formatPrice(product) {
  if (product.priceCents !== null) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: product.currency || "USD"
    }).format(centsToDecimal(product.priceCents));
  }

  if (product.price) {
    return product.price;
  }

  return "";
}

function renderCardPrice(product) {
  if (product.buyMode === "pay-what-you-want") {
    return "Pay What You Want";
  }
  if (product.buyMode === "free-download") {
    return "Free Download";
  }
  if (product.priceCents !== null) {
    return formatPrice(product);
  }
  return product.statusLabel;
}

function renderDisplayPrice(product) {
  if (product.buyMode === "pay-what-you-want") {
    const minimum = product.minimumPriceCents !== null ? `Minimum ${formatCents(product.minimumPriceCents, product.currency)}` : "";
    const suggested = product.suggestedPriceCents !== null ? `Suggested ${formatCents(product.suggestedPriceCents, product.currency)}` : "";
    return [product.statusLabel, minimum, suggested].filter(Boolean).join(" | ");
  }

  if (product.buyMode === "free-download") {
    return "Free Download";
  }

  if (product.priceCents !== null) {
    return formatPrice(product);
  }

  return product.statusLabel;
}

function renderDeliveryLabel(product) {
  if (product.buyMode === "free-download") {
    return "Direct download from the product page";
  }
  if (isBuyModeActive(product.buyMode)) {
    return "Email delivery after payment confirmation";
  }
  if (product.buyMode === "preview-only") {
    return "Preview only";
  }
  return "Not yet available for direct purchase";
}

function renderFileListSummary(product) {
  if (product.buyMode === "preview-only") {
    const plannedFormat = product.format.length ? product.format.join(", ") : "digital file";
    return `No downloadable file is included on this preview page. Planned release format: ${plannedFormat}.`;
  }
  if (product.fileList.length) {
    return product.fileList.join(", ");
  }
  if (product.format.length) {
    return `Files will be listed with the final ${product.format.join(", ")} release.`;
  }
  return "File list will be posted with the final release.";
}

function renderPurchaseSummary(product) {
  if (product.buyMode === "preview-only") {
    return `${product.title} is currently presented as a preview page with artwork, product details, and preview assets only.`;
  }
  if (product.buyMode === "coming-soon") {
    return `${product.title} is listed here with current format, status, and update information while direct ordering is being prepared.`;
  }
  return `You are buying ${product.title} in the listed digital format${product.pageCount ? `, currently ${product.pageCount} pages` : ""}, for personal tabletop use.`;
}

function renderFactCard(title, body) {
  return `
    <article class="note-card">
      <p class="note-card__label">${escapeHtml(title)}</p>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
}

function renderDigitalPurchasePromise() {
  return `
    <article class="note-card">
      <p class="note-card__label">Digital Purchase Promise</p>
      <p>When you buy a digital title directly from Tobacco Road Games, you are buying access to the listed files for personal use at your table. If a file is updated, the product page will show the current version and update date.</p>
    </article>
  `;
}

function renderSupportCard() {
  return `
    <article class="note-card">
      <p class="note-card__label">Order Support</p>
      <p>If something goes wrong with delivery, contact Tobacco Road Games for help.</p>
      <p><a class="inline-link" href="${SUPPORT_URL}">Questions about an order? Contact Tobacco Road Games.</a></p>
    </article>
  `;
}

function renderRelatedProducts(products) {
  if (!products.length) {
    return `
      <div class="about__panel">
        <p>More related titles will appear here as the catalog grows.</p>
      </div>
    `;
  }

  return `
    <div class="product-card-grid">
      ${products.map((product) => renderProductCard(product)).join("")}
    </div>
  `;
}

function renderPayWhatYouWantGuidance(product) {
  const pieces = [];
  if (product.minimumPriceCents !== null) {
    pieces.push(`Minimum price ${formatCents(product.minimumPriceCents, product.currency)}`);
  }
  if (product.suggestedPriceCents !== null) {
    pieces.push(`Suggested price ${formatCents(product.suggestedPriceCents, product.currency)}`);
  }
  return pieces.join(". ");
}

function filterByStatus(products, status) {
  return products.filter((product) => product.status === status);
}

function collectIndex(map, slug, name, product, nameField = "name") {
  if (!slug || !name) {
    return;
  }
  if (!map.has(slug)) {
    map.set(slug, { slug, [nameField]: name, name, products: [] });
  }
  map.get(slug).products.push(product);
}

function resolvePriceType(product) {
  if (product.buyMode && PRICE_TYPE_LABELS[product.buyMode]) {
    return product.buyMode;
  }
  if (product.priceCents !== null) {
    return "fixed-price";
  }
  return product.status;
}

function isBuyModeActive(buyMode) {
  return ["fixed-price", "free-download", "pay-what-you-want", "manual-invoice"].includes(buyMode);
}

function inferBuyMode(product) {
  if (product.status === "available-direct" && product.buyUrl) {
    return "fixed-price";
  }
  if (product.status === "free-download") {
    return "free-download";
  }
  if (product.status === "pay-what-you-want") {
    return "pay-what-you-want";
  }
  if (product.status === "preview-available") {
    return "preview-only";
  }
  if (product.status === "retired" || product.status === "legacy-not-for-sale") {
    return "retired";
  }
  return "coming-soon";
}

function normalizeBuyMode(value) {
  if (!value) {
    return "coming-soon";
  }
  return LEGACY_BUY_MODE_MAP[value] || value;
}

function isBundleEligible(product, bundleRules) {
  if (!bundleRules.active && !product.allowSeasonalBundle) {
    return false;
  }
  if (!product.bundleEligible || product.excludeFromBundles) {
    return false;
  }
  if (!product.allowSeasonalBundle) {
    return false;
  }
  if (bundleRules.excludedStatuses.includes(product.status)) {
    return false;
  }
  if (product.priceCents === null) {
    return false;
  }
  return product.priceCents >= bundleRules.minimumEligiblePriceCents;
}

function comparePriceCents(left, right) {
  const leftValue = left === null ? Number.POSITIVE_INFINITY : left;
  const rightValue = right === null ? Number.POSITIVE_INFINITY : right;
  return leftValue - rightValue;
}

function formatCents(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(centsToDecimal(cents));
}

function centsToDecimal(cents) {
  return Number(cents) / 100;
}

function normalizeCents(centsValue, priceValue) {
  if (Number.isInteger(centsValue)) {
    return centsValue;
  }
  if (typeof centsValue === "string" && centsValue.trim() !== "") {
    const asInt = Number.parseInt(centsValue, 10);
    if (!Number.isNaN(asInt)) {
      return asInt;
    }
  }
  if (typeof priceValue === "string" && priceValue.trim() !== "") {
    const asNumber = Number(priceValue);
    if (!Number.isNaN(asNumber)) {
      return Math.round(asNumber * 100);
    }
  }
  return null;
}

function normalizeInteger(value, fallback) {
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function sortByName(list, field = "name") {
  return [...list].sort((a, b) => a[field].localeCompare(b[field]));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function writeFile(relativePath, contents) {
  const filePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

main();
