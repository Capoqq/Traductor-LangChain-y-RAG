import type { TranslateRequest, TranslationResponse } from "../../shared/contracts";
import type { GlossaryEntry, GlossaryInput } from "../../shared/glossary";

const parseError = async (response: Response) => {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "La solicitud no pudo completarse";
};

export const translate = async (request: TranslateRequest, signal?: AbortSignal): Promise<TranslationResponse> => {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
};

export const streamTranslation = async (
  request: TranslateRequest,
  onStage: (stage: string) => void,
  signal?: AbortSignal,
): Promise<TranslationResponse> => {
  const response = await fetch("/api/translate/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(await parseError(response));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TranslationResponse | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      if (event === "graph.node.completed") {
        const node = (JSON.parse(data) as { node: string }).node;
        onStage(node);
      }
      if (event === "translation.completed") result = JSON.parse(data) as TranslationResponse;
      if (event === "session.error") throw new Error("La traducción en streaming falló");
    }
  }
  if (!result) throw new Error("El stream terminó sin resultado");
  return result;
};

export const transcribe = async (audio: Blob, language: string, signal?: AbortSignal, mode?: "song") => {
  const response = await fetch("/api/speech/transcribe?language=" + encodeURIComponent(language) + (mode === "song" ? "&mode=song" : ""), {
    method: "POST",
    headers: { "content-type": audio.type || "application/octet-stream" },
    body: audio,
    signal,
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ text: string; detectedLanguage?: string }>;
};

export const synthesize = async (text: string, language: "es" | "en", signal?: AbortSignal) => {
  const response = await fetch("/api/speech/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, language }),
    signal,
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.blob();
};

export const listGlossaryEntries = async (): Promise<GlossaryEntry[]> => {
  const response = await fetch("/api/glossary", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { entries: GlossaryEntry[] }).entries;
};

export const saveGlossaryEntry = async (input: GlossaryInput, id?: string): Promise<GlossaryEntry> => {
  const response = await fetch(id ? `/api/glossary/${encodeURIComponent(id)}` : "/api/glossary", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { entry: GlossaryEntry }).entry;
};

export const deleteGlossaryEntry = async (id: string): Promise<void> => {
  const response = await fetch(`/api/glossary/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await parseError(response));
};

export const getSessionContextCount = async (sessionId: string, sourceLanguage: string, targetLanguage: string): Promise<number> => {
  const query = new URLSearchParams({ sessionId, sourceLanguage, targetLanguage });
  const response = await fetch(`/api/session/context?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { count: number }).count;
};

export const clearSessionContext = async (sessionId: string): Promise<void> => {
  const response = await fetch("/api/session/context", {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error(await parseError(response));
};
