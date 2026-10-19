CREATE TABLE IF NOT EXISTS translation_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_translation_segments_session
ON translation_segments (session_id, source_language, target_language, id DESC);

CREATE INDEX IF NOT EXISTS idx_translation_segments_created
ON translation_segments (created_at);
