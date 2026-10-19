import { describe, expect, it } from "vitest";
import { extractGeneratedText, WorkersAISpeechToTextProvider, WorkersAITranslationProvider } from "../src/server/providers/workers-ai";

describe("Workers AI response parsing", () => {
  it("parses legacy response shape", () => {
    expect(extractGeneratedText({ response: "Hello" })).toBe("Hello");
  });

  it("parses Chat Completions shape used by GLM", () => {
    expect(extractGeneratedText({ choices: [{ message: { content: "Hola" } }] })).toBe("Hola");
  });

  it("uses the dedicated translation model with explicit language codes", async () => {
    const calls: Array<{ model: string; input: unknown }> = [];
    const provider = new WorkersAITranslationProvider({
      async run(model, input) {
        calls.push({ model, input });
        return { translated_text: "Good morning" };
      },
    });
    expect(await provider.translateFast("Buenos días", "es", "en")).toBe("Good morning");
    expect(calls).toEqual([{
      model: "@cf/meta/m2m100-1.2b",
      input: { text: "Buenos días", source_lang: "es", target_lang: "en" },
    }]);
  });

  it("disables VAD and tolerates instrumental-only song chunks", async () => {
    const calls: unknown[] = [];
    const provider = new WorkersAISpeechToTextProvider({
      async run(_model, input) {
        calls.push(input);
        return { text: "", transcription_info: { language: "en" } };
      },
    });
    const result = await provider.transcribe(new Uint8Array([1, 2, 3]).buffer, "audio/wav", "auto", { vadFilter: false, allowEmpty: true });
    expect(result.text).toBe("");
    expect(result.detectedLanguage).toBe("en");
    expect(calls[0]).toMatchObject({ task: "transcribe", vad_filter: false });
  });
});
