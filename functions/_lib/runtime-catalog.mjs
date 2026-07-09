import { RUNTIME_CATALOG_PRODUCTS, RUNTIME_PRICING_POLICY } from "../../shared/runtime-catalog.mjs";

let runtimeCatalogMap = null;

export function getRuntimeCatalogProducts() {
  return RUNTIME_CATALOG_PRODUCTS;
}

export function getRuntimeCatalogProduct(slug) {
  return getRuntimeCatalogMap().get(normalizeSlug(slug)) || null;
}

export function getRuntimeCatalogMap() {
  if (!runtimeCatalogMap) {
    runtimeCatalogMap = new Map(
      RUNTIME_CATALOG_PRODUCTS.map((product) => [normalizeSlug(product.slug), product])
    );
  }
  return runtimeCatalogMap;
}

export function getRuntimePricingPolicy() {
  return RUNTIME_PRICING_POLICY;
}

export function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}
