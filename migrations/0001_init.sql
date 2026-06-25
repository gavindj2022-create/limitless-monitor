CREATE TABLE IF NOT EXISTS sites (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  url TEXT NOT NULL,
  project_name TEXT,
  source TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS daily_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_slug TEXT NOT NULL,
  review_date TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  screenshots_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(site_slug, review_date),
  FOREIGN KEY(site_slug) REFERENCES sites(slug)
);

CREATE TABLE IF NOT EXISTS site_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_slug TEXT NOT NULL,
  review_date TEXT NOT NULL,
  severity TEXT NOT NULL,
  area TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(site_slug) REFERENCES sites(slug)
);

CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews(review_date);
CREATE INDEX IF NOT EXISTS idx_site_findings_site_date ON site_findings(site_slug, review_date);
