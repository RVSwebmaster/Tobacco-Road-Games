const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const page = read("store/index.html");
const css = read("styles.css");
const build = read("scripts/build-store.js");
const storefront = read("assets/js/storefront.js");
const sponsor = read("assets/js/sponsor-marquee.js");
const logoPath = path.join(ROOT, "assets", "tobacco-road-games-logo.png");

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
