import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pricingModule from "../shared/pricing.js";

const { TAX_INCLUSIVE_PRICING_POLICY, getEffectivePriceDetails } = pricingModule;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data", "products.json");
const OUTPUT_PATH = path.join(ROOT, "shared", "runtime-catalog.mjs");

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  buildRuntimeCatalog().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export async function buildRuntimeCatalog(rootDir = ROOT) {
  const dataPath = path.join(rootDir, "data", "products.json");
  const outputPath = path.join(rootDir, "shared", "runtime-catalog.mjs");
  const products = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const runtimeProducts = products
    .map((product) => buildRuntimeCatalogEntry(product))
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const moduleBody = renderRuntimeCatalogModule(runtimeProducts);
  fs.writeFileSync(outputPath, moduleBody);
  return {
    outputPath,
    products: runtimeProducts
  };
}

function buildRuntimeCatalogEntry(product) {
  const authors = Array.isArray(product.authors)
    ? product.authors.map((author) => String(author || "").trim()).filter(Boolean)
    : [];
  const authorSlugs = Array.isArray(product.authorSlugs)
    ? product.authorSlugs.map((slug) => String(slug || "").trim()).filter(Boolean)
    : [];
  const price = getEffectivePriceDetails(product);

  return {
    authorDisplay: authors.join(", "),
    authorSlugs,
    authors,
    buyMode: String(product.buyMode || "").trim(),
    coverUrl: String(product.coverImage || product.frontCoverImage || "").trim(),
    currency: price.currency,
    effectivePriceCents: price.effectivePriceCents,
    fulfillmentEligible: product.libraryEligible !== false,
    lastUpdated: String(product.lastUpdated || "").trim(),
    listedPriceCents: Number.isInteger(product.priceCents) ? product.priceCents : null,
    priceCents: price.regularPriceCents,
    saleActive: price.saleActive,
    saleEnabled: Boolean(product.saleEnabled),
    saleEnd: String(product.saleEnd || "").trim(),
    salePriceCents: price.salePriceCents,
    saleStart: String(product.saleStart || "").trim(),
    slug: String(product.slug || "").trim(),
    status: String(product.status || "").trim(),
    title: String(product.title || "").trim(),
    updateEligible: product.updateEligible !== false,
    version: String(product.version || "").trim()
  };
}

function renderRuntimeCatalogModule(products) {
  return `// Generated from data/products.json by scripts/build-runtime-catalog.mjs.
// Do not hand-edit this file.

export const RUNTIME_PRICING_POLICY = Object.freeze(${JSON.stringify(TAX_INCLUSIVE_PRICING_POLICY, null, 2)});

export const RUNTIME_CATALOG_PRODUCTS = Object.freeze(${JSON.stringify(products, null, 2)});
`;
}
