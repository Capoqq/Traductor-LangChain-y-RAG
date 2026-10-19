import { describe, expect, it } from "vitest";
import { validateTranslation } from "../src/server/graph/validation";
import type { TranslationGraphState } from "../src/server/graph/state";

const state = (overrides: Partial<TranslationGraphState> = {}) => ({
  requestId: "request-1", sessionId: "session-1", originalText: "Pedido 42 para {name}",
  sourceLanguage: "es", targetLanguage: "en", detectedLanguage: "es", tone: "neutral",
  context: [], useGlossary: false, glossaryMatches: [], translatedText: "Order 42 for {name}", retryCount: 0, maxRetries: 1,
  processingTimes: {}, errors: [], ...overrides,
}) as TranslationGraphState;

describe("validateTranslation", () => {
  it("acepta una traducción que conserva tokens", () => {
    expect(validateTranslation(state()).valid).toBe(true);
  });

  it("detecta números y placeholders perdidos", () => {
    expect(validateTranslation(state({ translatedText: "Your order" })).reasons)
      .toEqual(expect.arrayContaining([expect.stringContaining("missing_protected_tokens")]));
  });

  it("marca agotamiento sin crear ciclos infinitos", () => {
    expect(validateTranslation(state({ translatedText: "", retryCount: 1 })).status).toBe("exhausted");
  });

  it("marca una preferencia de glosario no respetada", () => {
    expect(validateTranslation(state({
      originalText: "The charge appeared twice", translatedText: "El cargo apareció dos veces",
      glossaryMatches: [{ id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos" }],
    })).reasons).toContain("missing_glossary_term:billing");
  });
});
