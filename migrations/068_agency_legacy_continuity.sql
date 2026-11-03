-- Operation Severance Task 2R-B: one retired native identity for the only
-- legacy product with extant staging orders and entitlements. This migration
-- intentionally does not alter historical orders, order items, or entitlements.
CREATE TABLE _agency_continuity_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _agency_continuity_guard(valid)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM marketplace_products
    WHERE slug = 'agency' COLLATE NOCASE AND id <> 'legacy:agency'
  )
  OR EXISTS (
    SELECT 1 FROM marketplace_products
    WHERE id = 'legacy:agency' AND (
      slug <> 'agency' COLLATE NOCASE
      OR creator_id <> 'creator-rv-sawyer'
      OR creator_listing_id IS NOT NULL
      OR publication_state <> 'retired'
      OR status <> 'legacy-not-for-sale'
      OR buy_mode <> 'retired'
      OR delivery_r2_key IS NOT NULL
      OR json_extract(metadata_json, '$.operationSeverance.migration') <> '2R-B'
      OR json_extract(metadata_json, '$.operationSeverance.continuityIdentity') <> 'agency'
    )
  )
  THEN 0 ELSE 1 END;

DROP TABLE _agency_continuity_guard;

INSERT OR IGNORE INTO marketplace_products (
  id,
  slug,
  creator_id,
  creator_listing_id,
  publication_state,
  title,
  subtitle,
  short_description,
  long_description,
  publisher,
  game_system,
  product_line,
  genre,
  media_type,
  status,
  buy_mode,
  buy_url,
  currency,
  pricing_model,
  price_cents,
  suggested_price_cents,
  minimum_price_cents,
  sale_enabled,
  sale_price_cents,
  sale_start,
  sale_end,
  cover_r2_key,
  preview_r2_key,
  thumbnail_r2_key,
  delivery_r2_key,
  delivery_filename,
  delivery_content_type,
  metadata_json,
  created_at,
  updated_at,
  published_at,
  revision
) VALUES (
  'legacy:agency',
  'agency',
  'creator-rv-sawyer',
  NULL,
  'retired',
  'Agency',
  'Share the wheel or crash the game',
  '',
  '',
  'Tobacco Road Games',
  'System Agnotic',
  'Tablecraft',
  '',
  'digital',
  'legacy-not-for-sale',
  'retired',
  '',
  'USD',
  'free',
  0,
  NULL,
  NULL,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  json_object(
    'version', '1.0',
    'releaseDate', '2026-06-24',
    'lastUpdated', '2026-06-24',
    'authors', json_array('RV Sawyer'),
    'authorSlugs', json_array('rv-sawyer'),
    'operationSeverance', json_object(
      'migration', '2R-B',
      'continuityIdentity', 'agency',
      'source', 'legacy-order-and-entitlement-snapshots',
      'deliveryAssetStatus', 'authoritative-staging-object-unavailable',
      'expectedDelivery', json_object(
        'r2ObjectKey', 'agency/product.pdf',
        'filename', 'Agency.pdf',
        'contentType', 'application/pdf',
        'sizeBytes', 9630946
      )
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  1
);
