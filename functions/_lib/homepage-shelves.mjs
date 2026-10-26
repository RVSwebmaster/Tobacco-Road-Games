import { getRuntimeCatalogProducts } from "./runtime-catalog.mjs";

export const HOMEPAGE_BEST_SELLER_WINDOW_DAYS = 30;
export const HOMEPAGE_BEST_SELLER_LIMIT = 43;

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
  const catalog = Array.isArray(options.catalog) ? options.catalog : getRuntimeCatalogProducts();
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const windowDays = positiveInteger(options.windowDays, HOMEPAGE_BEST_SELLER_WINDOW_DAYS);
  const limit = positiveInteger(options.limit, HOMEPAGE_BEST_SELLER_LIMIT);
  const catalogBySlug = new Map(catalog.map((product) => [normalizeSlug(product.slug), product]));
  const since = new Date(nowMs - (windowDays * 86400000)).toISOString();

  if (!database?.prepare) {
    return { bestSellers: [], windowDays };
  }

  const result = await database.prepare(BEST_SELLER_SQL).bind(since, limit).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const bestSellers = [];

  for (const row of rows) {
    if (Number(row.sales_cents || 0) <= 0) continue;
    const product = catalogBySlug.get(normalizeSlug(row.product_slug));
    if (!isHomepageEligible(product)) continue;
    bestSellers.push(toHomepageProduct(product));
    if (bestSellers.length >= limit) break;
  }

  return { bestSellers, windowDays };
}

export function isHomepageEligible(product) {
  return Boolean(
    product
      && ["available-direct", "pay-what-you-want", "free-download"].includes(String(product.status || ""))
      && String(product.buyMode || "") !== "retired"
  );
}

export function toHomepageProduct(product) {
  const effectivePriceCents = Number.isInteger(product.effectivePriceCents) ? product.effectivePriceCents : null;
  return {
    slug: String(product.slug || ""),
    title: String(product.title || ""),
    creator: String(product.authorDisplay || product.publisher || "Tobacco Road Games"),
    priceLabel: priceLabel(product, effectivePriceCents),
    description: String(product.shortDescription || "Product details available on the full product page."),
    cover: String(product.coverUrl || "/assets/tobacco-road-games-logo.png"),
    fullUrl: `/store/products/${encodeURIComponent(String(product.slug || ""))}/`
  };
}

function priceLabel(product, effectivePriceCents) {
  if (product.buyMode === "pay-what-you-want") return "Pay What You Want";
  if (product.buyMode === "free-download" || effectivePriceCents === 0) return "Free Download";
  if (effectivePriceCents !== null) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(product.currency || "USD")
    }).format(effectivePriceCents / 100);
  }
  return String(product.status || "Available");
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export { BEST_SELLER_SQL };
