import { describe, expect, it } from "vitest";
import { encodeSongSegment, removeTranscriptOverlap, songSegments } from "../src/client/services/song-audio";

describe("song audio preparation", () => {
  it("splits a song into decodable overlapping clips", () => {
    expect(songSegments(60)).toEqual([
      { startSeconds: 0, endSeconds: 28 },
      { startSeconds: 27, endSeconds: 55 },
      { startSeconds: 54, endSeconds: 60 },
    ]);
    expect(() => songSegments(301)).toThrow();
  });

  it("encodes mono PCM16 WAV at 16 kHz", async () => {
    const samples = new Float32Array(48_000);
    samples.fill(0.5);
    const audio = {
      length: samples.length,
      sampleRate: 48_000,
      numberOfChannels: 1,
      getChannelData: () => samples,
    };
    const wav = encodeSongSegment(audio, { startSeconds: 0, endSeconds: 1 });
    const bytes = await wav.arrayBuffer();
    const view = new DataView(bytes);
    expect(wav.type).toBe("audio/wav");
    expect(String.fromCharCode(...new Uint8Array(bytes, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(bytes, 8, 4))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(view.getInt16(44, true)).toBeGreaterThan(16_000);
  });

  it("removes only repeated words caused by chunk overlap", () => {
    expect(removeTranscriptOverlap("We are here.", "Are here again today")).toBe("again today");
    expect(removeTranscriptOverlap("We are here.", "The song goes on")).toBe("The song goes on");
  });
});
