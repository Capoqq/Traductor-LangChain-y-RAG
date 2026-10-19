import type { GlossaryChoice, GlossaryMatch, GlossarySense } from "../../shared/glossary";
import { containsSourceTerm } from "./glossary";

export const explainGlossaryChoices = (
  translatedText: string,
  glossaryMatches: GlossaryMatch[],
  termSenses: GlossarySense[],
): GlossaryChoice[] => {
  const choices: GlossaryChoice[] = [];
  const grouped = new Map<string, GlossarySense[]>();
  for (const sense of termSenses) {
    const key = sense.sourceTerm.normalize("NFC").toLocaleLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), sense]);
  }
  for (const senses of grouped.values()) {
    const found = senses.filter((sense) => containsSourceTerm(translatedText, sense.preferredTranslation));
    if (found.length !== 1) continue;
    const sense = found[0];
    const domain = sense.domain || "uso general";
    const example = sense.example ? ` Ejemplo guardado: «${sense.example}».` : "";
    choices.push({ id: sense.id, sourceTerm: sense.sourceTerm, preferredTranslation: sense.preferredTranslation,
      domain: sense.domain, explanation: `La traducción usa «${sense.preferredTranslation}», sentido de ${domain}.${example}` });
  }
  for (const match of glossaryMatches) {
    if (choices.some((choice) => choice.sourceTerm.toLocaleLowerCase() === match.sourceTerm.toLocaleLowerCase())) continue;
    if (!containsSourceTerm(translatedText, match.preferredTranslation)) continue;
    choices.push({ ...match, explanation: `La traducción usa «${match.preferredTranslation}», preferencia del glosario para ${match.domain || "uso general"}.` });
  }
  return choices;
};
