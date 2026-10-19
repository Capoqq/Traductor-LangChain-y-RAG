import { useCallback, useEffect, useRef, useState } from "react";
import { synthesize, transcribe, translate } from "../services/api";
import { createLiveTranscriptBuffer, type LiveTranscriptMessage } from "../services/live-transcript";
import type { LanguageCode, TargetLanguageCode } from "../../shared/languages";

export type VoiceStatus = "idle" | "requesting" | "listening" | "transcribing" | "translating" | "synthesizing" | "playing" | "error" | "disconnected";
type VoiceMode = "push" | "continuous";
type SegmentJob = {
  mode: VoiceMode;
  generation: number;
  sessionId: string;
  sequence: number;
  sourceLanguage: LanguageCode;
  targetLanguage: TargetLanguageCode;
  signal: AbortSignal;
};
type NovaMessage = LiveTranscriptMessage & {
  error?: string;
  message?: string;
  type?: string;
};

const getMicrophone = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador no permite acceder al micrófono. Prueba con un navegador actualizado y una conexión segura (HTTPS o localhost).");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (reason) {
    const name = reason instanceof DOMException ? reason.name : "";
    if (name === "OverconstrainedError" || name === "NotFoundError") return navigator.mediaDevices.getUserMedia({ audio: true });
    throw reason;
  }
};

const microphoneErrorMessage = (reason: unknown) => {
  const name = reason instanceof DOMException ? reason.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No se encontró un micrófono. Conéctalo o actívalo y revisa Configuración de Windows > Sistema > Sonido > Entrada.";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "No hay permiso para usar el micrófono. Permite el acceso en los permisos del sitio del navegador y en Privacidad y seguridad > Micrófono de Windows.";
  if (name === "NotReadableError" || name === "TrackStartError") return "No se pudo abrir el micrófono. Puede estar ocupado por otra aplicación; ciérrala y vuelve a intentar.";
  return reason instanceof Error ? reason.message : "No se pudo acceder al micrófono.";
};

const resampleToLinear16 = (samples: Float32Array, sourceRate: number) => {
  const targetRate = 16_000;
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * sourceRate / targetRate;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const blend = sourceIndex - left;
    const sample = samples[left] * (1 - blend) + samples[right] * blend;
    output[index] = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
  }
  return output.buffer;
};

export const useVoiceTranslator = (sourceLanguage: LanguageCode, targetLanguage: TargetLanguageCode) => {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  const liveAudioCleanupRef = useRef<(() => void) | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const liveTranscriptRef = useRef("");
  const liveDetectedLanguageRef = useRef<LanguageCode | null>(null);
  const liveBufferRef = useRef(createLiveTranscriptBuffer());
  const liveChunkTimerRef = useRef<number | null>(null);
  const limitTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);
  const modeRef = useRef<VoiceMode>("push");
  const contextRef = useRef<string[]>([]);

  const stopResources = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = null;
    const liveSocket = liveSocketRef.current;
    liveSocketRef.current = null;
    if (liveSocket && (liveSocket.readyState === WebSocket.CONNECTING || liveSocket.readyState === WebSocket.OPEN)) liveSocket.close(1000, "Session ended");
    liveAudioCleanupRef.current?.();
    liveAudioCleanupRef.current = null;
    if (liveChunkTimerRef.current !== null) window.clearInterval(liveChunkTimerRef.current);
    liveChunkTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserCleanupRef.current?.();
    analyserCleanupRef.current = null;
    if (limitTimerRef.current !== null) window.clearTimeout(limitTimerRef.current);
    limitTimerRef.current = null;
    setLevel(0);
    setRecording(false);
  }, []);

  const isCurrent = (job: SegmentJob) => generationRef.current === job.generation && !job.signal.aborted;

  const playBlob = useCallback(async (blob: Blob, job: SegmentJob) => {
    if (!isCurrent(job)) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    audio.volume = muted ? 0 : volume;
    audioRef.current = audio;
    setStatus("playing");
    await audio.play();
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      audio.onended = finish;
      audio.onerror = finish;
      job.signal.addEventListener("abort", () => { audio.pause(); finish(); }, { once: true });
    });
    if (isCurrent(job)) setStatus((recorderRef.current?.state === "recording" || liveSocketRef.current?.readyState === WebSocket.OPEN) ? "listening" : "idle");
  }, [muted, recording, volume]);

  const translateTranscript = useCallback(async (text: string, job: SegmentJob) => {
    if (!text.trim() || !isCurrent(job)) return;
    setStatus("translating");
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    job.signal.addEventListener("abort", abortRequest, { once: true });
    const timeoutMs = job.mode === "continuous" && job.sourceLanguage !== "auto" ? 20_000 : 30_000;
    const timeout = window.setTimeout(abortRequest, timeoutMs);
    let translated: Awaited<ReturnType<typeof translate>>;
    try {
      translated = await translate({
        sessionId: job.sessionId,
        requestId: job.sessionId + "-" + job.sequence,
        text,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        tone: "neutral",
        context: contextRef.current.slice(-4),
        voiceOptimized: true,
      }, requestController.signal);
    } catch (reason) {
      if (requestController.signal.aborted && !job.signal.aborted) {
        throw new Error("La traducción tardó demasiado; se continuará con el siguiente bloque.");
      }
      throw reason;
    } finally {
      window.clearTimeout(timeout);
      job.signal.removeEventListener("abort", abortRequest);
    }
    if (!isCurrent(job)) return;
    if (!translated.validation.valid) {
      setError("Un fragmento no pasó la validación de traducción; se omitió para evitar mostrarlo o reproducirlo incorrectamente.");
      setStatus(job.mode === "continuous" ? "listening" : "idle");
      return;
    }
    setError("");
    setTranslation((current) => current ? current + " " + translated.translatedText : translated.translatedText);
    contextRef.current.push(text + " => " + translated.translatedText);
    if (job.targetLanguage === "es" || job.targetLanguage === "en") {
      const ttsLanguage = job.targetLanguage;
      playbackQueueRef.current = playbackQueueRef.current
        .then(async () => {
          if (!isCurrent(job)) return;
          setStatus("synthesizing");
          const audio = await synthesize(translated.translatedText, ttsLanguage, job.signal);
          await playBlob(audio, job);
        })
        .catch((reason) => {
          if (job.signal.aborted || !isCurrent(job)) return;
          setError(reason instanceof Error ? reason.message : "Error al generar el audio");
          setStatus("error");
        });
    } else if (isCurrent(job)) {
      setStatus("listening");
    }
  }, [playBlob]);

  const processSegment = useCallback(async (blob: Blob, job: SegmentJob) => {
    if (blob.size < 1000 || !isCurrent(job)) return;
    setStatus("transcribing");
    const transcription = await transcribe(blob, job.sourceLanguage, job.signal);
    if (!isCurrent(job)) return;
    setTranscript((current) => current ? current + " " + transcription.text : transcription.text);
    await translateTranscript(transcription.text, job);
  }, [translateTranscript]);

  const setupMeter = useCallback((stream: MediaStream) => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteFrequencyData(values);
      setLevel(values.reduce((sum, value) => sum + value, 0) / values.length / 255);
      frame = requestAnimationFrame(tick);
    };
    tick();
    analyserCleanupRef.current = () => {
      cancelAnimationFrame(frame);
      void context.close();
    };
  }, []);

  const start = useCallback(async (mode: VoiceMode) => {
    if ((recorderRef.current && recorderRef.current.state !== "inactive") || (liveSocketRef.current && liveSocketRef.current.readyState < WebSocket.CLOSING)) return;
    abortRef.current?.abort();
    audioRef.current?.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const sessionId = crypto.randomUUID();
    modeRef.current = mode;
    sequenceRef.current = 0;
    queueRef.current = Promise.resolve();
    playbackQueueRef.current = Promise.resolve();
    contextRef.current = [];
    liveTranscriptRef.current = "";
    liveDetectedLanguageRef.current = null;
    liveBufferRef.current = createLiveTranscriptBuffer();
    setError("");
    setTranscript("");
    setTranslation("");
    setStatus("requesting");

    try {
      const media = await getMicrophone();
      if (generation !== generationRef.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = media;
      setupMeter(media);
      const makeJob = (): SegmentJob => ({
        mode,
        generation,
        sessionId,
        sequence: sequenceRef.current++,
        sourceLanguage: sourceLanguage === "auto" ? liveDetectedLanguageRef.current ?? "auto" : sourceLanguage,
        targetLanguage,
        signal: controller.signal,
      });

      if (mode === "continuous") {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = new URL(protocol + "//" + window.location.host + "/api/speech/live");
        url.searchParams.set("language", sourceLanguage === "auto" ? "multi" : sourceLanguage);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        liveSocketRef.current = socket;
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(media);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const silent = audioContext.createGain();
        let lastAudioFrameAt = Date.now();
        silent.gain.value = 0;
        source.connect(processor);
        processor.connect(silent);
        silent.connect(audioContext.destination);
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN || controller.signal.aborted) return;
          lastAudioFrameAt = Date.now();
          socket.send(resampleToLinear16(event.inputBuffer.getChannelData(0), audioContext.sampleRate));
        };
        liveAudioCleanupRef.current = () => {
          processor.onaudioprocess = null;
          source.disconnect();
          processor.disconnect();
          silent.disconnect();
          void audioContext.close();
        };
        const renderLiveTranscript = () => {
          const visible = [liveTranscriptRef.current, liveBufferRef.current.pending()].filter(Boolean).join(" ");
          setTranscript(visible);
        };
        const commitLiveTranscript = () => {
          const spoken = liveBufferRef.current.take();
          if (!spoken || controller.signal.aborted || generation !== generationRef.current) return;
          liveTranscriptRef.current = liveTranscriptRef.current ? liveTranscriptRef.current + " " + spoken : spoken;
          setTranscript(liveTranscriptRef.current);
          const job = makeJob();
          queueRef.current = queueRef.current
            .then(() => translateTranscript(spoken, job))
            .catch((reason) => {
              if (controller.signal.aborted || generation !== generationRef.current) return;
              setError(reason instanceof Error ? reason.message : "No se pudo traducir el fragmento de voz");
              setStatus("error");
            });
        };
        socket.onopen = () => {
          if (!controller.signal.aborted && generation === generationRef.current) {
            void audioContext.resume();
            setRecording(true);
            setStatus("listening");
            liveChunkTimerRef.current = window.setInterval(() => {
              if (socket.readyState !== WebSocket.OPEN || controller.signal.aborted) return;
              if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
              if (Date.now() - lastAudioFrameAt > 9_000) {
                setError("El micrófono dejó de enviar audio. Mantén la app abierta y vuelve a iniciar la sesión si no se recupera.");
              }
              commitLiveTranscript();
            }, 3_000);
          }
        };
        socket.onmessage = (event) => {
          if (controller.signal.aborted || generation !== generationRef.current || typeof event.data !== "string") return;
          try {
            const message = JSON.parse(event.data) as NovaMessage;
            if (message.type === "error" || message.error) {
              setError(message.error ?? message.message ?? "Nova-3 rechazó la sesión de voz en vivo.");
              setStatus("error");
              return;
            }
            const alternative = message.channel?.alternatives?.[0];
            const languageTag = alternative?.languages?.[0] ?? alternative?.words?.find((word) => word.language)?.language;
            const languageCode = languageTag?.split("-")[0];
            if (languageCode && ["es", "en", "fr", "de", "pt"].includes(languageCode)) {
              liveDetectedLanguageRef.current = languageCode as LanguageCode;
            }
            const speechFinal = message.speech_final === true || message.speech_final === "true"
              || message.is_final === true || message.is_final === "true";
            liveBufferRef.current.ingest(message);
            renderLiveTranscript();
            if (speechFinal) commitLiveTranscript();
          } catch {
            // Nova-3 may also send non-transcript control events.
          }
        };
        socket.onerror = () => {
          if (!controller.signal.aborted && generation === generationRef.current) {
            setError("La conexión de voz en vivo falló. Comprueba el túnel HTTPS y vuelve a intentarlo.");
            setStatus("error");
          }
        };
        socket.onclose = (event) => {
          if (!controller.signal.aborted && generation === generationRef.current) {
            const reason = event.reason ? ": " + event.reason : "";
            if (liveChunkTimerRef.current !== null) window.clearInterval(liveChunkTimerRef.current);
            liveChunkTimerRef.current = null;
            setError("La conexión de Nova-3 se cerró (código " + event.code + ")" + reason + ". Revisa la consola del servidor.");
            liveSocketRef.current = null;
            liveAudioCleanupRef.current?.();
            liveAudioCleanupRef.current = null;
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            analyserCleanupRef.current?.();
            analyserCleanupRef.current = null;
            setRecording(false);
            setLevel(0);
            setStatus("disconnected");
          }
        };
        limitTimerRef.current = window.setTimeout(() => {
          if (generation === generationRef.current) {
            controller.abort();
            generationRef.current += 1;
            setStatus("idle");
            stopResources();
          }
        }, 10 * 60_000);
        return;
      }

      const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(media, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size && generation === generationRef.current) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (generation !== generationRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const job = makeJob();
        queueRef.current = processSegment(blob, job)
          .catch((reason) => {
            if (controller.signal.aborted || generation !== generationRef.current) return;
            setError(reason instanceof Error ? reason.message : "Error de voz");
            setStatus("error");
          })
          .finally(() => {
            if (generation === generationRef.current) setStatus((current) => current === "error" ? current : "idle");
          });
      };
      recorder.start();
      setRecording(true);
      limitTimerRef.current = window.setTimeout(() => stopResources(), 60_000);
      setStatus("listening");
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(microphoneErrorMessage(reason));
      setStatus("error");
      stopResources();
    }
  }, [processSegment, setupMeter, sourceLanguage, stopResources, targetLanguage, translateTranscript]);

  const stop = useCallback(() => {
    if (modeRef.current === "continuous") {
      abortRef.current?.abort();
      generationRef.current += 1;
      audioRef.current?.pause();
      setStatus("idle");
    } else {
      setStatus("transcribing");
    }
    stopResources();
  }, [stopResources]);

  const replay = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.volume = muted ? 0 : volume;
    void audioRef.current.play();
  }, [muted, volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => () => {
    abortRef.current?.abort();
    generationRef.current += 1;
    audioRef.current?.pause();
    stopResources();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, [stopResources]);

  return { status, recording, transcript, translation, error, level, muted, volume, setMuted, setVolume, start, stop, replay };
};
