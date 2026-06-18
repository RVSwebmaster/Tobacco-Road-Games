const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const INTAKE_MAP_PATH = path.join(ROOT, "data", "product-intake-map.json");
const BUILD_SCRIPT_PATH = path.join(ROOT, "scripts", "build-store.js");

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.manifestPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const intakeMap = JSON.parse(fs.readFileSync(INTAKE_MAP_PATH, "utf8"));
  const existingProducts = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const objectKeys = loadObjectKeys(options.manifestPath);
  const bucketIndex = groupKeysByFolder(objectKeys);
  const syncResult = syncProducts(existingProducts, intakeMap, bucketIndex);

  if (options.write) {
    fs.writeFileSync(PRODUCTS_PATH, `${JSON.stringify(syncResult.products, null, 2)}\n`);
  }

  if (options.reportPath) {
    fs.writeFileSync(options.reportPath, `${JSON.stringify(syncResult.report, null, 2)}\n`);
  }

  printReport(syncResult.report, {
    manifestPath: options.manifestPath,
    wroteProducts: options.write,
    wroteReport: options.reportPath
  });

  if (options.write && options.build) {
    const build = spawnSync(process.execPath, [BUILD_SCRIPT_PATH], {
      cwd: ROOT,
      stdio: "inherit"
    });

    if (build.status !== 0) {
      process.exitCode = build.status || 1;
    }
  }
}

function parseArgs(args) {
  const options = {
    manifestPath: "",
    write: true,
    build: false,
    reportPath: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      options.write = false;
      continue;
    }

    if (arg === "--build") {
      options.build = true;
      continue;
    }

    if (arg === "--report" && args[index + 1]) {
      options.reportPath = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (!options.manifestPath) {
      options.manifestPath = path.resolve(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/sync-r2-products.js <manifest-path> [--dry-run] [--build] [--report <report-path>]");
  console.log("");
  console.log("Manifest input can be:");
  console.log("  - JSON object listing export");
  console.log("  - JSON array of object keys");
  console.log("  - Plain text file with one object key per line");
}

function loadObjectKeys(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const looksJson = raw.startsWith("{") || raw.startsWith("[");
  const objectKeys = looksJson
    ? normalizeObjectKeys(extractObjectKeys(JSON.parse(raw)))
    : normalizeObjectKeys(raw.split(/\r?\n/));

  if (!objectKeys.length) {
    throw new Error(`No object keys found in manifest: ${manifestPath}`);
  }

  return objectKeys;
}

function extractObjectKeys(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractObjectKeys(entry));
  }

  if (typeof value === "string") {
    return [value];
  }

  if (typeof value !== "object") {
    return [];
  }

  const directKey = [
    value.key,
    value.name,
    value.objectKey,
    value.object_key,
    value.path
  ].find((entry) => typeof entry === "string" && entry.trim());

  if (directKey) {
    return [directKey];
  }

  const nestedArrays = [
    value.objects,
    value.items,
    value.keys,
    value.result,
    value.data,
    value.entries
  ].filter(Boolean);

  return nestedArrays.flatMap((entry) => extractObjectKeys(entry));
}

function normalizeObjectKeys(keys) {
  return [...new Set(keys
    .map((entry) => String(entry || "").trim().replace(/\\/g, "/"))
    .filter(Boolean))];
}

function groupKeysByFolder(objectKeys) {
  const grouped = new Map();

  for (const key of objectKeys) {
    const parts = key.split("/").filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const folder = parts.shift();
    const filePath = parts.join("/");
    if (!grouped.has(folder)) {
      grouped.set(folder, []);
    }
    grouped.get(folder).push(filePath);
  }

  return grouped;
}

function syncProducts(existingProducts, intakeMap, bucketIndex) {
  const globalDefaults = intakeMap.globalDefaults || {};
  const configuredProducts = Array.isArray(intakeMap.products) ? intakeMap.products : [];
  const existingBySlug = new Map(existingProducts.map((product) => [product.slug, clone(product)]));
  const plannedBySlug = new Map();
  const report = {
    added: [],
    updated: [],
    unchanged: [],
    skipped: [],
    missingPreview: [],
    missingPdf: [],
    warnings: []
  };

  for (const definition of configuredProducts) {
    const bucketFiles = bucketIndex.get(definition.folder) || [];
    const assetState = detectBucketAssets(bucketFiles);

    if (!assetState.hasCover) {
      report.skipped.push({
        slug: definition.slug,
        title: definition.title,
        reason: `Missing cover.webp in bucket folder ${definition.folder}`
      });
      continue;
    }

    if (!assetState.hasPreview) {
      report.missingPreview.push({
        slug: definition.slug,
        title: definition.title,
        folder: definition.folder
      });
    }

    if (!assetState.mainPdf && !assetState.samplePdf) {
      report.missingPdf.push({
        slug: definition.slug,
        title: definition.title,
        folder: definition.folder
      });
    }

    const existing = existingBySlug.get(definition.slug);
    const nextProduct = buildProductRecord(existing, definition, globalDefaults, assetState);
    plannedBySlug.set(definition.slug, nextProduct);

    if (!existing) {
      report.added.push({
        slug: definition.slug,
        title: nextProduct.title,
        folder: definition.folder
      });
      continue;
    }

    if (JSON.stringify(existing) === JSON.stringify(nextProduct)) {
      report.unchanged.push({
        slug: definition.slug,
        title: nextProduct.title
      });
      continue;
    }

    report.updated.push({
      slug: definition.slug,
      title: nextProduct.title,
      folder: definition.folder
    });
  }

  const mergedProducts = existingProducts.map((product) => plannedBySlug.get(product.slug) || product);
  for (const definition of configuredProducts) {
    if (!existingBySlug.has(definition.slug) && plannedBySlug.has(definition.slug)) {
      mergedProducts.push(plannedBySlug.get(definition.slug));
    }
  }

  return {
    products: mergedProducts,
    report
  };
}

function detectBucketAssets(bucketFiles) {
  const pdfFiles = bucketFiles.filter((file) => /\.pdf$/i.test(file));
  const samplePdf = pdfFiles.find((file) => /(sample|preview|quickstart|excerpt|teaser)/i.test(file)) || "";
  const mainPdf = pdfFiles.find((file) => file !== samplePdf) || "";

  return {
    hasCover: bucketFiles.includes("cover.webp"),
    hasPreview: bucketFiles.includes("preview.webp"),
    pdfFiles,
    samplePdf,
    mainPdf
  };
}

function buildProductRecord(existing, definition, globalDefaults, assetState) {
  const slug = definition.slug;
  const title = chooseValue(existing?.title, definition.title, humanizeSlug(slug));
  const defaultFormat = chooseValue(existing?.format?.length ? existing.format : null, definition.format, assetState.mainPdf || assetState.samplePdf ? ["PDF"] : []);
  const coverImage = chooseValue(
    definition.coverImageOverride,
    existing?.coverImage,
    assetState.hasCover ? `/product-assets/${slug}/cover.webp` : ""
  );
  const frontCoverImage = chooseValue(
    definition.frontCoverImageOverride,
    existing?.frontCoverImage,
    coverImage
  );
  const previewImage = assetState.hasPreview
    ? `/product-assets/${slug}/preview.webp`
    : chooseValue(existing?.previewImage, definition.previewImage, "");
  const fileLabel = resolveFileLabel(title, definition, assetState);
  const status = resolveStatus(existing, definition, assetState, globalDefaults);
  const statusLabel = definition.statusLabel || globalDefaults.statusLabel || humanizeStatus(status);
  const buyMode = resolveBuyMode(existing, definition, assetState, globalDefaults);

  return {
    slug,
    title,
    subtitle: chooseValue(existing?.subtitle, definition.subtitle, `${title} catalog preview`),
    featured: chooseValue(existing?.featured, definition.featured, false),
    authors: chooseArray(existing?.authors, definition.authors, globalDefaults.authors),
    authorSlugs: chooseArray(existing?.authorSlugs, definition.authorSlugs, globalDefaults.authorSlugs),
    publisher: chooseValue(existing?.publisher, definition.publisher, globalDefaults.publisher, "Tobacco Road Games"),
    gameSystem: chooseValue(existing?.gameSystem, definition.gameSystem, "System TBD"),
    gameSystemSlug: chooseValue(existing?.gameSystemSlug, definition.gameSystemSlug, slugify(chooseValue(existing?.gameSystem, definition.gameSystem, "System TBD"))),
    productLine: chooseValue(existing?.productLine, definition.productLine, "Other Games & Experiments"),
    productLineSlug: chooseValue(existing?.productLineSlug, definition.productLineSlug, slugify(chooseValue(existing?.productLine, definition.productLine, "Other Games & Experiments"))),
    format: defaultFormat,
    fileList: chooseArray(existing?.fileList, definition.fileList, fileLabel ? [fileLabel] : []),
    pageCount: chooseNullableNumber(existing?.pageCount, definition.pageCount, null),
    price: chooseValue(existing?.price, definition.price, ""),
    priceCents: chooseNullableNumber(existing?.priceCents, definition.priceCents, null),
    minimumPrice: chooseValue(existing?.minimumPrice, definition.minimumPrice, ""),
    minimumPriceCents: chooseNullableNumber(existing?.minimumPriceCents, definition.minimumPriceCents, null),
    suggestedPrice: chooseValue(existing?.suggestedPrice, definition.suggestedPrice, ""),
    suggestedPriceCents: chooseNullableNumber(existing?.suggestedPriceCents, definition.suggestedPriceCents, null),
    regularPrice: chooseValue(existing?.regularPrice, definition.regularPrice, ""),
    regularPriceCents: chooseNullableNumber(existing?.regularPriceCents, definition.regularPriceCents, null),
    salePrice: chooseValue(existing?.salePrice, definition.salePrice, ""),
    salePriceCents: chooseNullableNumber(existing?.salePriceCents, definition.salePriceCents, null),
    saleStart: chooseValue(existing?.saleStart, definition.saleStart, ""),
    saleEnd: chooseValue(existing?.saleEnd, definition.saleEnd, ""),
    saleLabel: chooseValue(existing?.saleLabel, definition.saleLabel, ""),
    saleEnabled: chooseValue(existing?.saleEnabled, definition.saleEnabled, false),
    currency: chooseValue(existing?.currency, definition.currency, globalDefaults.currency, "USD"),
    status,
    statusLabel,
    coverImage,
    previewImage,
    thumbnailImage: chooseValue(existing?.thumbnailImage, definition.thumbnailImage, ""),
    frontCoverImage,
    previewImages: chooseArray(existing?.previewImages, definition.previewImages, []),
    previewPdf: chooseValue(existing?.previewPdf, definition.previewPdf, ""),
    teaserVideo: chooseValue(existing?.teaserVideo, definition.teaserVideo, ""),
    buyMode,
    buyUrl: chooseValue(existing?.buyUrl, definition.buyUrl, globalDefaults.buyUrl, ""),
    fulfillmentNote: chooseValue(existing?.fulfillmentNote, definition.fulfillmentNote, globalDefaults.fulfillmentNote, ""),
    shortDescription: chooseValue(existing?.shortDescription, definition.shortDescription, globalDefaults.shortDescription, "Product summary coming soon."),
    longDescription: chooseValue(existing?.longDescription, definition.longDescription, globalDefaults.longDescription, "Product summary coming soon."),
    features: chooseArray(existing?.features, definition.features, []),
    tags: chooseArray(existing?.tags, definition.tags, []),
    creationMethod: chooseValue(existing?.creationMethod, definition.creationMethod, globalDefaults.creationMethod, "Human-authored by RV Sawyer."),
    legalNote: chooseValue(existing?.legalNote, definition.legalNote, globalDefaults.legalNote, ""),
    version: chooseValue(existing?.version, definition.version, globalDefaults.version, "2026 catalog preview"),
    releaseDate: chooseValue(existing?.releaseDate, definition.releaseDate, ""),
    lastUpdated: chooseValue(existing?.lastUpdated, definition.lastUpdated, ""),
    relatedProducts: chooseArray(existing?.relatedProducts, definition.relatedProducts, []),
    libraryEligible: chooseValue(existing?.libraryEligible, definition.libraryEligible, globalDefaults.libraryEligible, true),
    updateEligible: chooseValue(existing?.updateEligible, definition.updateEligible, globalDefaults.updateEligible, true),
    bundleEligible: chooseValue(existing?.bundleEligible, definition.bundleEligible, globalDefaults.bundleEligible, false),
    bundleMinPriceCents: chooseNullableNumber(existing?.bundleMinPriceCents, definition.bundleMinPriceCents, globalDefaults.bundleMinPriceCents ?? 100),
    bundleGroup: chooseValue(existing?.bundleGroup, definition.bundleGroup, globalDefaults.bundleGroup, "standard-digital"),
    allowSeasonalBundle: chooseValue(existing?.allowSeasonalBundle, definition.allowSeasonalBundle, globalDefaults.allowSeasonalBundle, false),
    excludeFromBundles: chooseValue(existing?.excludeFromBundles, definition.excludeFromBundles, globalDefaults.excludeFromBundles, true)
  };
}

function resolveFileLabel(title, definition, assetState) {
  if (Array.isArray(definition.fileList) && definition.fileList.length) {
    return definition.fileList[0];
  }

  const pdfName = assetState.mainPdf || assetState.samplePdf;
  if (!pdfName) {
    return "PDF details coming soon";
  }

  return `${title} PDF`;
}

function resolveStatus(existing, definition, assetState, globalDefaults) {
  if (definition.status) {
    return definition.status;
  }

  if (existing?.status && existing.status !== "coming-soon") {
    return existing.status;
  }

  if (assetState.hasCover) {
    return globalDefaults.status || "preview-available";
  }

  return "coming-soon";
}

function resolveBuyMode(existing, definition, assetState, globalDefaults) {
  if (definition.buyMode) {
    return definition.buyMode;
  }

  if (existing?.buyMode && existing.buyMode !== "coming-soon") {
    return existing.buyMode;
  }

  if (definition.buyUrl || existing?.buyUrl) {
    return "fixed-price";
  }

  if (assetState.hasCover) {
    return globalDefaults.buyMode || "preview-only";
  }

  return "coming-soon";
}

function chooseValue(...values) {
  for (const value of values) {
    if (value === false || value === true) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return values.at(-1);
}

function chooseArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value;
    }
  }

  return [];
}

function chooseNullableNumber(...values) {
  for (const value of values) {
    if (value === null) {
      return null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return values.at(-1);
}

function humanizeSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeStatus(status) {
  return String(status || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function printReport(report, options) {
  console.log(`R2 product sync manifest: ${options.manifestPath}`);
  console.log(options.wroteProducts ? "products.json updated." : "Dry run only. products.json not changed.");
  if (options.wroteReport) {
    console.log(`Report written to ${options.wroteReport}`);
  }
  console.log("");
  console.log(`Added: ${report.added.length}`);
  console.log(`Updated: ${report.updated.length}`);
  console.log(`Unchanged: ${report.unchanged.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Missing preview.webp: ${report.missingPreview.length}`);
  console.log(`Missing PDF: ${report.missingPdf.length}`);

  if (report.added.length) {
    console.log("");
    console.log("Added products:");
    for (const entry of report.added) {
      console.log(`- ${entry.title} (${entry.slug})`);
    }
  }

  if (report.updated.length) {
    console.log("");
    console.log("Updated products:");
    for (const entry of report.updated) {
      console.log(`- ${entry.title} (${entry.slug})`);
    }
  }

  if (report.skipped.length) {
    console.log("");
    console.log("Skipped products:");
    for (const entry of report.skipped) {
      console.log(`- ${entry.title} (${entry.slug}): ${entry.reason}`);
    }
  }

  if (report.missingPreview.length) {
    console.log("");
    console.log("Missing preview.webp:");
    for (const entry of report.missingPreview) {
      console.log(`- ${entry.title} (${entry.slug}) in ${entry.folder}`);
    }
  }

  if (report.missingPdf.length) {
    console.log("");
    console.log("Missing PDF:");
    for (const entry of report.missingPdf) {
      console.log(`- ${entry.title} (${entry.slug}) in ${entry.folder}`);
    }
  }
}
