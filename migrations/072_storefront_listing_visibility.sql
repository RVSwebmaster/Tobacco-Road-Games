-- Browsing visibility is independent from pricing and purchase availability.
-- Existing products retain their status-derived behavior unless explicitly listed
-- or unlisted. The approved Open Rules Library is shelved for public browsing
-- while its preview-only buy mode remains unchanged.
ALTER TABLE marketplace_products
  ADD COLUMN storefront_visibility TEXT NOT NULL DEFAULT 'automatic'
    CHECK (storefront_visibility IN ('automatic','listed','unlisted'));

CREATE INDEX idx_marketplace_products_storefront_visibility
  ON marketplace_products(storefront_visibility, publication_state, slug);

UPDATE marketplace_products
SET storefront_visibility = 'listed',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revision = revision + 1
WHERE id IN (
  '5e-players-manual',
  '5e-spellbook',
  '5e-bard-spellbook',
  '5e-cleric-spellbook',
  '5e-druid-spellbook',
  '5e-paladin-spellbook',
  '5e-ranger-spellbook',
  '5e-sorcerer-spellbook',
  '5e-warlock-spellbook',
  '5e-wizard-spellbook',
  '5e-relics-and-wonders',
  '5e-dungeon-masters-handbook'
)
  AND publication_state = 'published'
  AND status = 'preview-only'
  AND buy_mode = 'preview-only'
  AND sale_enabled = 0
  AND json_extract(metadata_json, '$.openRulesEligible') = 1;
