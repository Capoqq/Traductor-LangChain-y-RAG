import type { TranslationGraphState } from "./state";

const protectedTokens = (text: string) =>
  text.match(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\{\{?[^{}]+\}?\}|%[sd]|\d+(?:[.,]\d+)*/g) ?? [];

export const validateTranslation = (
  state: TranslationGraphState,
): { valid: boolean; status: "valid" | "needs_refinement" | "exhausted"; reasons: string[] } => {
  const reasons: string[] = [];
  const source = state.originalText.trim();
  const output = state.translatedText.trim();

  if (!output) reasons.push("empty_output");
  if (/^(translation|traducción|traduction|übersetzung|tradução)\s*:/i.test(output)) reasons.push("unexpected_label");

  const missing = protectedTokens(source).filter((token) => !output.includes(token));
  if (missing.length) reasons.push("missing_protected_tokens:" + missing.join(","));

  const hasLetters = /\p{L}/u.test(source);
  if (hasLetters && state.detectedLanguage !== state.targetLanguage && source.toLocaleLowerCase() === output.toLocaleLowerCase()) {
    reasons.push("unchanged_output");
  }

  if (source.length > 80 && output.length < source.length * 0.15) reasons.push("probable_truncation");

  const folded = output.normalize("NFC").toLocaleLowerCase();
  for (const match of state.glossaryMatches ?? []) {
    if (!folded.includes(match.preferredTranslation.normalize("NFC").toLocaleLowerCase())) {
      reasons.push("missing_glossary_term:" + match.id);
    }
  }

  const valid = reasons.length === 0;
  const exhausted = !valid && state.retryCount >= state.maxRetries;
  return { valid, status: valid ? "valid" : exhausted ? "exhausted" : "needs_refinement", reasons };
};
