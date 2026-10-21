import { describe, expect, it } from "vitest";

import { COMERCIAL_AMBIENTES_LIBERADOS, comercialLiberado, plataformaLiberada } from "./liberacao";

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

describe("liberação do Comercial por ambiente", () => {
  it("só a homologação, a mesma lista das callables (platform-lists.test.ts)", () => {
    expect(COMERCIAL_AMBIENTES_LIBERADOS).toEqual(["dute-homolog"]);
    expect(comercialLiberado("dute-homolog")).toBe(true);
  });

  it("produção, produção antiga e projeto de teste ficam desligados, porque as callables recusam", () => {
    for (const projectId of ["dute-prod", "dute-btg", "demo-dute", "", null, undefined]) {
      expect(comercialLiberado(projectId)).toBe(false);
    }
  });
});
