import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/v2/https";

import { nomeParaGravar } from "./nome-para-gravar.js";

/** O que o cadastro grava: o padrão de 06/11/2026, com a recusa do que contradiz o código. */
describe("nome para gravar", () => {
  it("corrige a caixa, o gênero e o tamanho do próprio produto no fim", () => {
    assert.deepEqual(nomeParaGravar({ nome: "polo masculina piquet preto - XG", codigo: "A.01.0806.005.XG", genero: "Masculino" }), {
      nome: "Polo Masculino Piquet Preto",
      tamanho: "XG",
    });
  });

  it("o tamanho vem do código mesmo com o campo vazio ou em minúsculas", () => {
    assert.equal(nomeParaGravar({ nome: "Polo Masculino Piquet Preto", codigo: "A.01.0806.005.GG", tamanho: "" }).tamanho, "GG");
    assert.equal(nomeParaGravar({ nome: "Polo Masculino Piquet Preto", codigo: "A.01.0806.005.GG", tamanho: "gg" }).tamanho, "GG");
  });

  it("sem tamanho no código, vale o campo; sem nenhum, fica sem tamanho", () => {
    assert.deepEqual(nomeParaGravar({ nome: "Toalha de rosto G", codigo: "MAT-014", tamanho: "G" }), { nome: "Toalha de Rosto", tamanho: "G" });
    assert.deepEqual(nomeParaGravar({ nome: "Caneca térmica 500 ML", codigo: "MAT-020" }), { nome: "Caneca Térmica 500 ml", tamanho: undefined });
  });

  it("recusa outro tamanho no nome, outro tamanho no campo e o nome que é só o tamanho", () => {
    const recusa = (entrada: Parameters<typeof nomeParaGravar>[0], frase: RegExp) =>
      assert.throws(
        () => nomeParaGravar(entrada),
        (erro: unknown) => erro instanceof HttpsError && erro.code === "invalid-argument" && frase.test(erro.message),
      );
    recusa({ nome: "Camiseta básica branca M", codigo: "A.01.0310.001.G" }, /O nome termina em M, e o código A\.01\.0310\.001\.G é do tamanho G\./);
    recusa({ nome: "Polo Masculino Piquet Preto", codigo: "A.01.0806.005.G", tamanho: "M" }, /O código A\.01\.0806\.005\.G é do tamanho G, e o Tamanho informado é M\./);
    recusa({ nome: "XG", codigo: "A.01.0806.005.XG" }, /não pode ser só o tamanho/);
  });

  it("a medida no campo Tamanho é a capacidade: não é recusada nem trocada pelo código", () => {
    assert.deepEqual(nomeParaGravar({ nome: "GARRAFA INOX - BTG", codigo: "B.0003.006.U", tamanho: "500ML" }), { nome: "Garrafa Inox - BTG", tamanho: "500ML" });
    assert.deepEqual(nomeParaGravar({ nome: "Copo Beercup em Inox", codigo: "B.0572.003.U.P", tamanho: "475ML" }, "corrige"), {
      nome: "Copo Beercup em Inox",
      tamanho: "475ML",
    });
  });

  it("com corrige, vale o código e nada para", () => {
    assert.deepEqual(nomeParaGravar({ nome: "Camiseta básica branca M", codigo: "A.01.0310.001.G" }, "corrige"), {
      nome: "Camiseta Básica Branca",
      tamanho: "G",
    });
    assert.deepEqual(nomeParaGravar({ nome: "Polo Masculino Piquet Preto", codigo: "A.01.0806.005.G", tamanho: "M" }, "corrige"), {
      nome: "Polo Masculino Piquet Preto",
      tamanho: "G",
    });
    assert.deepEqual(nomeParaGravar({ nome: "XG", codigo: "A.01.0806.005.XG" }, "corrige"), { nome: "XG", tamanho: "XG" });
  });
});
