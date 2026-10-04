const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const pricingModule = require(path.join(__dirname, "..", "shared", "pricing.js"));

const { getEffectivePriceDetails } = pricingModule;

// Product source of truth lives in data/products.json and data/authors.js.
// releases.js is deprecated in this site and is kept only as a warning stub.
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "products.json");
const AUTHORS_PATH = path.join(ROOT, "data", "authors.js");
const BUNDLE_RULES_PATH = path.join(ROOT, "data", "bundle-rules.json");
const STORE_DIR = path.join(ROOT, "store");
const BASE_URL = "https://tobaccoroadgames.com";
const CACHE_BUST = "20260712-shelf12-hinges";
const STOREFRONT_CACHE_BUST = "20261004-frozen-cabinet1";
const HOMEPAGE_MERCHANDISING_PATH = path.join(ROOT, "data", "homepage-merchandising.json");
const HOMEPAGE_MERCHANDISING = fs.existsSync(HOMEPAGE_MERCHANDISING_PATH) ? JSON.parse(fs.readFileSync(HOMEPAGE_MERCHANDISING_PATH, "utf8")) : {};
const HOMEPAGE_AD_PREVIEW = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "homepage-ad-preview.json"), "utf8"));
const HOMEPAGE_BB1_AD_PREVIEW = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bb1-creator-ad-preview.json"), "utf8"));
const HOMEPAGE_NEWS_PREVIEW = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "homepage-news-preview.json"), "utf8"));
const NEWS_CHYRON_CACHE_BUST = "20261001-news-chyron1";
const SHELF_CURIO_CACHE_BUST = "20261002-shelf-curios1";
const SITE_NAME = "Tobacco Road Games";
const STORE_TITLE = "Tobacco Road Games Store";
const SUPPORT_URL = "/support.html";
const CREATOR_TEMPLATES = new Set(["bookshelf", "catalog"]);
const PUBLIC_NAV_ITEMS = Object.freeze([
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "forum", href: "/forum", label: "Community Forum" },
  { key: "creators", href: "/authors.html", label: "Creators" },
  { key: "creator-login", href: "/creator/", label: "Creator Login / Sign Up" },
  { key: "ai-policy", href: "/ai-policy.html", label: "AI Policy" },
  { key: "support", href: SUPPORT_URL, label: "Support" },
  { key: "account", href: "/account.html", label: "Join / Sign In" },
  { key: "cart", href: "/store/cart/", label: 'Cart <span class="cart-count-badge" data-cart-count>0</span>' }
]);
const MARKETPLACE_METADATA_ENUMS = Object.freeze({
  gmMode: new Set(["required", "optional", "gm-less"]),
  prepBurden: new Set(["none", "low", "moderate", "high"]),
  playDuration: new Set(["short", "standard", "extended"]),
  playMode: new Set(["one-shot", "campaign", "either"]),
  rulesComplexity: new Set(["light", "medium", "heavy"]),
  mediaType: new Set(["digital", "physical", "hybrid"])
});

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
  cart: "Cart",
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
  buildRuntimeCatalog();
  const authors = loadAuthors();
  const authorLookup = buildAuthorLookup(authors);
  const products = loadProducts(authorLookup);
  const publicCatalogProducts = products.filter(isCatalogBrowsable);
  const assetWarnings = collectAssetWarnings(products);
  const bundleRules = loadBundleRules();
  const indexes = buildIndexes(publicCatalogProducts, authors.filter((creator) => creator.marketplaceStatus === "active"));

  fs.rmSync(STORE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.rmSync(path.join(ROOT, "authors"), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "creators"), { recursive: true, force: true });

  writeFile("authors.html", renderAuthorsIndexPage(indexes.authors));
  writeFile("creators/index.html", renderCreatorDirectoryAlias());
  writeFile("store/authors/index.html", renderAliasPage({
    pageTitle: `Creators | ${STORE_TITLE}`,
    description: "Public creator profiles live on the main Tobacco Road Games site.",
    canonicalPath: "/authors.html",
    currentNav: "authors",
    targetPath: "/authors.html",
    kicker: "Creators",
    title: "Public creator profiles now live outside the catalog.",
    body: "Use the main Creators page to browse public profiles, workshop notes, and linked products."
  }));
  for (const author of indexes.authors) {
    writeFile(`authors/${author.slug}/index.html`, renderAuthorProfilePage(author));
    writeFile(`creators/${author.slug}/index.html`, renderCreatorProfileAlias(author));
    writeFile(`store/authors/${author.slug}/index.html`, renderAliasPage({
      pageTitle: `${author.name} | ${STORE_TITLE}`,
      description: `Public creator profile for ${author.name}.`,
      canonicalPath: author.url,
      currentNav: "authors",
      targetPath: author.url,
      kicker: "Creator",
      title: author.name,
      body: "This public creator profile has moved to the main Tobacco Road Games creator section so workshop pages and store pages can point to the same place."
    }));
  }

  writeFile("store/index.html", renderShelfStoreHome(publicCatalogProducts, indexes));
  writeFile("store/catalog/index.html", renderCatalogPage(publicCatalogProducts, indexes));
  writeFile("store/cart/index.html", renderCartPage(publicCatalogProducts));
  writeFile("ai-policy.html", renderAiPolicyPage());

  for (const product of products) {
    writeFile(`store/products/${product.slug}/index.html`, renderProductPage(product, publicCatalogProducts));
  }

  buildHomepage(publicCatalogProducts, indexes, bundleRules);
  buildAccountPage();
  buildStaticPublicPage("support.html", "");

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

  for (const series of indexes.series) {
    writeFile(`store/series/${series.slug}/index.html`, renderCollectionPage({
      title: series.name,
      kicker: "Series",
      description: `Browse Tobacco Road Games titles in the ${series.name} series.`,
      canonicalPath: `/store/series/${series.slug}/`,
      breadcrumbs: [
        { label: "Store", href: "/store/" },
        { label: "Catalog", href: "/store/catalog/" },
        { label: "Series" },
        { label: series.name }
      ],
      cards: series.products.map((product) => renderProductCard(product))
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
    renderBundlePlanningPage(bundleRules, publicCatalogProducts)
  );
  writeFile("store/sitemap.xml", renderStoreSitemap(publicCatalogProducts, indexes, bundleRules));
  writeFile("sitemap.xml", renderRootSitemap(indexes.authors));

  console.log(`Storefront generated for ${publicCatalogProducts.length} active products; ${products.length - publicCatalogProducts.length} historical records retained as direct pages.`);
  if (assetWarnings.length) {
    console.log(`Asset cleanup needed for ${assetWarnings.length} product${assetWarnings.length === 1 ? "" : "s"}:`);
    for (const warning of assetWarnings) {
      console.log(`- ${warning}`);
    }
  }
}

function loadAuthors() {
  if (!fs.existsSync(AUTHORS_PATH)) {
    return [];
  }

  const raw = requireFresh(AUTHORS_PATH);
  return ensureArray(raw).map((author) => {
    const slug = author.slug || slugify(author.displayName || author.name || "author");
    const blogPosts = ensureArray(author.blogPosts).map((post, index) => {
      const postSlug = post.slug || slugify(post.title || `${slug}-note-${index + 1}`);
      return {
        slug: postSlug,
        title: post.title || "Untitled Post",
        date: post.date || "",
        excerpt: post.excerpt || "",
        body: ensureArray(post.body || post.content),
        link: post.link || "",
        authorSlug: slug,
        url: post.link || `/authors/${slug}/#post-${postSlug}`
      };
    }).sort((left, right) => parseDate(right.date) - parseDate(left.date));

    return {
      slug,
      name: author.displayName || author.name || slug,
      displayName: author.displayName || author.name || slug,
      title: author.title || author.tagline || "",
      shortBio: author.shortBio || "",
      longBio: author.longBio || "",
      profileImage: author.profileImage || author.imagePath || author.avatar || "",
      logo: author.logo || "",
      bannerImage: author.bannerImage || "",
      profileTemplate: CREATOR_TEMPLATES.has(author.profileTemplate) ? author.profileTemplate : "catalog",
      accent: author.accent || "",
      marketplaceStatus: author.marketplaceStatus || "active",
      joinDate: author.joinDate || "",
      links: ensureArray(author.links).map((link) => ({
        label: link.label || link.title || link.name || "Link",
        url: link.url || link.href || ""
      })).filter((link) => link.url),
      blogPosts,
      url: `/authors/${slug}/`,
      creatorUrl: `/creators/${slug}/`,
      storeUrl: `/store/authors/${slug}/`,
      products: []
    };
  });
}

function buildAuthorLookup(authors) {
  return new Map(authors.map((author) => [author.slug, author]));
}

function loadProducts(authorLookup) {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  return raw.map((product) => {
    validateMarketplaceMetadata(product);
    const authorSlugs = resolveProductAuthorSlugs(product);
    const authors = resolveProductAuthorNames(product, authorSlugs, authorLookup);
    const normalized = {
      ...product,
      authors,
      authorSlugs,
      format: ensureArray(product.format),
      fileList: ensureArray(product.fileList),
      previewImages: ensureArray(product.previewImages),
      features: ensureArray(product.features),
      tags: ensureArray(product.tags),
      relatedProducts: ensureArray(product.relatedProducts),
      featured: Boolean(product.featured),
      coverImage: product.coverImage || "",
      previewImage: product.previewImage || "",
      currency: product.currency || "USD",
      status: product.status || "coming-soon",
      statusLabel: product.statusLabel || STATUS_LABELS[product.status] || "Unavailable",
      price: product.price || "",
      priceCents: normalizeCents(product.priceCents, product.price),
      minimumPrice: product.minimumPrice || "",
      minimumPriceCents: normalizeCents(product.minimumPriceCents, product.minimumPrice),
      suggestedPrice: product.suggestedPrice || "",
      suggestedPriceCents: normalizeCents(product.suggestedPriceCents, product.suggestedPrice),
      regularPrice: product.regularPrice || "",
      regularPriceCents: normalizeCents(product.regularPriceCents, product.regularPrice),
      salePrice: product.salePrice || "",
      salePriceCents: normalizeCents(product.salePriceCents, product.salePrice),
      saleStart: product.saleStart || "",
      saleEnd: product.saleEnd || "",
      saleLabel: product.saleLabel || "",
      saleEnabled: Boolean(product.saleEnabled),
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
      series: product.series || "",
      seriesSlug: product.seriesSlug || "",
      version: product.version || "",
      releaseDate: product.releaseDate || "",
      lastUpdated: product.lastUpdated || ""
    };

    const priceDetails = getEffectivePriceDetails(normalized);
    normalized.url = `/store/products/${normalized.slug}/`;
    normalized.effectivePriceCents = priceDetails.effectivePriceCents;
    normalized.saleActive = priceDetails.saleActive;
    normalized.assetSet = resolveProductAssets(normalized);
    normalized.releaseStamp = parseDate(normalized.releaseDate);
    normalized.updatedStamp = parseDate(normalized.lastUpdated);
    normalized.priceType = resolvePriceType(normalized);
    normalized.priceTypeLabel = PRICE_TYPE_LABELS[normalized.priceType] || "Not For Sale";
    normalized.availabilityLabel = normalized.statusLabel;
    normalized.authorLinks = normalized.authorSlugs.map((slug, index) => {
      const author = authorLookup.get(slug);
      const name = author?.name || normalized.authors[index] || slug;
      return {
        slug,
        name,
        url: author?.url || `/authors/${slug}/`
      };
    });

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

function buildIndexes(products, authors) {
  const authorMap = new Map();
  const systemMap = new Map();
  const lineMap = new Map();
  const seriesMap = new Map();
  const statusMap = new Map();
  const formatMap = new Map();
  const priceTypeMap = new Map();
  const genres = new Set();

  for (const author of authors) {
    authorMap.set(author.slug, {
      ...author,
      products: []
    });
  }

  for (const product of products) {
    if (product.genre) genres.add(product.genre);
    for (const author of product.authorLinks) {
      const slug = author.slug;
      if (!authorMap.has(slug)) {
        authorMap.set(slug, {
          slug,
          name: author.name,
          displayName: author.name,
          title: "",
          shortBio: "",
          longBio: "",
          profileImage: "",
          logo: "",
          bannerImage: "",
          profileTemplate: "catalog",
          accent: "",
          marketplaceStatus: "active",
          joinDate: "",
          links: [],
          blogPosts: [],
          url: author.url || `/authors/${slug}/`,
          storeUrl: `/store/authors/${slug}/`,
          products: []
        });
      }
      authorMap.get(slug).products.push(product);
    }

    collectIndex(systemMap, product.gameSystemSlug, product.gameSystem, product);
    collectIndex(lineMap, product.productLineSlug, product.productLine, product);
    collectIndex(seriesMap, product.seriesSlug, product.series, product);
    collectIndex(statusMap, product.status, product.statusLabel, product, "label");
    collectIndex(priceTypeMap, product.priceType, product.priceTypeLabel, product, "label");

    for (const format of product.format) {
      const slug = slugify(format);
      collectIndex(formatMap, slug, format, product);
    }
  }

  return {
    authors: sortByName([...authorMap.values()]).map((author) => ({
      ...author,
      products: sortProducts(author.products, "updated")
    })),
    systems: sortByName([...systemMap.values()]),
    lines: sortByName([...lineMap.values()]),
    series: sortByName([...seriesMap.values()]),
    statuses: sortByName([...statusMap.values()], "label"),
    formats: sortByName([...formatMap.values()]),
    priceTypes: sortByName([...priceTypeMap.values()], "label"),
    genres: [...genres].sort((left, right) => left.localeCompare(right)),
    hasActiveSales: products.some((product) => product.saleActive)
  };
}

function renderStoreHome(products, indexes) {
  const featured = chooseFeaturedProduct(products);
  const newReleases = chooseNewReleases(products);
  const browserProducts = sortProducts(products, "title");

  return renderLayout({
    pageTitle: `${STORE_TITLE} | Digital Roleplaying Titles and Previews`,
    description: "Browse digital roleplaying titles, previews, and upcoming releases from Tobacco Road Games.",
    canonicalPath: "/store/",
    ogImage: featured?.assetSet.cover || "/assets/logo.png",
    currentNav: "store",
    extraScripts: ["/shared/marketplace-discovery.js?v=" + CACHE_BUST, "/assets/js/storefront.js?v=" + CACHE_BUST],
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
            <p class="hero__lead">Browse digital roleplaying titles, previews, and upcoming releases from Tobacco Road Games. On desktop, the front of the store opens as a shelf of spines first and a practical catalog below it.</p>
            <div class="hero__actions">
              <a class="button button--primary" href="#store-bookshelf">Browse the Bookshelf</a>
              <a class="button button--secondary" href="/store/catalog/">Open the Full Catalog</a>
              ${featured ? `<a class="button button--secondary" href="${featured.url}">Meet ${escapeHtml(featured.title)}</a>` : ""}
            </div>
          </div>
          <aside class="store-hero__aside">
            <article class="note-card">
              <p class="note-card__label">Direct Storefront</p>
              <h2>Digital titles, previews, and releases</h2>
              <p>Product pages lead the store, with clear buyer facts, useful previews, and a desktop bookshelf that can still fall back to a normal catalog grid on any device.</p>
            </article>
            <article class="creation-standard-placard">
              <p class="creation-standard-title">Our Creation Standard</p>
              <p class="creation-standard-copy">Tobacco Road Games is not anti AI or pro AI. We are pro honesty, pro rights, pro quality, and pro customer choice.</p>
              <p class="creation-standard-copy">We do not reject tools. We reject deception, theft, spam, and lazy shovelware.</p>
              <p class="creation-standard-copy">At Tobacco Road Games, buying a product means owning it. No subscriptions, no access fees, no vanishing bookshelf.</p>
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

        ${newReleases.length ? renderBookshelfSection({
          id: "new-releases-bookshelf-heading",
          kicker: "New Releases",
          title: "New Releases",
          description: "Newest books are shelved by release date first so recent work is easy to scan.",
          products: newReleases,
          compact: true
        }) : ""}

        <section class="store-section" id="store-bookshelf" aria-labelledby="bookshelf-browser-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Bookshelf</p>
            <h2 id="bookshelf-browser-heading">Shelf or catalog, your call.</h2>
            <p>Use the store filters to browse by category or line, series, author, system, and status, then switch between the animated shelf and the full card catalog without duplicating the same titles on screen.</p>
          </div>
          ${renderStoreBrowser(browserProducts, indexes, {
            browserId: "store-home-browser",
            showShelf: true,
            includeTitleIndex: false,
            defaultSort: "title",
            countLabel: "titles currently shown",
            shelfHeading: "Bookshelf View",
            shelfDescription: "Hover or focus a spine to turn it toward the cover, then open the full product page.",
            gridHeading: "Catalog View",
            gridDescription: "The same filtered titles stay available as cards for touch devices, scanning, and no-hover browsing."
          })}
        </section>

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

        ${renderBrowseSection("Browse by Game System", indexes.systems, (entry) => `/store/systems/${entry.slug}/`)}
        ${renderBrowseSection("Browse by Product Line", indexes.lines, (entry) => `/store/lines/${entry.slug}/`)}
        ${renderBrowseSection("Browse by Series", indexes.series, (entry) => `/store/series/${entry.slug}/`)}
        ${renderBrowseSection("Browse by Creator", indexes.authors, (entry) => entry.url)}

        <section class="store-section store-callout" aria-labelledby="catalog-link-heading">
          <div class="store-callout__copy">
            <p class="section-heading__kicker">Catalog</p>
            <h2 id="catalog-link-heading">Search and browse the full Tobacco Road Games catalog.</h2>
            <p>Search titles by creator, game system, product line, series, status, format, and price type from one clean catalog page.</p>
          </div>
          <div class="store-callout__panel">
            <p class="note-card__label">Catalog Access</p>
            <div class="hero__actions">
              <a class="button button--primary" href="/store/catalog/">Open the Catalog</a>
              <a class="button button--secondary" href="/authors.html">Meet the Authors</a>
            </div>
          </div>
        </section>
      </main>
    `
  });
}

function renderCatalogPage(products, indexes) {
  const sortedProducts = sortProducts(products, "title");

  return renderLayout({
    pageTitle: `${STORE_TITLE} Catalog | Search and Browse Titles`,
    description: "Search and browse Tobacco Road Games titles by creator, game system, product line, series, release status, and title.",
    canonicalPath: "/store/catalog/",
    ogImage: sortedProducts[0]?.assetSet.cover || "/assets/logo.png",
    currentNav: "catalog",
    extraScripts: ["/shared/marketplace-discovery.js?v=" + CACHE_BUST, "/assets/js/storefront.js?v=" + CACHE_BUST, "/assets/js/discovery-labels.js"],
    structuredData: renderWebPageSchema({
      name: `${STORE_TITLE} Catalog`,
      description: "Search and browse Tobacco Road Games titles by creator, game system, product line, series, release status, and title.",
      url: `${BASE_URL}/store/catalog/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store", href: "/store/" }, { label: "Catalog" }])}

        <section class="store-section" aria-labelledby="catalog-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Catalog</p>
            <h1 id="catalog-heading">Search and browse Tobacco Road Games titles.</h1>
            <p>Browse by creator, game system, category or line, series, release status, format, and price type.</p>
          </div>
          ${renderStoreBrowser(sortedProducts, indexes, {
            browserId: "catalog-browser",
            showShelf: false,
            includeTitleIndex: true,
            defaultSort: "title",
            countLabel: "titles currently shown",
            gridHeading: "",
            gridDescription: ""
          })}
        </section>
      </main>
    `
  });
}

function renderProductPage(product, products) {
  const relatedProducts = resolveRelatedProducts(product, products);
  const buyUi = renderBuyUi(product);
  const previewSection = renderPreviewSection(product);
  const authorByline = renderAuthorByline(product);
  const detailsItems = [
    renderIdentityItem("Creator", product.authors.join(", ")),
    ...(product.publisher ? [renderIdentityItem("Publisher / Imprint", product.publisher)] : []),
    ...(product.brand ? [renderIdentityItem("Brand", product.brand)] : []),
    renderIdentityItem("Game System", product.gameSystem),
    renderIdentityItem("Product Line", renderProductLineValue(product)),
    ...renderMarketplaceIdentityItems(product),
    ...(product.series ? [renderIdentityItem("Series", renderSeriesValue(product))] : []),
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

  const heroMetaItems = [
    renderDisplayPrice(product),
    product.format.join(", ") || "Format TBD",
    product.pageCount ? `${product.pageCount} pages` : "Page count TBD",
    product.productLine,
    product.series && product.series !== product.productLine ? product.series : "",
    product.version || "Version TBD",
    product.lastUpdated || "Update date TBD"
  ].filter(Boolean);

  return renderLayout({
    pageTitle: `${product.title} | ${STORE_TITLE}`,
    description: product.shortDescription,
    canonicalPath: product.url,
    ogImage: product.assetSet.cover,
    currentNav: "store",
    extraScripts: ["/assets/js/discovery-labels.js"],
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
            ${authorByline ? `<p class="product-byline">${authorByline}</p><div class="creator-reputation creator-reputation--listing" data-creator-reputation="${escapeAttribute(product.authorSlugs[0] || "")}" data-reputation-view="compact" aria-live="polite"></div>` : ""}
            <div class="product-hero__meta">
              ${heroMetaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
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
  assetVersion = CACHE_BUST,
  brandLogo = "/assets/logo.png",
  brandTag = "",
  metaRobots = "",
  navItems = PUBLIC_NAV_ITEMS,
  content
}) {
  const canonicalUrl = `${BASE_URL}${canonicalPath}`;
  const resolvedOgImage = `${BASE_URL}${ogImage || "/assets/logo.png"}`;
  const nav = renderStoreNav(currentNav, navItems);
  const structuredDataBlocks = Array.isArray(structuredData)
    ? structuredData.filter(Boolean)
    : structuredData
      ? [structuredData]
      : [];
  const scriptSources = Array.from(new Set([
    `/assets/js/store-status.js?v=${assetVersion}`,
    `/assets/js/cart.js?v=${assetVersion}`,
    ...extraScripts
  ]));

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
  <link rel="icon" type="image/png" href="${escapeAttribute(brandLogo)}?v=${assetVersion}">
  <link rel="stylesheet" href="/styles.css?v=${assetVersion}">
  ${structuredDataBlocks.map((block) => `<script type="application/ld+json">${block}</script>`).join("\n  ")}
  ${scriptSources.map((src) => `<script src="${escapeAttribute(src)}" defer></script>`).join("\n  ")}
</head>
<body class="view-section">
  <div class="page-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="Tobacco Road Games home">
        <img class="brand__logo" src="${escapeAttribute(brandLogo)}?v=${assetVersion}" alt="Tobacco Road Games logo">
        <div class="brand__copy">
          <span class="brand__name">Tobacco Road Games</span>
          ${brandTag ? `<span class="brand__tag">${escapeHtml(brandTag)}</span>` : ""}
        </div>
      </a>

      ${nav}
    </header>

    ${content}

    <footer class="site-footer">
      <a class="footer-mark" href="/ad-depot.html" title="Ad depot" aria-label="Ad depot">
        <img src="${escapeAttribute(brandLogo)}?v=${assetVersion}" alt="">
      </a>
      <p>&copy; 2026 Tobacco Road Games.</p>
      <p>A marketplace for independent creators, operated by Tobacco Road Games.</p>
    </footer>
  </div>
</body>
</html>`.replace(/[ \t]+$/gm, "");
}

function renderStoreNav(currentNav, navItems = PUBLIC_NAV_ITEMS) {
  return renderSharedPublicNav(currentNav, "Primary", navItems);
}

function renderShelfStoreHome(products, indexes) {
  const home = buildStorefrontHomeModel(products, indexes);
  return renderLayout({
    pageTitle: `${STORE_TITLE} | Independent Tabletop Marketplace`,
    description: "Browse independent tabletop games on the Tobacco Road Games shelf storefront.",
    canonicalPath: "/store/",
    ogImage: home.openRules[0]?.assetSet.cover || "/assets/logo.png",
    currentNav: "store",
    assetVersion: STOREFRONT_CACHE_BUST,
    brandLogo: "/assets/tobacco-road-games-logo.png",
    brandTag: "",
    extraScripts: ["/shared/marketplace-discovery.js?v=" + STOREFRONT_CACHE_BUST, "/assets/js/storefront.js?v=" + STOREFRONT_CACHE_BUST, "/assets/js/discovery-labels.js?v=" + STOREFRONT_CACHE_BUST, "/assets/js/sponsor-marquee.js?v=" + STOREFRONT_CACHE_BUST, "/assets/js/storefront-shelf-themes.js?v=" + STOREFRONT_CACHE_BUST, "/assets/js/storefront-shelf-dressing.js?v=" + STOREFRONT_CACHE_BUST],
    structuredData: renderWebPageSchema({ name: STORE_TITLE, description: "Independent tabletop games and creator releases.", url: `${BASE_URL}/store/` }),
    content: `
      <main id="top" class="shelf-storefront">
        ${renderStorefrontShopWindow(home)}
        ${renderStorefrontBrowseByPath(home)}
        ${renderStorefrontSponsorMarquee()}
        ${renderStorefrontNewThisWeek(home)}
        ${renderStorefrontBestSellers(home)}
        ${renderStorefrontOpenRulesAndPwyw(home)}
        ${renderStorefrontProductLines(home)}
        ${renderStorefrontCreatorFeature(home)}
        ${renderStorefrontCatalogEntry(home)}
        ${renderStorefrontBackRoom(home)}
        ${renderStorefrontLowerShop()}
      </main>`
  }).replace(/[ \t]+$/gm, "");
}

function buildStorefrontHomeModel(products, indexes) {
  const eligible = products.filter((product) => ["available-direct", "pay-what-you-want", "free-download"].includes(product.status));
  const openRules = products.filter((product) => /tobacco road games/i.test(product.publisher || "") || product.authorSlugs?.includes("rv-sawyer")).slice(0, 12);
  const newThisWeek = chooseNewReleases(eligible).slice(0, 12);
  const pwywFree = eligible.filter((product) => product.priceType === "pay-what-you-want" || product.priceType === "free-download" || Number(product.effectivePriceCents ?? product.priceCents) === 0);
  const creatorFeature = indexes.authors.find((author) => author.products.length > 0) || null;

  return { products, indexes, eligible, openRules, newThisWeek, pwywFree, creatorFeature };
}

function renderStorefrontShopWindow({ eligible }) {
  const featured = eligible[0] || null;
  return `
        <header class="store-welcome storefront-shop-window" id="shop-window" aria-labelledby="store-home-heading">
          <div class="storefront-shop-window__copy">
            <p class="section-heading__kicker">Independent tabletop marketplace</p>
            <h1 id="store-home-heading">Books Worth Pulling From the Shelf</h1>
            <p>Independent tabletop games, supplements, adventures, and tools from Creators worth discovering.</p>
            <div class="storefront-shop-window__actions" aria-label="Start browsing">
              <a class="button button--primary" href="#browse-by-path">Browse the Shop</a>
              <a class="button button--secondary" href="#search-results-heading">Find the Right Game</a>
            </div>
          </div>
          <aside class="storefront-shop-window__display" aria-label="Featured shelf display">
            ${featured ? `
            <a class="storefront-feature-book" href="${escapeAttribute(featured.url)}">
              <span class="storefront-feature-book__eyebrow">On the front shelf</span>
              <strong>${escapeHtml(featured.title)}</strong>
              <span>${escapeHtml(featured.authors.join(", ") || featured.publisher || "Tobacco Road Games")}</span>
            </a>` : `
            <div class="storefront-empty-shelf" aria-label="No published marketplace books are currently on the front shelf">
              <span class="storefront-empty-shelf__book"></span>
              <span class="storefront-empty-shelf__book"></span>
              <span class="storefront-empty-shelf__book"></span>
              <p>The front shelf is ready for the first published marketplace books.</p>
            </div>`}
          </aside>
        </header>`;
}

function renderStorefrontBrowseByPath({ indexes }) {
  const supportedPaths = [
    { id: "free-pwyw", label: "Free / PWYW", note: "No-cost and pay-what-you-want listings when eligible.", href: "#pwyw-free-shelf-heading", active: true },
    { id: "open-rules", label: "Open Rules", note: "Tobacco Road Games house rules and table tools.", href: "#open-rules-shelf-heading", active: true },
    { id: "system-neutral", label: "System Neutral", note: "A catalog path reserved for matching metadata.", href: "#search-results-heading", active: indexes.systems.some((entry) => /system neutral/i.test(entry.name)) }
  ];

  return `
        <section class="store-section storefront-browse-paths" id="browse-by-path" aria-labelledby="browse-by-path-heading">
          <div class="section-heading"><p class="section-heading__kicker">Guided discovery</p><h2 id="browse-by-path-heading">Browse by Your Path</h2><p>Start with safe, existing catalog signals. Inactive paths are structural placeholders until matching metadata exists.</p></div>
          <nav class="browse-card-grid storefront-path-grid" aria-label="Browse by your path">
            ${supportedPaths.map((path) => path.active ? `<a class="browse-card storefront-path-card" data-storefront-path="${escapeAttribute(path.id)}" href="${escapeAttribute(path.href)}"><strong>${escapeHtml(path.label)}</strong><span>${escapeHtml(path.note)}</span></a>` : `<span class="browse-card storefront-path-card is-inactive" data-storefront-path="${escapeAttribute(path.id)}" aria-disabled="true"><strong>${escapeHtml(path.label)}</strong><span>${escapeHtml(path.note)}</span></span>`).join("")}
          </nav>
        </section>`;
}

function renderStorefrontSponsorMarquee() {
  return `
        <aside class="sponsor-marquee storefront-sponsor-band" id="sponsor-marquee-band" data-sponsor-marquee data-ad-pool="sponsor-marquee" aria-label="Paid sponsors" hidden>
          <span class="sponsor-marquee__label">Paid Sponsors</span><div class="sponsor-marquee__viewport"><div class="sponsor-marquee__track" data-sponsor-track></div></div>
        </aside>`;
}

function renderStorefrontNewThisWeek({ newThisWeek }) {
  return renderBookshelfSection({ id: "new-this-week-heading", kicker: "Just unpacked", title: "New This Week", description: "Recently released, currently eligible books in canonical marketplace order.", products: newThisWeek, centerExamination: true, emptyMessage: "No eligible new releases are on the public shelf yet." });
}

function renderStorefrontBestSellers({ eligible }) {
  return `
        <section class="store-section discovery-bookshelf storefront-best-sellers" id="best-sellers" data-canonical-discovery-shelf="best_selling" aria-labelledby="best-sellers-shelf-heading">
          <div class="section-heading"><p class="section-heading__kicker">Customer demand</p><h2 id="best-sellers-shelf-heading">Best Sellers</h2><p>Shown only when current marketplace discovery data awards the Best Selling label.</p></div>
          <div class="bookshelf-grid" style="--shelf-items: ${Math.max(1, eligible.length)}">${eligible.map((product) => renderBookshelfBook(product, { withDataset: true, centerExamination: true })).join("")}</div>
          <p class="shelf-empty" data-discovery-empty hidden>No current title meets the public Best Seller threshold.</p>
        </section>`;
}

function renderStorefrontOpenRulesAndPwyw({ openRules, pwywFree }) {
  return `
        <section class="storefront-discovery-pair" id="open-rules-pwyw" aria-labelledby="open-rules-pwyw-heading">
          <div class="section-heading storefront-discovery-pair__heading"><p class="section-heading__kicker">House tables</p><h2 id="open-rules-pwyw-heading">Open Rules + Pay What You Want</h2><p>Two independent discovery destinations, grouped for the later shop-table treatment.</p></div>
          ${renderBookshelfSection({ id: "open-rules-shelf-heading", kicker: "The house shelf", title: "Open Rules", description: "Rules, settings, and table tools published by Tobacco Road Games.", products: openRules, centerExamination: true, emptyMessage: "No Open Rules titles are currently eligible for public browsing." })}
          ${renderBookshelfSection({ id: "pwyw-free-shelf-heading", kicker: "Choose your price", title: "Pay What You Want", description: "Current pay-what-you-want and no-cost titles; acquisition rules are unchanged.", products: pwywFree, centerExamination: true, emptyMessage: "No pay-what-you-want or free titles are currently eligible for public browsing." })}
        </section>`;
}

function renderStorefrontProductLines({ indexes }) {
  return `
        <section class="store-section storefront-product-lines" id="product-lines" aria-labelledby="product-lines-heading">
          <div class="section-heading"><p class="section-heading__kicker">Departments</p><h2 id="product-lines-heading">Product Lines</h2><p>Existing product-line routes remain the source of truth for miniature departments.</p></div>
          ${indexes.lines.length ? `<div class="browse-card-grid">${indexes.lines.map((entry) => renderBrowseCard(entry.name, `${entry.products.length} title${entry.products.length === 1 ? "" : "s"}`, `/store/lines/${entry.slug}/`)).join("")}</div>` : `<p class="shelf-empty">No public product lines are available yet.</p>`}
        </section>`;
}

function renderStorefrontCreatorFeature({ creatorFeature }) {
  return `
        <section class="store-section storefront-creator-feature" id="creator-feature" aria-labelledby="creator-feature-heading">
          <div class="section-heading"><p class="section-heading__kicker">Creator shelf</p><h2 id="creator-feature-heading">Featured Creator</h2><p>A generic feature slot for eligible marketplace Creators.</p></div>
          ${creatorFeature ? `<a class="browse-card storefront-creator-card" href="${escapeAttribute(creatorFeature.url)}"><strong>${escapeHtml(creatorFeature.name)}</strong><span>${escapeHtml(creatorFeature.shortBio || creatorFeature.title || "Explore this Creator's public catalog.")}</span></a>` : `<p class="shelf-empty">No eligible Creator feature is selected yet.</p>`}
        </section>`;
}

function renderStorefrontCatalogEntry({ products, indexes }) {
  return `
        <section class="store-section search-shelves storefront-catalog-entry" id="find-the-right-game" data-search-results-section aria-labelledby="search-results-heading">
          <div class="section-heading"><p class="section-heading__kicker">Find the right game</p><h2 id="search-results-heading" data-search-results-heading>Search Results</h2><p data-search-results-prompt>Search the catalog by title, Creator, system, series, or tag.</p></div>
          ${renderStoreBrowser(products, indexes, { browserId: "store-search-browser", showShelf: true, centerExamination: true, defaultSort: "title", countLabel: "matching titles", shelfHeading: "Search shelf", shelfDescription: "Matching books continue onto additional shelf rows.", gridHeading: "Accessible catalog view", gridDescription: "The same canonical results in a compact list." }).replace('data-store-browser="store-search-browser"', 'data-store-browser="store-search-browser" data-search-results="true"')}
        </section>`;
}

function renderStorefrontBackRoom() {
  return `
        <section class="store-section storefront-back-room" id="back-room" aria-labelledby="back-room-heading">
          <div class="section-heading"><p class="section-heading__kicker">Back room</p><h2 id="back-room-heading">Community and Creator resources</h2><p>Current routes for discussion, Creator tools, announcements, and support.</p></div>
          <nav class="browse-card-grid" aria-label="Back room links"><a class="browse-card" href="/forum"><strong>Community</strong><span>Players, Creators, and conversation.</span></a><a class="browse-card" href="/creator/"><strong>Creator Resources</strong><span>Registration, tools, and agreements.</span></a><a class="browse-card" href="/support.html"><strong>Help &amp; Contact</strong><span>Customer support and accessibility help.</span></a><a class="browse-card" href="/#about"><strong>About Tobacco Road Games</strong><span>Our shop, principles, and open roads.</span></a></nav>
        </section>`;
}

function renderStorefrontLowerShop() {
  return `
        <section class="store-lower storefront-lower-shop" id="lower-shop" aria-labelledby="store-information-heading">
          <div class="store-lower__intro"><p class="section-heading__kicker">Lower shop</p><h2 id="store-information-heading">Information, help, and account links</h2><p>Legal, support, library, and cart destinations remain available below the discovery floor.</p><p class="store-lower__notice"><strong>Shop notice:</strong> Purchasing remains closed while this marketplace preview is prepared.</p></div>
          <nav class="store-lower__links" aria-label="Store information"><a href="/authors.html"><strong>Creators</strong><span>Meet the people behind the games.</span></a><a href="/store/catalog/"><strong>Full Catalog</strong><span>Open the serious search and filter view.</span></a><a href="/account.html"><strong>Account &amp; Library</strong><span>Sign in and find your games.</span></a><a href="/store/cart/"><strong>Cart</strong><span>Review your selected products.</span></a><a href="/support.html"><strong>Support</strong><span>Customer support and accessibility help.</span></a><a href="/#commitment"><strong>Policies &amp; Principles</strong><span>Marketplace, privacy, and legal guidance.</span></a></nav>
        </section>`;
}

function validateMarketplaceMetadata(product) {
  for (const [field, allowed] of Object.entries(MARKETPLACE_METADATA_ENUMS)) {
    if (product[field] !== undefined && product[field] !== "" && !allowed.has(product[field])) {
      throw new Error(`${product.slug || "Product"}: ${field} is not supported.`);
    }
  }
  for (const field of ["playerCountMin", "playerCountMax"]) {
    if (product[field] !== undefined && product[field] !== null && (!Number.isInteger(product[field]) || product[field] < 1 || product[field] > 100)) {
      throw new Error(`${product.slug || "Product"}: ${field} must be an integer from 1 to 100.`);
    }
  }
  if (Number.isInteger(product.playerCountMin) && Number.isInteger(product.playerCountMax) && product.playerCountMin > product.playerCountMax) {
    throw new Error(`${product.slug || "Product"}: playerCountMin cannot exceed playerCountMax.`);
  }
  if (product.contentDescriptors !== undefined && !Array.isArray(product.contentDescriptors)) {
    throw new Error(`${product.slug || "Product"}: contentDescriptors must be an array.`);
  }
}

function buildHomepage(products, indexes, bundleRules) {
  const homepagePath = path.join(ROOT, "index.html");
  if (!fs.existsSync(homepagePath)) return;
  const html = fs.readFileSync(homepagePath, "utf8");
  const navPattern = /\s*<nav class="site-nav" aria-label="Primary">[\s\S]*?<\/nav>\s*(?=<\/header>)/;
  const mainPattern = /\s*<main id="top"[^>]*>[\s\S]*?<\/main>(?:\s*<aside class="storefront-(?:ad-marquee|news-chiron)"[^>]*><\/aside>)*/;
  const footerPattern = /\s*<footer class="site-footer">[\s\S]*?<\/footer>/;
  const scriptPattern = /\s*<script>\s*window\.addEventListener\("DOMContentLoaded",[\s\S]*?<\/script>\s*(?=<\/body>)/;
  const homepageScriptsPattern = /\s*<script src="\/assets\/js\/cart\.js\?v=[^"]+" defer><\/script>\s*<script src="\/assets\/js\/storefront\.js\?v=[^"]+" defer><\/script>(?:\s*<script src="\/assets\/js\/news-chyron\.js\?v=[^"]+" defer><\/script>)?(?:\s*<script src="\/assets\/js\/shelf-curios\.js\?v=[^"]+" defer><\/script>)?\s*(?=<\/body>)/;
  if (!navPattern.test(html)) throw new Error("Homepage navigation could not be found.");
  if (!mainPattern.test(html)) throw new Error("Homepage main content area could not be found.");
  let next = html
    .replace(navPattern, `${renderSharedPublicNav("home", "Primary")}\n    `)
    .replace(mainPattern, `\n${renderHomepageShopWallMain(products)}\n`)
    .replace(footerPattern, "")
    .replace(scriptPattern, "\n");
  next = next.replace(/styles\.css\?v=[^"\s]+/, "styles.css?v=20261004-center-books1");
  const homepageScripts = `\n  <script src="/assets/js/cart.js?v=${CACHE_BUST}" defer></script>\n  <script src="/assets/js/storefront.js?v=${STOREFRONT_CACHE_BUST}" defer></script>\n  <script src="/assets/js/news-chyron.js?v=${NEWS_CHYRON_CACHE_BUST}" defer></script>\n  <script src="/assets/js/shelf-curios.js?v=${SHELF_CURIO_CACHE_BUST}" defer></script>`;
  next = homepageScriptsPattern.test(next)
    ? next.replace(homepageScriptsPattern, `${homepageScripts}\n`)
    : next.replace("</body>", `${homepageScripts}\n</body>`);
  fs.writeFileSync(homepagePath, stripPublicBrandTag(next).replace(/^[ \t]+$/gm, ""));
}

function renderHomepageShopWallMain(products) {
  const eligible = products.filter((product) => ["available-direct", "pay-what-you-want", "free-download"].includes(product.status));
  const newThisWeek = sortProducts(eligible, "newest");
  const bestSellers = eligible.filter((product) => Array.isArray(product.discoveryLabels) && product.discoveryLabels.includes("best_selling"));
  const pwywFree = eligible.filter((product) => product.priceType === "pay-what-you-want" || product.priceType === "free-download" || Number(product.effectivePriceCents ?? product.priceCents) === 0);
  const featuredConfig = HOMEPAGE_MERCHANDISING["featured-creator-wall-heading"] || {};
  const designated = eligible.find(product => homepageProductId(product) === String(featuredConfig.heroProductId));
  const featuredCreator = featuredConfig.creatorSlug || (designated || chooseFeaturedProduct(eligible))?.authorSlugs?.[0];
  const featuredProducts = featuredCreator ? eligible.filter(product => product.authorSlugs?.includes(featuredCreator)) : [];
  const openRules = eligible.filter((product) => /tobacco road games/i.test(product.publisher || "") || product.authorSlugs?.includes("rv-sawyer")).slice(0, 8);

  return `    <main id="top" class="homepage-shop-wall shelf-storefront" aria-labelledby="homepage-shop-wall-heading">
      <div class="shop-wall-fixed-cabinet" data-fixed-cabinet>
      <section class="shop-wall-row shop-wall-row--identity" aria-label="Tobacco Road Games shop wall identity and libraries">
        <picture class="shop-wall-cabinet-art" aria-hidden="true">
          <source media="(max-width: 699px)" srcset="/assets/images/storefront-shelf-dressing/upper-cabinet-mobile.png?v=20261004-frozen1">
          <source media="(max-width: 1023px)" srcset="/assets/images/storefront-shelf-dressing/upper-cabinet-tablet.png?v=20261004-frozen1">
          <img src="/assets/images/storefront-shelf-dressing/upper-cabinet-desktop.png?v=20261004-frozen1" alt="" width="2904" height="1179" fetchpriority="high" decoding="async" draggable="false">
        </picture>
        ${renderHomepageLibraryBay()}
        ${renderHomepageIdentityBay()}
        ${renderHomepageProductBay({ title: "OPEN RULES LIBRARY", id: "open-rules-library-heading", products: openRules })}
        ${renderHomepageShelfFixtures()}
      </section>
      </div>
      ${renderHomepageBricABracShelf({ sumo: true })}
      ${renderHomepageAdMarquee()}
      <section class="shop-wall-row shop-wall-row--merchandising" aria-label="Featured shop shelves">
        ${renderHomepageProductBay({ title: "FEATURED CREATOR", id: "featured-creator-wall-heading", products: featuredProducts, heroProductId: featuredConfig.heroProductId, singleShelf: true, bambooIncense: true, wallArt: [{ src: "/assets/white-plume-mountain-framed.png", alt: "Framed White Plume Mountain module cover on the shelf back wall" }, { src: "/assets/dragon-battle-framed-poster.png", alt: "Framed dragon and adventurers illustration on the shelf back wall", placement: "center" }, { src: "/assets/cape-fear-framed-poster.png", alt: "Framed Cape Fear movie poster on the shelf back wall", placement: "right" }] })}
        ${renderHomepageProductBay({ title: "NEW THIS WEEK", id: "new-this-week-wall-heading", products: newThisWeek, singleShelf: true, wallArt: [{ src: "/assets/dungeon-masters-guide-framed-poster.png", alt: "Framed Dungeon Masters Guide poster on the shelf back wall" }, { src: "/assets/the-familiar-framed-poster.png", alt: "Framed The Familiar poster on the shelf back wall", placement: "center" }, { src: "/assets/blackbeard-framed-flag.png", alt: "Framed Blackbeard flag rotated with the skeleton at the top on the shelf back wall", placement: "right" }] })}
        ${renderHomepageBricABracShelf()}
        ${renderHomepageProductBay({ title: "BEST SELLERS", id: "best-sellers-wall-heading", products: bestSellers, singleShelf: true, wallArt: [{ src: "/assets/michael-jordan-framed-jersey.png", alt: "Framed Michael Jordan North Carolina number 23 jersey on the shelf back wall" }, { src: "/assets/call-of-cthulhu-framed-poster.png", alt: "Framed Call of Cthulhu poster on the shelf back wall", placement: "center" }, { src: "/assets/krispy-kreme-framed-sign.png", alt: "Framed Krispy Kreme Doughnuts sign on the shelf back wall", placement: "right" }], productMock: { src: "/assets/products/spriggans/spine.png", alt: "Spriggans product spine mockup", label: "Spriggans product spine mockup", modifier: "spine" } })}
        ${renderHomepageProductBay({ title: "FREE & PWYW", id: "free-pwyw-wall-heading", products: pwywFree, singleShelf: true, wallArt: [{ src: "/assets/justifiers-framed-cover.png", alt: "Framed Justifiers RPG cover on the shelf back wall" }, { src: "/assets/charlie-daniels-framed-art.png", alt: "Framed Charlie Daniels Band artwork on the shelf back wall", placement: "center" }, { src: "/assets/drolla-framed-cover.png", alt: "Framed Drolla Core Rulebook artwork on the shelf back wall", placement: "right" }] })}
      </section>
      ${renderHomepageNewsChyron()}
    </main>`;
}

function renderHomepageBricABracShelf({ sumo = false } = {}) {
  const postingWall = sumo ? `<div class="bb1-posting-wall" role="group" tabindex="0" aria-label="Creator posters: fictional visual test ads">
            ${HOMEPAGE_BB1_AD_PREVIEW.map(ad => `<div class="bb1-ad-territory">
              <article class="bb1-poster bb1-poster--${escapeAttribute(ad.theme)}" aria-labelledby="bb1-${escapeAttribute(ad.id)}-title">
                <img class="bb1-poster__art" src="${escapeAttribute(ad.artwork)}" alt="" loading="eager" decoding="async" draggable="false">
                <div class="bb1-poster__copy">
                  <p class="bb1-poster__creator">${escapeHtml(ad.creator)}</p>
                  <h3 id="bb1-${escapeAttribute(ad.id)}-title">${escapeHtml(ad.title)}</h3>
                  <p class="bb1-poster__tagline">${escapeHtml(ad.tagline)}</p>
                  <p class="bb1-poster__secondary">${escapeHtml(ad.secondaryCopy)}</p>
                  <p class="bb1-poster__callout">${escapeHtml(ad.callout)}</p>
                </div>
              </article>
            </div>`).join("\n            ")}
          </div>` : "";
  return `<section class="shop-wall-row shop-wall-row--bric-a-brac" aria-label="Bric-a-Brac display shelf">
        <div class="shop-wall-bric-shelf"${sumo ? ' data-curio-shelf="bric-a-brac-1"' : ' aria-hidden="true"'}>
          <div class="shop-wall-bric-shelf__back"${sumo ? ' data-bb1-posting-wall' : ""}>${postingWall}</div>${sumo ? '\n          <img class="shop-wall-bric-shelf__sumo" data-curio-id="harimafuji" data-curio-behavior="movable" role="button" tabindex="0" aria-label="Yokozuna Harimafuji" aria-pressed="false" title="Yokozuna Harimafuji" src="/assets/images/storefront-shelf-dressing/sumo-funko-pop.png" alt="" loading="eager" decoding="async" draggable="false">' : ""}
          <div class="shop-wall-bric-shelf__surface"></div>${sumo ? '\n          <span class="shelf-curio-status" data-curio-status role="status" aria-live="polite"></span>' : ""}
        </div>
      </section>`;
}

function renderHomepageNewsChyron(headlines = HOMEPAGE_NEWS_PREVIEW) {
  const renderSequence = (repeat = false) => `<ul class="storefront-news-chiron__sequence"${repeat ? ' aria-hidden="true"' : " data-news-sequence"}>
                ${headlines.map(item => `<li class="storefront-news-chiron__item"><span class="storefront-news-chiron__prefix">${escapeHtml(item.label)}</span><span class="storefront-news-chiron__headline">${escapeHtml(item.headline)}</span></li>`).join("\n                ")}
              </ul>`;
  return `<aside class="storefront-news-chiron" id="ttrpg-news-chyron" data-news-chyron aria-label="TTRPG News Chyron: fictional test headlines">
        <div class="storefront-news-chiron__display">
          <div class="storefront-news-chiron__bug">
            <p class="storefront-news-chiron__brand">TTRPG</p>
            <h2 class="storefront-news-chiron__title">NEWS</h2>
            <p class="storefront-news-chiron__edition">TEST BULLETINS</p>
          </div>
          <div class="storefront-news-chiron__viewport" tabindex="0" role="region" aria-label="Fictional TTRPG headline stream">
            <div class="storefront-news-chiron__track">
              ${renderSequence()}
              ${renderSequence(true)}
            </div>
          </div>
        </div>
      </aside>`;
}

function renderHomepageAdMarquee(ads = HOMEPAGE_AD_PREVIEW) {
  const renderGroup = (repeat = false) => `<div class="storefront-ad-marquee__group"${repeat ? ' aria-hidden="true"' : ""}>
          ${ads.map(ad => renderHomepageAdItem(ad, repeat ? "-repeat" : "")).join("\n          ")}
        </div>`;
  return `<aside class="storefront-ad-marquee" aria-label="Advertisement marquee">
        <div class="storefront-ad-marquee__display">
          <div class="storefront-ad-marquee__viewport">
            <div class="storefront-ad-marquee__track">
              ${renderGroup()}
              ${renderGroup(true)}
            </div>
          </div>
        </div>
      </aside>`;
}

function renderHomepageAdItem(ad, idSuffix = "") {
  const titleId = `homepage-ad-${ad.id}${idSuffix}-title`;
  return `<article class="storefront-ad storefront-ad--${escapeAttribute(ad.theme)}" aria-labelledby="${escapeAttribute(titleId)}">
            ${ad.artwork ? `<img class="storefront-ad__art" src="${escapeAttribute(ad.artwork)}" alt="" loading="eager" decoding="async">` : ""}
            ${ad.logo ? `<img class="storefront-ad__logo" src="${escapeAttribute(ad.logo)}" alt="" loading="eager" decoding="async">` : ""}
            <div class="storefront-ad__copy">
              <p class="storefront-ad__advertiser">${escapeHtml(ad.advertiser)}</p>
              <h3 class="storefront-ad__title" id="${escapeAttribute(titleId)}">${escapeHtml(ad.title)}</h3>
              <p class="storefront-ad__support">${ad.supportingCopy.map(text => `<span>${escapeHtml(text)}</span>`).join(" ")}</p>
            </div>
            ${ad.callout ? `<p class="storefront-ad__callout">${escapeHtml(ad.callout)}</p>` : ""}
          </article>`;
}

function renderHomepageShelfFixtures() {
  return '<span class="shop-wall-shelf-fixtures" aria-hidden="true"><span></span><span></span><span></span></span>';
}

function renderHomepageLibraryBay() {
  const productMockMarkup = renderHomepageProductMock({
    src: "/assets/products/spriggans/spine.png",
    alt: "Spriggans product spine mockup",
    label: "Spriggans product spine mockup",
    modifier: "spine"
  }, { library: true, alignRight: true });
  return `
        <section class="shop-wall-bay shop-wall-bay--library" aria-labelledby="your-library-heading">
          ${renderShopWallPlaque("YOUR LIBRARY", "your-library-heading")}
          <div class="shop-wall-shelves shop-wall-shelves--library" aria-label="Your personal library shelves">
            <div class="shop-wall-shelf-level shop-wall-shelf-level--upper">
              ${productMockMarkup}
            </div>
            <div class="shop-wall-shelf-level shop-wall-shelf-level--lower">
              ${productMockMarkup}
            </div>
          </div>
        </section>`;
}

function renderHomepageIdentityBay() {
  return `
        <section class="shop-wall-bay shop-wall-bay--identity" aria-labelledby="homepage-shop-wall-heading">
          <div class="shop-wall-identity-space">
            <h1 id="homepage-shop-wall-heading"><span>Tobacco Road</span><span>Games</span></h1>
          </div>
          <div class="shop-wall-identity-sign" aria-hidden="true">
            <img src="/assets/images/storefront-shelf-dressing/golden-d20-lantern-logo.png?v=20261003-golden-d20-1" alt="" loading="eager" decoding="async">
            <p class="shop-wall-identity-title"><span>Tobacco Road</span><span>Games</span></p>
          </div>
        </section>`;
}

function renderHomepageProductBay({ title, id, products, viewAllHref, singleShelf = false, wallArt = null, productMock = null, bambooIncense = false, heroProductId = null }) {
  const visibleProducts = products.slice(0, 5);
  const merchandising = singleShelf && ["featured-creator-wall-heading", "new-this-week-wall-heading", "best-sellers-wall-heading", "free-pwyw-wall-heading"].includes(id);
  const configuredHero = heroProductId ?? (typeof HOMEPAGE_MERCHANDISING !== "undefined" ? HOMEPAGE_MERCHANDISING[id]?.heroProductId : null);
  const libraryBooks = id === "open-rules-library-heading";
  const wallArtItems = wallArt ? (Array.isArray(wallArt) ? wallArt : [wallArt]) : [];
  const wallArtMarkup = wallArtItems.map((art) => `<img class="shop-wall-back-wall-art${["center", "right"].includes(art.placement) ? ` shop-wall-back-wall-art--${art.placement}` : ""}" src="${escapeAttribute(art.src)}" alt="${escapeAttribute(art.alt)}" loading="lazy" decoding="async">`).join("\n              ");
  const shelfMock = productMock || ((singleShelf && wallArtItems.length === 3) || libraryBooks ? {
    src: "/assets/products/spriggans/spine.png",
    alt: "Spriggans product spine mockup",
    label: "Spriggans product spine mockup",
    modifier: "spine"
  } : null);
  const productMockMarkup = shelfMock ? renderHomepageProductMock(shelfMock, { library: libraryBooks }) : "";
  const bambooIncenseMarkup = bambooIncense ? `<figure class="shop-wall-bamboo-incense" aria-hidden="true">
                <img class="shop-wall-bamboo-incense__plant" src="/assets/images/storefront-shelf-dressing/bamboo-incense-planter-niche.png" alt="" loading="eager" decoding="async" draggable="false">
                <svg class="shop-wall-bamboo-incense__smoke" viewBox="0 0 864 1821" preserveAspectRatio="none" aria-hidden="true">
                  <path class="shop-wall-bamboo-incense__wisp shop-wall-bamboo-incense__wisp--left-soft" d="M296 1133 C266 1087 302 1051 277 1013 C255 978 277 941 314 913 C346 889 335 856 309 828"></path>
                  <path class="shop-wall-bamboo-incense__wisp shop-wall-bamboo-incense__wisp--left" d="M296 1133 C274 1094 304 1060 285 1024 C268 992 281 956 312 930 C338 907 330 878 308 849"></path>
                  <path class="shop-wall-bamboo-incense__wisp shop-wall-bamboo-incense__wisp--right-soft" d="M349 1168 C381 1125 345 1091 370 1052 C393 1016 371 977 334 949 C302 925 317 892 347 864"></path>
                  <path class="shop-wall-bamboo-incense__wisp shop-wall-bamboo-incense__wisp--right" d="M349 1168 C371 1130 346 1097 364 1063 C381 1030 369 994 338 968 C311 945 322 915 348 886"></path>
                </svg>
              </figure>` : "";
  const dogwoodBonsaiMarkup = id === "featured-creator-wall-heading" ? '<img class="shop-wall-dogwood-bonsai" src="/assets/images/storefront-shelf-dressing/white-flowering-dogwood-bonsai-sign-height.png" alt="" aria-hidden="true" loading="eager" decoding="async" draggable="false">' : "";
  const puzzleCubeMarkup = id === "best-sellers-wall-heading" ? '<img class="shop-wall-puzzle-cube" src="/assets/images/storefront-shelf-dressing/ornate-puzzle-cube-on-stand.png" alt="Ornate black-and-gold puzzle cube on a display stand" loading="eager" decoding="async" draggable="false">' : "";
  const dragonFigurineMarkup = id === "new-this-week-wall-heading" ? '<img class="shop-wall-dragon-figurine" src="/assets/images/storefront-shelf-dressing/red-gold-dragon-figurine.png" alt="Seated red, black, and gold dragon figurine" loading="eager" decoding="async" draggable="false">' : "";
  const dicePileMarkup = id === "new-this-week-wall-heading" ? '<img class="shop-wall-dice-pile" src="/assets/images/storefront-shelf-dressing/stacked-scattered-six-sided-dice.png" alt="A casually stacked and scattered pile of six-sided dice" loading="eager" decoding="async" draggable="false">' : "";
  const jesusFigurineMarkup = id === "best-sellers-wall-heading" ? '<img class="shop-wall-jesus-figurine" src="/assets/images/storefront-shelf-dressing/jesus-loves-you-figurine.png" alt="Jesus Loves You figurine on an ornate black-and-gold base" tabindex="0" aria-describedby="jesus-figurine-speech" loading="eager" decoding="async" draggable="false">\n              <span class="shop-wall-jesus-speech-bubble" id="jesus-figurine-speech" role="tooltip">Remember, I love you.</span>' : "";
  const shelves = singleShelf
    ? `<div class="shop-wall-shelves shop-wall-shelves--single" aria-label="${escapeAttribute(title)} shelf">
            <div class="shop-wall-shelf-level">
              ${wallArtMarkup}
              ${bambooIncenseMarkup}
              ${dogwoodBonsaiMarkup}
              ${merchandising ? renderHomepageMerchandisingBooks(products, configuredHero) : `${visibleProducts.length ? renderHomepageShelfBooks(visibleProducts) : ""}\n              ${productMockMarkup}`}
              ${jesusFigurineMarkup}
              ${puzzleCubeMarkup}
              ${dicePileMarkup}
              ${dragonFigurineMarkup}
              ${renderHomepageShelfFixtures()}
            </div>
          </div>`
    : `<div class="shop-wall-shelves" aria-label="${escapeAttribute(title)} shelves">
            <div class="shop-wall-shelf-level shop-wall-shelf-level--upper">

              ${visibleProducts.length ? renderHomepageShelfBooks(visibleProducts.slice(0, 3)) : ""}
              ${productMockMarkup}
            </div>
            <div class="shop-wall-shelf-level shop-wall-shelf-level--lower">

              ${visibleProducts.length > 3 ? renderHomepageShelfBooks(visibleProducts.slice(3)) : ""}
              ${productMockMarkup}
              ${viewAllHref ? `<a class="shop-wall-view-link" href="${escapeAttribute(viewAllHref)}">View All →</a>` : ""}
            </div>
          </div>`;
  return `
        <section class="shop-wall-bay shop-wall-bay--products" aria-labelledby="${escapeAttribute(id)}">
          ${renderShopWallPlaque(title, id)}

          ${shelves}
        </section>`;
}

function renderHomepageProductMock(mock, { library = false, alignRight = false } = {}) {
  const rowModifier = (library ? " shop-wall-product-row--library" : "") + (alignRight ? " shop-wall-product-row--right" : "");
  const modifier = mock.modifier ? ` shop-wall-product-mock--${escapeAttribute(mock.modifier)}` : "";
  const bookMarkup = `<figure class="shop-wall-product-mock${modifier}" aria-label="${escapeAttribute(mock.label)}">
                  <img src="${escapeAttribute(mock.src)}" alt="${escapeAttribute(mock.alt)}" loading="eager" decoding="async">
                </figure>`;
  if (library) return `<div class="shop-wall-product-row${rowModifier}">
                <div class="shop-wall-library-books" data-fill-library>
                  ${bookMarkup}
                </div>
              </div>`;
  return `<div class="shop-wall-product-row${rowModifier}" data-fill-spines data-overhang-spine data-book-count="50">
                ${bookMarkup}
              </div>`;
}

function renderHomepageShelfBooks(products) {
  return `<div class="bookshelf-grid shop-wall-books" style="--shelf-items: ${Math.max(1, products.length)}">${products.map((product) => renderBookshelfBook(product, { withDataset: true, centerExamination: true })).join("")}</div>`;
}

function homepageProductId(product) {
  return String(product.id || product.slug);
}

function selectHomepageShelfBooks(products, heroProductId = null) {
  const seen = new Set();
  const inventory = products.filter(product => {
    if (!["available-direct", "pay-what-you-want", "free-download"].includes(product.status) || product.buyMode === "retired") return false;
    const id = homepageProductId(product);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const hero = inventory.find(product => homepageProductId(product) === String(heroProductId)) || inventory[0] || null;
  const spines = inventory.filter(product => product !== hero).slice(0, 42);
  return { hero, left: spines.slice(0, 21), right: spines.slice(21, 42) };
}

function renderHomepageMerchandisingBooks(products, heroProductId = null) {
  const { hero, left, right } = selectHomepageShelfBooks(products, heroProductId);
  const renderSpines = (run, side) => `<div class="shop-wall-spine-run" data-spine-run="${side}" data-spine-slots="21">${Array.from({ length: 21 }, (_, slot) => {
    const product = run[slot];
    if (!product) return `<figure class="shop-wall-stock-spine" data-decorative-stock aria-label="Decorative shelf stock"><img src="/assets/products/spriggans/spine.png" alt="" loading="lazy" decoding="async"><span aria-hidden="true">SHELF STOCK</span></figure>`;
    const height = Math.round(bookshelfDimensions(product).height * 188 / 314);
    return `<a class="shop-wall-sale-spine" data-product-card data-slug="${escapeAttribute(product.slug)}" data-product-id="${escapeAttribute(homepageProductId(product))}" href="${escapeAttribute(product.url)}" aria-label="Open ${escapeAttribute(product.title)} product page" title="${escapeAttribute(product.title)}" style="--merch-book-height:${height}px"><span aria-hidden="true">${escapeHtml(product.title)}</span></a>`;
  }).join("")}</div>`;
  const heroMarkup = hero
    ? `<a class="shop-wall-hero-book" data-product-card data-slug="${escapeAttribute(hero.slug)}" data-product-id="${escapeAttribute(homepageProductId(hero))}" href="${escapeAttribute(hero.url)}" aria-label="Open ${escapeAttribute(hero.title)} product page" title="${escapeAttribute(hero.title)}"><img src="${escapeAttribute(hero.assetSet.cover)}" alt="${escapeAttribute(hero.title)} cover" loading="lazy" decoding="async"></a>`
    : `<figure class="shop-wall-hero-book shop-wall-hero-book--stock" data-decorative-stock aria-label="Decorative face-out shelf stock, not a marketplace product"><div class="shop-wall-stock-cover" aria-hidden="true"><span>DECORATIVE</span><img src="/assets/tobacco-road-games-logo.png" alt="" loading="lazy" decoding="async"><strong>SHELF<br>STOCK</strong></div></figure>`;
  return `<div class="shop-wall-product-row shop-wall-product-row--hero" data-overhang-spine data-book-units="50">
                ${renderSpines(left, "left")}
                <div class="shop-wall-hero-bay" data-hero-units="8">${heroMarkup}</div>
                ${renderSpines(right, "right")}
              </div>`;
}

function renderShopWallPlaque(title, id) {
  return `<div class="shop-wall-plaque"><h2 id="${escapeAttribute(id)}">${escapeHtml(title)}</h2></div>`;
}

function renderAiPolicyPage() {
  return renderLayout({
    pageTitle: `AI Policy | ${SITE_NAME}`,
    description: "Tobacco Road Games AI Policy.",
    canonicalPath: "/ai-policy.html",
    currentNav: "ai-policy",
    content: `
      <main id="top">
        <section class="statement-page" aria-labelledby="ai-policy-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Policy</p>
            <h1 id="ai-policy-heading">AI Policy</h1>
            <p class="statement-intro">The approved Tobacco Road Games AI Policy text is awaiting insertion.</p>
          </div>
        </section>
      </main>`
  });
}

function buildAccountPage() {
  const accountPath = path.join(ROOT, "account.html");
  if (!fs.existsSync(accountPath)) return;
  const html = fs.readFileSync(accountPath, "utf8");
  const navPattern = /\s*<nav class="site-nav" aria-label="Primary">[\s\S]*?<\/nav>\s*(?=<\/header>)/;
  if (!navPattern.test(html)) throw new Error("Account navigation could not be found.");
  const next = html
    .replace(navPattern, `${renderSharedPublicNav("account", "Primary")}\n    `)
    .replace("Your Tobacco Road Games Account", "Account / My Library")
    .replace("Shared account foundation", "Customer account");
  fs.writeFileSync(accountPath, stripPublicBrandTag(next));
}

function buildStaticPublicPage(relativePath, currentNav) {
  const pagePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(pagePath)) return;
  const html = fs.readFileSync(pagePath, "utf8");
  const navPattern = /\s*<nav class="site-nav" aria-label="Primary">[\s\S]*?<\/nav>\s*(?=<\/header>)/;
  if (!navPattern.test(html)) throw new Error(`${relativePath} navigation could not be found.`);
  const next = html
    .replace(navPattern, `${renderSharedPublicNav(currentNav, "Primary")}\n    `)
    .replace("Published by RV Sawyer, built for tables that still surprise the person running them.", "A marketplace for independent creators, operated by Tobacco Road Games.");
  fs.writeFileSync(pagePath, stripPublicBrandTag(next));
}

function stripPublicBrandTag(html) {
  return html.replace(/\s*<span class="brand__tag">[\s\S]*?<\/span>/g, "");
}

function renderMarketplaceHomepageSections(products, indexes, bundleRules) {
  const newReleases = chooseNewReleases(products).slice(0, 3);
  const featured = sortProducts(products.filter((product) => product.featured), "title").slice(0, 3);
  const sales = sortProducts(products.filter((product) => product.saleActive), "title").slice(0, 3);
  const creators = indexes.authors.slice(0, 3);
  const sections = [
    renderHomepageProductSection("New Releases", "The latest creator releases in the marketplace.", newReleases),
    renderHomepageProductSection("Featured Products", "Products selected through explicit catalog data.", featured),
    renderHomepageProductSection("Current Sales", "Active discounts verified from current catalog pricing.", sales),
    bundleRules.active ? `<section class="latest" aria-labelledby="homepage-bundles"><div class="section-heading"><p class="section-heading__kicker">Bundles</p><h2 id="homepage-bundles">Sales &amp; Bundles</h2><p>Browse the currently available marketplace bundle options.</p></div><div class="available__action"><a class="button button--primary" href="/store/bundles/bundle-what-you-want/">Browse Bundles</a></div></section>` : "",
    creators.length ? `<section class="latest" aria-labelledby="homepage-creators"><div class="section-heading"><p class="section-heading__kicker">Creator Spotlight</p><h2 id="homepage-creators">Meet marketplace creators</h2><p>Active creators shown in neutral alphabetical order.</p></div><div class="browse-card-grid">${creators.map((creator) => `<a class="browse-card" href="${escapeAttribute(creator.url)}"><strong>${escapeHtml(creator.name)}</strong><span>${escapeHtml(creator.shortBio || `${creator.products.length} marketplace titles`)}</span></a>`).join("")}</div></section>` : ""
  ];
  return `<!-- marketplace-home:start -->\n${sections.filter(Boolean).join("\n")}\n<!-- marketplace-home:end -->`;
}

function renderHomepageProductSection(title, description, products) {
  if (!products.length) return "";
  const id = `homepage-${slugify(title)}`;
  return `<section class="latest" id="${id}" aria-labelledby="${id}-heading"><div class="section-heading"><p class="section-heading__kicker">Marketplace</p><h2 id="${id}-heading">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="browse-card-grid">${products.map((product) => `<a class="browse-card" href="${escapeAttribute(product.url)}"><strong>${escapeHtml(product.title)}</strong><span>By ${escapeHtml(product.authors.join(", "))}</span></a>`).join("")}</div></section>`;
}

function renderFeatureSpotlight(product) {
  const authorByline = renderAuthorByline(product);
  const cartAction = renderDirectActionButton(product, {
    className: "button button--primary"
  });
  return `
    <article class="store-spotlight">
      <div class="store-spotlight__media">
        <img src="${escapeAttribute(product.assetSet.cover)}" alt="${escapeAttribute(product.title)} cover">
      </div>
      <div class="store-spotlight__copy">
        <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
        <h3>${escapeHtml(product.title)}</h3>
        <p class="product-subtitle">${escapeHtml(product.subtitle)}</p>
        ${authorByline ? `<p class="product-byline">${authorByline}</p>` : ""}
        <p>${escapeHtml(product.shortDescription)}</p>
        <div class="hero__actions">
          ${cartAction || ""}
          <a class="button button--primary" href="${product.url}">Open Product Page</a>
          <a class="button button--secondary" href="/store/catalog/">Open the Catalog</a>
        </div>
      </div>
    </article>
  `;
}

function renderBookshelfSection({ id, kicker, title, description, products, forceOpenRightSlugs = [], compact = false, centerExamination = false, emptyMessage = "" }) {
  if (!products.length) {
    if (!emptyMessage) return "";
    return `
    <section class="store-section" aria-labelledby="${escapeAttribute(id)}">
      <div class="section-heading">
        <p class="section-heading__kicker">${escapeHtml(kicker)}</p>
        <h2 id="${escapeAttribute(id)}">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <p class="shelf-empty">${escapeHtml(emptyMessage)}</p>
    </section>
  `;
  }

  const forceOpenRightSlugSet = new Set(forceOpenRightSlugs);

  return `
    <section class="store-section" aria-labelledby="${escapeAttribute(id)}">
      <div class="section-heading">
        <p class="section-heading__kicker">${escapeHtml(kicker)}</p>
        <h2 id="${escapeAttribute(id)}">${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="bookshelf-grid${compact ? " bookshelf-grid--compact" : ""}">
        ${products.map((product) => renderBookshelfBook(product, {
          withDataset: true,
          forceOpenRight: forceOpenRightSlugSet.has(product.slug),
          centerExamination
        })).join("")}
      </div>
    </section>
  `;
}

function renderStoreBrowser(products, indexes, options = {}) {
  const {
    browserId = "store-browser",
    showShelf = false,
    includeTitleIndex = false,
    defaultSort = "title",
    countLabel = "titles currently shown",
    shelfHeading = "",
    shelfDescription = "",
    forceOpenRightSlugs = [],
    centerExamination = false,
    gridHeading = "",
    gridDescription = ""
  } = options;
  const initials = includeTitleIndex ? buildTitleIndex(products) : [];
  const forceOpenRightSlugSet = new Set(forceOpenRightSlugs);

  return `
    <div class="store-browser" data-store-browser="${escapeAttribute(browserId)}"${showShelf ? ' data-store-view="shelf" data-store-has-views="true"' : ""}>
      ${renderStoreBrowserControls(indexes, defaultSort)}
      ${showShelf ? `
        <div class="store-browser__view-switcher" role="group" aria-label="Choose a store browser view">
          <button type="button" class="store-browser__view-button" data-store-view-button="shelf" aria-pressed="true">Bookshelf</button>
          <button type="button" class="store-browser__view-button" data-store-view-button="catalog" aria-pressed="false">Catalog</button>
        </div>
      ` : ""}
      <div class="catalog-tools">
        <p class="catalog-count" data-store-count>${products.length} ${escapeHtml(countLabel)}</p>
        ${includeTitleIndex ? `
          <div class="title-index" aria-label="Title index">
            ${initials.map((entry) => `<a class="title-index__link" href="#product-${escapeAttribute(entry.slug)}">${escapeHtml(entry.letter)}</a>`).join("")}
          </div>
        ` : ""}
      </div>
      <div class="initiative-empty" data-store-empty hidden>No titles match the current search and filters.</div>
      ${showShelf ? `
        <section class="store-browser__panel bookshelf-browser" data-store-view-panel="shelf" aria-label="Bookshelf view">
          ${shelfHeading || shelfDescription ? `
            <div class="bookshelf-browser__header">
              ${shelfHeading ? `<h3>${escapeHtml(shelfHeading)}</h3>` : ""}
              ${shelfDescription ? `<p>${escapeHtml(shelfDescription)}</p>` : ""}
            </div>
          ` : ""}
          <div class="bookshelf-stack" data-store-shelf>
            ${renderBookshelfRows(products, (product, shelfIndex) => renderBookshelfBook(product, {
              withDataset: true,
              forceOpenRight: forceOpenRightSlugSet.has(product.slug),
              edgeRight: shelfIndex >= 10,
              centerExamination
            }))}
          </div>
        </section>
      ` : ""}
      <section class="store-browser__panel store-browser__panel--catalog" data-store-view-panel="catalog" aria-label="Catalog view">
        ${gridHeading || gridDescription ? `
          <div class="catalog-browser__header">
            ${gridHeading ? `<h3>${escapeHtml(gridHeading)}</h3>` : ""}
            ${gridDescription ? `<p>${escapeHtml(gridDescription)}</p>` : ""}
          </div>
        ` : ""}
        <div class="product-card-grid" data-store-grid>
          ${products.map((product) => renderProductCard(product, { withDataset: true, includeAnchorId: includeTitleIndex })).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderStoreBrowserControls(indexes, defaultSort = "title") {
  const saleToggle = indexes.hasActiveSales
    ? `
      <label class="catalog-control catalog-control--toggle">
        <span>Sale Filter</span>
        <span class="catalog-toggle">
          <input type="checkbox" data-filter-sale>
          <span>On Sale Only</span>
        </span>
      </label>
    `
    : "";

  return `
    <div class="catalog-controls" data-store-controls>
      <label class="catalog-control">
        <span>Title Search</span>
        <input class="dock-input" type="search" placeholder="Search titles, creators, systems, series, tags" data-filter-search>
      </label>

      <label class="catalog-control">
        <span>Creator</span>
        <select class="dock-input" data-filter-author>
          <option value="">All Creators</option>
          ${indexes.authors.map((author) => `<option value="${escapeAttribute(author.slug)}">${escapeHtml(author.name)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Game System</span>
        <select class="dock-input" data-filter-system>
          <option value="">All Game Systems</option>
          ${indexes.systems.map((system) => `<option value="${escapeAttribute(system.slug)}">${escapeHtml(system.name)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Category / Line</span>
        <select class="dock-input" data-filter-line>
          <option value="">All Categories and Lines</option>
          ${indexes.lines.map((line) => `<option value="${escapeAttribute(line.slug)}">${escapeHtml(line.name)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Series</span>
        <select class="dock-input" data-filter-series>
          <option value="">All Series</option>
          ${indexes.series.map((series) => `<option value="${escapeAttribute(series.slug)}">${escapeHtml(series.name)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Status</span>
        <select class="dock-input" data-filter-status>
          <option value="">All Statuses</option>
          ${indexes.statuses.map((status) => `<option value="${escapeAttribute(status.slug)}">${escapeHtml(status.label)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Format</span>
        <select class="dock-input" data-filter-format>
          <option value="">All Formats</option>
          ${indexes.formats.map((format) => `<option value="${escapeAttribute(format.slug)}">${escapeHtml(format.name)}</option>`).join("")}
        </select>
      </label>

      <label class="catalog-control">
        <span>Price Type</span>
        <select class="dock-input" data-filter-price-type>
          <option value="">All Price Types</option>
          ${indexes.priceTypes.map((entry) => `<option value="${escapeAttribute(entry.slug)}">${escapeHtml(entry.label)}</option>`).join("")}
        </select>
      </label>

      ${renderDiscoveryFilter("Genre", "genre", indexes.genres)}
      <label class="catalog-control"><span>Players</span><input class="dock-input" type="number" min="1" max="100" placeholder="Any group size" data-filter-player-count></label>
      ${renderDiscoveryFilter("GM", "gm-mode", ["required", "optional", "gm-less"])}
      ${renderDiscoveryFilter("Prep", "prep-burden", ["none", "low", "moderate", "high"])}
      ${renderDiscoveryFilter("Play", "play-mode", ["one-shot", "campaign", "either"])}
      ${renderDiscoveryFilter("Complexity", "rules-complexity", ["light", "medium", "heavy"])}
      ${renderDiscoveryFilter("Media", "media-type", ["digital", "physical", "hybrid"])}

      ${saleToggle}

      <label class="catalog-control">
        <span>Sort</span>
        <select class="dock-input" data-filter-sort>
          <option value="title"${defaultSort === "title" ? " selected" : ""}>Title A to Z</option>
          <option value="newest"${defaultSort === "newest" ? " selected" : ""}>Newest</option>
          <option value="updated"${defaultSort === "updated" ? " selected" : ""}>Recently Updated</option>
          <option value="price-low"${defaultSort === "price-low" ? " selected" : ""}>Price Low to High</option>
          <option value="price-high"${defaultSort === "price-high" ? " selected" : ""}>Price High to Low</option>
        </select>
      </label>
    </div>
  `;
}

function renderBookshelfBook(product, options = {}) {
  const { withDataset = false, forceOpenRight = false, edgeRight = false, centerExamination = false } = options;
  const dataset = withDataset ? renderProductDatasetAttributes(product) : "";
  const forceOpenRightAttribute = forceOpenRight ? ' data-bookshelf-force-right="true"' : "";
  const edgeClass = edgeRight ? " bookshelf-book--edge-right" : "";
  const authorName = product.authors.join(", ") || product.publisher;
  const publisherLine = product.publisher && product.publisher !== authorName
    ? `<span class="bookshelf-book__publisher">${escapeHtml(product.publisher)}</span>`
    : "";
  const saleBadge = product.saleActive
    ? `<span class="status-badge status-badge--sale">${escapeHtml(product.saleLabel || "Sale")}</span>`
    : "";
  const examinationMeta = [
    renderCatalogMeta(product),
    product.genre ? humanizeMetadata(product.genre) : "",
    product.mediaType ? humanizeMetadata(product.mediaType) : "",
    product.format.join(" / ")
  ].filter(Boolean).join(" | ");
  const dimensions = bookshelfDimensions(product);

  return `
    <a class="bookshelf-book${edgeClass}" href="${product.url}"${forceOpenRightAttribute} ${dataset} data-spine-width="${dimensions.width}" data-spine-source="${dimensions.source}" style="--book-spine-width:${dimensions.width}px;--book-height:${dimensions.height}px" aria-label="Open ${escapeAttribute(product.title)} product page">
      <span class="bookshelf-book__scene">
        <span class="bookshelf-book__spine">
          <span class="bookshelf-book__status">${escapeHtml(product.statusLabel)}</span>
          <span class="bookshelf-book__title">${escapeHtml(product.title)}</span>
          <span class="bookshelf-book__author">${escapeHtml(authorName)}</span>
        </span>
        <span class="bookshelf-book__cover-frame">
          <img class="bookshelf-book__cover" src="${escapeAttribute(product.assetSet.cover)}" alt="${escapeAttribute(product.title)} cover" loading="lazy" decoding="async">
        </span>
        ${centerExamination
          ? `<span class="bookshelf-book__details"><span class="bookshelf-book__badges"><span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>${saleBadge}</span><strong>${escapeHtml(product.title)}</strong><span class="bookshelf-book__creator">${escapeHtml(authorName)}</span>${publisherLine}<span class="bookshelf-book__price">${escapeHtml(renderCardPrice(product))}</span><span>${escapeHtml(examinationMeta)}</span><small>${escapeHtml(product.shortDescription)}</small><em>Open product page</em></span>`
          : `<span class="bookshelf-book__details"><strong>${escapeHtml(product.title)}</strong><span>${escapeHtml(authorName)}</span><span>${escapeHtml(renderCardPrice(product))}</span><span>${escapeHtml(renderCatalogMeta(product))}</span><small>${escapeHtml(product.shortDescription)}</small><em>Open product page</em></span>`}
        <span class="bookshelf-book__mobile">
          <span class="bookshelf-book__mobile-media">
            <img class="bookshelf-book__cover" src="${escapeAttribute(product.assetSet.cover)}" alt="">
          </span>
          <span class="bookshelf-book__mobile-copy">
            <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(product.statusLabel)}</span>
            <span class="bookshelf-book__mobile-title">${escapeHtml(product.title)}</span>
            <span class="bookshelf-book__mobile-subtitle">${escapeHtml(product.subtitle)}</span>
            <span class="bookshelf-book__mobile-meta">${escapeHtml(renderCatalogMeta(product))}</span>
          </span>
        </span>
      </span>
    </a>
  `;
}

function renderBookshelfRows(products, renderBook) {
  const shelves = [];
  for (let index = 0; index < products.length; index += 12) {
    const shelfProducts = products.slice(index, index + 12);
    shelves.push(`<div class="bookshelf-grid" style="--shelf-items: ${shelfProducts.length}">${shelfProducts.map(renderBook).join("")}</div>`);
  }
  return shelves.join("");
}

function renderProductCard(product, options = {}) {
  const { withDataset = false, includeAnchorId = false } = options;
  const authorByline = renderAuthorByline(product);
  const searchText = [
    product.title,
    product.subtitle,
    product.authors.join(" "),
    product.gameSystem,
    product.productLine,
    product.series,
    product.tags.join(" "),
    product.statusLabel,
    product.priceTypeLabel
  ].join(" ").toLowerCase();
  const dataset = withDataset ? renderProductDatasetAttributes(product, searchText) : "";
  const cardId = includeAnchorId ? `id="product-${escapeAttribute(product.slug)}"` : "";
  const cartAction = renderDirectActionButton(product, {
    className: "button button--primary product-card__button"
  });

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
        ${authorByline ? `<p class="product-card__meta product-card__meta--byline">${authorByline}</p>` : ""}
        <p class="product-card__meta">${escapeHtml(renderCatalogMeta(product))}</p>
        <p class="product-card__meta">${escapeHtml(product.format.join(", ") || "Format TBD")}</p>
        <div class="product-card__actions">
          ${cartAction || ""}
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

function renderBrowseSection(title, entries, hrefBuilder) {
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
        ${entries.map((entry) => renderBrowseCard(entry.name, `${entry.products.length} title${entry.products.length === 1 ? "" : "s"}`, hrefBuilder(entry))).join("")}
      </div>
    </section>
  `;
}

function renderAuthorsIndexPage(authors) {
  return renderPublicLayout({
    pageTitle: "Creators | Tobacco Road Games",
    description: "Meet the creators publishing tabletop games, tools, adventures, and workshop material through Tobacco Road Games.",
    canonicalPath: "/authors.html",
    currentNav: "authors",
    extraScripts: ["/assets/js/creator-reputation.js", "/assets/js/discovery-labels.js"],
    structuredData: renderBreadcrumbSchema([
      { label: "Home", href: "/" },
      { label: "Authors", href: "/authors.html" }
    ]),
    content: `
      <main id="top">
        ${renderBreadcrumbs([
          { label: "Home", href: "/" },
          { label: "Creators" }
        ])}
        <section class="store-section" aria-labelledby="authors-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Creators</p>
            <h1 id="authors-heading">Meet the people behind the work.</h1>
            <p>Explore creators publishing through the Tobacco Road Games marketplace.</p>
          </div>
          <div class="author-card-grid">
            ${authors.map((author) => renderAuthorCard(author)).join("")}
          </div>
        </section>
      </main>
    `
  });
}

function renderAuthorProfilePage(author) {
  return renderPublicLayout({
    pageTitle: `${author.name} | Tobacco Road Games`,
    description: author.shortBio || `Meet ${author.name} at Tobacco Road Games.`,
    canonicalPath: author.url,
    currentNav: "authors",
    extraScripts: ["/assets/js/creator-reputation.js", "/assets/js/discovery-labels.js"],
    structuredData: [
      renderBreadcrumbSchema([
        { label: "Home", href: "/" },
        { label: "Creators", href: "/authors.html" },
        { label: author.name, href: author.url }
      ]),
      renderPersonSchema(author)
    ],
    content: `
      <main id="top">
        ${renderBreadcrumbs([
          { label: "Home", href: "/" },
          { label: "Creators", href: "/authors.html" },
          { label: author.name }
        ])}

        <section class="author-hero store-section" aria-labelledby="${escapeAttribute(author.slug)}-heading">
          <div class="author-hero__copy">
            <p class="section-heading__kicker">Creator</p>
            <h1 id="${escapeAttribute(author.slug)}-heading">${escapeHtml(author.name)}</h1>
            <div class="creator-reputation creator-reputation--profile" data-creator-reputation="${escapeAttribute(author.slug)}" data-reputation-view="profile" aria-live="polite"><p class="creator-rating">Creator reputation loading…</p></div>
            ${author.title ? `<p class="product-subtitle">${escapeHtml(author.title)}</p>` : ""}
            ${author.shortBio ? `<p class="hero__lead">${escapeHtml(author.shortBio)}</p>` : ""}
            ${author.links.length ? `<div class="author-link-list">${author.links.map(renderAuthorLink).join("")}</div>` : ""}
          </div>
          <aside class="author-hero__aside">
            <article class="note-card">
              <p class="note-card__label">Catalog Work</p>
              <h2>${author.products.length} title${author.products.length === 1 ? "" : "s"} in the public catalog</h2>
              <p>The catalog links back here so readers can move from a book to the person building it.</p>
            </article>
            <article class="note-card">
              <p class="note-card__label">Workshop Notes</p>
              <h2>${author.blogPosts.length} published note${author.blogPosts.length === 1 ? "" : "s"}</h2>
              <p>Short field notes, essays, and workshop updates live here without pretending to be a full portal.</p>
            </article>
          </aside>
        </section>

        <section class="store-section" aria-labelledby="author-bio-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Biography</p>
            <h2 id="author-bio-heading">From the working side of the screen</h2>
          </div>
          <div class="about__panel">
            <p>${escapeHtml(author.longBio || author.shortBio || "")}</p>
          </div>
        </section>

        <section class="store-section" aria-labelledby="author-products-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Products</p>
            <h2 id="author-products-heading">Creator Catalog</h2>
          </div>
          ${renderCreatorProducts(author)}
        </section>

        <section class="store-section" aria-labelledby="author-posts-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">News and Notes</p>
            <h2 id="author-posts-heading">Creator News and Workshop Posts</h2>
          </div>
          ${author.blogPosts.length ? `
            <div class="author-post-grid">
              ${author.blogPosts.map((post) => renderAuthorPost(post)).join("")}
            </div>
          ` : `
            <div class="about__panel">
              <p>Workshop notes will appear here when they are ready to be shared publicly.</p>
            </div>
          `}
        </section>

        <section class="store-section author-discussions" id="author-discussions" aria-labelledby="author-discussions-heading" data-author-discussions data-author-slug="${escapeAttribute(author.slug)}">
          <div class="section-heading">
            <p class="section-heading__kicker">Conversation</p>
            <h2 id="author-discussions-heading">Messages for ${escapeHtml(author.name)}</h2>
            <p>Start a public discussion or read the author’s responses. A valid email address and discussion notifications are required to participate; email addresses are never shown publicly.</p>
          </div>
          <form class="discussion-form" data-discussion-form>
            <div class="discussion-form__fields">
              <label>Display name<input class="dock-input" name="displayName" maxlength="60" autocomplete="name" required></label>
              <label>Email address<input class="dock-input" name="email" type="email" maxlength="254" autocomplete="email" required></label>
            </div>
            <label>Subject<input class="dock-input" name="subject" maxlength="120" required></label>
            <label>Message<textarea class="dock-input" name="message" rows="6" maxlength="4000" required></textarea></label>
            <label class="discussion-consent"><input name="notificationsAccepted" type="checkbox" required> I agree to receive required email notifications about this discussion. My message will not be recorded without this agreement.</label>
            <button class="button button--primary" type="submit">Verify Email and Post</button>
            <p class="discussion-status" data-discussion-status role="status" aria-live="polite"></p>
          </form>
          <div class="discussion-list" data-discussion-list><p>Loading discussions…</p></div>
        </section>
        <script src="/assets/js/storefront.js?v=${CACHE_BUST}" defer></script>
        <script src="/assets/js/author-discussions.js?v=${CACHE_BUST}" defer></script>
      </main>
    `
  });
}

function renderPublicLayout({
  pageTitle,
  description,
  canonicalPath,
  currentNav,
  structuredData,
  extraScripts = [],
  content
}) {
  const canonicalUrl = `${BASE_URL}${canonicalPath}`;
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
  <meta property="og:image" content="${BASE_URL}/assets/logo.png">
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
        </div>
      </a>

      ${renderPublicNav(currentNav)}
    </header>

    ${content}

    <footer class="site-footer">
      <a class="footer-mark" href="/ad-depot.html" title="Ad depot" aria-label="Ad depot">
        <img src="/assets/logo.png?v=${CACHE_BUST}" alt="">
      </a>
      <p>&copy; 2026 Tobacco Road Games.</p>
      <p>A marketplace for independent creators, operated by Tobacco Road Games.</p>
    </footer>
  </div>
</body>
</html>`.replace(/[ \t]+$/gm, "");
}

function renderAliasPage({
  pageTitle,
  description,
  canonicalPath,
  currentNav,
  targetPath,
  kicker,
  title,
  body
}) {
  return renderLayout({
    pageTitle,
    description,
    canonicalPath,
    ogImage: "/assets/logo.png",
    currentNav,
    content: `
      <main id="top">
        ${renderBreadcrumbs([
          { label: "Store", href: "/store/" },
          { label: title }
        ])}
        <section class="store-section" aria-labelledby="${slugify(title)}-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">${escapeHtml(kicker)}</p>
            <h1 id="${slugify(title)}-heading">${escapeHtml(title)}</h1>
            <p>${escapeHtml(body)}</p>
          </div>
          <div class="hero__actions">
            <a class="button button--primary" href="${escapeAttribute(targetPath)}">Open Public Author Page</a>
            <a class="button button--secondary" href="/store/catalog/">Back to Catalog</a>
          </div>
        </section>
      </main>
    `
  });
}

function renderPublicNav(currentNav) {
  return renderSharedPublicNav(currentNav, "Primary");
}

function bookshelfDimensions(product) {
  const hash = [...String(product.slug || product.title || "book")].reduce((value, character) => ((value * 33) ^ character.charCodeAt(0)) >>> 0, 5381);
  const pageCount = Number(product.pageCount);
  const hasPageCount = Number.isFinite(pageCount) && pageCount > 0;
  const pageSignal = hasPageCount ? Math.log1p(Math.min(pageCount, 600)) / Math.log1p(600) : 0.48;
  const variation = ((hash % 1000) / 999 - 0.5) * (hasPageCount ? 5 : 10);
  const width = Math.round(Math.max(46, Math.min(78, 46 + pageSignal * 31 + variation)) * 10) / 10;
  const heightSignal = hasPageCount ? Math.min(18, Math.log1p(pageCount) * 3.2) : 9;
  const height = Math.round(Math.max(270, Math.min(332, 286 + heightSignal + (hash % 19) - 9)));
  return { width, height, source: hasPageCount ? "page-count" : "catalog-fallback" };
}

function renderCreatorProducts(creator) {
  if (!creator.products.length) {
    return `<div class="about__panel"><p>Public catalog titles will appear here as they are added to the marketplace.</p></div>`;
  }
  const products = sortProducts(creator.products, "title");
  if (creator.profileTemplate === "bookshelf") {
    return `<div class="bookshelf-stack author-product-bookshelf" data-creator-template="bookshelf">${renderBookshelfRows(products, (product, shelfIndex) => renderBookshelfBook(product, { edgeRight: shelfIndex >= 10 }))}</div>`;
  }
  return `<div class="product-card-grid" data-creator-template="catalog">${products.map((product) => renderProductCard(product)).join("")}</div>`;
}

function renderCreatorDirectoryAlias() {
  return renderAliasPage({
    pageTitle: "Creators | Tobacco Road Games",
    description: "Browse active creators publishing through Tobacco Road Games.",
    canonicalPath: "/authors.html",
    currentNav: "creators",
    targetPath: "/authors.html",
    kicker: "Creators",
    title: "The creator directory has moved.",
    body: "Continue to the public Tobacco Road Games creator directory. This alias prepares the marketplace for permanent creator URLs without breaking existing links."
  });
}

function renderCreatorProfileAlias(creator) {
  return renderAliasPage({
    pageTitle: `${creator.name} | Tobacco Road Games`,
    description: creator.shortBio || `Creator profile for ${creator.name}.`,
    canonicalPath: creator.url,
    currentNav: "creators",
    targetPath: creator.url,
    kicker: "Creator",
    title: creator.name,
    body: "Continue to this creator's established profile. The /creators/ address is a compatibility alias while public URLs transition safely."
  });
}

function renderSharedPublicNav(currentNav, ariaLabel, navItems = PUBLIC_NAV_ITEMS) {
  const normalizedCurrent = ["authors", "author"].includes(currentNav)
    ? "creators"
    : ["store", "catalog", "sales", "product", "collection"].includes(currentNav)
      ? "explore"
      : currentNav;
  return `
    <nav class="site-nav" aria-label="${escapeAttribute(ariaLabel)}">
      ${navItems.map((item) => `<a href="${item.href}"${normalizedCurrent === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}
    </nav>`;
}

function renderAuthorCard(author) {
  return `
    <article class="author-card">
      ${author.profileImage ? `<img class="author-card__image" src="${escapeAttribute(author.profileImage)}" alt="${escapeAttribute(author.name)} profile image">` : ""}
      <p class="note-card__label">Creator</p>
      <h2>${escapeHtml(author.name)}</h2>
      <div class="creator-reputation creator-reputation--directory" data-creator-reputation="${escapeAttribute(author.slug)}" data-reputation-view="directory" aria-live="polite"><p class="creator-rating">Creator reputation loading…</p></div>
      ${author.title ? `<p class="author-card__tagline">${escapeHtml(author.title)}</p>` : ""}
      ${author.shortBio ? `<p class="author-card__bio">${escapeHtml(author.shortBio)}</p>` : ""}
      <div class="author-card__meta">
        <span>${author.products.length} title${author.products.length === 1 ? "" : "s"}</span>
        <span>${author.blogPosts.length} note${author.blogPosts.length === 1 ? "" : "s"}</span>
      </div>
      <div class="hero__actions">
        <a class="button button--secondary" href="${author.url}">Open Profile</a>
      </div>
    </article>
  `;
}

function renderAuthorPost(post) {
  return `
    <article class="author-post" id="post-${escapeAttribute(post.slug)}">
      <p class="note-card__label">Workshop Note</p>
      <h3>${escapeHtml(post.title)}</h3>
      ${post.date ? `<p class="author-post__date">${escapeHtml(formatDateLabel(post.date))}</p>` : ""}
      ${post.excerpt ? `<p class="author-post__excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
      ${post.body.length ? `
        <div class="author-post__body">
          ${post.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
      ` : ""}
      ${post.link ? `<div class="hero__actions"><a class="button button--secondary" href="${escapeAttribute(post.link)}">Read More</a></div>` : ""}
    </article>
  `;
}

function renderAuthorLink(link) {
  return `<a class="author-link-pill" href="${escapeAttribute(link.url)}">${escapeHtml(link.label)}</a>`;
}

function renderAuthorByline(product) {
  if (!product.authorLinks.length) {
    return "";
  }

  return `By ${product.authorLinks.map((author) => `<a class="author-link" href="${escapeAttribute(author.url)}">${escapeHtml(author.name)}</a>`).join(", ")}`;
}

function renderPreviewSection(product) {
  const previewFeature = product.assetSet.previewFeature;
  const previews = product.assetSet.previewImages.filter((preview) => preview !== previewFeature);
  const teaser = product.assetSet.teaserVideo;
  const sample = product.assetSet.previewPdf;
  const previewNotice = product.assetSet.previewNotice;

  if (!previewFeature && !previews.length && !teaser && !sample && !previewNotice) {
    return "";
  }

  return `
    <section class="store-section" aria-labelledby="preview-heading">
      <div class="section-heading">
        <p class="section-heading__kicker">Preview</p>
        <h2 id="preview-heading">Preview</h2>
      </div>
      <div class="preview-panel">
        ${previewFeature ? `
          <figure class="preview-feature">
            <img src="${escapeAttribute(previewFeature)}" alt="${escapeAttribute(product.title)} preview image">
          </figure>
        ` : ""}
        ${previewNotice ? `
          <article class="note-card preview-note">
            <p class="note-card__label">Preview Image</p>
            <p>${escapeHtml(previewNotice)}</p>
          </article>
        ` : ""}
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

  if (isFreeDownloadReady(product)) {
    return {
      primary: renderFreeDownloadButton(product, { className: "button button--primary" }),
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">Free Download</p>
          <p>This PDF is delivered through a short-lived private download link. The permanent product file remains private.</p>
          <p>${supportLink}</p>
        </article>
      `,
      active: true
    };
  }

  if (isCartReady(product)) {
    return {
      primary: renderCartActionButton(product, {
        className: "button button--primary"
      }),
      afterPurchase: `
        <article class="note-card">
          <p class="note-card__label">Cart Notice</p>
          <p>This title can be saved to your Tobacco Road Games cart in this browser. Final product availability and pricing will be verified during checkout.</p>
          <p>${supportLink}</p>
        </article>
      `,
      active: true
    };
  }

  if (product.buyMode === "fixed-price" && product.buyUrl) {
    return {
      primary: `<a class="button button--primary" data-store-purchase href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Buy Now</a>`,
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
      primary: `<a class="button button--primary" data-store-purchase href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Order Direct</a>`,
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
      primary: renderFreeDownloadButton(product),
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
      primary: `<a class="button button--primary" data-store-purchase href="${escapeAttribute(product.buyUrl)}" target="_blank" rel="noopener noreferrer">Pay What You Want</a>`,
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
    product.assetSet.previewFeature,
    ...product.assetSet.previewImages
  ].filter(Boolean).filter((sitePath, index, list) => list.indexOf(sitePath) === index).map((sitePath) => `${BASE_URL}${sitePath}`);

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
    author: product.authorLinks.map((author) => ({
      "@type": "Person",
      name: author.name,
      url: `${BASE_URL}${author.url}`
    })),
    sku: product.slug,
    category: product.series || product.productLine || product.gameSystem,
    url: `${BASE_URL}${product.url}`
  };

  if (product.effectivePriceCents !== null && product.currency && product.buyUrl && isBuyModeActive(product.buyMode)) {
    schema.offers = {
      "@type": "Offer",
      price: centsToDecimal(product.effectivePriceCents),
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
    "/store/cart/",
    ...products.map((product) => product.url),
    ...indexes.systems.map((system) => `/store/systems/${system.slug}/`),
    ...indexes.lines.map((line) => `/store/lines/${line.slug}/`),
    ...indexes.series.map((series) => `/store/series/${series.slug}/`),
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

function renderRootSitemap(authors) {
  const urls = [
    "/",
    "/authors.html",
    ...authors.map((author) => author.url),
    "/support.html",
    "/store/",
    "/store/cart/"
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

  const sameSeries = product.seriesSlug
    ? products
      .filter((candidate) => candidate.slug !== product.slug)
      .filter((candidate) => candidate.seriesSlug === product.seriesSlug)
    : [];

  if (sameSeries.length) {
    return sameSeries.slice(0, 3);
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
  return chooseFeaturedProducts(products)[0]
    || products.find((product) => product.status === "available-direct")
    || products.find((product) => product.status === "preview-available")
    || sortProducts(products, "updated")[0]
    || null;
}

function chooseFeaturedProducts(products) {
  return sortProducts(products.filter((product) => product.featured), "title");
}

function chooseNewReleases(products) {
  return sortProducts(products, "newest").slice(0, 3);
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
    return list.sort((a, b) => comparePriceCents(a.effectivePriceCents ?? a.priceCents, b.effectivePriceCents ?? b.priceCents));
  }

  if (mode === "price-high") {
    return list.sort((a, b) => comparePriceCents(b.effectivePriceCents ?? b.priceCents, a.effectivePriceCents ?? a.priceCents));
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
  const canUseProductStorage = isCatalogBrowsable(product);
  const usable = (sitePath) => sitePath
    && (canUseProductStorage || !isR2BackedProductAssetPath(sitePath))
    && sitePathExists(sitePath);
  const pickUsable = (...pathsToTry) => pathsToTry.find(usable) || "";
  const coverSource = pickUsable(product.coverImage, product.frontCoverImage, product.thumbnailImage);
  const thumbSource = pickUsable(product.thumbnailImage, product.coverImage, product.frontCoverImage, coverSource);
  const previewImages = product.previewImages.filter(usable);
  const previewFeature = pickUsable(product.previewImage, previewImages[0]);
  const previewPdf = usable(product.previewPdf) ? product.previewPdf : "";
  const teaserVideo = usable(product.teaserVideo) ? product.teaserVideo : "";
  const coverAudit = !coverSource
    ? (product.coverImage ? `coverImage missing file ${product.coverImage}` : "coverImage field missing")
    : "";
  const previewAudit = buildPreviewAudit(product, previewFeature, previewImages, previewPdf, teaserVideo);
  const previewNotice = buildPreviewNotice(product, previewFeature, previewImages, previewPdf, teaserVideo);

  return {
    cover: coverSource || "/assets/logo.png",
    thumb: thumbSource || coverSource || "/assets/logo.png",
    previewFeature: previewFeature || "",
    previewImages,
    previewPdf,
    teaserVideo,
    coverAudit,
    previewAudit,
    previewNotice
  };
}

function pickExistingPath(...pathsToTry) {
  for (const sitePath of pathsToTry) {
    if (sitePath && sitePathExists(sitePath)) {
      return sitePath;
    }
  }
  return "";
}

function sitePathExists(sitePath) {
  if (!sitePath) {
    return false;
  }
  if (isR2BackedProductAssetPath(sitePath)) {
    return true;
  }
  const localPath = path.join(ROOT, sitePath.replace(/^\/+/, ""));
  return fs.existsSync(localPath);
}

function isR2BackedProductAssetPath(sitePath) {
  return /^\/product-assets\/[a-z0-9-]+\/(?:cover|preview)\.webp$/i.test(sitePath);
}

function buildPreviewAudit(product, previewFeature, previewImages, previewPdf, teaserVideo) {
  if (product.previewImage && !sitePathExists(product.previewImage)) {
    return `previewImage missing file ${product.previewImage}`;
  }
  if (!product.previewImage && !previewFeature && !previewImages.length && !previewPdf && !teaserVideo) {
    return "previewImage field missing";
  }
  return "";
}

function buildPreviewNotice(product, previewFeature, previewImages, previewPdf, teaserVideo) {
  if (product.previewImage && !sitePathExists(product.previewImage)) {
    return previewImages.length
      ? "The dedicated back-cover preview image is still missing, so this page is showing the first available sample image instead."
      : "The dedicated back-cover preview image has not been added yet.";
  }
  if (!product.previewImage && !previewFeature && !previewImages.length && !previewPdf && !teaserVideo) {
    return "A back-cover preview image has not been added yet.";
  }
  return "";
}

function collectAssetWarnings(products) {
  return products.flatMap((product) => {
    const warnings = [];
    if (product.assetSet.coverAudit) {
      warnings.push(`${product.slug}: ${product.assetSet.coverAudit}`);
    }
    if (product.assetSet.previewAudit) {
      warnings.push(`${product.slug}: ${product.assetSet.previewAudit}`);
    }
    return warnings;
  });
}

function parseDate(value) {
  if (!value) {
    return 0;
  }
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? 0 : stamp;
}

function formatPrice(product) {
  const displayPriceCents = product.effectivePriceCents ?? product.priceCents;
  if (displayPriceCents !== null) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: product.currency || "USD"
    }).format(centsToDecimal(displayPriceCents));
  }

  if (product.price) {
    return product.price;
  }

  return "";
}

function renderCardPrice(product) {
  if (!isCatalogBrowsable(product)) {
    return product.statusLabel;
  }
  if (product.buyMode === "pay-what-you-want") {
    return "Pay What You Want";
  }
  if (product.buyMode === "free-download") {
    return "Free Download";
  }
  if (product.effectivePriceCents !== null || product.priceCents !== null) {
    return formatPrice(product);
  }
  return product.statusLabel;
}

function renderDisplayPrice(product) {
  if (!isCatalogBrowsable(product)) {
    return product.statusLabel;
  }
  if (product.buyMode === "pay-what-you-want") {
    const minimum = product.minimumPriceCents !== null ? `Minimum ${formatCents(product.minimumPriceCents, product.currency)}` : "";
    const suggested = product.suggestedPriceCents !== null ? `Suggested ${formatCents(product.suggestedPriceCents, product.currency)}` : "";
    return [product.statusLabel, minimum, suggested].filter(Boolean).join(" | ");
  }

  if (product.buyMode === "free-download") {
    return "Free Download";
  }

  if (product.effectivePriceCents !== null || product.priceCents !== null) {
    return formatPrice(product);
  }

  return product.statusLabel;
}

function renderDeliveryLabel(product) {
  if (product.buyMode === "free-download") {
    return "Direct download from the product page";
  }
  if (isCartReady(product)) {
    return "Email delivery after payment confirmation";
  }
  if (isBuyModeActive(product.buyMode)) {
    return "Email delivery after payment confirmation";
  }
  if (product.buyMode === "preview-only") {
    return "Preview only";
  }
  return "Not yet available for direct purchase";
}

function renderProductLineValue(product) {
  return product.productLine || "Not assigned";
}

function renderSeriesValue(product) {
  return product.series || "";
}

function renderCatalogMeta(product) {
  return [
    product.gameSystem,
    product.productLine,
    product.series && product.series !== product.productLine ? product.series : ""
  ].filter(Boolean).join(" | ") || product.gameSystem;
}

function renderDiscoveryFilter(label, attribute, values) {
  return `<label class="catalog-control"><span>${escapeHtml(label)}</span><select class="dock-input" data-filter-${attribute}><option value="">Any ${escapeHtml(label)}</option>${values.map((value) => `<option value="${value}">${escapeHtml(humanizeMetadata(value))}</option>`).join("")}</select></label>`;
}

function renderMarketplaceIdentityItems(product) {
  const players = product.playerCountMin && product.playerCountMax
    ? (product.playerCountMin === product.playerCountMax ? String(product.playerCountMin) : `${product.playerCountMin}–${product.playerCountMax}`) : "";
  return [
    players && renderIdentityItem("Players", players),
    product.genre && renderIdentityItem("Genre", humanizeMetadata(product.genre)),
    product.gmMode && renderIdentityItem("GM", humanizeMetadata(product.gmMode)),
    product.prepBurden && renderIdentityItem("Prep", humanizeMetadata(product.prepBurden)),
    product.playMode && renderIdentityItem("Play", humanizeMetadata(product.playMode)),
    product.rulesComplexity && renderIdentityItem("Complexity", humanizeMetadata(product.rulesComplexity)),
    product.mediaType && renderIdentityItem("Media", humanizeMetadata(product.mediaType))
  ].filter(Boolean).map((item) => item.trimEnd());
}

function humanizeMetadata(value) { return String(value || "").replace("gm-less", "GMless").replace("one-shot", "One-shot").replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }

function renderProductDatasetAttributes(product, searchText) {
  const resolvedSearchText = (searchText || [
    product.title,
    product.subtitle,
    product.authors.join(" "),
    product.gameSystem,
    product.productLine,
    product.series,
    product.tags.join(" "),
    product.statusLabel,
    product.priceTypeLabel
  ].join(" ")).toLowerCase();

  return [
    `data-product-card="true"`,
    `data-slug="${escapeAttribute(product.slug)}"`,
    `data-title="${escapeAttribute(product.title.toLowerCase())}"`,
    `data-author="${escapeAttribute(product.authorSlugs.join("|"))}"`,
    `data-system="${escapeAttribute(product.gameSystemSlug)}"`,
    `data-line="${escapeAttribute(product.productLineSlug)}"`,
    `data-series="${escapeAttribute(product.seriesSlug)}"`,
    `data-status="${escapeAttribute(product.status)}"`,
    `data-format="${escapeAttribute(product.format.map(slugify).join("|"))}"`,
    `data-price-type="${escapeAttribute(slugify(product.priceTypeLabel))}"`,
    `data-price-cents="${escapeAttribute(String(product.effectivePriceCents ?? product.priceCents ?? -1))}"`,
    `data-release="${escapeAttribute(String(product.releaseStamp))}"`,
    `data-updated="${escapeAttribute(String(product.updatedStamp))}"`,
    `data-sale-active="${product.saleActive ? "true" : "false"}"`,
    `data-genre="${escapeAttribute(product.genre || "")}"`,
    `data-player-count-min="${escapeAttribute(String(product.playerCountMin || ""))}"`,
    `data-player-count-max="${escapeAttribute(String(product.playerCountMax || ""))}"`,
    `data-gm-mode="${escapeAttribute(product.gmMode || "")}"`,
    `data-prep-burden="${escapeAttribute(product.prepBurden || "")}"`,
    `data-play-mode="${escapeAttribute(product.playMode || "")}"`,
    `data-rules-complexity="${escapeAttribute(product.rulesComplexity || "")}"`,
    `data-media-type="${escapeAttribute(product.mediaType || "")}"`,
    `data-search="${escapeAttribute(resolvedSearchText)}"`
  ].join(" ");
}

function renderFileListSummary(product) {
  if (!isCatalogBrowsable(product)) {
    return "No files are currently offered from this historical catalog record.";
  }
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
  if (!isCatalogBrowsable(product)) {
    return `${product.title} is retained as a historical catalog record and is not currently available for purchase.`;
  }
  if (product.buyMode === "preview-only") {
    return `${product.title} is currently presented as a preview page with artwork, product details, and preview assets only.`;
  }
  if (product.buyMode === "coming-soon") {
    return `${product.title} is listed here with current format, status, and update information while direct ordering is being prepared.`;
  }
  return `You are buying ${product.title} in the listed digital format${product.pageCount ? `, currently ${product.pageCount} pages` : ""}, for personal tabletop use.`;
}

function renderCartPage(products) {
  const cartCatalog = products
    .filter((product) => isCartReady(product))
    .map((product) => ({
      cover: product.assetSet.thumb || product.assetSet.cover,
      currency: product.currency,
      priceCents: resolveEstimatedCartPriceCents(product),
      priceDisplay: formatCents(resolveEstimatedCartPriceCents(product), product.currency),
      slug: product.slug,
      title: product.title,
      url: product.url
    }));
  const cartCatalogJson = escapeInlineJson(JSON.stringify(cartCatalog));

  return renderLayout({
    pageTitle: `Cart | ${STORE_TITLE}`,
    description: "Review the Tobacco Road Games browser cart before checkout is enabled.",
    canonicalPath: "/store/cart/",
    currentNav: "cart",
    extraScripts: ["/assets/js/creator-balance-checkout.js?v=20260907-identity-repair"],
    structuredData: renderWebPageSchema({
      name: `${STORE_TITLE} Cart`,
      description: "Review the Tobacco Road Games browser cart before checkout is enabled.",
      url: `${BASE_URL}/store/cart/`
    }),
    content: `
      <main id="top">
        ${renderBreadcrumbs([{ label: "Store", href: "/store/" }, { label: "Cart" }])}

        <section class="store-section" aria-labelledby="cart-heading">
          <div class="section-heading">
            <p class="section-heading__kicker">Cart</p>
            <h1 id="cart-heading">Your Tobacco Road Games cart.</h1>
            <p>Items saved here stay in this browser while you keep browsing. Final product availability and pricing will be verified during checkout.</p>
          </div>
          <div class="cart-layout" data-cart-page>
            <section class="cart-panel">
              <div class="initiative-empty" data-cart-empty>Your cart is empty. Add a product from the store to see it here.</div>
              <p class="cart-summary__status" data-cart-status aria-live="polite">Add a cart-ready product to load a verified quote.</p>
              <div class="cart-item-list" data-cart-items></div>
              <div class="cart-unavailable" data-cart-unavailable hidden></div>
            </section>
            <aside class="note-card cart-summary">
              <p class="note-card__label" data-cart-total-label>Estimated Total</p>
              <p class="cart-summary__total" data-cart-total>$0.00</p>
              <p class="cart-summary__copy" data-cart-note>Final product availability and pricing will be verified during checkout.</p>
              <form class="cart-checkout-form" data-cart-checkout-form novalidate>
                <label class="cart-checkout-form__field">
                  <span>Email</span>
                  <input type="email" name="email" autocomplete="email" inputmode="email" data-cart-email>
                </label>
                <label class="cart-checkout-form__field">
                  <span>Confirm Email</span>
                  <input type="email" name="emailConfirmation" autocomplete="email" inputmode="email" data-cart-email-confirmation>
                </label>
                <div data-cart-email-verification><button type="button" class="button button--secondary" data-cart-email-send>Send Verification Code</button><label class="cart-checkout-form__field"><span>Verification Code</span><input inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-cart-email-code></label><button type="button" class="button button--secondary" data-cart-email-verify>Verify Email</button></div>
                <p class="cart-summary__copy">Every acquisition requires a verified email. An account is optional. Paid checkout opens securely on a Stripe-hosted page.</p>
                <p class="cart-checkout-form__feedback" data-cart-checkout-feedback aria-live="polite"></p>
                <button type="submit" class="button button--primary cart-summary__button" data-cart-checkout-submit disabled aria-disabled="true">Continue to Secure Checkout</button>
                <section class="creator-balance-checkout" data-creator-payment-identity hidden>
                  <label>
                    Creator identity for Creator Balance
                    <select data-creator-payment-identity-select></select>
                  </label>
                </section>
                <section class="creator-balance-checkout" data-creator-balance hidden>
                  <p class="note-card__label">Creator Balance</p>
                  <p data-creator-balance-status>Checking eligibility…</p>
                  <button type="button" class="button button--secondary cart-summary__button" data-creator-balance-submit disabled>Pay Entire Total with Creator Balance</button>
                  <p class="cart-checkout-form__feedback" data-creator-balance-feedback aria-live="polite"></p>
                </section>
              </form>
              <button type="button" class="button button--secondary cart-summary__button" data-cart-retry hidden>Retry Verified Quote</button>
              <button type="button" class="button button--secondary cart-summary__button" data-cart-clear>Clear Cart (Development)</button>
            </aside>
          </div>
        </section>
        <script id="trg-cart-catalog" type="application/json">${cartCatalogJson}</script>
      </main>
    `
  });
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

function isCatalogBrowsable(product) {
  return product.buyMode !== "retired"
    && product.status !== "retired"
    && product.status !== "legacy-not-for-sale";
}

function isCartReady(product) {
  return product.buyMode === "cart"
    && product.status === "available-direct"
    && Number.isInteger(product.effectivePriceCents ?? product.priceCents)
    && (product.effectivePriceCents ?? product.priceCents) > 0;
}

function isFreeDownloadReady(product) {
  return product.status === "available-direct"
    && Number.isInteger(product.priceCents)
    && product.priceCents === 0;
}

function resolveEstimatedCartPriceCents(product) {
  return product.effectivePriceCents ?? product.priceCents;
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

function renderCartActionButton(product, options = {}) {
  if (!isCartReady(product)) {
    return "";
  }

  const className = options.className || "button button--primary";
  const pwyw=product.pricingModel==='pwyw'||product.buyMode==='pay-what-you-want';const amount=pwyw?` data-pwyw-suggested-cents="${escapeAttribute(String(product.suggestedPriceCents??product.priceCents??0))}"`:'';
  return `<button type="button" class="${escapeAttribute(className)}" data-cart-add="${escapeAttribute(product.slug)}"${amount}>${pwyw?'Choose Price':'Add to Cart'}</button>`;
}

function renderFreeDownloadButton(product, options = {}) {
  if (!isFreeDownloadReady(product)) return "";
  const className = options.className || "button button--primary";
  return `<button type="button" class="${escapeAttribute(className)}" data-cart-add="${escapeAttribute(product.slug)}">Download Free PDF</button>`;
}

function renderDirectActionButton(product, options = {}) {
  return renderFreeDownloadButton(product, options) || renderCartActionButton(product, options);
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

function escapeInlineJson(value) {
  return String(value || "")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
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

function requireFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function resolveProductAuthorSlugs(product) {
  const explicit = ensureArray(product.authorSlugs).map((value) => slugify(value)).filter(Boolean);
  if (explicit.length) {
    return explicit;
  }
  return ensureArray(product.authors).map((author) => slugify(author)).filter(Boolean);
}

function resolveProductAuthorNames(product, authorSlugs, authorLookup) {
  if (authorSlugs.length) {
    const resolved = authorSlugs.map((slug) => authorLookup.get(slug)?.name).filter(Boolean);
    if (resolved.length === authorSlugs.length) {
      return resolved;
    }
  }
  return ensureArray(product.authors);
}

function renderPersonSchema(author) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    description: author.shortBio || author.longBio,
    url: `${BASE_URL}${author.url}`
  };

  if (author.title) {
    schema.jobTitle = author.title;
  }

  return JSON.stringify(schema);
}

function formatDateLabel(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(new Date(year, month - 1, day));
  }

  const stamp = parseDate(value);
  if (!stamp) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(stamp);
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

function buildRuntimeCatalog() {
  const scriptPath = path.join(ROOT, "scripts", "build-runtime-catalog.mjs");
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "Unknown runtime catalog build error.").trim();
    throw new Error(`Runtime catalog build failed. ${message}`);
  }
}

if (require.main === module) {
  if (process.argv.includes("--homepage-only")) {
    const products = loadProducts(buildAuthorLookup(loadAuthors())).filter(isCatalogBrowsable);
    buildHomepage(products);
    console.log("Built homepage only.");
  } else {
    main();
  }
}

module.exports = { selectHomepageShelfBooks, renderHomepageMerchandisingBooks, renderHomepageProductBay, renderHomepageShopWallMain, loadProducts, loadAuthors, buildAuthorLookup };
