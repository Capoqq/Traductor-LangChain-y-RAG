# Pruebas

## Suites

- contracts.test.ts: defaults y límites Zod.
- validation.test.ts: tokens protegidos y agotamiento.
- graph.test.ts: camino feliz, refinamiento y omisión de detección innecesaria.
- provider.test.ts: formas de respuesta legacy y Chat Completions/GLM.
- endpoints.test.ts: health y rechazo temprano de solicitudes inválidas.

Todos los tests usan TranslationProvider falso. No existe mock de producción.

Las pruebas de Canciones cubren la fragmentación, la cabecera WAV PCM16, el texto solapado, la validación HTTP del fragmento y la desactivación de VAD.

## Comandos

~~~bash
npm run typecheck
npm run lint
npm test
npm run build
~~~

Una prueba real opcional requiere Wrangler autenticado y binding AI. Debe ejecutarse conscientemente porque consume cuota. No se incluye en la suite predeterminada.

Para probar Canciones en el celular: abre la pestaña Canciones, selecciona un MP3/M4A/WAV de menos de 20 MB y 5 minutos, confirma el idioma de destino y pulsa **Transcribir y traducir**. Empieza con un fragmento de voz clara y poco instrumental. Comprueba que aparezcan tanto el texto original como la traducción por fragmento; Cancelar debe detener las solicitudes siguientes. Los archivos de Spotify o YouTube que no puedas guardar como audio local no pueden seleccionarse desde este modo.

## Casos siguientes

Al habilitar WebSocket se deben añadir pruebas de reconexión, segmentId duplicado, secuencia fuera de orden, backpressure, timeout y cierre de sesión.
