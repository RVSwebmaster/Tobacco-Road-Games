import {
  defaultHomepageConfiguration,
  getHomepageConfiguration,
  HOMEPAGE_SHELF_CAPACITY,
  validateHomepageConfiguration
} from "./homepage-config-d1.mjs";
import {
  getApprovedPublicProductById,
  getApprovedPublicProductsByIds,
  getApprovedPublicProductBySlug
} from "./public-product-catalog.mjs";
import { getProductById, listProducts } from "./product-catalog-d1.mjs";

export const HOMEPAGE_BEST_SELLER_WINDOW_DAYS = 30;
export const HOMEPAGE_BEST_SELLER_LIMIT = 43;
export const HOMEPAGE_NEW_RELEASE_WINDOW_DAYS = 7;
export const OPEN_RULES_LIBRARY_SHELF_CAPACITY = 18;
export const OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS = Object.freeze([
  "5e-players-manual",
  "5e-spellbook",
  "5e-bard-spellbook",
  "5e-cleric-spellbook",
  "5e-druid-spellbook",
  "5e-paladin-spellbook",
  "5e-ranger-spellbook",
  "5e-sorcerer-spellbook",
  "5e-warlock-spellbook",
  "5e-wizard-spellbook",
  "5e-relics-and-wonders",
  "5e-dungeon-masters-handbook"
]);
export const OPEN_RULES_LIBRARY_LOWER_PRODUCT_IDS = Object.freeze([]);
export const OPEN_RULES_LIBRARY_PRODUCT_IDS = Object.freeze([
  ...OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS,
  ...OPEN_RULES_LIBRARY_LOWER_PRODUCT_IDS
]);

const BEST_SELLER_SQL = `
SELECT
  oi.product_slug,
  SUM(oi.line_total_cents) AS sales_cents,
  COUNT(DISTINCT o.id) AS paid_orders
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN marketplace_fraud_blocks fb
  ON fb.status = 'active'
 AND (fb.user_id = o.user_id OR fb.email_hash = o.customer_email_hash)
WHERE o.payment_status = 'paid'
  AND o.paid_at IS NOT NULL
  AND o.paid_at >= ?
  AND oi.line_total_cents > 0
  AND fb.id IS NULL
  AND COALESCE(u.role, 'user') = 'user'
  AND lower(COALESCE(u.email_normalized, o.customer_email_normalized, '')) NOT LIKE '%test%'
GROUP BY oi.product_slug
HAVING SUM(oi.line_total_cents) > 0
ORDER BY sales_cents DESC, paid_orders DESC, oi.product_slug ASC
LIMIT ?
`;

export async function getHomepageShelves(database, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const windowDays = positiveInteger(options.windowDays, HOMEPAGE_BEST_SELLER_WINDOW_DAYS);
  const limit = positiveInteger(options.limit, HOMEPAGE_BEST_SELLER_LIMIT);
  const configurationRecord = await loadConfiguration(database, options.configuration);
  const configuration = configurationRecord.configuration;
  const candidates = await getHomepageCandidateSets(database, {
    catalog: options.catalog,
    limit,
    nowMs,
    windowDays
  });
  const openRulesLibrary = await getOpenRulesLibraryShelves(database, options.catalog);

  const featuredConfig = configuration.shelves.featuredCreator;
  const featuredPool = featuredConfig.creatorId
    ? candidates.all.filter((product) => product.creatorId === featuredConfig.creatorId)
    : [];
  const suppressed = {};
  for (const [key, shelf] of Object.entries(configuration.shelves)) {
    suppressed[key] = await configuredProductSlugs(database, shelf.productIds, options.catalog);
  }
  const shelves = {
    featuredCreator: publicShelf(featuredConfig, selectShelfProducts(featuredConfig, featuredPool), suppressed.featuredCreator, Boolean(featuredConfig.creatorId)),
    newThisWeek: publicShelf(configuration.shelves.newThisWeek,
      selectShelfProducts(configuration.shelves.newThisWeek, candidates.newThisWeek), suppressed.newThisWeek),
    bestSellers: publicShelf(configuration.shelves.bestSellers,
      selectShelfProducts(configuration.shelves.bestSellers, candidates.bestSellers), suppressed.bestSellers),
    freePwyw: publicShelf(configuration.shelves.freePwyw,
      selectShelfProducts(configuration.shelves.freePwyw, candidates.freePwyw), suppressed.freePwyw),
    openRulesLibraryUpper: {
      managed: true,
      capacity: OPEN_RULES_LIBRARY_SHELF_CAPACITY,
      physicalShelf: "upper",
      products: openRulesLibrary.upper,
      suppressedSlugs: [],
      visible: true
    },
    openRulesLibraryLower: {
      managed: true,
      capacity: OPEN_RULES_LIBRARY_SHELF_CAPACITY,
      physicalShelf: "lower",
      products: openRulesLibrary.lower,
      suppressedSlugs: [],
      visible: true
    }
  };

  return {
    bestSellers: shelves.bestSellers.products,
    configurationRevision: configurationRecord.revision,
    shelves,
    windowDays
  };
}

export async function getOpenRulesLibraryProducts(database, compatibilityCatalog = null) {
  const shelves = await getOpenRulesLibraryShelves(database, compatibilityCatalog);
  return [...shelves.upper, ...shelves.lower];
}

export async function getOpenRulesLibraryShelves(database, compatibilityCatalog = null) {
  const products = Array.isArray(compatibilityCatalog)
    ? compatibilityCatalog
    : await getApprovedPublicProductsByIds(database, OPEN_RULES_LIBRARY_PRODUCT_IDS);
  return {
    upper: selectOpenRulesLibraryProducts(products, OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS),
    lower: selectOpenRulesLibraryProducts(products, OPEN_RULES_LIBRARY_LOWER_PRODUCT_IDS)
  };
}

export function selectOpenRulesLibraryProducts(products, productIds = OPEN_RULES_LIBRARY_PRODUCT_IDS) {
  const byId = new Map(products.map((product) => [String(product.id || product.slug || ""), product]));
  return productIds.slice(0, OPEN_RULES_LIBRARY_SHELF_CAPACITY)
    .map((id) => byId.get(id))
    .filter(isOpenRulesLibraryProduct)
    .map(toHomepageProduct);
}

function isOpenRulesLibraryProduct(product) {
  return Boolean(
    product
      && product.metadata?.openRulesEligible === true
      && String(product.status || "") !== "retired"
      && String(product.buyMode || "") !== "retired"
  );
}

export async function getHomepageCandidateSets(database, options = {}) {
  const compatibilityCatalog = Array.isArray(options.catalog) ? options.catalog : null;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const windowDays = positiveInteger(options.windowDays, HOMEPAGE_BEST_SELLER_WINDOW_DAYS);
  const limit = positiveInteger(options.limit, HOMEPAGE_BEST_SELLER_LIMIT);
  const all = compatibilityCatalog
    ? compatibilityCatalog.filter(isHomepageEligible).map(toHomepageProduct)
    : await listApprovedHomepageProducts(database);
  const bestSellers = await getBestSellerProducts(database, {
    all,
    compatibilityCatalog,
    limit,
    nowMs,
    windowDays
  });
  const releaseCutoff = nowMs - HOMEPAGE_NEW_RELEASE_WINDOW_DAYS * 86400000;
  const newThisWeek = all.filter((product) => {
    const stamp = releaseTimestamp(product);
    return Number.isFinite(stamp) && stamp >= releaseCutoff && stamp <= nowMs;
  }).sort((a, b) => releaseTimestamp(b) - releaseTimestamp(a) || a.slug.localeCompare(b.slug));
  const freePwyw = all.filter((product) => ["free", "pwyw"].includes(product.pricingModel));
  return {
    all: all.slice(0, 1000),
    bestSellers: bestSellers.slice(0, limit),
    freePwyw: freePwyw.slice(0, HOMEPAGE_SHELF_CAPACITY),
    newThisWeek: newThisWeek.slice(0, HOMEPAGE_SHELF_CAPACITY)
  };
}

async function listApprovedHomepageProducts(database) {
  const products = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await listProducts(database, { publicationState: "published", limit: 200, offset });
    for (const product of page) {
      const approved = await getApprovedPublicProductById(database, product.id);
      if (isHomepageEligible(approved)) products.push(toHomepageProduct(approved));
    }
    if (page.length < 200) break;
  }
  return products;
}

async function getBestSellerProducts(database, { all, compatibilityCatalog, limit, nowMs, windowDays }) {
  const bySlug = new Map(all.map((product) => [normalizeSlug(product.slug), product]));
  const since = new Date(nowMs - windowDays * 86400000).toISOString();
  const result = await database.prepare(BEST_SELLER_SQL).bind(since, limit).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const bestSellers = [];
  for (const row of rows) {
    if (Number(row.sales_cents || 0) <= 0) continue;
    let product = bySlug.get(normalizeSlug(row.product_slug));
    if (!product && !compatibilityCatalog) {
      const approved = await getApprovedPublicProductBySlug(database, normalizeSlug(row.product_slug));
      if (isHomepageEligible(approved)) product = toHomepageProduct(approved);
    }
    if (!product) continue;
    bestSellers.push(product);
    if (bestSellers.length >= limit) break;
  }
  return bestSellers;
}

async function loadConfiguration(database, supplied) {
  if (supplied) {
    const configuration = validateHomepageConfiguration(supplied.configuration || supplied);
    return { configuration, revision: Number(supplied.revision || 0) };
  }
  try { return await getHomepageConfiguration(database); }
  catch { return { configuration: defaultHomepageConfiguration(), revision: 0 }; }
}

async function configuredProductSlugs(database, ids, compatibilityCatalog) {
  if (!ids.length) return [];
  if (Array.isArray(compatibilityCatalog)) {
    const byId = new Map(compatibilityCatalog.map((product) => [String(product.id || product.slug), product]));
    return ids.map((id) => byId.get(id)?.slug).filter(Boolean).map(normalizeSlug);
  }
  const slugs = [];
  for (const id of ids) {
    const product = await getProductById(database, id);
    if (product?.slug) slugs.push(normalizeSlug(product.slug));
  }
  return slugs;
}

function publicShelf(config, products, suppressedSlugs, explicitlyManaged = false) {
  const selected = products.slice(0, HOMEPAGE_SHELF_CAPACITY);
  return {
    managed: config.managed || explicitlyManaged || config.visible === false || selected.length > 0,
    products: config.visible ? selected : [],
    suppressedSlugs,
    visible: config.visible
  };
}

function selectShelfProducts(config, products) {
  const byId = new Map(products.map((product) => [String(product.id || product.slug), product]));
  const pinned = config.productIds.map((id) => byId.get(id)).filter(Boolean);
  if (config.managed) return pinned;
  const pinnedIds = new Set(pinned.map((product) => String(product.id || product.slug)));
  return [...pinned, ...products.filter((product) => !pinnedIds.has(String(product.id || product.slug)))];
}

export function isHomepageEligible(product) {
  return Boolean(
    product
      && (!product.storefrontVisibility || product.storefrontVisibility === "listed")
      && ["available-direct", "pay-what-you-want", "free-download"].includes(String(product.status || ""))
      && String(product.buyMode || "") !== "retired"
  );
}

export function toHomepageProduct(product) {
  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  return {
    id: String(product.id || product.slug || ""),
    slug: String(product.slug || ""),
    title: String(product.title || ""),
    creatorId: String(product.creatorId || ""),
    creator: String(product.creatorName || product.creator || "Tobacco Road Games"),
    priceLabel: String(product.priceLabel || publicPriceLabel(product)),
    pricingModel: String(product.pricingModel || legacyPricingModel(product)),
    description: String(product.shortDescription || product.description || "Product details available on the full product page."),
    cover: String(product.coverUrl || product.cover || "/assets/tobacco-road-games-logo.png"),
    fullUrl: String(product.detailUrl || product.fullUrl || `/store/products/${encodeURIComponent(String(product.slug || ""))}/`),
    metadata,
    publishedAt: product.publishedAt || product.releaseDate || metadata.releaseDate || null,
    updatedAt: product.updatedAt || null
  };
}

function legacyPricingModel(product) {
  if (product.buyMode === "free-download") return "free";
  if (product.status === "pay-what-you-want") return "pwyw";
  return "fixed";
}
function releaseTimestamp(product) {
  for (const value of [product.metadata?.releaseDate, product.publishedAt, product.updatedAt]) {
    const stamp = value ? Date.parse(value) : NaN;
    if (Number.isFinite(stamp)) return stamp;
  }
  return NaN;
}
function publicPriceLabel(product) {
  if (product.buyMode === "preview-only" || product.status === "preview-only") return "Preview Only";
  if (product.pricingModel === "free") return "Free Download";
  if (product.pricingModel === "pwyw") return `Pay What You Want — ${money(product.suggestedPriceCents, product.currency)} suggested`;
  if (Number.isSafeInteger(product.priceCents)) return money(product.priceCents, product.currency);
  return String(product.status || "Available");
}
function money(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents || 0) / 100);
}
function normalizeSlug(value) { return String(value || "").trim().toLowerCase(); }
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export { BEST_SELLER_SQL };
