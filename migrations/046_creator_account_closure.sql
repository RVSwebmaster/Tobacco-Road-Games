ALTER TABLE marketplace_creators ADD COLUMN closure_state TEXT NOT NULL DEFAULT 'active' CHECK(closure_state IN ('active','closing','closed'));
ALTER TABLE marketplace_creators ADD COLUMN closure_requested_at TEXT;
ALTER TABLE marketplace_creators ADD COLUMN closed_at TEXT;

CREATE TABLE creator_closure_requests (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL UNIQUE, requested_by_user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('closing','closed')), reason TEXT NOT NULL DEFAULT '',
  blockers_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(blockers_json)), final_payout_request_id TEXT,
  requested_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(final_payout_request_id) REFERENCES creator_payout_requests(id) ON DELETE RESTRICT
);
CREATE TABLE creator_closure_audit (
  id TEXT PRIMARY KEY, closure_request_id TEXT NOT NULL, creator_id TEXT NOT NULL, actor_user_id TEXT,
  action TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(closure_request_id) REFERENCES creator_closure_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_closure_state ON marketplace_creators(closure_state,closure_requested_at);
CREATE TRIGGER preserve_creator_closure_audit BEFORE UPDATE ON creator_closure_audit BEGIN SELECT RAISE(ABORT,'Creator closure audit is immutable'); END;
CREATE TRIGGER preserve_creator_closure_audit_delete BEFORE DELETE ON creator_closure_audit BEGIN SELECT RAISE(ABORT,'Creator closure audit is immutable'); END;
CREATE TRIGGER require_closing_creator_for_closure_payout BEFORE INSERT ON creator_payout_requests
WHEN NEW.request_kind='account_closure' AND NOT EXISTS(SELECT 1 FROM marketplace_creators c JOIN creator_closure_requests r ON r.creator_id=c.id WHERE c.id=NEW.creator_id AND c.closure_state='closing' AND r.state='closing')
BEGIN SELECT RAISE(ABORT,'account-closure payout requires durable closing state'); END;

