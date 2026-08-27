CREATE TABLE creator_account_audit_states (
  creator_id TEXT PRIMARY KEY,
  audit_anchor_at TEXT NOT NULL,
  next_audit_due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','in_progress','passed','cure_required','restricted')),
  current_audit_id TEXT,
  cure_deadline_at TEXT,
  last_completed_at TEXT,
  last_result TEXT CHECK(last_result IS NULL OR last_result IN ('passed','cure_required','restricted','cleared')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reason_codes_json)),
  restricted_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_audit_due ON creator_account_audit_states(state,next_audit_due_at,cure_deadline_at);

CREATE TABLE creator_account_audits (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  cycle_due_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT NOT NULL DEFAULT 'in_progress' CHECK(result IN ('in_progress','passed','cure_required','restricted','cleared')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reason_codes_json)),
  check_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(check_snapshot_json)),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('system','operator')),
  actor_id TEXT NOT NULL,
  cure_deadline_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(creator_id,cycle_due_at),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_audit_history ON creator_account_audits(creator_id,started_at DESC);

CREATE TABLE creator_account_risk_flags (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

CREATE TABLE creator_account_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  audit_id TEXT,
  notice_type TEXT NOT NULL CHECK(notice_type IN ('upcoming_audit','audit_passed','cure_required','cure_deadline_approaching','restriction_applied','cure_completed')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  delivery_state TEXT NOT NULL DEFAULT 'dashboard' CHECK(delivery_state IN ('dashboard','email_pending','email_sent','email_failed')),
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(audit_id) REFERENCES creator_account_audits(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_account_notices_owner ON creator_account_notices(owner_user_id,read_at,created_at DESC);

CREATE TABLE creator_account_audit_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id TEXT NOT NULL,
  audit_id TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('system','operator')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(audit_id) REFERENCES creator_account_audits(id) ON DELETE RESTRICT
);

INSERT INTO creator_account_audit_states(creator_id,audit_anchor_at,next_audit_due_at,state,updated_at)
SELECT c.id,COALESCE(c.registration_completed_at,c.created_at),datetime(COALESCE(c.registration_completed_at,c.created_at),'start of month','+6 months','+' || MIN(CAST(strftime('%d',COALESCE(c.registration_completed_at,c.created_at)) AS INTEGER)-1,CAST(strftime('%d',datetime(COALESCE(c.registration_completed_at,c.created_at),'start of month','+7 months','-1 day')) AS INTEGER)-1) || ' days'),'scheduled',CURRENT_TIMESTAMP
FROM marketplace_creators c;

CREATE TRIGGER initialize_creator_account_audit
AFTER INSERT ON marketplace_creators
BEGIN
  INSERT INTO creator_account_audit_states(creator_id,audit_anchor_at,next_audit_due_at,state,updated_at)
  VALUES(NEW.id,COALESCE(NEW.registration_completed_at,NEW.created_at),datetime(COALESCE(NEW.registration_completed_at,NEW.created_at),'start of month','+6 months','+' || MIN(CAST(strftime('%d',COALESCE(NEW.registration_completed_at,NEW.created_at)) AS INTEGER)-1,CAST(strftime('%d',datetime(COALESCE(NEW.registration_completed_at,NEW.created_at),'start of month','+7 months','-1 day')) AS INTEGER)-1) || ' days'),'scheduled',NEW.created_at);
END;
