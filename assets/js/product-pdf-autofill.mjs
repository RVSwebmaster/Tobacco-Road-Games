import * as pdfjsLib from "/assets/vendor/pdfjs/pdf.mjs";
import { inferProductListingFromPdf, selectPdfPages } from "/shared/product-pdf-prefill.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.mjs";

const METADATA_KEYS = Object.freeze([
  "dc:title",
  "dc:description",
  "dc:language",
  "pdf:keywords",
  "xmp:CreatorTool"
]);

const collectMetadata = async (document) => {
  const result = {};
  try {
    const metadata = await document.getMetadata();
    for (const [key, value] of Object.entries(metadata?.info || {})) {
      if (typeof value === "string" || typeof value === "number") result[key] = String(value);
    }
    for (const key of METADATA_KEYS) {
      const value = metadata?.metadata?.get?.(key);
      if (value) result[key] = String(value);
    }
  } catch {
    // Missing or malformed document metadata must not prevent readable-text extraction.
  }
  return result;
};

const extractPageText = async (document, pageNumber) => {
  const page = await document.getPage(pageNumber);
  try {
    const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
    const lines = [];
    let currentLine = "";
    let previousY = null;

    for (const item of content.items || []) {
      if (!item || typeof item.str !== "string") continue;
      const text = item.str.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
      const startsNewLine = currentLine && previousY !== null && y !== null && Math.abs(y - previousY) > 2.5;
      if (startsNewLine) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
      currentLine += `${currentLine ? " " : ""}${text}`;
      previousY = y;
      if (item.hasEOL) {
        lines.push(currentLine.trim());
        currentLine = "";
        previousY = null;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    return lines.filter(Boolean).join("\n");
  } finally {
    page.cleanup();
  }
};

export async function readProductPdf(file, options = {}) {
  if (!(file instanceof Blob)) throw new TypeError("Choose a PDF file before reading it.");
  const fileName = String(file.name || "");
  const mediaType = String(file.type || "").toLowerCase();
  if (mediaType && mediaType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
    throw new TypeError("The selected file is not a PDF.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    isEvalSupported: false,
    stopAtErrors: false,
    useWorkerFetch: true
  });
  let document;
  try {
    document = await loadingTask.promise;
    const pageNumbers = selectPdfPages(document.numPages, options.pageSelection);
    const metadata = await collectMetadata(document);
    const pages = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      options.onProgress?.({
        current: index + 1,
        pageNumber,
        total: pageNumbers.length
      });
      pages.push({ pageNumber, text: await extractPageText(document, pageNumber) });
    }
    return {
      ...inferProductListingFromPdf({ metadata, pages, pageCount: document.numPages }),
      fileName,
      fileSize: Number(file.size || 0),
      pageCount: document.numPages,
      sampledPageCount: pageNumbers.length
    };
  } finally {
    if (document) {
      try {
        await document.destroy();
      } catch {
        // PDF.js may already have released the worker after an extraction error.
      }
    } else {
      await loadingTask.destroy();
    }
  }
}
