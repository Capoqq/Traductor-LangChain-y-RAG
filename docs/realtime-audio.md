# Audio y tiempo real

## Flujo implementado

~~~mermaid
sequenceDiagram
  participant U as Usuario
  participant B as Navegador
  participant W as Worker
  participant AI as Workers AI
  U->>B: activa Pulsar para hablar
  B->>W: Opus/WebM u Ogg al terminar
  W->>AI: Whisper batch
  AI-->>W: transcripción final
  W->>AI: traducción
  AI-->>B: texto y voz opcional
  U->>B: activa Voz en vivo
  B->>W: PCM linear16 continuo (WebSocket)
  W->>AI: Nova-3 WebSocket
  AI-->>B: transcripción parcial y final
  B->>W: traduce palabras nuevas cada 3 s
~~~

## Modos

- **Pulsar para hablar** conserva @cf/openai/whisper-large-v3-turbo por HTTP. Graba hasta que el usuario detiene la sesión y después transcribe, traduce y sintetiza.
- **Voz en vivo** usa @cf/deepgram/nova-3 para transcribir en /api/speech/live. El navegador envía PCM mono linear16 de 16 kHz por WebSocket. Los segmentos finales se traducen de inmediato; cada tres segundos se revisan prefijos parciales estables y, tras seis segundos sin final, se envía un prefijo de respaldo conservando las dos últimas palabras. El grafo usa @cf/meta/m2m100-1.2b como primera traducción cuando conoce el idioma de origen. Solo los fragmentos breves ambiguos o las salidas inválidas pasan por una corrección contextual limitada a cuatro segundos. Una traducción que siga inválida se omite y no se sintetiza.

- **Canciones (beta)** recibe un archivo de audio desde el selector del navegador, sin capturar micrófono. El navegador lo decodifica y remuestrea a WAV PCM16 mono de 16 kHz en fragmentos de 28 s con 1 s de solapamiento. Se elimina texto repetido en los bordes y cada fragmento se envía a Whisper Large v3 Turbo con VAD desactivado. La letra reconocida pasa por el grafo existente con M2M100 como ruta rápida. El archivo no se persiste en el servidor; el procesamiento se puede cancelar y conserva los resultados terminados. Límites: 20 MB y 5 minutos. No hay separación de voz e instrumentos ni garantía de reconocer cantos con mezcla densa.

El token de Cloudflare nunca llega al navegador: el Worker establece la conexión mediante el binding AI y devuelve la sesión WebSocket al cliente autenticado.

## Coste y límites

Nova-3 WebSocket consume más cuota que Whisper. La aplicación solo lo abre en Voz en vivo y lo limita a diez minutos por sesión. Detener la sesión cierra el socket, los contextos de audio y los tracks del micrófono.

Canciones realiza una inferencia Whisper y, si hay letra, una traducción por fragmento; procesar un archivo completo consume cuota de Workers AI. Cancelar detiene nuevas solicitudes, pero no revierte las inferencias ya enviadas.

## Formatos

MediaRecorder elige audio/webm;codecs=opus y luego audio/ogg;codecs=opus para Pulsar para hablar. Para Nova-3, se realiza remuestreo en el navegador a PCM de 16 kHz antes de cada envío binario.

## Limitaciones actuales

Ante una caída de red, la interfaz muestra **Desconectado** y el usuario debe reiniciar la sesión. No se persiste historial entre reconexiones; añadir reconexión con backoff y Durable Objects es una mejora futura.
