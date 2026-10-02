const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const page = read("store/index.html");
const homepage = read("index.html");
const css = read("styles.css");
const build = read("scripts/build-store.js");
const storefront = read("assets/js/storefront.js");
const sponsor = read("assets/js/sponsor-marquee.js");
const previewAds = JSON.parse(read("data/homepage-ad-preview.json"));
const logoPath = path.join(ROOT, "assets", "tobacco-road-games-logo.png");

const assertInOrder = (source, orderedNeedles, label) => {
  let cursor = -1;
  for (const needle of orderedNeedles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${label} missing expected item: ${needle}`);
    assert.ok(next > cursor, `${label} out of order near: ${needle}`);
    cursor = next;
  }
};

assert.match(page, /\/assets\/tobacco-road-games-logo\.png\?v=20260908-shelf-baseline5/);
assert.match(page, /<span class="brand__name">Tobacco Road Games<\/span>/);
assert.doesNotMatch(page, /brand__tag/);
assert.match(page, />Explore<\/a><a href="\/forum">Community Forum<\/a><a href="\/authors\.html">Creators<\/a><a href="\/creator\/">Creator Login \/ Sign Up<\/a><a href="\/ai-policy\.html">AI Policy<\/a><a href="\/support\.html">Support<\/a><a href="\/account\.html">Join \/ Sign In<\/a><a href="\/store\/cart\/">Cart/);
assert.doesNotMatch(page.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] || "", /Search games, Creators, or keywords|Marketplace|New This Week|Sales & Bundles|Physical Goods|About Tobacco Road Games/);
assert.doesNotMatch(page, />[^<]*\bTRG\b[^<]*</, "Customer-facing storefront copy must use the full Tobacco Road Games name.");
assert.equal(fs.existsSync(logoPath), true, "The supplied Tobacco Road Games logo must be included locally.");
const logo = fs.readFileSync(logoPath);
assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "Brand asset must be a valid PNG.");
assert.ok(logo.length < 100_000, "The header logo should remain lightweight.");

assert.match(build, /brandLogo: "\/assets\/tobacco-road-games-logo\.png"/);
assert.doesNotMatch(build, /brandTag: "Great games\. Open roads\."/);
assert.match(build, /AI Policy/);
assert.match(build, /Purchasing remains closed while this marketplace preview is prepared/);

assert.match(css, /Approved storefront mockup alignment/);
assert.match(css, /body:has\(\.shelf-storefront\) \.page-shell\{width:min\(1500px,100%\)/);
assert.match(css, /\.shelf-storefront\{position:relative;display:grid;gap:0/);
assert.match(css, /\.shelf-storefront>\[data-store-closed-notice\]\{display:block;min-height:0/);
assert.match(css, /\.shelf-storefront \.bookshelf-grid\{--shelf-contact-shift:23px;position:relative;isolation:isolate;display:flex;align-items:flex-end/);
assert.match(css, /min-height:calc\(var\(--book-height,296px\) - 68px\)/);
assert.match(css, /\.sponsor-marquee\{grid-template-columns:170px minmax\(0,1fr\)/);
assert.match(css, /\.shelf-storefront \.bookshelf-book__details\{top:2px/);
assert.match(css, /\.store-lower\{display:grid;grid-template-columns:minmax\(250px,\.72fr\)/);
assert.match(css, /@media\(max-width:900px\)/);
assert.match(css, /@media\(max-width:520px\)/);

assert.match(css, /Accepted storefront geometry lock/);
assert.match(css, /--shop-wall-header-height:\s*50px;/);
assert.match(css, /min-height:\s*var\(--shop-wall-header-height\);/);
assert.match(css, /--shop-wall-bric-row-height:\s*148px;/);
assert.match(css, /148px \+ 2px top border \+ 5px bottom border = 155px rendered Bric-a-Brac shelf/);
assert.match(css, /--shop-wall-bric-surface-height:\s*48px;/);
assert.match(css, /--shop-wall-bric-back-height:\s*100px;/);
assert.match(css, /--shop-wall-merch-bay-height:\s*378px;/);
assert.match(css, /--shop-wall-merch-product-space:\s*320px;/);
assert.match(css, /--shop-wall-merch-shelf-construction:\s*52px;/);
assert.match(css, /--shop-wall-merch-shelf-top:\s*30px;/);
assert.match(css, /--shop-wall-merch-shelf-fascia:\s*18px;/);
assert.match(css, /--shop-wall-fixture-height:\s*120px;/);
assert.match(css, /--shop-wall-recessed-light-width:\s*14px;/);
assert.match(css, /--shop-wall-recessed-light-height:\s*8px;/);
assert.match(css, /\.shop-wall-row--merchandising \.shop-wall-bay\s*\{[\s\S]*min-height:\s*var\(--shop-wall-merch-bay-height\);/);
assert.match(css, /\.shop-wall-row--merchandising \.shop-wall-shelf-level\s*\{[\s\S]*min-height:\s*var\(--shop-wall-merch-product-space\);/);
assert.match(css, /\.shop-wall-row--merchandising \.shop-wall-shelf-level::after\s*\{[\s\S]*height:\s*var\(--shop-wall-merch-shelf-construction\);/);
assert.match(css, /\.shelf-storefront \.shop-wall-books\s*\{[\s\S]*justify-content:\s*center;[\s\S]*background:\s*transparent;[\s\S]*overflow:\s*visible;/);
assert.match(css, /\.shelf-storefront \.shop-wall-books::before,[\s\S]*\.shelf-storefront \.shop-wall-books::after\s*\{[\s\S]*content:\s*none;/);
assert.match(css, /\.shop-wall-product-mock\s*\{[\s\S]*z-index:\s*5;[\s\S]*filter:\s*drop-shadow/);
assert.match(css, /\.shop-wall-product-mock--spine\s*\{[\s\S]*--mock-product-width:\s*calc\(var\(--mock-product-height\) \* 203 \/ 1774\);/);
assert.match(homepage, /\/assets\/products\/spriggans\/spine\.png/);
const openRulesBay = homepage.match(/<section[^>]*aria-labelledby="open-rules-library-heading"[\s\S]*?<\/section>/)?.[0] || "";
assert.doesNotMatch(openRulesBay, /shop-wall-view-link|View All/, "Open Rules Library must not contain the View All sign or link.");
assert.doesNotMatch(build, /title: "OPEN RULES LIBRARY"[^\n]*viewAllHref/, "The homepage generator must not restore the Open Rules Library View All link.");
const yourLibraryBay = homepage.match(/<section[^>]*aria-labelledby="your-library-heading"[\s\S]*?<\/section>/)?.[0] || "";
assert.doesNotMatch(yourLibraryBay, /shop-wall-sign|Sign in to see your library|Join \/ Sign In|href="\/account\.html"/, "Your Library shelves must not contain the sign-in sign.");
const generatedLibraryBay = build.match(/function renderHomepageLibraryBay\(\)[\s\S]*?function renderHomepageIdentityBay/)?.[0] || "";
assert.doesNotMatch(generatedLibraryBay, /shop-wall-sign|Sign in to see your library|Join \/ Sign In|href="\/account\.html"/, "The homepage generator must not restore the library sign-in sign.");
assert.equal((yourLibraryBay.match(/class="shop-wall-product-row shop-wall-product-row--library shop-wall-product-row--right"/g) || []).length, 2, "Each Your Library shelf must retain its right-side bookstop.");
assert.match(css, /\.shop-wall-product-row--right\s*\{[^}]*justify-content:\s*flex-end;/);
assert.equal((openRulesBay.match(/class="shop-wall-product-row shop-wall-product-row--library"/g) || []).length, 2, "Each Open Rules Library shelf must retain its left-side bookstop.");
assert.equal((yourLibraryBay.match(/data-fill-library/g) || []).length, 2, "Both Your Library shelves must fill the space opposite their bookstops.");
assert.equal((openRulesBay.match(/data-fill-library/g) || []).length, 2, "Both Open Rules Library shelves must fill the space opposite their bookstops.");
assert.equal((homepage.match(/data-book-count="50"/g) || []).length, 4, "The four full-width shelves must retain their fixed 50-book rows.");
assert.doesNotMatch(openRulesBay, /data-overhang-spine/, "Library books must not use the full-width frame positioning.");
assert.match(css, /\.shop-wall-product-row--library\s*\{[^}]*left:\s*0;[^}]*right:\s*0;/);
assert.match(css, /\.shop-wall-library-books\s*\{[^}]*left:\s*var\(--library-bookstop-clearance, 0px\);[^}]*right:\s*0;/);
assert.match(css, /\.shop-wall-product-row--right > \.shop-wall-library-books\s*\{[^}]*left:\s*0;[^}]*right:\s*var\(--library-bookstop-clearance, 0px\);/);
assert.match(storefront, /new ResizeObserver\(refresh\)\.observe\(row\)/);
assert.match(css, /\.shop-wall-shelf-level > \.shop-wall-product-row--library::before,\s*\.shop-wall-shelf-level > \.shop-wall-product-row--library::after\s*\{[^}]*height:\s*50%;[^}]*aspect-ratio:\s*406 \/ 1774;/);
assert.match(css, /\.shop-wall-shelf-level > \.shop-wall-product-row--library:not\(\.shop-wall-product-row--right\)::after,\s*\.shop-wall-shelf-level > \.shop-wall-product-row--library\.shop-wall-product-row--right::before\s*\{[^}]*content:\s*"";/);
assert.match(css, /\.shop-wall-shelf-level > \.shop-wall-product-row--library:not\(\.shop-wall-product-row--right\)::after\s*\{[^}]*transform:\s*translateX\(500%\);/);
assert.match(css, /\.shop-wall-shelf-level > \.shop-wall-product-row--library\.shop-wall-product-row--right::before\s*\{[^}]*transform:\s*translateX\(-500%\);/);
assert.match(css, /#8f5429 0 var\(--shop-wall-merch-shelf-top\)/);
assert.match(css, /\.shop-wall-row--bric-a-brac\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*min-height:\s*var\(--shop-wall-bric-row-height\);/);
assert.match(css, /\.shop-wall-bric-shelf\s*\{[\s\S]*width:\s*100%;[\s\S]*min-height:\s*var\(--shop-wall-bric-row-height\);/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac::before\s*\{[\s\S]*inset:\s*0 0 var\(--shop-wall-bric-surface-height\);/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface\s*\{[\s\S]*radial-gradient\(ellipse 8% 34% at 16\.666% 24%/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface\s*\{[\s\S]*radial-gradient\(ellipse 8% 34% at 50% 24%/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface\s*\{[\s\S]*radial-gradient\(ellipse 8% 34% at 83\.333% 24%/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface::before,[\s\S]*\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf::after\s*\{[\s\S]*top:\s*46px;[\s\S]*width:\s*var\(--shop-wall-recessed-light-width\);[\s\S]*height:\s*var\(--shop-wall-recessed-light-height\);/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface::before\s*\{[\s\S]*left:\s*16\.666%;/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf::after\s*\{[\s\S]*top:\s*calc\(var\(--shop-wall-bric-row-height\) - var\(--shop-wall-bric-surface-height\) \+ 46px\);[\s\S]*left:\s*50%;/);
assert.match(css, /\.shop-wall-row--identity \+ \.shop-wall-row--bric-a-brac \.shop-wall-bric-shelf__surface::after\s*\{[\s\S]*left:\s*83\.333%;/);
assert.match(css, /\.homepage-shop-wall > \.storefront-ad-marquee,\s*\.homepage-shop-wall > \.storefront-news-chiron\s*\{[\s\S]*width:\s*100%;/);
assert.match(css, /\.storefront-ad-marquee,\s*\.storefront-news-chiron\s*\{[\s\S]*height:\s*var\(--shop-wall-fixture-height\);/);
const adMarquee = homepage.match(/<aside class="storefront-ad-marquee"[\s\S]*?<\/aside>/)?.[0] || "";
assert.equal(previewAds.length, 3, "The marquee must contain three advertisement records.");
const adGroups = [...adMarquee.matchAll(/<div class="storefront-ad-marquee__group"([^>]*)>([\s\S]*?)(?=<div class="storefront-ad-marquee__group"|<\/aside>)/g)];
assert.equal(adGroups.length, 2, "The leftward loop needs two identical ad groups.");
for (const group of adGroups) assert.equal((group[2].match(/<article class="storefront-ad /g) || []).length, 3, "Each group must retain three equal-width ads.");
assert.match(adGroups[1][1], /aria-hidden="true"/, "Repeated ads must be hidden from assistive technology.");
const groupArticles = adGroups.map(group => [...group[2].matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match => match[0].replaceAll("-repeat-title", "-title")));
assert.deepEqual(groupArticles[1], groupArticles[0], "Both ad groups must match exactly for a seamless loop.");
const adTitleIds = [...adMarquee.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(adTitleIds).size, adTitleIds.length, "Repeated ads must not duplicate title IDs.");
assert.equal(new Set(previewAds.map(ad => ad.theme)).size, 3, "Preview ads must have distinct art directions.");
assert.doesNotMatch(adMarquee, /<a\b|<button\b|<script\b|tabindex=|onclick=|data-carousel/, "The scrolling display must not introduce controls or links.");
for (const ad of previewAds) {
  assert.ok(adMarquee.includes(ad.advertiser), `Missing advertisement publisher: ${ad.advertiser}`);
  assert.ok(adMarquee.includes(ad.title), `Missing advertisement title: ${ad.title}`);
  for (const copy of ad.supportingCopy) assert.ok(adMarquee.includes(copy), `Missing advertisement supporting copy: ${copy}`);
  const asset = ad.artwork || ad.logo;
  assert.ok(adMarquee.includes(asset), `Missing advertisement artwork: ${asset}`);
  assert.ok(fs.existsSync(path.join(ROOT, asset)), `Advertisement asset must exist locally: ${asset}`);
}
assert.match(css, /\.storefront-ad-marquee__group\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*flex:\s*0 0 100%;[^}]*height:\s*100%;/);
assert.match(css, /\.storefront-ad-marquee__track\s*\{[^}]*animation:\s*storefront-ads-left 60s linear infinite;/);
assert.match(css, /to\s*\{\s*transform:\s*translateX\(calc\(-100% - var\(--storefront-ad-gap\)\)\);/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.storefront-ad-marquee__track\s*\{\s*animation:\s*none;/);
assert.match(build, /ads\.map\(ad => renderHomepageAdItem\(ad, repeat \? "-repeat" : ""\)\)/);
assert.match(build, /renderGroup\(true\)/);
assert.match(css, /\.shop-wall-row--identity::after\s*\{[\s\S]*radial-gradient\(ellipse 9% 78% at 16\.666% 0%/);
assert.match(css, /\.shop-wall-row--identity::after\s*\{[\s\S]*radial-gradient\(ellipse 9% 78% at 50% 0%/);
assert.match(css, /\.shop-wall-row--identity::after\s*\{[\s\S]*radial-gradient\(ellipse 9% 78% at 83\.333% 0%/);
assert.match(css, /rgba\(255, 232, 163, 0\.58\) 0%, rgba\(247, 174, 74, 0\.32\) 34%/);
assert.match(css, /\.shop-wall-row--identity > \.shop-wall-bay::before\s*\{[\s\S]*top:\s*-6px;[\s\S]*bottom:\s*22px;[\s\S]*radial-gradient\(ellipse 8% 6% at 50% 0%, rgba\(255, 244, 201, 0\.96\)/);
assert.match(css, /\.shop-wall-row--identity > \.shop-wall-bay::before\s*\{[\s\S]*radial-gradient\(ellipse 18% 19% at 50% 11%/);
assert.match(css, /\.shop-wall-row--identity > \.shop-wall-bay::before\s*\{[\s\S]*radial-gradient\(ellipse 37% 76% at 50% 44%/);
assert.match(css, /\.shop-wall-row--identity > \.shop-wall-bay::after\s*\{[\s\S]*top:\s*-12px;[\s\S]*width:\s*var\(--shop-wall-recessed-light-width\);[\s\S]*height:\s*var\(--shop-wall-recessed-light-height\);/);

assertInOrder(homepage, [
  'class="shop-wall-row shop-wall-row--identity"',
  'aria-label="Bric-a-Brac display shelf"',
  'class="storefront-ad-marquee"',
  'FEATURED CREATOR',
  'NEW THIS WEEK',
  'aria-label="Bric-a-Brac display shelf"',
  'BEST SELLERS',
  'class="shop-wall-product-mock shop-wall-product-mock--spine"',
  'FREE &amp; PWYW',
  'class="storefront-news-chiron"'
], "Homepage storefront sequence");

assertInOrder(build, [
  'renderHomepageLibraryBay()',
  'renderHomepageIdentityBay()',
  'renderHomepageBricABracShelf()',
  'renderHomepageAdMarquee()',
  'FEATURED CREATOR',
  'NEW THIS WEEK',
  'renderHomepageBricABracShelf()',
  'BEST SELLERS',
  'productMock',
  'FREE & PWYW',
  'storefront-news-chiron'
], "Generated storefront sequence");

assert.match(storefront, /openExamination/);
assert.match(storefront, /--examination-x/);
assert.match(storefront, /pointer: coarse/);
assert.match(storefront, /event\.preventDefault\(\)/);
assert.match(sponsor, /prefers-reduced-motion/);
assert.match(sponsor, /mouseenter/);
assert.match(sponsor, /focusin/);

const requiredSections = [
  "shop-window",
  "browse-by-path",
  "sponsor-marquee-band",
  "new-this-week-heading",
  "best-sellers",
  "open-rules-shelf-heading",
  "pwyw-free-shelf-heading",
  "product-lines",
  "creator-feature",
  "find-the-right-game",
  "back-room",
  "lower-shop"
];
for (const id of requiredSections) assert.match(page, new RegExp(`id="${id}"`), `Missing required storefront section: ${id}`);
assert.doesNotMatch(page, /New Arrivals/);
assert.match(page, /No eligible new releases are on the public shelf yet/);

console.log("Tobacco Road Games storefront mockup-alignment tests passed.");
