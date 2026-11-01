import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf
} from "./account-auth.mjs";
import {
  getProductBySlug,
  listProducts,
  ProductCatalogError,
  updateProduct
} from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const PRICING_MODELS = new Set(["fixed", "free", "pwyw"]);
const AVAILABILITY_STATES = new Set(["available", "paused"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "availability", "currency", "expectedRevision", "minimumPriceCents",
  "priceCents", "pricingModel", "saleEnabled", "saleEnd", "saleLabel",
  "salePriceCents", "saleStart", "slug", "suggestedPriceCents"
]);

export class OwnerPricingError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OwnerPricingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function handleOwnerPricingPublishRequest(request, env, options = {}) {
  const method = String(request.method || "GET").toUpperCase();
  if (!env.TRG_ORDERS?.prepare) {
    return jsonResponse({ error: "Product catalog database is unavailable.", code: "bindings_unavailable" }, 503);
  }
  if (!["GET", "POST"].includes(method)) {
    return jsonResponse({ error: "Pricing management accepts GET and POST requests.", code: "method_not_allowed" }, 405);
  }

  let session;
  try {
    session = await getSessionFromRequest(request, env, options);
  } catch (error) {
    logOwnerPricingException(request, error);
    return jsonResponse({ error: "Owner session could not be verified.", code: "session_unavailable" }, 503);
  }
  if (!session.valid) return jsonResponse({ error: "Sign in as an Owner to manage pricing.", code: "authentication_required" }, 401);
  if (!["owner", "admin"].includes(session.user.role)) {
    return jsonResponse({ error: "Only an Owner may manage product pricing.", code: "owner_required" }, 403);
  }

  if (method === "GET") {
    try {
      const products = await listAllProducts(env.TRG_ORDERS);
      return jsonResponse({ csrfToken: session.csrfToken, products: products.map(ownerPricingProduct) });
    } catch (error) {
      logOwnerPricingException(request, error);
      return jsonResponse({ error: "Native product pricing could not be loaded.", code: "catalog_unavailable" }, 503);
    }
  }

  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return jsonResponse({ error: "The Owner pricing request could not be verified.", code: "csrf_rejected" }, 403);
  }

  try {
    const input = await parsePricingRequest(request);
    const product = await applyOwnerPricingUpdate(env.TRG_ORDERS, input, options);
    return jsonResponse({
      message: `Pricing for ${product.title} was updated in the native catalog.`,
      ok: true,
      product: ownerPricingProduct(product)
    });
  } catch (error) {
    if (error instanceof OwnerPricingError) {
      return jsonResponse({ error: error.message, code: error.code, ...error.details }, error.status);
    }
    if (error instanceof ProductCatalogError) {
      const status = error.code === "conflict" ? 409 : 400;
      const code = error.code === "conflict" ? "revision_conflict" : "invalid_pricing";
      return jsonResponse({ error: error.message, code }, status);
    }
    logOwnerPricingException(request, error);
    return jsonResponse({ error: "Owner pricing update could not be completed.", code: "pricing_update_failed" }, 503);
  }
}

export async function applyOwnerPricingUpdate(database, rawInput, options = {}) {
  const input = validatePricingInput(rawInput);
  const current = await getProductBySlug(database, input.slug);
  if (!current) throw new OwnerPricingError("product_not_found", "Native D1 product not found.", 404);
  if (!["published", "paused"].includes(current.publicationState)) {
    throw new OwnerPricingError("product_not_editable", "Only published or paused native products can be managed here.", 409,
      { product: ownerPricingProduct(current) });
  }
  if (input.availability === "available") {
    const creator = await database.prepare(`SELECT marketplace_status,registration_status,closure_state
      FROM marketplace_creators WHERE id=?`).bind(current.creatorId).first();
    if (!creator || creator.marketplace_status !== "approved" || creator.registration_status !== "active" || creator.closure_state !== "active") {
      throw new OwnerPricingError("creator_unavailable", "The product Creator is not approved and active.", 409);
    }
  }

  const modelState = pricingModelState(input.pricingModel);
  const patch = {
    buyMode: modelState.buyMode,
    currency: input.currency,
    metadata: { ...current.metadata, saleLabel: input.saleLabel },
    minimumPriceCents: input.pricingModel === "pwyw" ? input.minimumPriceCents : null,
    priceCents: input.priceCents,
    pricingModel: input.pricingModel,
    publicationState: input.availability === "available" ? "published" : "paused",
    saleEnabled: input.saleEnabled,
    saleEnd: input.saleEnd || null,
    salePriceCents: input.salePriceCents,
    saleStart: input.saleStart || null,
    status: modelState.status,
    suggestedPriceCents: input.pricingModel === "pwyw" ? input.suggestedPriceCents : null
  };
  if (!hasPricingChange(current, patch)) {
    throw new OwnerPricingError("no_changes", "No pricing or availability changes were submitted.", 400);
  }
  try {
    return await updateProduct(database, current.id, patch, {
      expectedRevision: input.expectedRevision,
      nowMs: options.nowMs
    });
  } catch (error) {
    if (error instanceof ProductCatalogError && error.code === "conflict") {
      const latest = await getProductBySlug(database, input.slug);
      throw new OwnerPricingError("revision_conflict",
        "This product changed after it was loaded. Reload its current pricing before trying again.", 409,
        latest ? { product: ownerPricingProduct(latest) } : {});
    }
    throw error;
  }
}

export function validatePricingInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Pricing update must be a JSON object.");
  for (const key of Object.keys(input)) if (!ALLOWED_INPUT_FIELDS.has(key)) invalid(`Unsupported pricing field: ${key}.`);
  const slug = requiredString(input.slug, "Product slug", 160);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid("Product slug is invalid.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) invalid("A valid product revision is required.");
  const pricingModel = requiredString(input.pricingModel, "Pricing model", 16);
  if (!PRICING_MODELS.has(pricingModel)) invalid("Pricing model must be fixed, free, or pwyw.");
  const availability = requiredString(input.availability, "Availability", 16);
  if (!AVAILABILITY_STATES.has(availability)) invalid("Availability must be available or paused.");
  const currency = requiredString(input.currency, "Currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid("Currency must be a three-letter uppercase code.");
  const priceCents = cents(input.priceCents, "Price", true);
  const suggestedPriceCents = cents(input.suggestedPriceCents, "PWYW suggested price");
  const minimumPriceCents = cents(input.minimumPriceCents, "PWYW minimum price");
  if (pricingModel === "fixed" && priceCents < 1) invalid("Fixed-price products require a positive price.");
  if (pricingModel === "free" && priceCents !== 0) invalid("Free products require a zero price.");
  if (pricingModel === "pwyw") {
    if (suggestedPriceCents === null || minimumPriceCents === null) invalid("PWYW requires explicit suggested and minimum prices.");
    if (suggestedPriceCents < minimumPriceCents) invalid("PWYW suggested price must be at or above its minimum.");
    if (priceCents !== suggestedPriceCents) invalid("PWYW listed price must match its suggested price.");
  } else if (suggestedPriceCents !== null || minimumPriceCents !== null) {
    invalid("PWYW amounts may be supplied only for PWYW products.");
  }

  if (typeof input.saleEnabled !== "boolean") invalid("Sale enabled must be true or false.");
  const saleEnabled = input.saleEnabled;
  const salePriceCents = cents(input.salePriceCents, "Sale price");
  const saleStart = dateText(input.saleStart, "Sale start");
  const saleEnd = dateText(input.saleEnd, "Sale end");
  const saleLabel = optionalString(input.saleLabel, "Sale label", 80);
  if (pricingModel !== "fixed" && (saleEnabled || salePriceCents !== null || saleStart || saleEnd || saleLabel)) {
    invalid("Sales apply only to fixed-price products.");
  }
  if (saleEnabled && (salePriceCents === null || salePriceCents < 1 || salePriceCents >= priceCents)) {
    invalid("An enabled sale requires a positive price below the regular price.");
  }
  if (!saleEnabled && salePriceCents !== null) invalid("Disable or remove the sale price before saving.");
  if (saleStart && saleEnd && Date.parse(saleEnd) < Date.parse(saleStart)) invalid("Sale end cannot be earlier than sale start.");

  return {
    availability, currency, expectedRevision: input.expectedRevision, minimumPriceCents,
    priceCents, pricingModel, saleEnabled, saleEnd, saleLabel, salePriceCents,
    saleStart, slug, suggestedPriceCents
  };
}

export function ownerPricingProduct(product) {
  return {
    availability: product.publicationState === "published" ? "available" : "paused",
    buyMode: product.buyMode,
    currency: product.currency,
    editable: ["published", "paused"].includes(product.publicationState),
    id: product.id,
    minimumPriceCents: product.minimumPriceCents,
    priceCents: product.priceCents,
    pricingModel: product.pricingModel,
    publicationState: product.publicationState,
    revision: product.revision,
    saleEnabled: product.saleEnabled,
    saleEnd: product.saleEnd || "",
    saleLabel: String(product.metadata?.saleLabel || ""),
    salePriceCents: product.salePriceCents,
    saleStart: product.saleStart || "",
    slug: product.slug,
    source: "native-d1",
    status: product.status,
    suggestedPriceCents: product.suggestedPriceCents,
    title: product.title,
    updatedAt: product.updatedAt
  };
}

async function listAllProducts(database) {
  const products = [];
  for (let offset = 0; offset < 10_000; offset += 200) {
    const page = await listProducts(database, { limit: 200, offset });
    products.push(...page);
    if (page.length < 200) break;
  }
  return products;
}

async function parsePricingRequest(request) {
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new OwnerPricingError("unsupported_media_type", "Pricing updates require JSON.", 415);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new OwnerPricingError("request_too_large", "Pricing update is too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new OwnerPricingError("request_too_large", "Pricing update is too large.", 413);
  }
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new OwnerPricingError("invalid_json", "Pricing update must be valid JSON.", 400); }
  return validatePricingInput(body);
}

function pricingModelState(pricingModel) {
  if (pricingModel === "free") return { buyMode: "free-download", status: "free-download" };
  if (pricingModel === "pwyw") return { buyMode: "cart", status: "pay-what-you-want" };
  return { buyMode: "cart", status: "available-direct" };
}

function hasPricingChange(current, patch) {
  for (const key of ["buyMode", "currency", "minimumPriceCents", "priceCents", "pricingModel",
    "publicationState", "saleEnabled", "saleEnd", "salePriceCents", "saleStart", "status", "suggestedPriceCents"]) {
    if ((current[key] ?? null) !== (patch[key] ?? null)) return true;
  }
  return String(current.metadata?.saleLabel || "") !== String(patch.metadata?.saleLabel || "");
}

function cents(value, label, required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) invalid(`${label} is required.`);
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be nonnegative integer cents.`);
  return value;
}

function requiredString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) invalid(`${label} is too long.`);
  return normalized;
}

function optionalString(value, label, maxLength) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) invalid(`${label} is too long.`);
  return normalized;
}

function dateText(value, label) {
  const normalized = optionalString(value, label, 10);
  if (!normalized) return "";
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    invalid(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return normalized;
}

function invalid(message) {
  throw new OwnerPricingError("invalid_pricing", message, 400);
}

function logOwnerPricingException(request, error) {
  console.error(JSON.stringify({
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
    event: "owner_pricing_publish_exception",
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get("cf-ray") || ""
  }));
}
