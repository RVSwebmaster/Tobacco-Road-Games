const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const themes = require(path.join(ROOT, "assets", "js", "storefront-shelf-themes.js"));

const page = read("store/index.html");
const css = read("styles.css");
const runtime = read("assets/js/storefront-shelf-dressing.js");
const sprite = read("assets/images/storefront-shelf-dressing.svg");
const storefront = read("assets/js/storefront.js");
const sponsor = read("assets/js/sponsor-marquee.js");
const build = read("scripts/build-store.js");

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
for (const asset of configuredAssets) assert.match(sprite, new RegExp(`<symbol id="${asset}"`), `Missing sprite symbol: ${asset}`);

assert.match(page, /storefront-shelf-themes\.js\?v=20260908-dressing-rules2/);
assert.match(page, /storefront-shelf-dressing\.js\?v=20260908-dressing-rules2/);
assert.match(build, /const STOREFRONT_CACHE_BUST = "20260908-dressing-rules2"/);
assert.match(build, /storefront-shelf-themes\.js/);
assert.match(build, /storefront-shelf-dressing\.js/);
assert.match(runtime, /aria-hidden/);
assert.match(runtime, /MutationObserver/);
assert.match(runtime, /resolveShelfDressing/);
assert.match(runtime, /createIcon\(descriptor\.plant, "plant"\)/);
assert.match(runtime, /createIcon\(descriptor\.secondary, "secondary"\)/);
assert.match(runtime, /descriptor\.plant/);
assert.match(runtime, /descriptor\.secondary/);
assert.doesNotMatch(runtime, /addEventListener\(["']click|data-ad-pool|impression/);
assert.match(css, /\.shelf-dressing\{[^}]*pointer-events:none/);
assert.match(css, /\.shelf-dressing__object--plant\{width:29px;height:44px\}/);
assert.match(css, /\.shelf-dressing__object--secondary\{width:34px;height:49px\}/);
assert.match(css, /padding:18px 74px 26px/);
assert.match(css, /@media\(max-width:900px\)[^{]*\{[\s\S]*?\.shelf-dressing\{display:none\}/);
assert.match(storefront, /openExamination/);
assert.match(storefront, /bookshelf-book__placeholder/);
assert.match(sponsor, /data-sponsor-track/);
assert.match(sprite, /<symbol id="best-seller-trophy"/);
assert.match(sprite, /<title>Tobacco Road Games trophy<\/title>/);
assert.doesNotMatch(sprite, /<title>\s*TRG\b/i);
assert.match(sprite, /<symbol id="sumo"/);
assert.match(sprite, /<symbol id="basketball"/);
assert.match(sprite, /<symbol id="easter-eggs"/);
assert.ok(fs.statSync(path.join(ROOT, "assets", "images", "storefront-shelf-dressing.svg")).size < 50000, "Shelf-dressing sprite should remain lightweight.");

console.log("TRG storefront shelf-dressing theme tests passed.");
