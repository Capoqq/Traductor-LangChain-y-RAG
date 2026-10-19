import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { translateRequestSchema, type TranslationResponse } from "../../shared/contracts";
import { buildTranslationGraph } from "../graph/graph";
import { createGlossaryRetriever, findGlossarySenses, findMatchingGlossarySenses, matchesFromDocuments } from "../services/glossary";
import { WorkersAITranslationProvider } from "../providers/workers-ai";
import type { Env, Variables } from "../types";
import { PayloadTooLargeError, readJsonBody } from "../middleware/body";
import { loadSessionContext, saveSessionContext } from "../services/session-context";
import { explainGlossaryChoices } from "../services/sense-choice";

type ParsedRequest = ReturnType<typeof translateRequestSchema.parse>;

const inputFor = (body: ParsedRequest, requestId: string, context = body.context) => ({
  requestId: body.requestId ?? requestId,
  sessionId: body.sessionId ?? crypto.randomUUID(),
  originalText: body.text,
  sourceLanguage: body.sourceLanguage,
  targetLanguage: body.targetLanguage,
  tone: body.tone,
  context,
  useGlossary: body.useGlossary,
  useTooling: body.useTooling,
  glossaryMatches: [],
  termSenses: [],
  toolsUsed: [],
  translatedText: "",
  retryCount: 0,
  maxRetries: 1,
  processingTimes: {},
  errors: [],
});

const responseFrom = (result: Record<string, unknown>): TranslationResponse => ({
  requestId: String(result.requestId),
  sessionId: String(result.sessionId),
  originalText: String(result.originalText),
  translatedText: String(result.translatedText),
  sourceLanguage: String(result.sourceLanguage),
  targetLanguage: String(result.targetLanguage),
  detectedLanguage: String(result.detectedLanguage),
  validation: result.validationResult as TranslationResponse["validation"],
  retryCount: Number(result.retryCount),
  processingTimes: result.processingTimes as Record<string, number>,
  glossaryMatches: result.glossaryMatches as TranslationResponse["glossaryMatches"] ?? [],
  termSenses: result.termSenses as TranslationResponse["termSenses"] ?? [],
  glossaryChoices: explainGlossaryChoices(String(result.translatedText ?? ""),
    result.glossaryMatches as TranslationResponse["glossaryMatches"] ?? [],
    result.termSenses as TranslationResponse["termSenses"] ?? []),
  toolsUsed: result.toolsUsed as string[] ?? [],
  rememberedSegments: Number(result.rememberedSegments ?? 0),
});

const sessionInputFor = async (body: ParsedRequest, requestId: string, env: Env) => {
  if (!body.useSessionContext) return inputFor(body, requestId);
  const remembered = await loadSessionContext(env.GLOSSARY_DB!, body.sessionId!, body.sourceLanguage, body.targetLanguage);
  return { ...inputFor(body, requestId, [...remembered, ...body.context].slice(-4)), rememberedSegments: remembered.length };
};

const saveConfirmed = async (body: ParsedRequest, result: Record<string, unknown>, env: Env) => {
  if (!body.useSessionContext || !(result.validationResult as { valid?: boolean } | undefined)?.valid) return;
  await saveSessionContext(env.GLOSSARY_DB!, {
    sessionId: body.sessionId!, sourceLanguage: body.sourceLanguage, targetLanguage: body.targetLanguage,
    sourceText: String(result.originalText), translatedText: String(result.translatedText),
  });
  result.rememberedSegments = (await loadSessionContext(env.GLOSSARY_DB!, body.sessionId!, body.sourceLanguage, body.targetLanguage)).length;
};

const enrichAmbiguousSenses = async (body: ParsedRequest, result: Record<string, unknown>, env: Env) => {
  if (!body.useGlossary || !env.GLOSSARY_DB) return;
  try {
    const senses = await findMatchingGlossarySenses(env.GLOSSARY_DB, {
      text: body.text, sourceLanguage: String(result.detectedLanguage ?? body.sourceLanguage), targetLanguage: body.targetLanguage,
    });
    const existing = result.termSenses as TranslationResponse["termSenses"] | undefined;
    result.termSenses = [...new Map([...(existing ?? []), ...senses].map((sense) => [sense.id, sense])).values()];
  } catch {
    // La explicación es opcional; una falla del glosario no debe perder la traducción.
  }
};

const glossaryLookupFor = (env: Env) => {
  if (!env.GLOSSARY_DB || !env.GLOSSARY_INDEX) return undefined;
  const retriever = createGlossaryRetriever(env.GLOSSARY_DB, env.GLOSSARY_INDEX, env.AI);
  return async (input: { text: string; sourceLanguage: string; targetLanguage: string }) =>
    matchesFromDocuments(await retriever.invoke(input));
};

const senseLookupFor = (env: Env) => env.GLOSSARY_DB
  ? (input: { text: string; term: string; sourceLanguage: string; targetLanguage: string }) => findGlossarySenses(env.GLOSSARY_DB!, input)
  : undefined;

export const translateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .post("/translate", async (c) => {
    const requestType = (c.req.header("content-type") ?? "").split(";")[0].toLowerCase();
    if (requestType !== "application/json") return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json", requestId: c.get("requestId") } }, 415);
    let rawBody: unknown;
    try {
      rawBody = await readJsonBody(c.req.raw, 64 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "La solicitud supera el límite permitido", requestId: c.get("requestId") } }, 413);
      throw error;
    }
    const parsed = translateRequestSchema.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: { code: "INVALID_REQUEST", message: "Solicitud de traducción inválida", requestId: c.get("requestId") } }, 400);
    if (parsed.data.useSessionContext && !c.env.GLOSSARY_DB) return c.json({ error: { code: "SESSION_CONTEXT_UNAVAILABLE", message: "La memoria de sesión no está configurada." } }, 503);
    const provider = new WorkersAITranslationProvider(c.env.AI, c.env.TRANSLATION_MODEL ?? "@cf/zai-org/glm-4.7-flash");
    const result = await buildTranslationGraph(provider, parsed.data.voiceOptimized, glossaryLookupFor(c.env), senseLookupFor(c.env)).invoke(
      await sessionInputFor(parsed.data, c.get("requestId"), c.env), { recursionLimit: 12, signal: c.req.raw.signal });
    const record = result as unknown as Record<string, unknown>;
    await enrichAmbiguousSenses(parsed.data, record, c.env);
    await saveConfirmed(parsed.data, record, c.env);
    return c.json(responseFrom(record));
  })
  .post("/translate/stream", async (c) => {
    const requestType = (c.req.header("content-type") ?? "").split(";")[0].toLowerCase();
    if (requestType !== "application/json") return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json", requestId: c.get("requestId") } }, 415);
    let rawBody: unknown;
    try {
      rawBody = await readJsonBody(c.req.raw, 64 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "La solicitud supera el límite permitido", requestId: c.get("requestId") } }, 413);
      throw error;
    }
    const parsed = translateRequestSchema.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: { code: "INVALID_REQUEST", message: "Solicitud de traducción inválida", requestId: c.get("requestId") } }, 400);
    if (parsed.data.useSessionContext && !c.env.GLOSSARY_DB) return c.json({ error: { code: "SESSION_CONTEXT_UNAVAILABLE", message: "La memoria de sesión no está configurada." } }, 503);
    const provider = new WorkersAITranslationProvider(c.env.AI, c.env.TRANSLATION_MODEL ?? "@cf/zai-org/glm-4.7-flash");
    const graph = buildTranslationGraph(provider, parsed.data.voiceOptimized, glossaryLookupFor(c.env), senseLookupFor(c.env));
    const preparedInput = await sessionInputFor(parsed.data, c.get("requestId"), c.env);
    return streamSSE(c, async (stream) => {
      const aggregate: Record<string, unknown> = { ...preparedInput };
      try {
        const updates = await graph.stream(aggregate, { streamMode: "updates", recursionLimit: 12, signal: c.req.raw.signal });
        for await (const update of updates) {
          const entries = Object.entries(update as Record<string, Record<string, unknown>>);
          for (const [node, delta] of entries) {
            Object.assign(aggregate, delta);
            await stream.writeSSE({ event: "graph.node.completed", data: JSON.stringify({ requestId: aggregate.requestId, node, processingTimes: delta.processingTimes ?? {} }) });
          }
        }
        await enrichAmbiguousSenses(parsed.data, aggregate, c.env);
        await saveConfirmed(parsed.data, aggregate, c.env);
        await stream.writeSSE({ event: "translation.completed", data: JSON.stringify(responseFrom(aggregate)) });
      } catch {
        await stream.writeSSE({ event: "session.error", data: JSON.stringify({ error: { code: "TRANSLATION_FAILED", message: "No se pudo completar la traducción", requestId: c.get("requestId") } }) });
      }
    });
  });
