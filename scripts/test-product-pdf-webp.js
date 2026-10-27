const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const utils = await import(pathToFileURL(path.join(ROOT, 'shared', 'product-pdf-image-utils.mjs')));
  assert.deepEqual(utils.getDefaultPdfImagePages(122), { frontPage: 1, backPage: 122 });
  assert.equal(utils.normalizePdfPageNumber(0, 122), 1);
  assert.equal(utils.normalizePdfPageNumber(999, 122), 122);
  assert.equal(utils.normalizePdfPageNumber('not-a-page', 122, 7), 7);
  assert.equal(utils.makePdfWebpFilename('front', 1), 'front-cover-page-1.webp');
  assert.equal(utils.makePdfWebpFilename('back', 122), 'back-cover-page-122.webp');
  assert.equal(utils.makePdfWebpFilename('preview', 17), 'preview-page-17.webp');

  const portrait = utils.calculatePdfRenderSize({ width: 612, height: 792 });
  assert.equal(portrait.height, 2000);
  assert.ok(portrait.width > 1500 && portrait.width < 1600);
  assert.ok(portrait.width * portrait.height <= utils.DEFAULT_WEBP_RENDER_OPTIONS.maxPixels);
  assert.ok(Math.abs((portrait.width / portrait.height) - (612 / 792)) < 0.001);
  const wide = utils.calculatePdfRenderSize({ width: 2400, height: 1200 });
  assert.deepEqual({ width: wide.width, height: wide.height }, { width: 2000, height: 1000 });

  const browserModule = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product-pdf-images.mjs'), 'utf8');
  assert.match(browserModule, /\/assets\/vendor\/pdfjs\/pdf\.mjs/);
  assert.match(browserModule, /canvas\.toBlob/);
  assert.match(browserModule, /image\/webp/);
  assert.doesNotMatch(browserModule, /https?:\/\//);
  assert.doesNotMatch(browserModule, /fetch\s*\(/);

  const intakeScript = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'product-intake.js'), 'utf8');
  assert.match(intakeScript, /renderPdfImageCandidate\("front"\)/);
  assert.match(intakeScript, /renderPdfImageCandidate\("back"\)/);
  assert.doesNotMatch(intakeScript, /renderPdfImageCandidate\("preview"\)/, 'Extract Covers must not automatically generate an interior preview image.');
  assert.match(intakeScript, /Could not generate the \$\{failed\}/, 'Partial extraction failures must remain visible instead of being overwritten by a success message.');

  const realPdfPath = process.env.TRG_PDF_WEBP_TEST_FILE;
  if (realPdfPath) await verifyRealPdfRendering(realPdfPath, utils);
  console.log('Product PDF WebP extraction tests passed.');
}

async function verifyRealPdfRendering(pdfPath, utils) {
  const canvasApi = require('@napi-rs/canvas');
  const { createCanvas } = canvasApi;
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (!globalThis[name] && canvasApi[name]) globalThis[name] = canvasApi[name];
  }
  const pdfjs = await import(pathToFileURL(path.join(ROOT, 'assets', 'vendor', 'pdfjs', 'pdf.mjs')));
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pageCount = document.numPages;
  assert.ok(pageCount > 1);
  for (const pageNumber of [1, pageCount]) {
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const size = utils.calculatePdfRenderSize(base, { maxDimension: 1200, maxPixels: 2_000_000 });
    const canvas = createCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    await page.render({ canvasContext: context, viewport: page.getViewport({ scale: size.scale }) }).promise;
    const webp = await canvas.encode('webp', 90);
    assert.ok(webp.length > 1000);
    assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.ok(Math.abs((size.width / size.height) - (base.width / base.height)) < 0.002);
    page.cleanup();
  }
  await document.destroy();
  console.log(`Real PDF WebP verification passed: ${pageCount} pages, first and last rendered.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
