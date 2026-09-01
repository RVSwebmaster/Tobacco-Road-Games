-- Partial reversals must be able to assign an event's entire cent to TRG while
-- preserving a zero-cent Creator delta. Rebuild the snapshot table with that
-- valid state and enforce cumulative allocation against the immutable sale.
CREATE TABLE creator_reversal_snapshots_v43 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  reversal_type TEXT NOT NULL CHECK(reversal_type IN ('refund_reversal','chargeback_reversal')),
  gross_reversed_cents INTEGER NOT NULL CHECK(gross_reversed_cents > 0),
  creator_net_reversed_cents INTEGER NOT NULL CHECK(creator_net_reversed_cents >= 0),
  currency TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider_event_id,order_item_id),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

INSERT INTO creator_reversal_snapshots_v43
SELECT * FROM creator_reversal_snapshots;

DROP TABLE creator_reversal_snapshots;
ALTER TABLE creator_reversal_snapshots_v43 RENAME TO creator_reversal_snapshots;

CREATE TRIGGER enforce_cumulative_creator_reversal
BEFORE INSERT ON creator_reversal_snapshots
BEGIN
  SELECT RAISE(ABORT,'reversal requires exact immutable sale allocation') WHERE NOT EXISTS (
    SELECT 1 FROM creator_sale_snapshots s
    WHERE s.order_id=NEW.order_id
      AND s.order_item_id=NEW.order_item_id
      AND s.creator_id=NEW.creator_id
      AND s.currency=NEW.currency
  );

  SELECT RAISE(ABORT,'gross reversal exceeds remaining sale allocation') WHERE (
    COALESCE((SELECT SUM(r.gross_reversed_cents) FROM creator_reversal_snapshots r WHERE r.order_item_id=NEW.order_item_id),0)
    + NEW.gross_reversed_cents
  ) > (SELECT s.gross_cents FROM creator_sale_snapshots s WHERE s.order_item_id=NEW.order_item_id);

  SELECT RAISE(ABORT,'Creator reversal does not match cumulative sale allocation') WHERE NEW.creator_net_reversed_cents <> (
    (
      (SELECT s.creator_net_cents FROM creator_sale_snapshots s WHERE s.order_item_id=NEW.order_item_id)
      * (
        COALESCE((SELECT SUM(r.gross_reversed_cents) FROM creator_reversal_snapshots r WHERE r.order_item_id=NEW.order_item_id),0)
        + NEW.gross_reversed_cents
      )
      + ((SELECT s.gross_cents FROM creator_sale_snapshots s WHERE s.order_item_id=NEW.order_item_id) / 2)
    ) / (SELECT s.gross_cents FROM creator_sale_snapshots s WHERE s.order_item_id=NEW.order_item_id)
    - COALESCE((SELECT SUM(r.creator_net_reversed_cents) FROM creator_reversal_snapshots r WHERE r.order_item_id=NEW.order_item_id),0)
  );

  SELECT RAISE(ABORT,'TRG reversal exceeds remaining sale allocation') WHERE (
    NEW.gross_reversed_cents - NEW.creator_net_reversed_cents
  ) > (
    (SELECT s.marketplace_fee_cents FROM creator_sale_snapshots s WHERE s.order_item_id=NEW.order_item_id)
    - COALESCE((SELECT SUM(r.gross_reversed_cents-r.creator_net_reversed_cents) FROM creator_reversal_snapshots r WHERE r.order_item_id=NEW.order_item_id),0)
  );
END;
