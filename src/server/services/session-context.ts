const MAX_SEGMENTS = 4;
const RETENTION_MS = 24 * 60 * 60 * 1000;

type SegmentRow = { source_text: string; translated_text: string };

export const loadSessionContext = async (
  db: D1Database,
  sessionId: string,
  sourceLanguage: string,
  targetLanguage: string,
  now = Date.now(),
): Promise<string[]> => {
  const result = await db.prepare(
    "SELECT source_text, translated_text FROM translation_segments WHERE session_id = ? AND source_language = ? AND target_language = ? AND created_at >= ? ORDER BY id DESC LIMIT ?",
  ).bind(sessionId, sourceLanguage, targetLanguage, now - RETENTION_MS, MAX_SEGMENTS).all<SegmentRow>();
  return result.results.reverse().map((row) => `${row.source_text} → ${row.translated_text}`.slice(0, 500));
};

export const saveSessionContext = async (
  db: D1Database,
  input: { sessionId: string; sourceLanguage: string; targetLanguage: string; sourceText: string; translatedText: string },
  now = Date.now(),
): Promise<void> => {
  const sourceText = input.sourceText.slice(0, 500);
  const translatedText = input.translatedText.slice(0, 500);
  await db.prepare("DELETE FROM translation_segments WHERE created_at < ?").bind(now - RETENTION_MS).run();
  const latest = await db.prepare(
    "SELECT source_text, translated_text FROM translation_segments WHERE session_id = ? AND source_language = ? AND target_language = ? ORDER BY id DESC LIMIT 1",
  ).bind(input.sessionId, input.sourceLanguage, input.targetLanguage).first<SegmentRow>();
  if (latest?.source_text !== sourceText || latest?.translated_text !== translatedText) {
    await db.prepare(
      "INSERT INTO translation_segments (session_id, source_language, target_language, source_text, translated_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(input.sessionId, input.sourceLanguage, input.targetLanguage, sourceText, translatedText, now).run();
  }
  await db.prepare(
    "DELETE FROM translation_segments WHERE session_id = ? AND id NOT IN (SELECT id FROM translation_segments WHERE session_id = ? ORDER BY id DESC LIMIT ?)",
  ).bind(input.sessionId, input.sessionId, MAX_SEGMENTS).run();
};

export const clearSessionContext = async (db: D1Database, sessionId: string): Promise<void> => {
  await db.prepare("DELETE FROM translation_segments WHERE session_id = ?").bind(sessionId).run();
};
