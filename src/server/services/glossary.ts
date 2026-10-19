import { Document } from "@langchain/core/documents";
import { RunnableLambda } from "@langchain/core/runnables";
import type { GlossaryEntry, GlossaryInput, GlossaryMatch, GlossarySense } from "../../shared/glossary";
import type { AiBinding } from "../types";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;
export const MAX_GLOSSARY_ENTRIES = 500;

type GlossaryRow = {
  id: string;
  source_language: GlossaryEntry["sourceLanguage"];
  target_language: GlossaryEntry["targetLanguage"];
  source_term: string;
  preferred_translation: string;
  domain: string;
  example: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const columns = "id, source_language, target_language, source_term, preferred_translation, domain, example, notes, created_at, updated_at";

const fromRow = (row: GlossaryRow): GlossaryEntry => ({
  id: row.id,
  sourceLanguage: row.source_language,
  targetLanguage: row.target_language,
  sourceTerm: row.source_term,
  preferredTranslation: row.preferred_translation,
  domain: row.domain,
  example: row.example,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listGlossary = async (db: D1Database): Promise<GlossaryEntry[]> => {
  const result = await db.prepare(`SELECT ${columns} FROM glossary_entries ORDER BY updated_at DESC LIMIT ?`)
    .bind(MAX_GLOSSARY_ENTRIES).all<GlossaryRow>();
  return result.results.map(fromRow);
};

export const findGlossarySenses = async (
  db: D1Database,
  input: { text: string; term: string; sourceLanguage: string; targetLanguage: string },
): Promise<GlossarySense[]> => {
  const term = input.term.normalize("NFC").trim();
  if (!term || !containsSourceTerm(input.text, term) || input.sourceLanguage === "auto") return [];
  const result = await db.prepare(`SELECT ${columns} FROM glossary_entries WHERE source_language = ? AND target_language = ? LIMIT ?`)
    .bind(input.sourceLanguage, input.targetLanguage, MAX_GLOSSARY_ENTRIES).all<GlossaryRow>();
  return result.results.map(fromRow)
    .filter((entry) => entry.sourceTerm.normalize("NFC").toLocaleLowerCase() === term.toLocaleLowerCase())
    .slice(0, 5)
    .map(({ id, sourceTerm, preferredTranslation, domain, example, notes }) =>
      ({ id, sourceTerm, preferredTranslation, domain, example, notes }));
};

export const findMatchingGlossarySenses = async (
  db: D1Database,
  input: { text: string; sourceLanguage: string; targetLanguage: string },
): Promise<GlossarySense[]> => {
  if (input.sourceLanguage === "auto") return [];
  const result = await db.prepare(`SELECT ${columns} FROM glossary_entries WHERE source_language = ? AND target_language = ? LIMIT ?`)
    .bind(input.sourceLanguage, input.targetLanguage, MAX_GLOSSARY_ENTRIES).all<GlossaryRow>();
  const matching = result.results.map(fromRow).filter((entry) => containsSourceTerm(input.text, entry.sourceTerm));
  const grouped = new Map<string, GlossaryEntry[]>();
  for (const entry of matching) {
    const key = entry.sourceTerm.normalize("NFC").toLocaleLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return [...grouped.values()].filter((entries) => entries.length > 1).slice(0, 4)
    .flatMap((entries) => entries.slice(0, 5).map(({ id, sourceTerm, preferredTranslation, domain, example, notes }) =>
      ({ id, sourceTerm, preferredTranslation, domain, example, notes })));
};

export const getGlossary = async (db: D1Database, id: string): Promise<GlossaryEntry | null> => {
  const row = await db.prepare(`SELECT ${columns} FROM glossary_entries WHERE id = ?`).bind(id).first<GlossaryRow>();
  return row ? fromRow(row) : null;
};

export const countGlossary = async (db: D1Database): Promise<number> => {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM glossary_entries").first<{ total: number }>();
  return row?.total ?? 0;
};

export const insertGlossary = async (db: D1Database, entry: GlossaryEntry) => {
  await db.prepare(`INSERT INTO glossary_entries (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(entry.id, entry.sourceLanguage, entry.targetLanguage, entry.sourceTerm, entry.preferredTranslation,
      entry.domain, entry.example, entry.notes, entry.createdAt, entry.updatedAt).run();
};

export const updateGlossary = async (db: D1Database, entry: GlossaryEntry) => {
  await db.prepare("UPDATE glossary_entries SET source_term = ?, preferred_translation = ?, domain = ?, example = ?, notes = ?, updated_at = ? WHERE id = ?")
    .bind(entry.sourceTerm, entry.preferredTranslation, entry.domain, entry.example, entry.notes, entry.updatedAt, entry.id).run();
};

export const deleteGlossary = async (db: D1Database, id: string) => {
  await db.prepare("DELETE FROM glossary_entries WHERE id = ?").bind(id).run();
};

export const createGlossaryEntry = (input: GlossaryInput): GlossaryEntry => {
  const now = new Date().toISOString();
  return { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
};

const embeddingText = (entry: GlossaryEntry) => [
  `Source term: ${entry.sourceTerm}`,
  `Preferred translation: ${entry.preferredTranslation}`,
  entry.domain && `Domain: ${entry.domain}`,
  entry.example && `Example: ${entry.example}`,
  entry.notes && `Meaning: ${entry.notes}`,
].filter(Boolean).join("\n");

const embeddingFor = async (ai: AiBinding, text: string): Promise<number[]> => {
  const output = await ai.run(EMBEDDING_MODEL, { text: [text] });
  const data = (output as { data?: unknown })?.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  const vector = Array.isArray(first) ? first : (first as { embedding?: unknown } | undefined)?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("El modelo de embeddings devolvió un vector inválido");
  }
  return vector;
};

const namespaceFor = (source: string, target: string) => `${source}-${target}`;

export const indexGlossary = async (ai: AiBinding, index: VectorizeIndex, entry: GlossaryEntry) => {
  const values = await embeddingFor(ai, embeddingText(entry));
  await index.upsert([{ id: entry.id, values, namespace: namespaceFor(entry.sourceLanguage, entry.targetLanguage) }]);
};

export const removeGlossaryIndex = (index: VectorizeIndex, id: string) => index.deleteByIds([id]);

const letterOrNumber = /[\p{L}\p{N}]/u;

export const containsSourceTerm = (text: string, term: string): boolean => {
  const haystack = text.normalize("NFC").toLocaleLowerCase();
  const needle = term.normalize("NFC").toLocaleLowerCase();
  let offset = 0;
  while (offset < haystack.length) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) return false;
    const end = start + needle.length;
    if ((start === 0 || !letterOrNumber.test(haystack[start - 1])) &&
      (end === haystack.length || !letterOrNumber.test(haystack[end]))) return true;
    offset = start + 1;
  }
  return false;
};

type RetrievalInput = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export const createGlossaryRetriever = (db: D1Database, index: VectorizeIndex, ai: AiBinding) =>
  RunnableLambda.from<RetrievalInput, Document[]>(async ({ text, sourceLanguage, targetLanguage }) => {
    const query = sourceLanguage === "auto"
      ? `SELECT ${columns} FROM glossary_entries WHERE target_language = ? LIMIT ?`
      : `SELECT ${columns} FROM glossary_entries WHERE source_language = ? AND target_language = ? LIMIT ?`;
    const statement = db.prepare(query);
    const result = sourceLanguage === "auto"
      ? await statement.bind(targetLanguage, MAX_GLOSSARY_ENTRIES).all<GlossaryRow>()
      : await statement.bind(sourceLanguage, targetLanguage, MAX_GLOSSARY_ENTRIES).all<GlossaryRow>();
    const candidates = result.results.map(fromRow).filter((entry) => containsSourceTerm(text, entry.sourceTerm));
    if (candidates.length === 0) return [];

    const keyFor = (entry: GlossaryEntry) => `${entry.sourceLanguage}:${entry.sourceTerm.toLocaleLowerCase()}`;
    const counts = new Map<string, number>();
    for (const entry of candidates) counts.set(keyFor(entry), (counts.get(keyFor(entry)) ?? 0) + 1);
    let scores = new Map<string, number>();
    // Exact-match retrieval is enough for one sense. The vector index only disambiguates multiple senses.
    if ([...counts.values()].some((count) => count > 1) && sourceLanguage !== "auto") {
      try {
        const vector = await embeddingFor(ai, text.slice(0, 1000));
        const found = await index.query(vector, {
          namespace: namespaceFor(sourceLanguage, targetLanguage), topK: 50,
        });
        scores = new Map(found.matches.map((match) => [match.id, match.score]));
      } catch {
        // Ambiguous terms are skipped rather than applying an arbitrary preference.
      }
    }

    const seenTerms = new Set<string>();
    return [...candidates].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1)).filter((entry) => {
      const key = keyFor(entry);
      if (seenTerms.has(key)) return false;
      if ((counts.get(key) ?? 0) > 1 && !scores.has(entry.id)) return false;
      seenTerms.add(key);
      return true;
    }).slice(0, 4).map((entry) => new Document({
      pageContent: embeddingText(entry),
      metadata: {
        id: entry.id,
        sourceTerm: entry.sourceTerm,
        preferredTranslation: entry.preferredTranslation,
        domain: entry.domain,
      } satisfies GlossaryMatch,
    }));
  });

export const matchesFromDocuments = (documents: Document[]): GlossaryMatch[] => documents.map((document) => ({
  id: String(document.metadata.id),
  sourceTerm: String(document.metadata.sourceTerm),
  preferredTranslation: String(document.metadata.preferredTranslation),
  domain: String(document.metadata.domain),
}));
