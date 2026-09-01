-- Prevent payout and Creator Balance reservations from racing each other or
-- consuming funds held by an active payment dispute.
DROP TRIGGER IF EXISTS protect_creator_balance_reservation;

CREATE TRIGGER protect_creator_balance_reservation
BEFORE INSERT ON creator_balance_reservations WHEN NEW.state='reserved'
BEGIN
  SELECT RAISE(ABORT,'insufficient available Creator Balance') WHERE (
    COALESCE((SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND payout_state<>'held' AND available_at<=NEW.created_at),0)
    + COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_payout_reservations WHERE creator_id=NEW.creator_id AND status='reserved'),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND state='reserved'),0)
    - COALESCE((SELECT SUM(allocated_gross_cents) FROM creator_dispute_allocations WHERE creator_id=NEW.creator_id AND status='held'),0)
  ) < NEW.amount_cents;
END;

CREATE TRIGGER protect_creator_payout_reservation
BEFORE INSERT ON creator_payout_reservations WHEN NEW.status='reserved'
BEGIN
  SELECT RAISE(ABORT,'insufficient available Creator Balance') WHERE (
    COALESCE((SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=(SELECT currency FROM creator_payout_requests WHERE id=NEW.payout_request_id) AND payout_state<>'held' AND available_at<=NEW.created_at),0)
    + COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=(SELECT currency FROM creator_payout_requests WHERE id=NEW.payout_request_id)),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_payout_reservations WHERE creator_id=NEW.creator_id AND status='reserved'),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=(SELECT currency FROM creator_payout_requests WHERE id=NEW.payout_request_id) AND state='reserved'),0)
    - COALESCE((SELECT SUM(allocated_gross_cents) FROM creator_dispute_allocations WHERE creator_id=NEW.creator_id AND status='held'),0)
  ) < NEW.amount_cents;
END;
