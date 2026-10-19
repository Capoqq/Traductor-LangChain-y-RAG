# Glosario contextual con RAG

El glosario usa D1 como fuente de verdad y Vectorize para elegir entre significados de un mismo término. LangChain recupera entradas y LangGraph las incorpora antes de traducir. Texto y Canciones lo usan automáticamente; Voz y Voz continua conservan la ruta rápida sin consultas al glosario.

Cada entrada tiene idiomas, término, traducción preferida, dominio, ejemplo y nota. No se fragmenta: una entrada es un documento. Una coincidencia exacta con un único sentido no consume inferencia de embeddings al traducir. Si hay varios sentidos, `@cf/baai/bge-m3` genera un vector de la frase y Vectorize ordena las opciones. Si falla esa búsqueda, se omiten los términos ambiguos. El modelo de traducción recibe las preferencias como datos, no como instrucciones.

## Activación en tu cuenta Cloudflare

La aplicación mantiene el glosario desactivado hasta que existan ambos bindings. No se incluyeron IDs ficticios en `wrangler.jsonc` porque impedirían iniciar el proyecto tal como está.

1. Comprueba que Wrangler está autenticado: `npx wrangler whoami`.
2. Crea D1: `npx wrangler d1 create ai-live-translator-glossary`. Copia el `database_id` real de la respuesta.
3. Crea el índice: `npx wrangler vectorize create ai-live-translator-glossary --dimensions=1024 --metric=cosine`.
4. Añade estas propiedades al objeto raíz de `wrangler.jsonc` (sin borrar las existentes):

```jsonc
"d1_databases": [
  {
    "binding": "GLOSSARY_DB",
    "database_name": "ai-live-translator-glossary",
    "database_id": "ID_REAL_DEVUELTO_POR_WRANGLER",
    "migrations_dir": "migrations"
  }
],
"vectorize": [
  { "binding": "GLOSSARY_INDEX", "index_name": "ai-live-translator-glossary" }
]
```

5. Aplica la migración local: `npx wrangler d1 migrations apply ai-live-translator-glossary --local`.
6. Reinicia `npm run dev` y abre la pestaña **Glosario**. Añade primero un término de prueba, por ejemplo `charge → cobro` en inglés→español, dominio `pagos`, ejemplo `The charge appeared twice`.
7. Antes de desplegar, aplica la migración remota con `npx wrangler d1 migrations apply ai-live-translator-glossary --remote`. Este comando modifica la base remota; revisa el destino antes de confirmarlo. Después ejecuta `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`, y despliega con `npm run deploy` cuando lo decidas.

El binding AI existente ejecuta los embeddings; no hace falta una clave nueva de OpenAI. Usa el mismo modelo de embeddings para indexar y consultar; si cambias de modelo, crea otro índice y reindexa. Las altas, cambios y bajas en Vectorize son asíncronas y pueden tardar unos segundos en aparecer en búsquedas semánticas; D1 sigue siendo la fuente de datos. El glosario es compartido por todos quienes conocen la contraseña de la aplicación: todavía no hay cuentas separadas.

## Glosario inicial verificable

Incluimos [22 entradas de tecnología e IA](../data/glossary-starter.json), once equivalencias inglés-español y sus inversas. La selección procede del [Tesauro de la UNESCO](https://vocabularies.unesco.org/en/about), publicado bajo [CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/). Cada entrada conserva en `notes` el enlace a su concepto. También incluimos [seis ejemplos propios de sentidos](../data/glossary-ambiguous.json) para `charge`, `bank` y `current` en inglés→español. La interfaz explica un sentido elegido solo cuando la traducción permite identificar una preferencia única. Es un vocabulario de prueba, no un diccionario general; revisa las preferencias antes de usarlo para textos de otros ámbitos. El archivo de datos conserva la atribución y la licencia de la fuente.

Después de crear los bindings y aplicar la migración, puedes cargarlo en el servidor local sin escribir las entradas a mano:

```powershell
npm run glossary:import
$env:GLOSSARY_IMPORT_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Contraseña de la app' -AsSecureString)).Password
npm run glossary:import -- --apply
Remove-Item Env:GLOSSARY_IMPORT_PASSWORD
```

El primer comando solo muestra cuántas entradas hay; `--apply` realiza las escrituras e inferencias de embeddings. `--examples-only --apply` carga únicamente los seis ejemplos de sentidos. Si usas un despliegue remoto, define además `GLOSSARY_IMPORT_URL` con su dirección HTTPS antes de ejecutar. El importador omite las entradas que ya existen según idioma, término, traducción y dominio, y nunca las sobrescribe. Si se interrumpe, vuelve a ejecutarlo. La creación en Vectorize consume cuota de Workers AI.

## API

- `GET /api/glossary`: lista hasta 500 entradas.
- `POST /api/glossary`: crea una entrada.
- `PUT /api/glossary/:id`: edita texto, traducción y contexto; para cambiar idiomas crea otra entrada.
- `DELETE /api/glossary/:id`: elimina una entrada.

Todas las rutas requieren la sesión existente. El contrato de escritura es:

```json
{
  "sourceLanguage": "en",
  "targetLanguage": "es",
  "sourceTerm": "charge",
  "preferredTranslation": "cobro",
  "domain": "pagos",
  "example": "The charge appeared twice on my card.",
  "notes": "Cargo de dinero en la tarjeta."
}
```

Para una traducción por API, envía `"useGlossary": true`. La respuesta incluye `glossaryMatches`, los sentidos consultados en `termSenses` y los sentidos identificables en `glossaryChoices`. Sin bindings, las traducciones existentes siguen funcionando sin glosario y `/api/glossary` responde `GLOSSARY_NOT_CONFIGURED`.

## Cuota y limitaciones

Crear o editar entradas consume una inferencia de embeddings. Una traducción sólo la consume si el texto contiene un término con varios sentidos; la búsqueda Vectorize también consume cuota. El glosario no corrige errores de transcripción de Whisper y, de momento, no participa en Voz en vivo. Para mejorar la elección semántica, añade ejemplos distintos a las entradas que comparten término.
