const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderGuestLibraryBay, renderGuestOpenRulesBay } = require("./build-store.js");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const homepage = read("index.html");
const guest = read("guest/index.html");
const guestCss = read("assets/css/guest-landing.css");
const guestMagic = read("assets/js/magical-bookshelf.js");
const builder = read("scripts/build-store.js");
const outputBuilder = read("scripts/build-pages-output.mjs");

const nav = guest.match(/<nav class="site-nav" aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] || "";
const navLabels = [...nav.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((match) => match[1].replace(/<span[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
assert.deepEqual(navLabels, ["Explore", "Support", "Login/Signup", "Cart"]);
assert.match(nav, /href="\/store\/catalog\/"[^>]*>Explore<\/a>/);
assert.match(nav, /href="\/support\.html"[^>]*>Support<\/a>/);
assert.match(nav, /href="\/account\.html"[^>]*>Login\/Signup<\/a>/);
assert.match(nav, /href="\/store\/cart\/"[^>]*>Cart <span class="cart-count-badge" data-cart-count>0<\/span><\/a>/);

assert.match(guest, /data-guest-landing/);
assert.match(guest, /data-magical-bookshelf-demo/);
assert.match(guest, /\/assets\/js\/magical-bookshelf\.js/);
assert.equal((guest.match(/data-magical-bookshelf(?:\s|>)/g) || []).length, 7);
assert.equal((guest.match(/data-magical-book(?:\s|>)/g) || []).length, 36);
assert.equal((guest.match(/data-magical-direction="outer-inward"/g) || []).length, 3);
assert.doesNotMatch(guest, /data-magical-bookshelf-replay/);
assert.match(guest, /Your shelves look a little bare\.<br>Log in or sign up to make them your own\./);
assert.equal((guest.match(/guest-library-sign/g) || []).length, 1);
const guestLibrary = guest.match(/<section class="shop-wall-bay shop-wall-bay--library guest-library-bay"[\s\S]*?<\/section>/)?.[0] || "";
assert.ok(guestLibrary);
assert.doesNotMatch(guestLibrary, /bookshelf-book|shop-wall-product-mock|data-fill-library/);
assert.equal((guestLibrary.match(/guest-library-empty-row/g) || []).length, 2);

assert.match(guest, /id="open-rules-library-heading"/);
assert.match(guest, /data-library-start-position="1"/);
assert.match(guest, /data-library-start-position="19"/);
assert.match(builder, /products\.slice\(0, 18\), 1/);
assert.match(builder, /products\.slice\(18, 36\), 19/);
assert.match(builder, /\.slice\(0, 36\)/);

assert.doesNotMatch(guest, /id="free-pwyw-wall-heading"|aria-label="FREE &amp; PWYW shelf"/);
assert.match(guest, /href="\/store\/catalog\/"/);
assert.match(guest, /class="storefront-news-chiron"/);
assert.equal(guest.match(/<aside class="storefront-news-chiron"[\s\S]*?<\/aside>/)?.[0], homepage.match(/<aside class="storefront-news-chiron"[\s\S]*?<\/aside>/)?.[0]);

const cabinetPicture = (document) => document.match(/<picture class="shop-wall-cabinet-art"[\s\S]*?<\/picture>/)?.[0];
assert.equal(cabinetPicture(guest), cabinetPicture(homepage));
assert.match(guest, /\/assets\/js\/cart\.js/);
assert.match(guest, /\/assets\/js\/storefront\.js/);
assert.match(guest, /\/assets\/js\/news-chyron\.js/);
assert.match(guest, /\/assets\/js\/shelf-curios\.js/);
assert.match(guest, /\/assets\/js\/magical-bookshelf\.js\?v=20261026-guest-unit1/);
assert.match(guest, /\/assets\/css\/guest-landing\.css\?v=20261026-guest-unit1/);
assert.match(guest, /\/assets\/js\/guest-product-preview\.js\?v=20261026-guest-unit1/);
assert.match(builder, /GUEST_FEATURE_CACHE_BUST = "20261026-guest-unit1"/);
assert.match(builder, /guest-product-preview\.js\?v=\$\{GUEST_FEATURE_CACHE_BUST\}/);

assert.doesNotMatch(homepage, /data-guest-landing|guest-library-sign|Login\/Signup/);
assert.doesNotMatch(guestCss, /(^|\n)\s*(\.homepage-shop-wall|\.shop-wall-)/m);
assert.match(guestCss, /\.guest-landing-page \.guest-library-sign/);
assert.match(guestCss, /@media \(max-width: 1023px\)/);
assert.match(guestCss, /@media \(max-width: 699px\)/);
assert.match(guestCss, /body:has\(\.guest-landing-page\) \.site-nav/);
assert.match(guestCss, /white-space: nowrap/);
assert.match(guestCss, /a\[href="\/support\.html"\][\s\S]*display: flex/);
assert.match(guestCss, /a\[href="\/account\.html"\]::after[\s\S]*content: none/);
assert.match(guestCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(guestCss, /guest-book-materialize/);
assert.match(guestCss, /guest-magic-spark/);
assert.match(guestCss, /guest-bookshelf-magic__flash/);
assert.match(guestMagic, /createFlashDescriptors/);
assert.match(guestMagic, /1 \+ Math\.floor\(random\(\) \* 3\)/);
assert.match(guestMagic, /DEFAULT_INTERVAL_MS = 500/);
assert.match(guestMagic, /orderBooksByDirection/);
assert.match(guestMagic, /buildEffectAnchors/);
assert.match(guestMagic, /closest\("\.shop-wall-shelf-level"\)/);
assert.match(guestMagic, /has-magical-effect/);
assert.match(guestMagic, /getComputedStyle\(shelfLevel\)\.display === "contents"/);
assert.match(guestMagic, /closest\("\.shop-wall-fixed-cabinet"\)/);
assert.match(guestCss, /shop-wall-fixed-cabinet\.has-magical-effect/);
assert.match(guestMagic, /event\.code !== "Space"/);
assert.match(guestMagic, /isTextEntryTarget\(event\.target\)/);
assert.match(guestMagic, /prefers-reduced-motion: reduce/);
assert.match(outputBuilder, /"guest"/);

const mockProduct = (index) => ({
  slug: `open-rule-${index}`,
  title: `Open Rule ${index}`,
  authors: ["Tobacco Road Games"],
  publisher: "Tobacco Road Games",
  status: "available-direct",
  statusLabel: "Available Direct",
  saleActive: false,
  format: ["PDF"],
  url: `/store/products/open-rule-${index}/`,
  assetSet: { cover: `/covers/open-rule-${index}.webp` },
  priceType: "fixed-price",
  priceTypeLabel: "Fixed Price",
  priceCents: 100,
  effectivePriceCents: 100,
  currency: "USD",
  shortDescription: "Sandbox open rule.",
  subtitle: "",
  tags: [],
  authorSlugs: ["rv-sawyer"]
});
const openRules = renderGuestOpenRulesBay(Array.from({ length: 40 }, (_, index) => mockProduct(index + 1)));
const positions = [...openRules.matchAll(/data-library-position="(\d+)"/g)].map((match) => Number(match[1]));
assert.deepEqual(positions, Array.from({ length: 36 }, (_, index) => index + 1));
assert.equal(positions.length, 36);
assert.equal((openRules.match(/data-mock-open-rule/g) || []).length, 0);

const emptyOpenRules = renderGuestOpenRulesBay([]);
const emptyPositions = [...emptyOpenRules.matchAll(/data-library-position="(\d+)"/g)].map((match) => Number(match[1]));
assert.deepEqual(emptyPositions, Array.from({ length: 36 }, (_, index) => index + 1));
assert.equal((emptyOpenRules.match(/data-mock-open-rule="true"/g) || []).length, 36);
assert.doesNotMatch(emptyOpenRules, /href=|data-product-id=/);

const partialOpenRules = renderGuestOpenRulesBay([mockProduct(1), mockProduct(2)]);
assert.equal((partialOpenRules.match(/data-mock-open-rule="true"/g) || []).length, 34);
assert.match(partialOpenRules, /data-library-position="1" data-magical-book class="bookshelf-book/);
assert.match(partialOpenRules, /data-library-position="2" data-magical-book class="bookshelf-book/);
assert.match(partialOpenRules, /data-library-position="3" data-magical-book data-mock-open-rule="true"/);

assert.equal((guest.match(/data-mock-open-rule="true"/g) || []).length, 36);
assert.doesNotMatch(guest.match(/<section class="shop-wall-bay shop-wall-bay--products guest-open-rules-bay"[\s\S]*?<\/section>/)?.[0] || "", /data-product-id=/);
assert.match(guestCss, /\.guest-landing-page \.guest-open-rules-mock-book/);
assert.match(guestCss, /--guest-library-book-width:\s*min\(clamp\(11px, 1\.35vw, 22px\), calc\(\(100% - 17px\) \/ 18\)\)/);
assert.match(guestCss, /--guest-bookstop-contact:\s*calc\(\(169\.166672px \* 203 \/ 1774\) \* 6\)/);
assert.match(guestCss, /padding:\s*0 0 0 var\(--guest-bookstop-contact\)/);
assert.match(guestCss, /@media \(max-width: 1023px\)[\s\S]*--guest-bookstop-contact:\s*calc\(\(98px \* 203 \/ 1774\) \* 6\)/);
assert.match(guestCss, /@media \(max-width: 699px\)[\s\S]*--guest-bookstop-contact:\s*calc\(\(84px \* 203 \/ 1774\) \* 6\)/);
assert.match(guestCss, /flex:\s*0 0 var\(--guest-library-book-width\)/);
assert.doesNotMatch(guestCss, /\.guest-open-rules-mock-book\s*\{[^}]*flex:\s*1 1/s);
assert.match(guestCss, /@media \(min-width: 1024px\)[\s\S]*--guest-library-book-width:\s*calc\(100% \/ 18\)/);
assert.match(guestCss, /@media \(min-width: 1024px\)[\s\S]*flex-direction:\s*row-reverse/);
assert.match(guestCss, /@media \(min-width: 1024px\)[\s\S]*gap:\s*0/);
assert.match(guestCss, /@media \(min-width: 1024px\)[\s\S]*guest-library-bay[\s\S]*padding-right:\s*calc\(\(169\.166672px \* 203 \/ 1774\) \* 6\)/);

const library = renderGuestLibraryBay();
assert.doesNotMatch(library, /data-fill-library|shop-wall-product-mock|bookshelf-book/);

console.log("TRG Stage 1 Guest Landing Page tests passed.");
