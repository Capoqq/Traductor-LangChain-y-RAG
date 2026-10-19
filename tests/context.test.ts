import { describe, expect, it } from "vitest";
import { needsVoiceContext } from "../src/server/graph/context";

describe("voice context routing", () => {
  it("routes short references only when prior context exists", () => {
    expect(needsVoiceContext("Esto está listo", ["El pedido => The order"])).toBe(true);
    expect(needsVoiceContext("Esto está listo", [])).toBe(false);
  });

  it("keeps ordinary and long fragments on the fast path", () => {
    expect(needsVoiceContext("Buenos días a todos", ["Hola => Hello"])).toBe(false);
    expect(needsVoiceContext("Esto es una oración mucho más larga que no necesita revisión", ["Hola => Hello"])).toBe(false);
  });
});
