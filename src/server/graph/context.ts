// A short fragment with an unresolved reference benefits from the preceding sentence.
// Keep this narrow: the fast model should handle ordinary live speech by itself.
const REFERENCE = /\b(it|they|them|he|him|she|her|this|that|those|these|its|their|lo|le|les|ella|ellas|ellos|eso|esto|aquello|ele|ela|eles|elas|il|elle|ils|elles|ce|cela|das|sie|er|es)\b/i;
const CONTINUATION = /^(and|but|because|so|y|pero|porque|entonces|e|mas|et|mais|car|und|aber|denn)\b/i;

export const needsVoiceContext = (text: string, context: string[]) => {
  if (!context.length) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && (REFERENCE.test(text) || CONTINUATION.test(text));
};
