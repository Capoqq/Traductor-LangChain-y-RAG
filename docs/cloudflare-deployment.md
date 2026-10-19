# Despliegue en Cloudflare

No se realizó un despliegue ni se habilitó facturación.

## Preparación

1. Cree una cuenta en https://dash.cloudflare.com/.
2. Revise Workers & Pages → Plans y Workers AI → Usage. No cambie a pago sin decidirlo.
3. Instale dependencias con npm install.
4. Autentique Wrangler con npx wrangler login.
5. Genere tipos con npm run cf-typegen.
6. Ejecute npm run dev y pruebe /api/health.
7. Para inferencia local real use el binding remoto soportado por Wrangler; no copie tokens al frontend.
8. Ejecute typecheck, lint, test y build.
9. Revise wrangler.jsonc, especialmente modelos, fecha y origen permitido.
10. Despliegue sólo con autorización: npm run deploy.

## Logs y actualizaciones

Use npx wrangler tail para logs estructurados. Actualice dependencias en una rama, regenere tipos y repita las cuatro verificaciones. Consulte uso/costos en Workers AI y AI Gateway.

## Reversión

Liste versiones con Wrangler y use el comando de rollback correspondiente a la versión instalada. Verifique primero la ayuda local (npx wrangler --help), porque la CLI cambia. Una reversión no revierte secretos o cambios de facturación.

## Bindings y secretos

El binding AI está en wrangler.jsonc y no necesita una API key dentro del código. ALLOWED_ORIGIN puede configurarse por entorno. Un futuro relay AI Gateway WebSocket debe usar un secreto server-side configurado con Wrangler; nunca VITE_*.
