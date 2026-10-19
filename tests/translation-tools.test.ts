import { describe, expect, it } from "vitest";
import { runTranslationTools } from "../src/server/tools/translation-tools";
import type { ModelMessage, TranslationProvider } from "../src/server/providers/contracts";

class ToolProvider implements TranslationProvider {
  readonly model = "fake";
  seenTools: unknown[] = [];
  seenMessages: ModelMessage[] = [];
  constructor(private readonly calls: unknown) {}
  async generate(messages: ModelMessage[]) { this.seenMessages = messages; return ""; }
  async selectTools(messages: ModelMessage[], tools: unknown[]) {
    this.seenMessages = messages;
    this.seenTools = tools;
    return this.calls;
  }
}

const input = {
  text: "The charge appeared twice", sourceLanguage: "en", targetLanguage: "es",
  context: ["The card was billed yesterday"], useGlossary: true,
};

describe("translation tooling", () => {
  it("executes only the model-selected, scoped read tools", async () => {
    const provider = new ToolProvider({ choices: [{ message: { tool_calls: [
      { function: { name: "search_glossary", arguments: "{}" } },
      { function: { name: "read_context", arguments: "{}" } },
    ] } }] });
    const lookups: unknown[] = [];
    const result = await runTranslationTools(provider, {
      ...input,
      glossaryLookup: async (request) => {
        lookups.push(request);
        return [{ id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos" }];
      },
    });
    expect(result.toolsUsed).toEqual(["search_glossary", "read_context"]);
    expect(result.glossaryMatches[0].preferredTranslation).toBe("cobro");
    expect(result.context).toEqual(input.context);
    expect(lookups).toEqual([{ text: input.text, sourceLanguage: "en", targetLanguage: "es" }]);
  });

  it("ignores unknown calls and never exposes glossary without the configured lookup", async () => {
    const provider = new ToolProvider({ tool_calls: [
      { name: "delete_glossary" }, { name: "search_glossary" }, { name: "read_context" },
    ] });
    const result = await runTranslationTools(provider, { ...input, glossaryLookup: undefined });
    expect(result.toolsUsed).toEqual(["read_context"]);
    expect(result.glossaryMatches).toEqual([]);
    expect(provider.seenTools).toHaveLength(1);
  });

  it("validates a term argument and passes candidate senses to translation", async () => {
    const provider = new ToolProvider({ choices: [{ message: { tool_calls: [
      { function: { name: "search_glossary", arguments: "{}" } },
      { function: { name: "disambiguate_term", arguments: '{"term":"charge"}' } },
    ] } }] });
    const result = await runTranslationTools(provider, {
      ...input,
      glossaryLookup: async () => [{ id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos" }],
      senseLookup: async ({ term }) => {
        expect(term).toBe("charge");
        return [
          { id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos", example: "Card charge", notes: "Money" },
          { id: "battery", sourceTerm: "charge", preferredTranslation: "carga", domain: "baterías", example: "Battery charge", notes: "Energy" },
        ];
      },
    });
    expect(result.toolsUsed).toEqual(["search_glossary", "disambiguate_term"]);
    expect(result.termSenses).toHaveLength(2);
    expect(result.glossaryMatches).toEqual([]);
  });

  it("skips malformed model arguments without running the sense lookup", async () => {
    const provider = new ToolProvider({ tool_calls: [{ name: "disambiguate_term", arguments: { term: "charge", extra: true } }] });
    const result = await runTranslationTools(provider, { ...input, senseLookup: async () => { throw new Error("Should not run"); } });
    expect(result.toolsUsed).toEqual([]);
  });
});
