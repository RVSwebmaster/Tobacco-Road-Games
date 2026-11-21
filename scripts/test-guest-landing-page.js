const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isOpenRulesProduct, renderGuestLibraryBay, renderGuestOpenRulesBay, renderCustomerLandingPage } = require("./build-store.js");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const homepage = read("index.html");
const guest = read("guest/index.html");
const customer = read("customer.html");
const guestCss = read("assets/css/guest-landing.css");
const guestMagic = read("assets/js/magical-bookshelf.js");
const builder = read("scripts/build-store.js");
const outputBuilder = read("scripts/build-pages-output.mjs");

const nav = guest.match(/<nav class="site-nav" aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] || "";
const navLabels = [...nav.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((match) => match[1].replace(/<span[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
assert.deepEqual(navLabels, ["Explore", "Support", "Login/Signup", "Cart"]);
assert.notEqual(customer, guest, "Customer adds authenticated navigation and library wiring to the shared Guest source.");
assert.equal(customer, renderCustomerLandingPage(guest), "Customer output must be generated from the approved Guest source.");
assert.match(customer, /data-customer-storefront/);
assert.match(customer, /data-progressive-navigation/);
assert.match(customer, /data-homepage-library/);
assert.match(customer, /progressive-navigation\.js/);
assert.doesNotMatch(customer, /href="\/account\.html">Login\/Signup/);
const openRulesSection = (page) => page.match(/<section class="shop-wall-bay shop-wall-bay--products guest-open-rules-bay"[\s\S]*?<\/section>/)?.[0] || "";
assert.equal(openRulesSection(customer), openRulesSection(guest), "Customer keeps the same Open Rules shelf markup as Guest.");
const merchandisingSection = (page) => {
  const start = page.indexOf('<section class="shop-wall-row shop-wall-row--merchandising"');
  const end = page.indexOf("</main>", start);
  return start >= 0 && end >= 0 ? page.slice(start, end) : "";
};
assert.equal(merchandisingSection(customer), merchandisingSection(guest), "Customer-specific hooks leave lower merchandising unchanged.");
assert.match(nav, /href="\/store\/catalog\/"[^>]*>Explore<\/a>/);
assert.match(nav, /href="\/support\.html"[^>]*>Support<\/a>/);
assert.match(nav, /href="\/account\.html"[^>]*>Login\/Signup<\/a>/);
assert.match(nav, /href="\/store\/cart\/"[^>]*>Cart <span class="cart-count-badge" data-cart-count>0<\/span><\/a>/);

assert.match(guest, /data-guest-landing/);
assert.doesNotMatch(guest, /data-progressive-navigation|data-homepage-library|\/assets\/js\/progressive-navigation\.js/);
assert.match(guest, /data-magical-bookshelf-demo/);
assert.match(guest, /\/assets\/js\/magical-bookshelf\.js/);
assert.equal((guest.match(/data-magical-bookshelf(?:\s|>)/g) || []).length, 7);
assert.equal((guest.match(/data-magical-book(?:\s|>)/g) || []).length, 0,
  "Guest begins with empty Open Rules rows; the shelf API supplies eligible books at runtime.");
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
assert.match(builder, /function renderGuestOpenRulesBay\(\)\s*\{\s*return renderRoleOpenRulesBay\("guest"\)/);
assert.match(builder, /const renderShelf = \(startPosition, shelfOrder\)/);
assert.match(builder, /data-library-start-position="\$\{startPosition\}"/);
assert.equal(isOpenRulesProduct({ publisher: "Tobacco Road Games", authorSlugs: ["rv-sawyer"] }), false, "TRG publication or RV Sawyer authorship alone must not classify a product as Open Rules.");
assert.equal(isOpenRulesProduct({ openRulesEligible: true, publisher: "Tobacco Road Games", authorSlugs: ["rv-sawyer"] }), true, "Explicit Open Rules eligibility should classify the product.");
assert.equal(isOpenRulesProduct({ openRulesEligible: false }), false, "Explicit false must stay out of Open Rules.");
assert.doesNotMatch(builder, /tobacco road games\/i\.test\(product\.publisher[\s\S]{0,120}rv-sawyer/, "Open Rules selectors must not infer eligibility from publisher or author.");

assert.doesNotMatch(guest, /id="free-pwyw-wall-heading"|aria-label="FREE &amp; PWYW shelf"/);
assert.match(guest, /href="\/store\/catalog\/"/);
assert.match(guest, /class="storefront-news-chiron"/);
const normalizeMarkup = (markup) => markup?.replace(/\r\n/g, "\n");
assert.equal(normalizeMarkup(guest.match(/<aside class="storefront-news-chiron"[\s\S]*?<\/aside>/)?.[0]), normalizeMarkup(homepage.match(/<aside class="storefront-news-chiron"[\s\S]*?<\/aside>/)?.[0]));

const cabinetPicture = (document) => document.match(/<picture class="shop-wall-cabinet-art"[\s\S]*?<\/picture>/)?.[0];
assert.equal(normalizeMarkup(cabinetPicture(guest)), normalizeMarkup(cabinetPicture(homepage)));
assert.match(guest, /\/assets\/js\/cart\.js/);
assert.match(guest, /\/assets\/js\/storefront\.js/);
assert.match(guest, /\/assets\/js\/news-chyron\.js/);
assert.match(guest, /\/assets\/js\/shelf-curios\.js/);
assert.match(guest, /\/assets\/js\/magical-bookshelf\.js\?v=20261116-open-rules-master-shelf2/);
assert.match(guest, /\/assets\/css\/guest-landing\.css\?v=20261116-guest-examination-close1/);
assert.match(guest, /\/assets\/js\/guest-product-preview\.js\?v=20261116-guest-book-examination7/);
assert.match(builder, /GUEST_FEATURE_CACHE_BUST = "20261116-open-rules-master-shelf2"/);
assert.match(builder, /GUEST_EXAMINATION_CACHE_BUST = "20261116-guest-book-examination7"/);
assert.match(builder, /guest-product-preview\.js\?v=\$\{GUEST_EXAMINATION_CACHE_BUST\}/);

assert.doesNotMatch(homepage, /data-guest-landing|guest-library-sign/);
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

const openRules = renderGuestOpenRulesBay();
assert.equal((openRules.match(/guest-open-rules-books/g) || []).length, 2);
assert.doesNotMatch(openRules, /data-magical-book(?:\s|>)|data-mock-open-rule|href=|data-product-id=/,
  "Open Rules books are hydrated from the shelf API, not generated as placeholder products.");
assert.equal((guest.match(/data-mock-open-rule="true"/g) || []).length, 0);
assert.equal((customer.match(/data-mock-open-rule="true"/g) || []).length, 0);
assert.equal((guest.match(/class="bookshelf-grid shop-wall-books guest-open-rules-books"[^>]*><\/div>/g) || []).length, 2,
  "Guest starts with two empty Open Rules shelf rows.");
assert.equal((customer.match(/class="bookshelf-grid shop-wall-books guest-open-rules-books"[^>]*><\/div>/g) || []).length, 2,
  "Customer starts with the same two empty Open Rules shelf rows.");
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
