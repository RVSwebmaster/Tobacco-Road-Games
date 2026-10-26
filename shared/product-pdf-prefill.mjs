const GENERIC_TITLES = new Set([
  "adobe pdf",
  "document",
  "microsoft word",
  "pdf document",
  "untitled"
]);

const MONTHS = Object.freeze({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
});

const cleanText = (value) => String(value || "")
  .replace(/\u0000/g, "")
  .replace(/[\t\f\v]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

const cleanLines = (value) => String(value || "")
  .split(/\r?\n/)
  .map(cleanText)
  .filter(Boolean);

const unique = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = cleanText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isLikelyHeading = (value) => {
  const text = cleanText(value);
  return /^[A-Z][A-Za-z0-9 &/'-]{1,44}:$/.test(text)
    || (/^[A-Z0-9 &/'-]{4,52}$/.test(text) && text.split(/\s+/).length <= 8);
};

const normalizeMetadata = (metadata = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    const cleaned = cleanText(Array.isArray(value) ? value.join(", ") : value);
    if (cleaned) normalized[String(key).toLowerCase()] = cleaned;
  }
  return normalized;
};

const getMetadataValue = (metadata, keys) => {
  for (const key of keys) {
    const value = metadata[String(key).toLowerCase()];
    if (value) return value;
  }
  return "";
};

const isUsefulTitle = (value) => {
  const text = cleanText(value);
  if (text.length < 2 || text.length > 160) return false;
  if (GENERIC_TITLES.has(text.toLowerCase())) return false;
  if (/^(?:https?:\/\/|www\.|copyright|all rights reserved|page \d+)/i.test(text)) return false;
  if (/^tobacco road games$/i.test(text)) return false;
  return true;
};

const getLabeledValue = (lines, labels, maxLength = 300) => {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const expression = new RegExp(`^(?:${labelPattern})\\s*[:\\-]\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(expression);
    if (match) return cleanText(match[1]).slice(0, maxLength);
  }
  return "";
};

const readSection = (lines, headings, { maxLines = 8, maxLength = 1400 } = {}) => {
  const headingPattern = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const expression = new RegExp(`^(?:${headingPattern})(?:\\s*[:\\-]\\s*(.*))?$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(expression);
    if (!match) continue;
    const collected = [];
    if (cleanText(match[1])) collected.push(cleanText(match[1]));
    for (let offset = index + 1; offset < lines.length && collected.length < maxLines; offset += 1) {
      const line = cleanText(lines[offset]);
      if (!line || isLikelyHeading(line)) break;
      collected.push(line.replace(/^[\u2022*\-]\s*/, ""));
      if (collected.join(" ").length >= maxLength) break;
    }
    return cleanText(collected.join(" ")).slice(0, maxLength);
  }
  return "";
};

const readListSection = (lines, headings, maxItems = 10) => {
  const section = readSection(lines, headings, { maxLines: maxItems, maxLength: 1200 });
  if (!section) return [];
  const split = section
    .split(/(?:\s*[\u2022|]\s*|\s+[-*]\s+|;\s*)/)
    .map(cleanText)
    .filter((value) => value.length >= 2 && value.length <= 180);
  return unique(split.length > 1 ? split : [section]);
};

const normalizeDate = (value) => {
  const text = cleanText(value).replace(/\.$/, "");
  let match = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (match) {
    return `${match[3]}-${String(MONTHS[match[1].toLowerCase()]).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
  }

  match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b/i);
  if (match) {
    return `${match[3]}-${String(MONTHS[match[2].toLowerCase()]).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
  }
  return "";
};

const detectGameSystem = (text) => {
  const checks = [
    [/\b(?:5e|5th edition|fifth edition)(?:\s+compatible)?\b/i, "5E Compatible"],
    [/\bSRD\s*5\.2(?:\.1)?\b/i, "SRD 5.2.1"],
    [/\bSRD\s*5\.1\b/i, "SRD 5.1"],
    [/\bPathfinder(?:\s+Second Edition|\s+2E)?\b/i, "Pathfinder"],
    [/\bCall of Cthulhu\b/i, "Call of Cthulhu"],
    [/\bTraveller\b/i, "Traveller"],
    [/\bGURPS\b/i, "GURPS"],
    [/\bChampions\b/i, "Champions"],
    [/\bThreshold Engine\b/i, "Threshold Engine"],
    [/\bBig Damn Sci[- ]?Fi\b/i, "Big Damn Sci-Fi"],
    [/\bsystem[- ]agnostic\b/i, "System Agnostic"]
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) return label;
  }
  return "";
};

const findLegalCopy = (pages) => {
  for (const page of pages) {
    const lines = cleanLines(page.text);
    const section = readSection(lines, [
      "Legal Notice",
      "License",
      "Licensing",
      "Open Game License",
      "Creative Commons License",
      "Copyright Notice"
    ], { maxLines: 12, maxLength: 1600 });
    if (section) return section;
  }

  const legalLines = unique(pages.flatMap((page) => cleanLines(page.text)).filter((line) =>
    /\b(?:licensed under|creative commons|open game license|system reference document|all rights reserved|copyright|©)\b/i.test(line)
  ));
  return cleanText(legalLines.slice(0, 8).join(" ")).slice(0, 1600);
};

const addField = (target, name, value, source, confidence = "high") => {
  const normalizedValue = Array.isArray(value)
    ? unique(value.map(cleanText)).filter(Boolean)
    : cleanText(value);
  if (!normalizedValue || (Array.isArray(normalizedValue) && !normalizedValue.length)) return;
  target[name] = { value: normalizedValue, source, confidence };
};

export function selectPdfPages(pageCount, options = {}) {
  const total = Math.max(0, Number(pageCount) || 0);
  const fullDocumentLimit = Number(options.fullDocumentLimit || 24);
  const frontPageLimit = Number(options.frontPageLimit || 12);
  const backPageLimit = Number(options.backPageLimit || 4);
  if (total <= fullDocumentLimit) return Array.from({ length: total }, (_, index) => index + 1);
  const selected = new Set();
  for (let page = 1; page <= Math.min(total, frontPageLimit); page += 1) selected.add(page);
  for (let page = Math.max(1, total - backPageLimit + 1); page <= total; page += 1) selected.add(page);
  return [...selected].sort((left, right) => left - right);
}

export function inferProductListingFromPdf({ metadata = {}, pages = [], pageCount = 0 } = {}) {
  const normalizedMetadata = normalizeMetadata(metadata);
  const normalizedPages = pages.map((page, index) => ({
    pageNumber: Number(page?.pageNumber || index + 1),
    text: String(page?.text || "")
  }));
  const allLines = normalizedPages.flatMap((page) => cleanLines(page.text));
  const allText = allLines.join("\n");
  const firstPageLines = cleanLines(normalizedPages[0]?.text || "");
  const fields = {};
  const warnings = [];

  const metadataTitle = getMetadataValue(normalizedMetadata, ["title", "dc:title"]);
  const labeledTitle = getLabeledValue(allLines, ["Product Title", "Title"], 160);
  const firstPageTitle = firstPageLines.find(isUsefulTitle) || "";
  const title = isUsefulTitle(metadataTitle)
    ? metadataTitle
    : (isUsefulTitle(labeledTitle) ? labeledTitle : firstPageTitle);
  addField(fields, "title", title, metadataTitle ? "PDF document title" : (labeledTitle ? "labeled title" : "first-page heading"));

  const subtitle = getLabeledValue(allLines, ["Subtitle"], 180);
  addField(fields, "subtitle", subtitle, "labeled subtitle");

  addField(fields, "pageCount", String(Number(pageCount) || 0), "PDF page tree");
  addField(fields, "format", "PDF", "selected PDF file");

  const system = getLabeledValue(allLines, ["Game System", "System"], 120) || detectGameSystem(allText);
  addField(fields, "system", system, system && /^(?:5E Compatible|SRD|Pathfinder|Call of Cthulhu|Traveller|GURPS|Champions|Threshold Engine|Big Damn Sci-Fi|System Agnostic)/.test(system)
    ? "explicit system reference"
    : "labeled game system");
  addField(fields, "line", getLabeledValue(allLines, ["Product Line", "Game Line"], 140), "labeled product line");
  addField(fields, "series", getLabeledValue(allLines, ["Series"], 140), "labeled series");
  addField(fields, "version", getLabeledValue(allLines, ["Version", "Document Version"], 80), "labeled version");

  const language = getMetadataValue(normalizedMetadata, ["language", "lang", "dc:language"])
    || getLabeledValue(allLines, ["Language"], 80);
  addField(fields, "language", language, getMetadataValue(normalizedMetadata, ["language", "lang", "dc:language"])
    ? "PDF language metadata"
    : "labeled language");

  const explicitDate = getLabeledValue(allLines, ["Publication Date", "Published", "Release Date", "Released"], 120);
  addField(fields, "releaseDate", normalizeDate(explicitDate), "explicit publication date");
  addField(fields, "genre", getLabeledValue(allLines, ["Genre"], 120), "labeled genre");

  const metadataKeywords = getMetadataValue(normalizedMetadata, ["keywords", "pdf:keywords"]);
  const explicitTags = getLabeledValue(allLines, ["Tags", "Keywords"], 500);
  const tags = unique(String(explicitTags || metadataKeywords || "")
    .split(/[,;|]/)
    .map(cleanText)
    .filter(Boolean));
  addField(fields, "tags", tags, explicitTags ? "labeled tags" : "PDF keyword metadata");

  const descriptors = getLabeledValue(allLines, ["Content Descriptors", "Content Warnings", "Content Warning"], 500);
  addField(fields, "contentDescriptors", unique(descriptors.split(/[,;|]/).map(cleanText).filter(Boolean)), "labeled content descriptors");

  const features = readListSection(allLines, ["Product Features", "Features", "Includes"], 10);
  addField(fields, "features", features, "labeled feature list", "medium");

  const metadataSubject = getMetadataValue(normalizedMetadata, ["subject", "dc:description"]);
  const descriptionSection = readSection(allLines, ["Product Description", "About This Product", "Description"], {
    maxLines: 12,
    maxLength: 1800
  });
  const description = descriptionSection || metadataSubject;
  if (description) {
    const sentences = description.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [description];
    const shortDescription = cleanText(sentences.slice(0, 2).join(" ")).slice(0, 420);
    addField(fields, "shortDescription", shortDescription, descriptionSection ? "labeled product description" : "PDF subject metadata", "medium");
    if (description.length > shortDescription.length + 20) {
      addField(fields, "longDescription", description.slice(0, 1800), descriptionSection ? "labeled product description" : "PDF subject metadata", "medium");
    }
  }

  addField(fields, "legalNote", findLegalCopy(normalizedPages), "explicit legal or license copy", "medium");

  const pagesWithText = normalizedPages.filter((page) => cleanText(page.text)).length;
  if (!pagesWithText) {
    warnings.push("No readable text was found. This PDF may be scanned or image-only; page count and format are still available.");
  } else if (pagesWithText < normalizedPages.length) {
    warnings.push("Some sampled pages contained no readable text. Review the extracted suggestions before publishing.");
  }

  return {
    fields,
    pagesRead: normalizedPages.map((page) => page.pageNumber),
    readablePageCount: pagesWithText,
    warnings
  };
}
