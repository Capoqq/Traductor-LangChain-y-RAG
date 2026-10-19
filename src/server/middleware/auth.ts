import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../types";
import { PayloadTooLargeError, readJsonBody } from "./body";

const COOKIE_NAME = "ai_translator_session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

const secureRequest = (request: Request) => request.url.startsWith("https:") || request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";

const originMatchesHost = (request: Request, origin: string) => {
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
    const requestHost = forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host.toLowerCase() === requestHost.toLowerCase();
  } catch {
    return false;
  }
};

const configuredPassword = (env: Env) => {
  const password = env.APP_ACCESS_PASSWORD?.trim();
  return password && password.length >= 32 ? password : undefined;
};

const importSigningKey = (password: string) => crypto.subtle.importKey(
  "raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
);

const signatureFor = async (password: string, expiresAt: string) => {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await importSigningKey(password), encoder.encode(expiresAt)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const getCookie = (header: string | undefined) => header?.split(";").map((item) => item.trim())
  .find((item) => item.startsWith(COOKIE_NAME + "="))?.slice(COOKIE_NAME.length + 1);

const hasValidSession = async (request: Request, password: string) => {
  const value = getCookie(request.headers.get("cookie") ?? undefined);
  if (!value) return false;
  const [expiresAt, suppliedSignature, extra] = value.split(".");
  if (!expiresAt || !suppliedSignature || extra || !/^\d{13}$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return false;
  try {
    const normalized = suppliedSignature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return crypto.subtle.verify("HMAC", await importSigningKey(password), signature, encoder.encode(expiresAt));
  } catch {
    return false;
  }
};

const passwordMatches = async (provided: string, expected: string) => {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedDigest);
  const b = new Uint8Array(expectedDigest);
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
};

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/auth/session", async (c) => {
    const password = configuredPassword(c.env);
    c.header("cache-control", "no-store");
    return c.json({ configured: Boolean(password), authenticated: password ? await hasValidSession(c.req.raw, password) : false });
  })
  .post("/auth/login", async (c) => {
    c.header("cache-control", "no-store");
    const password = configuredPassword(c.env);
    if (!password) return c.json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Configura APP_ACCESS_PASSWORD con al menos 32 caracteres en .dev.vars y reinicia el servidor." } }, 503);
    const contentType = (c.req.header("content-type") ?? "").split(";")[0].toLowerCase();
    if (contentType !== "application/json") return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json" } }, 415);
    const origin = c.req.header("origin");
    if (c.req.header("sec-fetch-site") === "cross-site" || (origin && !originMatchesHost(c.req.raw, origin) && c.req.header("sec-fetch-site") !== "same-origin")) {
      return c.json({ error: { code: "CROSS_SITE_REQUEST", message: "Solicitud no permitida" } }, 403);
    }
    let body: { password?: unknown } | null;
    try {
      body = await readJsonBody(c.req.raw, 4096) as { password?: unknown } | null;
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Solicitud demasiado grande" } }, 413);
      throw error;
    }
    if (!body || typeof body.password !== "string" || body.password.length > 256) {
      return c.json({ error: { code: "INVALID_CREDENTIALS", message: "Contraseña incorrecta" } }, 401);
    }
    if (!await passwordMatches(body.password, password)) return c.json({ error: { code: "INVALID_CREDENTIALS", message: "Contraseña incorrecta" } }, 401);

    const expiresAt = String(Date.now() + SESSION_SECONDS * 1000);
    const signature = await signatureFor(password, expiresAt);
    const secure = secureRequest(c.req.raw) ? "; Secure" : "";
    c.header("set-cookie", COOKIE_NAME + "=" + expiresAt + "." + signature + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + SESSION_SECONDS + secure);
    return c.json({ authenticated: true });
  })
  .post("/auth/logout", (c) => {
    c.header("cache-control", "no-store");
    const secure = secureRequest(c.req.raw) ? "; Secure" : "";
    c.header("set-cookie", COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure);
    return c.json({ authenticated: false });
  });

export const requireApiAuthentication = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  if (c.req.header("sec-fetch-site") === "cross-site" || (origin && !originMatchesHost(c.req.raw, origin))) {
    return c.json({ error: { code: "CROSS_SITE_REQUEST", message: "Solicitud no permitida" } }, 403);
  }
  if (c.req.path.startsWith("/api/auth/")) return next();
  const password = configuredPassword(c.env);
  c.header("cache-control", "no-store");
  if (!password) return c.json({ error: { code: "AUTH_NOT_CONFIGURED", message: "La API está bloqueada hasta configurar el acceso." } }, 503);
  if (!await hasValidSession(c.req.raw, password)) {
    return c.json({ error: { code: "AUTH_REQUIRED", message: "Inicia sesión para usar la aplicación." } }, 401);
  }
  return next();
});
