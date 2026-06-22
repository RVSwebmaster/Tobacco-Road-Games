export const PRODUCT_FOLDER_MAP = Object.freeze({
  "circle-of-cinder": "circleofcinder",
  "final-flame": "finalflame",
  "mouthy-monsters": "mouthy-monsters",
  "path-of-the-janky": "path of the janky",
  ringbound: "ringbound",
  "silence-and-the-spotlight": "silenceandthespotlight",
  sirrocans: "sirrocans",
  spriggans: "spriggans",
  "tablecraft-primer": "Tablecraft Primer",
  yojimbo: "yojimbo"
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
