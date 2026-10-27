const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

function buildPdf(pageLines) {
  const escapePdfText = (value) => String(value).replace(/([\\()])/g, "\\$1");
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const pageObjectNumbers = [];
  for (const lines of pageLines) {
    const pageObject = objects.length;
    const contentObject = pageObject + 1;
    pageObjectNumbers.push(pageObject);
    const commands = ["BT", "/F1 12 Tf", "72 740 Td"];
    lines.forEach((line, index) => {
      if (index) commands.push("0 -18 Td");
      commands.push(`(${escapePdfText(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(output);
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, "binary"));
}

async function extractPageText(document, pageNumber) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str).join(" ");
  page.cleanup();
  return text;
}

async function main() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  const intake = fs.readFileSync(path.join(ROOT, "assets", "js", "product-intake.js"), "utf8");
  const browserReader = fs.readFileSync(path.join(ROOT, "assets", "js", "product-pdf-autofill.mjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  assert.equal((html.match(/id="product-pdf-file"/g) || []).length, 1, "Product Intake must use one retained PDF file input.");
  assert.ok(html.indexOf("Read PDF and Prefill Listing") < html.indexOf("Product details"), "PDF autofill belongs near the beginning of the listing workflow.");
  assert.match(html, /product-intake\.js\?v=20261026-pdf-images1/, "Product Intake must load the current PDF review and image-extraction runtime.");
  for (const id of [
    "read-pdf-prefill-button",
    "pdf-prefill-populated-list",
    "pdf-prefill-manual-list",
    "pdf-prefill-review-list",
    "apply-pdf-prefill-button"
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.equal(packageJson.dependencies["pdfjs-dist"], "4.10.38", "PDF.js must remain pinned to an exact version.");
  for (const relativePath of [
    "assets/vendor/pdfjs/pdf.mjs",
    "assets/vendor/pdfjs/pdf.worker.mjs",
    "assets/vendor/pdfjs/LICENSE.txt"
  ]) assert.ok(fs.existsSync(path.join(ROOT, relativePath)), `Missing locally bundled PDF.js asset: ${relativePath}`);
  assert.match(browserReader, /\/assets\/vendor\/pdfjs\/pdf\.mjs/);
  assert.match(browserReader, /\/assets\/vendor\/pdfjs\/pdf\.worker\.mjs/);
  assert.doesNotMatch(browserReader, /https?:\/\//, "Browser extraction must not call an external PDF or AI service.");
  assert.match(intake, /fields\.pdfFile\.files\[0\]/);
  assert.match(intake, /fields\.pdfFile\.files\[0\] !== file/);
  assert.match(html, /Existing values preserved/);
  assert.doesNotMatch(browserReader, /fetch\s*\(/, "Reading a PDF must not upload or publish it.");

  const inference = await import(pathToFileURL(path.join(ROOT, "shared", "product-pdf-prefill.mjs")));
  assert.deepEqual(inference.selectPdfPages(122), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 119, 120, 121, 122]);
  assert.deepEqual(inference.selectPdfPages(18), Array.from({ length: 18 }, (_, index) => index + 1));

  const inferred = inference.inferProductListingFromPdf({
    metadata: {
      Title: "The Road-Worn Player's Manual",
      Subject: "A complete player reference for heroic journeys. Build travelers, resolve danger, and keep the road moving.",
      Keywords: "Fantasy; Core Rules; Fifth Edition"
    },
    pageCount: 122,
    pages: [
      { pageNumber: 1, text: "The Road-Worn Player's Manual\nSubtitle: Rules for Long Roads\nGame System: 5E Compatible\nProduct Line: Open Road Rules\nSeries: Player Manuals\nVersion: 1.2\nLanguage: English\nPublished: October 17, 2026\nGenre: Fantasy\nContent Descriptors: Fantasy violence, peril" },
      { pageNumber: 2, text: "Features:\nCharacter creation - Travel rules - Complete equipment\nDescription:\nA complete player reference for heroic journeys. Build travelers, resolve danger, and keep the road moving." },
      { pageNumber: 122, text: "License:\nThis work is licensed under Creative Commons Attribution 4.0 International." }
    ]
  });
  assert.equal(inferred.fields.title.value, "The Road-Worn Player's Manual");
  assert.equal(inferred.fields.subtitle.value, "Rules for Long Roads");
  assert.equal(inferred.fields.pageCount.value, "122");
  assert.equal(inferred.fields.format.value, "PDF");
  assert.equal(inferred.fields.system.value, "5E Compatible");
  assert.equal(inferred.fields.line.value, "Open Road Rules");
  assert.equal(inferred.fields.series.value, "Player Manuals");
  assert.equal(inferred.fields.version.value, "1.2");
  assert.equal(inferred.fields.language.value, "English");
  assert.equal(inferred.fields.releaseDate.value, "2026-10-17");
  assert.equal(inferred.fields.genre.value, "Fantasy");
  assert.match(inferred.fields.legalNote.value, /Creative Commons Attribution 4\.0/);
  assert.deepEqual(inferred.fields.contentDescriptors.value, ["Fantasy violence", "peril"]);
  assert.equal(Object.hasOwn(inferred.fields, "price"), false);
  assert.equal(Object.hasOwn(inferred.fields, "openRulesEligible"), false);

  const scanned = inference.inferProductListingFromPdf({ pageCount: 80, pages: [{ pageNumber: 1, text: "" }, { pageNumber: 80, text: "" }] });
  assert.equal(scanned.fields.pageCount.value, "80");
  assert.equal(scanned.fields.format.value, "PDF");
  assert.equal(Object.hasOwn(scanned.fields, "title"), false);
  assert.match(scanned.warnings.join(" "), /scanned or image-only/i);

  const pdfjs = await import(pathToFileURL(path.join(ROOT, "assets", "vendor", "pdfjs", "pdf.mjs")));
  const generatedPdf = buildPdf([
    ["Product Title: Test Manual", "Game System: 5E Compatible"],
    ["License: Creative Commons Attribution 4.0"]
  ]);
  const generatedDocument = await pdfjs.getDocument({ data: generatedPdf, isEvalSupported: false }).promise;
  assert.equal(generatedDocument.numPages, 2);
  assert.match(await extractPageText(generatedDocument, 1), /Test Manual/);
  await generatedDocument.destroy();

  const externalPath = process.env.TRG_PDF_AUTOFILL_TEST_FILE;
  if (externalPath) {
    const bytes = new Uint8Array(fs.readFileSync(externalPath));
    const realDocument = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const selectedPages = inference.selectPdfPages(realDocument.numPages);
    let readablePages = 0;
    for (const pageNumber of selectedPages) {
      if ((await extractPageText(realDocument, pageNumber)).trim()) readablePages += 1;
    }
    assert.ok(realDocument.numPages > 1, "Real PDF verification requires a multipage document.");
    assert.ok(readablePages > 0, "The real PDF must expose readable text for autofill verification.");
    console.log(`Real PDF verified: ${realDocument.numPages} pages; ${selectedPages.length} sampled; ${readablePages} readable.`);
    await realDocument.destroy();
  }

  console.log("Product PDF autofill tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
