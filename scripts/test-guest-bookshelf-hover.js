const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets/css/guest-landing.css"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-store.js"), "utf8");

assert.match(build, /class="bookshelf-book\$\{edgeClass\}/, "Product shelves must continue to render existing book anchors.");
const storefrontCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
assert.match(storefrontCss, /\.homepage-open-rules-book:hover,[\s\S]*?\.guest-open-rules-mock-book:hover\s*\{[\s\S]*?transform: perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?filter: drop-shadow\(0 10px 8px rgba\(10, 5, 2, \.62\)\) !important/,
  "The shared Guest, Customer, and Creator Open Rules book must retain its lift and hover shadow.");
assert.match(storefrontCss, /a\.shop-wall-hero-book,[\s\S]*?\.shop-wall-sale-spine,[\s\S]*?\.shop-wall-stock-spine,[\s\S]*?\.shop-wall-hero-book--stock\s*\{\s*transition:\s*transform 200ms ease/);
assert.match(storefrontCss, /\.shop-wall-sale-spine:hover,[\s\S]*?\.shop-wall-sale-spine:focus-visible,[\s\S]*?\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{[\s\S]*?transform: perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?filter: brightness\(1\.12\) drop-shadow\(5px 8px 6px #160b0699\) !important;[\s\S]*?z-index: 3/);
assert.match(storefrontCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{ transform: none; \}/);
assert.match(storefrontCss, /\.shop-wall-stock-spine\s*,[\s\S]*?\.shop-wall-hero-book--stock\s*\{\s*transition: transform 200ms ease/);
assert.match(storefrontCss, /\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{[\s\S]*?transform: perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?z-index: 3/);
assert.match(storefrontCss, /a\.shop-wall-hero-book,[\s\S]*?\.shop-wall-hero-book--stock\s*\{\s*transition: transform 200ms ease, filter 160ms ease/);
assert.match(storefrontCss, /\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{ transform: none; \}/);
assert.match(storefrontCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.homepage-open-rules-book:hover,[\s\S]*?\.guest-open-rules-mock-book:hover\s*\{\s*transform: none;/);
assert.doesNotMatch(css, /\.guest-landing-page \.bookshelf-book:hover\s+\.bookshelf-book__spine/);

console.log("Guest bookshelf hover tests passed.");
