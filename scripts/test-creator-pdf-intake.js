const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

function escapePdf(value) {
  return String(value).replace(/([\\()])/g, "\\$1");
}

function makePdf(pages, info = {}) {
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pageIds = [];
  for (const page of pages) {
    const pageId = objects.length, contentId = pageId + 1;
    pageIds.push(pageId);
    const commands = ["q", ...(page.color ? [`${page.color.join(" ")} rg`, `0 0 612 792 re f`] : []), "Q", "BT", "/F1 12 Tf", "72 740 Td"];
    (page.lines || []).forEach((line, index) => {
      if (index) commands.push("0 -18 Td");
      commands.push(`(${escapePdf(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoEntries = Object.entries(info).map(([key, value]) => `/${key} (${escapePdf(value)})`).join(" ");
  if (infoEntries) objects.push(`<< ${infoEntries} >>`);
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = Buffer.byteLength(output);
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index++) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R${infoEntries ? ` /Info ${objects.length - 1} 0 R` : ""} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, "binary"));
}

async function main() {
  const prefill = await import(pathToFileURL(path.join(ROOT, "shared", "product-pdf-prefill.mjs")));
  const imageUtils = await import(pathToFileURL(path.join(ROOT, "shared", "product-pdf-image-utils.mjs")));
  const html = fs.readFileSync(path.join(ROOT, "creator", "index.html"), "utf8");
  const dashboard = fs.readFileSync(path.join(ROOT, "assets", "js", "creator-dashboard.js"), "utf8");
  const reader = fs.readFileSync(path.join(ROOT, "assets", "js", "product-pdf-autofill.mjs"), "utf8");

  assert.match(html, /id="creator-pdf-file"/);
  assert.match(html, /id="creator-pdf-draft-form"/);
  assert.match(html, /id="creator-pdf-front-replacement"/);
  assert.match(html, /id="creator-pdf-back-replacement"/);
  assert.match(html, /Manual listing entry/);
  assert.match(dashboard, /readProductPdf\(file\)/);
  assert.match(dashboard, /renderDefaultPdfCoverFiles\(file\)/);
  assert.match(dashboard, /Nothing was published or shelved/);
  assert.match(dashboard, /existing entry was kept/);
  assert.match(reader, /dc:creator/);
  assert.match(reader, /dc:publisher/);
  assert.doesNotMatch(reader, /https?:\/\//);
  assert.doesNotMatch(reader, /fetch\s*\(/);

  const embeddedPdf = makePdf([
    { lines: ["The Starfall Expedition", "Author: Ana Example", "Publisher: Lantern Press", "Game System: Pathfinder Second Edition", "Genre: Science Fantasy"] },
    { lines: ["Product Description:", "A science fantasy expedition across a fallen star."] },
  ], { Title: "The Starfall Expedition", Author: "Ana Example", Subject: "An expedition adventure.", Publisher: "Lantern Press" });
  const pdfjs = await import(pathToFileURL(path.join(ROOT, "assets", "vendor", "pdfjs", "pdf.mjs")));
  const withMetadata = await pdfjs.getDocument({ data: embeddedPdf, isEvalSupported: false }).promise;
  const info = (await withMetadata.getMetadata()).info;
  assert.equal(withMetadata.numPages, 2);
  assert.equal(info.Title, "The Starfall Expedition");
  assert.equal(info.Author, "Ana Example");
  await withMetadata.destroy();
  const metadataResult = prefill.inferProductListingFromPdf({
    metadata: { Title: info.Title, Author: info.Author, Publisher: info.Publisher, Subject: info.Subject },
    pages: [
      { pageNumber: 1, text: "The Starfall Expedition\nAuthor: Ana Example\nPublisher: Lantern Press\nGame System: Pathfinder Second Edition\nGenre: Science Fantasy" },
      { pageNumber: 2, text: "Product Description:\nA science fantasy expedition across a fallen star." },
    ],
    pageCount: 2,
  });
  assert.equal(metadataResult.fields.title.value, "The Starfall Expedition");
  assert.equal(metadataResult.fields.author.value, "Ana Example");
  assert.equal(metadataResult.fields.publisher.value, "Lantern Press");
  assert.equal(metadataResult.fields.system.value, "Pathfinder Second Edition");
  assert.equal(metadataResult.fields.genre.value, "Science Fantasy");
  assert.match(metadataResult.fields.shortDescription.value, /fallen star/);

  const titlePageResult = prefill.inferProductListingFromPdf({
    pages: [
      { pageNumber: 1, text: "" },
      { pageNumber: 2, text: "THE GLASS MARCH\nWritten by Mira North\nPublished by Ember House\nIntroduction\nA journey through a glass desert." },
    ],
    pageCount: 3,
  });
  assert.equal(titlePageResult.fields.title.value, "THE GLASS MARCH");
  assert.equal(titlePageResult.fields.author.value, "Mira North");
  assert.equal(titlePageResult.fields.publisher.value, "Ember House");
  assert.equal(titlePageResult.fields.shortDescription.confidence, "medium");
  assert.equal(titlePageResult.fields.system, undefined);

  const noMetadata = prefill.inferProductListingFromPdf({
    pages: [{ pageNumber: 1, text: "Cover art only" }, { pageNumber: 2, text: "" }],
    pageCount: 2,
  });
  assert.equal(noMetadata.fields.title, undefined);
  assert.equal(noMetadata.fields.author, undefined);
  assert.equal(noMetadata.fields.publisher, undefined);
  assert.equal(noMetadata.fields.system, undefined);
  assert.equal(noMetadata.fields.genre, undefined);
  assert.equal(noMetadata.fields.shortDescription, undefined);

  const conflict = prefill.inferProductListingFromPdf({
    metadata: { Author: "Metadata Author" },
    pages: [{ pageNumber: 1, text: "A CONFIRMED TITLE\nAuthor: Title Page Author\nPublisher: Imprint A\nPublisher: Imprint B" }],
    pageCount: 1,
  });
  assert.equal(conflict.fields.author, undefined);
  assert.deepEqual(conflict.uncertain.author, ["Metadata Author", "Title Page Author"]);
  assert.match(conflict.warnings.join(" "), /conflicting author/i);
  assert.equal(conflict.fields.publisher, undefined);
  assert.deepEqual(conflict.uncertain.publisher, ["Imprint A", "Imprint B"]);

  const mentionOnly = prefill.inferProductListingFromPdf({
    pages: [{ pageNumber: 1, text: "Notes about Dungeons & Dragons campaigns, Pathfinder worlds, and Traveller ships." }],
    pageCount: 1,
  });
  assert.equal(mentionOnly.fields.system, undefined, "Incidental system mentions must not be promoted to a classification.");

  const finalPagePdf = makePdf([
    { color: [1, 0, 0], lines: [] },
    { lines: [] },
    { color: [0, 0, 1], lines: [] },
  ]);
  const finalDoc = await pdfjs.getDocument({ data: finalPagePdf, isEvalSupported: false }).promise;
  const pages = imageUtils.getDefaultPdfImagePages(finalDoc.numPages);
  assert.deepEqual(pages, { frontPage: 1, backPage: 3 });
  const canvasApi = require("@napi-rs/canvas");
  for (const name of ["DOMMatrix", "ImageData", "Path2D"]) if (!globalThis[name] && canvasApi[name]) globalThis[name] = canvasApi[name];
  const centerColors = [];
  for (const pageNumber of [pages.frontPage, pages.backPage]) {
    const page = await finalDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = canvasApi.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    centerColors.push([pixel[0], pixel[1], pixel[2]]);
    const webp = await canvas.encode("webp", 90);
    assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
    page.cleanup();
  }
  assert.notDeepEqual(centerColors[0], centerColors[1], "The final-page back-cover render must use the PDF's last page.");
  await finalDoc.destroy();
  console.log("Creator PDF Intake extraction, conservative suggestions, and front/back page tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
