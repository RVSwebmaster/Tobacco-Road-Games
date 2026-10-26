export const DEFAULT_WEBP_RENDER_OPTIONS = Object.freeze({
  maxDimension: 2000,
  maxPixels: 8_000_000,
  maxScale: 3,
  quality: 0.9
});

export function getDefaultPdfImagePages(pageCount) {
  const total = Math.max(1, Math.floor(Number(pageCount) || 1));
  return { frontPage: 1, backPage: total };
}

export function normalizePdfPageNumber(value, pageCount, fallback = 1) {
  const total = Math.max(1, Math.floor(Number(pageCount) || 1));
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return Math.min(total, Math.max(1, Math.floor(Number(fallback) || 1)));
  return Math.min(total, Math.max(1, numeric));
}

export function calculatePdfRenderSize(viewport, options = {}) {
  const width = Number(viewport?.width || 0);
  const height = Number(viewport?.height || 0);
  if (!(width > 0) || !(height > 0)) throw new TypeError('The PDF page has invalid dimensions.');
  const maxDimension = Math.max(640, Number(options.maxDimension || DEFAULT_WEBP_RENDER_OPTIONS.maxDimension));
  const maxPixels = Math.max(1_000_000, Number(options.maxPixels || DEFAULT_WEBP_RENDER_OPTIONS.maxPixels));
  const maxScale = Math.max(1, Number(options.maxScale || DEFAULT_WEBP_RENDER_OPTIONS.maxScale));
  const dimensionScale = maxDimension / Math.max(width, height);
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.max(0.1, Math.min(maxScale, dimensionScale, pixelScale));
  return {
    height: Math.max(1, Math.round(height * scale)),
    scale,
    width: Math.max(1, Math.round(width * scale))
  };
}

export function makePdfWebpFilename(role, pageNumber) {
  const safeRole = role === 'preview' ? 'preview' : (role === 'back' ? 'back-cover' : 'front-cover');
  return `${safeRole}-page-${Math.max(1, Math.floor(Number(pageNumber) || 1))}.webp`;
}
