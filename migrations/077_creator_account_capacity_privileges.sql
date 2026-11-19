-- Database-side final guards make capacity invariant under concurrent writes.
-- JavaScript preflight remains the user-facing policy path; this view/guards
-- enforce the same allocation at the final publication/shelf transition.
CREATE VIEW creator_effective_capacity_categories AS
SELECT c.id AS creator_id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM creator_identity_ownership io
      JOIN users u ON u.id=io.owner_user_id
      WHERE io.creator_id=c.id AND u.status='active' AND u.role='admin'
    ) THEN 'admin'
    WHEN c.owner_catalog_override=1 OR EXISTS (
      SELECT 1 FROM creator_identity_ownership io
      JOIN users u ON u.id=io.owner_user_id
      WHERE io.creator_id=c.id AND u.status='active' AND u.role='owner'
    ) THEN 'owner'
    WHEN EXISTS (
      SELECT 1 FROM creator_commission_category_assignments a
      WHERE a.creator_id=c.id AND a.category='founding25'
        AND a.effective_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND (a.revoked_at IS NULL OR a.revoked_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) THEN 'founding25'
    WHEN EXISTS (
      SELECT 1 FROM creator_preferred_terms t
      WHERE t.creator_id=c.id AND t.status='active'
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
            SELECT 1 FROM preferred_billing_commitments b
            JOIN preferred_billing_installments i ON i.commitment_id=b.id
            WHERE b.preferred_term_id=t.id AND b.billing_state='remediation'
              AND i.status='failed'
              AND i.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
              AND i.grace_ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          )
        )
    ) THEN 'premier'
    ELSE 'standard'
  END AS capacity_category
FROM marketplace_creators c;

CREATE TRIGGER enforce_creator_catalog_capacity_insert
BEFORE INSERT ON creator_listings
WHEN NEW.publication_state='published'
  AND (SELECT COUNT(*) FROM creator_listings
       WHERE creator_id=NEW.creator_id AND publication_state='published') >=
      CASE COALESCE((SELECT capacity_category FROM creator_effective_capacity_categories WHERE creator_id=NEW.creator_id),'standard')
        WHEN 'admin' THEN 2147483647
        WHEN 'owner' THEN 2147483647
        WHEN 'founding25' THEN 24
        WHEN 'premier' THEN 24
        ELSE 12
      END
BEGIN
  SELECT RAISE(ABORT, 'active catalog capacity exceeded');
END;

CREATE TRIGGER enforce_creator_catalog_capacity_update
BEFORE UPDATE OF publication_state ON creator_listings
WHEN NEW.publication_state='published' AND OLD.publication_state<>'published'
  AND (SELECT COUNT(*) FROM creator_listings
       WHERE creator_id=NEW.creator_id AND publication_state='published' AND id<>NEW.id) >=
      CASE COALESCE((SELECT capacity_category FROM creator_effective_capacity_categories WHERE creator_id=NEW.creator_id),'standard')
        WHEN 'admin' THEN 2147483647
        WHEN 'owner' THEN 2147483647
        WHEN 'founding25' THEN 24
        WHEN 'premier' THEN 24
        ELSE 12
      END
BEGIN
  SELECT RAISE(ABORT, 'active catalog capacity exceeded');
END;

CREATE TRIGGER enforce_creator_shelf_capacity_insert
BEFORE INSERT ON marketplace_products
WHEN NEW.publication_state='published' AND NEW.storefront_visibility='listed'
  AND (SELECT COUNT(*) FROM marketplace_products
       WHERE creator_id=NEW.creator_id AND publication_state='published' AND storefront_visibility='listed') >=
      CASE COALESCE((SELECT capacity_category FROM creator_effective_capacity_categories WHERE creator_id=NEW.creator_id),'standard')
        WHEN 'admin' THEN 2147483647
        WHEN 'owner' THEN 14
        WHEN 'founding25' THEN 12
        WHEN 'premier' THEN 12
        ELSE 6
      END
BEGIN
  SELECT RAISE(ABORT, 'creator shelf capacity exceeded');
END;

CREATE TRIGGER enforce_creator_shelf_capacity_update
BEFORE UPDATE OF storefront_visibility,publication_state ON marketplace_products
WHEN NEW.publication_state='published' AND NEW.storefront_visibility='listed'
  AND (OLD.publication_state<>'published' OR OLD.storefront_visibility<>'listed')
  AND (SELECT COUNT(*) FROM marketplace_products
       WHERE creator_id=NEW.creator_id AND publication_state='published'
         AND storefront_visibility='listed' AND id<>NEW.id) >=
      CASE COALESCE((SELECT capacity_category FROM creator_effective_capacity_categories WHERE creator_id=NEW.creator_id),'standard')
        WHEN 'admin' THEN 2147483647
        WHEN 'owner' THEN 14
        WHEN 'founding25' THEN 12
        WHEN 'premier' THEN 12
        ELSE 6
      END
BEGIN
  SELECT RAISE(ABORT, 'creator shelf capacity exceeded');
END;
