-- Creator Profile presentation is independent of marketplace listing status.
-- Capacity is resolved from existing production policy tables so this migration
-- does not depend on the deferred creator_effective_capacity_categories view.
CREATE TABLE IF NOT EXISTS creator_profile_shelf_selections (
  creator_id TEXT NOT NULL REFERENCES marketplace_creators(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position>=0),
  selected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(creator_id,product_id),
  UNIQUE(creator_id,position)
);

CREATE INDEX IF NOT EXISTS idx_creator_profile_shelf_creator_position
  ON creator_profile_shelf_selections(creator_id,position,product_id);

CREATE TRIGGER IF NOT EXISTS creator_profile_shelf_owner_insert
BEFORE INSERT ON creator_profile_shelf_selections
WHEN NOT EXISTS (
  SELECT 1 FROM marketplace_products p
  WHERE p.id=NEW.product_id AND p.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'profile shelf product belongs to another Creator');
END;

CREATE TRIGGER IF NOT EXISTS creator_profile_shelf_capacity_insert
BEFORE INSERT ON creator_profile_shelf_selections
WHEN (SELECT COUNT(*) FROM creator_profile_shelf_selections
      WHERE creator_id=NEW.creator_id) >= CASE
  WHEN EXISTS (
    SELECT 1 FROM creator_identity_ownership io
    JOIN users u ON u.id=io.owner_user_id
    WHERE io.creator_id=NEW.creator_id AND u.status='active' AND u.role='admin'
  ) THEN 2147483647
  WHEN COALESCE((SELECT owner_catalog_override FROM marketplace_creators c
                 WHERE c.id=NEW.creator_id),0)=1 OR EXISTS (
    SELECT 1 FROM creator_identity_ownership io
    JOIN users u ON u.id=io.owner_user_id
    WHERE io.creator_id=NEW.creator_id AND u.status='active' AND u.role='owner'
  ) THEN 14
  WHEN EXISTS (
    SELECT 1 FROM creator_commission_category_assignments a
    WHERE a.creator_id=NEW.creator_id AND a.category='founding25'
      AND a.effective_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (a.revoked_at IS NULL OR a.revoked_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) THEN 12
  WHEN EXISTS (
    SELECT 1 FROM creator_preferred_terms t
    WHERE t.creator_id=NEW.creator_id AND t.status='active'
      AND t.term_started_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND t.term_ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS (
        SELECT 1 FROM preferred_billing_commitments b
        WHERE b.preferred_term_id=t.id AND b.paid_through_at IS NULL
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM preferred_service_charges pc
          JOIN marketplace_service_purchases p ON p.id=pc.service_purchase_id
          WHERE pc.preferred_term_id=t.id
        )
        OR EXISTS (
          SELECT 1 FROM preferred_service_charges pc
          JOIN marketplace_service_purchases p ON p.id=pc.service_purchase_id
          WHERE pc.preferred_term_id=t.id AND p.status='settled'
            AND pc.coverage_starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND pc.coverage_ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        )
        OR EXISTS (
          SELECT 1 FROM preferred_service_charges pc
          JOIN preferred_billing_commitments b ON b.id=pc.commitment_id
          JOIN preferred_billing_installments i ON i.commitment_id=b.id
          WHERE b.preferred_term_id=t.id AND b.billing_state='remediation'
            AND i.status='failed'
            AND i.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND i.grace_ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        )
      )
  ) THEN 12
  ELSE 6
END
BEGIN
  SELECT RAISE(ABORT,'creator profile shelf capacity exceeded');
END;

CREATE TRIGGER IF NOT EXISTS creator_profile_shelf_identity_immutable
BEFORE UPDATE OF creator_id,product_id ON creator_profile_shelf_selections
WHEN NEW.creator_id IS NOT OLD.creator_id OR NEW.product_id IS NOT OLD.product_id
BEGIN
  SELECT RAISE(ABORT,'profile shelf identity is immutable');
END;
