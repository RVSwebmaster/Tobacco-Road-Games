ALTER TABLE creator_payout_profiles ADD COLUMN account_exists INTEGER NOT NULL DEFAULT 0 CHECK(account_exists IN (0,1));
ALTER TABLE creator_payout_profiles ADD COLUMN details_submitted INTEGER NOT NULL DEFAULT 0 CHECK(details_submitted IN (0,1));
ALTER TABLE creator_payout_profiles ADD COLUMN charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK(charges_enabled IN (0,1));
ALTER TABLE creator_payout_profiles ADD COLUMN transfers_capability TEXT NOT NULL DEFAULT 'inactive' CHECK(transfers_capability IN ('inactive','pending','active','restricted'));
ALTER TABLE creator_payout_profiles ADD COLUMN requirements_due_count INTEGER NOT NULL DEFAULT 0 CHECK(requirements_due_count >= 0);
ALTER TABLE creator_payout_profiles ADD COLUMN provider_disabled_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE creator_payout_batches (
  id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','ready_for_review','approved','cancelled','execution_pending','executed','partially_failed','failed','reconciled')),
  currency TEXT NOT NULL, prepared_by TEXT NOT NULL, approved_by TEXT, prepared_at TEXT NOT NULL, approved_at TEXT,
  execution_started_at TEXT, executed_at TEXT, cancelled_at TEXT, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE creator_payout_batch_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, creator_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL,
  provider TEXT NOT NULL, provider_account_reference TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('proposed','ineligible','execution_pending','executed','failed','cancelled')),
  eligibility_snapshot_json TEXT NOT NULL CHECK(json_valid(eligibility_snapshot_json)), provider_execution_reference TEXT, failure_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES creator_payout_batches(id) ON DELETE RESTRICT, FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  UNIQUE(batch_id,creator_id)
);
CREATE INDEX idx_payout_batch_items_batch_status ON creator_payout_batch_items(batch_id,status);
