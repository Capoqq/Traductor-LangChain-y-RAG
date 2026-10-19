import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { languageSchema, targetLanguageSchema, toneSchema } from "../../shared/contracts";
import type { GlossaryMatch, GlossarySense } from "../../shared/glossary";

export const validationResultSchema = z.object({
  valid: z.boolean(),
  status: z.enum(["valid", "needs_refinement", "exhausted"]),
  reasons: z.array(z.string()),
});

export const TranslationState = new StateSchema({
  requestId: z.string(),
  sessionId: z.string(),
  originalText: z.string(),
  sourceLanguage: languageSchema,
  targetLanguage: targetLanguageSchema,
  detectedLanguage: languageSchema.optional(),
  tone: toneSchema.default("neutral"),
  context: z.array(z.string()).default(() => []),
  contextNeeded: z.boolean().default(false),
  useGlossary: z.boolean().default(false),
  useTooling: z.boolean().default(false),
  glossaryMatches: z.array(z.custom<GlossaryMatch>()).default(() => []),
  termSenses: z.array(z.custom<GlossarySense>()).default(() => []),
  toolsUsed: z.array(z.string()).default(() => []),
  translatedText: z.string().default(""),
  validationResult: validationResultSchema.optional(),
  retryCount: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().min(0).max(2).default(1),
  processingTimes: new ReducedValue(
    z.record(z.string(), z.number().nonnegative()).default(() => ({})),
    { reducer: (current, update) => ({ ...current, ...update }) },
  ),
  errors: new ReducedValue(
    z.array(z.object({ node: z.string(), code: z.string(), message: z.string() })).default(() => []),
    { reducer: (current, update) => current.concat(update) },
  ),
});

export type TranslationGraphState = typeof TranslationState.State;
