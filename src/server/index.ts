import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health";
import { speechRoutes } from "./routes/speech";
import { translateRoutes } from "./routes/translate";
import { glossaryRoutes } from "./routes/glossary";
import { sessionContextRoutes } from "./routes/session-context";
import { requestContext } from "./middleware/request-context";
import { authLoginRateLimit, localRateLimit } from "./middleware/rate-limit";
import { authRoutes, requireApiAuthentication } from "./middleware/auth";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", requestContext);
app.use("/api/auth/login", authLoginRateLimit);
app.use("/api/*", localRateLimit);
app.use("/api/*", requireApiAuthentication);
app.use("/api/*", async (c, next) => {
  const middleware = cors({
    origin: c.env.ALLOWED_ORIGIN ? [c.env.ALLOWED_ORIGIN] : [],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Request-Id"],
    maxAge: 600,
  });
  return middleware(c, next);
});

app.route("/api", authRoutes);
app.route("/api", healthRoutes);
app.route("/api", translateRoutes);
app.route("/api", glossaryRoutes);
app.route("/api", sessionContextRoutes);
app.route("/api", speechRoutes);

app.onError((error, c) => {
  const serializeError = (value: unknown, seen = new Set<object>()): unknown => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    if (seen.has(value as object)) return "[Circular error detail]";
    seen.add(value as object);
    const detail = value as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown; code?: unknown; status?: unknown; statusText?: unknown; internalCode?: unknown };
    const serialized: Record<string, unknown> = {
      name: typeof detail.name === "string" ? detail.name : value instanceof Error ? value.name : undefined,
      message: typeof detail.message === "string" ? detail.message : undefined,
      stack: typeof detail.stack === "string" ? detail.stack : undefined,
    };
    for (const key of ["code", "status", "statusText", "internalCode"] as const) {
      const field = detail[key];
      if (typeof field === "string" || typeof field === "number") serialized[key] = field;
    }
    if (detail.cause !== undefined) serialized.cause = serializeError(detail.cause, seen);
    if (!serialized.name && !serialized.message && !serialized.stack) serialized.value = String(value);
    return serialized;
  };
  console.error(JSON.stringify({
    event: "request.failed",
    requestId: c.get("requestId"),
    errorCode: "INTERNAL_ERROR",
    error: c.env.APP_ENV === "development" ? serializeError(error) : { name: error.name, message: "Internal server error" },
  }));
  const message = c.env.APP_ENV === "development" ? error.message : "No se pudo procesar la solicitud";
  return c.json({ error: { code: "INTERNAL_ERROR", message, requestId: c.get("requestId"), retryable: true } }, 500);
});

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada", requestId: c.get("requestId") } }, 404);
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text("AI Live Translator", 200);
});

export default app;
