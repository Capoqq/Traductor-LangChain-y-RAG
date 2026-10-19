# Costos y consumo

Precios consultados el 15 de octubre de 2026; compruebe siempre el catálogo antes de desplegar.

| Modalidad | Inferencias | Control principal |
| --- | --- | --- |
| Texto | LLM; detección sólo si es incierta | 5.000 caracteres, debounce 650 ms, cancelación, un refinamiento |
| Push-to-Talk | STT + LLM + TTS opcional | 8 MB, un segmento final, TTS sólo es/en |
| Continuo | STT + LLM por segmento + TTS | 3,5 s, cola serial, contexto de cuatro entradas |

El modo Canciones (beta) usa Whisper y traducción por cada fragmento reconocido de 28 segundos, con máximo de 20 MB y 5 minutos; no sintetiza voz.

Referencias actuales:

- GLM-4.7 Flash: modelo multilingüe económico; revisar su página antes de uso.
- Nova-3: USD 0,0052/min HTTP y USD 0,0092/min WebSocket.
- Whisper Large V3 Turbo: aproximadamente USD 0,0005/min.
- Aura-2 es/en: USD 0,03 por 1.000 caracteres.
- Workers AI incluye una asignación diaria en neurons, pero algunos modelos requieren plan pago.

No se habilitó plan pago. La API pública necesita alertas de gasto y Rate Limiting. Las métricas guardan duración/modelo/reintentos; por privacidad no guardan texto o audio.

Fuentes: https://developers.cloudflare.com/workers-ai/platform/pricing/ y el catálogo de modelos de Workers AI.
