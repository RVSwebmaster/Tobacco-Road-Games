const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const page = read("store/index.html");
const homepage = read("index.html");
const css = read("styles.css");
const build = read("scripts/build-store.js");
const storefront = read("assets/js/storefront.js");
const sponsor = read("assets/js/sponsor-marquee.js");
const previewAds = JSON.parse(read("data/homepage-ad-preview.json"));
const previewBB1Ads = JSON.parse(read("data/bb1-creator-ad-preview.json"));
const previewHeadlines = JSON.parse(read("data/homepage-news-preview.json"));
const newsScript = read("assets/js/news-chyron.js");
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
const dressingAssets = [
  "scuppernong-vine.png",
  "duke-blue-devil-bobblehead.png",
  "kudzu-vine.png",
  "hurricane-lantern-unlit.png"
];
const dressingTags = source => source.match(/<img class="shop-wall-top-dressing [^>]+>/g) || [];
assert.equal(dressingTags(homepage).length, 5, "Only the four approved top-shelf dressing assets plus the kudzu tail layer may be added.");
assert.equal((openRulesBay.match(/shop-wall-top-dressing--kudzu-trail/g) || []).length, 1, "The kudzu tail layer must remain in the Open Rules Library bay.");
for (const [index, name] of dressingAssets.entries()) {
  const bay = index < 2 ? yourLibraryBay : openRulesBay;
  assert.ok(bay.includes(`/assets/images/storefront-shelf-dressing/${name}`), `${name} must stay in its approved library bay.`);
  const asset = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing", name));
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} must be a local PNG.`);
}
const dressingContext = vm.createContext({ escapeAttribute: value => String(value), escapeHtml: value => String(value) });
vm.runInContext(build.slice(build.indexOf("function renderHomepageShelfFixtures()"), build.indexOf("function renderAiPolicyPage()")), dressingContext);
const regeneratedLeftBay = vm.runInContext("renderHomepageLibraryBay()", dressingContext);
const regeneratedRightBay = vm.runInContext('renderHomepageProductBay({title: "OPEN RULES LIBRARY", id: "open-rules-library-heading", products: []})', dressingContext);
assert.deepEqual(dressingTags(regeneratedLeftBay), dressingTags(yourLibraryBay), "Homepage builds must preserve the exact approved left-side dressing.");
assert.deepEqual(dressingTags(regeneratedRightBay), dressingTags(openRulesBay), "Homepage builds must preserve the exact approved right-side dressing.");
assert.match(css, /\.shop-wall-top-dressing\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;[^}]*animation:\s*none;[^}]*transition:\s*none;/);
assert.doesNotMatch(css, /\.shop-wall-top-dressing[^{}]*:hover/, "This dressing pass must not add hover effects.");
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
const newsChyron = homepage.match(/<aside class="storefront-news-chiron"[\s\S]*?<\/aside>/)?.[0] || "";
assert.equal(previewHeadlines.length, 6, "The news preview must contain six short fictional headlines.");
assert.match(newsChyron, /fictional test headlines/);
assert.match(newsChyron, /TEST BULLETINS/);
const flagHeaderArtwork = fs.readFileSync(path.join(ROOT, "assets", "images", "news", "american-flag-header.png"));
assert.deepEqual([...flagHeaderArtwork.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "The news header must include its American flag artwork locally.");
assert.match(css, /\.storefront-news-chiron__bug\s*\{[^}]*url\("\/assets\/images\/news\/american-flag-header\.png"\) center \/ cover no-repeat;/);
const newsSequences = [...newsChyron.matchAll(/<ul class="storefront-news-chiron__sequence"([^>]*)>([\s\S]*?)<\/ul>/g)];
assert.equal(newsSequences.length, 2, "The ticker must contain two identical sequences for its seamless loop.");
assert.match(newsSequences[0][1], /data-news-sequence/);
assert.match(newsSequences[1][1], /aria-hidden="true"/, "Repeated headlines must not be announced twice.");
assert.equal(newsSequences[1][2], newsSequences[0][2], "Both sequences must match exactly at the loop boundary.");
assert.equal((newsSequences[0][2].match(/<li /g) || []).length, previewHeadlines.length);
for (const item of previewHeadlines) {
  assert.ok(item.headline.length <= 65, "Test headlines must remain short.");
  assert.ok(newsSequences[0][2].includes(item.label));
  assert.ok(newsSequences[0][2].includes(item.headline));
}
assert.doesNotMatch(newsChyron, /<a\b|<article\b|<button\b/, "Fake headlines must not imply real articles or introduce controls.");
assert.match(homepage, /news-chyron\.js\?v=20261001-news-chyron1/);
assert.match(css, /\.storefront-news-chiron__display\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/);
assert.match(css, /\.storefront-news-chiron__viewport\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/);
assert.match(css, /animation:\s*storefront-news-right var\(--news-duration\) linear infinite;/);
assert.match(css, /@keyframes storefront-news-right\s*\{\s*from\s*\{\s*transform:\s*translateX\(-50%\);\s*}\s*to\s*\{\s*transform:\s*translateX\(0\);/);
assert.match(css, /\.storefront-news-chiron__headline\s*\{[^}]*font:\s*600 20px\/1\.25/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.storefront-news-chiron\[data-news-ready\] \.storefront-news-chiron__track\s*\{\s*animation:\s*none;\s*transform:\s*none;/);
assert.match(css, /\.storefront-news-chiron__sequence\[aria-hidden="true"\]\s*\{\s*display:\s*none;/);
assert.match(css, /overflow-x:\s*hidden;\s*overflow-y:\s*auto;/);

const newsRenderer = build.match(/function renderHomepageNewsChyron\([\s\S]*?\n}\r?\n\r?\n(?=function renderHomepageAdMarquee)/)?.[0];
const htmlEscaper = build.match(/function escapeHtml\(value\)\s*\{[\s\S]*?\n}/)?.[0];
assert.ok(newsRenderer && htmlEscaper, "The homepage generator must preserve the reusable news renderer.");
const newsRenderContext = { HOMEPAGE_NEWS_PREVIEW: previewHeadlines };
vm.runInNewContext(`${htmlEscaper}\n${newsRenderer}\nresult = renderHomepageNewsChyron();`, newsRenderContext);
assert.equal(newsRenderContext.result.replaceAll("\r\n", "\n"), newsChyron.replaceAll("\r\n", "\n"), "The generator and live homepage must render the same news stream.");

let measuredNewsWidth = 2400;
let onNewsResize;
const newsSequence = { getBoundingClientRect: () => ({ width: measuredNewsWidth }) };
const newsRoot = { dataset: {}, style: { setProperty: (name, value) => { newsRoot.duration = value; } }, querySelector: () => newsSequence };
vm.runInNewContext(newsScript, {
  document: { querySelectorAll: () => [newsRoot, { querySelector: () => null }] },
  ResizeObserver: class { constructor(callback) { onNewsResize = callback; } observe(element) { assert.equal(element, newsSequence); } }
});
assert.equal(newsRoot.duration, "100s", "Ticker duration must maintain 24 pixels per second.");
assert.equal(newsRoot.dataset.newsReady, "true");
measuredNewsWidth = 1200;
onNewsResize();
assert.equal(newsRoot.duration, "50s", "Responsive resizing must preserve the ticker's travel speed.");
measuredNewsWidth = 0;
onNewsResize();
assert.equal(newsRoot.duration, "50s", "An unmeasurable stream must not start an invalid animation.");
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
  'renderHomepageBricABracShelf({ sumo: true })',
  'renderHomepageAdMarquee()',
  'FEATURED CREATOR',
  'NEW THIS WEEK',
  'renderHomepageBricABracShelf()',
  'BEST SELLERS',
  'productMock',
  'FREE & PWYW',
  'storefront-news-chiron'
], "Generated storefront sequence");

const bricShelves = [...homepage.matchAll(/<section class="shop-wall-row shop-wall-row--bric-a-brac"[\s\S]*?<\/section>/g)].map(match => match[0]);
const sumoTags = source => source.match(/<img class="shop-wall-bric-shelf__sumo"[^>]+>/g) || [];
assert.equal(bricShelves.length, 2);
assert.equal(sumoTags(bricShelves[0]).length, 1, "The supplied sumo figure must appear on the first Bric-a-Brac shelf.");
assert.equal(sumoTags(bricShelves[1]).length, 0, "The second Bric-a-Brac shelf must remain unchanged.");
const bricRenderer = build.match(/function renderHomepageBricABracShelf\([\s\S]*?\n}\r?\n/)?.[0];
assert.ok(bricRenderer);
const bricContext = { HOMEPAGE_BB1_AD_PREVIEW: previewBB1Ads };
vm.runInNewContext(`${htmlEscaper}\nconst escapeAttribute = escapeHtml;\n${bricRenderer}\nfirst = renderHomepageBricABracShelf({ sumo: true });\nsecond = renderHomepageBricABracShelf();`, bricContext);
assert.deepEqual(sumoTags(bricContext.first), sumoTags(bricShelves[0]), "The build must preserve the first shelf's sumo figure.");
assert.equal(sumoTags(bricContext.second).length, 0, "The build must not add the figure to other shelves.");
const bb1Posters = source => (source.match(/<article class="bb1-poster [^>]+>[\s\S]*?<\/article>/g) || []).map(poster => poster.replaceAll("\r\n", "\n"));
assert.equal(previewBB1Ads.length, 3, "BB-1 must have exactly three current faux creator ads.");
assert.equal(new Set(previewBB1Ads.map(ad => ad.theme)).size, 3, "The BB-1 publishers must retain distinct poster designs.");
assert.equal(bb1Posters(bricShelves[0]).length, 3, "The first Bric-a-Brac wall must display all three static posters.");
assert.equal(bb1Posters(bricShelves[1]).length, 0, "BB-1 dressing must not spill onto the second Bric-a-Brac shelf.");
assert.deepEqual(bb1Posters(bricContext.first), bb1Posters(bricShelves[0]), "The build must preserve the exact BB-1 poster artwork and copy.");
assert.equal(bb1Posters(bricContext.second).length, 0, "The build must not add posters to other shelves.");
for (const [index, ad] of previewBB1Ads.entries()) {
  const poster = bb1Posters(bricShelves[0])[index];
  for (const field of ["creator", "title", "tagline", "secondaryCopy", "callout"]) assert.ok(poster.includes(ad[field].replaceAll("&", "&amp;")), `BB-1 must preserve ${ad.id} ${field} verbatim.`);
  assert.ok(poster.includes(ad.artwork));
  assert.ok(fs.existsSync(path.join(ROOT, ad.artwork)), `Missing BB-1 artwork: ${ad.artwork}`);
}
assert.ok(fs.existsSync(path.join(ROOT, "assets/images/bb1/posting-wall-history.png")), "The BB-1 posting history texture must exist locally.");
assert.doesNotMatch(bricShelves[0], /data-carousel|data-rotation|<a\b|<button\b/, "These faux BB-1 posters must not introduce rotation, controls, or pretend purchase links.");
assert.match(css, /\.bb1-poster\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*animation:\s*none;[^}]*transition:\s*none;/);
const sumoAsset = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing/sumo-funko-pop.png"));
assert.deepEqual([...sumoAsset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "The supplied figure must remain a local PNG.");

assert.doesNotMatch(css, /@media\s*\(max-width:\s*1399px\)\s*\{\s*\.shop-wall-bamboo-incense\s*\{[^}]*height:\s*auto/, "Normal desktop windows must retain the bamboo's approved tall reach.");
assert.match(css, /@media\s*\(max-width:\s*1199px\)\s*\{\s*\.shop-wall-bamboo-incense\s*\{[^}]*height:\s*auto/, "Constrained layouts must preserve their existing bamboo sizing.");

// RV approved this composition at 60929bc; baseline changes require RV approval.
const approvedDressingHash = value => createHash("sha256").update(value).digest("hex");
const normalizeDressing = value => value.replace(/\s+/g, " ").trim();
const bambooAsset = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing/bamboo-incense-planter-niche.png"));
assert.equal(approvedDressingHash(bambooAsset), "99a6f293ec96b4e18ec9cf786e49abe29fa2243afac8a485a53991788740ec82", "RV-approved bamboo artwork changed; RV approval is required before updating this baseline.");
const dressingCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
const bambooRules = (dressingCss.match(/[^{}]+\{[^{}]*\}/g) || [])
  .filter(rule => rule.slice(0, rule.indexOf("{")).includes(".shop-wall-bamboo-incense"));
const bambooSmoke = dressingCss.match(/@keyframes shop-wall-incense-smoke\s*\{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(bambooSmoke, "The approved incense smoke animation must remain present.");
assert.equal(approvedDressingHash([...bambooRules, bambooSmoke].map(normalizeDressing).join("\n")), "30a7a9db7a6323db4fab0d8b67a8f87ff8e31358ad81a330d335b396f1261885", "RV-approved bamboo placement, shape, or incense styles changed; RV approval is required before updating this baseline.");
const bambooResponsiveRules = [...dressingCss.matchAll(/@media\s*\(max-width:\s*\d+px\)\s*\{\s*\.shop-wall-bamboo-incense\s*\{[^}]*\}/g)]
  .map(match => normalizeDressing(match[0]));
assert.equal(approvedDressingHash(bambooResponsiveRules.join("\n")), "997a6179779c272402850fd5e74eb8c1c7cf09106c1cf7184e8669afac731c7b", "RV-approved bamboo responsive sizing changed; RV approval is required before updating this baseline.");

// RV also locked the unchanged dogwood composition at 42f8c3d.
const dogwoodAsset = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing/white-flowering-dogwood-bonsai-sign-height.png"));
assert.equal(approvedDressingHash(dogwoodAsset), "ed392cbe4e4b3a12f581109752b5b20f4c8ef2b017cb02db8731dcb9dfffa9f2", "RV-approved dogwood artwork changed; RV approval is required before updating this baseline.");
const dogwoodRules = (dressingCss.match(/[^{}]+\{[^{}]*\}/g) || [])
  .filter(rule => rule.slice(0, rule.indexOf("{")).includes(".shop-wall-dogwood-bonsai"));
assert.equal(approvedDressingHash(dogwoodRules.map(normalizeDressing).join("\n")), "090e5e59a8d9b08777b367ef621e7bde586ae4a05e174497c59ca75161c33d0c", "RV-approved dogwood placement, shape, or sizing changed; RV approval is required before updating this baseline.");
const dogwoodResponsiveRules = [...dressingCss.matchAll(/@media\s*\(max-width:\s*\d+px\)\s*\{\s*\.shop-wall-bamboo-incense\s*\{[^}]*\}\s*(\.shop-wall-dogwood-bonsai\s*\{[^}]*\})/g)]
  .map(match => normalizeDressing(`${match[0].slice(0, match[0].indexOf("{") + 1)} ${match[1]}`));
assert.equal(approvedDressingHash(dogwoodResponsiveRules.join("\n")), "2ecd920d1f05deb708a0f6765f9eb4722700ba341e2d05713f6a2cf055d3d3d6", "RV-approved dogwood responsive sizing changed; RV approval is required before updating this baseline.");
assert.equal((homepage.match(/class="shop-wall-dogwood-bonsai"/g) || []).length, 1, "The approved dogwood must appear only once on the homepage.");
const dogwoodTag = source => source.match(/<img class="shop-wall-dogwood-bonsai"[^>]*>/)?.[0];
const bambooFigure = source => source.match(/<figure class="shop-wall-bamboo-incense"[^>]*>[\s\S]*?<\/figure>/)?.[0];
const featuredCreatorBay = homepage.match(/<section[^>]*aria-labelledby="featured-creator-wall-heading"[\s\S]*?<\/section>/)?.[0] || "";
const regeneratedFeaturedCreatorBay = vm.runInContext('renderHomepageProductBay({ title: "FEATURED CREATOR", id: "featured-creator-wall-heading", products: [], singleShelf: true, bambooIncense: true })', dressingContext);
for (const [label, source] of [["homepage", featuredCreatorBay], ["homepage generator", regeneratedFeaturedCreatorBay]]) {
  const figure = bambooFigure(source);
  assert.ok(figure, `The ${label} must keep bamboo in its approved Featured Creator niche.`);
  assert.equal(approvedDressingHash(normalizeDressing(figure)), "cea41fc064e7c22884a32ae81cbda531c566b520030f1cb58b92cbbed87dbd2b", `RV-approved bamboo or incense markup changed in the ${label}; RV approval is required before updating this baseline.`);
  const dogwood = dogwoodTag(source);
  assert.ok(dogwood, `The ${label} must keep dogwood in its approved Featured Creator niche.`);
  assert.equal(approvedDressingHash(normalizeDressing(dogwood)), "6b8a79e6c3406e7b762624eb01d51c32c594da949c4755457dfade4c7feebc34", `RV-approved dogwood markup changed in the ${label}; RV approval is required before updating this baseline.`);
}

// RV locked both upper-library vines at 8b3f7fd; preserve their accepted pruning and layering.
const approvedVines = [
  {
    name: "scuppernong",
    asset: "fabce33314f79050d43914c6cb12bc85665852fccb3f1a09647da9d3ad3b5fd1",
    styles: "08dab55817522d2b2a9f310c6ab16611a0c22a1769c14530e9cb8b1cce2fe989",
    responsive: "e5cfff69b9dfa9fdea0b8ac389204f7c78c528fc23d999c15eef31a36695c2a3",
    markup: "974d9c478238e5bfb79d2ae0300980236b17f5b6d8c346402b4935f839cd0035",
    tagCount: 1,
    sources: [["homepage", yourLibraryBay], ["homepage generator", regeneratedLeftBay]]
  },
  {
    name: "kudzu",
    asset: "76e5992bd45bf02c0b323b4fa4138d3f579ee75fdb70aa757d7ad95c77306cc3",
    styles: "0955b5038c5439758fb0473c737029fbb3cb922206a41f3bb9034620a42227e4",
    responsive: "dd7e9e2b5b5879674319ebf64e857b0e1fd5151c79138d1c25f9446d5d32574e",
    markup: "3fe347b776f39abb00cb3660fb69f5e9bfe96c7d21f3ee87ca4365450063ba4a",
    tagCount: 2,
    sources: [["homepage", openRulesBay], ["homepage generator", regeneratedRightBay]]
  }
];
const vineSelectorMatches = (selector, modifier) => selector.includes(modifier)
  || /\.shop-wall-top-dressing(?![-\w])/.test(selector);
const vineRulesFor = (source, modifier) => (source.match(/[^{}]+\{[^{}]*\}/g) || [])
  .filter(rule => vineSelectorMatches(rule.slice(0, rule.indexOf("{")), modifier));
// Keep conditional scopes with each rule; moving an unchanged rule can still move a plant.
const scopedDressingRules = [];
const dressingScopes = [];
let dressingRuleStart = 0;
for (const token of dressingCss.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]/g)) {
  if (token[0] !== "{" && token[0] !== "}") continue;
  if (token[0] === "{") {
    dressingScopes.push({
      selector: dressingCss.slice(dressingRuleStart, token.index).trim(),
      start: token.index + 1,
      conditions: dressingScopes.filter(scope => scope.selector.startsWith("@")).map(scope => scope.selector)
    });
  } else {
    const scope = dressingScopes.pop();
    assert.ok(scope, "The dressing stylesheet must have balanced blocks.");
    scopedDressingRules.push({ ...scope, rule: `${scope.selector} {${dressingCss.slice(scope.start, token.index)}}` });
  }
  dressingRuleStart = token.index + 1;
}
assert.equal(dressingScopes.length, 0, "The dressing stylesheet must have balanced blocks.");
for (const vine of approvedVines) {
  const modifier = `.shop-wall-top-dressing--${vine.name}`;
  const approvalRequired = `RV-approved ${vine.name} arrangement changed; RV approval is required before updating this baseline.`;
  const asset = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing", `${vine.name}-vine.png`));
  assert.equal(approvedDressingHash(asset), vine.asset, `Artwork: ${approvalRequired}`);
  const rules = vineRulesFor(dressingCss, modifier).map(normalizeDressing);
  assert.equal(approvedDressingHash(rules.join("\n")), vine.styles, `Position, size, pruning, or layering: ${approvalRequired}`);
  const responsive = scopedDressingRules
    .filter(rule => rule.conditions.length && vineSelectorMatches(rule.selector, modifier))
    .map(rule => normalizeDressing(`${rule.conditions.join(" > ")} ${rule.rule}`));
  assert.equal(approvedDressingHash(responsive.join("\n")), vine.responsive, `Responsive rules or breakpoints: ${approvalRequired}`);
  for (const [label, source] of vine.sources) {
    const tags = dressingTags(source).filter(tag => tag.includes(modifier.slice(1)));
    assert.equal(tags.length, vine.tagCount, `The ${label} must retain the approved ${vine.name} layers in their library bay.`);
    assert.equal(approvedDressingHash(tags.map(normalizeDressing).join("\n")), vine.markup, `${label} markup: ${approvalRequired}`);
  }
}

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
