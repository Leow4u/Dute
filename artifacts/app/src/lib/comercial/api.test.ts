import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CALLABLES_DO_CADASTRO,
  CALLABLES_DO_CONTRATO,
  CALLABLES_DO_ORCAMENTO,
  ErroDaCallable,
  codigoDoErro,
  mensagemDoErro,
} from "./api";

const here = dirname(fileURLToPath(import.meta.url));
const indexDoComercial = readFileSync(resolve(here, "../../../../../functions/comercial/src/index.ts"), "utf8");

describe("callables do cadastro comercial", () => {
  it.each([...CALLABLES_DO_CADASTRO, ...CALLABLES_DO_CONTRATO])("%s existe em functions/comercial", (nome) => {
    expect(indexDoComercial).toMatch(new RegExp(`^export const ${nome} = onCall\\(`, "m"));
  });

  it.each(CALLABLES_DO_ORCAMENTO)("%s (orçamento) existe em functions/comercial", (nome) => {
    expect(indexDoComercial).toMatch(new RegExp(`^export const ${nome} = onCall\\(`, "m"));
  });

  it("o orçamento grava por saveQuote e advanceQuote", () => {
    expect([...CALLABLES_DO_ORCAMENTO]).toEqual(["saveQuote", "advanceQuote"]);
  });

  it("o erro da callable guarda o código: a tela decide se recarrega", () => {
    expect(codigoDoErro(Object.assign(new Error("x"), { code: "functions/failed-precondition" }))).toBe("failed-precondition");
    expect(codigoDoErro(Object.assign(new Error("x"), { code: "not-found" }))).toBe("not-found");
    expect(codigoDoErro(new Error("x"))).toBe("");
    const erro = new ErroDaCallable("O orçamento mudou.", "failed-precondition");
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("O orçamento mudou.");
    expect(erro.codigo).toBe("failed-precondition");
  });

  it("a mensagem do servidor passa; internal vira aviso genérico", () => {
    expect(mensagemDoErro(Object.assign(new Error("O cadastro X já é cliente."), { code: "functions/failed-precondition" }))).toBe(
      "O cadastro X já é cliente.",
    );
    expect(mensagemDoErro(Object.assign(new Error("INTERNAL"), { code: "functions/internal" }))).toMatch(/Falha interna/);
    expect(mensagemDoErro("x")).toMatch(/Falha interna/);
  });
});
