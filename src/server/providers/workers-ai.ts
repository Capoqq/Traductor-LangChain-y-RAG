import type { AiBinding } from "../types";
import type { ModelMessage, SpeechToTextProvider, TextToSpeechProvider, TranslationProvider } from "./contracts";

export const extractGeneratedText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.translated_text === "string") return record.translated_text;
  if (typeof record.response === "string") return record.response;
  if (typeof record.result === "string") return record.result;
  if (typeof record.text === "string") return record.text;
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
    if (typeof first?.text === "string") return first.text;
  }
  return "";
};

const abortable = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
};

export class WorkersAITranslationProvider implements TranslationProvider {
  constructor(private readonly ai: AiBinding, public readonly model = "@cf/zai-org/glm-4.7-flash") {}

  async selectTools(messages: ModelMessage[], tools: unknown[], options?: { signal?: AbortSignal }): Promise<unknown> {
    return abortable(this.ai.run(this.model, {
      messages, tools, tool_choice: "auto", parallel_tool_calls: false,
      temperature: 0, max_completion_tokens: 256, stream: false,
    }, { rejectIfBusy: true }), options?.signal);
  }

  async generate(messages: ModelMessage[], options?: { signal?: AbortSignal }): Promise<string> {
    const output = await abortable(this.ai.run(this.model, {
      messages,
      temperature: 0.1,
      max_tokens: 2048,
      stream: false,
    }, { rejectIfBusy: true }), options?.signal);
    const text = extractGeneratedText(output).trim();
    if (!text) throw new Error("El modelo no devolvió texto");
    return text;
  }

  async translateFast(text: string, sourceLanguage: string, targetLanguage: string, options?: { signal?: AbortSignal }): Promise<string> {
    const output = await abortable(this.ai.run("@cf/meta/m2m100-1.2b", {
      text,
      source_lang: sourceLanguage,
      target_lang: targetLanguage,
    }), options?.signal);
    const translated = extractGeneratedText(output).trim();
    if (!translated) throw new Error("El modelo de traducción no devolvió texto");
    return translated;
  }
}

const audioToBase64 = (audio: ArrayBuffer) => {
  const bytes = new Uint8Array(audio);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export class WorkersAISpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly ai: AiBinding, public readonly model = "@cf/openai/whisper-large-v3-turbo") {}

  async transcribe(audio: ArrayBuffer, _contentType: string, language?: string, options?: { vadFilter?: boolean; allowEmpty?: boolean }) {
    const started = Date.now();
    const output = await this.ai.run(this.model, {
      audio: audioToBase64(audio),
      task: "transcribe",
      language: language === "auto" ? undefined : language,
      vad_filter: options?.vadFilter ?? true,
    });
    const text = extractGeneratedText(output).trim();
    if (!text && !options?.allowEmpty) throw new Error("No se detectó voz en el audio");
    const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
    const transcriptionInfo = record.transcription_info && typeof record.transcription_info === "object"
      ? record.transcription_info as Record<string, unknown> : {};
    const detectedLanguage = typeof transcriptionInfo.language === "string" ? transcriptionInfo.language
      : typeof record.language === "string" ? record.language : undefined;
    return { text, detectedLanguage, durationMs: Date.now() - started };
  }
}

export class WorkersAITextToSpeechProvider implements TextToSpeechProvider {
  constructor(private readonly ai: AiBinding) {}

  supports(language: string) {
    return language === "es" || language === "en";
  }

  async synthesize(text: string, language: "es" | "en"): Promise<Response> {
    const model = language === "es" ? "@cf/deepgram/aura-2-es" : "@cf/deepgram/aura-2-en";
    const speaker = language === "es" ? "aquila" : "luna";
    const audio = await this.ai.run(model, { text, speaker, encoding: "mp3" });
    if (audio instanceof Response) return audio;
    if (audio instanceof ReadableStream) return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
    if (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) {
      return new Response(audio as BodyInit, { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error("Formato TTS inesperado");
  }
}
