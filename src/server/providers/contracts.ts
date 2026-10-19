export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export interface TranslationProvider {
  readonly model: string;
  generate(messages: ModelMessage[], options?: { signal?: AbortSignal }): Promise<string>;
  selectTools?(messages: ModelMessage[], tools: unknown[], options?: { signal?: AbortSignal }): Promise<unknown>;
  translateFast?(text: string, sourceLanguage: string, targetLanguage: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface SpeechToTextProvider {
  readonly model: string;
  transcribe(audio: ArrayBuffer, contentType: string, language?: string, options?: { vadFilter?: boolean; allowEmpty?: boolean }): Promise<{ text: string; detectedLanguage?: string; durationMs?: number }>;
}

export interface TextToSpeechProvider {
  supports(language: string): boolean;
  synthesize(text: string, language: "es" | "en"): Promise<Response>;
}
