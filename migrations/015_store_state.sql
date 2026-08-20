CREATE TABLE IF NOT EXISTS runtime_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO runtime_settings (setting_key, setting_value, updated_at, updated_by)
VALUES ('store_state', 'CLOSED', datetime('now'), 'migration');
