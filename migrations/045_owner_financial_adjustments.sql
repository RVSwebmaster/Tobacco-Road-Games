CREATE TABLE creator_fund_target_adjustments (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, ledger_entry_id INTEGER NOT NULL UNIQUE,
  previous_total_cents INTEGER NOT NULL, new_total_cents INTEGER NOT NULL, delta_cents INTEGER NOT NULL CHECK(new_total_cents-previous_total_cents=delta_cents),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000), actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(ledger_entry_id) REFERENCES creator_earnings_ledger(id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE trg_revenue_adjustments (
  id TEXT PRIMARY KEY, previous_total_cents INTEGER NOT NULL, new_total_cents INTEGER NOT NULL, delta_cents INTEGER NOT NULL CHECK(new_total_cents-previous_total_cents=delta_cents),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000), actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TRIGGER preserve_creator_fund_target_adjustment BEFORE UPDATE ON creator_fund_target_adjustments BEGIN SELECT RAISE(ABORT,'financial adjustment history is immutable'); END;
CREATE TRIGGER preserve_creator_fund_target_adjustment_delete BEFORE DELETE ON creator_fund_target_adjustments BEGIN SELECT RAISE(ABORT,'financial adjustment history is immutable'); END;
CREATE TRIGGER preserve_trg_revenue_adjustment BEFORE UPDATE ON trg_revenue_adjustments BEGIN SELECT RAISE(ABORT,'TRG revenue adjustment history is immutable'); END;
CREATE TRIGGER preserve_trg_revenue_adjustment_delete BEFORE DELETE ON trg_revenue_adjustments BEGIN SELECT RAISE(ABORT,'TRG revenue adjustment history is immutable'); END;
