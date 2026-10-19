import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { languages, type LanguageCode, type TargetLanguageCode } from "../shared/languages";
import { clearSessionContext, getSessionContextCount, streamTranslation } from "./services/api";
import { useVoiceTranslator, type VoiceStatus } from "./hooks/useVoiceTranslator";
import { SongTranslator } from "./components/SongTranslator";
import { GlossaryManager } from "./components/GlossaryManager";
import type { GlossaryChoice, GlossaryMatch, GlossarySense } from "../shared/glossary";

type Mode = "text" | "voice" | "live" | "song" | "glossary";
const SESSION_CONTEXT_KEY = "ai-translator-context-session";
const textSessionId = () => {
  const stored = window.sessionStorage.getItem(SESSION_CONTEXT_KEY);
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_CONTEXT_KEY, next);
  return next;
};
const statusLabels: Record<VoiceStatus, string> = {
  idle: "Inactivo", requesting: "Solicitando permiso", listening: "Escuchando",
  transcribing: "Transcribiendo", translating: "Traduciendo", synthesizing: "Generando audio",
  playing: "Reproduciendo", error: "Error", disconnected: "Desconectado",
};

const LanguageSelect = ({ value, onChange, allowAuto, label }: {
  value: LanguageCode; onChange: (value: LanguageCode) => void; allowAuto?: boolean; label: string;
}) => (
  <label className="field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value as LanguageCode)}>
      {languages.filter((item) => allowAuto || item.code !== "auto").map((item) =>
        <option key={item.code} value={item.code}>{item.label}</option>
      )}
    </select>
  </label>
);

const TextTranslator = ({ source, target }: { source: LanguageCode; target: TargetLanguageCode }) => {
  const [text, setText] = useState("");
  const [translated, setTranslated] = useState("");
  const [tone, setTone] = useState<"neutral" | "formal" | "informal" | "concise">("neutral");
  const [stage, setStage] = useState("Listo");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [glossaryMatches, setGlossaryMatches] = useState<GlossaryMatch[]>([]);
  const [termSenses, setTermSenses] = useState<GlossarySense[]>([]);
  const [glossaryChoices, setGlossaryChoices] = useState<GlossaryChoice[]>([]);
  const [useTooling, setUseTooling] = useState(false);
  const [previousContext, setPreviousContext] = useState("");
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [rememberedSegments, setRememberedSegments] = useState(0);
  const [sessionId] = useState(textSessionId);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const runTranslation = useCallback(async () => {
    if (!text.trim()) return;
    controllerRef.current?.abort();
    const requestNumber = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setStage("Preparando");
    try {
      const result = await streamTranslation(
        { text, sourceLanguage: source, targetLanguage: target, tone, sessionId,
          context: useTooling && previousContext.trim() ? [previousContext.trim()] : [], useGlossary: true, useTooling,
          useSessionContext: useTooling },
        (node) => {
          if (requestNumber !== requestRef.current) return;
          const labels: Record<string, string> = {
            detectLanguage: "Preparando traducción", analyzeContext: "Analizando contexto", retrieveGlossary: useTooling ? "Consultando herramientas" : "Consultando glosario",
            translateText: "Traduciendo", validateTranslation: "Validando", refineTranslation: "Refinando",
          };
          setStage(labels[node] ?? "Procesando");
        }, controller.signal,
      );
      if (requestNumber === requestRef.current) {
        setTranslated(result.translatedText);
        setGlossaryMatches(result.glossaryMatches);
        setTermSenses(result.termSenses);
        setGlossaryChoices(result.glossaryChoices);
        setToolsUsed(result.toolsUsed);
        if (useTooling) setRememberedSegments(result.rememberedSegments);
        setStage(result.validation.valid ? "Traducción lista" : "Resultado con advertencias");
      }
    } catch (reason) {
      if (controller.signal.aborted || requestNumber !== requestRef.current) return;
      setError(reason instanceof Error ? reason.message : "No se pudo traducir");
      setStage("Error");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [text, source, target, tone, previousContext, useTooling, sessionId]);

  useEffect(() => {
    if (!useTooling) return;
    let active = true;
    void getSessionContextCount(sessionId, source, target)
      .then((count) => { if (active) setRememberedSegments(count); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "No se pudo leer el contexto."); });
    return () => { active = false; };
  }, [useTooling, sessionId, source, target]);

  useEffect(() => {
    controllerRef.current?.abort();
    ++requestRef.current;
    setTranslated("");
    setGlossaryMatches([]);
    setTermSenses([]);
    setGlossaryChoices([]);
    setToolsUsed([]);
    setError("");
    if (!text.trim()) { setStage("Listo"); return; }
    if (useTooling) { setStage("Pulsa Traducir con IA"); return; }
    const timer = window.setTimeout(() => { void runTranslation(); }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, useTooling, runTranslation]);

  useEffect(() => () => { controllerRef.current?.abort(); }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(translated);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const forgetSession = async () => {
    try {
      await clearSessionContext(sessionId);
      setRememberedSegments(0);
      setPreviousContext("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo borrar el contexto.");
    }
  };

  return <section className="translator-grid" aria-label="Traductor de texto">
    <article className="panel">
      <div className="panel-title"><span>Texto original</span><span>{text.length}/5000</span></div>
      <textarea value={text} maxLength={5000} onChange={(event) => setText(event.target.value)}
        placeholder="Escribe algo para traducir…" aria-label="Texto original" />
      <div className="panel-actions">
        <label className="inline-field">Tono
          <select value={tone} onChange={(event) => setTone(event.target.value as typeof tone)}>
            <option value="neutral">Neutral</option><option value="formal">Formal</option>
            <option value="informal">Informal</option><option value="concise">Conciso</option>
          </select>
        </label>
        <label className="inline-field"><input type="checkbox" checked={useTooling} onChange={(event) => setUseTooling(event.target.checked)} />Herramientas IA</label>
        <button className="ghost" onClick={() => setText("")} disabled={!text}>Limpiar</button>
      </div>
      {useTooling && <label className="tool-context">Contexto adicional (opcional)
        <input value={previousContext} maxLength={500} onChange={(event) => setPreviousContext(event.target.value)}
          placeholder="Ej.: El pedido se aprobó ayer" />
      </label>}
      {useTooling && <div className="memory-row"><span>Contexto automático: {rememberedSegments} de 4 fragmentos. Guarda texto y traducción durante 24 h para esta sesión.</span>
        <button className="ghost" onClick={() => void forgetSession()} disabled={!rememberedSegments}>Borrar contexto</button>
      </div>}
      {useTooling && <div className="tool-submit"><button className="song-primary" onClick={() => void runTranslation()}
        disabled={!text.trim() || stage === "Preparando" || stage === "Consultando herramientas" || stage === "Traduciendo" || stage === "Validando" || stage === "Refinando"}>
        Traducir con IA
      </button></div>}
    </article>
    <article className="panel output-panel" aria-live="polite">
      <div className="panel-title"><span>Traducción</span><span className={"status-dot " + (stage === "Error" ? "danger" : "")}>{stage}</span></div>
      <div className={"translation-output " + (!translated ? "placeholder" : "")}>
        {translated || "La traducción aparecerá aquí."}
        {glossaryMatches.length > 0 && <p className="glossary-applied">Glosario: {glossaryMatches.map((match) => `${match.sourceTerm} → ${match.preferredTranslation}`).join(" · ")}</p>}
        {termSenses.length > 0 && <p className="glossary-applied">Sentidos consultados: {termSenses.map((sense) => `${sense.sourceTerm} → ${sense.preferredTranslation} (${sense.domain || "general"})`).join(" · ")}</p>}
        {glossaryChoices.map((choice) => <p className="sense-choice" key={choice.id}><strong>Sentido usado:</strong> {choice.explanation}</p>)}
        {termSenses.length > 0 && glossaryChoices.length === 0 && <p className="sense-choice">No se pudo identificar un sentido único en el resultado.</p>}
        {useTooling && <p className="tool-used">Herramientas usadas: {toolsUsed.length ? toolsUsed.map((name) => name === "search_glossary" ? "Glosario" : name === "disambiguate_term" ? "Sentidos" : "Contexto").join(" · ") : "ninguna"}</p>}
      </div>
      <div className="panel-actions">
        <span className="error-message">{error}</span>
        <button className="ghost" onClick={copy} disabled={!translated}>{copied ? "Copiado" : "Copiar"}</button>
      </div>
    </article>
  </section>;
};

const VoiceTranslator = ({ mode, source, target }: {
  mode: "voice" | "live"; source: LanguageCode; target: TargetLanguageCode;
}) => {
  const voice = useVoiceTranslator(source, target);
  const active = voice.recording;
  const unsupportedTts = target !== "es" && target !== "en";

  return <section className="voice-card">
    <div className="voice-hero">
      <div className="level-ring" style={{ "--level": voice.level } as CSSProperties}>
        <button className={"mic-button " + (active ? "active" : "")}
          onClick={() => active ? voice.stop() : voice.start(mode === "live" ? "continuous" : "push")}
          aria-label={active ? "Detener grabación" : "Iniciar grabación"}>
          {active ? "■" : "●"}
        </button>
      </div>
      <div>
        <div className="eyebrow">{mode === "live" ? "Voz en vivo · traducción cada 3 segundos" : "Pulsar para hablar"}</div>
        <h2>{active ? "Te escucho…" : "Habla, traduce y escucha"}</h2>
        <p>{unsupportedTts ? "Este idioma ofrece traducción escrita; TTS está habilitado solo para español e inglés." : "La transcripción aparece mientras hablas; la traducción y el audio se generan al cerrar cada frase."}</p>
      </div>
      <span className={"voice-status " + voice.status}>{statusLabels[voice.status]}</span>
    </div>

    <div className="voice-columns">
      <article><span className="eyebrow">Transcripción original</span><p>{voice.transcript || "Tu voz transcrita aparecerá aquí."}</p></article>
      <article><span className="eyebrow">Traducción</span><p>{voice.translation || "La traducción aparecerá aquí."}</p></article>
    </div>

    <div className="voice-controls">
      <button className="ghost" onClick={voice.replay} disabled={!voice.translation || unsupportedTts}>Reproducir</button>
      <button className="ghost" onClick={() => voice.setMuted(!voice.muted)}>{voice.muted ? "Activar sonido" : "Silenciar"}</button>
      <label>Volumen <input type="range" min="0" max="1" step="0.05" value={voice.volume}
        onChange={(event) => voice.setVolume(Number(event.target.value))} /></label>
      {active && <button className="danger-button" onClick={voice.stop}>Detener sesión</button>}
    </div>
    {voice.error && <p className="error-banner" role="alert">{voice.error}</p>}
  </section>;
};

export const App = () => {
  const [authStatus, setAuthStatus] = useState<"checking" | "locked" | "authenticated" | "setup">("checking");
  const [accessPassword, setAccessPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => response.json() as Promise<{ configured?: boolean; authenticated?: boolean }>)
      .then((session) => setAuthStatus(!session.configured ? "setup" : session.authenticated ? "authenticated" : "locked"))
      .catch(() => { setAuthError("No se pudo comprobar la sesión."); setAuthStatus("setup"); });
  }, []);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: accessPassword }),
      });
      const body = await response.json() as { error?: { message?: string }; authenticated?: boolean };
      if (!response.ok || !body.authenticated) throw new Error(body.error?.message ?? "No se pudo iniciar sesión.");
      setAccessPassword("");
      setAuthStatus("authenticated");
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem(SESSION_CONTEXT_KEY);
    setAuthStatus("locked");
  };

  const [mode, setMode] = useState<Mode>("text");
  const [source, setSource] = useState<LanguageCode>("es");
  const [target, setTarget] = useState<TargetLanguageCode>("en");
  const [songSource, setSongSource] = useState<LanguageCode>("auto");
  const [songTarget, setSongTarget] = useState<TargetLanguageCode>("es");
  const selectedSource = mode === "song" ? songSource : source;
  const selectedTarget = mode === "song" ? songTarget : target;
  const setSelectedSource = mode === "song" ? setSongSource : setSource;
  const setSelectedTarget = mode === "song" ? setSongTarget : setTarget;

  const swap = () => {
    if (selectedSource === "auto") return;
    setSelectedSource(selectedTarget);
    setSelectedTarget(selectedSource);
  };

  if (authStatus !== "authenticated") {
    return <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="brand-mark">A</span>
        <span className="eyebrow">AI LIVE TRANSLATOR</span>
        <h1 id="auth-title">{authStatus === "checking" ? "Comprobando acceso…" : authStatus === "setup" ? "Falta configurar el acceso" : "Acceso privado"}</h1>
        {authStatus === "setup" ? <p>Configura <code>APP_ACCESS_PASSWORD</code> en el archivo local <code>.dev.vars</code> (mínimo 32 caracteres) y reinicia el servidor.</p> :
          authStatus === "checking" ? <p>Verificando tu sesión segura.</p> : <>
            <p>Introduce la contraseña de acceso para usar el traductor.</p>
            <form onSubmit={login} className="auth-form">
              <label htmlFor="access-password">Contraseña</label>
              <input id="access-password" type="password" autoComplete="current-password" value={accessPassword}
                onChange={(event) => setAccessPassword(event.target.value)} required maxLength={256} />
              <button type="submit" disabled={authBusy || !accessPassword}>{authBusy ? "Validando…" : "Entrar"}</button>
            </form>
          </>}
        {authError && <p className="error-banner" role="alert">{authError}</p>}
        <p className="auth-note">La sesión usa una cookie HttpOnly, SameSite y con expiración automática.</p>
      </section>
    </main>;
  }

  return <main>
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark">A</span><span>AI Live Translator</span></a>
      <div className="topbar-actions"><span className="cloud-badge">Powered by Cloudflare Workers AI</span><button className="ghost" onClick={logout}>Cerrar sesión</button></div>
    </header>

    <section className="intro">
      <span className="eyebrow">TRADUCCIÓN INTELIGENTE EN TIEMPO REAL</span>
      <h1>Las palabras viajan.<br/><em>El significado permanece.</em></h1>
      <p>Traduce texto y voz con un flujo verificable construido con LangChain, LangGraph y modelos alojados en Cloudflare.</p>
    </section>

    <nav className="mode-tabs" aria-label="Modalidad de traducción">
      {([["text", "Texto"], ["voice", "Voz"], ["live", "Voz continua (beta)"], ["song", "Canciones (beta)"], ["glossary", "Glosario"]] as const).map(([value, label]) =>
        <button key={value} className={mode === value ? "selected" : ""} onClick={() => setMode(value)}>{label}</button>
      )}
    </nav>

    {mode !== "glossary" && <section className="language-bar">
      <LanguageSelect label="Idioma de origen" value={selectedSource} allowAuto onChange={setSelectedSource} />
      <button className="swap" onClick={swap} disabled={selectedSource === "auto"} aria-label="Intercambiar idiomas">⇄</button>
      <LanguageSelect label="Idioma de destino" value={selectedTarget} onChange={(value) => setSelectedTarget(value as TargetLanguageCode)} />
    </section>}

    {mode === "glossary" ? <GlossaryManager /> : mode === "text" ? <TextTranslator source={source} target={target} /> :
      mode === "song" ? <SongTranslator source={songSource} target={songTarget} /> :
        <VoiceTranslator mode={mode} source={source} target={target} />}

    <footer>
      <span>El servidor no registra texto ni audio; los términos que guardes en el glosario sí se almacenan en D1.</span>
      <span>React · Hono · LangChain · LangGraph</span>
    </footer>
  </main>;
};
