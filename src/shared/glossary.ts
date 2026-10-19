import { z } from "zod";
import { targetLanguageSchema } from "./contracts";

export const glossaryInputSchema = z.object({
  sourceLanguage: targetLanguageSchema,
  targetLanguage: targetLanguageSchema,
  sourceTerm: z.string().trim().min(1).max(120),
  preferredTranslation: z.string().trim().min(1).max(120),
  domain: z.string().trim().max(80).default(""),
  example: z.string().trim().max(500).default(""),
  notes: z.string().trim().max(500).default(""),
}).refine((value) => value.sourceLanguage !== value.targetLanguage, {
  message: "Los idiomas deben ser diferentes",
  path: ["targetLanguage"],
});

export type GlossaryInput = z.infer<typeof glossaryInputSchema>;
export type GlossaryEntry = GlossaryInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type GlossaryMatch = Pick<GlossaryEntry, "id" | "sourceTerm" | "preferredTranslation" | "domain">;
export type GlossarySense = Pick<GlossaryEntry, "id" | "sourceTerm" | "preferredTranslation" | "domain" | "example" | "notes">;
export type GlossaryChoice = Pick<GlossaryEntry, "id" | "sourceTerm" | "preferredTranslation" | "domain"> & { explanation: string };
