CREATE TABLE news_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('hn','rss','bundle')),
  country TEXT,
  sector TEXT,
  url TEXT,
  title TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL
);
