const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets/css/guest-landing.css"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-store.js"), "utf8");

assert.match(build, /class="bookshelf-book\$\{edgeClass\}/, "Product shelves must continue to render existing book anchors.");
assert.match(css, /\.guest-landing-page \.bookshelf-book:not\(\.is-examining\),[\s\S]*?\.guest-landing-page \.guest-open-rules-mock-book\s*\{[\s\S]*?transition:\s*transform 200ms ease/);
assert.match(css, /\.guest-landing-page \.bookshelf-book:hover:not\(\.is-examining\),[\s\S]*?\.guest-landing-page \.guest-open-rules-mock-book:hover\s*\{[\s\S]*?transform:\s*perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)/);
assert.match(css, /\.guest-landing-page \.guest-open-rules-mock-book:hover\s*\{[\s\S]*?transform:\s*perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?filter:\s*drop-shadow[\s\S]*?!important/);
assert.match(css, /\.guest-landing-page \.guest-open-rules-mock-book\s*\{[\s\S]*?pointer-events:\s*auto/);
const storefrontCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
assert.match(storefrontCss, /a\.shop-wall-hero-book,[\s\S]*?\.shop-wall-sale-spine,[\s\S]*?\.shop-wall-stock-spine,[\s\S]*?\.shop-wall-hero-book--stock\s*\{\s*transition:\s*transform 200ms ease/);
assert.match(storefrontCss, /\.shop-wall-sale-spine:hover,[\s\S]*?\.shop-wall-sale-spine:focus-visible,[\s\S]*?\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{[\s\S]*?transform: perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?z-index: 3/);
assert.match(storefrontCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{ transform: none; \}/);
assert.match(storefrontCss, /\.shop-wall-stock-spine\s*,[\s\S]*?\.shop-wall-hero-book--stock\s*\{\s*transition: transform 200ms ease/);
assert.match(storefrontCss, /\.shop-wall-stock-spine:hover,[\s\S]*?\.shop-wall-hero-book--stock:hover\s*\{[\s\S]*?transform: perspective\(700px\) translateY\(-10px\) translateZ\(28px\) scale\(1\.06\)[\s\S]*?z-index: 3/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guest-landing-page \.bookshelf-book:hover:not\(\.is-examining\),[\s\S]*?\.guest-landing-page \.guest-open-rules-mock-book:hover\s*\{[\s\S]*?transform:\s*none/);
assert.doesNotMatch(css, /\.guest-landing-page \.bookshelf-book:hover\s+\.bookshelf-book__spine/);

console.log("Guest bookshelf hover tests passed.");
