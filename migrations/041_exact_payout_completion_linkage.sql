-- Bind every new paid payout to one exact request/reservation and create the
-- paired ledger/state/audit records atomically at the database boundary.
ALTER TABLE creator_payouts ADD COLUMN payout_request_id TEXT REFERENCES creator_payout_requests(id) ON DELETE RESTRICT;
ALTER TABLE creator_earnings_ledger ADD COLUMN payout_id TEXT REFERENCES creator_payouts(id) ON DELETE RESTRICT;
ALTER TABLE creator_earnings_ledger ADD COLUMN payout_request_id TEXT REFERENCES creator_payout_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_one_payout_per_request ON creator_payouts(payout_request_id) WHERE payout_request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_one_payout_ledger_per_payout ON creator_earnings_ledger(payout_id) WHERE payout_id IS NOT NULL;
CREATE UNIQUE INDEX idx_one_payout_ledger_per_request ON creator_earnings_ledger(payout_request_id) WHERE payout_request_id IS NOT NULL AND entry_type='payout';

DROP TRIGGER IF EXISTS protect_creator_payout_completion;

CREATE TRIGGER protect_creator_payout_completion
BEFORE INSERT ON creator_payouts WHEN NEW.status='paid'
BEGIN
  SELECT RAISE(ABORT,'exact active payout reservation required') WHERE NEW.payout_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM creator_payout_reservations r
    JOIN creator_payout_requests q ON q.id=r.payout_request_id
    WHERE r.payout_request_id=NEW.payout_request_id
      AND r.creator_id=NEW.creator_id AND r.amount_cents=NEW.amount_cents
      AND r.status='reserved' AND q.status IN ('pending','processing')
      AND q.creator_id=NEW.creator_id AND q.amount_cents=NEW.amount_cents
      AND q.currency=NEW.currency
  );

  SELECT RAISE(ABORT,'reserved payout blocked by current financial state') WHERE (
    COALESCE((SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND payout_state<>'held' AND available_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')),0)
    + COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND state='reserved'),0)
    - COALESCE((SELECT SUM(allocated_gross_cents) FROM creator_dispute_allocations WHERE creator_id=NEW.creator_id AND status='held'),0)
    - COALESCE((SELECT SUM(r.amount_cents) FROM creator_payout_reservations r JOIN creator_payout_requests q ON q.id=r.payout_request_id WHERE r.creator_id=NEW.creator_id AND r.status='reserved' AND q.currency=NEW.currency),0)
    + NEW.amount_cents
  ) < NEW.amount_cents;
END;

CREATE TRIGGER complete_creator_payout_accounting
AFTER INSERT ON creator_payouts WHEN NEW.status='paid'
BEGIN
  INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,operator_actor,idempotency_key,created_at,payout_id,payout_request_id)
  VALUES(NEW.creator_id,'payout',-NEW.amount_cents,NEW.currency,NEW.paid_at,'paid','Payout: '||NEW.reference,NEW.operator_actor,'payout:'||NEW.idempotency_key,NEW.created_at,NEW.id,NEW.payout_request_id);

  UPDATE creator_payout_requests SET status='paid',resolved_at=NEW.created_at
  WHERE id=NEW.payout_request_id AND status IN ('pending','processing');

  UPDATE creator_payout_reservations SET status='consumed',resolved_at=NEW.created_at
  WHERE payout_request_id=NEW.payout_request_id AND status='reserved';

  INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,amount_cents,currency,context_json,created_at)
  VALUES(NEW.creator_id,'operator',NEW.operator_actor,'payout_recorded',NEW.amount_cents,NEW.currency,json_object('payoutId',NEW.id,'requestId',NEW.payout_request_id,'reference',NEW.reference),NEW.created_at);
END;

CREATE TRIGGER reject_paid_payout_transition
BEFORE UPDATE OF status ON creator_payouts
WHEN OLD.status<>'paid' AND NEW.status='paid'
BEGIN
  SELECT RAISE(ABORT,'paid payouts must use canonical atomic insertion');
END;

CREATE TRIGGER preserve_completed_payout
BEFORE UPDATE ON creator_payouts WHEN OLD.status='paid'
BEGIN
  SELECT RAISE(ABORT,'completed payout is immutable');
END;

CREATE TRIGGER preserve_completed_payout_delete
BEFORE DELETE ON creator_payouts WHEN OLD.status='paid'
BEGIN
  SELECT RAISE(ABORT,'completed payout is immutable');
END;

CREATE TRIGGER reject_unpaired_payout_ledger
BEFORE INSERT ON creator_earnings_ledger WHEN NEW.entry_type='payout'
BEGIN
  SELECT RAISE(ABORT,'payout ledger requires exact completed payout') WHERE NEW.payout_id IS NULL OR NEW.payout_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM creator_payouts p
    WHERE p.id=NEW.payout_id AND p.payout_request_id=NEW.payout_request_id
      AND p.creator_id=NEW.creator_id AND p.amount_cents=-NEW.amount_cents
      AND p.currency=NEW.currency AND p.status='paid'
  );
END;

CREATE TRIGGER reject_payout_ledger_transition
BEFORE UPDATE ON creator_earnings_ledger
WHEN NEW.entry_type='payout' OR OLD.entry_type='payout'
BEGIN
  SELECT RAISE(ABORT,'payout ledger entry is immutable and must use canonical insertion');
END;

CREATE TRIGGER preserve_payout_ledger_delete
BEFORE DELETE ON creator_earnings_ledger WHEN OLD.entry_type='payout'
BEGIN
  SELECT RAISE(ABORT,'payout ledger entry is immutable');
END;

CREATE TRIGGER preserve_payout_financial_audit
BEFORE UPDATE ON creator_financial_audit WHEN OLD.action='payout_recorded'
BEGIN
  SELECT RAISE(ABORT,'payout financial audit is immutable');
END;

CREATE TRIGGER preserve_payout_financial_audit_delete
BEFORE DELETE ON creator_financial_audit WHEN OLD.action='payout_recorded'
BEGIN
  SELECT RAISE(ABORT,'payout financial audit is immutable');
END;
