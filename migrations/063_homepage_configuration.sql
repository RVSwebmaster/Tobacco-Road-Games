-- Cloudflare-native homepage merchandising configuration. Product and Creator
-- identities are stored inside the validated JSON document so the complete
-- configuration can be revision-checked and committed atomically.
CREATE TABLE homepage_configurations (
  id TEXT NOT NULL PRIMARY KEY CHECK (id = 'storefront'),
  configuration_json TEXT NOT NULL
    CHECK (json_valid(configuration_json) AND json_type(configuration_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO homepage_configurations(id, configuration_json, revision, created_at, updated_at)
VALUES(
  'storefront',
  '{"version":1,"shelves":{"featuredCreator":{"visible":true,"managed":false,"creatorId":null,"productIds":[]},"newThisWeek":{"visible":true,"managed":false,"productIds":[]},"bestSellers":{"visible":true,"managed":false,"productIds":[]},"freePwyw":{"visible":true,"managed":false,"productIds":[]}},"promotions":[]}',
  1,
  '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z'
);
