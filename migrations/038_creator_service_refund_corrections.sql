CREATE TABLE creator_service_refund_corrections (
  id TEXT PRIMARY KEY,
  service_purchase_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  reason_category TEXT NOT NULL CHECK(reason_category IN ('duplicate_charge','incorrect_amount','service_not_delivered','trg_system_failure','other_trg_caused_error')),
  reason_detail TEXT NOT NULL,
  refund_amount_cents INTEGER NOT NULL CHECK(refund_amount_cents>=0),
  payment_source TEXT NOT NULL CHECK(payment_source IN ('stripe','creator_balance')),
  entitlement_action TEXT NOT NULL DEFAULT 'none' CHECK(entitlement_action IN ('none','reverse_coverage','reverse_ad_credits','restore_ad_credits','extend_ad_slot')),
  entitlement_adjustment_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(entitlement_adjustment_json)),
  status TEXT NOT NULL CHECK(status IN ('processing','provider_pending','completed','failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  balance_transaction_id TEXT UNIQUE,
  stripe_refund_id TEXT UNIQUE,
  provider_status TEXT,
  provider_failure_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(balance_transaction_id) REFERENCES creator_balance_transactions(id) ON DELETE RESTRICT
);
CREATE INDEX idx_service_refunds_purchase ON creator_service_refund_corrections(service_purchase_id,created_at);

CREATE TRIGGER protect_service_refund_amount
BEFORE INSERT ON creator_service_refund_corrections
BEGIN
  SELECT RAISE(ABORT,'service correction exceeds original purchase')
  WHERE NEW.refund_amount_cents + COALESCE((
    SELECT SUM(refund_amount_cents) FROM creator_service_refund_corrections
    WHERE service_purchase_id=NEW.service_purchase_id AND status IN ('processing','provider_pending','completed')
  ),0) > COALESCE((SELECT amount_cents FROM marketplace_service_purchases WHERE id=NEW.service_purchase_id),-1);
END;

CREATE TRIGGER protect_ad_credit_correction_balance
BEFORE INSERT ON creator_ad_credit_ledger
WHEN NEW.entry_type='operator_adjustment' AND NEW.quantity<0
BEGIN
  SELECT RAISE(ABORT,'insufficient unused Ad Credits for correction')
  WHERE COALESCE((SELECT SUM(quantity) FROM creator_ad_credit_ledger WHERE creator_id=NEW.creator_id),0) + NEW.quantity < 0;
END;

CREATE TABLE creator_service_refund_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correction_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(correction_id) REFERENCES creator_service_refund_corrections(id) ON DELETE RESTRICT
);
