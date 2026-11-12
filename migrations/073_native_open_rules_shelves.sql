-- Move Open Rules membership and editorial order into the authoritative D1
-- homepage configuration. The seed preserves the current thirteen-book order.
UPDATE homepage_configurations
SET configuration_json = json_set(
  configuration_json,
  '$.shelves.openRulesLibraryUpper', json('{"visible":true,"managed":true,"productIds":["5e-players-manual","5e-spellbook","5e-bard-spellbook","5e-cleric-spellbook","5e-druid-spellbook","5e-paladin-spellbook","5e-ranger-spellbook","5e-sorcerer-spellbook","5e-warlock-spellbook","5e-wizard-spellbook","5e-relics-and-wonders","5e-dungeon-masters-handbook","5e-monster-guide"]}'),
  '$.shelves.openRulesLibraryLower', json('{"visible":true,"managed":true,"productIds":[]}')
),
revision = revision,
updated_at = '2026-11-12T00:00:00.000Z'
WHERE id = 'storefront';
