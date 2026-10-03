CREATE TABLE IF NOT EXISTS shelf_curios (
  id TEXT PRIMARY KEY,
  shelf_id TEXT NOT NULL,
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_event_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS shelf_curio_events (
  id TEXT PRIMARY KEY,
  curio_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('move', 'reset')),
  actor_id TEXT NOT NULL,
  rate_key TEXT NOT NULL,
  from_x REAL NOT NULL,
  from_y REAL NOT NULL,
  to_x REAL NOT NULL,
  to_y REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shelf_curio_events_actor_time
  ON shelf_curio_events (rate_key, created_at);
CREATE INDEX IF NOT EXISTS idx_shelf_curio_events_time
  ON shelf_curio_events (created_at);

-- Reapplying a migration must never reset a community arrangement.
INSERT OR IGNORE INTO shelf_curios (id, shelf_id, x, y, updated_at)
VALUES ('harimafuji', 'bric-a-brac-1', 0.5, 0.5, '2026-10-02T00:00:00.000Z');
