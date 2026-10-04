-- Ordinary Creator payouts use exact $10 increments. Account-closure requests
-- remain structurally distinct, while application code fails them closed until
-- a durable Creator closure lifecycle exists.
CREATE TRIGGER enforce_ordinary_payout_request_amount
BEFORE INSERT ON creator_payout_requests
WHEN NEW.request_kind='normal' AND (NEW.amount_cents < 1000 OR NEW.amount_cents % 1000 <> 0)
BEGIN
  SELECT RAISE(ABORT,'ordinary payouts require exact $10 increments');
END;

CREATE TRIGGER enforce_ordinary_payout_reservation_amount
BEFORE INSERT ON creator_payout_reservations
WHEN EXISTS (
  SELECT 1 FROM creator_payout_requests q
  WHERE q.id=NEW.payout_request_id AND q.request_kind='normal'
    AND (NEW.amount_cents < 1000 OR NEW.amount_cents % 1000 <> 0)
)
BEGIN
  SELECT RAISE(ABORT,'ordinary payout reservations require exact $10 increments');
END;

CREATE TRIGGER enforce_ordinary_payout_completion_amount
BEFORE INSERT ON creator_payouts
WHEN NEW.status='paid' AND EXISTS (
  SELECT 1 FROM creator_payout_requests q
  WHERE q.id=NEW.payout_request_id AND q.request_kind='normal'
    AND (NEW.amount_cents < 1000 OR NEW.amount_cents % 1000 <> 0)
)
BEGIN
  SELECT RAISE(ABORT,'ordinary payout completion requires exact $10 increments');
END;
