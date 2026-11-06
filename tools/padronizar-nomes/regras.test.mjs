import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { caixaDasLetras, familiaDoCodigo, ordemDoTamanho, padronizarNome, sufixoDoCodigo } from "./regras.mjs";

/**
 * A cópia em JavaScript do padrão do nome (regras.mjs) roda os mesmos casos
 * de lib/dominio/src/nome-do-produto.casos.json que o vitest do app roda
 * contra o original em TypeScript. Caso novo entra no JSON, nunca só aqui.
 */
const casos = JSON.parse(readFileSync(fileURLToPath(new URL("../../lib/dominio/src/nome-do-produto.casos.json", import.meta.url)), "utf8"));

describe("padrão do nome: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.nomes.length >= 20);
    assert.ok(casos.sufixos.length >= 5);
  });

  for (const caso of casos.sufixos) {
    it(`sufixo · ${caso.caso}`, () => {
      assert.equal(sufixoDoCodigo(caso.codigo), caso.sufixo);
    });
  }

  for (const caso of casos.familias) {
    it(`família · ${caso.caso}`, () => {
      assert.equal(familiaDoCodigo(caso.codigo), caso.familia);
    });
  }

  for (const caso of casos.nomes) {
    it(`nome · ${caso.caso}`, () => {
      const resultado = padronizarNome({ nome: caso.nome, codigo: caso.codigo, genero: caso.genero, tamanho: caso.tamanho });
      assert.deepEqual(resultado, caso.esperado);
    });
  }
});

describe("padrão do nome: detalhes da ferramenta", () => {
  it("a ordem dos tamanhos é PP, P, M, G, GG, XG, XGG, depois N1…, depois os números", () => {
    const ordenados = ["42", "N3", "GG", "PP", "XGG", "N1", "M", "38", "U"].sort((a, b) => ordemDoTamanho(a) - ordemDoTamanho(b));
    assert.deepEqual(ordenados, ["PP", "M", "GG", "XGG", "U", "N1", "N3", "38", "42"]);
  });

  it("a caixa das letras é idempotente", () => {
    for (const caso of casos.nomes) {
      if (!caso.esperado.nome || caso.esperado.conferir.includes("nome é só o tamanho")) continue;
      assert.equal(caixaDasLetras(caso.esperado.nome), caso.esperado.nome, caso.caso);
    }
  });

  it("aplicar o padrão duas vezes não muda mais nada", () => {
    for (const caso of casos.nomes) {
      const primeira = padronizarNome({ nome: caso.nome, codigo: caso.codigo, genero: caso.genero, tamanho: caso.tamanho });
      const segunda = padronizarNome({ nome: primeira.nome, codigo: caso.codigo, genero: caso.genero, tamanho: primeira.tamanho });
      assert.equal(segunda.nome, primeira.nome, caso.caso);
      const motivosDaSegunda = segunda.motivos.filter((m) => m !== "tamanho pelo código");
      assert.deepEqual(motivosDaSegunda, [], `${caso.caso}: ${segunda.motivos.join(", ")}`);
    }
  });
});
