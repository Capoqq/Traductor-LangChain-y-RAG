import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { LanguageCode, TargetLanguageCode } from "../../shared/languages";
import { transcribe, translate } from "../services/api";
import { encodeSongSegment, MAX_SONG_BYTES, MAX_SONG_SECONDS, removeTranscriptOverlap, songSegments } from "../services/song-audio";
import type { GlossaryMatch } from "../../shared/glossary";

type SongLine = {
  startSeconds: number;
  original: string;
  translated: string;
  note?: string;
  glossaryMatches?: GlossaryMatch[];
};

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const detectedSource = (requested: LanguageCode, detected?: string): LanguageCode => {
  if (requested !== "auto") return requested;
  const code = detected?.toLowerCase().split("-")[0];
  return code && ["es", "en", "fr", "de", "pt"].includes(code) ? code as LanguageCode : "auto";
};

export const SongTranslator = ({ source, target }: { source: LanguageCode; target: TargetLanguageCode }) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [lines, setLines] = useState<SongLine[]>([]);
  const [status, setStatus] = useState("Selecciona un archivo para comenzar.");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setLines([]);
    setProgress({ done: 0, total: 0 });
    setError("");
    if (selected && (selected.size === 0 || selected.size > MAX_SONG_BYTES)) {
      setFile(null);
      event.target.value = "";
      setError(selected.size === 0 ? "El archivo está vacío." : "El archivo supera 20 MB. Usa una versión comprimida o un fragmento de la canción.");
      return;
    }
    setFile(selected);
    setStatus(selected ? "Archivo listo para procesar." : "Selecciona un archivo para comenzar.");
  };

  const cancel = () => controllerRef.current?.abort();

  const process = async () => {
    if (!file || busy) return;
    if (source !== "auto" && source === target) {
      setError("Elige un idioma de destino distinto del idioma original.");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    setLines([]);
    setProgress({ done: 0, total: 0 });
    setStatus("Decodificando el archivo en tu navegador…");

    try {
      const audioContext = new AudioContext();
      let decoded: AudioBuffer;
      try {
        decoded = await audioContext.decodeAudioData(await file.arrayBuffer()).catch(() => {
          throw new Error("El navegador no pudo abrir este audio. Prueba con MP3, M4A o WAV.");
        });
      } finally {
        await audioContext.close();
      }
      if (controller.signal.aborted) throw new DOMException("Cancelado", "AbortError");
      if (decoded.duration > MAX_SONG_SECONDS) throw new Error("El audio supera 5 minutos. Selecciona un fragmento más corto.");
      const segments = songSegments(decoded.duration);
      setProgress({ done: 0, total: segments.length });
      const sessionId = crypto.randomUUID();
      const context: string[] = [];
      let previousTranscript = "";

      for (let index = 0; index < segments.length; index += 1) {
        if (controller.signal.aborted) throw new DOMException("Cancelado", "AbortError");
        const segment = segments[index];
        setStatus(`Transcribiendo fragmento ${index + 1} de ${segments.length}…`);
        const wav = encodeSongSegment(decoded, segment);
        const recognized = await transcribe(wav, source, controller.signal, "song");
        const original = removeTranscriptOverlap(previousTranscript, recognized.text);
        previousTranscript = recognized.text;
        let translated = "";
        let note: string | undefined;
        let stopForLanguage = false;
        let glossaryMatches: GlossaryMatch[] = [];

        if (original) {
          const chunkSource = detectedSource(source, recognized.detectedLanguage);
          if (chunkSource === target) {
            note = "El idioma detectado coincide con el destino. Selecciona otro idioma de destino y vuelve a procesar el archivo.";
            stopForLanguage = true;
          } else {
            setStatus(`Traduciendo fragmento ${index + 1} de ${segments.length}…`);
            const result = await translate({
              requestId: `${sessionId}-${index}`,
              sessionId,
              text: original,
              sourceLanguage: chunkSource,
              targetLanguage: target,
              tone: "neutral",
              context: context.slice(-4),
              voiceOptimized: true,
              useGlossary: true,
            }, controller.signal);
            glossaryMatches = result.glossaryMatches;
            if (result.validation.valid && result.detectedLanguage !== target) {
              translated = result.translatedText;
              context.push(`${original} => ${translated}`.slice(0, 500));
            } else {
              note = result.detectedLanguage === target
                ? "El idioma detectado coincide con el destino. Selecciona otro idioma de destino y vuelve a procesar el archivo."
                : "La traducción no pasó la validación y se omitió.";
              stopForLanguage = result.detectedLanguage === target;
            }
          }
        } else {
          note = "No se reconoció voz en este fragmento.";
        }
        if (controller.signal.aborted) throw new DOMException("Cancelado", "AbortError");
        setLines((current) => [...current, { startSeconds: segment.startSeconds, original, translated, note, glossaryMatches }]);
        setProgress({ done: index + 1, total: segments.length });
        if (stopForLanguage) {
          setError(note ?? "Elige otro idioma de destino.");
          setStatus("Procesamiento detenido para evitar gastar cuota sin traducir.");
          return;
        }
      }
      setStatus("Procesamiento terminado.");
    } catch (reason) {
      if (controller.signal.aborted) {
        setStatus("Procesamiento cancelado.");
      } else {
        setError(reason instanceof Error ? reason.message : "No se pudo procesar el archivo.");
        setStatus("Procesamiento interrumpido; se conservan los fragmentos terminados.");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const translation = lines.map((line) => line.translated).filter(Boolean).join("\n\n");

  return <section className="song-card" aria-label="Traductor de canciones">
    <div className="song-heading">
      <span className="eyebrow">Archivo de audio · beta</span>
      <h2>Traduce una canción</h2>
      <p>El archivo se procesa directamente, sin micrófono. Whisper intenta reconocer la voz cantada; este modo aún no separa los instrumentos. Revisa el idioma de destino arriba antes de comenzar.</p>
    </div>
    <div className="song-controls">
      <label className="song-file-label">Elige un archivo de audio (máximo 20 MB y 5 minutos)
        <input type="file" accept="audio/*,.mp3,.m4a,.mp4,.ogg,.wav,.webm" onChange={selectFile} disabled={busy} />
      </label>
      {file && <p className="song-filename">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</p>}
      {previewUrl && <audio controls preload="metadata" src={previewUrl} aria-label="Vista previa de la canción" />}
      <div className="song-actions">
        <button className="song-primary" onClick={() => void process()} disabled={!file || busy}>Transcribir y traducir</button>
        {busy && <button className="danger-button" onClick={cancel}>Cancelar</button>}
        <button className="ghost" onClick={() => void navigator.clipboard.writeText(translation)} disabled={!translation}>Copiar traducción</button>
      </div>
      <p className="song-note">Usa cuota de Workers AI. Un archivo con instrumentos fuertes puede producir fragmentos sin letra reconocida; prueba primero una parte con voz clara.</p>
      <p className="song-progress" role="status" aria-live="polite">{status}{progress.total > 0 ? ` ${progress.done}/${progress.total}` : ""}</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
    </div>
    {lines.length > 0 && <div className="song-results">
      {lines.map((line, index) => <article className="song-segment" key={index}>
        <span className="eyebrow">Fragmento {index + 1} · {formatTime(line.startSeconds)}</span>
        <div className="song-segment-columns">
          <div><h3>Original</h3><p>{line.original || "Sin letra reconocida"}</p></div>
          <div><h3>Traducción</h3><p>{line.translated || "Sin traducción"}</p></div>
        </div>
        {line.note && <p className="song-segment-note">{line.note}</p>}
        {line.glossaryMatches && line.glossaryMatches.length > 0 && <p className="glossary-applied">Glosario: {line.glossaryMatches.map((match) => `${match.sourceTerm} → ${match.preferredTranslation}`).join(" · ")}</p>}
      </article>)}
    </div>}
  </section>;
};
