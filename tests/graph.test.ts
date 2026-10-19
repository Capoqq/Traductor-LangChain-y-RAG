import { describe, expect, it } from "vitest";
import { buildTranslationGraph } from "../src/server/graph/graph";
import type { ModelMessage, TranslationProvider } from "../src/server/providers/contracts";

class FakeProvider implements TranslationProvider {
  readonly model = "fake";
  calls: ModelMessage[][] = [];
  selectTools?: TranslationProvider["selectTools"];
  translateFast?: (text: string, source: string, target: string) => Promise<string>;
  constructor(private readonly results: string[]) {}
  async generate(messages: ModelMessage[]) {
    this.calls.push(messages);
    return this.results.shift() ?? "";
  }
}

const input = {
  requestId: "r1", sessionId: "s1", originalText: "Hola pedido 42", sourceLanguage: "es" as const,
  targetLanguage: "en" as const, tone: "neutral" as const, context: [], translatedText: "",
  retryCount: 0, maxRetries: 1, processingTimes: {}, errors: [],
};

describe("translation graph", () => {
  it("recorre el camino feliz con una sola inferencia", async () => {
    const provider = new FakeProvider(["Hello order 42"]);
    const result = await buildTranslationGraph(provider).invoke(input, { recursionLimit: 12 });
    expect(result.translatedText).toBe("Hello order 42");
    expect(result.validationResult?.valid).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it("refina una salida inválida una sola vez", async () => {
    const provider = new FakeProvider(["Hello order", "Hello order 42"]);
    const result = await buildTranslationGraph(provider).invoke(input, { recursionLimit: 12 });
    expect(result.retryCount).toBe(1);
    expect(result.validationResult?.valid).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });

  it("omite la detección por modelo cuando el idioma es explícito", async () => {
    const provider = new FakeProvider(["Hello order 42"]);
    await buildTranslationGraph(provider).invoke(input, { recursionLimit: 12 });
    expect(provider.calls[0][0].content).toContain("translation engine");
  });

  it("uses fast translation for voice inside the graph", async () => {
    const provider = new FakeProvider([]);
    const fastCalls: string[] = [];
    provider.translateFast = async (text, source, target) => {
      fastCalls.push(`${source}:${target}:${text}`);
      return "Hello order 42";
    };
    const result = await buildTranslationGraph(provider, true).invoke(input, { recursionLimit: 12 });
    expect(result.translatedText).toBe("Hello order 42");
    expect(fastCalls).toEqual(["es:en:Hola pedido 42"]);
    expect(provider.calls).toHaveLength(0);
  });

  it("uses prior context only for a short ambiguous voice fragment", async () => {
    const provider = new FakeProvider(["It is now ready 42"]);
    provider.translateFast = async () => "It is ready 42";
    const result = await buildTranslationGraph(provider, true).invoke({
      ...input, originalText: "Esto está listo 42", context: ["El pedido => The order"],
    }, { recursionLimit: 12 });
    expect(result.translatedText).toBe("It is now ready 42");
    expect(result.retryCount).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0][1].content).toContain("El pedido => The order");
  });

  it("repairs an invalid fast voice translation once", async () => {
    const provider = new FakeProvider(["Hello order 42"]);
    provider.translateFast = async () => "Hello order";
    const result = await buildTranslationGraph(provider, true).invoke(input, { recursionLimit: 12 });
    expect(result.translatedText).toBe("Hello order 42");
    expect(result.validationResult?.valid).toBe(true);
    expect(result.retryCount).toBe(1);
  });

  it("keeps a valid fast result when contextual correction fails", async () => {
    const provider = new FakeProvider(["Broken output"]);
    provider.translateFast = async () => "It is ready 42";
    const result = await buildTranslationGraph(provider, true).invoke({
      ...input, originalText: "Esto está listo 42", context: ["El pedido => The order"],
    }, { recursionLimit: 12 });
    expect(result.translatedText).toBe("It is ready 42");
    expect(result.validationResult?.valid).toBe(true);
    expect(result.retryCount).toBe(1);
  });

  it("marks an unrepaired voice result as exhausted", async () => {
    const provider = new FakeProvider(["Still missing the number"]);
    provider.translateFast = async () => "Hello order";
    const result = await buildTranslationGraph(provider, true).invoke(input, { recursionLimit: 12 });
    expect(result.validationResult?.valid).toBe(false);
    expect(result.validationResult?.status).toBe("exhausted");
    expect(result.retryCount).toBe(1);
  });

  it("injects retrieved glossary data and validates the preferred term", async () => {
    const provider = new FakeProvider(["El cobro apareció dos veces"]);
    const result = await buildTranslationGraph(provider, false, async () => [{
      id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos",
    }]).invoke({
      ...input, originalText: "The charge appeared twice", sourceLanguage: "en", targetLanguage: "es",
      useGlossary: true,
    }, { recursionLimit: 12 });
    expect(result.glossaryMatches).toHaveLength(1);
    expect(result.validationResult?.valid).toBe(true);
    expect(provider.calls[0][1].content).toContain("cobro");
  });

  it("lets the model select glossary and context tools before translating", async () => {
    const provider = new FakeProvider(["El cobro apareció dos veces en el pedido 42"]);
    provider.selectTools = async () => ({ choices: [{ message: { tool_calls: [
      { function: { name: "search_glossary", arguments: "{}" } },
      { function: { name: "read_context", arguments: "{}" } },
    ] } }] });
    const result = await buildTranslationGraph(provider, false, async () => [{
      id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos",
    }]).invoke({ ...input, originalText: "The charge appeared twice on order 42", sourceLanguage: "en",
      targetLanguage: "es", context: ["The card was billed"], useGlossary: true, useTooling: true }, { recursionLimit: 12 });
    expect(result.toolsUsed).toEqual(["search_glossary", "read_context"]);
    expect(result.glossaryMatches).toHaveLength(1);
    expect(provider.calls[0][1].content).toContain("The card was billed");
    expect(result.validationResult?.valid).toBe(true);
  });

  it("offers ambiguous senses without requiring conflicting translations", async () => {
    const provider = new FakeProvider(["El cobro apareció dos veces en el pedido 42"]);
    provider.selectTools = async () => ({ choices: [{ message: { tool_calls: [
      { function: { name: "disambiguate_term", arguments: '{"term":"charge"}' } },
    ] } }] });
    const result = await buildTranslationGraph(provider, false, undefined, async () => [
      { id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos", example: "Card charge", notes: "Money" },
      { id: "battery", sourceTerm: "charge", preferredTranslation: "carga", domain: "baterías", example: "Battery charge", notes: "Energy" },
    ]).invoke({ ...input, originalText: "The charge appeared twice on order 42", sourceLanguage: "en",
      targetLanguage: "es", useGlossary: true, useTooling: true }, { recursionLimit: 12 });
    expect(result.termSenses).toHaveLength(2);
    expect(result.glossaryMatches).toEqual([]);
    expect(provider.calls[0][1].content).toContain("Battery charge");
    expect(result.validationResult?.valid).toBe(true);
  });
});
