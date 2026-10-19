import { describe, expect, it } from "vitest";
import seed from "../data/glossary-starter.json";
import { glossaryInputSchema } from "../src/shared/glossary";

describe("glossary starter data", () => {
  it("has valid, non-duplicated entries in both directions", () => {
    const keys = new Set<string>();
    for (const pair of seed.pairs) {
      expect(pair.concept).toMatch(/^\d+$/);
      for (const [sourceLanguage, targetLanguage, sourceTerm, preferredTranslation] of [
        ["en", "es", pair.en, pair.es], ["es", "en", pair.es, pair.en],
      ]) {
        expect(glossaryInputSchema.safeParse({ sourceLanguage, targetLanguage, sourceTerm, preferredTranslation, domain: "tecnología e IA" }).success).toBe(true);
        const key = `${sourceLanguage}:${targetLanguage}:${sourceTerm.toLowerCase()}`;
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
    expect(keys.size).toBe(22);
  });
});
