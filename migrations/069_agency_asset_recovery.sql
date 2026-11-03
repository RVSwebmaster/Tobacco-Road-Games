-- Operation Severance Task 2R-C: finalize the retired Agency continuity
-- identity only after the authoritative binary has been restored and verified
-- in staging R2. Historical orders and entitlements remain immutable.
CREATE TABLE _agency_asset_recovery_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _agency_asset_recovery_guard(valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM marketplace_products
    WHERE id = 'legacy:agency'
      AND slug = 'agency' COLLATE NOCASE
      AND creator_id = 'creator-rv-sawyer'
      AND creator_listing_id IS NULL
      AND publication_state = 'retired'
      AND status = 'legacy-not-for-sale'
      AND buy_mode = 'retired'
      AND (
        (
          revision = 1
          AND delivery_r2_key IS NULL
          AND delivery_filename IS NULL
          AND delivery_content_type IS NULL
          AND json_extract(metadata_json, '$.operationSeverance.migration') = '2R-B'
          AND json_extract(metadata_json, '$.operationSeverance.continuityIdentity') = 'agency'
        )
        OR (
          revision = 2
          AND delivery_r2_key = 'agency/product.pdf'
          AND delivery_filename = 'Agency.pdf'
          AND delivery_content_type = 'application/pdf'
          AND json_extract(metadata_json, '$.operationSeverance.assetRecoveryMigration') = '2R-C'
          AND json_extract(metadata_json, '$.operationSeverance.deliverySha256') =
            'c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9'
          AND json_extract(metadata_json, '$.operationSeverance.deliverySizeBytes') = 9630946
        )
      )
  )
  OR EXISTS (
    SELECT 1 FROM marketplace_products
    WHERE slug = 'agency' COLLATE NOCASE AND id <> 'legacy:agency'
  )
  THEN 0 ELSE 1 END;

UPDATE marketplace_products
SET delivery_r2_key = 'agency/product.pdf',
    delivery_filename = 'Agency.pdf',
    delivery_content_type = 'application/pdf',
    metadata_json = json_set(
      metadata_json,
      '$.operationSeverance.deliveryAssetStatus', 'restored-and-verified',
      '$.operationSeverance.assetRecoveryMigration', '2R-C',
      '$.operationSeverance.deliverySha256',
        'c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9',
      '$.operationSeverance.deliverySizeBytes', 9630946,
      '$.operationSeverance.deliverySource', 'retained-local-trg-archive'
    ),
    updated_at = CURRENT_TIMESTAMP,
    revision = revision + 1
WHERE id = 'legacy:agency'
  AND slug = 'agency' COLLATE NOCASE
  AND revision = 1
  AND delivery_r2_key IS NULL
  AND json_extract(metadata_json, '$.operationSeverance.migration') = '2R-B';

DROP TABLE _agency_asset_recovery_guard;
