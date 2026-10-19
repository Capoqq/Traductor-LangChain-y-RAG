import { Hono } from "hono";
import { z } from "zod";
import { languageSchema, targetLanguageSchema } from "../../shared/contracts";
import { PayloadTooLargeError, readJsonBody } from "../middleware/body";
import { clearSessionContext, loadSessionContext } from "../services/session-context";
import type { Env, Variables } from "../types";

const sessionSchema = z.object({ sessionId: z.uuid() });
const querySchema = sessionSchema.extend({ sourceLanguage: languageSchema, targetLanguage: targetLanguageSchema });

export const sessionContextRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/session/context", async (c) => {
    if (!c.env.GLOSSARY_DB) return c.json({ error: { code: "SESSION_CONTEXT_UNAVAILABLE", message: "La memoria de sesión no está configurada." } }, 503);
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: { code: "INVALID_REQUEST", message: "Sesión o idiomas inválidos." } }, 400);
    const entries = await loadSessionContext(c.env.GLOSSARY_DB, parsed.data.sessionId, parsed.data.sourceLanguage, parsed.data.targetLanguage);
    return c.json({ count: entries.length });
  })
  .delete("/session/context", async (c) => {
    if (!c.env.GLOSSARY_DB) return c.json({ error: { code: "SESSION_CONTEXT_UNAVAILABLE", message: "La memoria de sesión no está configurada." } }, 503);
    let body: unknown;
    try { body = await readJsonBody(c.req.raw, 2048); }
    catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Solicitud demasiado grande." } }, 413);
      return c.json({ error: { code: "INVALID_REQUEST", message: "Solicitud inválida." } }, 400);
    }
    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: "INVALID_REQUEST", message: "Sesión inválida." } }, 400);
    await clearSessionContext(c.env.GLOSSARY_DB, parsed.data.sessionId);
    return c.json({ cleared: true });
  });
