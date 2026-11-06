import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { caixaDasLetras, familiaDoCodigo, ordemDoTamanho, padronizarNome, sufixoDoCodigo, type NomePadronizado } from "@workspace/dominio";

/**
 * O padrão do nome do produto (lib/dominio/src/nome-do-produto.ts, decisões do
 * Leonardo de 06/11/2026). Os casos ficam num JSON que
 * tools/padronizar-nomes/regras.test.mjs também roda, contra a cópia em
 * JavaScript da ferramenta do relatório.
 */

type Casos = {
  sufixos: { caso: string; codigo: string; sufixo: string | null }[];
  familias: { caso: string; codigo: string; familia: string }[];
  nomes: { caso: string; nome: string; codigo: string; genero: string; tamanho: string; esperado: NomePadronizado }[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/nome-do-produto.casos.json"), "utf8")) as Casos;

describe("padrão do nome: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    expect(casos.nomes.length).toBeGreaterThanOrEqual(20);
    expect(casos.sufixos.length).toBeGreaterThanOrEqual(5);
  });

  it.each(casos.sufixos)("sufixo · $caso", ({ codigo, sufixo }) => {
    expect(sufixoDoCodigo(codigo)).toBe(sufixo);
  });

  it.each(casos.familias)("família · $caso", ({ codigo, familia }) => {
    expect(familiaDoCodigo(codigo)).toBe(familia);
  });

  it.each(casos.nomes)("nome · $caso", ({ nome, codigo, genero, tamanho, esperado }) => {
    expect(padronizarNome({ nome, codigo, genero, tamanho })).toEqual(esperado);
  });

  it("a ordem dos tamanhos é PP, P, M, G, GG, XG, XGG, depois N1…, depois os números", () => {
    const ordenados = ["42", "N3", "GG", "PP", "XGG", "N1", "M", "38", "U"].sort((a, b) => ordemDoTamanho(a) - ordemDoTamanho(b));
    expect(ordenados).toEqual(["PP", "M", "GG", "XGG", "U", "N1", "N3", "38", "42"]);
  });

  it("a caixa das letras é idempotente", () => {
    for (const caso of casos.nomes) {
      if (!caso.esperado.nome || caso.esperado.conferir.includes("nome é só o tamanho")) continue;
      expect(caixaDasLetras(caso.esperado.nome), caso.caso).toBe(caso.esperado.nome);
    }
  });
});
