DROP TRIGGER require_resolved_creator_closure;

CREATE TRIGGER require_valid_creator_closed_at BEFORE UPDATE OF closure_state ON marketplace_creators
WHEN OLD.closure_state='closing' AND NEW.closure_state='closed' AND (
  NEW.closed_at IS NULL OR
  julianday(NEW.closed_at) IS NULL OR
  julianday(NEW.closed_at)>julianday('now')
)
BEGIN SELECT RAISE(ABORT,'Creator closed_at must be a valid non-future timestamp'); END;

CREATE TRIGGER require_resolved_creator_closure BEFORE UPDATE OF closure_state ON marketplace_creators
WHEN OLD.closure_state='closing' AND NEW.closure_state='closed' AND (
  COALESCE((SELECT signed_total_cents FROM creator_signed_financial_totals WHERE creator_id=NEW.id),0)<>0 OR
  EXISTS(SELECT 1 FROM creator_earnings_ledger WHERE creator_id=NEW.id AND currency='USD' AND available_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND amount_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_earnings_ledger WHERE creator_id=NEW.id AND currency='USD' AND payout_state='held' AND amount_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_dispute_allocations WHERE creator_id=NEW.id AND status='held' AND allocated_gross_cents<>0) OR
  EXISTS(SELECT 1 FROM creator_payout_reservations WHERE creator_id=NEW.id AND status='reserved') OR
  EXISTS(SELECT 1 FROM creator_balance_reservations WHERE creator_id=NEW.id AND state='reserved') OR
  EXISTS(SELECT 1 FROM creator_payout_requests WHERE creator_id=NEW.id AND status IN ('pending','processing')) OR
  EXISTS(SELECT 1 FROM creator_listings WHERE creator_id=NEW.id AND lifecycle_state='active' AND publication_state='published') OR
  NOT EXISTS(SELECT 1 FROM creator_closure_requests WHERE creator_id=NEW.id AND state='closing')
)
BEGIN SELECT RAISE(ABORT,'Creator closure has unresolved financial or listing blockers'); END;
