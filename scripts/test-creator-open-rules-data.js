const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "assets/js/creator-open-rules.js"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "creator/index.html"), "utf8");
const preview = fs.readFileSync(path.join(ROOT, "assets/js/guest-product-preview.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets/css/creator-dashboard.css"), "utf8");
const storefrontCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const dashboard = fs.readFileSync(path.join(ROOT, "assets/js/creator-dashboard-blank.js"), "utf8");
const creatorCabinet = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing/upper-cabinet-creator-desktop.png"));
const sharedCabinet = fs.readFileSync(path.join(ROOT, "assets/images/storefront-shelf-dressing/upper-cabinet-desktop.png"));

function element() {
  return {
    dataset: {}, attributes: {}, children: [], style: { setProperty() {} },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    getBoundingClientRect() { return { width: 410 }; }
  };
}

async function run({ user, search = "", items = [] }) {
  const rows = [element(), element()];
  const requests = [];
  const createdBooks = [];
  const doc = {
    documentElement: { dataset: {} },
    querySelectorAll(selector) { return selector === "[data-creator-library-books]" ? rows : []; },
    createElement() { return element(); }
  };
  const context = {
    document: { ...doc, dispatchEvent() {} },
    window: {
      innerWidth: 1200,
      location: { search },
      TRGOpenRulesLibrary: {
        createOpenRulesShelfBook(product, position, width) {
          const book = element();
          book.product = product;
          book.position = position;
          book.width = width;
          createdBooks.push(book);
          return book;
        }
      }
    },
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ width: "12px" }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/account/me") return { ok: true, json: async () => ({ authenticated: Boolean(user), user }) };
      if (url === "/api/account/library") return { ok: true, json: async () => ({ items }) };
      throw new Error(`Unexpected request ${url}`);
    }
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { rows, requests, createdBooks, document: doc };
}

(async () => {
  const guest = await run({ user: null, search: "?preview-library=1" });
  assert.deepEqual(guest.requests.map((entry) => entry.url), ["/api/account/me"], "Unauthenticated users do not fetch private library data or see mock books");
  assert.equal(guest.createdBooks.length, 0);

  const ordinary = await run({ user: { role: "user" }, search: "?preview-library=1", items: [] });
  assert.deepEqual(ordinary.requests.map((entry) => entry.url), ["/api/account/me", "/api/account/library"], "Ordinary accounts see only their real owned library, even with the preview flag");
  assert.equal(ordinary.createdBooks.length, 0, "An empty owned library remains empty");
  assert.equal(ordinary.document.documentElement.dataset.creatorLibraryPreview, undefined);

  const owner = await run({ user: { role: "owner" }, search: "?preview-library=1" });
  assert.deepEqual(owner.requests.map((entry) => entry.url), ["/api/account/me"], "Owner mock preview never calls the entitlement or catalog APIs");
  assert.equal(owner.createdBooks.length, 5, "Owner preview renders several mock books immediately");
  assert.deepEqual(owner.createdBooks.map((book) => book.position), [0, 1, 2, 3, 4], "Mock books use the shared renderer and repeating height positions");
  assert.ok(owner.createdBooks.every((book) => book.product.fullUrl === "#creator-preview-only"));
  assert.ok(owner.createdBooks.every((book) => book.dataset.creatorPreviewOnly !== undefined));
  assert.equal(owner.document.documentElement.dataset.creatorLibraryPreview, "owner");

  const owned = await run({ user: { role: "user" }, items: [
    { productId: "owned-one", productTitle: "Owned One", coverImage: "/cover.webp", downloadUrl: "/store/download?credential=opaque" },
    { productId: "owned-two", productTitle: "Owned Two", downloadUrl: "/store/download?credential=another" }
  ] });
  assert.deepEqual(owned.requests.map((entry) => entry.url), ["/api/account/me", "/api/account/library"]);
  assert.deepEqual(owned.createdBooks.map((book) => book.product.slug), ["owned-one", "owned-two"], "Creator uses Customer's authenticated ownership response");
  assert.equal(owned.createdBooks[0].product.fullUrl, "/store/download?credential=opaque");
  assert.ok(owned.createdBooks.every((book) => book.dataset.creatorOwnedBook !== undefined));
  assert.equal(owned.rows[0].children[0].children.length, 2, "Owned books are present without arrival delays");

  assert.doesNotMatch(source, /api\/homepage-shelves|api\/catalog|PRODUCT_IDS|trg:homepage-shelves-updated/,
    "Creator no longer selects Open Rules products or dispatches magical shelf arrivals");
  assert.match(source, /trg:creator-library-updated/, "Rendered personal books receive the shared examination handlers without arrival animation");
  assert.equal((page.match(/data-creator-library-books/g) || []).length, 2);
  assert.doesNotMatch(page, /data-creator-open-rules-books|data-magical-bookshelf|magical-bookshelf\.js/);
  assert.match(page, /data-creator-identity-page/);
  assert.match(page, /guest-product-preview\.js\?v=creator-identity-library1/);
  assert.match(page, /shop-wall-fixed-cabinet" data-fixed-cabinet/);
  assert.match(page, /upper-cabinet-creator-mobile\.png\?v=creator-title-board3/);
  assert.match(page, /upper-cabinet-creator-tablet\.png\?v=creator-title-board3/);
  assert.match(page, /upper-cabinet-creator-desktop\.png\?v=creator-title-board3/);
  assert.match(page, /<img src="\/assets\/images\/storefront-shelf-dressing\/upper-cabinet-creator-desktop\.png\?v=creator-title-board3"/,
    "The Creator page uses the plant-free role-specific artwork at every responsive breakpoint");
  assert.match(page, /shop-wall-plaque"><h2 id="your-library-heading">YOUR LIBRARY/);
  assert.match(page, /creator-dashboard-library-bay" aria-labelledby="your-library-heading"/);
  assert.match(page, /creator-dashboard-identity-overlay/);
  assert.match(page, /creator-dashboard-trg-emblem" src="\/assets\/images\/storefront-shelf-dressing\/golden-d20-lantern-logo\.png/);
  assert.match(page, /id="creator-identity" class="creator-dashboard-creator-identity"/);
  assert.match(page, /class="creator-dashboard-creator-image"/);
  assert.match(page, /class="creator-dashboard-creator-initials"/);
  assert.match(page, /class="creator-dashboard-creator-name"/);
  assert.doesNotMatch(page, /creator-dashboard-brand-board|creator-dashboard-brand-seal-mask/,
    "Creator identity does not add a second board or a board-sized mask");
  assert.equal(creatorCabinet.readUInt32BE(16), sharedCabinet.readUInt32BE(16), "Creator artwork preserves cabinet width");
  assert.equal(creatorCabinet.readUInt32BE(20), sharedCabinet.readUInt32BE(20), "Creator artwork preserves cabinet height");
  assert.equal((page.match(/guest-open-rules-row" aria-hidden="true">\s*<\/div>/g) || []).length, 2,
    "Creator Open Rules shelves retain their shelf rows without empty dark grid cards");
  assert.match(page, /class="shop-wall-back-wall-art shop-wall-back-wall-art--right creator-dashboard-open-rules-poster"[^>]+the-familiar-framed-poster\.png/,
    "Creator Profile retains the approved framed poster as its static frame/fallback");
  assert.match(page, /data-creator-profile-catalog-cover data-catalog-api="\/api\/catalog"/,
    "Creator Profile can display published covers from its selected Creator catalog");
  assert.match(page, /creator-profile-catalog-rotation\.js\?v=creator-catalog-cover-rotation1/,
    "Creator Profile loads its scoped catalog-cover rotator");
  assert.match(page, /class="creator-dashboard-open-rules-light-overlay"/, 
    "Creator Open Rules bay restores the overhead light layer");
  assert.match(page, /class="creator-dashboard-open-rules-light-cover"/, 
    "Creator Open Rules bay contains the scoped light-effect cover");
  assert.doesNotMatch(page, /creator-dashboard-open-rules-bay[\s\S]*?bookshelf-grid/,
    "Empty Creator Open Rules shelves contain no generic dark bookshelf-grid cards");
  assert.match(preview, /data-creator-preview-only/);
  assert.match(preview, /"\/creator", "\/creator\/"/);
  assert.match(storefrontCss, /\.guest-open-rules-examination-close[\s\S]*?position: absolute/,
    "Creator retains the shared book examination close control styling");
  assert.match(css, /\.creator-dashboard-identity-overlay[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)[\s\S]*?align-items: start[\s\S]*?column-gap: 0[\s\S]*?transform: translateX\(calc\(-50% - 20px\)\)/);
  assert.match(css, /\.creator-dashboard-trg-emblem[\s\S]*?top: -4%[\s\S]*?transform: translateY\(-38px\)[\s\S]*?width: min\(110%, 209px\)/);
  assert.match(css, /\.creator-dashboard-open-rules-poster[\s\S]*?top: calc\(5% - 24px\)[\s\S]*?left: 83\.333%[\s\S]*?width: auto[\s\S]*?height: 90%/,
    "Creator poster uses Creator-only proportional bay positioning");
  assert.match(css, /\.creator-dashboard-open-rules-light-cover[\s\S]*?top: 240px[\s\S]*?left: 83\.333%/,
    "Creator light-effect cover stays scoped to the right bay");
  assert.match(css, /\.creator-dashboard-creator-image[\s\S]*?width: min\(110%, 209px\)[\s\S]*?object-fit: contain/);
  assert.match(css, /\.creator-dashboard-creator-initials[\s\S]*?width: min\(227px, 110%\)[\s\S]*?background: linear-gradient/);
  assert.match(css, /\.creator-dashboard-creator-name[\s\S]*?color: #000/);
  assert.match(dashboard, /api\/creator\/identity-options/);
  assert.match(dashboard, /Creator session active/);
  assert.match(dashboard, /creatorName\.textContent/);
  console.log("Creator identity library tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
