CREATE TABLE IF NOT EXISTS glossary_entries (
  id TEXT PRIMARY KEY,
  source_language TEXT NOT NULL CHECK (source_language IN ('es', 'en', 'fr', 'de', 'pt')),
  target_language TEXT NOT NULL CHECK (target_language IN ('es', 'en', 'fr', 'de', 'pt')),
  source_term TEXT NOT NULL,
  preferred_translation TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_glossary_language_pair
ON glossary_entries (source_language, target_language);
