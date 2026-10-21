import { describe, expect, it } from "vitest";

import { canSeeCatalogPrice, canSeeMerchandiseValue } from "./permissions";

describe("preço fora da operação", () => {
  it("mostra preço só para owner, admin e financeiro", () => {
    expect(canSeeCatalogPrice("owner")).toBe(true);
    expect(canSeeCatalogPrice("admin")).toBe(true);
    expect(canSeeCatalogPrice("financeiro")).toBe(true);
    for (const role of ["interno", "wms", "suporte", "cliente", "campo"]) {
      expect(canSeeCatalogPrice(role)).toBe(false);
    }
  });

  it("deixa o cliente ver o valor da própria mercadoria", () => {
    expect(canSeeMerchandiseValue("cliente")).toBe(true);
    expect(canSeeMerchandiseValue("wms")).toBe(false);
  });
});
