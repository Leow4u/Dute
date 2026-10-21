import { describe, expect, it } from "vitest";

import { COMERCIAL_AMBIENTES_LIBERADOS, comercialLiberado, plataformaLiberada } from "./liberacao";

describe("liberação da plataforma por ambiente", () => {
  it("ligada na homologação e na produção, em qualquer build", () => {
    for (const projectId of ["dute-homolog", "dute-prod"]) {
      expect(plataformaLiberada(projectId, false)).toBe(true);
      expect(plataformaLiberada(projectId, true)).toBe(true);
    }
  });

  it("desligada na produção antiga, mesmo em desenvolvimento", () => {
    expect(plataformaLiberada("dute-btg", false)).toBe(false);
    expect(plataformaLiberada("dute-btg", true)).toBe(false);
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
  it("homologação e produção, a mesma lista das callables (platform-lists.test.ts)", () => {
    expect(COMERCIAL_AMBIENTES_LIBERADOS).toEqual(["dute-homolog", "dute-prod"]);
    expect(comercialLiberado("dute-homolog")).toBe(true);
    expect(comercialLiberado("dute-prod")).toBe(true);
  });

  it("produção antiga e projeto de teste ficam desligados, porque as callables recusam", () => {
    for (const projectId of ["dute-btg", "demo-dute", "", null, undefined]) {
      expect(comercialLiberado(projectId)).toBe(false);
    }
  });
});
