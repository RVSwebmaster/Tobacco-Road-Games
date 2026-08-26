(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TRGMarketplaceDiscovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeQuery(query = {}) {
    const playerCount = Number(query.playerCount);
    return {
      genre: text(query.genre), playerCount: Number.isInteger(playerCount) && playerCount > 0 ? playerCount : null,
      gmMode: text(query.gmMode), prepBurden: text(query.prepBurden), playMode: text(query.playMode),
      rulesComplexity: text(query.rulesComplexity), mediaType: text(query.mediaType)
    };
  }
  function matchesMarketplaceProduct(product = {}, input = {}) {
    const query = normalizeQuery(input);
    if (query.genre && text(product.genre) !== query.genre) return false;
    if (query.gmMode && text(product.gmMode) !== query.gmMode) return false;
    if (query.prepBurden && text(product.prepBurden) !== query.prepBurden) return false;
    if (query.playMode && !playModeMatches(product.playMode, query.playMode)) return false;
    if (query.rulesComplexity && text(product.rulesComplexity) !== query.rulesComplexity) return false;
    if (query.mediaType && !mediaTypeMatches(product.mediaType, query.mediaType)) return false;
    if (query.playerCount && !(Number(product.playerCountMin) <= query.playerCount && Number(product.playerCountMax) >= query.playerCount)) return false;
    return true;
  }
  function queryMarketplace(products, query) { return (products || []).filter((product) => matchesMarketplaceProduct(product, query)); }
  function playModeMatches(value, requested) { const actual = text(value); return actual === requested || actual === "either"; }
  function mediaTypeMatches(value, requested) { const actual = text(value); return actual === requested || actual === "hybrid"; }
  function text(value) { return String(value || "").trim().toLowerCase(); }
  return { matchesMarketplaceProduct, normalizeQuery, queryMarketplace };
});
