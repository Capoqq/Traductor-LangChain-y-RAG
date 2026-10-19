import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../types";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

export const localRateLimit = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const now = Date.now();
  const key = c.req.header("cf-connecting-ip") ?? "local";
  let current = buckets.get(key);
  if (current && current.resetAt <= now) {
    buckets.delete(key);
    current = undefined;
  }
  if (!current && buckets.size >= 5_000) {
    for (const [id, value] of buckets) if (value.resetAt <= now) buckets.delete(id);
    if (buckets.size >= 5_000) {
      c.header("retry-after", "60");
      return c.json({ error: { code: "RATE_LIMITED", message: "Límite temporal alcanzado", requestId: c.get("requestId"), retryable: true } }, 429);
    }
  }
  const bucket = current ?? { count: 0, resetAt: now + WINDOW_MS };
  bucket.count += 1;
  buckets.set(key, bucket);

  c.header("x-ratelimit-limit", String(MAX_REQUESTS));
  c.header("x-ratelimit-remaining", String(Math.max(0, MAX_REQUESTS - bucket.count)));
  if (bucket.count > MAX_REQUESTS) {
    c.header("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return c.json({ error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes; inténtalo de nuevo en un minuto", requestId: c.get("requestId"), retryable: true } }, 429);
  }
  return next();
});


const loginAttempts = new Map<string, Bucket>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;

export const authLoginRateLimit = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const key = c.req.header("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const current = loginAttempts.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + LOGIN_WINDOW_MS } : current;
  bucket.count += 1;
  loginAttempts.set(key, bucket);
  if (loginAttempts.size > 1_000) {
    for (const [id, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(id);
  }
  if (bucket.count > LOGIN_MAX_ATTEMPTS) {
    c.header("retry-after", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return c.json({ error: { code: "LOGIN_RATE_LIMITED", message: "Demasiados intentos. Espera 15 minutos." } }, 429);
  }
  return next();
});
