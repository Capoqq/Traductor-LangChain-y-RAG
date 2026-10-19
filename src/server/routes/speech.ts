import { Hono } from "hono";
import { synthesizeRequestSchema } from "../../shared/contracts";
import { WorkersAISpeechToTextProvider, WorkersAITextToSpeechProvider } from "../providers/workers-ai";
import type { Env, Variables } from "../types";
import { PayloadTooLargeError, readJsonBody } from "../middleware/body";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO = ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4"];
const LIVE_LANGUAGES = new Set(["multi", "es", "en", "fr", "de", "pt"]);
const TRANSCRIPTION_LANGUAGES = new Set(["auto", "es", "en", "fr", "de", "pt"]);

const liveLanguageFor = (language: string | undefined) => {
  if (!language || language === "auto") return "multi";
  return LIVE_LANGUAGES.has(language) ? language : undefined;
};

const readAudioBody = async (request: Request) => {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new RangeError("AUDIO_TOO_LARGE");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
};

const isSongWav = (audio: ArrayBuffer) => {
  if (audio.byteLength < 46) return false;
  const view = new DataView(audio);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(audio, offset, 4));
  const dataBytes = view.getUint32(40, true);
  return tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data"
    && view.getUint32(4, true) + 8 === audio.byteLength
    && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === 1
    && view.getUint16(22, true) === 1
    && view.getUint32(24, true) === 16_000
    && view.getUint16(34, true) === 16
    && dataBytes > 0 && dataBytes <= 30 * 16_000 * 2
    && dataBytes + 44 === audio.byteLength;
};

export const speechRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/speech/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: { code: "WEBSOCKET_REQUIRED", message: "Esta ruta requiere una conexión WebSocket", requestId: c.get("requestId") } }, 426);
    }
    const language = liveLanguageFor(c.req.query("language"));
    if (!language) {
      return c.json({ error: { code: "INVALID_LANGUAGE", message: "Idioma de voz no admitido", requestId: c.get("requestId") } }, 400);
    }
    try {
      const response = await c.env.AI.run("@cf/deepgram/nova-3", {
        encoding: "linear16",
        sample_rate: "16000",
        language,
        interim_results: "true",
        endpointing: "500",
        vad_events: "true",
        punctuate: "true",
        smart_format: "true",
      }, { websocket: true });
      if (!(response instanceof Response)) throw new Error("Workers AI no inició la sesión de voz en vivo");
      if (response.status !== 101) {
        const detail = await response.text().catch(() => "Sin detalle disponible");
        console.error(JSON.stringify({
          event: "live_speech.upstream_rejected",
          requestId: c.get("requestId"),
          status: response.status,
          detail,
        }));
        return c.json({ error: { code: "LIVE_SPEECH_REJECTED", message: "Workers AI rechazó la sesión de voz en vivo", requestId: c.get("requestId"), retryable: false } }, 502);
      }
      return response;
    } catch (error) {
      console.error(JSON.stringify({
        event: "live_speech.connection_failed",
        requestId: c.get("requestId"),
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: { code: "LIVE_SPEECH_UNAVAILABLE", message: "No se pudo iniciar la voz en vivo", requestId: c.get("requestId"), retryable: true } }, 502);
    }
  })
  .post("/speech/transcribe", async (c) => {
    const mode = c.req.query("mode");
    if (mode && mode !== "song") {
      return c.json({ error: { code: "INVALID_MODE", message: "Modo de transcripción inválido", requestId: c.get("requestId") } }, 400);
    }
    const language = c.req.query("language") ?? "auto";
    if (!TRANSCRIPTION_LANGUAGES.has(language)) {
      return c.json({ error: { code: "INVALID_LANGUAGE", message: "Idioma de transcripción inválido", requestId: c.get("requestId") } }, 400);
    }
    const contentType = (c.req.header("content-type") ?? "").split(";")[0].toLowerCase();
    const songMode = mode === "song";
    if (songMode && contentType !== "audio/wav") {
      return c.json({ error: { code: "UNSUPPORTED_AUDIO", message: "El modo canciones requiere WAV", requestId: c.get("requestId") } }, 415);
    }
    const declaredLength = Number(c.req.header("content-length") ?? 0);
    if (!ALLOWED_AUDIO.includes(contentType)) {
      return c.json({ error: { code: "UNSUPPORTED_AUDIO", message: "Formato de audio no admitido", requestId: c.get("requestId") } }, 415);
    }
    if (declaredLength > MAX_AUDIO_BYTES) {
      return c.json({ error: { code: "AUDIO_TOO_LARGE", message: "El audio supera 8 MB", requestId: c.get("requestId") } }, 413);
    }
    let audio: ArrayBuffer;
    try {
      audio = await readAudioBody(c.req.raw);
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: { code: "AUDIO_TOO_LARGE", message: "El audio supera 8 MB", requestId: c.get("requestId") } }, 413);
      throw error;
    }
    if (!audio.byteLength) {
      return c.json({ error: { code: "INVALID_AUDIO", message: "El audio está vacío", requestId: c.get("requestId") } }, 413);
    }
    if (songMode && !isSongWav(audio)) {
      return c.json({ error: { code: "INVALID_AUDIO", message: "Fragmento WAV de canción inválido", requestId: c.get("requestId") } }, 400);
    }
    const provider = new WorkersAISpeechToTextProvider(c.env.AI, c.env.STT_MODEL ?? "@cf/openai/whisper-large-v3-turbo");
    const result = await provider.transcribe(audio, contentType, language, songMode ? { vadFilter: false, allowEmpty: true } : undefined);
    return c.json({ requestId: c.get("requestId"), ...result });
  })
  .post("/speech/synthesize", async (c) => {
    const requestType = (c.req.header("content-type") ?? "").split(";")[0].toLowerCase();
    if (requestType !== "application/json") return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json", requestId: c.get("requestId") } }, 415);
    let rawBody: unknown;
    try {
      rawBody = await readJsonBody(c.req.raw, 8 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "La solicitud supera el límite permitido", requestId: c.get("requestId") } }, 413);
      throw error;
    }
    const parsed = synthesizeRequestSchema.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: { code: "INVALID_REQUEST", message: "Texto o idioma TTS inválido", requestId: c.get("requestId") } }, 400);
    const provider = new WorkersAITextToSpeechProvider(c.env.AI);
    const response = await provider.synthesize(parsed.data.text, parsed.data.language);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", headers.get("content-type") ?? "audio/mpeg");
    return new Response(response.body, { status: response.status, headers });
  });
