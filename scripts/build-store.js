const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "products.json");
const STORE_DIR = path.join(ROOT, "store");
const BASE_URL = "https://tobaccoroadgames.com";
const CACHE_BUST = "20260604c";
const SITE_NAME = "Tobacco Road Games";
const STORE_TITLE = "Tobacco Road Games Store";

const STATUS_LABELS = {
  "available-direct": "Available Direct",
  "coming-soon": "Coming Soon",
  "preview-available": "Preview Available",
  "revised-edition-pending": "Revised Edition Pending",
  "legacy-edition": "Legacy Edition",
  retired: "Retired",
  "free-download": "Free Download",
  "pay-what-you-want": "Pay What You Want"
};

function main() {
  const products = loadProducts();
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
      kicker: "Author Shelf",
      description: `Titles in the Tobacco Road Games catalog by ${author.name}.`,
      canonicalPath: `/store/authors/${author.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Authors", href: "/store/catalog/" },
        { label: author.name }
      ],
      cards: author.products.map((product) => renderProductCard(product))
    }));
  }

  for (const system of indexes.systems) {
    writeFile(`store/systems/${system.slug}/index.html`, renderCollectionPage({
      title: system.name,
      kicker: "Game System",
      description: `Products built for ${system.name}.`,
      canonicalPath: `/store/systems/${system.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Systems", href: "/store/catalog/" },
        { label: system.name }
      ],
      cards: system.products.map((product) => renderProductCard(product))
    }));
  }

  for (const line of indexes.lines) {
    writeFile(`store/lines/${line.slug}/index.html`, renderCollectionPage({
      title: line.name,
      kicker: "Product Line",
      description: `Titles filed under ${line.name}.`,
      canonicalPath: `/store/lines/${line.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Product Lines", href: "/store/catalog/" },
        { label: line.name }
      ],
      cards: line.products.map((product) => renderProductCard(product))
    }));
  }

  for (const status of indexes.statuses) {
    writeFile(`store/status/${status.slug}/index.html`, renderCollectionPage({
      title: status.label,
      kicker: "Catalog Status",
      description: `Products currently marked ${status.label.toLowerCase()}.`,
      canonicalPath: `/store/status/${status.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Status", href: "/store/catalog/" },
        { label: status.label }
      ],
      cards: status.products.map((product) => renderProductCard(product))
    }));
  }

  writeFile("store/sitemap.xml", renderStoreSitemap(products, indexes));
  console.log(`Storefront generated for ${products.length} products.`);
}

function loadProducts() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  return raw.map((product) => {
    const normalized = {
      ...product,
      authors: ensureArray(product.authors),
      format: ensureArray(product.format),
      previewImages: ensureArray(product.previewImages),
      features: ensureArray(product.features),
      tags: ensureArray(product.tags),
      relatedProducts: ensureArray(product.relatedProducts),
      currency: product.currency || "USD",
      statusLabel: product.statusLabel || STATUS_LABELS[product.status] || "Unavailable"
    };
    normalized.url = `/store/products/${normalized.slug}/`;
    normalized.authorSlugs = normalized.authors.map((author) => slugify(author));
    normalized.assetSet = resolveProductAssets(normalized);
    normalized.releaseStamp = parseDate(normalized.releaseDate);
    normalized.updatedStamp = parseDate(normalized.lastUpdated);
    return normalized;
  });
}

function buildIndexes(products) {
  const authorMap = new Map();
  const systemMap = new Map();
  const lineMap = new Map();
  const statusMap = new Map();

  for (const product of products) {
    for (const author of product.authors) {
      const slug = slugify(author);
      if (!authorMap.has(slug)) {
        authorMap.set(slug, { slug, name: author, products: [] });
      }
      authorMap.get(slug).products.push(product);
    }

    if (!systemMap.has(product.gameSystemSlug)) {
      systemMap.set(product.gameSystemSlug, {
        slug: product.gameSystemSlug,
        name: product.gameSystem,
        products: []
      });
    }
    systemMap.get(product.gameSystemSlug).products.push(product);

    if (!lineMap.has(product.productLineSlug)) {
      lineMap.set(product.productLineSlug, {
        slug: product.productLineSlug,
        name: product.productLine,
        products: []
      });
    }
    lineMap.get(product.productLineSlug).products.push(product);

    if (!statusMap.has(product.status)) {
      statusMap.set(product.status, {
        slug: product.status,
        label: product.statusLabel,
        products: []
      });
    }
    statusMap.get(product.status).products.push(product);
  }

  return {
    authors: sortByName([...authorMap.values()]),
    systems: sortByName([...systemMap.values()]),
    lines: sortByName([...lineMap.values()]),
    statuses: sortByName([...statusMap.values()], "label")
  };
}

function renderStoreHome(products, indexes) {
  const featured = chooseFeaturedProduct(products);
  const newest = sortProducts(products, "newest").slice(0, 3);
  const comingSoon = products.filter((product) => product.status === "coming-soon");
  const availableDirect = products.filter((product) => product.status === "available-direct");

  const browseBlocks = [
    {
      title: "Browse by System",
      items: indexes.systems.map((system) => renderBrowseCard(system.name, `${system.products.length} title${system.products.length === 1 ? "" : "s"}`, `/store/systems/${system.slug}/`))
    },
    {
      title: "Browse by Author",
      items: indexes.authors.map((author) => renderBrowseCard(author.name, `${author.products.length} title${author.products.length === 1 ? "" : "s"}`, `/store/authors/${author.slug}/`))
    },
    {
      title: "Browse by Product Line",
      items: indexes.lines.map((line) => renderBrowseCard(line.name, `${line.products.length} title${line.products.length === 1 ? "" : "s"}`, `/store/lines/${line.slug}/`))
    },
    {
      title: "Browse by Status",
      items: indexes.statuses.map((status) => renderBrowseCard(status.label, `${status.products.length} title${status.products.length === 1 ? "" : "s"}`, `/store/status/${status.slug}/`))
    }
  ];

  return renderLayout({
    pageTitle: `${STORE_TITLE} | Publisher-Owned Digital Shelf`,
    description: "A publisher-owned digital shelf for Tobacco Road Games titles, previews, status pages, and direct-release catalog browsing.",
    canonicalPath: "/store/",
    ogImage: featured.assetSet.cover,
    currentNav: "store",
    structuredData: renderWebPageSchema({
      name: STORE_TITLE,
      description: "A publisher-owned Tobacco Road Games catalog and direct storefront staging area.",
      url: `${BASE_URL}/store/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store" }])}

        <section class="store-hero store-section" aria-labelledby="store-home-heading">
          <div class="store-hero__copy">
            <p class="section-heading__kicker">Publisher-Owned Shelf</p>
            <h1 id="store-home-heading">The Tobacco Road Games store is taking shape.</h1>
            <p class="hero__lead">
              This storefront is built to keep the catalog, the voice, and the delivery under the same roof. The first
              release focuses on durable product pages, catalog browsing, and a shelf that feels like the workshop it came from.
            </p>
            <div class="hero__actions">
              <a class="button button--primary" href="/store/catalog/">Browse Full Catalog</a>
              <a class="button button--secondary" href="/store/products/sirrocans/">See Sirrocans</a>
            </div>
          </div>
          <aside class="store-hero__aside">
            <article class="note-card">
              <p class="note-card__label">Build Status</p>
              <h2>Direct catalog online</h2>
              <p>Product pages, previews, status badges, and browsing surfaces now live off a central registry instead of hand-edited cards.</p>
            </article>
            <article class="note-card">
              <p class="note-card__label">Next Up</p>
              <h2>Direct purchase links</h2>
              <p>Payment and fulfillment links can be attached product by product without tearing the shelf apart again.</p>
            </article>
          </aside>
        </section>

        <section class="store-feature store-section" aria-labelledby="featured-product-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Featured Product</p>
            <h2 id="featured-product-heading">${escapeHtml(featured.title)}</h2>
            <p>${escapeHtml(featured.shortDescription)}</p>
          </div>
          ${renderFeatureSpotlight(featured)}
        </section>

        <section class="store-section" aria-labelledby="newest-products-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Newest on the Shelf</p>
            <h2 id="newest-products-heading">Freshest catalog pages</h2>
          </div>
          <div class="product-card-grid">
            ${newest.map((product) => renderProductCard(product)).join("")}
          </div>
        </section>

        <section class="store-section" aria-labelledby="coming-soon-products-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Coming Soon</p>
            <h2 id="coming-soon-products-heading">Titles preparing to step onto the shelf</h2>
          </div>
          <div class="product-card-grid">
            ${comingSoon.map((product) => renderProductCard(product)).join("")}
          </div>
        </section>

        <section class="store-section" aria-labelledby="available-direct-products-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Available Direct</p>
            <h2 id="available-direct-products-heading">Direct-sale ready titles</h2>
          </div>
          <div class="product-card-grid">
            ${availableDirect.map((product) => renderProductCard(product)).join("")}
          </div>
        </section>

        ${browseBlocks.map((block) => `
          <section class="store-section" aria-labelledby="${slugify(block.title)}-heading">
            <div class="section-heading">
              <p class="section-heading__kicker">Browse</p>
              <h2 id="${slugify(block.title)}-heading">${escapeHtml(block.title)}</h2>
            </div>
            <div class="browse-card-grid">
              ${block.items.join("")}
            </div>
          </section>
        `).join("")}

        <section class="store-section store-callout" aria-labelledby="catalog-link-heading">
          <div class="store-callout__copy">
            <p class="section-heading__kicker">Full Shelf</p>
            <h2 id="catalog-link-heading">Need the whole catalog at once?</h2>
            <p>The catalog page carries every product in the registry, plus title search, filters, and sort controls.</p>
          </div>
          <div class="store-callout__panel">
            <p class="note-card__label">Catalog Access</p>
            <a class="button button--primary button--wide" href="/store/catalog/">Open the Full Catalog</a>
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
    pageTitle: `${STORE_TITLE} Catalog | Search, Sort, and Browse`,
    description: "Browse the Tobacco Road Games catalog by title, author, game system, product line, and status.",
    canonicalPath: "/store/catalog/",
    ogImage: sortedProducts[0].assetSet.cover,
    currentNav: "catalog",
    extraScripts: ["/assets/js/storefront.js?v=" + CACHE_BUST],
    structuredData: renderWebPageSchema({
      name: `${STORE_TITLE} Catalog`,
      description: "A browseable Tobacco Road Games catalog with search and filters.",
      url: `${BASE_URL}/store/catalog/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store", href: "/store/" }, { label: "Catalog" }])}

        <section class="store-section" aria-labelledby="catalog-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Full Catalog</p>
            <h1 id="catalog-heading">Every title in the registry</h1>
            <p>Search by title, scan by line, sort by freshness, and filter the shelf without hardcoded cards.</p>
          </div>

          <div class="catalog-controls" id="catalog-controls">
            <label class="catalog-control">
              <span>Search</span>
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
                <option value="">All Systems</option>
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
              <span>Sort</span>
              <select id="catalog-sort" class="dock-input">
                <option value="title">Title</option>
                <option value="newest">Newest</option>
                <option value="updated">Last Updated</option>
              </select>
            </label>
          </div>

          <div class="catalog-tools">
            <p id="catalog-count" class="catalog-count">${sortedProducts.length} titles on the shelf</p>
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
  const legalSection = product.legalNote
    ? `
      <section class="store-section" aria-labelledby="legal-note-heading">
        <div class="section-heading">
          <p class="section-heading__kicker">Legal Note</p>
          <h2 id="legal-note-heading">System and publication note</h2>
        </div>
        <div class="about__panel">
          <p>${escapeHtml(product.legalNote)}</p>
        </div>
      </section>
    `
    : "";

  const structuredData = [
    renderBreadcrumbSchema([
      { label: "Store", href: "/store/" },
      { label: "Catalog", href: "/store/catalog/" },
      { label: product.title, href: product.url }
    ]),
    renderProductSchema(product)
  ].filter(Boolean);

  return renderLayout({
    pageTitle: `${product.title} | ${STORE_TITLE}`,
    description: product.shortDescription,
    canonicalPath: product.url,
    ogImage: product.assetSet.cover,
    currentNav: "store",
    structuredData,
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
            <p class="hero__lead">${escapeHtml(product.shortDescription)}</p>
            <div class="product-hero__meta">
              ${product.price ? `<span>${escapeHtml(formatPrice(product))}</span>` : `<span>${escapeHtml(product.statusLabel)}</span>`}
              ${product.pageCount ? `<span>${escapeHtml(String(product.pageCount))} pages</span>` : ""}
              ${product.format.length ? `<span>${escapeHtml(product.format.join(", "))}</span>` : ""}
            </div>
            <div class="hero__actions">
              ${buyUi.primary}
              ${product.assetSet.previewPdf ? `<a class="button button--secondary" href="${escapeAttribute(product.assetSet.previewPdf)}" target="_blank" rel="noopener noreferrer">Preview PDF</a>` : ""}
            </div>
            ${buyUi.note}
          </div>
        </section>

        <section class="store-section" aria-labelledby="identity-strip-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Product Identity</p>
            <h2 id="identity-strip-heading">At-a-glance details</h2>
          </div>
          <dl class="identity-strip">
            ${renderIdentityItem("Author", product.authors.join(", "))}
            ${renderIdentityItem("Publisher", product.publisher)}
            ${renderIdentityItem("Game System", product.gameSystem)}
            ${renderIdentityItem("Product Line", product.productLine)}
            ${renderIdentityItem("Format", product.format.join(", ") || "TBD")}
            ${renderIdentityItem("Version", product.version || "TBD")}
            ${renderIdentityItem("Release Date", product.releaseDate || "TBD")}
            ${renderIdentityItem("Last Updated", product.lastUpdated || "TBD")}
          </dl>
        </section>

        <section class="store-section" aria-labelledby="short-pitch-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Short Pitch</p>
            <h2 id="short-pitch-heading">Why this title belongs on the table</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(product.shortDescription)}</p>
          </div>
        </section>

        <section class="store-section" aria-labelledby="long-description-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Long Description</p>
            <h2 id="long-description-heading">What this book is built to do</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(product.longDescription)}</p>
          </div>
        </section>

        ${product.features.length ? `
          <section class="store-section" aria-labelledby="features-heading">
            <div class="section-heading">
              <p class="section-heading__kicker">What's Inside</p>
              <h2 id="features-heading">Shelf contents</h2>
            </div>
            <ul class="feature-list">
              ${product.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
          </section>
        ` : ""}

        ${previewSection}

        ${buyUi.fulfillment}

        <section class="store-section" aria-labelledby="creation-method-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Creation and Disclosure</p>
            <h2 id="creation-method-heading">How this title is made</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(product.creationMethod)}</p>
          </div>
        </section>

        ${legalSection}

        <section class="store-section" aria-labelledby="related-titles-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Related Titles</p>
            <h2 id="related-titles-heading">More from the same shelf-road</h2>
          </div>
          <div class="product-card-grid">
            ${relatedProducts.map((relatedProduct) => renderProductCard(relatedProduct)).join("")}
          </div>
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

function renderLayout({
  pageTitle,
  description,
  canonicalPath,
  ogImage,
  currentNav,
  structuredData,
  extraScripts = [],
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
          <span class="brand__tag">Publisher-owned digital shelf and workshop catalog</span>
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
      <a class="footer-link" href="/ai-statement.html">Read the Generative AI Statement</a>
    </footer>
  </div>
</body>
</html>`;
}

function renderStoreNav(currentNav) {
  const items = [
    { key: "home", href: "/", label: "Home" },
    { key: "store", href: "/store/", label: "Storefront" },
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
        <p>${escapeHtml(product.longDescription)}</p>
        <div class="hero__actions">
          <a class="button button--primary" href="${product.url}">Open Product Page</a>
          <a class="button button--secondary" href="/store/catalog/">Browse the Shelf</a>
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
    product.statusLabel
  ].join(" ").toLowerCase();

  const dataset = withDataset
    ? [
        `data-product-card="true"`,
        `data-title="${escapeAttribute(product.title.toLowerCase())}"`,
        `data-author="${escapeAttribute(product.authorSlugs.join("|"))}"`,
        `data-system="${escapeAttribute(product.gameSystemSlug)}"`,
        `data-line="${escapeAttribute(product.productLineSlug)}"`,
        `data-status="${escapeAttribute(product.status)}"`,
        `data-release="${escapeAttribute(String(product.releaseStamp))}"`,
        `data-updated="${escapeAttribute(String(product.updatedStamp))}"`,
        `data-search="${escapeAttribute(searchText)}"`
      ].join(" ")
    : "";
  const cardId = includeAnchorId ? `id="product-${escapeAttribute(product.slug)}"` : "";

  return `
    <a class="product-card" ${cardId} href="${product.url}" ${dataset}>
      <div class="product-card__media">
        <img src="${escapeAttribute(product.assetSet.thumb)}" alt="${escapeAttribute(product.title)} thumbnail">
      </div>
      <div class="product-card__body">
        <div class="product-card__topline">
          <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
          ${product.price ? `<span class="product-card__price">${escapeHtml(formatPrice(product))}</span>` : ""}
        </div>
        <h3 class="product-card__title">${escapeHtml(product.title)}</h3>
        <p class="product-card__subtitle">${escapeHtml(product.subtitle)}</p>
        <p class="product-card__meta">${escapeHtml(product.authors.join(", "))}</p>
        <p class="product-card__meta">${escapeHtml(product.gameSystem)} | ${escapeHtml(product.productLine)}</p>
        <p class="product-card__meta">${escapeHtml(product.format.join(", ") || "Format TBD")}</p>
      </div>
    </a>
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
        <h2 id="preview-heading">See inside before the shelf closes</h2>
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
            <a class="button button--secondary" href="${escapeAttribute(sample)}" target="_blank" rel="noopener noreferrer">Open Sample PDF</a>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderBuyUi(product) {
  const note = product.fulfillmentNote
    ? `<p class="fulfillment-note">${escapeHtml(product.fulfillmentNote)}</p>`
    : "";

  if (product.buyMode === "paypal-manual" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Buy PDF</a>`,
      note,
      fulfillment: note ? `
        <section class="store-section" aria-labelledby="fulfillment-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Fulfillment</p>
            <h2 id="fulfillment-heading">How delivery works</h2>
          </div>
          <div class="about__panel">
            ${note}
          </div>
        </section>
      ` : ""
    };
  }

  if (product.buyMode === "free-download" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}">Download</a>`,
      note,
      fulfillment: ""
    };
  }

  if (product.buyMode === "external-link" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Visit Product Page</a>`,
      note,
      fulfillment: note ? `
        <section class="store-section" aria-labelledby="fulfillment-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Fulfillment</p>
            <h2 id="fulfillment-heading">Delivery note</h2>
          </div>
          <div class="about__panel">
            ${note}
          </div>
        </section>
      ` : ""
    };
  }

  if (product.buyMode === "paypal-manual" && !product.buyUrl) {
    return {
      primary: `<span class="button button--secondary button--pending" aria-disabled="true">Purchase Setup Pending</span>`,
      note,
      fulfillment: note ? `
        <section class="store-section" aria-labelledby="fulfillment-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Fulfillment</p>
            <h2 id="fulfillment-heading">Direct delivery plan</h2>
          </div>
          <div class="about__panel">
            ${note}
          </div>
        </section>
      ` : ""
    };
  }

  return {
    primary: `<span class="button button--secondary button--pending" aria-disabled="true">${escapeHtml(product.statusLabel)}</span>`,
    note: "",
    fulfillment: ""
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

  if (product.price && product.currency && product.buyUrl) {
    schema.offers = {
      "@type": "Offer",
      price: product.price,
      priceCurrency: product.currency,
      availability: "https://schema.org/InStock",
      url: product.buyUrl
    };
  }

  return JSON.stringify(schema);
}

function renderStoreSitemap(products, indexes) {
  const urls = [
    "/store/",
    "/store/catalog/",
    ...products.map((product) => product.url),
    ...indexes.authors.map((author) => `/store/authors/${author.slug}/`),
    ...indexes.systems.map((system) => `/store/systems/${system.slug}/`),
    ...indexes.lines.map((line) => `/store/lines/${line.slug}/`),
    ...indexes.statuses.map((status) => `/store/status/${status.slug}/`)
  ];

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
  return products.find((product) => product.status === "available-direct") || sortProducts(products, "newest")[0];
}

function sortProducts(products, mode) {
  const list = [...products];
  if (mode === "newest") {
    return list.sort((a, b) => (b.releaseStamp || b.updatedStamp) - (a.releaseStamp || a.updatedStamp));
  }

  if (mode === "updated") {
    return list.sort((a, b) => b.updatedStamp - a.updatedStamp);
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
  if (!product.price) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: product.currency || "USD"
  }).format(Number(product.price));
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
