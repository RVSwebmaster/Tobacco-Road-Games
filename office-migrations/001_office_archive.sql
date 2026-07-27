PRAGMA foreign_keys = ON;

CREATE TABLE office_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE UNIQUE INDEX idx_office_projects_active_name
  ON office_projects (name COLLATE NOCASE)
  WHERE deleted_at IS NULL;

CREATE TABLE office_folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES office_projects(id),
  parent_id TEXT REFERENCES office_folders(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX idx_office_folders_active_sibling
  ON office_folders (project_id, ifnull(parent_id, ''), name COLLATE NOCASE)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_office_folders_browse
  ON office_folders (project_id, parent_id, deleted_at, name);

CREATE TABLE office_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES office_projects(id),
  folder_id TEXT REFERENCES office_folders(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  current_version_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE UNIQUE INDEX idx_office_files_active_sibling
  ON office_files (project_id, ifnull(folder_id, ''), name COLLATE NOCASE)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_office_files_browse
  ON office_files (project_id, folder_id, deleted_at, name);

CREATE TABLE office_file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES office_files(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  r2_object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_type TEXT NOT NULL,
  sha256_hex TEXT NOT NULL CHECK (
    length(sha256_hex) = 64 AND sha256_hex NOT GLOB '*[^0-9a-f]*'
  ),
  r2_etag TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (file_id, version_number)
);

CREATE INDEX idx_office_versions_history
  ON office_file_versions (file_id, version_number DESC);

CREATE TABLE office_upload_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES office_projects(id),
  folder_id TEXT REFERENCES office_folders(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'partial', 'complete', 'expired')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_office_upload_batches_expiry
  ON office_upload_batches (status, expires_at);

CREATE TABLE office_upload_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES office_upload_batches(id),
  file_id TEXT NOT NULL REFERENCES office_files(id),
  version_id TEXT NOT NULL UNIQUE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  pending_r2_key TEXT NOT NULL UNIQUE,
  final_r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  expected_size INTEGER NOT NULL CHECK (expected_size >= 0),
  expected_content_type TEXT NOT NULL,
  expected_sha256_hex TEXT NOT NULL CHECK (
    length(expected_sha256_hex) = 64 AND expected_sha256_hex NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('reserved', 'verified', 'published', 'verification_failed')
  ),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  published_at TEXT
);

CREATE INDEX idx_office_upload_items_batch
  ON office_upload_items (batch_id, status);

CREATE TABLE office_project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES office_projects(id),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_office_project_events_timeline
  ON office_project_events (project_id, occurred_at DESC, id DESC);

CREATE TABLE office_audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  project_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'rejected', 'failed')),
  request_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_office_audit_project
  ON office_audit_records (project_id, created_at DESC, id DESC);
CREATE INDEX idx_office_audit_target
  ON office_audit_records (target_type, target_id, created_at DESC);

