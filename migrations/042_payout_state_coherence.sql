-- A paid request and a consumed reservation are completion facts. They may be
-- created only while migration 041's exact completed payout row is visible.
CREATE TRIGGER reject_direct_paid_payout_request_insert
BEFORE INSERT ON creator_payout_requests WHEN NEW.status='paid'
BEGIN
  SELECT RAISE(ABORT,'paid payout request requires canonical payout completion');
END;

CREATE TRIGGER protect_payout_request_paid_transition
BEFORE UPDATE OF status ON creator_payout_requests
WHEN OLD.status<>'paid' AND NEW.status='paid'
BEGIN
  SELECT RAISE(ABORT,'paid payout request requires exact completed payout') WHERE NOT EXISTS (
    SELECT 1 FROM creator_payouts p
    WHERE p.payout_request_id=NEW.id
      AND p.creator_id=NEW.creator_id
      AND p.amount_cents=NEW.amount_cents
      AND p.currency=NEW.currency
      AND p.status='paid'
  );
END;

CREATE TRIGGER preserve_paid_payout_request
BEFORE UPDATE ON creator_payout_requests WHEN OLD.status='paid'
BEGIN
  SELECT RAISE(ABORT,'paid payout request is immutable');
END;

CREATE TRIGGER preserve_paid_payout_request_delete
BEFORE DELETE ON creator_payout_requests WHEN OLD.status='paid'
BEGIN
  SELECT RAISE(ABORT,'paid payout request is immutable');
END;

CREATE TRIGGER reject_direct_consumed_payout_reservation_insert
BEFORE INSERT ON creator_payout_reservations WHEN NEW.status='consumed'
BEGIN
  SELECT RAISE(ABORT,'consumed payout reservation requires canonical payout completion');
END;

CREATE TRIGGER protect_payout_reservation_consumed_transition
BEFORE UPDATE OF status ON creator_payout_reservations
WHEN OLD.status<>'consumed' AND NEW.status='consumed'
BEGIN
  SELECT RAISE(ABORT,'consumed payout reservation requires exact completed payout') WHERE NOT EXISTS (
    SELECT 1
    FROM creator_payout_requests q
    JOIN creator_payouts p ON p.payout_request_id=q.id
    WHERE q.id=NEW.payout_request_id
      AND q.creator_id=NEW.creator_id
      AND q.amount_cents=NEW.amount_cents
      AND q.status='paid'
      AND p.creator_id=NEW.creator_id
      AND p.amount_cents=NEW.amount_cents
      AND p.currency=q.currency
      AND p.status='paid'
  );
END;

CREATE TRIGGER preserve_consumed_payout_reservation
BEFORE UPDATE ON creator_payout_reservations WHEN OLD.status='consumed'
BEGIN
  SELECT RAISE(ABORT,'consumed payout reservation is immutable');
END;

CREATE TRIGGER preserve_consumed_payout_reservation_delete
BEFORE DELETE ON creator_payout_reservations WHEN OLD.status='consumed'
BEGIN
  SELECT RAISE(ABORT,'consumed payout reservation is immutable');
END;
