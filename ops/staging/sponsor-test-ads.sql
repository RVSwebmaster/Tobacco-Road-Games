-- STAGING TEST FIXTURE ONLY. Load only through load-sponsor-test-ads.ps1.
INSERT INTO marketplace_ads (
  id, pool, sponsor_name, title, alt_text, creative_url, destination_url,
  status, approval_state, starts_at, ends_at, allocation_weight,
  impressions, clicks, created_at, updated_at
) VALUES
  (
    'staging-test-tobacco-road-games-ad-1', 'event', 'Tobacco Road Games',
    'Tobacco Road Games — Ad 1',
    'Tobacco Road Games — Books Worth Pulling From the Shelf',
    '/assets/images/sponsor/staging-tobacco-road-games-books.svg', '/store/',
    'active', 'approved', NULL, NULL, 1, 0, 0,
    strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ),
  (
    'staging-test-tobacco-road-games-ad-2', 'event', 'Tobacco Road Games',
    'Tobacco Road Games — Ad 2',
    'Tobacco Road Games — Independent Games. Open Shelves.',
    '/assets/images/sponsor/staging-tobacco-road-games-open-shelves.svg', '/store/',
    'active', 'approved', NULL, NULL, 1, 0, 0,
    strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )
ON CONFLICT(id) DO UPDATE SET
  pool=excluded.pool,
  sponsor_name=excluded.sponsor_name,
  title=excluded.title,
  alt_text=excluded.alt_text,
  creative_url=excluded.creative_url,
  destination_url=excluded.destination_url,
  status=excluded.status,
  approval_state=excluded.approval_state,
  starts_at=excluded.starts_at,
  ends_at=excluded.ends_at,
  allocation_weight=excluded.allocation_weight,
  updated_at=excluded.updated_at;
