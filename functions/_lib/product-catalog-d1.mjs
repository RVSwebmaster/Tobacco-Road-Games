// D1 product records only. No route or storefront consumer uses this module yet.
const FIELDS = Object.freeze([
  ["creatorListingId", "creator_listing_id"],
  ["publicationState", "publication_state"],
  ["title", "title"],
  ["subtitle", "subtitle"],
  ["shortDescription", "short_description"],
  ["longDescription", "long_description"],
  ["publisher", "publisher"],
  ["gameSystem", "game_system"],
  ["productLine", "product_line"],
  ["genre", "genre"],
  ["mediaType", "media_type"],
  ["status", "status"],
  ["buyMode", "buy_mode"],
  ["buyUrl", "buy_url"],
  ["currency", "currency"],
  ["pricingModel", "pricing_model"],
  ["priceCents", "price_cents"],
  ["suggestedPriceCents", "suggested_price_cents"],
  ["minimumPriceCents", "minimum_price_cents"],
  ["saleEnabled", "sale_enabled"],
  ["salePriceCents", "sale_price_cents"],
  ["saleStart", "sale_start"],
  ["saleEnd", "sale_end"],
  ["coverR2Key", "cover_r2_key"],
  ["backCoverR2Key", "back_cover_r2_key"],
  ["previewR2Key", "preview_r2_key"],
  ["thumbnailR2Key", "thumbnail_r2_key"],
  ["deliveryR2Key", "delivery_r2_key"],
  ["deliveryFilename", "delivery_filename"],
  ["deliveryContentType", "delivery_content_type"],
  ["metadata", "metadata_json"],
  ["publishedAt", "published_at"]
]);
const FIELD_NAMES = new Set(FIELDS.map(([name]) => name));
const CREATE_NAMES = new Set(["id", "slug", "creatorId", "managedByUserId", ...FIELD_NAMES]);
const STATUSES = [
  "available-direct", "coming-soon", "free-download", "legacy-edition",
  "legacy-not-for-sale", "pay-what-you-want", "preview-available",
  "preview-only", "revised-edition-pending", "retired"
];
const BUY_MODES = [
  "available-direct", "cart", "coming-soon", "fixed-price", "free-download",
  "manual-invoice", "pay-what-you-want", "preview-only", "retired"
];
const DEFAULTS = Object.freeze({
  creatorListingId: null,
  publicationState: "draft",
  subtitle: "",
  shortDescription: "",
  longDescription: "",
  publisher: "",
  gameSystem: "",
  productLine: "",
  genre: "",
  mediaType: "digital",
  buyUrl: "",
  currency: "USD",
  pricingModel: "fixed",
  suggestedPriceCents: null,
  minimumPriceCents: null,
  saleEnabled: false,
  salePriceCents: null,
  saleStart: null,
  saleEnd: null,
  coverR2Key: null,
  backCoverR2Key: null,
  previewR2Key: null,
  thumbnailR2Key: null,
  deliveryR2Key: null,
  deliveryFilename: null,
  deliveryContentType: null,
  metadata: {},
  publishedAt: null
});
const COLUMNS = ["id", "slug", "creator_id", "managed_by_user_id", ...FIELDS.map(([, column]) => column), "created_at", "updated_at", "revision"];

export class ProductCatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductCatalogError";
    this.code = code;
  }
}

export async function getProductById(database, id) {
  const row = await database.prepare("SELECT * FROM marketplace_products WHERE id=?").bind(requiredText(id, "id")).first();
  return fromRow(row);
}

export async function getProductBySlug(database, slug) {
  const row = await database.prepare("SELECT * FROM marketplace_products WHERE slug=? COLLATE NOCASE").bind(requiredText(slug, "slug")).first();
  return fromRow(row);
}

export async function listProducts(database, { creatorId, publicationState, status, limit = 50, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) invalid("limit must be an integer from 1 to 200.");
  if (!Number.isInteger(offset) || offset < 0) invalid("offset must be a nonnegative integer.");
  const clauses = [];
  const values = [];
  for (const [value, column, label] of [
    [creatorId, "creator_id", "creatorId"],
    [publicationState, "publication_state", "publicationState"],
    [status, "status", "status"]
  ]) {
    if (value === undefined) continue;
    clauses.push(`${column}=?`);
    values.push(requiredText(value, label));
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const result = await database.prepare(`SELECT * FROM marketplace_products${where} ORDER BY slug LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset).all();
  return (result.results || []).map(fromRow);
}

export async function createProduct(database, input, { nowMs = Date.now() } = {}) {
  const prepared = prepareCreateProduct(database, input, { nowMs });
  await prepared.statement.run();
  return getProductById(database, prepared.product.id);
}

// Exposes the same validated insert used by createProduct so callers that must
// transition related D1 records atomically can include it in a D1 batch.
export function prepareCreateProduct(database, input, { nowMs = Date.now() } = {}) {
  const product = validateProductInput(input);
  const { id, slug, creatorId, managedByUserId } = product;
  const now = timestamp(nowMs);
  const values = [id, slug, creatorId, managedByUserId, ...FIELDS.map(([name]) => toDatabase(name, product[name])), now, now, 1];
  return {
    product,
    statement: database.prepare(`INSERT INTO marketplace_products(${COLUMNS.join(",")}) VALUES(${COLUMNS.map(() => "?").join(",")})`)
      .bind(...values)
  };
}

export function validateProductInput(input) {
  assertFields(input, CREATE_NAMES);
  const id = input.id === undefined ? crypto.randomUUID() : requiredText(input.id, "id");
  const slug = requiredSlug(input.slug);
  const creatorId = requiredText(input.creatorId, "creatorId");
  const managedByUserId = optionalText(input.managedByUserId);
  return normalize({ ...DEFAULTS, ...input, id, slug, creatorId, managedByUserId });
}

export async function updateProduct(database, id, patch, { expectedRevision, nowMs = Date.now() } = {}) {
  const prepared = await prepareUpdateProduct(database, id, patch, { expectedRevision, nowMs });
  const result = await prepared.statement.run();
  if (Number(result.meta?.changes ?? result.changes ?? 0) !== 1) {
    throw new ProductCatalogError("conflict", "Product revision has changed.");
  }
  return getProductById(database, prepared.product.id);
}

// Exposes the validated optimistic update for callers that must coordinate a
// product revision with another D1 record in a single batch. The optional
// Creator transition is a fixed, parameterized guard; callers cannot inject
// arbitrary SQL into the product update.
export async function prepareUpdateProduct(
  database,
  id,
  patch,
  { expectedRevision, nowMs = Date.now(), creatorTransition = null } = {},
) {
  assertFields(patch, FIELD_NAMES);
  if (!Object.keys(patch).length) invalid("At least one product field must be updated.");
  const current = await getProductById(database, id);
  if (!current) throw new ProductCatalogError("not_found", "Product not found.");
  if (current.creatorListingId && Object.hasOwn(patch, "creatorListingId") && patch.creatorListingId !== current.creatorListingId) {
    invalid("A linked Creator listing cannot be changed.");
  }
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new ProductCatalogError("conflict", "Product revision has changed.");
  }
  const product = normalize({ ...current, ...patch });
  const assignments = FIELDS.map(([, column]) => `${column}=?`).join(",");
  const values = [...FIELDS.map(([name]) => toDatabase(name, product[name])), timestamp(nowMs), current.id, current.revision];
  let transitionSql = "";
  if (creatorTransition !== null) {
    if (!creatorTransition || typeof creatorTransition !== "object" ||
      typeof creatorTransition.listingId !== "string" || !creatorTransition.listingId ||
      !Number.isInteger(creatorTransition.listingRevision) || creatorTransition.listingRevision < 1) {
      invalid("creatorTransition requires a listing ID and positive integer revision.");
    }
    const lifecycleState = creatorTransition.lifecycleState || "submitted";
    const publicationState = creatorTransition.publicationState || "publishing";
    if (!["submitted", "paused"].includes(lifecycleState) || !["publishing", "paused"].includes(publicationState)) {
      invalid("creatorTransition state is invalid.");
    }
    transitionSql = ` AND EXISTS (
      SELECT 1 FROM creator_listings
      WHERE id=? AND lifecycle_state=?
        AND publication_state=? AND revision=?
    )`;
    values.push(creatorTransition.listingId, lifecycleState, publicationState, creatorTransition.listingRevision);
  }
  return {
    current,
    product,
    expectedNextRevision: current.revision + 1,
    statement: database.prepare(`UPDATE marketplace_products SET ${assignments},updated_at=?,revision=revision+1 WHERE id=? AND revision=?${transitionSql}`)
      .bind(...values),
  };
}

// Disposable drafts may be removed before publication or sales. The D1 trigger
// also rejects deletion when an order, entitlement, or creator sale references a slug.
export async function deleteDraftProduct(database, id) {
  const product = await getProductById(database, id);
  if (!product) return false;
  if (product.publicationState !== "draft") {
    throw new ProductCatalogError("conflict", "Only draft products may be deleted.");
  }
  const result = await database.prepare("DELETE FROM marketplace_products WHERE id=? AND publication_state='draft'")
    .bind(product.id).run();
  return Number(result.meta?.changes ?? result.changes ?? 0) === 1;
}

function normalize(value) {
  const product = { ...value };
  product.title = requiredText(product.title, "title");
  if (product.title.length > 240) invalid("title is too long.");
  product.status = oneOf(requiredText(product.status, "status"), STATUSES, "status");
  product.buyMode = oneOf(requiredText(product.buyMode, "buyMode"), BUY_MODES, "buyMode");
  product.publicationState = oneOf(product.publicationState, ["draft", "published", "paused", "retired"], "publicationState");
  product.mediaType = oneOf(product.mediaType, ["digital", "physical", "hybrid"], "mediaType");
  product.pricingModel = oneOf(product.pricingModel, ["fixed", "free", "pwyw"], "pricingModel");
  product.currency = requiredText(product.currency, "currency");
  if (!/^[A-Z]{3}$/.test(product.currency)) invalid("currency must be a three-letter uppercase code.");
  product.priceCents = cents(product.priceCents, "priceCents", true);
  product.suggestedPriceCents = cents(product.suggestedPriceCents, "suggestedPriceCents");
  product.minimumPriceCents = cents(product.minimumPriceCents, "minimumPriceCents");
  product.salePriceCents = cents(product.salePriceCents, "salePriceCents");
  if (product.pricingModel === "pwyw") {
    if (product.suggestedPriceCents === null || product.minimumPriceCents === null ||
      product.suggestedPriceCents < product.minimumPriceCents) invalid("PWYW requires a suggested price at or above its minimum.");
  } else if (product.suggestedPriceCents !== null || product.minimumPriceCents !== null) {
    invalid("PWYW amounts require the pwyw pricing model.");
  }
  if (product.pricingModel === "free" && product.priceCents !== 0) invalid("Free products must have a zero price.");
  if (product.pricingModel === "fixed" && product.buyMode === "cart" && product.priceCents === 0) {
    invalid("Fixed-price cart products require a positive price.");
  }
  if (typeof product.saleEnabled !== "boolean") invalid("saleEnabled must be a boolean.");
  if (product.saleEnabled && (product.salePriceCents === null || product.salePriceCents >= product.priceCents)) {
    invalid("An enabled sale requires a price below the regular price.");
  }
  for (const key of ["saleStart", "saleEnd", "publishedAt"]) product[key] = optionalDate(product[key], key);
  if (product.saleStart && product.saleEnd && Date.parse(product.saleEnd) < Date.parse(product.saleStart)) {
    invalid("saleEnd cannot precede saleStart.");
  }
  product.creatorListingId = optionalText(product.creatorListingId);
  for (const key of ["subtitle", "shortDescription", "longDescription", "publisher", "gameSystem", "productLine", "genre", "buyUrl"]) {
    product[key] = optionalText(product[key]) || "";
  }
  for (const key of ["coverR2Key", "backCoverR2Key", "previewR2Key", "thumbnailR2Key", "deliveryR2Key"]) {
    product[key] = r2Key(product[key], key);
  }
  product.deliveryFilename = optionalText(product.deliveryFilename);
  product.deliveryContentType = optionalText(product.deliveryContentType);
  if (product.deliveryR2Key && (!product.deliveryFilename || !product.deliveryContentType)) {
    invalid("A delivery R2 key requires a filename and content type.");
  }
  if (!product.metadata || typeof product.metadata !== "object" || Array.isArray(product.metadata)) {
    invalid("metadata must be a JSON object.");
  }
  if (Object.keys(product.metadata).some(key => CREATE_NAMES.has(key) || ["createdAt", "updatedAt", "revision"].includes(key))) {
    invalid("metadata cannot shadow authoritative product fields.");
  }
  try {
    product.metadata = JSON.parse(JSON.stringify(product.metadata));
  } catch {
    invalid("metadata must be JSON serializable.");
  }
  return product;
}

function fromRow(row) {
  if (!row) return null;
  const product = {
    id: row.id,
    slug: row.slug,
    creatorId: row.creator_id,
    managedByUserId: row.managed_by_user_id || null
  };
  for (const [name, column] of FIELDS) product[name] = row[column];
  product.saleEnabled = Boolean(row.sale_enabled);
  product.metadata = JSON.parse(row.metadata_json);
  product.createdAt = row.created_at;
  product.updatedAt = row.updated_at;
  product.revision = row.revision;
  return product;
}

function toDatabase(name, value) {
  if (name === "metadata") return JSON.stringify(value);
  if (name === "saleEnabled") return value ? 1 : 0;
  return value;
}

function assertFields(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Product input must be an object.");
  for (const key of Object.keys(input)) if (!allowed.has(key)) invalid(`Unsupported product field: ${key}.`);
}
function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) invalid(`${name} is required.`);
  return value.trim();
}
function requiredSlug(value) {
  const slug = requiredText(value, "slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) invalid("slug must be lowercase and hyphenated.");
  return slug;
}
function optionalText(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") invalid("Text fields must be strings.");
  return value.trim() || null;
}
function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) invalid(`${name} is invalid.`);
  return value;
}
function cents(value, name, required = false) {
  if (value === null || value === undefined) {
    if (required) invalid(`${name} is required.`);
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${name} must be nonnegative integer cents.`);
  return value;
}
function optionalDate(value, name) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${name} must be a valid date.`);
  return value.trim();
}
function r2Key(value, name) {
  const key = optionalText(value);
  if (!key) return null;
  if (key.startsWith("/") || key.includes("\\") || key.includes("?") || key.includes("#") ||
    key.split("/").some(segment => !segment || segment === "." || segment === "..") || /[\u0000-\u001f]/.test(key)) {
    invalid(`${name} must be a safe R2 object key.`);
  }
  return key;
}
function timestamp(nowMs) {
  if (!Number.isFinite(nowMs)) invalid("nowMs must be finite.");
  return new Date(nowMs).toISOString();
}
function invalid(message) { throw new ProductCatalogError("invalid_input", message); }
