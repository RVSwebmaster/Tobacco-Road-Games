export const PRODUCT_FOLDER_MAP = Object.freeze({});

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
