export const MAX_SONG_BYTES = 20 * 1024 * 1024;
export const MAX_SONG_SECONDS = 5 * 60;
export const SONG_CHUNK_SECONDS = 28;
const SONG_OVERLAP_SECONDS = 1;
const OUTPUT_SAMPLE_RATE = 16_000;

export type DecodedSongAudio = Pick<AudioBuffer, "length" | "sampleRate" | "numberOfChannels" | "getChannelData">;
export type SongSegment = { startSeconds: number; endSeconds: number };

export const songSegments = (durationSeconds: number): SongSegment[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_SONG_SECONDS) {
    throw new Error("El audio debe durar entre 1 segundo y 5 minutos.");
  }
  const segments: SongSegment[] = [];
  for (let startSeconds = 0; startSeconds < durationSeconds;) {
    const endSeconds = Math.min(startSeconds + SONG_CHUNK_SECONDS, durationSeconds);
    segments.push({ startSeconds, endSeconds });
    if (endSeconds === durationSeconds) break;
    startSeconds = endSeconds - SONG_OVERLAP_SECONDS;
  }
  return segments;
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

export const encodeSongSegment = (audio: DecodedSongAudio, segment: SongSegment): Blob => {
  if (!audio.numberOfChannels || !audio.sampleRate || segment.endSeconds <= segment.startSeconds) {
    throw new Error("Fragmento de audio inválido.");
  }
  const sourceStart = Math.floor(segment.startSeconds * audio.sampleRate);
  const sourceEnd = Math.min(audio.length, Math.ceil(segment.endSeconds * audio.sampleRate));
  const sampleCount = Math.ceil((sourceEnd - sourceStart) * OUTPUT_SAMPLE_RATE / audio.sampleRate);
  if (sampleCount <= 0) throw new Error("Fragmento de audio vacío.");

  const bytes = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(bytes);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  for (let index = 0; index < sampleCount; index += 1) {
    const position = Math.min(sourceEnd - 1, sourceStart + index * audio.sampleRate / OUTPUT_SAMPLE_RATE);
    const left = Math.floor(position);
    const right = Math.min(left + 1, sourceEnd - 1);
    const blend = position - left;
    let sample = 0;
    for (const channel of channels) sample += channel[left] * (1 - blend) + channel[right] * blend;
    sample /= channels.length;
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
};

const comparable = (word: string) => word.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "");

export const removeTranscriptOverlap = (previous: string, current: string) => {
  const earlier = previous.trim().split(/\s+/).filter(Boolean);
  const later = current.trim().split(/\s+/).filter(Boolean);
  const limit = Math.min(8, earlier.length, later.length);
  for (let count = limit; count > 0; count -= 1) {
    const tail = earlier.slice(-count).map(comparable);
    const head = later.slice(0, count).map(comparable);
    if (tail.every((word, index) => word && word === head[index])) return later.slice(count).join(" ");
  }
  return current.trim();
};
