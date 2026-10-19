import { readFile } from "node:fs/promises";

const apply = process.argv.includes("--apply");
const examplesOnly = process.argv.includes("--examples-only");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--apply" && arg !== "--examples-only");
if (unknown.length) {
  console.error(`Argumentos desconocidos: ${unknown.join(", ")}`);
  process.exit(1);
}

const seed = JSON.parse(await readFile(new URL("../data/glossary-starter.json", import.meta.url), "utf8"));
const unescoEntries = seed.pairs.flatMap(({ en, es, concept }) => {
  if (![en, es, concept].every((value) => typeof value === "string" && value.trim())) {
    throw new Error("El glosario inicial contiene una equivalencia incompleta.");
  }
  const notes = `Fuente: Tesauro de la UNESCO, concepto ${concept}. https://vocabularies.unesco.org/unesco/en/page/concept${concept}`;
  return [
    { sourceLanguage: "en", targetLanguage: "es", sourceTerm: en, preferredTranslation: es, domain: "tecnología e IA", example: "", notes },
    { sourceLanguage: "es", targetLanguage: "en", sourceTerm: es, preferredTranslation: en, domain: "tecnología e IA", example: "", notes },
  ];
});
const ambiguous = JSON.parse(await readFile(new URL("../data/glossary-ambiguous.json", import.meta.url), "utf8"));
if (!Array.isArray(ambiguous.entries)) throw new Error("El glosario de sentidos no contiene entradas.");
const entries = examplesOnly ? ambiguous.entries : [...ambiguous.entries, ...unescoEntries];

console.log(`${entries.length} entradas preparadas: ${examplesOnly ? 0 : unescoEntries.length} de ${seed.source} (${seed.license}) y ${ambiguous.entries.length} ejemplos de sentidos.`);
if (!apply) {
  console.log("Vista previa: no se ha enviado nada. Usa npm run glossary:import -- --apply para cargar las entradas.");
  process.exit(0);
}

const base = new URL(process.env.GLOSSARY_IMPORT_URL || "http://localhost:5173");
if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
  throw new Error("Usa HTTPS para un servidor remoto; HTTP solo se admite en localhost.");
}
const password = process.env.GLOSSARY_IMPORT_PASSWORD;
if (!password) throw new Error("Define GLOSSARY_IMPORT_PASSWORD antes de importar.");

const request = async (url, options) => {
  const attempts = options.method === "POST" ? 1 : 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25_000) });
      if ((response.status !== 429 && response.status < 500) || attempt === attempts) return response;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error("No se pudo completar la solicitud.");
};

const login = await request(new URL("/api/auth/login", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error(`No se pudo iniciar sesión (${login.status}). Revisa la contraseña.`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("El servidor no devolvió la cookie de sesión.");

const existingResponse = await request(new URL("/api/glossary", base), { headers: { cookie } });
if (!existingResponse.ok) {
  const detail = await existingResponse.json().catch(() => null);
  throw new Error(`Glosario no disponible (${existingResponse.status}): ${detail?.error?.message ?? "revisa D1 y Vectorize"}`);
}
const existing = (await existingResponse.json()).entries;
if (!Array.isArray(existing)) throw new Error("Respuesta inesperada de /api/glossary.");
const key = ({ sourceLanguage, targetLanguage, sourceTerm, preferredTranslation, domain }) =>
  `${sourceLanguage}:${targetLanguage}:${sourceTerm.normalize("NFC").toLocaleLowerCase()}:${preferredTranslation.normalize("NFC").toLocaleLowerCase()}:${domain.normalize("NFC").toLocaleLowerCase()}`;
const known = new Set(existing.map(key));
let added = 0;
let skipped = 0;

for (const entry of entries) {
  if (known.has(key(entry))) {
    skipped += 1;
    continue;
  }
  const response = await request(new URL("/api/glossary", base), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(entry),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(`Importación detenida tras ${added} entradas: ${entry.sourceTerm} (${response.status}): ${detail?.error?.message ?? "error desconocido"}`);
  }
  known.add(key(entry));
  added += 1;
  console.log(`${added}/${entries.length} cargadas: ${entry.sourceTerm} → ${entry.preferredTranslation} (${entry.domain})`);
}

console.log(`Importación completada: ${added} nuevas; ${skipped} omitidas porque ya existían.`);
