CREATE TABLE briefing (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  tz TEXT NOT NULL,
  sections TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0,1))
);
CREATE TABLE briefing_item_dismissed (
  date TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (date, url_hash)
);
