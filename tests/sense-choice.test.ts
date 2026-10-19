import { describe, expect, it } from "vitest";
import { explainGlossaryChoices } from "../src/server/services/sense-choice";

const senses = [
  { id: "billing", sourceTerm: "charge", preferredTranslation: "cobro", domain: "pagos", example: "The charge appeared twice.", notes: "Money" },
  { id: "battery", sourceTerm: "charge", preferredTranslation: "carga", domain: "baterías", example: "The battery charge is low.", notes: "Energy" },
];

describe("glossary choice explanation", () => {
  it("identifies one used sense and grounds the explanation in its example", () => {
    const choices = explainGlossaryChoices("El cobro apareció dos veces", [], senses);
    expect(choices).toHaveLength(1);
    expect(choices[0].id).toBe("billing");
    expect(choices[0].explanation).toContain("The charge appeared twice");
  });

  it("does not claim a choice when both or neither translation appears", () => {
    expect(explainGlossaryChoices("El cobro y la carga", [], senses)).toEqual([]);
    expect(explainGlossaryChoices("El importe apareció", [], senses)).toEqual([]);
  });
});
