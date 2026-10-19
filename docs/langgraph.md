# LangGraph

## Por qué se usa

LangChain aporta prompts y runnables; LangGraph aporta control de flujo explícito. La traducción necesita una rama de validación y un ciclo de refinamiento limitado, no un agente autónomo.

~~~mermaid
stateDiagram-v2
  [*] --> detectLanguage
  detectLanguage --> analyzeContext
  analyzeContext --> translateText
  translateText --> validateTranslation
  validateTranslation --> [*]: válido
  validateTranslation --> refineTranslation: inválido y retry disponible
  refineTranslation --> validateTranslation
  validateTranslation --> [*]: agotado
~~~

## Estado

TranslationState conserva requestId, sessionId, texto, idiomas, tono, contexto, salida, validación, retryCount, maxRetries, tiempos y errores. processingTimes y errors usan reducers; los nodos retornan actualizaciones parciales.

## Nodos

1. detectLanguage evita el modelo si el idioma es explícito y usa heurísticas antes de inferencia.
2. analyzeContext recorta localmente a cuatro entradas; no gasta una inferencia.
   En Texto, al activar **Herramientas IA** y pulsar **Traducir con IA**, el paso siguiente permite que el modelo seleccione `search_glossary`, `disambiguate_term` y `read_context`. Son herramientas LangChain de lectura. `disambiguate_term` recibe un término validado que debe aparecer en el texto; el servidor toma idiomas y contexto de la solicitud validada y limita la ejecución a tres llamadas. El modelo no puede pedir otros datos ni escribir en D1. Si no selecciona `read_context`, el contexto previo no se envía a la traducción. Los sentidos candidatos se entregan como datos a la cadena de traducción; no se imponen todos como preferencias a la vez.
3. translateText ejecuta la cadena LangChain contra Workers AI.
4. validateTranslation preserva números, URLs, correos y placeholders; rechaza salidas vacías, etiquetas y truncamientos claros.
5. refineTranslation recibe defectos concretos y sólo puede ejecutarse una vez.

La invocación añade recursionLimit 12 como segunda barrera contra ciclos. El grafo optimizado para voz termina tras validar y evita refinamientos que aumenten latencia.

## Memoria

No se usa MemorySaver. En Texto, al activar Herramientas IA, D1 conserva hasta cuatro pares de texto y traducción validada por sesión e idiomas durante 24 horas. El servidor carga esos pares antes del grafo y `read_context` puede consultarlos; el botón **Borrar contexto** los elimina. El grafo sigue siendo independiente por solicitud. La voz en vivo conserva su propia ventana temporal en el WebSocket.
