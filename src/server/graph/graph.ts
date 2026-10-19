import { END, START, StateGraph } from "@langchain/langgraph";
import type { TranslationProvider } from "../providers/contracts";
import { createRefinementChain, createTranslationChain } from "../services/translation-chain";
import { needsVoiceContext } from "./context";
import { TranslationState, type TranslationGraphState } from "./state";
import { validateTranslation as validate } from "./validation";
import { runTranslationTools, type GlossaryLookup, type SenseLookup } from "../tools/translation-tools";

const LANGUAGE_HINTS: Record<Exclude<TranslationGraphState["sourceLanguage"], "auto">, RegExp> = {
  es: /\b(hola|gracias|por favor|como|est[aá]s|quiero|necesito|el|la|los|las|para|una|que)\b/gi,
  en: /\b(hello|thanks|please|how|are|you|i|need|want|the|and|for|this)\b/gi,
  fr: /\b(bonjour|merci|s[' ]il|vous|je|le|la|les|des|pour|avec)\b/gi,
  de: /\b(hallo|danke|bitte|ich|du|der|die|das|und|f[uü]r|mit)\b/gi,
  pt: /\b(ol[aá]|obrigad[oa]|por favor|eu|você|o|a|os|as|para|com)\b/gi,
};

const detectLocally = (text: string) => {
  const scores = Object.entries(LANGUAGE_HINTS)
    .map(([language, pattern]) => ({ language, score: (text.match(pattern) ?? []).length }))
    .sort((left, right) => right.score - left.score);
  return scores[0]?.score ? scores[0].language as Exclude<TranslationGraphState["sourceLanguage"], "auto"> : undefined;
};

const timed = async <T>(name: string, work: () => Promise<T> | T) => {
  const started = performance.now();
  const value = await work();
  return { value, timing: { [name]: Math.round(performance.now() - started) } };
};

const VOICE_REFINEMENT_BUDGET_MS = 4_000;

const withBudget = async <T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), VOICE_REFINEMENT_BUDGET_MS);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
};

export const buildTranslationGraph = (provider: TranslationProvider, voiceOptimized = false, glossaryLookup?: GlossaryLookup, senseLookup?: SenseLookup) => {
  const translateChain = createTranslationChain(provider);
  const refineChain = createRefinementChain(provider);

  const detectLanguage = async (state: TranslationGraphState) => {
    const { value, timing } = await timed("detectLanguage", () =>
      state.sourceLanguage === "auto" ? detectLocally(state.originalText) ?? "auto" : state.sourceLanguage,
    );
    return { detectedLanguage: value, processingTimes: timing };
  };

  const analyzeContext = async (state: TranslationGraphState) => {
    const { value, timing } = await timed("analyzeContext", () =>
      state.context.slice(-4).map((entry) => entry.slice(0, 500)),
    );
    return {
      context: value,
      contextNeeded: voiceOptimized && needsVoiceContext(state.originalText, value),
      processingTimes: timing,
    };
  };

  const retrieveGlossary = async (state: TranslationGraphState, config: { signal?: AbortSignal }) => {
    if (state.useTooling && !voiceOptimized) {
      try {
        const { value, timing } = await timed("retrieveGlossary", () => runTranslationTools(provider, {
          text: state.originalText,
          sourceLanguage: state.detectedLanguage ?? state.sourceLanguage,
          targetLanguage: state.targetLanguage,
          context: state.context,
          useGlossary: state.useGlossary,
          glossaryLookup,
          senseLookup,
        }, config.signal));
        return { glossaryMatches: value.glossaryMatches, termSenses: value.termSenses, context: value.context, toolsUsed: value.toolsUsed, processingTimes: timing };
      } catch (error) {
        if (config.signal?.aborted) throw error;
        return { glossaryMatches: [], toolsUsed: [], processingTimes: { retrieveGlossary: 0 },
          errors: [{ node: "retrieveGlossary", code: "TOOLING_UNAVAILABLE", message: "Tool selection failed" }] };
      }
    }
    if (!state.useGlossary || !glossaryLookup) return { glossaryMatches: [], processingTimes: { retrieveGlossary: 0 } };
    try {
      const { value, timing } = await timed("retrieveGlossary", () => glossaryLookup({
        text: state.originalText,
        sourceLanguage: state.detectedLanguage ?? state.sourceLanguage,
        targetLanguage: state.targetLanguage,
      }));
      return { glossaryMatches: value, processingTimes: timing };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return {
        glossaryMatches: [], processingTimes: { retrieveGlossary: 0 },
        errors: [{ node: "retrieveGlossary", code: "GLOSSARY_UNAVAILABLE", message: "Glossary retrieval failed" }],
      };
    }
  };

  const translateText = async (state: TranslationGraphState, config: { signal?: AbortSignal }) => {
    const source = state.detectedLanguage ?? state.sourceLanguage;
    const { value, timing } = await timed("translateText", () =>
      voiceOptimized && state.glossaryMatches.length === 0 && source !== "auto" && provider.translateFast
        ? provider.translateFast(state.originalText, source, state.targetLanguage, { signal: config.signal })
        : translateChain.invoke({
          sourceLanguage: source,
          targetLanguage: state.targetLanguage,
          tone: state.tone,
          originalText: state.originalText,
          context: state.context.join(" | ") || "none",
          glossary: JSON.stringify(state.glossaryMatches),
          termSenses: JSON.stringify(state.termSenses),
        }, { signal: config.signal }),
    );
    return { translatedText: value.trim(), processingTimes: timing };
  };

  const validateTranslation = async (state: TranslationGraphState) => {
    const { value, timing } = await timed("validateTranslation", () => validate(state));
    return { validationResult: value, processingTimes: timing };
  };

  const refineTranslation = async (state: TranslationGraphState, config: { signal?: AbortSignal }) => {
    const work = (signal?: AbortSignal) => timed("refineTranslation", () => refineChain.invoke({
      targetLanguage: state.targetLanguage,
      originalText: state.originalText,
      translatedText: state.translatedText,
      context: state.context.join(" | ") || "none",
      glossary: JSON.stringify(state.glossaryMatches),
      termSenses: JSON.stringify(state.termSenses),
      reasons: state.validationResult?.reasons.join(", ") || (state.contextNeeded ? "resolve references using context" : "invalid"),
    }, { signal }));
    if (!voiceOptimized) {
      const { value, timing } = await work(config.signal);
      return { translatedText: value.trim(), retryCount: state.retryCount + 1, processingTimes: timing };
    }
    try {
      const { value, timing } = await withBudget((signal) => work(signal), config.signal);
      const candidate = value.trim();
      // Never replace a valid fast translation with a bad contextual suggestion.
      const accept = candidate && validate({ ...state, translatedText: candidate }).valid;
      return {
        translatedText: accept ? candidate : state.translatedText,
        retryCount: state.retryCount + 1,
        processingTimes: timing,
      };
    } catch (error) {
      if (config.signal?.aborted) throw error;
      return {
        retryCount: state.retryCount + 1,
        errors: [{ node: "refineTranslation", code: "VOICE_REFINEMENT_UNAVAILABLE", message: "Contextual correction was skipped" }],
      };
    }
  };

  const builder = new StateGraph(TranslationState)
    .addNode("detectLanguage", detectLanguage, { retryPolicy: { maxAttempts: 2 } })
    .addNode("analyzeContext", analyzeContext)
    .addNode("retrieveGlossary", retrieveGlossary)
    .addNode("translateText", translateText, { retryPolicy: { maxAttempts: 2 } })
    .addNode("validateTranslation", validateTranslation)
    .addEdge(START, "detectLanguage")
    .addEdge("detectLanguage", "analyzeContext")
    .addEdge("analyzeContext", "retrieveGlossary")
    .addEdge("retrieveGlossary", "translateText")
    .addEdge("translateText", "validateTranslation");

  return builder
    .addNode("refineTranslation", refineTranslation, { retryPolicy: { maxAttempts: voiceOptimized ? 1 : 2 } })
    .addConditionalEdges(
      "validateTranslation",
      (state) => state.retryCount >= state.maxRetries || (state.validationResult?.valid && (!voiceOptimized || !state.contextNeeded))
        ? END : "refineTranslation",
      ["refineTranslation", END],
    )
    .addEdge("refineTranslation", "validateTranslation")
    .compile();
};
