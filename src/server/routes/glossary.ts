import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { glossaryInputSchema } from "../../shared/glossary";
import { PayloadTooLargeError, readJsonBody } from "../middleware/body";
import {
  countGlossary, createGlossaryEntry, deleteGlossary, getGlossary, indexGlossary,
  insertGlossary, listGlossary, MAX_GLOSSARY_ENTRIES, removeGlossaryIndex, updateGlossary,
} from "../services/glossary";
import type { Env, Variables } from "../types";

const invalid = (requestId: string) => ({ error: { code: "INVALID_GLOSSARY", message: "Revisa los idiomas y los campos del glosario.", requestId } });

const glossaryConfigured = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  if (!c.env.GLOSSARY_DB || !c.env.GLOSSARY_INDEX) {
    return c.json({ error: { code: "GLOSSARY_NOT_CONFIGURED", message: "Configura los bindings GLOSSARY_DB y GLOSSARY_INDEX para activar el glosario.", requestId: c.get("requestId") } }, 503);
  }
  return next();
});

export const glossaryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .use("/glossary", glossaryConfigured)
  .use("/glossary/*", glossaryConfigured)
  .get("/glossary", async (c) => c.json({ entries: await listGlossary(c.env.GLOSSARY_DB!) }))
  .post("/glossary", async (c) => {
    if ((c.req.header("content-type") ?? "").split(";")[0].toLowerCase() !== "application/json") {
      return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json" } }, 415);
    }
    let raw: unknown;
    try {
      raw = await readJsonBody(c.req.raw, 8 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Entrada demasiado grande" } }, 413);
      return c.json(invalid(c.get("requestId")), 400);
    }
    const parsed = glossaryInputSchema.safeParse(raw);
    if (!parsed.success) return c.json(invalid(c.get("requestId")), 400);
    if (await countGlossary(c.env.GLOSSARY_DB!) >= MAX_GLOSSARY_ENTRIES) {
      return c.json({ error: { code: "GLOSSARY_LIMIT", message: `El glosario admite hasta ${MAX_GLOSSARY_ENTRIES} entradas.` } }, 409);
    }
    const entry = createGlossaryEntry(parsed.data);
    await indexGlossary(c.env.AI, c.env.GLOSSARY_INDEX!, entry);
    try {
      await insertGlossary(c.env.GLOSSARY_DB!, entry);
    } catch (error) {
      await removeGlossaryIndex(c.env.GLOSSARY_INDEX!, entry.id).catch(() => undefined);
      throw error;
    }
    return c.json({ entry }, 201);
  })
  .put("/glossary/:id", async (c) => {
    const previous = await getGlossary(c.env.GLOSSARY_DB!, c.req.param("id"));
    if (!previous) return c.json({ error: { code: "NOT_FOUND", message: "Entrada no encontrada" } }, 404);
    if ((c.req.header("content-type") ?? "").split(";")[0].toLowerCase() !== "application/json") {
      return c.json({ error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Se requiere application/json" } }, 415);
    }
    let raw: unknown;
    try {
      raw = await readJsonBody(c.req.raw, 8 * 1024);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Entrada demasiado grande" } }, 413);
      return c.json(invalid(c.get("requestId")), 400);
    }
    const parsed = glossaryInputSchema.safeParse(raw);
    if (!parsed.success) return c.json(invalid(c.get("requestId")), 400);
    if (parsed.data.sourceLanguage !== previous.sourceLanguage || parsed.data.targetLanguage !== previous.targetLanguage) {
      return c.json({ error: { code: "LANGUAGE_PAIR_LOCKED", message: "Para cambiar los idiomas, crea una entrada nueva." } }, 400);
    }
    const entry = { ...previous, ...parsed.data, updatedAt: new Date().toISOString() };
    await indexGlossary(c.env.AI, c.env.GLOSSARY_INDEX!, entry);
    try {
      await updateGlossary(c.env.GLOSSARY_DB!, entry);
    } catch (error) {
      await indexGlossary(c.env.AI, c.env.GLOSSARY_INDEX!, previous).catch(() => undefined);
      throw error;
    }
    return c.json({ entry });
  })
  .delete("/glossary/:id", async (c) => {
    const entry = await getGlossary(c.env.GLOSSARY_DB!, c.req.param("id"));
    if (!entry) return c.json({ error: { code: "NOT_FOUND", message: "Entrada no encontrada" } }, 404);
    await removeGlossaryIndex(c.env.GLOSSARY_INDEX!, entry.id);
    await deleteGlossary(c.env.GLOSSARY_DB!, entry.id);
    return c.json({ deleted: true });
  });
