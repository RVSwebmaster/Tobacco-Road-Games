ALTER TABLE product_remediation_cases ADD COLUMN required_correction TEXT NOT NULL DEFAULT '';
ALTER TABLE product_remediation_cases ADD COLUMN correction_object_key TEXT;
ALTER TABLE product_remediation_cases ADD COLUMN correction_submitted_at TEXT;
ALTER TABLE product_remediation_cases ADD COLUMN compliance_result TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE product_remediation_cases ADD COLUMN compliance_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE product_remediation_cases ADD COLUMN compliance_reviewed_by TEXT;
ALTER TABLE product_remediation_cases ADD COLUMN compliance_reviewed_at TEXT;
ALTER TABLE product_remediation_cases ADD COLUMN expired_processed_at TEXT;
ALTER TABLE customer_refund_choices ADD COLUMN refund_required_at TEXT;

CREATE TABLE marketplace_provider_cost_allocations (
  id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL, event_kind TEXT NOT NULL CHECK(event_kind IN ('refund','dispute')),
  order_id INTEGER, creator_id TEXT, responsibility TEXT NOT NULL CHECK(responsibility IN ('creator','marketplace')),
  actual_provider_cost_cents INTEGER NOT NULL CHECK(actual_provider_cost_cents>=0), currency TEXT NOT NULL,
  creator_ledger_id INTEGER, classified_by TEXT NOT NULL, classification_reason TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(provider_event_id,event_kind),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_ledger_id) REFERENCES creator_earnings_ledger(id) ON DELETE RESTRICT
);

CREATE TABLE marketplace_risk_signals (
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('account','verified_email','guest_email','ip_network','session','device','provider')),
  subject_reference TEXT NOT NULL, signal_type TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('review','rate_limit','temporary_block')),
  expires_at TEXT, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE marketplace_operations_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL
);

CREATE TABLE creator_payout_reservations (
  payout_request_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  status TEXT NOT NULL CHECK(status IN ('reserved','released','consumed')), created_at TEXT NOT NULL, resolved_at TEXT,
  FOREIGN KEY(payout_request_id) REFERENCES creator_payout_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

CREATE TABLE marketplace_notice_outbox (
  id TEXT PRIMARY KEY, audience_type TEXT NOT NULL CHECK(audience_type IN ('creator','customer','operator')),
  creator_id TEXT, user_id TEXT, order_id INTEGER, remediation_case_id TEXT, payout_request_id TEXT,
  notice_type TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
  delivery_state TEXT NOT NULL DEFAULT 'queued' CHECK(delivery_state IN ('queued','delivered','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(remediation_case_id) REFERENCES product_remediation_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY(payout_request_id) REFERENCES creator_payout_requests(id) ON DELETE RESTRICT
);

CREATE TABLE marketplace_scheduler_runs (
  id TEXT PRIMARY KEY, job_name TEXT NOT NULL, run_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  started_at TEXT NOT NULL, completed_at TEXT, result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)), UNIQUE(job_name,run_key)
);
