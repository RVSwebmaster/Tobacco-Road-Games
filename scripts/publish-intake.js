const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const INTAKE_MAP_PATH = path.join(ROOT, "data", "product-intake-map.json");
const SHARED_FOLDER_MAP_PATH = path.join(ROOT, "shared", "product-folder-map.mjs");

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = options.rootDir || ROOT;
  const clientPayload = loadClientPayload(options);
  const result = await applyPublishPayload(rootDir, clientPayload);
  console.log(`Published intake payload for ${result.metadata.slug}.`);
}

function parseArgs(args) {
  const options = {
    payloadPath: "",
    rootDir: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--payload" && args[index + 1]) {
      options.payloadPath = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--root" && args[index + 1]) {
      options.rootDir = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function loadClientPayload(options) {
  if (options.payloadPath) {
    return JSON.parse(fs.readFileSync(options.payloadPath, "utf8"));
  }

  if (process.env.OWNER_PUBLISH_EVENT_JSON) {
    return JSON.parse(process.env.OWNER_PUBLISH_EVENT_JSON);
  }

  throw new Error("No publish payload was provided. Use --payload <path> or OWNER_PUBLISH_EVENT_JSON.");
}

async function applyPublishPayload(rootDir, clientPayload) {
  const metadata = normalizePublishMetadata(clientPayload.metadata || {});
  const folder = normalizeFolderName(clientPayload.folder);
  if (!metadata.slug || !folder) {
    throw new Error("The publish payload must include metadata.slug and folder.");
  }

  const sharedMapPath = path.join(rootDir, "shared", "product-folder-map.mjs");
  const intakeMapPath = path.join(rootDir, "data", "product-intake-map.json");
  const productsPath = path.join(rootDir, "data", "products.json");

  const sharedFolderMap = await loadSharedFolderMap(sharedMapPath);
  const nextSharedFolderMap = {
    ...sharedFolderMap,
    [metadata.slug]: folder
  };

  const intakeMap = JSON.parse(fs.readFileSync(intakeMapPath, "utf8"));
  const nextIntakeMap = upsertIntakeMap(intakeMap, metadata);

  const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  const nextProducts = upsertProducts(products, metadata);

  fs.writeFileSync(sharedMapPath, renderSharedFolderMapModule(nextSharedFolderMap));
  fs.writeFileSync(intakeMapPath, `${JSON.stringify(nextIntakeMap, null, 2)}\n`);
  fs.writeFileSync(productsPath, `${JSON.stringify(nextProducts, null, 2)}\n`);

  return {
    folder,
    metadata
  };
}

function normalizePublishMetadata(metadata) {
  return {
    authorSlugs: Array.isArray(metadata.authorSlugs) && metadata.authorSlugs.length ? metadata.authorSlugs : ["rv-sawyer"],
    authors: Array.isArray(metadata.authors) && metadata.authors.length ? metadata.authors : ["RV Sawyer"],
    bundleEligible: Boolean(metadata.bundleEligible),
    bundleGroup: chooseText(metadata.bundleGroup, "standard-digital"),
    bundleMinPriceCents: chooseInteger(metadata.bundleMinPriceCents, 100),
    buyMode: chooseText(metadata.buyMode, "preview-only"),
    buyUrl: chooseText(metadata.buyUrl, ""),
    creationMethod: chooseText(metadata.creationMethod, "Human-authored by RV Sawyer."),
    currency: chooseText(metadata.currency, "USD"),
    excludeFromBundles: metadata.excludeFromBundles !== false,
    features: normalizeStringArray(metadata.features),
    featured: Boolean(metadata.featured),
    fileList: normalizeStringArray(metadata.fileList),
    format: normalizeStringArray(metadata.format).length ? normalizeStringArray(metadata.format) : ["PDF"],
    fulfillmentNote: chooseText(metadata.fulfillmentNote, ""),
    gameSystem: chooseText(metadata.gameSystem, ""),
    gameSystemSlug: normalizeSlug(chooseText(metadata.gameSystemSlug, metadata.gameSystem, "")),
    lastUpdated: chooseText(metadata.lastUpdated, ""),
    legalNote: chooseText(metadata.legalNote, ""),
    longDescription: chooseText(metadata.longDescription, ""),
    pageCount: chooseNullableInteger(metadata.pageCount, null),
    price: chooseText(metadata.price, ""),
    priceCents: chooseNullableInteger(metadata.priceCents, normalizePriceCents(metadata.price)),
    productLine: chooseText(metadata.productLine, ""),
    productLineSlug: normalizeSlug(chooseText(metadata.productLineSlug, metadata.productLine, "")),
    series: chooseText(metadata.series, ""),
    seriesSlug: normalizeSlug(chooseText(metadata.seriesSlug, metadata.series, "")),
    publisher: chooseText(metadata.publisher, "Tobacco Road Games"),
    relatedProducts: normalizeStringArray(metadata.relatedProducts),
    releaseDate: chooseText(metadata.releaseDate, ""),
    shortDescription: chooseText(metadata.shortDescription, ""),
    slug: normalizeSlug(metadata.slug),
    status: chooseText(metadata.status, "preview-available"),
    statusLabel: resolveStatusLabel(metadata.status),
    subtitle: chooseText(metadata.subtitle, ""),
    tags: normalizeStringArray(metadata.tags),
    title: chooseText(metadata.title, ""),
    updateEligible: metadata.updateEligible !== false,
    version: chooseText(metadata.version, "1.0")
  };
}

function upsertIntakeMap(intakeMap, metadata) {
  const next = clone(intakeMap);
  const existingProducts = Array.isArray(next.products) ? next.products : [];
  const index = existingProducts.findIndex((product) => product.slug === metadata.slug);
  const existing = index >= 0 ? clone(existingProducts[index]) : {};

  const updated = {
    ...existing,
    slug: metadata.slug,
    title: chooseText(metadata.title, existing.title, humanizeSlug(metadata.slug)),
    subtitle: chooseText(metadata.subtitle, existing.subtitle, `${metadata.title} catalog preview`),
    featured: chooseBoolean(metadata.featured, existing.featured, false),
    gameSystem: chooseText(metadata.gameSystem, existing.gameSystem, "System TBD"),
    gameSystemSlug: chooseText(metadata.gameSystemSlug, existing.gameSystemSlug, normalizeSlug(metadata.gameSystem)),
    productLine: chooseText(metadata.productLine, existing.productLine, "Other Games & Experiments"),
    productLineSlug: chooseText(metadata.productLineSlug, existing.productLineSlug, normalizeSlug(metadata.productLine)),
    series: chooseText(metadata.series, existing.series, ""),
    seriesSlug: chooseText(metadata.seriesSlug, existing.seriesSlug, normalizeSlug(metadata.series)),
    format: chooseArray(metadata.format, existing.format, ["PDF"]),
    tags: chooseArray(metadata.tags, existing.tags, ["Preview"])
  };

  if (index >= 0) {
    existingProducts[index] = updated;
  } else {
    existingProducts.push(updated);
    existingProducts.sort((left, right) => left.slug.localeCompare(right.slug));
  }

  next.products = existingProducts;
  return next;
}

function upsertProducts(products, metadata) {
  const nextProducts = clone(products);
  const index = nextProducts.findIndex((product) => product.slug === metadata.slug);
  const existing = index >= 0 ? clone(nextProducts[index]) : {};
  const title = chooseText(metadata.title, existing.title, humanizeSlug(metadata.slug));

  const updated = {
    ...existing,
    slug: metadata.slug,
    title,
    subtitle: chooseText(metadata.subtitle, existing.subtitle, `${title} catalog preview`),
    featured: chooseBoolean(metadata.featured, existing.featured, false),
    authors: chooseArray(metadata.authors, existing.authors, ["RV Sawyer"]),
    authorSlugs: chooseArray(metadata.authorSlugs, existing.authorSlugs, ["rv-sawyer"]),
    publisher: chooseText(metadata.publisher, existing.publisher, "Tobacco Road Games"),
    gameSystem: chooseText(metadata.gameSystem, existing.gameSystem, "System TBD"),
    gameSystemSlug: chooseText(metadata.gameSystemSlug, existing.gameSystemSlug, normalizeSlug(metadata.gameSystem)),
    productLine: chooseText(metadata.productLine, existing.productLine, "Other Games & Experiments"),
    productLineSlug: chooseText(metadata.productLineSlug, existing.productLineSlug, normalizeSlug(metadata.productLine)),
    series: chooseText(metadata.series, existing.series, ""),
    seriesSlug: chooseText(metadata.seriesSlug, existing.seriesSlug, normalizeSlug(metadata.series)),
    format: chooseArray(metadata.format, existing.format, ["PDF"]),
    fileList: chooseArray(metadata.fileList, existing.fileList, [`${title} PDF`]),
    pageCount: chooseNullableInteger(metadata.pageCount, existing.pageCount, null),
    price: chooseText(metadata.price, existing.price, ""),
    priceCents: chooseNullableInteger(metadata.priceCents, existing.priceCents, null),
    minimumPrice: chooseText(existing.minimumPrice, ""),
    minimumPriceCents: chooseNullableInteger(existing.minimumPriceCents, null),
    suggestedPrice: chooseText(existing.suggestedPrice, ""),
    suggestedPriceCents: chooseNullableInteger(existing.suggestedPriceCents, null),
    regularPrice: chooseText(existing.regularPrice, ""),
    regularPriceCents: chooseNullableInteger(existing.regularPriceCents, null),
    salePrice: chooseText(existing.salePrice, ""),
    salePriceCents: chooseNullableInteger(existing.salePriceCents, null),
    saleStart: chooseText(existing.saleStart, ""),
    saleEnd: chooseText(existing.saleEnd, ""),
    saleLabel: chooseText(existing.saleLabel, ""),
    saleEnabled: chooseBoolean(existing.saleEnabled, false),
    currency: chooseText(metadata.currency, existing.currency, "USD"),
    status: chooseText(metadata.status, existing.status, "preview-available"),
    statusLabel: resolveStatusLabel(chooseText(metadata.status, existing.status, "preview-available")),
    coverImage: `/product-assets/${metadata.slug}/cover.webp`,
    previewImage: `/product-assets/${metadata.slug}/preview.webp`,
    thumbnailImage: chooseText(existing.thumbnailImage, ""),
    frontCoverImage: `/product-assets/${metadata.slug}/cover.webp`,
    previewImages: chooseArray(existing.previewImages, []),
    previewPdf: chooseText(existing.previewPdf, ""),
    teaserVideo: chooseText(existing.teaserVideo, ""),
    buyMode: chooseText(metadata.buyMode, existing.buyMode, "preview-only"),
    buyUrl: chooseText(metadata.buyUrl, existing.buyUrl, ""),
    fulfillmentNote: chooseText(metadata.fulfillmentNote, existing.fulfillmentNote, ""),
    shortDescription: chooseText(metadata.shortDescription, existing.shortDescription, "Product summary coming soon."),
    longDescription: chooseText(metadata.longDescription, existing.longDescription, "Product summary coming soon."),
    features: chooseArray(metadata.features, existing.features, []),
    tags: chooseArray(metadata.tags, existing.tags, []),
    creationMethod: chooseText(metadata.creationMethod, existing.creationMethod, "Human-authored by RV Sawyer."),
    legalNote: chooseText(metadata.legalNote, existing.legalNote, ""),
    version: chooseText(metadata.version, existing.version, "1.0"),
    releaseDate: chooseText(metadata.releaseDate, existing.releaseDate, ""),
    lastUpdated: chooseText(metadata.lastUpdated, existing.lastUpdated, metadata.releaseDate, ""),
    relatedProducts: chooseArray(metadata.relatedProducts, existing.relatedProducts, []),
    libraryEligible: chooseBoolean(existing.libraryEligible, true),
    updateEligible: chooseBoolean(existing.updateEligible, true),
    bundleEligible: chooseBoolean(existing.bundleEligible, false),
    bundleMinPriceCents: chooseNullableInteger(existing.bundleMinPriceCents, 100),
    bundleGroup: chooseText(existing.bundleGroup, "standard-digital"),
    allowSeasonalBundle: chooseBoolean(existing.allowSeasonalBundle, false),
    excludeFromBundles: chooseBoolean(existing.excludeFromBundles, true)
  };

  if (index >= 0) {
    nextProducts[index] = updated;
  } else {
    nextProducts.push(updated);
  }

  return nextProducts;
}

async function loadSharedFolderMap(modulePath) {
  const moduleUrl = `${pathToFileURL(modulePath).href}?cacheBust=${Date.now()}`;
  const imported = await import(moduleUrl);
  return imported.PRODUCT_FOLDER_MAP || {};
}

function renderSharedFolderMapModule(folderMap) {
  const entries = Object.keys(folderMap)
    .sort((left, right) => left.localeCompare(right))
    .map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(folderMap[slug])}`);

  return `export const PRODUCT_FOLDER_MAP = Object.freeze({
${entries.join(",\n")}
});

export function getFolderForSlug(slug) {
  return PRODUCT_FOLDER_MAP[normalizeSlug(slug)] || "";
}

export function hasFolderForSlug(slug) {
  return Boolean(getFolderForSlug(slug));
}

export function listProductFolderEntries() {
  return Object.entries(PRODUCT_FOLDER_MAP);
}

export function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}
`;
}

function resolveStatusLabel(status) {
  const labelMap = {
    "available-direct": "Available Direct",
    "coming-soon": "Coming Soon",
    "free-download": "Free Download",
    "legacy-edition": "Legacy Edition",
    "legacy-not-for-sale": "Legacy Not For Sale",
    "pay-what-you-want": "Pay What You Want",
    "preview-available": "Preview Available",
    "preview-only": "Preview Only",
    "revised-edition-pending": "Revised Edition Pending",
    retired: "Retired"
  };
  return labelMap[String(status || "").trim()] || "Unavailable";
}

function normalizeFolderName(value) {
  return String(value || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizePriceCents(value) {
  const numeric = Number(String(value || "").trim());
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function chooseText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function chooseArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value;
    }
  }
  return [];
}

function chooseBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return false;
}

function chooseInteger(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value;
    }
  }
  return 0;
}

function chooseNullableInteger(...values) {
  for (const value of values) {
    if (value === null) {
      return null;
    }

    if (Number.isInteger(value)) {
      return value;
    }
  }
  return null;
}

function humanizeSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SHARED_FOLDER_MAP_PATH,
  applyPublishPayload,
  normalizePublishMetadata,
  renderSharedFolderMapModule
};
