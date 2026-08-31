CREATE TABLE guest_email_verifications (
  email_hash TEXT PRIMARY KEY, email_normalized TEXT NOT NULL, code_hash TEXT NOT NULL,
  verified_at TEXT, expires_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
  last_order_id INTEGER, created_at TEXT NOT NULL,
  FOREIGN KEY(last_order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE TABLE marketplace_fraud_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email_hash TEXT NOT NULL, user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')),
  reason TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json)),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, reversed_by TEXT, reversed_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_fraud_blocks_email ON marketplace_fraud_blocks(email_hash,status);
CREATE TABLE product_remediation_cases (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('repair_open','repaired_pending_review','resolved','expired')),
  defect_type TEXT NOT NULL CHECK(defect_type IN ('corrupt_file','wrong_file','material_misrepresentation','delivery_failure','other_objective_defect')),
  opened_at TEXT NOT NULL, repair_due_at TEXT NOT NULL, resolved_at TEXT, notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT
);
CREATE TABLE customer_refund_choices (
  id TEXT PRIMARY KEY, remediation_case_id TEXT NOT NULL, order_id INTEGER NOT NULL, user_id TEXT,
  customer_email_hash TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN ('refund','wait_for_repair')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','refunded','replacement_delivered')),
  created_at TEXT NOT NULL, resolved_at TEXT,
  UNIQUE(remediation_case_id,order_id), FOREIGN KEY(remediation_case_id) REFERENCES product_remediation_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE creator_payout_requests (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
  request_kind TEXT NOT NULL DEFAULT 'normal' CHECK(request_kind IN ('normal','account_closure')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','failed','cancelled')),
  requested_at TEXT NOT NULL, resolved_at TEXT, failure_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_one_pending_payout ON creator_payout_requests(creator_id) WHERE status IN ('pending','processing');
