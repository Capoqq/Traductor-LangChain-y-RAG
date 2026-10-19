export type LiveTranscriptMessage = {
  start?: number;
  is_final?: boolean | "true" | "false";
  speech_final?: boolean | "true" | "false";
  channel?: { alternatives?: Array<{
    transcript?: string;
    languages?: string[];
    words?: Array<{ language?: string }>;
  }> };
};

type Segment = {
  start: number;
  text: string;
  deliveredWords: number;
  stableWords: number;
  firstSeenAt: number;
  final: boolean;
};

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const enabled = (value: boolean | string | undefined) => value === true || value === "true";
const STABLE_PARTIAL_AGE_MS = 3_000;
const FALLBACK_PARTIAL_AGE_MS = 6_000;

const sharedPrefixLength = (left: string[], right: string[]) => {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
};

export const createLiveTranscriptBuffer = () => {
  const segments = new Map<string, Segment>();
  let fallbackSegment = 0;

  const ordered = () => [...segments.values()].sort((left, right) => left.start - right.start);

  return {
    ingest(message: LiveTranscriptMessage, now = Date.now()) {
      const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (!text) return;
      const hasStart = typeof message.start === "number" && Number.isFinite(message.start);
      const start = hasStart ? message.start! : fallbackSegment;
      const key = hasStart ? `time:${start.toFixed(3)}` : `fallback:${fallbackSegment}`;
      const previous = segments.get(key);
      const isFinal = enabled(message.is_final) || enabled(message.speech_final);
      if (previous?.final && !isFinal) return;
      const words = wordsOf(text);
      segments.set(key, {
        start,
        text,
        deliveredWords: previous?.deliveredWords ?? 0,
        stableWords: previous ? sharedPrefixLength(wordsOf(previous.text), words) : 0,
        firstSeenAt: previous?.firstSeenAt ?? now,
        final: isFinal || previous?.final || false,
      });
      if (!hasStart && isFinal) fallbackSegment += 1;
    },
    pending() {
      return ordered()
        .map((segment) => wordsOf(segment.text).slice(segment.deliveredWords).join(" "))
        .filter(Boolean)
        .join(" ");
    },
    take(now = Date.now()) {
      const ready: string[] = [];
      for (const segment of ordered()) {
        const words = wordsOf(segment.text);
        const age = now - segment.firstSeenAt;
        const safePrefix = Math.max(0, words.length - 2);
        const available = segment.final
          ? words.length
          : age >= FALLBACK_PARTIAL_AGE_MS
            ? safePrefix
            : age >= STABLE_PARTIAL_AGE_MS ? Math.min(segment.stableWords, safePrefix) : 0;
        if (available <= segment.deliveredWords) {
          if (!segment.final) break;
          continue;
        }
        ready.push(words.slice(segment.deliveredWords, available).join(" "));
        segment.deliveredWords = available;
      }
      return ready.join(" ");
    },
  };
};
