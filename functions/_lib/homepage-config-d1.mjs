export const HOMEPAGE_CONFIGURATION_ID = "storefront";
export const HOMEPAGE_SHELF_KEYS = Object.freeze([
  "featuredCreator", "newThisWeek", "bestSellers", "freePwyw"
]);
export const HOMEPAGE_SHELF_CAPACITY = 43;

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CREATOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export class HomepageConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HomepageConfigurationError";
    this.code = code;
  }
}

export function defaultHomepageConfiguration() {
  return {
    version: 1,
    shelves: {
      featuredCreator: { visible: true, managed: false, creatorId: null, productIds: [] },
      newThisWeek: { visible: true, managed: false, productIds: [] },
      bestSellers: { visible: true, managed: false, productIds: [] },
      freePwyw: { visible: true, managed: false, productIds: [] }
    },
    promotions: []
  };
}

export async function getHomepageConfiguration(database) {
  const row = await database.prepare(`SELECT configuration_json,revision,created_at,updated_at
    FROM homepage_configurations WHERE id=?`).bind(HOMEPAGE_CONFIGURATION_ID).first();
  if (!row) throw new HomepageConfigurationError("not_found", "Homepage configuration is unavailable.");
  let parsed;
  try { parsed = JSON.parse(row.configuration_json); }
  catch { throw new HomepageConfigurationError("invalid_storage", "Stored homepage configuration is invalid."); }
  return {
    configuration: validateHomepageConfiguration(parsed),
    createdAt: row.created_at,
    revision: Number(row.revision),
    updatedAt: row.updated_at
  };
}

export async function updateHomepageConfiguration(database, configuration, { expectedRevision, nowMs = Date.now() } = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    invalid("A valid homepage revision is required.");
  }
  const normalized = validateHomepageConfiguration(configuration);
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) invalid("Homepage update time is invalid.");
  const result = await database.prepare(`UPDATE homepage_configurations
    SET configuration_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
    .bind(JSON.stringify(normalized), now.toISOString(), HOMEPAGE_CONFIGURATION_ID, expectedRevision).run();
  if (Number(result.meta?.changes ?? result.changes ?? 0) !== 1) {
    throw new HomepageConfigurationError("conflict", "Homepage configuration changed after it was loaded.");
  }
  return getHomepageConfiguration(database);
}

export function validateHomepageConfiguration(value) {
  if (!plainObject(value)) invalid("Homepage configuration must be an object.");
  for (const key of Object.keys(value)) {
    if (!new Set(["version", "shelves", "promotions"]).has(key)) invalid(`Unsupported homepage field: ${key}.`);
  }
  if (value.version !== 1) invalid("Homepage configuration version is unsupported.");
  if (!plainObject(value.shelves)) invalid("Homepage shelves are required.");
  for (const key of Object.keys(value.shelves)) {
    if (!HOMEPAGE_SHELF_KEYS.includes(key)) invalid(`Unsupported homepage shelf: ${key}.`);
  }
  const shelves = {};
  for (const key of HOMEPAGE_SHELF_KEYS) shelves[key] = validateShelf(key, value.shelves[key]);
  const promotions = validatePromotions(value.promotions);
  return { version: 1, shelves, promotions };
}

function validateShelf(key, value) {
  if (!plainObject(value)) invalid(`Homepage shelf ${key} is required.`);
  const allowed = new Set(key === "featuredCreator" ? ["visible", "managed", "creatorId", "productIds"] : ["visible", "managed", "productIds"]);
  for (const field of Object.keys(value)) if (!allowed.has(field)) invalid(`Unsupported ${key} shelf field: ${field}.`);
  if (typeof value.visible !== "boolean") invalid(`Homepage shelf ${key} visibility must be true or false.`);
  if (typeof value.managed !== "boolean") invalid(`Homepage shelf ${key} managed state must be true or false.`);
  if (!Array.isArray(value.productIds)) invalid(`Homepage shelf ${key} products must be an array.`);
  if (value.productIds.length > HOMEPAGE_SHELF_CAPACITY) invalid(`Homepage shelf ${key} exceeds its ${HOMEPAGE_SHELF_CAPACITY}-product capacity.`);
  const productIds = value.productIds.map((id) => identifier(id, "product"));
  if (new Set(productIds).size !== productIds.length) invalid(`Homepage shelf ${key} cannot contain duplicate products.`);
  if (!value.managed && productIds.length) invalid(`Homepage shelf ${key} cannot store manual products while automatic ordering is enabled.`);
  const shelf = { visible: value.visible, managed: value.managed, productIds };
  if (key === "featuredCreator") {
    shelf.creatorId = value.creatorId === null || value.creatorId === "" ? null : identifier(value.creatorId, "Creator", CREATOR_ID_PATTERN);
  }
  return shelf;
}

function validatePromotions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) invalid("Homepage promotions must be an array of at most 12 items.");
  return value.map((promotion) => {
    if (!plainObject(promotion)) invalid("Homepage promotions must be objects.");
    for (const key of Object.keys(promotion)) {
      if (!new Set(["id", "title", "url", "visible"]).has(key)) invalid(`Unsupported homepage promotion field: ${key}.`);
    }
    const id = identifier(promotion.id, "promotion");
    const title = text(promotion.title, "Promotion title", 160);
    const url = safeLink(promotion.url);
    if (typeof promotion.visible !== "boolean") invalid("Promotion visibility must be true or false.");
    return { id, title, url, visible: promotion.visible };
  });
}

function safeLink(value) {
  const url = text(value, "Promotion link", 1024);
  if (url.startsWith("/")) {
    if (url.startsWith("//") || /[\u0000-\u001f\\]/.test(url)) invalid("Promotion link is invalid.");
    return url;
  }
  let parsed;
  try { parsed = new URL(url); } catch { invalid("Promotion link is invalid."); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) invalid("Promotion link must use HTTP or HTTPS.");
  return parsed.toString();
}

function identifier(value, label, pattern = PRODUCT_ID_PATTERN) {
  const normalized = text(value, `${label} ID`, 160);
  if (!pattern.test(normalized)) invalid(`${label} ID is invalid.`);
  return normalized;
}
function text(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) invalid(`${label} is too long.`);
  return normalized;
}
function plainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function invalid(message) { throw new HomepageConfigurationError("invalid_input", message); }
