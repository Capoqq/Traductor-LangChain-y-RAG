import { useEffect, useState, type FormEvent } from "react";
import type { GlossaryEntry, GlossaryInput } from "../../shared/glossary";
import { languages, type TargetLanguageCode } from "../../shared/languages";
import { deleteGlossaryEntry, listGlossaryEntries, saveGlossaryEntry } from "../services/api";

const languageOptions = languages.filter((language) => language.code !== "auto");
const emptyForm = (): GlossaryInput => ({
  sourceLanguage: "en", targetLanguage: "es", sourceTerm: "", preferredTranslation: "",
  domain: "", example: "", notes: "",
});

export const GlossaryManager = () => {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [form, setForm] = useState<GlossaryInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void listGlossaryEntries().then(setEntries).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el glosario.");
    }).finally(() => setLoading(false));
  }, []);

  const change = (name: keyof GlossaryInput, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (form.sourceLanguage === form.targetLanguage) {
      setError("El origen y el destino deben ser diferentes.");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveGlossaryEntry(form, editingId ?? undefined);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setEditingId(null);
      setForm(emptyForm());
      setNotice("Entrada guardada. La búsqueda semántica puede tardar unos segundos en actualizarse.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la entrada.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (entry: GlossaryEntry) => {
    setEditingId(entry.id);
    setForm({
      sourceLanguage: entry.sourceLanguage, targetLanguage: entry.targetLanguage,
      sourceTerm: entry.sourceTerm, preferredTranslation: entry.preferredTranslation,
      domain: entry.domain, example: entry.example, notes: entry.notes,
    });
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (entry: GlossaryEntry) => {
    if (!window.confirm(`¿Eliminar la preferencia «${entry.sourceTerm}»?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteGlossaryEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      if (editingId === entry.id) { setEditingId(null); setForm(emptyForm()); }
      setNotice("Entrada eliminada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar la entrada.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="glossary-card" aria-label="Glosario de traducción">
    <div className="glossary-heading">
      <span className="eyebrow">Preferencias de traducción</span>
      <h2>Glosario contextual</h2>
      <p>Guarda términos y ejemplos para que el traductor elija mejor su significado. Se aplica a texto y canciones; la voz en vivo conserva su ruta rápida.</p>
    </div>
    <form className="glossary-form" onSubmit={(event) => void save(event)}>
      <div className="glossary-pair">
        <label className="field">Idioma original
          <select value={form.sourceLanguage} disabled={busy || Boolean(editingId)} onChange={(event) => change("sourceLanguage", event.target.value)}>
            {languageOptions.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
        </label>
        <label className="field">Idioma de traducción
          <select value={form.targetLanguage} disabled={busy || Boolean(editingId)} onChange={(event) => change("targetLanguage", event.target.value as TargetLanguageCode)}>
            {languageOptions.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
        </label>
      </div>
      <div className="glossary-pair">
        <label className="field">Término original
          <input required maxLength={120} value={form.sourceTerm} onChange={(event) => change("sourceTerm", event.target.value)} placeholder="charge" />
        </label>
        <label className="field">Traducción preferida
          <input required maxLength={120} value={form.preferredTranslation} onChange={(event) => change("preferredTranslation", event.target.value)} placeholder="cobro" />
        </label>
      </div>
      <label className="field">Tema o dominio (opcional)
        <input maxLength={80} value={form.domain} onChange={(event) => change("domain", event.target.value)} placeholder="Pagos" />
      </label>
      <label className="field">Ejemplo de uso (recomendado si el término tiene varios sentidos)
        <input maxLength={500} value={form.example} onChange={(event) => change("example", event.target.value)} placeholder="The charge appeared twice on my card." />
      </label>
      <label className="field">Nota sobre el significado (opcional)
        <textarea maxLength={500} value={form.notes} onChange={(event) => change("notes", event.target.value)} placeholder="Cargo en una tarjeta; no carga eléctrica." />
      </label>
      <div className="glossary-actions">
        <button className="song-primary" type="submit" disabled={busy || loading}>{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Agregar término"}</button>
        {editingId && <button className="ghost" type="button" disabled={busy} onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Cancelar edición</button>}
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="glossary-notice" role="status">{notice}</p>}
    </form>
    <div className="glossary-list">
      <h3>Entradas ({entries.length})</h3>
      {loading ? <p>Cargando glosario…</p> : entries.length === 0 ? <p>Aún no hay términos guardados.</p> :
        entries.map((entry) => <article className="glossary-entry" key={entry.id}>
          <div><span className="eyebrow">{entry.sourceLanguage.toUpperCase()} → {entry.targetLanguage.toUpperCase()}{entry.domain ? ` · ${entry.domain}` : ""}</span>
            <h4>{entry.sourceTerm} <span>→ {entry.preferredTranslation}</span></h4>
            {entry.example && <p>{entry.example}</p>}
          </div>
          <div className="glossary-entry-actions">
            <button className="ghost" disabled={busy} onClick={() => edit(entry)}>Editar</button>
            <button className="danger-button" disabled={busy} onClick={() => void remove(entry)}>Eliminar</button>
          </div>
        </article>)}
    </div>
  </section>;
};
