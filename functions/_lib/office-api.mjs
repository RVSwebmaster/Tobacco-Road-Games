import {
  audit,
  browse,
  createFolder,
  createProject,
  fileDetails,
  finishUploadBatch,
  getUploadBatch,
  getUploadItem,
  getVersion,
  listProjects,
  listTrash,
  publishUploadItem,
  recoverTrash,
  reserveUploadBatch,
  restoreVersion,
  softDelete,
  failUploadItem
} from "./office-d1.mjs";
import { authorizeOfficeRequest } from "./office-mutation-auth.mjs";
import { createOfficeStorage } from "./office-storage.mjs";
import {
  jsonResponse,
  normalizeContentType,
  officeError,
  officeLimits,
  optionalUuid,
  readJson,
  requireByteSize,
  requireName,
  requireSha256,
  requireUuid
} from "./office-validation.mjs";

export async function handleOfficeApiRequest(request, env, options = {}) {
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  if (!env.TRG_OFFICE) {
    return errorResponse(officeError(503, "office_database_unavailable", "Office database is unavailable."), requestId);
  }
  const auth = await authorizeOfficeRequest(request, env, options.auth || {});
  if (!auth.valid) {
    await safeAudit(env.TRG_OFFICE, {
      action: "request.authorize", actor: "unknown", details: { code: auth.code },
      outcome: "rejected", requestId
    });
    return errorResponse(officeError(auth.status, auth.code, auth.message), requestId);
  }

  try {
    return await route(request, env, auth.email, requestId, options);
  } catch (error) {
    const normalized = normalizeError(error);
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      await safeAudit(env.TRG_OFFICE, {
        action: `request.${request.method.toLowerCase()}`,
        actor: auth.email,
        details: { code: normalized.code, path: new URL(request.url).pathname },
        outcome: normalized.status < 500 ? "rejected" : "failed",
        requestId
      });
    }
    return errorResponse(normalized, requestId);
  }
}

async function route(request, env, actor, requestId, options) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/office\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const db = env.TRG_OFFICE;

  if (method === "GET" && path.length === 1 && path[0] === "projects") {
    return jsonResponse({ projects: await listProjects(db) });
  }
  if (method === "POST" && path.length === 1 && path[0] === "projects") {
    const body = await readJson(request);
    const project = await createProject(db, { name: requireName(body.name, "name", 160) }, actor);
    await record(db, actor, "project.create", "project", project.id, project.id, requestId);
    return jsonResponse({ project }, 201);
  }
  if (method === "DELETE" && path.length === 2 && path[0] === "projects") {
    const id = requireUuid(path[1], "projectId");
    await softDelete(db, "project", id, actor);
    await record(db, actor, "project.soft_delete", "project", id, id, requestId);
    return jsonResponse({ deleted: true });
  }
  if (method === "POST" && path.length === 1 && path[0] === "folders") {
    const body = await readJson(request);
    const input = {
      name: requireName(body.name),
      parentId: optionalUuid(body.parentId, "parentId"),
      projectId: requireUuid(body.projectId, "projectId")
    };
    const folder = await createFolder(db, input, actor);
    await record(db, actor, "folder.create", "folder", folder.id, input.projectId, requestId);
    return jsonResponse({ folder }, 201);
  }
  if (method === "DELETE" && path.length === 2 && path[0] === "folders") {
    const id = requireUuid(path[1], "folderId");
    await softDelete(db, "folder", id, actor);
    await record(db, actor, "folder.soft_delete", "folder", id, null, requestId);
    return jsonResponse({ deleted: true });
  }
  if (method === "GET" && path.length === 1 && path[0] === "browse") {
    const projectId = requireUuid(url.searchParams.get("projectId"), "projectId");
    const folderId = optionalUuid(url.searchParams.get("folderId"), "folderId");
    return jsonResponse(await browse(db, projectId, folderId));
  }
  if (method === "POST" && path.length === 1 && path[0] === "uploads") {
    return reserveUploads(request, env, actor, requestId);
  }
  if (method === "PUT" && path.length === 4 && path[0] === "uploads" && path[2] === "items") {
    return receiveUpload(
      request,
      env,
      requireUuid(path[1], "uploadId"),
      requireUuid(path[3], "uploadItemId"),
      actor,
      requestId
    );
  }
  if (method === "POST" && path.length === 3 && path[0] === "uploads" && path[2] === "complete") {
    return completeUpload(env, requireUuid(path[1], "uploadId"), actor, requestId);
  }
  if (method === "GET" && path.length === 2 && path[0] === "files") {
    return jsonResponse(await fileDetails(db, requireUuid(path[1], "fileId")));
  }
  if (method === "DELETE" && path.length === 2 && path[0] === "files") {
    const id = requireUuid(path[1], "fileId");
    await softDelete(db, "file", id, actor);
    await record(db, actor, "file.soft_delete", "file", id, null, requestId);
    return jsonResponse({ deleted: true });
  }
  if (method === "POST" && path.length === 3 && path[0] === "files" && path[2] === "versions") {
    const body = await readJson(request);
    body.files = [{ ...(body.file || body), fileId: requireUuid(path[1], "fileId") }];
    return reserveUploadsWithBody(body, env, actor, requestId);
  }
  if (method === "GET" && path.length === 5 && path[0] === "files" && path[2] === "versions" && path[4] === "download") {
    const fileId = requireUuid(path[1], "fileId");
    const versionId = requireUuid(path[3], "versionId");
    const version = await getVersion(db, fileId, versionId);
    if (!version || version.file_deleted_at) throw officeError(404, "version_not_found", "The version was not found.");
    await record(db, actor, "version.download", "version", versionId, version.project_id, requestId);
    return createOfficeStorage(env.TRG_OFFICE_ARCHIVE).fetchVersion(version, request);
  }
  if (method === "POST" && path.length === 3 && path[0] === "files" && path[2] === "restore") {
    const fileId = requireUuid(path[1], "fileId");
    const body = await readJson(request);
    const versionId = requireUuid(body.versionId, "versionId");
    const version = await getVersion(db, fileId, versionId);
    if (!version || version.file_deleted_at) throw officeError(404, "version_not_found", "The version was not found.");
    await createOfficeStorage(env.TRG_OFFICE_ARCHIVE).restoreVersion(version);
    const result = await restoreVersion(db, fileId, versionId);
    await record(db, actor, "version.restore", "version", versionId, result.file.project_id, requestId, { fileId });
    return jsonResponse(result);
  }
  if (method === "GET" && path.length === 1 && path[0] === "trash") {
    return jsonResponse(await listTrash(db));
  }
  if (method === "POST" && path.length === 4 && path[0] === "trash" && path[3] === "restore") {
    const type = singularType(path[1]);
    const id = requireUuid(path[2], "itemId");
    await recoverTrash(db, type, id);
    await record(db, actor, `${type}.recover`, type, id, null, requestId);
    return jsonResponse({ restored: true });
  }
  throw officeError(404, "route_not_found", "Office API route not found.");
}

async function reserveUploads(request, env, actor, requestId) {
  return reserveUploadsWithBody(await readJson(request), env, actor, requestId);
}

async function reserveUploadsWithBody(body, env, actor, requestId) {
  const limits = officeLimits(env);
  if (!Array.isArray(body.files) || !body.files.length) {
    throw officeError(400, "files_required", "At least one file is required.");
  }
  if (body.files.length > limits.batchFiles) {
    throw officeError(413, "batch_file_limit", `A batch may contain at most ${limits.batchFiles} files.`);
  }
  let total = 0;
  const files = body.files.map((file) => {
    const size = requireByteSize(file.size, limits.fileBytes);
    total += size;
    return {
      contentType: normalizeContentType(file.contentType),
      fileId: file.fileId ? requireUuid(file.fileId, "fileId") : null,
      name: requireName(file.name || "new-version"),
      sha256: requireSha256(file.sha256),
      size
    };
  });
  if (total > limits.batchBytes) throw officeError(413, "batch_size_limit", "The upload batch is too large.");
  const expiresAt = new Date(Date.now() + limits.uploadTtlSeconds * 1000).toISOString();
  const reservation = await reserveUploadBatch(env.TRG_OFFICE, {
    files,
    folderId: optionalUuid(body.folderId, "folderId"),
    projectId: requireUuid(body.projectId, "projectId")
  }, actor, { expiresAt });
  for (const item of reservation.items) {
    item.uploadUrl = `/office/api/uploads/${reservation.batchId}/items/${item.id}`;
    item.uploadHeaders = { "content-type": item.contentType };
    delete item.pendingKey;
  }
  await record(env.TRG_OFFICE, actor, "upload.reserve", "upload_batch", reservation.batchId, body.projectId, requestId, {
    fileCount: files.length,
    totalBytes: total
  });
  return jsonResponse(reservation, 201);
}

async function receiveUpload(request, env, batchId, itemId, actor, requestId) {
  const item = await getUploadItem(env.TRG_OFFICE, batchId, itemId, actor);
  const contentType = normalizeContentType(request.headers.get("content-type"));
  if (contentType !== item.expected_content_type) {
    throw officeError(415, "upload_content_type_mismatch", "The upload content type does not match its reservation.");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) !== Number(item.expected_size)) {
    throw officeError(422, "upload_size_rejected", "The upload size does not match its reservation.");
  }
  const stored = await createOfficeStorage(env.TRG_OFFICE_ARCHIVE).reserveUpload(item, request);
  await record(env.TRG_OFFICE, actor, "upload.receive", "upload_item", item.id, item.project_id, requestId, {
    byteSize: stored.size,
    sha256: stored.sha256
  });
  return jsonResponse({ received: true, uploadItemId: item.id });
}

async function completeUpload(env, batchId, actor, requestId) {
  const { batch, items } = await getUploadBatch(env.TRG_OFFICE, batchId, actor);
  if (new Date(batch.expires_at).getTime() < Date.now() && batch.status === "pending") {
    await env.TRG_OFFICE.prepare(`
      UPDATE office_upload_batches SET status = 'expired' WHERE id = ? AND status = 'pending'
    `).bind(batchId).run();
    throw officeError(410, "upload_expired", "The upload reservation has expired.");
  }
  const storage = createOfficeStorage(env.TRG_OFFICE_ARCHIVE);
  for (const item of items) {
    if (item.status !== "reserved") continue;
    const result = await storage.storeVersion(item);
    if (!result.verified) {
      await failUploadItem(env.TRG_OFFICE, item.id, result.failureCode);
      await audit(env.TRG_OFFICE, {
        action: "upload.verify",
        actor,
        details: { failureCode: result.failureCode },
        outcome: "failed",
        projectId: batch.project_id,
        requestId,
        targetId: item.id,
        targetType: "upload_item"
      });
      continue;
    }
    await publishUploadItem(env.TRG_OFFICE, item, actor, result);
  }
  const result = await finishUploadBatch(env.TRG_OFFICE, batchId);
  await record(env.TRG_OFFICE, actor, "upload.complete", "upload_batch", batchId, batch.project_id, requestId, result);
  return jsonResponse({ batchId, ...result });
}

async function record(db, actor, action, targetType, targetId, projectId, requestId, details = {}) {
  return audit(db, { action, actor, details, outcome: "succeeded", projectId, requestId, targetId, targetType });
}

async function safeAudit(db, entry) {
  try { await audit(db, entry); } catch { /* Authorization response must remain deterministic. */ }
}

function normalizeError(error) {
  if (error?.code === "SQLITE_CONSTRAINT" || /constraint failed|unique constraint/i.test(String(error?.message))) {
    return officeError(409, "name_conflict", "An active item with that name already exists here.");
  }
  if (Number.isInteger(error?.status) && error?.code) return error;
  return officeError(500, "office_internal_error", "The Office request could not be completed.");
}

function errorResponse(error, requestId) {
  return jsonResponse({ error: { code: error.code, message: error.message }, requestId }, error.status);
}

function singularType(value) {
  if (value === "projects") return "project";
  if (value === "folders") return "folder";
  if (value === "files") return "file";
  throw officeError(400, "invalid_item_type", "Invalid trash item type.");
}
