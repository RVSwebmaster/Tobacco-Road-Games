(function (globalScope) {
  const BASE_PRICE = Object.freeze({
    one_page: 1.99,
    advice_booklet: 4.99,
    adventure: 6.99,
    rules_expansion: 7.99,
    setting: 9.99,
    full_game: 19.99,
    asset_pack: 4.99
  });

  const PRICE_BANDS = Object.freeze({
    one_page: [0.99, 2.99],
    advice_booklet: [2.99, 5.99],
    adventure: [3.99, 8.99],
    rules_expansion: [4.99, 14.99],
    setting: [5.99, 14.99],
    full_game: [9.99, 39.99],
    asset_pack: [2.99, 6.99]
  });

  const CHARM_PRICES = Object.freeze([0.99, 1.99, 2.99, 3.99, 4.99, 5.99, 6.99, 7.99, 9.99, 12.99, 14.99, 19.99, 24.99, 29.99, 39.99]);

  const TYPE_LABELS = Object.freeze({
    one_page: "One-Page Tool",
    advice_booklet: "Advice Booklet",
    adventure: "Adventure",
    rules_expansion: "Rules Expansion",
    setting: "Setting",
    full_game: "Full Game",
    asset_pack: "Asset Pack"
  });

  const KEYWORDS = Object.freeze({
    advice: ["advice", "guide", "gm advice", "game master", "referee", "tablecraft", "campaign design", "agency", "spotlight", "player choice", "consequence", "session", "running games"],
    adventure: ["adventure", "scenario", "module", "encounter", "quest", "crawl", "heist", "mission"],
    rules: ["rules", "subclass", "class", "ancestry", "race", "species", "monster", "spell", "feat", "equipment", "expansion", "character option", "player option"],
    setting: ["setting", "gazetteer", "kingdom", "region", "world", "lore book", "campaign setting"],
    fullGame: ["full game", "standalone", "core book", "core rules", "roleplaying game", "complete game"],
    assetPack: ["asset pack", "token pack", "map pack", "handout pack", "card deck", "cards", "tiles", "portraits"],
    evergreen: ["agency", "campaign", "spotlight", "player choice", "consequence", "table use", "game master", "gm", "referee", "session", "toolkit"],
    tools: ["tool", "tools", "procedure", "checklist", "worksheet", "generator", "oracle", "framework", "reference table"],
    playerFacing: ["player", "character", "class", "subclass", "ancestry", "race", "species", "feat", "build"],
    experienced: ["agency", "campaign", "consequence", "spotlight", "table dynamics", "shared responsibility", "design"]
  });

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9\s-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeTitle(value) {
    return normalizeText(value)
      .split(" ")
      .map((part) => part.trim())
      .filter((part) => part.length > 2);
  }

  function hasAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
  }

  function countMatches(text, keywords) {
    return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  }

  function dedupeList(values) {
    return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function normalizeMoneyText(value) {
    return String(value || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "");
  }

  function parsePriceNumber(value) {
    const numeric = Number(normalizeMoneyText(value));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function roundToCharm(value, min, max) {
    const choices = CHARM_PRICES.filter((price) => price >= min && price <= max);
    if (!choices.length) {
      return Number(clamp(value, min, max).toFixed(2));
    }

    let best = choices[0];
    let bestDistance = Math.abs(value - best);
    for (const choice of choices.slice(1)) {
      const distance = Math.abs(value - choice);
      if (distance < bestDistance || (distance === bestDistance && choice < best)) {
        best = choice;
        bestDistance = distance;
      }
    }
    return Number(best.toFixed(2));
  }

  function formatPrice(value) {
    return value === null || value === undefined || Number.isNaN(value)
      ? ""
      : Number(value).toFixed(2);
  }

  function normalizeListing(input) {
    const existingTags = dedupeList(input.tags || input.suggested_tags || []);
    const features = dedupeList(input.features || []);
    const previewImages = Array.isArray(input.previewImages) ? input.previewImages.filter(Boolean) : [];
    const textParts = [
      input.title,
      input.subtitle,
      input.short_description,
      input.shortDescription,
      input.long_description,
      input.longDescription,
      input.category,
      input.productLine,
      input.series,
      input.system,
      input.gameSystem,
      input.author,
      input.authors ? [].concat(input.authors).join(" ") : "",
      existingTags.join(" "),
      features.join(" ")
    ];
    const text = normalizeText(textParts.join(" "));
    const pageCount = Number.isFinite(Number(input.page_count)) ? Number(input.page_count) : (Number.isFinite(Number(input.pageCount)) ? Number(input.pageCount) : null);
    const currentPrice = parsePriceNumber(input.current_price ?? input.currentPrice ?? input.price);
    const coverPresent = Boolean(input.cover_image || input.coverImage || input.coverFileName || input.hasCover);
    const previewPresent = Boolean(input.preview_image || input.previewImage || input.previewFileName || previewImages.length || input.interior_image_count || input.interiorImageCount);
    const pdfPresent = Boolean(input.pdf_file || input.pdfFile || (Array.isArray(input.fileList) && input.fileList.length));

    return {
      currentPrice,
      existingTags,
      features,
      pageCount,
      previewImages,
      previewPresent,
      coverPresent,
      pdfPresent,
      raw: input,
      text
    };
  }

  function detectProductType(listing) {
    const titleTokens = tokenizeTitle(listing.raw.title);
    const pageCount = listing.pageCount;
    const text = listing.text;

    if (pageCount !== null && pageCount <= 2 || hasAny(text, ["one page", "one-page", "single page"])) {
      return { key: "one_page", label: "One-Page Tool", certainty: 0.9 };
    }

    if (hasAny(text, KEYWORDS.assetPack)) {
      return { key: "asset_pack", label: TYPE_LABELS.asset_pack, certainty: 0.88 };
    }

    if (hasAny(text, KEYWORDS.adventure)) {
      return { key: "adventure", label: TYPE_LABELS.adventure, certainty: 0.86 };
    }

    if (hasAny(text, KEYWORDS.setting)) {
      return { key: "setting", label: TYPE_LABELS.setting, certainty: 0.84 };
    }

    if (hasAny(text, KEYWORDS.fullGame) || (pageCount !== null && pageCount >= 80 && !hasAny(text, KEYWORDS.rules))) {
      return { key: "full_game", label: TYPE_LABELS.full_game, certainty: 0.82 };
    }

    if (hasAny(text, KEYWORDS.rules) || (pageCount !== null && pageCount >= 12 && hasAny(text, KEYWORDS.playerFacing))) {
      return { key: "rules_expansion", label: TYPE_LABELS.rules_expansion, certainty: 0.8 };
    }

    if (hasAny(text, KEYWORDS.advice) || normalizeText(listing.raw.series) === "tablecraft") {
      return {
        key: "advice_booklet",
        label: hasAny(text, ["gm", "game master", "referee", "agency", "campaign"]) ? "GM Advice" : TYPE_LABELS.advice_booklet,
        certainty: 0.87
      };
    }

    if (pageCount !== null && pageCount <= 12) {
      return { key: "advice_booklet", label: TYPE_LABELS.advice_booklet, certainty: 0.68 };
    }

    return { key: "rules_expansion", label: TYPE_LABELS.rules_expansion, certainty: 0.55 };
  }

  function detectSeriesFit(listing, productType) {
    const series = String(listing.raw.series || "").trim();
    if (series) {
      return series;
    }

    const text = listing.text;
    const line = normalizeText(listing.raw.productLine || listing.raw.category);
    const system = normalizeText(listing.raw.system || listing.raw.gameSystem);

    if (line.includes("tablecraft")) {
      return "Tablecraft";
    }

    if (productType.key === "advice_booklet" && (system.includes("system neutral") || system.includes("system agnotic") || hasAny(text, KEYWORDS.advice))) {
      return "Tablecraft";
    }

    return "";
  }

  function detectAudience(listing, productType) {
    const audience = [];
    const text = listing.text;

    if (productType.key === "adventure" || productType.key === "setting" || productType.label === "GM Advice" || hasAny(text, ["gm", "game master", "referee"])) {
      audience.push("Game Masters");
    }

    if (productType.key === "rules_expansion" || (productType.key !== "advice_booklet" && hasAny(text, KEYWORDS.playerFacing))) {
      audience.push("Players");
    }

    if (hasAny(text, KEYWORDS.experienced) || hasAny(text, ["risk", "consequence", "campaign design", "shared responsibility"])) {
      audience.push("Experienced Players");
    }

    if (!audience.length) {
      audience.push("Tabletop Players");
    }

    return dedupeList(audience);
  }

  function buildSuggestedTags(listing, productType, seriesFit) {
    const tags = [];
    const text = listing.text;
    const titleTokens = tokenizeTitle(listing.raw.title);

    if (seriesFit) {
      tags.push(seriesFit);
    }

    if (productType.label === "GM Advice" || hasAny(text, ["gm", "game master", "referee"])) {
      tags.push("GM Advice");
    }

    if (titleTokens.some((token) => token === "agency")) {
      tags.push("Agency");
    }

    if (hasAny(text, ["player choice", "choice", "decisions matter"])) {
      tags.push("Player Choice");
    }

    if (hasAny(text, ["campaign", "campaign design", "campaigns"])) {
      tags.push("Campaign Design");
    }

    if (productType.key === "rules_expansion" && hasAny(text, ["5e", "fifth edition", "compatible"])) {
      tags.push("5E");
    }

    if (productType.key === "rules_expansion" && hasAny(text, ["ancestry", "race", "species"])) {
      tags.push("Ancestry");
    }

    for (const tag of listing.existingTags) {
      if (tags.length >= 8) {
        break;
      }
      if (tag.length >= 3) {
        tags.push(tag);
      }
    }

    return dedupeList(tags).slice(0, 8);
  }

  function scoreCrossSell(baseListing, candidate, seriesFit, suggestedTags) {
    if (!candidate || !candidate.slug || candidate.slug === baseListing.raw.slug) {
      return -1;
    }

    let score = 0;
    const candidateSeries = normalizeText(candidate.series);
    const candidateLine = normalizeText(candidate.productLine);
    const candidateSystem = normalizeText(candidate.system || candidate.gameSystem);
    const baseLine = normalizeText(baseListing.raw.productLine || baseListing.raw.category);
    const baseSystem = normalizeText(baseListing.raw.system || baseListing.raw.gameSystem);
    const candidateTags = dedupeList(candidate.tags || []).map(normalizeText);
    const candidateText = normalizeText([candidate.title, candidate.subtitle, candidate.shortDescription, candidate.longDescription, candidateTags.join(" ")].join(" "));

    if (seriesFit && candidateSeries === normalizeText(seriesFit)) {
      score += 3;
    }

    if (baseLine && candidateLine && baseLine === candidateLine) {
      score += 2;
    }

    if (baseSystem && candidateSystem && baseSystem === candidateSystem) {
      score += 1;
    }

    const overlap = suggestedTags
      .map(normalizeText)
      .filter((tag) => candidateTags.includes(tag) || candidateText.includes(tag));
    score += Math.min(overlap.length, 3);

    return score;
  }

  function suggestCrossSells(listing, catalog, seriesFit, suggestedTags) {
    if (!Array.isArray(catalog) || !catalog.length) {
      return [];
    }

    return catalog
      .map((candidate) => ({
        score: scoreCrossSell(listing, candidate, seriesFit, suggestedTags),
        slug: String(candidate.slug || "").trim()
      }))
      .filter((candidate) => candidate.score > 0 && candidate.slug)
      .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
      .slice(0, 3)
      .map((candidate) => candidate.slug);
  }

  function buildReasoning(listing, productType, seriesFit, signals) {
    const reasons = [];

    if (listing.pageCount !== null) {
      const descriptor = listing.pageCount <= 12 ? "Short polished supplement" : (listing.pageCount >= 48 ? "Substantial release" : "Mid-length release");
      reasons.push(`${descriptor} at ${listing.pageCount} pages`);
    } else {
      reasons.push("Price based on product description and catalog positioning");
    }

    if (productType.label === "GM Advice") {
      reasons.push("System-neutral GM utility");
    } else {
      reasons.push(`${productType.label} pricing anchored to current category rules`);
    }

    if (seriesFit) {
      reasons.push(`Fits ${seriesFit}-style catalog pricing`);
    }

    if (signals.evergreenAdvice) {
      reasons.push("Evergreen topic with high table-use value");
    }

    if (signals.tableTooling) {
      reasons.push("Strong table-usable tools or procedures support the price");
    }

    if (signals.unfinishedMetadata) {
      reasons.push("Thin metadata or missing art pushes the recommendation downward");
    }

    return dedupeList(reasons).slice(0, 5);
  }

  function analyzeProductListing(input, options = {}) {
    const listing = normalizeListing(input || {});
    const productType = detectProductType(listing);
    const seriesFit = detectSeriesFit(listing, productType);
    const audience = detectAudience(listing, productType);
    const suggestedTags = buildSuggestedTags(listing, productType, seriesFit);
    const suggestedCrossSells = suggestCrossSells(listing, options.catalog, seriesFit, suggestedTags);

    const metadataSignals = [
      listing.coverPresent,
      listing.previewPresent,
      listing.pdfPresent,
      Boolean(String(listing.raw.subtitle || "").trim()),
      Boolean(String(listing.raw.short_description || listing.raw.shortDescription || "").trim()),
      Boolean(String(listing.raw.long_description || listing.raw.longDescription || "").trim()),
      listing.features.length >= 3,
      Boolean(String(listing.raw.legalNote || "").trim())
    ].filter(Boolean).length;

    const signals = {
      evergreenAdvice: productType.key === "advice_booklet" && (normalizeText(listing.raw.system || listing.raw.gameSystem).includes("system neutral") || normalizeText(listing.raw.system || listing.raw.gameSystem).includes("system agnotic") || hasAny(listing.text, KEYWORDS.evergreen)),
      interiorArt: listing.previewPresent && (listing.previewImages.length > 0 || Number(listing.raw.interior_image_count || listing.raw.interiorImageCount || 0) > 0),
      polishedLayout: listing.coverPresent && listing.pdfPresent && metadataSignals >= 6 && listing.pageCount !== null && listing.pageCount >= 12,
      tableTooling: hasAny(listing.text, KEYWORDS.tools),
      underFivePages: listing.pageCount !== null && listing.pageCount < 5,
      unfinishedMetadata: !listing.coverPresent || metadataSignals < 4
    };

    let workingPrice = BASE_PRICE[productType.key];

    if (signals.polishedLayout) {
      workingPrice += 1.0;
    }
    if (signals.interiorArt) {
      workingPrice += 0.5;
    }
    if (signals.evergreenAdvice) {
      workingPrice += 0.5;
    }
    if (signals.tableTooling) {
      workingPrice += 1.0;
    }
    if (signals.underFivePages) {
      workingPrice -= 1.0;
    }
    if (signals.unfinishedMetadata) {
      workingPrice -= 0.5;
    }

    const [minPrice, maxPrice] = PRICE_BANDS[productType.key] || [0.99, 39.99];
    const clampedPrice = clamp(workingPrice, minPrice, maxPrice);
    const suggestedPrice = roundToCharm(clampedPrice, minPrice, maxPrice);
    const saleBase = clamp(suggestedPrice * 0.6, 0.99, Math.max(0.99, suggestedPrice - 0.5));
    const suggestedSalePrice = roundToCharm(saleBase, 0.99, Math.max(0.99, suggestedPrice - 0.5));

    let confidence = 0.42;
    confidence += productType.certainty * 0.18;
    confidence += Math.min(metadataSignals, 6) * 0.03;
    confidence += listing.pageCount !== null ? 0.04 : 0;
    confidence += listing.coverPresent ? 0.03 : 0;
    confidence += listing.previewPresent ? 0.02 : 0;
    confidence += listing.currentPrice !== null ? 0.02 : 0;
    confidence -= signals.unfinishedMetadata ? 0.05 : 0;
    confidence = clamp(confidence, 0.35, 0.95);

    return {
      model_version: "product-advisor-v1",
      price_confidence: Number(confidence.toFixed(2)),
      product_type: productType.label,
      reasoning: buildReasoning(listing, productType, seriesFit, signals),
      series_fit: seriesFit,
      suggested_cross_sells: suggestedCrossSells,
      suggested_price: suggestedPrice,
      suggested_sale_price: suggestedSalePrice < suggestedPrice ? suggestedSalePrice : roundToCharm(Math.max(0.99, suggestedPrice - 1), 0.99, Math.max(0.99, suggestedPrice - 0.5)),
      suggested_tags: suggestedTags,
      audience
    };
  }

  const api = {
    BASE_PRICE,
    analyzeProductListing,
    formatPrice
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.TRGProductAdvisor = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
