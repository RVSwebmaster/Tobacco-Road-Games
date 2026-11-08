import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { prepareCreatorListingFile } from "./creator-files.mjs";
import {
  createProduct,
  getProductById,
  getProductBySlug,
  listProducts,
  ProductCatalogError,
  updateProduct,
  validateProductInput
} from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const MUTABLE_PRODUCT_FIELDS = Object.freeze([
  "creatorListingId", "publicationState", "title", "subtitle", "shortDescription", "longDescription",
  "publisher", "gameSystem", "productLine", "genre", "mediaType", "status", "buyMode", "buyUrl",
  "currency", "pricingModel", "priceCents", "suggestedPriceCents", "minimumPriceCents", "saleEnabled",
  "salePriceCents", "saleStart", "saleEnd", "coverR2Key", "backCoverR2Key", "previewR2Key",
  "thumbnailR2Key", "deliveryR2Key", "deliveryFilename", "deliveryContentType", "metadata", "publishedAt"
]);
const OFFICIAL_TRG_CREATOR_ID = "creator-rv-sawyer";

export class ProductPublicationError extends Error {
  constructor(code, message, status = 503, details = {}) {
    super(message);
    this.name = "ProductPublicationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function handleOwnerCatalogPublicationRequest(request, env) {
  const method = String(request.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) return jsonResponse({ error: "Product Intake accepts GET and POST requests." }, 405);
  if (!env.TRG_ORDERS?.prepare || (method === "POST" && (!env.TRG_PRODUCTS?.put || !env.TRG_PRODUCTS?.get ||
      !env.TRG_PRODUCTS?.head || !env.TRG_PRODUCTS?.delete))) {
    return jsonResponse({ error: "Product publication bindings are unavailable." }, 503);
  }
  let session;
  try { session = await getSessionFromRequest(request, env); }
  catch { return jsonResponse({ error: "Admin or Owner session could not be verified." }, 503); }
  if (!session.valid) return jsonResponse({ error: "Sign in as an Admin or Owner to publish products." }, 401);
  if (!["owner", "admin"].includes(session.user.role)) {
    return jsonResponse({ error: "Only an Admin or Owner may publish products." }, 403);
  }
  if (method === "GET") {
    try {
      const products = [];
      for (let offset = 0; offset < 10_000; offset += 200) {
        const page = await listProducts(env.TRG_ORDERS, { limit: 200, offset });
        products.push(...page);
        if (page.length < 200) break;
      }
      return jsonResponse({ csrfToken: session.csrfToken, products: products.map(ownerIntakeProduct) });
    } catch (error) {
      console.error(JSON.stringify({ event: "product_intake_list_failed", message: String(error?.message || error) }));
      return jsonResponse({ error: "Native product listings could not be loaded." }, 503);
    }
  }
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return jsonResponse({ error: "The Admin or Owner publication request could not be verified." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return jsonResponse({ error: "Use a multipart publication request." }, 415);
  }
  try {
    const form = await request.formData();
    const raw = form.get("metadata");
    if (typeof raw !== "string" || raw.length > 64 * 1024) {
      throw new ProductPublicationError("invalid_metadata", "Product metadata must be JSON up to 64 KB.", 400);
    }
    let metadata;
    try { metadata = JSON.parse(raw); }
    catch { throw new ProductPublicationError("invalid_metadata", "Product metadata must be valid JSON.", 400); }
    const action = form.get("action") === "update" ? "update" : "create";
    const publicationInput = {
      metadata, coverFile: form.get("cover"), backCoverFile: form.get("backCover"), pdfFile: form.get("pdf")
    };
    const publicationOptions = {
      managingRole: session.user.role,
      managingUserId: session.user.id
    };
    const product = action === "update"
      ? await updatePublishedProduct(env.TRG_ORDERS, env.TRG_PRODUCTS, {
        ...publicationInput,
        expectedRevision: Number(form.get("expectedRevision")),
        slug: String(form.get("slug") || "")
      }, publicationOptions)
      : await publishProduct(env.TRG_ORDERS, env.TRG_PRODUCTS, publicationInput, publicationOptions);
    return jsonResponse({
      ok: true,
      product,
      storefrontUrl: `/store/products/${encodeURIComponent(product.slug)}/`
    }, action === "update" ? 200 : 201);
  } catch (error) {
    const failure = error instanceof ProductPublicationError ? error
      : new ProductPublicationError("publication_failed", "Product publication failed.");
    console.error(JSON.stringify({ event: "product_publication_failed", code: failure.code, message: String(error?.message || error) }));
    return jsonResponse({ error: failure.message, code: failure.code, ...failure.details }, failure.status);
  }
}

export function ownerIntakeProduct(product) {
  return {
    ...product,
    authors: Array.isArray(product.metadata?.authors) ? product.metadata.authors : [],
    contentDescriptors: Array.isArray(product.metadata?.contentDescriptors) ? product.metadata.contentDescriptors : [],
    features: Array.isArray(product.metadata?.features) ? product.metadata.features : [],
    fileList: Array.isArray(product.metadata?.fileList) ? product.metadata.fileList : [],
    folder: String(product.metadata?.storageLabel || product.slug),
    format: Array.isArray(product.metadata?.format) ? product.metadata.format : [],
    fulfillmentNote: String(product.metadata?.fulfillmentNote || ""),
    gameSystemSlug: String(product.metadata?.gameSystemSlug || ""),
    lastUpdated: String(product.metadata?.lastUpdated || ""),
    legalNote: String(product.metadata?.legalNote || ""),
    openRulesEligible: Boolean(product.metadata?.openRulesEligible),
    pageCount: Number(product.metadata?.pageCount || 0) || null,
    relatedProducts: Array.isArray(product.metadata?.relatedProducts) ? product.metadata.relatedProducts : [],
    releaseDate: String(product.metadata?.releaseDate || ""),
    series: String(product.metadata?.series || ""),
    seriesSlug: String(product.metadata?.seriesSlug || ""),
    tags: Array.isArray(product.metadata?.tags) ? product.metadata.tags : [],
    version: String(product.metadata?.version || "")
  };
}

export async function publishProduct(database, bucket, { metadata, coverFile, backCoverFile, pdfFile }, options = {}) {
  if (!database?.prepare || !bucket?.head || !bucket?.put || !bucket?.get || !bucket?.delete) {
    throw new ProductPublicationError("bindings_unavailable", "Product publication bindings are unavailable.");
  }
  const attemptId = options.attemptId || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new ProductPublicationError("invalid_attempt", "Publication attempt ID is invalid.", 400);
  }
  let cover;
  let backCover;
  let pdf;
  try {
    cover = await prepareCreatorListingFile(coverFile, "cover");
    if (backCoverFile != null) backCover = await prepareCreatorListingFile(backCoverFile, "cover");
    pdf = await prepareCreatorListingFile(pdfFile, "product");
  } catch (error) {
    throw new ProductPublicationError("invalid_file", error.message, error.status || 400);
  }
  const coverKey = `catalog-publications/${attemptId}/cover.webp`;
  const backCoverKey = backCover ? `catalog-publications/${attemptId}/back-cover.webp` : null;
  const deliveryKey = `catalog-publications/${attemptId}/delivery.pdf`;
  let candidate;
  try {
    candidate = validateProductInput({ ...metadata, managedByUserId: options.managingUserId || null, publicationState: "published",
      publishedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
      coverR2Key: coverKey, backCoverR2Key: backCoverKey, deliveryR2Key: deliveryKey,
      deliveryFilename: pdf.normalizedFilename, deliveryContentType: pdf.contentType });
  } catch (error) {
    throw new ProductPublicationError("invalid_metadata", error.message, 400);
  }
  if (options.managingRole === "admin" &&
      (candidate.publisher !== "Tobacco Road Games" || candidate.creatorId !== OFFICIAL_TRG_CREATOR_ID)) {
    throw new ProductPublicationError("invalid_metadata",
      "Admin Intake publishes only through the official Tobacco Road Games publishing identity.", 400);
  }
  if (options.managingUserId) {
    const manager = await database.prepare("SELECT id,role,status FROM users WHERE id=?")
      .bind(options.managingUserId).first();
    if (!manager || manager.status !== "active" || !["admin", "owner"].includes(manager.role) ||
        (options.managingRole && manager.role !== options.managingRole)) {
      throw new ProductPublicationError("manager_unavailable", "The managing Admin or Owner account is not active.", 403);
    }
  }
  const creator = await database.prepare("SELECT id,marketplace_status,registration_status,closure_state FROM marketplace_creators WHERE id=?")
    .bind(candidate.creatorId).first();
  if (!creator || creator.marketplace_status !== "approved" || creator.registration_status !== "active" || creator.closure_state !== "active") {
    throw new ProductPublicationError("creator_unavailable", "Product Creator is not approved and active.", 409);
  }
  if (await getProductById(database, candidate.id) || await getProductBySlug(database, candidate.slug)) {
    throw new ProductPublicationError("product_exists", "Product ID or slug already exists.", 409);
  }
  if (await bucket.head(coverKey) || (backCoverKey && await bucket.head(backCoverKey)) || await bucket.head(deliveryKey)) {
    throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
  }

  // Reserve only this attempt's unique keys. A put may write before reporting an error.
  let insertAttempted = false;
  try {
    const coverWrite = await bucket.put(coverKey, cover.bytes, { onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: cover.contentType },
      customMetadata: { publicationAttemptId: attemptId, productId: candidate.id } });
    if (!coverWrite) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
    await verifyObject(bucket, coverKey, cover.bytes, cover.contentType, attemptId);
    if (backCoverKey) {
      const backCoverWrite = await bucket.put(backCoverKey, backCover.bytes, { onlyIf: new Headers({ "if-none-match": "*" }),
        httpMetadata: { contentType: backCover.contentType },
        customMetadata: { publicationAttemptId: attemptId, productId: candidate.id } });
      if (!backCoverWrite) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
      await verifyObject(bucket, backCoverKey, backCover.bytes, backCover.contentType, attemptId);
    }
    const deliveryWrite = await bucket.put(deliveryKey, pdf.bytes, { onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: pdf.contentType },
      customMetadata: { publicationAttemptId: attemptId, productId: candidate.id } });
    if (!deliveryWrite) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
    await verifyObject(bucket, deliveryKey, pdf.bytes, pdf.contentType, attemptId);
    insertAttempted = true;
    const product = await createProduct(database, candidate, { nowMs: options.nowMs });
    if (!matchesAttempt(product, coverKey, backCoverKey, deliveryKey)) {
      throw new ProductPublicationError("commit_unverified", "Published product record could not be verified.");
    }
    return product;
  } catch (error) {
    if (insertAttempted) {
      let record;
      try { record = await getProductById(database, candidate.id); }
      catch { throw new ProductPublicationError("commit_unverified", "Database commit could not be verified; publication assets were retained.", 503, { attemptId }); }
      if (matchesAttempt(record, coverKey, backCoverKey, deliveryKey)) return record;
      if (record?.coverR2Key === coverKey || (backCoverKey && record?.backCoverR2Key === backCoverKey) || record?.deliveryR2Key === deliveryKey) {
        throw new ProductPublicationError("commit_unverified", "Published product references publication assets; assets were retained.", 503, { attemptId });
      }
    }
    try {
      const ownedKeys = [];
      for (const key of [coverKey, backCoverKey, deliveryKey].filter(Boolean)) {
        const object = await bucket.head(key);
        if (object?.customMetadata?.publicationAttemptId === attemptId &&
            object.customMetadata.productId === candidate.id) ownedKeys.push(key);
      }
      if (ownedKeys.length) await bucket.delete(ownedKeys);
      for (const key of ownedKeys) if (await bucket.head(key)) throw new Error("Asset remained after cleanup.");
    }
    catch { throw new ProductPublicationError("cleanup_incomplete", "Publication failed and its temporary assets could not be fully removed.", 503, { attemptId }); }
    if (error instanceof ProductPublicationError) throw error;
    throw new ProductPublicationError("publication_failed", "Product publication failed.", 503, { attemptId });
  }
}

export async function updatePublishedProduct(
  database,
  bucket,
  { slug, expectedRevision, metadata, coverFile, backCoverFile, pdfFile },
  options = {}
) {
  if (!database?.prepare || !bucket?.head || !bucket?.put || !bucket?.get || !bucket?.delete) {
    throw new ProductPublicationError("bindings_unavailable", "Product publication bindings are unavailable.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ProductPublicationError("invalid_metadata", "A valid existing product slug and revision are required.", 400);
  }
  const current = await getProductBySlug(database, slug);
  if (!current) throw new ProductPublicationError("product_not_found", "Native D1 product not found.", 404);
  if (!["published", "paused"].includes(current.publicationState)) {
    throw new ProductPublicationError("product_not_editable", "Only published or paused native products can be maintained here.", 409);
  }
  if (options.managingRole === "admin" && current.managedByUserId !== options.managingUserId) {
    throw new ProductPublicationError("manager_required", "This Admin account does not manage the selected product.", 403);
  }
  if (metadata?.id !== current.id || metadata?.slug !== current.slug || metadata?.creatorId !== current.creatorId) {
    throw new ProductPublicationError("immutable_identity", "Product ID, slug, and publishing identity cannot be changed.", 409);
  }

  const attemptId = options.attemptId || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new ProductPublicationError("invalid_attempt", "Publication attempt ID is invalid.", 400);
  }
  const supplied = value => value && typeof value.arrayBuffer === "function" && Number(value.size) > 0;
  const hasCover = supplied(coverFile);
  const hasBackCover = supplied(backCoverFile);
  const hasPdf = supplied(pdfFile);
  if (hasPdf && !hasCover) {
    throw new ProductPublicationError("invalid_file", "A replacement PDF requires its generated front cover.", 400);
  }

  let cover;
  let backCover;
  let pdf;
  try {
    if (hasCover) cover = await prepareCreatorListingFile(coverFile, "cover");
    if (hasBackCover) backCover = await prepareCreatorListingFile(backCoverFile, "cover");
    if (hasPdf) pdf = await prepareCreatorListingFile(pdfFile, "product");
  } catch (error) {
    throw new ProductPublicationError("invalid_file", error.message, error.status || 400);
  }

  const coverKey = cover ? `catalog-publications/${attemptId}/cover.webp` : current.coverR2Key;
  const backCoverKey = hasPdf
    ? (backCover ? `catalog-publications/${attemptId}/back-cover.webp` : null)
    : (backCover ? `catalog-publications/${attemptId}/back-cover.webp` : current.backCoverR2Key);
  const deliveryKey = pdf ? `catalog-publications/${attemptId}/delivery.pdf` : current.deliveryR2Key;
  let candidate;
  try {
    candidate = validateProductInput({
      ...metadata,
      id: current.id,
      slug: current.slug,
      creatorId: current.creatorId,
      managedByUserId: current.managedByUserId,
      creatorListingId: current.creatorListingId,
      publicationState: current.publicationState,
      publishedAt: current.publishedAt,
      coverR2Key: coverKey,
      backCoverR2Key: backCoverKey,
      previewR2Key: current.previewR2Key,
      thumbnailR2Key: current.thumbnailR2Key,
      deliveryR2Key: deliveryKey,
      deliveryFilename: pdf ? pdf.normalizedFilename : current.deliveryFilename,
      deliveryContentType: pdf ? pdf.contentType : current.deliveryContentType
    });
  } catch (error) {
    throw new ProductPublicationError("invalid_metadata", error.message, 400);
  }
  if (options.managingRole === "admin" &&
      (candidate.publisher !== "Tobacco Road Games" || candidate.creatorId !== OFFICIAL_TRG_CREATOR_ID)) {
    throw new ProductPublicationError("invalid_metadata",
      "Admin Intake maintains only the official Tobacco Road Games publishing identity.", 400);
  }
  const creator = await database.prepare("SELECT id,marketplace_status,registration_status,closure_state FROM marketplace_creators WHERE id=?")
    .bind(candidate.creatorId).first();
  if (!creator || creator.marketplace_status !== "approved" || creator.registration_status !== "active" || creator.closure_state !== "active") {
    throw new ProductPublicationError("creator_unavailable", "Product Creator is not approved and active.", 409);
  }

  const writes = [
    cover && { key: coverKey, file: cover },
    backCover && { key: backCoverKey, file: backCover },
    pdf && { key: deliveryKey, file: pdf }
  ].filter(Boolean);
  for (const { key } of writes) {
    if (await bucket.head(key)) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
  }
  const writtenKeys = [];
  try {
    for (const { key, file } of writes) {
      const write = await bucket.put(key, file.bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        httpMetadata: { contentType: file.contentType },
        customMetadata: { publicationAttemptId: attemptId, productId: current.id }
      });
      if (!write) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
      writtenKeys.push(key);
      await verifyObject(bucket, key, file.bytes, file.contentType, attemptId);
    }
    const patch = Object.fromEntries(MUTABLE_PRODUCT_FIELDS.map(field => [field, candidate[field]]));
    const product = await updateProduct(database, current.id, patch, {
      expectedRevision,
      nowMs: options.nowMs
    });
    const replacedKeys = [
      cover && current.coverR2Key,
      hasPdf && current.backCoverR2Key,
      !hasPdf && backCover && current.backCoverR2Key,
      pdf && current.deliveryR2Key
    ].filter(key => key && ![coverKey, backCoverKey, deliveryKey].includes(key) && key.startsWith("catalog-publications/"));
    if (replacedKeys.length) {
      try { await bucket.delete([...new Set(replacedKeys)]); }
      catch (error) {
        console.error(JSON.stringify({ event: "product_publication_old_asset_cleanup_failed", productId: current.id,
          message: String(error?.message || error) }));
      }
    }
    return product;
  } catch (error) {
    try { if (writtenKeys.length) await bucket.delete(writtenKeys); }
    catch { throw new ProductPublicationError("cleanup_incomplete", "Product update failed and new assets could not be fully removed.", 503, { attemptId }); }
    if (error instanceof ProductPublicationError) throw error;
    if (error instanceof ProductCatalogError && error.code === "conflict") {
      throw new ProductPublicationError("revision_conflict", "This product changed after it was loaded. Reload it before trying again.", 409);
    }
    if (error instanceof ProductCatalogError) {
      throw new ProductPublicationError("invalid_metadata", error.message, 400);
    }
    throw new ProductPublicationError("publication_failed", "Product update failed.", 503, { attemptId });
  }
}

async function verifyObject(bucket, key, expectedBytes, contentType, attemptId) {
  const object = await bucket.get(key);
  if (!object || Number(object.size) !== expectedBytes.byteLength ||
      object.httpMetadata?.contentType !== contentType ||
      object.customMetadata?.publicationAttemptId !== attemptId) {
    throw new ProductPublicationError("asset_verification_failed", "Uploaded publication asset could not be verified.");
  }
  const stored = new Uint8Array(await object.arrayBuffer());
  if (stored.byteLength !== expectedBytes.byteLength || await digest(stored) !== await digest(expectedBytes)) {
    throw new ProductPublicationError("asset_verification_failed", "Uploaded publication asset content did not match.");
  }
}

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

function matchesAttempt(product, coverKey, backCoverKey, deliveryKey) {
  return product?.publicationState === "published" &&
    product.coverR2Key === coverKey && product.backCoverR2Key === backCoverKey && product.deliveryR2Key === deliveryKey;
}
