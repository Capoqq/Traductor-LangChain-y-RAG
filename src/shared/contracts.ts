import { z } from "zod";
import type { GlossaryChoice, GlossaryMatch, GlossarySense } from "./glossary";

export const toneSchema = z.enum(["neutral", "formal", "informal", "concise"]);
export const languageSchema = z.enum(["auto", "es", "en", "fr", "de", "pt"]);
export const targetLanguageSchema = z.enum(["es", "en", "fr", "de", "pt"]);

export const translateRequestSchema = z.object({
  requestId: z.string().min(1).max(100).optional(),
  sessionId: z.string().min(1).max(100).optional(),
  text: z.string().trim().min(1).max(5000),
  sourceLanguage: languageSchema.default("auto"),
  targetLanguage: targetLanguageSchema,
  tone: toneSchema.default("neutral"),
  context: z.array(z.string().max(500)).max(8).default([]),
  voiceOptimized: z.boolean().default(false),
  useGlossary: z.boolean().default(false),
  useTooling: z.boolean().default(false),
  useSessionContext: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.useSessionContext && (!value.useTooling || value.voiceOptimized || !value.sessionId || !z.uuid().safeParse(value.sessionId).success)) {
    ctx.addIssue({ code: "custom", message: "El contexto de sesión requiere Herramientas IA y un identificador de sesión válido.", path: ["sessionId"] });
  }
});

export const synthesizeRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  language: z.enum(["es", "en"]),
});

export type TranslateRequest = z.input<typeof translateRequestSchema>;
export type TranslationResponse = {
  requestId: string;
  sessionId: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  detectedLanguage: string;
  validation: { valid: boolean; status: "valid" | "needs_refinement" | "exhausted"; reasons: string[] };
  retryCount: number;
  processingTimes: Record<string, number>;
  glossaryMatches: GlossaryMatch[];
  termSenses: GlossarySense[];
  glossaryChoices: GlossaryChoice[];
  toolsUsed: string[];
  rememberedSegments: number;
};

export type ApiError = {
  error: { code: string; message: string; requestId?: string; retryable?: boolean };
};

export type RealtimeEvent =
  | { type: "session.started"; sessionId: string; timestamp: number }
  | { type: "session.stopped"; sessionId: string; timestamp: number }
  | { type: "transcript.partial" | "transcript.final"; sessionId: string; segmentId: string; sequence: number; text: string; timestamp: number }
  | { type: "translation.started"; sessionId: string; segmentId: string; sequence: number; timestamp: number }
  | { type: "translation.completed"; sessionId: string; segmentId: string; sequence: number; text: string; timestamp: number }
  | { type: "speech.started" | "playback.completed"; sessionId: string; segmentId: string; sequence: number; timestamp: number }
  | { type: "speech.ready"; sessionId: string; segmentId: string; sequence: number; audioUrl: string; timestamp: number }
  | { type: "session.error"; sessionId: string; message: string; timestamp: number };
