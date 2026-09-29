const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
  const build = read("scripts/build-store.js");
  const creators = require(path.join(ROOT, "data/authors.js"));
  const directory = read("authors.html");
  const homepage = read("index.html");
  const profile = read("authors/rv-sawyer/index.html");
  const alias = read("creators/rv-sawyer/index.html");
  const product = read("store/products/agency/index.html");
  const account = read("account.html");
  const forumNavigation = read("functions/_lib/public-navigation.mjs");

  assert.match(build, /const PUBLIC_NAV_ITEMS = Object\.freeze/, "Static public pages must share one generator-owned navigation definition.");
  for (const label of ["Marketplace", "Creators", "New Releases", "Sales & Bundles", "Physical Goods", "Community", "About Tobacco Road Games", "Account \/ My Library", "Cart"]) {
    assert.match(build, new RegExp(label.replace(/[&/]/g, "\\$&")), `Static navigation must include ${label}.`);
    assert.match(forumNavigation, new RegExp(label.replace(/[&/]/g, "\\$&").replace("&", "&(?:amp;)?")), `Function navigation must include ${label}.`);
  }

  assert.equal(creators[0].profileTemplate, "bookshelf", "RV Sawyer must retain the bookshelf creator template.");
  assert.equal(creators[0].marketplaceStatus, "active", "RV Sawyer must be an active marketplace creator.");
  assert.match(profile, /0 titles in the public catalog/, "RV Sawyer's generated profile must render the empty public-catalog state.");
  assert.match(profile, /Public catalog titles will appear here/, "The empty creator catalog must not render legacy preview products.");
  assert.match(build, /data-creator-template="catalog"/, "The catalog creator template must remain available.");
  assert.match(directory, /Explore creators publishing through the Tobacco Road Games marketplace/, "The creator directory must be marketplace-facing.");
  assert.match(alias, /compatibility alias/, "The creators URL must remain a safe compatibility alias.");
  assert.match(product, /<dt>Creator<\/dt>/, "Product pages must render Creator separately.");
  assert.match(product, /<dt>Publisher \/ Imprint<\/dt>/, "Product pages must render Publisher / Imprint separately.");
  assert.match(account, /Account \/ My Library/, "The account page must expose the My Library destination without changing auth behavior.");
  assert.doesNotMatch(account, />Authors<\/a>/, "Public navigation must not expose Author terminology.");
  assert.match(homepage, /homepage-clear-deck/, "The homepage must render the Phase 0 clear-deck canvas.");
  assert.match(homepage, /Tobacco Road Games storefront redesign in progress\./, "The cleared homepage must retain only the modest staging marker.");
  for (const removedCopy of [
    "Find your next game",
    "Know who made the game",
    "Browse your way",
    "Meet marketplace creators",
    "Fresh from the creators",
    "Every Book Must Have a Soul",
    "Tobacco Road Games operates the road",
    "The marketplace is growing"
  ]) {
    assert.equal(homepage.includes(removedCopy), false, `Cleared homepage must not render old marketing copy: ${removedCopy}`);
  }

  console.log("Marketplace architecture tests passed.");
}

main();
