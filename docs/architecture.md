# Arquitectura

## Decisiones

Se usa un único Cloudflare Worker con assets estáticos. Hono posee la API y el binding env.AI mantiene credenciales fuera del navegador. Los proveedores aíslan texto, STT y TTS para poder reemplazar modelos sin tocar rutas o grafo.

~~~mermaid
flowchart TB
  subgraph Browser
    React
    Mic[MediaRecorder / Web Audio]
    Queue[Cola de reproducción]
  end
  subgraph Worker
    Hono
    Zod
    Graph[StateGraph]
    Providers
  end
  React --> Hono
  Mic -->|binario| Hono
  Hono --> Zod --> Graph
  Graph --> Providers --> AI[Workers AI]
  AI --> Queue
~~~

## Transporte

Texto usa HTTP normal o POST con SSE. Push-to-Talk usa HTTP binario. El prototipo continuo beta envía cortes temporales y los serializa en el cliente; no los considera transcripciones parciales fiables. Un WebSocket será apropiado para parciales reales de Nova-3, pero requiere intermediación segura del Worker.

## Estado

El grafo es una función sin checkpointer. Para el MVP el cliente envía una ventana de contexto validada. No se usa MemorySaver como persistencia porque el isolate puede reciclarse. Una versión WebSocket debe usar un Durable Object por sesión para ordenar, deduplicar y persistir una ventana corta.

## Seguridad

- Entradas Zod, 5.000 caracteres y audio máximo 8 MB.
- Secretos sólo en bindings/Worker.
- Error público sin stack ni respuesta cruda del proveedor.
- Logging estructurado de metadatos, nunca contenido.
- La protección de producción debe complementar el límite de aplicación con Rate Limiting de Cloudflare.
