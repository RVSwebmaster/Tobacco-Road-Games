import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf
} from "./account-auth.mjs";
import {
  getHomepageConfiguration,
  HomepageConfigurationError,
  updateHomepageConfiguration,
  validateHomepageConfiguration
} from "./homepage-config-d1.mjs";
import { getHomepageCandidateSets } from "./homepage-shelves.mjs";
import { listProducts } from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_REQUEST_FIELDS = new Set(["expectedRevision", "shelves"]);

export class OwnerHomepageError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OwnerHomepageError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function handleOwnerHomepagePublishRequest(request, env, options = {}) {
  const method = String(request.method || "GET").toUpperCase();
  if (!env.TRG_ORDERS?.prepare) {
    return jsonResponse({ error: "Homepage configuration database is unavailable.", code: "bindings_unavailable" }, 503);
  }
  if (!["GET", "POST"].includes(method)) {
    return jsonResponse({ error: "Homepage management accepts GET and POST requests.", code: "method_not_allowed" }, 405);
  }

  let session;
  try { session = await getSessionFromRequest(request, env, options); }
  catch (error) {
    logOwnerHomepageException(request, error);
    return jsonResponse({ error: "Owner session could not be verified.", code: "session_unavailable" }, 503);
  }
  if (!session.valid) return jsonResponse({ error: "Sign in as an Owner to manage the homepage.", code: "authentication_required" }, 401);
  if (!["owner", "admin"].includes(session.user.role)) {
    return jsonResponse({ error: "Only an Owner may manage homepage merchandising.", code: "owner_required" }, 403);
  }

  if (method === "GET") {
    try {
      const payload = await loadOwnerHomepageState(env.TRG_ORDERS, options);
      return jsonResponse({ csrfToken: session.csrfToken, ...payload });
    } catch (error) {
      logOwnerHomepageException(request, error);
      return jsonResponse({ error: "Homepage configuration could not be loaded.", code: "homepage_unavailable" }, 503);
    }
  }

  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return jsonResponse({ error: "The Owner homepage request could not be verified.", code: "csrf_rejected" }, 403);
  }

  try {
    const input = await parseHomepageRequest(request);
    const current = await getHomepageConfiguration(env.TRG_ORDERS);
    if (input.expectedRevision !== current.revision) {
      throw new OwnerHomepageError("revision_conflict",
        "The homepage changed after this editor loaded. Reload the current configuration before saving again.", 409,
        { configuration: current.configuration, revision: current.revision });
    }
    const configuration = validateHomepageConfiguration({
      version: 1,
      shelves: input.shelves,
      promotions: current.configuration.promotions
    });
    if (JSON.stringify(configuration) === JSON.stringify(current.configuration)) {
      throw new OwnerHomepageError("no_changes", "No homepage merchandising changes were submitted.", 400);
    }
    await validateHomepageReferences(env.TRG_ORDERS, configuration, options);
    const saved = await updateHomepageConfiguration(env.TRG_ORDERS, configuration, {
      expectedRevision: input.expectedRevision,
      nowMs: options.nowMs
    });
    return jsonResponse({
      configuration: saved.configuration,
      message: `Homepage merchandising revision ${saved.revision} is now authoritative.`,
      ok: true,
      revision: saved.revision,
      updatedAt: saved.updatedAt
    });
  } catch (error) {
    if (error instanceof OwnerHomepageError) {
      return jsonResponse({ error: error.message, code: error.code, ...error.details }, error.status);
    }
    if (error instanceof HomepageConfigurationError) {
      const status = error.code === "conflict" ? 409 : 400;
      const code = error.code === "conflict" ? "revision_conflict" : "invalid_homepage_configuration";
      return jsonResponse({ error: error.message, code }, status);
    }
    logOwnerHomepageException(request, error);
    return jsonResponse({ error: "Homepage configuration could not be saved.", code: "homepage_update_failed" }, 503);
  }
}

export async function loadOwnerHomepageState(database, options = {}) {
  const [record, candidates, products, creators] = await Promise.all([
    getHomepageConfiguration(database),
    getHomepageCandidateSets(database, { nowMs: options.nowMs }),
    listAllProducts(database),
    listCreators(database)
  ]);
  const eligible = Object.fromEntries(Object.entries(candidates).map(([key, values]) =>
    [key, values.map((product) => product.id)]));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  return {
    configuration: record.configuration,
    creators,
    eligibility: {
      featuredCreator: eligible.all,
      newThisWeek: eligible.newThisWeek,
      bestSellers: eligible.bestSellers,
      freePwyw: eligible.freePwyw
    },
    legacyCompatibility: {
      message: "Legacy-only homepage products remain in the pre-rendered fallback until their shelf is managed by native D1 configuration.",
      source: "repository-rendered-fallback"
    },
    products: products.map((product) => ownerHomepageProduct(product, creatorById.get(product.creatorId))),
    revision: record.revision,
    updatedAt: record.updatedAt
  };
}

export async function validateHomepageReferences(database, configuration, options = {}) {
  const [candidates, creators] = await Promise.all([
    getHomepageCandidateSets(database, { nowMs: options.nowMs }),
    listCreators(database)
  ]);
  const eligible = {
    featuredCreator: new Map(candidates.all.map((product) => [product.id, product])),
    newThisWeek: new Map(candidates.newThisWeek.map((product) => [product.id, product])),
    bestSellers: new Map(candidates.bestSellers.map((product) => [product.id, product])),
    freePwyw: new Map(candidates.freePwyw.map((product) => [product.id, product]))
  };
  const featured = configuration.shelves.featuredCreator;
  if (featured.creatorId) {
    const creator = creators.find((entry) => entry.id === featured.creatorId);
    if (!creator?.eligible) throw new OwnerHomepageError("creator_unavailable", "The Featured Creator must be approved and active.", 409);
  } else if (featured.productIds.length) {
    throw new OwnerHomepageError("creator_required", "Choose a Featured Creator before selecting their products.", 400);
  }
  for (const [shelfKey, shelf] of Object.entries(configuration.shelves)) {
    for (const productId of shelf.productIds) {
      const product = eligible[shelfKey].get(productId);
      if (!product) {
        throw new OwnerHomepageError("ineligible_product", `Product ${productId} is not eligible for the ${shelfLabel(shelfKey)} shelf.`, 409);
      }
      if (shelfKey === "featuredCreator" && product.creatorId !== featured.creatorId) {
        throw new OwnerHomepageError("creator_product_mismatch", "Featured Creator products must belong to the selected Creator.", 400);
      }
    }
  }
  return true;
}

function ownerHomepageProduct(product, creator) {
  return {
    available: product.publicationState === "published" && Boolean(creator?.eligible),
    creatorId: product.creatorId,
    creatorName: creator?.displayName || product.publisher || "Tobacco Road Games",
    id: product.id,
    pricingModel: product.pricingModel,
    publicationState: product.publicationState,
    revision: product.revision,
    slug: product.slug,
    source: "native-d1",
    status: product.status,
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

async function listCreators(database) {
  const result = await database.prepare(`SELECT id,slug,display_name,marketplace_status,registration_status,closure_state
    FROM marketplace_creators ORDER BY lower(display_name),id`).all();
  return (result.results || []).map((row) => ({
    displayName: String(row.display_name || row.slug || row.id),
    eligible: row.marketplace_status === "approved" && row.registration_status === "active" && row.closure_state === "active",
    id: String(row.id),
    slug: String(row.slug || "")
  }));
}

async function parseHomepageRequest(request) {
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new OwnerHomepageError("unsupported_media_type", "Homepage updates require JSON.", 415);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new OwnerHomepageError("request_too_large", "Homepage update is too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new OwnerHomepageError("request_too_large", "Homepage update is too large.", 413);
  }
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new OwnerHomepageError("invalid_json", "Homepage update must be valid JSON.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OwnerHomepageError("invalid_homepage_configuration", "Homepage update must be an object.", 400);
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_REQUEST_FIELDS.has(key)) throw new OwnerHomepageError("invalid_homepage_configuration", `Unsupported homepage update field: ${key}.`, 400);
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
    throw new OwnerHomepageError("invalid_revision", "A valid homepage revision is required.", 400);
  }
  if (!body.shelves || typeof body.shelves !== "object" || Array.isArray(body.shelves)) {
    throw new OwnerHomepageError("invalid_homepage_configuration", "Homepage shelves are required.", 400);
  }
  return { expectedRevision: body.expectedRevision, shelves: body.shelves };
}

function shelfLabel(value) {
  return ({ featuredCreator: "Featured Creator", newThisWeek: "New This Week", bestSellers: "Best Sellers", freePwyw: "Free & PWYW" })[value] || value;
}

function logOwnerHomepageException(request, error) {
  console.error(JSON.stringify({
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
    event: "owner_homepage_publish_exception",
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get("cf-ray") || ""
  }));
}
