CREATE TABLE marketplace_discovery_labels (
  subject_type TEXT NOT NULL CHECK(subject_type IN ('product','creator')),
  subject_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(label IN ('new_release','top_rated','customer_favorite','best_selling','most_downloaded','new_and_rising')),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','inactive','removed')),
  display_reason TEXT NOT NULL,
  metric_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metric_snapshot_json)),
  source_window_start TEXT,
  source_window_end TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  PRIMARY KEY(subject_type,subject_id,label)
);
CREATE INDEX idx_discovery_labels_public ON marketplace_discovery_labels(subject_type,state,label,expires_at);

CREATE TABLE marketplace_discovery_label_suppressions (
  subject_type TEXT NOT NULL CHECK(subject_type IN ('product','creator')),
  subject_id TEXT NOT NULL,
  label TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN ('calculation_error','fraud_manipulation','test_contamination','policy_violation')),
  reason_notes TEXT NOT NULL DEFAULT '',
  suppressed_by TEXT NOT NULL,
  suppressed_at TEXT NOT NULL,
  cleared_by TEXT,
  cleared_at TEXT,
  PRIMARY KEY(subject_type,subject_id,label)
);

CREATE TABLE marketplace_discovery_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  calculation_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE marketplace_discovery_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('recalculate','remove','restore')),
  subject_type TEXT,
  subject_id TEXT,
  label TEXT,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  created_at TEXT NOT NULL
);
