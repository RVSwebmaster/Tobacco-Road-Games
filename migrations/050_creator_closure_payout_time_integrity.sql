DROP TRIGGER enforce_exact_closure_payout_amount;

CREATE TRIGGER require_valid_closure_payout_requested_at
BEFORE INSERT ON creator_payout_requests
WHEN NEW.request_kind='account_closure' AND (
  NEW.requested_at IS NULL OR
  julianday(NEW.requested_at) IS NULL OR
  julianday(NEW.requested_at)>julianday('now')
)
BEGIN SELECT RAISE(ABORT,'Creator closure payout requested_at must be a valid non-future timestamp'); END;

CREATE TRIGGER enforce_exact_closure_payout_amount
BEFORE INSERT ON creator_payout_requests
WHEN NEW.request_kind='account_closure' AND NEW.amount_cents<>(
  COALESCE((SELECT SUM(CASE WHEN payout_state<>'held' AND available_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN amount_cents ELSE 0 END) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
  +COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
  -COALESCE((SELECT SUM(amount_cents) FROM creator_payout_reservations WHERE creator_id=NEW.creator_id AND status='reserved'),0)
  -COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND state='reserved'),0)
  -COALESCE((SELECT SUM(allocated_gross_cents) FROM creator_dispute_allocations WHERE creator_id=NEW.creator_id AND status='held'),0)
)
BEGIN SELECT RAISE(ABORT,'closure payout must equal exact eligible balance'); END;
