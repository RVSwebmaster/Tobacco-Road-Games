import { officeError } from "./office-validation.mjs";

export async function listProjects(db, includeDeleted = false) {
  return rows(await db.prepare(`
    SELECT id, name, created_by, created_at, updated_at, deleted_at
    FROM office_projects
    WHERE (? = 1 OR deleted_at IS NULL)
    ORDER BY deleted_at IS NOT NULL, name COLLATE NOCASE
  `).bind(includeDeleted ? 1 : 0).all());
}

export async function createProject(db, input, actor, now = new Date().toISOString()) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO office_projects (id, name, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, input.name, actor, now, now).run();
  return getProject(db, id, true);
}

export async function getProject(db, id, includeDeleted = false) {
  return db.prepare(`
    SELECT * FROM office_projects WHERE id = ? AND (? = 1 OR deleted_at IS NULL)
  `).bind(id, includeDeleted ? 1 : 0).first();
}

export async function createFolder(db, input, actor, now = new Date().toISOString()) {
  await requireActiveProject(db, input.projectId);
  if (input.parentId) {
    const parent = await db.prepare(`
      SELECT id FROM office_folders
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
    `).bind(input.parentId, input.projectId).first();
    if (!parent) throw officeError(404, "parent_not_found", "The parent folder was not found.");
  }
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO office_folders
      (id, project_id, parent_id, name, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, input.projectId, input.parentId, input.name, actor, now, now).run();
  return db.prepare("SELECT * FROM office_folders WHERE id = ?").bind(id).first();
}

export async function browse(db, projectId, folderId = null) {
  await requireActiveProject(db, projectId);
  let folder = null;
  if (folderId) {
    folder = await db.prepare(`
      SELECT * FROM office_folders
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
    `).bind(folderId, projectId).first();
    if (!folder) throw officeError(404, "folder_not_found", "The folder was not found.");
  }
  const [folders, files] = await Promise.all([
    db.prepare(`
      SELECT id, project_id, parent_id, name, created_at, updated_at
      FROM office_folders
      WHERE project_id = ? AND ifnull(parent_id, '') = ifnull(?, '') AND deleted_at IS NULL
      ORDER BY name COLLATE NOCASE
    `).bind(projectId, folderId).all(),
    db.prepare(`
      SELECT f.id, f.project_id, f.folder_id, f.name, f.created_at, f.updated_at,
             v.id AS version_id, v.version_number, v.byte_size, v.content_type,
             v.sha256_hex, v.created_at AS version_created_at
      FROM office_files f
      LEFT JOIN office_file_versions v ON v.id = f.current_version_id
      WHERE f.project_id = ? AND ifnull(f.folder_id, '') = ifnull(?, '')
        AND f.deleted_at IS NULL AND f.current_version_id IS NOT NULL
      ORDER BY f.name COLLATE NOCASE
    `).bind(projectId, folderId).all()
  ]);
  return { files: rows(files), folder, folders: rows(folders) };
}

export async function reserveUploadBatch(db, input, actor, options = {}) {
  await requireActiveProject(db, input.projectId);
  if (input.folderId) await requireActiveFolder(db, input.folderId, input.projectId);
  const now = options.now || new Date().toISOString();
  const expiresAt = options.expiresAt;
  const batchId = crypto.randomUUID();
  const statements = [
    db.prepare(`
      INSERT INTO office_upload_batches
        (id, project_id, folder_id, status, created_by, created_at, expires_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).bind(batchId, input.projectId, input.folderId, actor, now, expiresAt)
  ];
  const reserved = [];
  for (const item of input.files) {
    let fileId = item.fileId || crypto.randomUUID();
    let versionNumber = 1;
    if (item.fileId) {
      const file = await db.prepare(`
        SELECT id, project_id, folder_id, name FROM office_files
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL
      `).bind(item.fileId, input.projectId).first();
      if (!file) throw officeError(404, "file_not_found", "The file for the new version was not found.");
      const result = await db.prepare(`
        SELECT coalesce(max(version_number), 0) + 1 AS next_version
        FROM office_file_versions WHERE file_id = ?
      `).bind(fileId).first();
      versionNumber = Number(result.next_version);
      item.name = file.name;
    } else {
      statements.push(db.prepare(`
        INSERT INTO office_files
          (id, project_id, folder_id, name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(fileId, input.projectId, input.folderId, item.name, actor, now, now));
    }
    const uploadItemId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const pendingKey = `pending/${batchId}/${uploadItemId}`;
    const finalKey = `versions/${input.projectId}/${fileId}/${versionId}`;
    statements.push(db.prepare(`
      INSERT INTO office_upload_items (
        id, batch_id, file_id, version_id, version_number, pending_r2_key, final_r2_key,
        original_name, expected_size, expected_content_type, expected_sha256_hex,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
    `).bind(
      uploadItemId, batchId, fileId, versionId, versionNumber, pendingKey, finalKey,
      item.name, item.size, item.contentType, item.sha256, now
    ));
    reserved.push({
      contentType: item.contentType,
      fileId,
      id: uploadItemId,
      name: item.name,
      pendingKey,
      sha256: item.sha256,
      size: item.size,
      versionId,
      versionNumber
    });
  }
  await db.batch(statements);
  return { batchId, expiresAt, items: reserved };
}

export async function getUploadBatch(db, batchId, actor) {
  const batch = await db.prepare(`
    SELECT * FROM office_upload_batches WHERE id = ? AND created_by = ?
  `).bind(batchId, actor).first();
  if (!batch) throw officeError(404, "upload_not_found", "The upload reservation was not found.");
  const items = rows(await db.prepare(`
    SELECT * FROM office_upload_items WHERE batch_id = ? ORDER BY created_at, id
  `).bind(batchId).all());
  return { batch, items };
}

export async function publishUploadItem(db, item, actor, storage, now = new Date().toISOString()) {
  const statements = [
    db.prepare(`
      INSERT INTO office_file_versions (
        id, file_id, version_number, r2_object_key, byte_size, content_type,
        sha256_hex, r2_etag, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.version_id, item.file_id, item.version_number, item.final_r2_key,
      item.expected_size, item.expected_content_type, item.expected_sha256_hex,
      storage.etag || null, actor, now
    ),
    db.prepare(`
      UPDATE office_files
      SET current_version_id = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).bind(item.version_id, now, item.file_id),
    db.prepare(`
      UPDATE office_upload_items
      SET status = 'published', verified_at = ?, published_at = ?, failure_code = NULL
      WHERE id = ? AND status = 'reserved'
    `).bind(now, now, item.id)
  ];
  await db.batch(statements);
}

export async function failUploadItem(db, itemId, failureCode, now = new Date().toISOString()) {
  await db.prepare(`
    UPDATE office_upload_items
    SET status = 'verification_failed', failure_code = ?, verified_at = ?
    WHERE id = ? AND status = 'reserved'
  `).bind(failureCode, now, itemId).run();
}

export async function finishUploadBatch(db, batchId, now = new Date().toISOString()) {
  const counts = await db.prepare(`
    SELECT
      sum(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      sum(CASE WHEN status = 'verification_failed' THEN 1 ELSE 0 END) AS failed,
      count(*) AS total
    FROM office_upload_items WHERE batch_id = ?
  `).bind(batchId).first();
  const status = Number(counts.published) === Number(counts.total)
    ? "complete"
    : Number(counts.failed) > 0 ? "partial" : "pending";
  await db.prepare(`
    UPDATE office_upload_batches SET status = ?, completed_at = ?
    WHERE id = ?
  `).bind(status, status === "pending" ? null : now, batchId).run();
  return { failed: Number(counts.failed || 0), published: Number(counts.published || 0), status };
}

export async function fileDetails(db, fileId) {
  const file = await db.prepare("SELECT * FROM office_files WHERE id = ?").bind(fileId).first();
  if (!file) throw officeError(404, "file_not_found", "The file was not found.");
  const versions = rows(await db.prepare(`
    SELECT id, version_number, byte_size, content_type, sha256_hex, r2_etag,
           created_by, created_at, id = ? AS is_current
    FROM office_file_versions
    WHERE file_id = ? ORDER BY version_number DESC
  `).bind(file.current_version_id, fileId).all());
  return { file, versions };
}

export async function getVersion(db, fileId, versionId) {
  return db.prepare(`
    SELECT v.*, f.name, f.project_id, f.deleted_at AS file_deleted_at
    FROM office_file_versions v JOIN office_files f ON f.id = v.file_id
    WHERE v.id = ? AND v.file_id = ?
  `).bind(versionId, fileId).first();
}

export async function restoreVersion(db, fileId, versionId, now = new Date().toISOString()) {
  const version = await getVersion(db, fileId, versionId);
  if (!version || version.file_deleted_at) throw officeError(404, "version_not_found", "The version was not found.");
  await db.prepare(`
    UPDATE office_files SET current_version_id = ?, updated_at = ? WHERE id = ?
  `).bind(versionId, now, fileId).run();
  return fileDetails(db, fileId);
}

export async function softDelete(db, type, id, actor, now = new Date().toISOString()) {
  const table = tableFor(type);
  const result = await db.prepare(`
    UPDATE ${table} SET deleted_at = ?, deleted_by = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).bind(now, actor, now, id).run();
  if (!Number(result.meta?.changes || 0)) throw officeError(404, "item_not_found", "The item was not found.");
}

export async function listTrash(db) {
  const [projects, folders, files] = await Promise.all([
    db.prepare("SELECT id, name, deleted_at, deleted_by FROM office_projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all(),
    db.prepare("SELECT id, project_id, parent_id, name, deleted_at, deleted_by FROM office_folders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all(),
    db.prepare("SELECT id, project_id, folder_id, name, deleted_at, deleted_by FROM office_files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all()
  ]);
  return { files: rows(files), folders: rows(folders), projects: rows(projects) };
}

export async function recoverTrash(db, type, id, now = new Date().toISOString()) {
  const table = tableFor(type);
  const item = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).bind(id).first();
  if (!item) throw officeError(404, "trash_item_not_found", "The deleted item was not found.");
  if (type !== "project") await requireActiveProject(db, item.project_id);
  if (type === "folder" && item.parent_id) await requireActiveFolder(db, item.parent_id, item.project_id);
  if (type === "file" && item.folder_id) await requireActiveFolder(db, item.folder_id, item.project_id);
  await db.prepare(`
    UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?
  `).bind(now, id).run();
}

export async function audit(db, entry, now = new Date().toISOString()) {
  await db.prepare(`
    INSERT INTO office_audit_records (
      actor, action, target_type, target_id, project_id, outcome,
      request_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.actor, entry.action, entry.targetType || null, entry.targetId || null,
    entry.projectId || null, entry.outcome, entry.requestId,
    JSON.stringify(entry.details || {}), now
  ).run();
}

async function requireActiveProject(db, id) {
  const project = await getProject(db, id);
  if (!project) throw officeError(404, "project_not_found", "The project was not found.");
  return project;
}

async function requireActiveFolder(db, id, projectId) {
  const folder = await db.prepare(`
    SELECT * FROM office_folders WHERE id = ? AND project_id = ? AND deleted_at IS NULL
  `).bind(id, projectId).first();
  if (!folder) throw officeError(404, "folder_not_found", "The folder was not found.");
  return folder;
}

function tableFor(type) {
  if (type === "project") return "office_projects";
  if (type === "folder") return "office_folders";
  if (type === "file") return "office_files";
  throw officeError(400, "invalid_item_type", "Item type must be project, folder, or file.");
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

