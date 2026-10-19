import { describe, expect, it } from "vitest";
import { glossaryInputSchema } from "../src/shared/glossary";
import { containsSourceTerm, createGlossaryRetriever, findGlossarySenses, findMatchingGlossarySenses, matchesFromDocuments } from "../src/server/services/glossary";
import type { AiBinding } from "../src/server/types";

const rows = [
  {
    id: "billing", source_language: "en", target_language: "es", source_term: "charge",
    preferred_translation: "cobro", domain: "pagos", example: "The charge appeared twice.",
    notes: "Money on a card", created_at: "2026-01-01", updated_at: "2026-01-01",
  },
  {
    id: "battery", source_language: "en", target_language: "es", source_term: "charge",
    preferred_translation: "carga", domain: "baterías", example: "The battery charge is low.",
    notes: "Battery energy", created_at: "2026-01-01", updated_at: "2026-01-01",
  },
];

const fakeDb = (results = rows) => ({
  prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }),
}) as unknown as D1Database;

describe("glossary retrieval", () => {
  it("validates distinct language pairs", () => {
    expect(glossaryInputSchema.safeParse({
      sourceLanguage: "en", targetLanguage: "en", sourceTerm: "charge", preferredTranslation: "cobro",
    }).success).toBe(false);
  });

  it("matches whole Unicode terms but not substrings", () => {
    expect(containsSourceTerm("The charge appeared twice", "charge")).toBe(true);
    expect(containsSourceTerm("A recharged battery", "charge")).toBe(false);
    expect(containsSourceTerm("Un café caliente", "café")).toBe(true);
  });

  it("returns candidate senses only for a term present in the source", async () => {
    const senses = await findGlossarySenses(fakeDb(), {
      text: "The charge appeared twice", term: "charge", sourceLanguage: "en", targetLanguage: "es",
    });
    expect(senses.map((sense) => sense.preferredTranslation)).toEqual(["cobro", "carga"]);
    expect(senses[0].example).toContain("appeared twice");
    expect(await findGlossarySenses(fakeDb(), {
      text: "A recharged battery", term: "charge", sourceLanguage: "en", targetLanguage: "es",
    })).toEqual([]);
  });

  it("exposes ambiguous senses for explanation even when no tool was selected", async () => {
    const senses = await findMatchingGlossarySenses(fakeDb(), {
      text: "The charge appeared twice", sourceLanguage: "en", targetLanguage: "es",
    });
    expect(senses.map((sense) => sense.preferredTranslation)).toEqual(["cobro", "carga"]);
    expect(await findMatchingGlossarySenses(fakeDb(), {
      text: "The charger failed", sourceLanguage: "en", targetLanguage: "es",
    })).toEqual([]);
  });

  it("skips embeddings when no glossary term occurs", async () => {
    const ai = { run: async () => { throw new Error("Should not embed"); } } as AiBinding;
    const index = { query: async () => { throw new Error("Should not query"); } } as unknown as VectorizeIndex;
    const retriever = createGlossaryRetriever(fakeDb(), index, ai);
    expect(await retriever.invoke({ text: "Hello world", sourceLanguage: "en", targetLanguage: "es" })).toEqual([]);
  });

  it("uses vector ranking to choose a sense and returns LangChain documents", async () => {
    let embedded = "";
    const ai = { run: async (_model: string, input: unknown) => {
      embedded = (input as { text: string[] }).text[0];
      return { data: [Array(1024).fill(0.1)] };
    } } as AiBinding;
    const index = { query: async (_vector: number[], options: { namespace: string }) => {
      expect(options.namespace).toBe("en-es");
      return { matches: [{ id: "battery", score: 0.8 }, { id: "billing", score: 0.9 }] };
    } } as unknown as VectorizeIndex;
    const retriever = createGlossaryRetriever(fakeDb(), index, ai);
    const docs = await retriever.invoke({ text: "The charge appeared twice", sourceLanguage: "en", targetLanguage: "es" });
    expect(embedded).toBe("The charge appeared twice");
    expect(matchesFromDocuments(docs)).toEqual([{
      id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos",
    }]);
  });

  it("does not pick an arbitrary sense if vector search is unavailable", async () => {
    const ai = { run: async () => { throw new Error("Embedding unavailable"); } } as AiBinding;
    const index = { query: async () => ({ matches: [] }) } as unknown as VectorizeIndex;
    const retriever = createGlossaryRetriever(fakeDb(), index, ai);
    expect(await retriever.invoke({ text: "The charge appeared twice", sourceLanguage: "en", targetLanguage: "es" })).toEqual([]);
  });
});
