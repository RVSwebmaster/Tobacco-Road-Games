-- Remove only the untouched Creator listing rows seeded by migration 018.
-- The canonical RV Sawyer Creator identity and all marketplace infrastructure remain.
WITH legacy_seed(listing_id, product_slug) AS (
  VALUES
    ('listing-agency', 'agency'),
    ('listing-circle-of-cinder', 'circle-of-cinder'),
    ('listing-final-flame', 'final-flame'),
    ('listing-janni', 'janni'),
    ('listing-mouthy-monsters', 'mouthy-monsters'),
    ('listing-path-of-the-janky', 'path-of-the-janky'),
    ('listing-ringbound', 'ringbound'),
    ('listing-silence-and-the-spotlight', 'silence-and-the-spotlight'),
    ('listing-sirrocans', 'sirrocans'),
    ('listing-spriggans', 'spriggans'),
    ('listing-tablecraft-primer', 'tablecraft-primer'),
    ('listing-yojimbo', 'yojimbo')
)
DELETE FROM creator_listings AS listing
WHERE listing.creator_id = 'creator-rv-sawyer'
  AND EXISTS (
    SELECT 1
    FROM legacy_seed AS seed
    WHERE seed.listing_id = listing.id
      AND seed.product_slug = listing.slug
      AND seed.product_slug = listing.source_product_slug
  )
  AND listing.lifecycle_state = 'active'
  AND listing.publication_state = 'not_approved'
  AND listing.public_product_slug IS NULL
  AND listing.submitted_at IS NULL
  AND listing.reviewed_at IS NULL
  AND listing.published_at IS NULL
  AND listing.first_published_at IS NULL
  AND listing.listed_price_cents IS NULL
  AND listing.sale_price_cents IS NULL
  AND listing.media_type = ''
  AND NOT EXISTS (SELECT 1 FROM creator_ad_creatives WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_bundle_items WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_first_publication_corrections WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_lifecycle_notices WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_listing_declarations WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_listing_files WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_product_activity_events WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_publication_audit WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_review_audit WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM product_remediation_cases WHERE listing_id = listing.id)
  AND NOT EXISTS (SELECT 1 FROM creator_sale_snapshots WHERE product_identity_id = listing.id)
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_discovery_labels
    WHERE subject_type = 'product' AND subject_id = listing.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_discovery_label_suppressions
    WHERE subject_type = 'product' AND subject_id = listing.id
  );
