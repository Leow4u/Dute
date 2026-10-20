import { describe, expect, it } from "vitest";

import { plataformaLiberada } from "./liberacao";

describe("liberação da plataforma por ambiente", () => {
  it("ligada na homologação, em qualquer build", () => {
    expect(plataformaLiberada("dute-homolog", false)).toBe(true);
    expect(plataformaLiberada("dute-homolog", true)).toBe(true);
  });

  it("desligada na produção e na produção antiga, mesmo em desenvolvimento", () => {
    for (const projectId of ["dute-prod", "dute-btg"]) {
      expect(plataformaLiberada(projectId, false)).toBe(false);
      expect(plataformaLiberada(projectId, true)).toBe(false);
    }
  });

  it("build sem configuração (demo) fica desligado", () => {
    expect(plataformaLiberada(undefined, true)).toBe(false);
    expect(plataformaLiberada("", true)).toBe(false);
    expect(plataformaLiberada(null, false)).toBe(false);
  });

  it("desenvolvimento num projeto de teste liga; build de outro projeto não", () => {
    expect(plataformaLiberada("demo-dute", true)).toBe(true);
    expect(plataformaLiberada("demo-dute", false)).toBe(false);
  });
});
