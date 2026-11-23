CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window_started
  ON auth_rate_limits (window_started_at);
