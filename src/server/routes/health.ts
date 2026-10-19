import { Hono } from "hono";
import type { Env, Variables } from "../types";

export const healthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/health", (c) => c.json({
    status: "ok",
    service: "ai-live-translator",
    environment: c.env.APP_ENV ?? "development",
    timestamp: new Date().toISOString(),
  }))
  .get("/models", (c) => c.json({
    translation: {
      active: c.env.TRANSLATION_MODEL ?? "@cf/zai-org/glm-4.7-flash",
      alternatives: ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/google/gemma-4-26b-a4b-it"],
      streaming: false,
      graphProgressSse: true,
    },
    speechToText: {
      active: c.env.STT_MODEL ?? "@cf/openai/whisper-large-v3-turbo",
      realtimeCandidate: "@cf/deepgram/nova-3",
      realtimeEnabled: false,
    },
    textToSpeech: {
      es: "@cf/deepgram/aura-2-es",
      en: "@cf/deepgram/aura-2-en",
      supportedLanguages: ["es", "en"],
    },
  }));
