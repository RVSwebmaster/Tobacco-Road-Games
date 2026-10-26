import * as pdfjsLib from '/assets/vendor/pdfjs/pdf.mjs';
import {
  DEFAULT_WEBP_RENDER_OPTIONS,
  calculatePdfRenderSize,
  getDefaultPdfImagePages,
  makePdfWebpFilename,
  normalizePdfPageNumber
} from '/shared/product-pdf-image-utils.mjs';

export { makePdfWebpFilename };

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.mjs';

const canvasToWebp = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob || blob.type !== 'image/webp' || !blob.size) {
      reject(new Error('This browser could not create a WebP image from the selected page.'));
      return;
    }
    resolve(blob);
  }, 'image/webp', quality);
});

export async function openPdfImageExtraction(file, options = {}) {
  if (!(file instanceof Blob)) throw new TypeError('Select a local PDF before extracting images.');
  const fileName = String(file.name || 'product.pdf');
  if (file.type && file.type !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
    throw new TypeError('The selected review file is not a PDF.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, stopAtErrors: false, useWorkerFetch: true });
  const pdf = await loadingTask.promise;
  let destroyed = false;

  return {
    fileName,
    pageCount: pdf.numPages,
    defaults: getDefaultPdfImagePages(pdf.numPages),
    async renderPage(pageNumber, renderOptions = {}) {
      if (destroyed) throw new Error('The PDF image extraction session is closed.');
      const normalizedPage = normalizePdfPageNumber(pageNumber, pdf.numPages);
      const page = await pdf.getPage(normalizedPage);
      let canvas;
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const dimensions = calculatePdfRenderSize(baseViewport, { ...options, ...renderOptions });
        const viewport = page.getViewport({ scale: dimensions.scale });
        canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('A browser canvas is unavailable for PDF image extraction.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const quality = Math.min(1, Math.max(0.6, Number(renderOptions.quality || options.quality || DEFAULT_WEBP_RENDER_OPTIONS.quality)));
        const blob = await canvasToWebp(canvas, quality);
        return { blob, height: canvas.height, pageNumber: normalizedPage, quality, width: canvas.width };
      } finally {
        page.cleanup();
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await pdf.destroy();
    }
  };
}
