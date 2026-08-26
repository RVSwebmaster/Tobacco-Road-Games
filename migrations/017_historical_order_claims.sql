CREATE TABLE historical_order_claim_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'rejected')),
  verification_method TEXT NOT NULL CHECK (verification_method = 'verified_email_and_order_access'),
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_historical_order_claim_audit_order
  ON historical_order_claim_audit (order_id, created_at);

CREATE INDEX idx_historical_order_claim_audit_user
  ON historical_order_claim_audit (user_id, created_at);

CREATE UNIQUE INDEX idx_historical_order_claim_one_success
  ON historical_order_claim_audit (order_id)
  WHERE outcome = 'succeeded';
