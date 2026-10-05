INSERT INTO runtime_settings (setting_key, setting_value, updated_at, updated_by)
VALUES ('store_state', 'OPEN', datetime('now'), 'migration_052_open_store_state')
ON CONFLICT(setting_key) DO UPDATE SET
  setting_value = 'OPEN',
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
