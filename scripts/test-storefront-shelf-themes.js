const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const themes = require(path.join(ROOT, "assets", "js", "storefront-shelf-themes.js"));

const page = read("store/index.html");
const css = read("styles.css");
const runtime = read("assets/js/storefront-shelf-dressing.js");
const storefront = read("assets/js/storefront.js");
const sponsor = read("assets/js/sponsor-marquee.js");
const build = read("scripts/build-store.js");
const artworkRoot = path.join(ROOT, "assets", "images", "storefront-shelf-dressing");
const masterRoot = path.join(artworkRoot, "masters");
const suppliedArtwork = [
  "antique_brass_globe_on_stacked_books",
  "antique_brass_lantern_with_candle_glow",
  "antique_golden_book_trophy",
  "basketball_trophy_on_walnut_stand",
  "cheerful_ceramic_sumo_figurine",
  "enchanted_books_and_emerald_dice",
  "frosted_holiday_tree_with_velvet_bow",
  "glowing_autumn_jack_o_lantern_harvest_decor",
  "variegated_pothos_in_ornate_green_urn",
  "vintage_books_and_magnifying_glass"
];

assert.equal(themes.HOUSE_TIME_ZONE, "America/New_York");
assert.equal(themes.selectActiveTheme(new Date("2026-02-02T17:00:00Z")).id, "default", "An ordinary day must use the canonical default theme.");
assert.equal(themes.selectActiveTheme(new Date("2026-02-02T17:00:00Z"), [{ id: "disabled", priority: 999, enabled: false, schedule: { type: "always" } }]).id, "default", "Unknown or inactive theme sets must fall back to default.");

const normal = themes.resolveShelfDressing({ shelfIndex: 2, shelfKey: "new-arrivals", theme: themes.DEFAULT_THEME });
assert.equal(normal.eventSide, null);
assert.equal(normal.left.plant.asset, "plant");
assert.equal(normal.right.plant.asset, "plant");
assert.equal(normal.left.secondary.kind, "default");
assert.equal(normal.right.secondary.kind, "default");
assert.notEqual(normal.left.secondary.asset, normal.right.secondary.asset, "Normal shelf edges should use an orderly RPG mix.");

const openRulesNormal = themes.resolveShelfDressing({ shelfIndex: 0, shelfKey: "open-rules", theme: themes.DEFAULT_THEME });
assert.equal(openRulesNormal.left.plant.asset, "plant");
assert.equal(openRulesNormal.right.plant.asset, "plant");
assert.equal(openRulesNormal.left.secondary.asset, "best-seller-trophy");
assert.equal(openRulesNormal.right.secondary.asset, "best-seller-trophy");
assert.equal(openRulesNormal.left.secondary.kind, "house");
assert.equal(openRulesNormal.right.secondary.kind, "house");

const fixtureEvent = { id: "fixture-event", name: "Fixture", priority: 50, enabled: true, schedule: { type: "always" }, decorations: ["pumpkin"] };
const firstEventShelf = themes.resolveShelfDressing({ shelfIndex: 0, shelfKey: "new-arrivals", theme: fixtureEvent });
const secondEventShelf = themes.resolveShelfDressing({ shelfIndex: 1, shelfKey: "best-sellers", theme: fixtureEvent });
assert.equal(firstEventShelf.eventSide, "right");
assert.equal(firstEventShelf.left.plant.asset, "plant");
assert.equal(firstEventShelf.right.plant.asset, "plant");
assert.equal(firstEventShelf.right.secondary.kind, "event");
assert.equal(firstEventShelf.right.secondary.asset, "pumpkin");
assert.equal(firstEventShelf.left.secondary.kind, "default");
assert.equal(secondEventShelf.eventSide, "left");
assert.equal(secondEventShelf.left.plant.asset, "plant");
assert.equal(secondEventShelf.right.plant.asset, "plant");
assert.equal(secondEventShelf.left.secondary.kind, "event");
assert.equal(secondEventShelf.left.secondary.asset, "pumpkin");
assert.equal(secondEventShelf.right.secondary.kind, "default");

const openRulesEvent = themes.resolveShelfDressing({ shelfIndex: 0, shelfKey: "open-rules", theme: fixtureEvent });
assert.equal(openRulesEvent.eventSide, null);
assert.equal(openRulesEvent.left.plant.asset, "plant");
assert.equal(openRulesEvent.right.plant.asset, "plant");
assert.equal(openRulesEvent.left.secondary.asset, "best-seller-trophy");
assert.equal(openRulesEvent.right.secondary.asset, "best-seller-trophy");
assert.notEqual(openRulesEvent.left.secondary.asset, "pumpkin");
assert.notEqual(openRulesEvent.right.secondary.asset, "pumpkin");

for (const theme of themes.THEMES) {
  const ordinary = themes.resolveShelfDressing({ shelfIndex: 3, shelfKey: "search-results", theme });
  assert.equal(ordinary.left.plant.asset, "plant", `${theme.id} must preserve the left plant.`);
  assert.equal(ordinary.right.plant.asset, "plant", `${theme.id} must preserve the right plant.`);
  assert.notEqual(ordinary.left.secondary.asset, "plant", `${theme.id} must not reuse the plant as secondary dressing.`);
  assert.notEqual(ordinary.right.secondary.asset, "plant", `${theme.id} must not reuse the plant as secondary dressing.`);

  const house = themes.resolveShelfDressing({ shelfIndex: 0, shelfKey: "open-rules", theme });
  assert.equal(house.left.plant.asset, "plant", `${theme.id} must preserve the Open Rules left plant.`);
  assert.equal(house.right.plant.asset, "plant", `${theme.id} must preserve the Open Rules right plant.`);
  assert.equal(house.left.secondary.asset, "best-seller-trophy", `${theme.id} must preserve the Open Rules left trophy.`);
  assert.equal(house.right.secondary.asset, "best-seller-trophy", `${theme.id} must preserve the Open Rules right trophy.`);
}

const overlap = themes.selectActiveTheme(new Date("2026-02-02T17:00:00Z"), [
  themes.DEFAULT_THEME,
  { id: "lower", priority: 20, enabled: true, schedule: { type: "always" }, decorations: ["plant"] },
  { id: "winner", priority: 90, enabled: true, schedule: { type: "always" }, decorations: ["medallion"] }
]);
assert.equal(overlap.id, "winner", "Exactly one highest-priority event must win an overlap.");

const honbashoFixture = {
  ...themes.THEMES.find((theme) => theme.id === "honbasho"),
  schedule: { type: "date-ranges", ranges: [{ start: "2026-09-01", end: "2026-09-15" }] }
};
assert.equal(themes.selectActiveTheme(new Date("2026-09-08T16:00:00Z"), [honbashoFixture, themes.DEFAULT_THEME]).id, "honbasho");
assert.equal(themes.selectActiveTheme(new Date("2026-06-14T16:00:00Z")).id, "army-birthday");
assert.equal(themes.selectActiveTheme(new Date("2026-06-14T03:30:00Z")).id, "default", "Theme dates must follow TRG house time, not UTC or visitor time.");

const themeIds = new Set(themes.THEMES.map((theme) => theme.id));
for (const id of [
  "default", "trg-anniversary", "honbasho", "acc-basketball", "acc-basketball-winner",
  "army-birthday", "navy-birthday", "marine-corps-birthday", "air-force-birthday",
  "coast-guard-birthday", "space-force-birthday", "halloween", "thanksgiving",
  "winter-holiday", "easter", "spring", "autumn"
]) assert.ok(themeIds.has(id), `Missing shelf theme: ${id}`);

const configuredAssets = new Set(themes.THEMES.flatMap((theme) => theme.decorations || []));
configuredAssets.add("best-seller-trophy");
configuredAssets.add("plant");
for (const asset of configuredAssets) {
  assert.ok(themes.ASSET_SOURCES[asset], `Missing supplied-art mapping for theme asset: ${asset}`);
  assert.match(themes.ASSET_SOURCES[asset], /^\/assets\/images\/storefront-shelf-dressing\/[a-z0-9_]+\.webp$/);
}

assert.equal(themes.ASSET_ROOT, "/assets/images/storefront-shelf-dressing");
assert.match(themes.ASSET_SOURCES.plant, /variegated_pothos_in_ornate_green_urn\.webp$/);
assert.match(themes.ASSET_SOURCES["best-seller-trophy"], /antique_golden_book_trophy\.webp$/);
assert.match(themes.ASSET_SOURCES.sumo, /cheerful_ceramic_sumo_figurine\.webp$/);
assert.match(themes.ASSET_SOURCES.basketball, /basketball_trophy_on_walnut_stand\.webp$/);
assert.match(themes.ASSET_SOURCES.pumpkin, /glowing_autumn_jack_o_lantern_harvest_decor\.webp$/);
assert.match(themes.ASSET_SOURCES.evergreen, /frosted_holiday_tree_with_velvet_bow\.webp$/);
assert.deepEqual(new Set([
  themes.ASSET_SOURCES.dice,
  themes.ASSET_SOURCES.knight,
  themes.ASSET_SOURCES.dragon,
  themes.ASSET_SOURCES["map-tube"]
]), new Set([
  `${themes.ASSET_ROOT}/enchanted_books_and_emerald_dice.webp`,
  `${themes.ASSET_ROOT}/antique_brass_globe_on_stacked_books.webp`,
  `${themes.ASSET_ROOT}/antique_brass_lantern_with_candle_glow.webp`,
  `${themes.ASSET_ROOT}/vintage_books_and_magnifying_glass.webp`
]), "The default RPG dressing must draw from all four supplied default companions.");

for (const basename of suppliedArtwork) {
  const master = path.join(masterRoot, `${basename}.png`);
  const derivative = path.join(artworkRoot, `${basename}.webp`);
  assert.ok(fs.existsSync(master), `Missing preserved PNG master: ${basename}`);
  assert.ok(fs.existsSync(derivative), `Missing optimized WebP derivative: ${basename}`);
  const bytes = fs.readFileSync(derivative);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `${basename} must be a WebP RIFF file.`);
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `${basename} must be WebP artwork.`);
  assert.ok(fs.statSync(derivative).size < fs.statSync(master).size, `${basename} derivative should be smaller than its 1254px master.`);
}
assert.equal(new Set(Object.values(themes.ASSET_SOURCES)).size, suppliedArtwork.length, "Every supplied artwork derivative should be active in the shelf theme map.");
assert.equal(fs.existsSync(path.join(ROOT, "assets", "images", "storefront-shelf-dressing.svg")), false, "The obsolete simplified sprite must be retired.");

assert.match(page, /storefront-shelf-themes\.js\?v=20260908-shelf-baseline5/);
assert.match(page, /storefront-shelf-dressing\.js\?v=20260908-shelf-baseline5/);
assert.match(build, /const STOREFRONT_CACHE_BUST = "20260908-shelf-baseline5"/);
assert.match(build, /storefront-shelf-themes\.js/);
assert.match(build, /storefront-shelf-dressing\.js/);
assert.match(runtime, /aria-hidden/);
assert.match(runtime, /MutationObserver/);
assert.match(runtime, /resolveShelfDressing/);
assert.match(runtime, /createArtwork\(descriptor\.plant, "plant"\)/);
assert.match(runtime, /createArtwork\(descriptor\.secondary, "secondary"\)/);
assert.match(runtime, /document\.createElement\("img"\)/);
assert.match(runtime, /artwork\.loading = "lazy"/);
assert.match(runtime, /artwork\.decoding = "async"/);
assert.match(runtime, /artwork\.src = descriptor\.src/);
assert.doesNotMatch(runtime, /createElementNS|<use|descriptor\.sprite/);
assert.match(runtime, /descriptor\.plant/);
assert.match(runtime, /descriptor\.secondary/);
assert.doesNotMatch(runtime, /addEventListener\(["']click|data-ad-pool|impression/);
assert.match(css, /\.shelf-dressing\{[^}]*pointer-events:none/);
assert.match(css, /--shelf-contact-shift:23px/);
assert.match(css, /bottom:calc\(23px - var\(--shelf-contact-shift,0px\)\)/);
assert.match(css, /\.shelf-storefront \.bookshelf-book,[^{]+\{position:relative;top:var\(--shelf-contact-shift\)/);
assert.match(css, /\.bookshelf-book__placeholder\{position:relative;top:var\(--shelf-contact-shift\)/);
assert.match(css, /\.shelf-dressing--left\{left:-16px\}/);
assert.match(css, /\.shelf-dressing--right\{right:-16px;flex-direction:row-reverse\}/);
assert.match(css, /\.shelf-dressing__object\{[^}]*object-fit:contain;object-position:center bottom/);
assert.match(css, /\.shelf-dressing__object\{[^}]*transform:translateY\(var\(--shelf-art-base-nudge,0px\)\)/);
for (const basename of suppliedArtwork) assert.match(css, new RegExp(`${basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.webp`), `${basename} needs an explicit visible-base alignment rule.`);
assert.match(css, /\.shelf-dressing__object--plant\{z-index:1;width:76px;height:76px\}/);
assert.match(css, /\.shelf-dressing__object--secondary\{z-index:2;width:84px;height:84px;margin-left:-68px\}/);
assert.match(css, /\.shelf-dressing--right \.shelf-dressing__object--secondary\{margin-right:-68px;margin-left:0\}/);
assert.match(css, /\.shelf-dressing__object--house\{width:90px;height:90px;margin-left:-74px\}/);
assert.match(css, /\.shelf-dressing__object--event\{width:88px;height:88px;margin-left:-72px\}/);
assert.match(css, /padding:17px 76px 23px/);
assert.match(css, /body\.book-examination-active \.shelf-dressing\{opacity:\.38\}/);
assert.match(css, /\.bookshelf-book\.is-examining\{position:fixed;z-index:60/);
assert.match(css, /@media\(max-width:900px\)[^{]*\{[\s\S]*?\.shelf-dressing\{display:none\}/);
assert.match(storefront, /openExamination/);
assert.match(storefront, /bookshelf-book__placeholder/);
assert.match(sponsor, /data-sponsor-track/);
assert.doesNotMatch(`${page}\n${runtime}\n${css}`, /storefront-shelf-dressing\.svg/);

console.log("TRG storefront shelf-dressing theme tests passed.");
