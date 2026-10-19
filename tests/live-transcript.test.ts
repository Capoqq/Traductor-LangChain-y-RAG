import { describe, expect, it } from "vitest";
import { createLiveTranscriptBuffer } from "../src/client/services/live-transcript";

const result = (start: number, transcript: string, isFinal = false, speechFinal = false) => ({
  start,
  is_final: isFinal,
  speech_final: speechFinal,
  channel: { alternatives: [{ transcript }] },
});

describe("Nova live transcript buffer", () => {
  it("waits for a stable partial and translates only new words", () => {
    const buffer = createLiveTranscriptBuffer();
    buffer.ingest(result(0, "Hello there"), 0);
    expect(buffer.take(3_000)).toBe("");
    buffer.ingest(result(0, "Hello there, how are you"), 1_000);
    // Punctuation changes are treated as revisions, not as confirmed words.
    expect(buffer.take(3_000)).toBe("Hello");
    buffer.ingest(result(0, "Hello there, how are you", true, true), 3_100);
    expect(buffer.take(3_100)).toBe("there, how are you");
    expect(buffer.take(6_000)).toBe("");
  });

  it("uses a timed fallback for long speech without a final event", () => {
    const buffer = createLiveTranscriptBuffer();
    buffer.ingest(result(0, "One two three four five"), 0);
    expect(buffer.take(3_000)).toBe("");
    expect(buffer.take(6_000)).toBe("One two three");
    buffer.ingest(result(0, "One two three four five six", true), 6_100);
    expect(buffer.take(6_100)).toBe("four five six");
  });

  it("keeps processing later final segments without repeating earlier ones", () => {
    const buffer = createLiveTranscriptBuffer();
    buffer.ingest(result(0, "Good morning", true), 0);
    buffer.ingest(result(1.4, "everyone"), 0);
    expect(buffer.take(0)).toBe("Good morning");
    buffer.ingest(result(1.4, "everyone watching", true, true), 1_000);
    expect(buffer.take(1_000)).toBe("everyone watching");
    buffer.ingest(result(3.2, "Today we begin", true), 2_000);
    expect(buffer.take(2_000)).toBe("Today we begin");
  });

  it("ignores stale partials after a segment is final", () => {
    const buffer = createLiveTranscriptBuffer();
    buffer.ingest(result(0, "A complete phrase", true), 0);
    expect(buffer.take(0)).toBe("A complete phrase");
    buffer.ingest(result(0, "A complete", false), 1_000);
    expect(buffer.pending()).toBe("");
  });
});
