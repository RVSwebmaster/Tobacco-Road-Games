const PUBLIC_PRODUCT_ASSET_FILES = new Set(["cover.webp", "preview.webp"]);

export function isPublicProductAsset(assetName) {
  return PUBLIC_PRODUCT_ASSET_FILES.has(String(assetName || ""));
}
