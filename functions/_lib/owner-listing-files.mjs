import {
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  readCookie,
  verifySessionToken,
} from "./owner-auth.mjs";
import {
  getOwnerAccessConfig,
  verifyOwnerAccessRequest,
} from "./owner-access.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";
import { prepareCreatorListingFile } from "./creator-files.mjs";

export async function handleOwnerListingFiles(request, env = {}, options = {}) {
  const db = options.database || env.TRG_ORDERS;
  if (!db) return json({ error: "Marketplace database is unavailable." }, 503);
  if (request.method === "GET" || request.method === "HEAD") {
    const auth = await verifyOwnerRead(request, env, options);
    if (!auth.valid) return json({ error: auth.message }, auth.status);
    const url = new URL(request.url), fileId = url.searchParams.get("download");
    if (fileId) return downloadFile(request, db, env.TRG_PRODUCTS, fileId);
    return lookup(db, env.TRG_PRODUCTS, url.searchParams);
  }
  if (request.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env, { nowMs: options.nowMs });
  if (!auth.valid) return json({ error: auth.userMessage }, auth.status);
  return replaceFile(request, db, env.TRG_PRODUCTS, auth.username, options.nowMs);
}

async function lookup(db, bucket, params) {
  const query = String(params.get("q") || "").trim().toLowerCase().slice(0, 160),
    listingId = String(params.get("listingId") || "").trim(),
    state = String(params.get("state") || "").trim(),
    like = `%${query}%`;
  const result = await db.prepare(`SELECT l.id,l.creator_id,l.slug,l.source_product_slug,l.public_product_slug,l.title,l.lifecycle_state,l.publication_state,l.inactivity_state,l.media_type,l.updated_at,c.display_name creator_name,c.slug creator_slug
    FROM creator_listings l JOIN marketplace_creators c ON c.id=l.creator_id
    WHERE (?='' OR lower(l.id) LIKE ? OR lower(l.slug) LIKE ? OR lower(l.title) LIKE ? OR lower(c.id) LIKE ? OR lower(c.slug) LIKE ? OR lower(c.display_name) LIKE ?)
      AND (?='' OR l.lifecycle_state=? OR l.publication_state=? OR COALESCE(l.inactivity_state,'')=?)
    ORDER BY c.display_name,l.title LIMIT 100`).bind(query, like, like, like, like, like, like, state, state, state, state).all();
  const listings = result.results || [];
  let files = [];
  if (listingId) {
    const selected = listings.find((item) => item.id === listingId) || await db.prepare("SELECT l.id,l.creator_id,l.slug,l.source_product_slug,l.public_product_slug,l.title,l.lifecycle_state,l.publication_state,l.inactivity_state,l.media_type,l.updated_at,c.display_name creator_name,c.slug creator_slug FROM creator_listings l JOIN marketplace_creators c ON c.id=l.creator_id WHERE l.id=?").bind(listingId).first();
    if (!selected) return json({ error: "Listing not found." }, 404);
    files = await rows(db.prepare("SELECT id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,validation_state,validation_message,delivery_object_key,uploaded_at,validated_at FROM creator_listing_files WHERE listing_id=? ORDER BY purpose,uploaded_at DESC").bind(selected.id));
    for (const file of files) {
      const key = file.validation_state === "accepted" && file.delivery_object_key
        ? file.delivery_object_key
        : file.quarantine_key;
      let head = null;
      try { head = key && bucket?.head ? await bucket.head(key) : null; } catch {}
      file.storageState = head ? "present" : "missing";
      file.secureDeliveryState = file.validation_state === "accepted" && file.delivery_object_key ? (head ? "ready" : "missing") : "not_current";
      file.storedSizeBytes = head ? Number(head.size ?? head.objectSize ?? file.size_bytes) : null;
      file.storageUploadedAt = head?.uploaded ? new Date(head.uploaded).toISOString() : null;
      file.downloadUrl = `/owner/api/listing-files?download=${encodeURIComponent(file.id)}`;
      delete file.quarantine_key;
    }
    return json({ listing: selected, listings, files });
  }
  return json({ listing: null, listings, files: [] });
}

async function downloadFile(request, db, bucket, fileId) {
  const file = await db.prepare("SELECT f.*,l.title listing_title,c.display_name creator_name FROM creator_listing_files f JOIN creator_listings l ON l.id=f.listing_id AND l.creator_id=f.creator_id JOIN marketplace_creators c ON c.id=f.creator_id WHERE f.id=?").bind(String(fileId)).first();
  if (!file) return json({ error: "Listing file not found." }, 404);
  const key = file.validation_state === "accepted" && file.delivery_object_key
    ? file.delivery_object_key
    : file.quarantine_key;
  if (!key || !bucket?.get) return json({ error: "Private listing storage is unavailable." }, 503);
  const object = await bucket.get(key);
  if (!object?.body) return json({ error: "Stored listing file is unavailable." }, 404);
  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.normalized_filename)}`,
    "content-type": file.content_type || "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  if (Number.isInteger(Number(object.size))) headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

async function replaceFile(request, db, bucket, actorId, nowMs) {
  if (!bucket?.put || !bucket?.get || !bucket?.head) return json({ error: "Private listing storage is unavailable." }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Replacement upload form is invalid." }, 400); }
  const listingId = String(form.get("listingId") || ""), fileId = String(form.get("fileId") || "");
  const existing = await db.prepare("SELECT f.*,l.slug,l.source_product_slug,l.public_product_slug,l.title listing_title,l.lifecycle_state,l.publication_state,c.display_name creator_name FROM creator_listing_files f JOIN creator_listings l ON l.id=f.listing_id AND l.creator_id=f.creator_id JOIN marketplace_creators c ON c.id=f.creator_id WHERE f.id=? AND f.listing_id=?").bind(fileId, listingId).first();
  if (!existing) return json({ error: "The listing and file relationship is invalid." }, 409);
  if (existing.validation_state !== "accepted") return json({ error: "Only a current accepted listing file can be replaced." }, 409);
  const file = form.get("file");
  let prepared;
  try { prepared = await prepareCreatorListingFile(file, existing.purpose); }
  catch (error) { return json({ error: error.message, code: error.code }, error.status || 400); }
  const slug = safeSlug(existing.public_product_slug || existing.slug || existing.source_product_slug),
    targetKey = deliveryKey(slug, existing.purpose);
  if (["product", "cover", "preview"].includes(existing.purpose) && (!slug || !targetKey || existing.delivery_object_key !== targetKey))
    return json({ error: "This file has not entered canonical delivery; use the normal review/publication workflow." }, 409);
  const id = crypto.randomUUID(), now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(),
    quarantineKey = `creator-quarantine/${existing.creator_id}/${existing.listing_id}/${id}/${prepared.normalizedFilename}`;
  try {
    await bucket.put(quarantineKey, prepared.bytes, { httpMetadata: { contentType: prepared.contentType }, customMetadata: { listingId: existing.listing_id, purpose: existing.purpose, scanState: "owner-validated", replacedFileId: existing.id } });
    const staged = await bucket.head(quarantineKey);
    if (!staged || Number(staged.size ?? staged.objectSize) !== prepared.bytes.byteLength) throw new Error("Replacement staging verification failed.");
    if (targetKey) {
      await bucket.put(targetKey, prepared.bytes, { httpMetadata: { contentType: prepared.contentType }, customMetadata: { listingId: existing.listing_id, publishedFrom: id, ownerMaintenance: "replacement" } });
      const delivered = await bucket.head(targetKey);
      if (!delivered || Number(delivered.size ?? delivered.objectSize) !== prepared.bytes.byteLength) throw new Error("Replacement delivery verification failed.");
    }
  } catch (error) { return json({ error: error.message || "Replacement storage failed." }, 502); }
  await db.batch([
    db.prepare("UPDATE creator_listing_files SET validation_state='superseded',validated_at=? WHERE listing_id=? AND creator_id=? AND purpose=? AND validation_state IN ('uploaded','validating','accepted')").bind(now, existing.listing_id, existing.creator_id, existing.purpose),
    db.prepare("INSERT INTO creator_listing_files(id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,validation_state,validation_message,delivery_object_key,uploaded_at,validated_at) VALUES(?,?,?,?,?,?,?,?,?,'accepted','Owner maintenance replacement',?,?,?)").bind(id, existing.listing_id, existing.creator_id, existing.purpose, String(file.name).slice(0,255), prepared.normalizedFilename, prepared.contentType, prepared.bytes.byteLength, quarantineKey, targetKey, now, now),
    db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'operator',?,'owner_file_replaced',?,?)").bind(existing.listing_id, existing.creator_id, actorId, JSON.stringify({ beforeFileId: existing.id, afterFileId: id, purpose: existing.purpose, filename: prepared.normalizedFilename, contentType: prepared.contentType, sizeBytes: prepared.bytes.byteLength, deliveryObjectKey: targetKey }), now),
  ]);
  return json({ ok: true, file: { id, listingId: existing.listing_id, creatorId: existing.creator_id, purpose: existing.purpose, filename: prepared.normalizedFilename, contentType: prepared.contentType, sizeBytes: prepared.bytes.byteLength, state: "accepted", secureDeliveryState: targetKey ? "ready" : "not_promoted" } }, 201);
}

async function verifyOwnerRead(request, env, options) {
  const access = getOwnerAccessConfig(env);
  if (access.enabled) {
    const result = await verifyOwnerAccessRequest(request, env);
    return result.valid ? { valid: true, actorId: result.email || result.csrfSubject } : { valid: false, status: result.reason === "config_incomplete" ? 503 : 403, message: result.userMessage };
  }
  const secrets = getOwnerSecrets(env), result = await verifySessionToken(readCookie(request, SESSION_COOKIE_NAME), secrets.sessionSecret, options.nowMs || Date.now());
  return result.valid ? { valid: true, actorId: result.username } : { valid: false, status: 403, message: "Operator access required." };
}
function deliveryKey(slug, purpose) { return ({ product: `${slug}/product.pdf`, cover: `${slug}/cover.webp`, preview: `${slug}/preview.webp` })[purpose] || null; }
function safeSlug(value) { const slug=String(value||"").trim().toLowerCase(); return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : ""; }
async function rows(statement) { const result=await statement.all(); return result.results||[]; }
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{"cache-control":"private, no-store","content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff"}});}
