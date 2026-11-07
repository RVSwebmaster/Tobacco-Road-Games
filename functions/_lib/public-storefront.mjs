import { getApprovedPublicProductBySlug, getOtherApprovedPublicProductsByCreator } from "./public-product-catalog.mjs";

const ACTIVE_STATUS_LABELS = Object.freeze({
  "available-direct": "Available Direct",
  "coming-soon": "Coming Soon",
  "free-download": "Free Download",
  "legacy-edition": "Legacy Edition",
  "legacy-not-for-sale": "Legacy — Not for Sale",
  "pay-what-you-want": "Pay What You Want",
  "preview-available": "Preview Available",
  "preview-only": "Preview Only",
  "revised-edition-pending": "Revised Edition Pending",
  retired: "Retired"
});

export async function handlePublicProductPage(context) {
  const request = context.request;
  if (!request || !["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (!context.env?.TRG_ORDERS?.prepare) return textPage("Catalog unavailable", 503);
  const slug = String(context.params?.slug || "").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) {
    return textPage("Product not found", 404);
  }

  const product = await getApprovedPublicProductBySlug(context.env.TRG_ORDERS, slug);
  if (!product) {
    if (typeof context.next === "function") return context.next();
    return textPage("Product not found", 404);
  }

  const otherCreatorProducts = await getOtherApprovedPublicProductsByCreator(context.env.TRG_ORDERS, product.creatorId, product.slug);
  const html = renderPublicProductPage(product, new URL(request.url), otherCreatorProducts);
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

export function renderPublicProductPage(product, requestUrl = new URL("https://tobaccoroadgames.com/"), otherCreatorProducts = []) {
  const title = text(product.title, "Untitled Product");
  const subtitle = text(product.subtitle);
  const shortDescription = text(product.shortDescription, "Product details are available from Tobacco Road Games.");
  const longDescription = text(product.longDescription, shortDescription);
  const statusLabel = statusLabelFor(product.status);
  const creatorName = text(product.creatorName, product.publisher || "Tobacco Road Games");
  const creatorImage = text(product.creatorLogo, product.creatorProfileImage);
  const authors = list(product.metadata?.authors);
  const canonical = new URL(product.detailUrl, requestUrl.origin).href;
  const cover = product.coverUrl || "/assets/logo.png";
  const formats = list(product.metadata?.format);
  const features = list(product.metadata?.features);
  const pageCount = positiveInteger(product.metadata?.pageCount);
  const version = text(product.metadata?.version);
  const releaseDate = text(product.metadata?.releaseDate);
  const series = text(product.metadata?.series);
  const price = formatPublicPrice(product);
  const priceDetails = formatPublicPriceDetails(product);
  const details = [
    ["Creator", creatorName],
    ["Publisher / Imprint", product.publisher],
    ["Game System", product.gameSystem],
    ["Product Line", product.productLine],
    ["Series", series],
    ["Format", formats.join(", ") || "Digital"],
    ["Pages", pageCount ? String(pageCount) : "TBD"],
    ["Status", statusLabel],
    ["Version", version || "TBD"],
    ["Published", releaseDate || dateOnly(product.publishedAt) || "TBD"],
    ["Price", priceDetails]
  ].filter(([, value]) => value);
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    description: shortDescription,
    image: [new URL(cover, requestUrl.origin).href],
    brand: { "@type": "Brand", name: text(product.publisher, "Tobacco Road Games") },
    sku: product.id,
    category: text(product.productLine, product.genre),
    url: canonical
  }).replace(/</g, "\\u003c");
  const purchaseMessage = product.storefrontVisibility === "listed"
    ? "Add this product to the cart for a server-verified quote. Payment and acquisition for Cloudflare-native products are not active yet."
    : "This catalog record is not currently available for purchase.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Tobacco Road Games Store</title>
  <meta name="description" content="${escapeAttribute(shortDescription)}">
  <link rel="canonical" href="${escapeAttribute(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Tobacco Road Games">
  <meta property="og:title" content="${escapeAttribute(title)} | Tobacco Road Games Store">
  <meta property="og:description" content="${escapeAttribute(shortDescription)}">
  <meta property="og:url" content="${escapeAttribute(canonical)}">
  <meta property="og:image" content="${escapeAttribute(new URL(cover, requestUrl.origin).href)}">
  <meta name="theme-color" content="#120c08">
  <link rel="icon" type="image/png" href="/assets/logo.png">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${schema}</script>
  <script src="/assets/js/store-status.js" defer></script>
  <script src="/assets/js/cart.js" defer></script>
  <script src="/assets/js/product-book.js" defer></script>
</head>
<body class="view-section">
  <div class="page-shell">
    ${renderHeader()}
    <main id="top">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/store/">Store</a><span class="breadcrumbs__sep">/</span><a href="/store/catalog/">Catalog</a><span class="breadcrumbs__sep">/</span><span aria-current="page">${escapeHtml(title)}</span>
      </nav>
      <div class="product-identity-layout">
        <aside class="product-identity__creator store-section" aria-labelledby="creator-identity-heading">
          <p class="section-heading__kicker">Creator Identity</p>
          <h2 id="creator-identity-heading">${escapeHtml(creatorName)}</h2>
          <div class="product-identity__portrait">${creatorImage
            ? `<img src="${escapeAttribute(creatorImage)}" alt="${escapeAttribute(creatorName)} ${product.creatorLogo ? "logo" : "photograph"}">`
            : `<span>Creator image not available</span>`}</div>
          ${product.creatorShortBio ? `<p class="product-identity__bio">${escapeHtml(product.creatorShortBio)}</p>` : `<p class="product-identity__empty">Biography not available yet.</p>`}
          ${product.creatorProfileUrl ? `<a class="author-link" href="${escapeAttribute(product.creatorProfileUrl)}">View creator profile</a>` : `<p class="product-identity__empty">Public profile not available yet.</p>`}
          <div class="product-identity__more">
            <h3>More from this creator</h3>
            ${otherCreatorProducts.length ? `<ul>${otherCreatorProducts.map(item => `<li><a href="${escapeAttribute(item.detailUrl)}">${escapeHtml(item.title)}</a></li>`).join("")}</ul>` : `<p class="product-identity__empty">No other products listed yet.</p>`}
          </div>
        </aside>
        <div class="product-identity__product store-section" aria-label="Product Identity">
      <section class="product-hero" aria-labelledby="product-title">
        <div class="product-hero__media" data-product-book data-page-count="${pageCount}" data-spine-credit="${escapeAttribute(creatorName || product.publisher)}"><img class="product-cover" src="${escapeAttribute(cover)}" alt="${escapeAttribute(title)} front cover"></div>
        <div class="product-hero__copy">
          <span class="status-badge status-badge--${escapeAttribute(product.status)}">${escapeHtml(statusLabel)}</span>
          <p class="section-heading__kicker">${escapeHtml(product.gameSystem || "Tabletop Roleplaying")}</p>
          <h1 id="product-title">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="product-subtitle">${escapeHtml(subtitle)}</p>` : ""}
          <p class="product-byline">${authors.length ? `By ${authors.map(escapeHtml).join(", ")}` : "Author not listed"}</p>
          ${product.publisher ? `<p class="product-byline">Publisher / Imprint: ${escapeHtml(product.publisher)}</p>` : ""}
          <div class="product-hero__meta">
            <span>${escapeHtml(price)}</span>
            <span>${escapeHtml(formats.join(", ") || "Digital")}</span>
            ${pageCount ? `<span>${pageCount} pages</span>` : ""}
            ${product.productLine ? `<span>${escapeHtml(product.productLine)}</span>` : ""}
            ${version ? `<span>${escapeHtml(version)}</span>` : ""}
          </div>
          <div class="hero__actions">
            ${renderNativeCartControl(product)}
            ${product.previewUrl ? `<a class="button button--secondary" href="${escapeAttribute(product.previewUrl)}" target="_blank" rel="noopener noreferrer">Open Preview</a>` : ""}
          </div>
          <p class="fulfillment-note">${escapeHtml(purchaseMessage)}</p>
          <p class="fulfillment-note">${escapeHtml(shortDescription)}</p>
        </div>
      </section>
      <section class="store-section" aria-labelledby="details-heading">
        <div class="section-heading"><p class="section-heading__kicker">Details</p><h2 id="details-heading">Details</h2></div>
        <dl class="identity-strip">${details.map(([label, value]) => `<div class="identity-strip__item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
        <div class="product-support-grid">
          <article class="note-card"><p class="note-card__label">Pricing</p><p>${escapeHtml(priceDetails)}</p></article>
          <article class="note-card"><p class="note-card__label">Delivery</p><p>Private delivery files are never exposed by the public asset route.</p></article>
          <article class="note-card"><p class="note-card__label">Availability</p><p>${escapeHtml(purchaseMessage)}</p></article>
        </div>
      </section>
      <section class="store-section" aria-labelledby="overview-heading">
        <div class="section-heading"><p class="section-heading__kicker">Overview</p><h2 id="overview-heading">Overview</h2></div>
        <div class="about__panel">${renderParagraphs(longDescription)}</div>
      </section>
      ${features.length ? `<section class="store-section" aria-labelledby="contents-heading"><div class="section-heading"><p class="section-heading__kicker">What's Inside</p><h2 id="contents-heading">What's Inside</h2></div><ul class="feature-list">${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul></section>` : ""}
      ${product.previewUrl ? `<section class="store-section" aria-labelledby="preview-heading"><div class="section-heading"><p class="section-heading__kicker">Preview</p><h2 id="preview-heading">Preview</h2></div><div class="preview-panel"><figure class="preview-feature"><img src="${escapeAttribute(product.previewUrl)}" alt="${escapeAttribute(title)} preview image"></figure></div></section>` : ""}
        </div>
      </div>
    </main>
    ${renderFooter()}
  </div>
</body>
</html>`;
}

export function formatPublicPrice(product) {
  if (product.pricingModel === "free") return "Free Download";
  if (product.pricingModel === "pwyw") return `Pay What You Want — ${money(product.suggestedPriceCents, product.currency)} suggested`;
  const cents = activeSalePrice(product) ?? product.priceCents;
  return money(cents, product.currency);
}

export function formatPublicPriceDetails(product) {
  if (product.pricingModel === "free") return "Free Download";
  if (product.pricingModel === "pwyw") {
    return `Pay What You Want — ${money(product.minimumPriceCents, product.currency)} minimum; ${money(product.suggestedPriceCents, product.currency)} suggested`;
  }
  const sale = activeSalePrice(product);
  return sale === null ? money(product.priceCents, product.currency) : `${money(sale, product.currency)} sale price; normally ${money(product.priceCents, product.currency)}`;
}

function renderNativeCartControl(product) {
  if (product.storefrontVisibility !== "listed") {
    return `<button type="button" class="button button--primary" disabled>Currently unavailable</button>`;
  }
  if (product.pricingModel === "pwyw") {
    const minimum = (Number(product.minimumPriceCents || 0) / 100).toFixed(2);
    const suggested = (Number(product.suggestedPriceCents || 0) / 100).toFixed(2);
    return `<div class="pwyw-purchase"><label for="pwyw-${escapeAttribute(product.slug)}">Choose your price</label><input id="pwyw-${escapeAttribute(product.slug)}" class="dock-input" type="number" inputmode="decimal" min="${minimum}" step="0.01" value="${suggested}" data-pwyw-amount-for="${escapeAttribute(product.slug)}"><span>${escapeHtml(formatPublicPriceDetails(product))}</span><button type="button" class="button button--primary" data-cart-add="${escapeAttribute(product.slug)}" data-pwyw-minimum-cents="${Number(product.minimumPriceCents || 0)}" data-pwyw-suggested-cents="${Number(product.suggestedPriceCents || 0)}">Add to Cart</button></div>`;
  }
  return `<button type="button" class="button button--primary" data-cart-add="${escapeAttribute(product.slug)}">${product.pricingModel === "free" ? "Add Free Product to Cart" : "Add to Cart"}</button>`;
}

function activeSalePrice(product, nowMs = Date.now()) {
  if (!product.saleEnabled || !Number.isSafeInteger(product.salePriceCents)) return null;
  if (product.saleStart && Date.parse(product.saleStart) > nowMs) return null;
  if (product.saleEnd && Date.parse(product.saleEnd) < nowMs) return null;
  return product.salePriceCents;
}

function money(cents, currency = "USD") {
  const amount = Number.isSafeInteger(cents) ? cents / 100 : 0;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount); }
  catch { return `$${amount.toFixed(2)}`; }
}

function statusLabelFor(status) { return ACTIVE_STATUS_LABELS[status] || humanize(status); }
function humanize(value) { return text(value).replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
function text(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function list(value) { return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean) : []; }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : 0; }
function dateOnly(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : ""; }
function renderParagraphs(value) { return text(value).split(/\n\s*\n/).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join(""); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value); }

function renderHeader() {
  return `<header class="site-header"><a class="brand" href="/" aria-label="Tobacco Road Games home"><img class="brand__logo" src="/assets/logo.png" alt="Tobacco Road Games logo"><div class="brand__copy"><span class="brand__name">Tobacco Road Games</span></div></a><nav class="site-nav" aria-label="Primary"><a href="/store/catalog/" aria-current="page">Explore</a><a href="/support.html">Support</a><a href="/account.html">Login/Signup</a><a href="/store/cart/">Cart <span class="cart-count-badge" data-cart-count>0</span></a></nav></header>`;
}

function renderFooter() {
  return `<footer class="site-footer"><a class="footer-mark" href="/ad-depot.html" title="Ad depot" aria-label="Ad depot"><img src="/assets/logo.png" alt=""></a><p>&copy; ${new Date().getUTCFullYear()} Tobacco Road Games.</p><p>A marketplace for independent creators, operated by Tobacco Road Games.</p></footer>`;
}

function textPage(message, status) {
  return new Response(message, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}
