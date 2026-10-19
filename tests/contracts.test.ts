import { describe, expect, it } from "vitest";
import { translateRequestSchema } from "../src/shared/contracts";

describe("translateRequestSchema", () => {
  it("aplica valores seguros por defecto", () => {
    const result = translateRequestSchema.parse({ text: "Hola", targetLanguage: "en" });
    expect(result).toMatchObject({ sourceLanguage: "auto", tone: "neutral", context: [] });
  });

  it("rechaza entradas vacías o demasiado largas", () => {
    expect(translateRequestSchema.safeParse({ text: "", targetLanguage: "en" }).success).toBe(false);
    expect(translateRequestSchema.safeParse({ text: "x".repeat(5001), targetLanguage: "en" }).success).toBe(false);
  });
});
