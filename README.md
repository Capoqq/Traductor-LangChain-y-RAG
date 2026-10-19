# AI Live Translator

Aplicación full-stack educativa para traducir texto y voz con React, Hono, LangChain, un StateGraph real de LangGraph y Cloudflare Workers AI.

## Estado

Implementado:

- Traducción de texto automática con debounce, cancelación y eventos SSE de progreso por nodo (no tokens de traducción).
- Grafo: detectar idioma → analizar contexto → traducir → validar → refinar (máximo un intento).
- Push-to-Talk con Whisper batch, y voz en vivo con WebSocket + Deepgram Nova-3.
- Modo Canciones (beta): carga un archivo desde el celular o PC, lo decodifica localmente y crea fragmentos WAV de 28 s con 1 s de solapamiento para Whisper y el grafo de traducción. No usa el micrófono ni separa voz e instrumentos. Límite: 20 MB y 5 minutos.
- Glosario contextual editable para Texto y Canciones: D1 guarda las preferencias, LangChain recupera las entradas aplicables y Vectorize con `bge-m3` distingue sentidos ambiguos. Incluye 22 entradas inglés↔español del Tesauro de la UNESCO y seis ejemplos con sentidos distintos de `charge`, `bank` y `current`. La respuesta muestra el sentido que se puede identificar en la traducción y una explicación breve. Consulta [la guía del glosario](docs/glossary-rag.md). No altera Voz en vivo.
- Herramientas IA opcionales en Texto: al pulsar **Traducir con IA**, GLM puede consultar el glosario, recuperar sentidos de un término ambiguo o leer el contexto previo. El servidor ejecuta solo estas herramientas de lectura y muestra cuáles se usaron. Con esta opción, D1 conserva hasta cuatro pares de texto y traducción confirmada durante 24 horas por sesión e idiomas, para que `read_context` pueda consultarlos sin entrada manual. El usuario puede borrarlos. Esta opción añade una inferencia y puede aumentar la latencia y el consumo de Workers AI; la traducción normal conserva el inicio automático.
- Nova-3 emite transcripción parcial; la voz en vivo traduce al finalizar cada segmento y usa cortes temporales solo para prefijos estables o como respaldo. M2M100 sigue siendo la ruta rápida; LangGraph corrige con contexto solo los fragmentos ambiguos o inválidos, con un presupuesto de tiempo limitado.
- API Hono, Zod, límites de entrada, errores estructurados y logging sin contenido privado.
- Tests unitarios del contrato, validación y transiciones del grafo.
- Configuración para un despliegue full-stack con Cloudflare Vite Plugin.

Pendiente de validación en cuenta real y despliegue: la voz en vivo usa Nova-3 por WebSocket y necesita que Workers AI esté disponible para la cuenta. Push-to-Talk conserva Whisper y el formato MediaRecorder debe probarse en cada navegador. La reconexión automática de una sesión Nova-3 se puede añadir posteriormente.

El modo Canciones depende de que el navegador pueda decodificar el archivo; una mezcla musical densa puede no producir letra reconocible. Aún requiere validación con archivos reales en un celular.

## Arquitectura

~~~mermaid
flowchart LR
  UI[React + Web Audio] -->|HTTP / SSE| API[Hono Worker]
  API --> GRAPH[LangGraph StateGraph]
  GRAPH --> LC[LangChain prompt + runnable]
  LC --> AI[Workers AI binding]
  API --> STT[Whisper batch]
  API --> TTS[Aura-2 es/en]
~~~

LangChain construye prompts tipados y conecta el runnable con el adaptador del modelo. LangGraph controla estado, nodos, ramas y el ciclo acotado. No se usa un agente con herramientas porque traducir es un workflow determinista.

## Inicio local

Requisitos: Node.js 20+ y una cuenta de Cloudflare para inferencia real.

~~~bash
npm install
npm run cf-typegen
npm run dev
~~~

Copie .dev.vars.example a .dev.vars sólo si necesita variables locales. No coloque secretos en variables VITE_*.

## Verificación

~~~bash
npm run typecheck
npm run lint
npm test
npm run build
~~~

## API

- GET /api/health
- GET /api/models
- POST /api/translate
- POST /api/translate/stream (SSE sobre POST)
- GET /api/speech/live?language=multi (WebSocket Nova-3, exclusivo de Voz en vivo)
- POST /api/speech/transcribe?language=auto&mode=song (Whisper sin VAD, WAV PCM16 mono de 16 kHz, fragmentos de hasta 30 s)
- POST /api/speech/transcribe?language=auto (Whisper, audio binario, máximo 8 MB)
- POST /api/speech/synthesize
- GET/POST /api/glossary y PUT/DELETE /api/glossary/:id (requieren bindings D1 y Vectorize)
- GET/DELETE /api/session/context (consulta el número de fragmentos de una sesión o los borra)

## Modelo elegido

El texto usa @cf/zai-org/glm-4.7-flash mediante LangChain y LangGraph. La voz con idioma de origen conocido usa @cf/meta/m2m100-1.2b dentro del mismo grafo para traducir bloques cortos; si el idioma sigue indeterminado, usa el modelo configurado en TRANSLATION_MODEL.

## Documentación

- [Arquitectura](docs/architecture.md)
- [LangGraph](docs/langgraph.md)
- [Audio en tiempo real](docs/realtime-audio.md)
- [Despliegue](docs/cloudflare-deployment.md)
- [Costos](docs/costs.md)
- [Pruebas](docs/testing.md)
- [Glosario contextual y RAG](docs/glossary-rag.md)

## Privacidad y seguridad

- La API exige una contraseña como secreto y usa una cookie de sesión HttpOnly, SameSite=Strict, firmada y con expiración de 8 horas.
- El login limita intentos; la API limita la frecuencia y acota los cuerpos de JSON y audio antes de procesarlos.
- Se validan solicitudes cross-site y se aplican cabeceras CSP, anti-iframe, no-sniff y HSTS cuando se usa HTTPS.
- No se registran texto, traducciones ni audio en los logs. Al activar Herramientas IA se guardan en D1 hasta cuatro pares de texto y traducción confirmada por sesión durante 24 horas; **Borrar contexto** los elimina antes. Los stacks de error solo se imprimen con APP_ENV=development.
- Las entradas del glosario sí se almacenan en D1 y se convierten en vectores para la búsqueda; todos los usuarios con la contraseña comparten el mismo glosario.
- Para desarrollo local, configura APP_ACCESS_PASSWORD en .dev.vars (mínimo 32 caracteres); el archivo está ignorado por Git. Para despliegue, configura el secreto con npx wrangler secret put APP_ACCESS_PASSWORD.
- El rate limit en memoria ayuda en desarrollo, pero en producción debe complementarse con límites/rate limiting de Cloudflare a nivel de cuenta. No mantengas un Quick Tunnel público activo si no lo necesitas.

Workers AI se conecta a Cloudflare desde desarrollo local y el uso consume la cuota de la cuenta.
