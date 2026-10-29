import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { prepareCreatorListingFile } from "./creator-files.mjs";
import { createProduct, getProductById, getProductBySlug, validateProductInput } from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

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
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to publish a product." }, 405);
  if (!env.TRG_ORDERS?.prepare || !env.TRG_PRODUCTS?.put || !env.TRG_PRODUCTS?.get ||
      !env.TRG_PRODUCTS?.head || !env.TRG_PRODUCTS?.delete) {
    return jsonResponse({ error: "Product publication bindings are unavailable." }, 503);
  }
  let session;
  try { session = await getSessionFromRequest(request, env); }
  catch { return jsonResponse({ error: "Owner session could not be verified." }, 503); }
  if (!session.valid) return jsonResponse({ error: "Sign in as an Owner to publish products." }, 401);
  if (!["owner", "admin"].includes(session.user.role)) {
    return jsonResponse({ error: "Only an Owner may publish products." }, 403);
  }
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return jsonResponse({ error: "The Owner publication request could not be verified." }, 403);
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
    const product = await publishProduct(env.TRG_ORDERS, env.TRG_PRODUCTS, {
      metadata, coverFile: form.get("cover"), pdfFile: form.get("pdf")
    });
    return jsonResponse({ ok: true, product }, 201);
  } catch (error) {
    const failure = error instanceof ProductPublicationError ? error
      : new ProductPublicationError("publication_failed", "Product publication failed.");
    console.error(JSON.stringify({ event: "product_publication_failed", code: failure.code, message: String(error?.message || error) }));
    return jsonResponse({ error: failure.message, code: failure.code, ...failure.details }, failure.status);
  }
}

export async function publishProduct(database, bucket, { metadata, coverFile, pdfFile }, options = {}) {
  if (!database?.prepare || !bucket?.head || !bucket?.put || !bucket?.get || !bucket?.delete) {
    throw new ProductPublicationError("bindings_unavailable", "Product publication bindings are unavailable.");
  }
  const attemptId = options.attemptId || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new ProductPublicationError("invalid_attempt", "Publication attempt ID is invalid.", 400);
  }
  let cover;
  let pdf;
  try {
    cover = await prepareCreatorListingFile(coverFile, "cover");
    pdf = await prepareCreatorListingFile(pdfFile, "product");
  } catch (error) {
    throw new ProductPublicationError("invalid_file", error.message, error.status || 400);
  }
  const coverKey = `catalog-publications/${attemptId}/cover.webp`;
  const deliveryKey = `catalog-publications/${attemptId}/delivery.pdf`;
  let candidate;
  try {
    candidate = validateProductInput({ ...metadata, publicationState: "published",
      publishedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
      coverR2Key: coverKey, deliveryR2Key: deliveryKey,
      deliveryFilename: pdf.normalizedFilename, deliveryContentType: pdf.contentType });
  } catch (error) {
    throw new ProductPublicationError("invalid_metadata", error.message, 400);
  }
  const creator = await database.prepare("SELECT id,marketplace_status FROM marketplace_creators WHERE id=?")
    .bind(candidate.creatorId).first();
  if (!creator || creator.marketplace_status !== "approved") {
    throw new ProductPublicationError("creator_unavailable", "Product Creator is not approved.", 409);
  }
  if (await getProductById(database, candidate.id) || await getProductBySlug(database, candidate.slug)) {
    throw new ProductPublicationError("product_exists", "Product ID or slug already exists.", 409);
  }
  if (await bucket.head(coverKey) || await bucket.head(deliveryKey)) {
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
    const deliveryWrite = await bucket.put(deliveryKey, pdf.bytes, { onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: pdf.contentType },
      customMetadata: { publicationAttemptId: attemptId, productId: candidate.id } });
    if (!deliveryWrite) throw new ProductPublicationError("asset_exists", "Publication asset key already exists.", 409);
    await verifyObject(bucket, deliveryKey, pdf.bytes, pdf.contentType, attemptId);
    insertAttempted = true;
    const product = await createProduct(database, candidate, { nowMs: options.nowMs });
    if (!matchesAttempt(product, coverKey, deliveryKey)) {
      throw new ProductPublicationError("commit_unverified", "Published product record could not be verified.");
    }
    return product;
  } catch (error) {
    if (insertAttempted) {
      let record;
      try { record = await getProductById(database, candidate.id); }
      catch { throw new ProductPublicationError("commit_unverified", "Database commit could not be verified; publication assets were retained.", 503, { attemptId }); }
      if (matchesAttempt(record, coverKey, deliveryKey)) return record;
      if (record?.coverR2Key === coverKey || record?.deliveryR2Key === deliveryKey) {
        throw new ProductPublicationError("commit_unverified", "Published product references publication assets; assets were retained.", 503, { attemptId });
      }
    }
    try {
      const ownedKeys = [];
      for (const key of [coverKey, deliveryKey]) {
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

function matchesAttempt(product, coverKey, deliveryKey) {
  return product?.publicationState === "published" &&
    product.coverR2Key === coverKey && product.deliveryR2Key === deliveryKey;
}
