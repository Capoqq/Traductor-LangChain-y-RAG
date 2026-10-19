import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/server/index";
import { encodeSongSegment } from "../src/client/services/song-audio";

const env = {
  AI: { run: async () => ({ choices: [{ message: { content: "Hello 42" } }] }) },
  APP_ENV: "test",
  APP_ACCESS_PASSWORD: "unit-test-password-for-endpoint-checks-2026",
  TRANSLATION_MODEL: "@cf/zai-org/glm-4.7-flash",
};

let cookie = "";

beforeAll(async () => {
  const response = await app.request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: env.APP_ACCESS_PASSWORD }),
  }, env);
  expect(response.status).toBe(200);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
});

describe("Hono API", () => {
  it("reports health without inference", async () => {
    const response = await app.request("/api/health", { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("validates translate requests", async () => {
    const response = await app.request("/api/translate", {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}",
    }, env);
    expect(response.status).toBe(400);
  });

  it("requires a valid session and tooling for automatic context", async () => {
    const response = await app.request("/api/translate", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "Hello", targetLanguage: "es", useSessionContext: true, sessionId: "invalid" }),
    }, env);
    expect(response.status).toBe(400);
  });

  it("reports session context as unavailable without D1", async () => {
    const response = await app.request("/api/session/context?sessionId=8bf55e95-d192-477f-93dc-c847eac6433b&sourceLanguage=en&targetLanguage=es", {
      headers: { cookie },
    }, env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_CONTEXT_UNAVAILABLE" } });
  });

  it("reports an unconfigured glossary without affecting translation routes", async () => {
    const response = await app.request("/api/glossary", { headers: { cookie } }, env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "GLOSSARY_NOT_CONFIGURED" } });
  });

  it("rejects unsupported audio before inference", async () => {
    const response = await app.request("/api/speech/transcribe", {
      method: "POST", headers: { "content-type": "text/plain", cookie }, body: "not audio",
    }, env);
    expect(response.status).toBe(415);
  });

  it("rejects malformed song chunks before inference", async () => {
    const response = await app.request("/api/speech/transcribe?mode=song", {
      method: "POST", headers: { "content-type": "audio/wav", cookie }, body: "not a wav",
    }, env);
    expect(response.status).toBe(400);
  });

  it("transcribes a valid song chunk without VAD", async () => {
    const samples = new Float32Array(16_000);
    const wav = encodeSongSegment({ length: samples.length, sampleRate: 16_000, numberOfChannels: 1, getChannelData: () => samples }, { startSeconds: 0, endSeconds: 1 });
    let input: Record<string, unknown> = {};
    const response = await app.request("/api/speech/transcribe?language=auto&mode=song", {
      method: "POST", headers: { "content-type": "audio/wav", cookie }, body: wav,
    }, { ...env, AI: { async run(_model, value) {
      input = value as Record<string, unknown>;
      return { text: "Hello", transcription_info: { language: "en" } };
    } } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "Hello", detectedLanguage: "en" });
    expect(input.vad_filter).toBe(false);
  });
});
