ALTER TABLE creator_closure_audit ADD COLUMN payout_request_id TEXT REFERENCES creator_payout_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX idx_closure_audit_payout_action ON creator_closure_audit(payout_request_id,action) WHERE payout_request_id IS NOT NULL;

CREATE TRIGGER enforce_creator_closure_state_machine BEFORE UPDATE OF closure_state ON marketplace_creators
WHEN NOT (
  OLD.closure_state=NEW.closure_state OR
  (OLD.closure_state='active' AND NEW.closure_state='closing') OR
  (OLD.closure_state='closing' AND NEW.closure_state='closed')
)
BEGIN SELECT RAISE(ABORT,'invalid Creator closure state transition'); END;

CREATE TRIGGER require_resolved_creator_closure BEFORE UPDATE OF closure_state ON marketplace_creators
WHEN OLD.closure_state='closing' AND NEW.closure_state='closed' AND (
  COALESCE((SELECT signed_total_cents FROM creator_signed_financial_totals WHERE creator_id=NEW.id),0)<>0 OR
  EXISTS(SELECT 1 FROM creator_earnings_ledger WHERE creator_id=NEW.id AND currency='USD' AND available_at>NEW.closed_at AND amount_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_earnings_ledger WHERE creator_id=NEW.id AND currency='USD' AND payout_state='held' AND amount_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_dispute_allocations WHERE creator_id=NEW.id AND status='held' AND allocated_gross_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_payout_reservations WHERE creator_id=NEW.id AND status='reserved') OR
  EXISTS(SELECT 1 FROM creator_balance_reservations WHERE creator_id=NEW.id AND state='reserved') OR
  EXISTS(SELECT 1 FROM creator_payout_requests WHERE creator_id=NEW.id AND status IN ('pending','processing')) OR
  EXISTS(SELECT 1 FROM creator_listings WHERE creator_id=NEW.id AND lifecycle_state='active' AND publication_state='published') OR
  NOT EXISTS(SELECT 1 FROM creator_closure_requests WHERE creator_id=NEW.id AND state='closing')
)
BEGIN SELECT RAISE(ABORT,'Creator closure has unresolved financial or listing blockers'); END;

CREATE TRIGGER enforce_exact_closure_payout_amount BEFORE INSERT ON creator_payout_requests
WHEN NEW.request_kind='account_closure' AND NEW.amount_cents<>(
  COALESCE((SELECT SUM(CASE WHEN payout_state<>'held' AND available_at<=NEW.requested_at THEN amount_cents ELSE 0 END) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
  +COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
  -COALESCE((SELECT SUM(amount_cents) FROM creator_payout_reservations WHERE creator_id=NEW.creator_id AND status='reserved'),0)
  -COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND state='reserved'),0)
  -COALESCE((SELECT SUM(allocated_gross_cents) FROM creator_dispute_allocations WHERE creator_id=NEW.creator_id AND status='held'),0)
)
BEGIN SELECT RAISE(ABORT,'closure payout must equal exact eligible balance'); END;

CREATE TRIGGER audit_completed_closure_settlement AFTER INSERT ON creator_payouts
WHEN NEW.status='paid' AND EXISTS(SELECT 1 FROM creator_payout_requests q WHERE q.id=NEW.payout_request_id AND q.request_kind='account_closure')
BEGIN
  INSERT INTO creator_closure_audit(id,closure_request_id,creator_id,actor_user_id,action,context_json,created_at,payout_request_id)
  SELECT lower(hex(randomblob(16))),r.id,NEW.creator_id,NULL,'final_settlement_completed',json_object('amountCents',NEW.amount_cents,'payoutId',NEW.id),NEW.paid_at,NEW.payout_request_id FROM creator_closure_requests r WHERE r.creator_id=NEW.creator_id;
END;
