import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../types";

export const requestContext = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const suppliedRequestId = c.req.header("x-request-id");
  const requestId = suppliedRequestId && /^[a-zA-Z0-9-]{1,80}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  c.set("requestId", requestId);
  c.set("startedAt", Date.now());
  c.header("x-request-id", requestId);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "microphone=(self)");
  c.header("x-frame-options", "DENY");
  c.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (new URL(c.req.url).protocol === "https:") c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  await next();
  console.log(JSON.stringify({
    event: "request.completed",
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    totalDurationMs: Date.now() - c.get("startedAt"),
  }));
});
