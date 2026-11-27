-- Reassign only the two known TEST / NOT FOR SALE fixtures to the active
-- standard Creator test identity. This repairs their initial association;
-- it does not add a permission path or weaken the shelf ownership checks.
CREATE TABLE creator_test_product_identity_transfers (
  migration_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES marketplace_products(id),
  original_creator_id TEXT NOT NULL REFERENCES marketplace_creators(id),
  target_creator_id TEXT NOT NULL REFERENCES marketplace_creators(id),
  transferred_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (migration_id, product_id)
);

CREATE TABLE creator_test_product_identity_transfer_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO creator_test_product_identity_transfer_guard(valid)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM marketplace_products WHERE id IN (
      'test-rv-ashen-grimoire-2026-11-27',
      'test-rv-black-stars-2026-11-27'
    )) = 0 THEN 1
  WHEN (SELECT COUNT(*) FROM marketplace_products p WHERE p.id IN (
      'test-rv-ashen-grimoire-2026-11-27',
      'test-rv-black-stars-2026-11-27'
    )
    AND p.creator_id = 'creator-rv-sawyer'
    AND p.managed_by_user_id = '5157e45f-7848-4891-afd6-05e4b6fb6abf'
    AND p.publication_state = 'published'
    AND p.status = 'preview-only'
    AND p.buy_mode = 'preview-only'
    AND p.storefront_visibility = 'unlisted'
    AND p.price_cents = 0
    AND p.sale_enabled = 0
    AND p.sale_price_cents IS NULL
    AND p.delivery_r2_key IS NULL
    AND p.creator_listing_id IS NULL
    AND json_extract(p.metadata_json, '$.testOnly') = 1
    AND json_extract(p.metadata_json, '$.notForSale') = 1
    AND json_extract(p.metadata_json, '$.excludeFromPublicCommercialListings') = 1
    AND json_extract(p.metadata_json, '$.shelvingTest') = 1
    AND NOT EXISTS (SELECT 1 FROM creator_profile_shelf_selections s WHERE s.product_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_slug = p.slug)
    AND NOT EXISTS (SELECT 1 FROM download_entitlements de WHERE de.product_slug = p.slug)
    AND NOT EXISTS (SELECT 1 FROM creator_sale_snapshots cs WHERE cs.product_slug = p.slug)
    AND (
      (p.id = 'test-rv-ashen-grimoire-2026-11-27'
        AND p.slug = 'test-ashen-grimoire-rv-2026-11-27'
        AND p.title = 'The Ashen Grimoire'
        AND p.subtitle = 'Mock Fantasy RPG Supplement • TEST ONLY • NOT FOR SALE'
        AND p.cover_r2_key = 'test-products/creator-shelf-owner-test-2026-11-27/ashen-grimoire-cover.webp')
      OR
      (p.id = 'test-rv-black-stars-2026-11-27'
        AND p.slug = 'test-beyond-black-stars-rv-2026-11-27'
        AND p.title = 'Beyond the Black Stars'
        AND p.subtitle = 'Mock Science-Fiction RPG Supplement • TEST ONLY • NOT FOR SALE'
        AND p.cover_r2_key = 'test-products/creator-shelf-owner-test-2026-11-27/beyond-black-stars-cover.webp')
    )
  ) = 2
  AND EXISTS (
    SELECT 1 FROM creator_identity_ownership io
    JOIN users u ON u.id = io.owner_user_id
    JOIN marketplace_creators c ON c.id = io.creator_id
    WHERE io.creator_id = 'creator-rv-sawyer'
      AND io.owner_user_id = '5157e45f-7848-4891-afd6-05e4b6fb6abf'
      AND io.identity_type = 'primary' AND io.account_status = 'active'
      AND u.status = 'active' AND u.role = 'owner'
      AND c.slug = 'rv-sawyer'
  )
  AND EXISTS (
    SELECT 1 FROM creator_identity_ownership io
    JOIN users u ON u.id = io.owner_user_id
    JOIN creator_memberships cm ON cm.creator_id = io.creator_id
      AND cm.user_id = u.id AND cm.permission = 'manager'
    JOIN marketplace_creators c ON c.id = io.creator_id
    WHERE io.creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c'
      AND io.owner_user_id = 'ba64b095-7142-423e-9454-649745815c15'
      AND io.identity_type = 'primary' AND io.account_status = 'active'
      AND u.status = 'active' AND u.role = 'user'
      AND c.slug = 'trg-test-creator'
      AND c.marketplace_status IN ('pending','approved')
      AND c.registration_status = 'active'
      AND c.closure_state = 'active'
  )
  AND (SELECT COUNT(*) FROM marketplace_products p
    WHERE p.creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c'
      AND p.publication_state = 'published'
      AND p.status <> 'retired' AND p.buy_mode <> 'retired') <= 10
  THEN 1
  ELSE 0
END;

DROP TRIGGER protect_marketplace_product_identity;

UPDATE marketplace_products
SET creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c',
    managed_by_user_id = 'ba64b095-7142-423e-9454-649745815c15',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
  'test-rv-ashen-grimoire-2026-11-27',
  'test-rv-black-stars-2026-11-27'
)
  AND creator_id = 'creator-rv-sawyer';

INSERT INTO creator_test_product_identity_transfers(
  migration_id, product_id, original_creator_id, target_creator_id, transferred_at, reason
)
SELECT 'creator-test-product-transfer-082', p.id, 'creator-rv-sawyer', p.creator_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       'Corrected initial TEST / NOT FOR SALE product association to the Creator-class shelving test identity.'
FROM marketplace_products p
WHERE p.id IN (
  'test-rv-ashen-grimoire-2026-11-27',
  'test-rv-black-stars-2026-11-27'
)
  AND p.creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c'
  AND p.managed_by_user_id = 'ba64b095-7142-423e-9454-649745815c15';

CREATE TRIGGER protect_marketplace_product_identity
BEFORE UPDATE OF id, slug, creator_id ON marketplace_products
WHEN NEW.id IS NOT OLD.id OR NEW.slug IS NOT OLD.slug
  OR NEW.creator_id IS NOT OLD.creator_id
BEGIN
  SELECT RAISE(ABORT, 'product identity, slug, and creator are immutable');
END;

DELETE FROM creator_test_product_identity_transfer_guard;
DROP TABLE creator_test_product_identity_transfer_guard;

CREATE TABLE creator_test_product_identity_transfer_postcondition (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO creator_test_product_identity_transfer_postcondition(valid)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM creator_test_product_identity_transfers) = 0
    AND (SELECT COUNT(*) FROM marketplace_products WHERE id IN (
      'test-rv-ashen-grimoire-2026-11-27',
      'test-rv-black-stars-2026-11-27'
    )) = 0 THEN 1
  WHEN (SELECT COUNT(*) FROM creator_test_product_identity_transfers
      WHERE migration_id = 'creator-test-product-transfer-082'
        AND original_creator_id = 'creator-rv-sawyer'
        AND target_creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c') = 2
    AND (SELECT COUNT(*) FROM marketplace_products WHERE id IN (
      'test-rv-ashen-grimoire-2026-11-27',
      'test-rv-black-stars-2026-11-27'
    ) AND creator_id = '1ca19a95-a84c-468b-aff8-24f194653c6c'
      AND managed_by_user_id = 'ba64b095-7142-423e-9454-649745815c15') = 2
    AND EXISTS (SELECT 1 FROM sqlite_master
      WHERE type = 'trigger' AND name = 'protect_marketplace_product_identity')
  THEN 1
  ELSE 0
END;

DELETE FROM creator_test_product_identity_transfer_postcondition;
DROP TABLE creator_test_product_identity_transfer_postcondition;
