-- Reservations prevent competing use but do not override financial events
-- that arrive before payout completion.
CREATE TRIGGER protect_creator_payout_completion
BEFORE INSERT ON creator_payouts WHEN NEW.status='paid'
BEGIN
  SELECT RAISE(ABORT,'active payout reservation required') WHERE NOT EXISTS (
    SELECT 1 FROM creator_payout_reservations r
    JOIN creator_payout_requests q ON q.id=r.payout_request_id
    WHERE r.creator_id=NEW.creator_id AND r.amount_cents=NEW.amount_cents
      AND r.status='reserved' AND q.status IN ('pending','processing')
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

CREATE TRIGGER preserve_completed_payout_request
BEFORE UPDATE OF status ON creator_payout_requests
WHEN OLD.status='paid' AND NEW.status<>'paid'
BEGIN
  SELECT RAISE(ABORT,'completed payout request status is immutable');
END;
