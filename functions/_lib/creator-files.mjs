import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
import { getCreatorOperationalEligibility } from "./creator-registration.mjs";
export const CREATOR_FILE_LIMITS = Object.freeze({
  product: 50 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
  preview: 10 * 1024 * 1024,
  supporting: 20 * 1024 * 1024,
});
export const CREATOR_FILE_TYPES = Object.freeze({
  product: ["application/pdf"],
  cover: ["image/webp"],
  preview: ["image/webp"],
  supporting: ["application/pdf", "image/webp", "image/png", "image/jpeg"],
});
export async function handleCreatorFileUpload(
  request,
  env = {},
  listingId,
  options = {},
) {
  if (request.method !== "POST")
    return json(
      {
        error: {
          code: "method_not_allowed",
          message: "Use POST to upload a creator file.",
        },
      },
      405,
    );
  const db = options.database || env.TRG_ORDERS,
    session = await getSessionFromRequest(
      request,
      env,
      options.sessionOptions || {},
    );
  if (!session.valid)
    return json(
      {
        error: {
          code: "not_authenticated",
          message: "Sign in to upload listing files.",
        },
      },
      401,
    );
  if (
    !validateSameOriginRequest(request) ||
    !(await validateSessionCsrf(request, session)).valid
  )
    return json(
      {
        error: {
          code: "request_not_verified",
          message: "The upload request could not be verified.",
        },
      },
      403,
    );
  let listing;
  try {
    listing = await db
      .prepare(
        `SELECT cl.id,cl.creator_id,cl.lifecycle_state,cl.publication_state,cl.owner_review_hold,cm.permission FROM creator_listings cl JOIN creator_memberships cm ON cm.creator_id=cl.creator_id WHERE cl.id=? AND cm.user_id=?`,
      )
      .bind(listingId, session.user.id)
      .first();
  } catch {
    listing = await db
      .prepare(
        `SELECT cl.id,cl.creator_id,cl.lifecycle_state,cl.publication_state,0 owner_review_hold,cm.permission FROM creator_listings cl JOIN creator_memberships cm ON cm.creator_id=cl.creator_id WHERE cl.id=? AND cm.user_id=?`,
      )
      .bind(listingId, session.user.id)
      .first();
  }
  if (!listing || !["manager", "editor"].includes(listing.permission))
    return json(
      {
        error: {
          code: "creator_access_denied",
          message: "You cannot upload files for that listing.",
        },
      },
      403,
    );
  if (
    !["draft", "needs_changes", "paused"].includes(listing.lifecycle_state) &&
    !(listing.lifecycle_state === "active" && ["published", "publishing", "failed"].includes(listing.publication_state)) &&
    Number(listing.owner_review_hold) !== 1
  )
    return json(
      {
        error: {
          code: "creator_listing_not_editable",
          message: "Files cannot change while this submission is under review.",
        },
      },
      409,
    );
  const readiness = await getCreatorOperationalEligibility(
    db,
    listing.creator_id,
    {
      markInitialCompletion: true,
      nowMs: options.nowMs,
    },
  );
  if (!readiness.eligible)
    return json(
      {
        error: {
          code: "creator_registration_incomplete",
          message:
            "Current Creator eligibility requirements must be restored before uploads are available.",
          reasons: readiness.reasonCodes,
          remediation: readiness.remediation,
        },
      },
      403,
    );
  if (!env.TRG_PRODUCTS?.put)
    return json(
      {
        error: {
          code: "creator_storage_unavailable",
          message: "Private creator file staging is unavailable.",
        },
      },
      503,
    );
  let form;
  try {
    form = await request.formData();
  } catch {
    return invalid("Upload form is invalid.");
  }
  const file = form.get("file"), purpose = String(form.get("purpose") || "");
  let prepared;
  let generatedFront = null, generatedBack = null, pageCount = null;
  try {
    prepared = await prepareCreatorListingFile(file, purpose);
    if (purpose === "product" && form.get("generatedFront") != null) {
      pageCount = Number(form.get("pdfPageCount"));
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100000 ||
          (pageCount > 1) !== (form.get("generatedBack") != null)) {
        throw fileError(400, "invalid_creator_file", "Generated PDF cover pages are incomplete.");
      }
      generatedFront = await prepareCreatorListingFile(form.get("generatedFront"), "cover");
      if (pageCount > 1) generatedBack = await prepareCreatorListingFile(form.get("generatedBack"), "cover");
    } else if (form.get("generatedBack") != null || form.get("pdfPageCount") != null) {
      throw fileError(400, "invalid_creator_file", "Generated cover pages require a product PDF.");
    }
  } catch (error) {
    return json(
      { error: { code: error.code || "invalid_creator_file", message: error.message } },
      error.status || 400,
    );
  }
  const { contentType: detected, normalizedFilename: name } = prepared;
  const id = crypto.randomUUID(),
    key = `creator-quarantine/${listing.creator_id}/${listing.id}/${id}/${name}`,
    generatedCoverKey = generatedFront ? `creator-quarantine/${listing.creator_id}/${listing.id}/${id}/generated-cover.webp` : null,
    generatedBackCoverKey = generatedBack ? `creator-quarantine/${listing.creator_id}/${listing.id}/${id}/generated-back-cover.webp` : null,
    now = new Date(
      Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
    ).toISOString();
  const attemptedKeys = [];
  try {
    for (const [objectKey, payload, objectPurpose] of [
      [key, prepared, purpose],
      [generatedCoverKey, generatedFront, "generated-cover"],
      [generatedBackCoverKey, generatedBack, "generated-back-cover"]
    ]) {
      if (!objectKey) continue;
      attemptedKeys.push(objectKey);
      const write = await env.TRG_PRODUCTS.put(objectKey, payload.bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        httpMetadata: { contentType: payload.contentType },
        customMetadata: { listingId: listing.id, purpose: objectPurpose,
          scanState: "pending", uploadAttemptId: id }
      });
      if (write === null) throw fileError(409, "creator_file_conflict", "The private upload key is already reserved. Try the upload again.");
    }
    await db.batch([
      db
        .prepare(
          "UPDATE creator_listing_files SET validation_state='superseded',validated_at=? WHERE listing_id=? AND purpose=? AND validation_state IN ('uploaded','validating','accepted')",
        )
        .bind(now, listing.id, purpose),
      db
        .prepare(
          "INSERT INTO creator_listing_files(id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,generated_cover_key,generated_back_cover_key,pdf_page_count,validation_state,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'uploaded',?)",
        )
        .bind(
          id,
          listing.id,
          listing.creator_id,
          purpose,
          String(file.name).slice(0, 255),
          name,
          detected,
          file.size,
          key,
          generatedCoverKey,
          generatedBackCoverKey,
          pageCount,
          now,
        ),
      db
        .prepare(
          "INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'creator',?,'file_uploaded',?,?)",
        )
        .bind(
          listing.id,
          listing.creator_id,
          session.user.id,
          JSON.stringify({
            fileId: id,
            purpose,
            contentType: detected,
            sizeBytes: file.size,
          }),
          now,
        ),
    ]);
  } catch (error) {
    let cleaned = true;
    try {
      for (const attemptedKey of attemptedKeys) {
        const stored = env.TRG_PRODUCTS.head ? await env.TRG_PRODUCTS.head(attemptedKey) : null;
        if (stored?.customMetadata?.uploadAttemptId !== id) continue;
        if (!env.TRG_PRODUCTS.delete) { cleaned = false; continue; }
        await env.TRG_PRODUCTS.delete(attemptedKey);
        if (env.TRG_PRODUCTS.head && await env.TRG_PRODUCTS.head(attemptedKey)) cleaned = false;
      }
    } catch {
      cleaned = false;
    }
    console.error(
      JSON.stringify({
        message: "creator file staging failed",
        listingId: listing.id,
        fileId: id,
        storageCleaned: cleaned,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json(
      {
        error: {
          code: cleaned
            ? (error.code || "creator_file_staging_failed")
            : "creator_file_cleanup_failed",
          message: cleaned
            ? (error.status === 409 ? error.message : "The private file could not be recorded. Nothing was submitted.")
            : "The private file could not be recorded or safely cleaned up. Owner attention is required.",
        },
      },
      cleaned && error.status === 409 ? 409 : 503,
    );
  }
  return json(
    { ok: true, file: { id, purpose, filename: name, state: "uploaded" } },
    201,
  );
}
export async function prepareCreatorListingFile(file, purpose, options = {}) {
  if (!(file instanceof File) || !CREATOR_FILE_TYPES[purpose])
    throw fileError(400, "invalid_creator_file", "Choose a file and its purpose.");
  const defaultLimit = CREATOR_FILE_LIMITS[purpose];
  const limit = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : defaultLimit;
  if (file.size < 1 || file.size > limit)
    throw fileError(
      400,
      "invalid_creator_file",
      `File must be smaller than ${Math.floor(limit / 1024 / 1024)} MB.`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer()), contentType = detectType(bytes);
  if (!contentType || !CREATOR_FILE_TYPES[purpose].includes(contentType) || !CREATOR_FILE_TYPES[purpose].includes(file.type))
    throw fileError(415, "creator_file_type_rejected", "The file contents and declared type must match an allowed PDF, WebP, PNG, or JPEG type.");
  return { bytes, contentType, normalizedFilename: normalizeFilename(file.name, contentType) };
}
function fileError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }
function detectType(b) {
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    b.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  return "";
}
function normalizeFilename(name, type) {
  const ext = {
    "application/pdf": "pdf",
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
  }[type];
  const base =
    String(name || "file")
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "file";
  return `${base}.${ext}`;
}
function invalid(message) {
  return json({ error: { code: "invalid_creator_file", message } }, 400);
}
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
