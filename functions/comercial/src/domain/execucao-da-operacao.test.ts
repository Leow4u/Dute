import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linhasExecutadas, problemaParaOrcarAExecucao, separarPelaTabela, type ItemParaPrefill } from "./execucao-da-operacao.js";

/**
 * A execução da direta aberta pela Operação no orçamento (parte 3.10d): as
 * linhas que a revisão manda cobrar entram pela tabela; o que a tabela não
 * precifica volta para o Comercial lançar.
 */

const DEMANDA = {
  numero: "10301",
  entrada: "direta",
  aberta_pela: "operacao",
  etapa: "execucao_a_orcar",
  operacao: {
    itens: [
      { linha: "ip_1", lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "UN", executado: "12", a_cobrar: "12", absorvido: "0", aditivo: "0" },
      { linha: "ip_2", lpu_item_id: "lpu_cadeira", item: "Cadeira", unidade: "UN", executado: "40", a_cobrar: "38.5", absorvido: "1.5", aditivo: "0" },
      { linha: "cp_1", lpu_item_id: null, item: "Içamento pela fachada", unidade: "VB", executado: "1", a_cobrar: "1", absorvido: "0", aditivo: "0" },
      { linha: "ip_3", lpu_item_id: "lpu_cofre", item: "Cofre", unidade: "VB", executado: "1", a_cobrar: "0", absorvido: "1", aditivo: "0" },
      { linha: "ip_4", lpu_item_id: "lpu_armaz", item: "Armazenagem", unidade: "M3", executado: "3", a_cobrar: "3", absorvido: "0", aditivo: "0" },
    ],
  },
};

const ITENS = new Map<string, ItemParaPrefill>([
  ["lpu_mesa", { id: "lpu_mesa", ativo: true, orcavel: true }],
  ["lpu_cadeira", { id: "lpu_cadeira", ativo: true, orcavel: true }],
  ["lpu_armaz", { id: "lpu_armaz", ativo: true, orcavel: false }],
]);

describe("execução da Operação no orçamento", () => {
  it("as linhas a cobrar, sem as zeradas (absorvido inteiro)", () => {
    assert.deepEqual(
      linhasExecutadas(DEMANDA).map((linha) => [linha.lpu_item_id, linha.quantidade]),
      [
        ["lpu_mesa", "12"],
        ["lpu_cadeira", "38.5"],
        [null, "1"],
        ["lpu_armaz", "3"],
      ],
    );
    assert.deepEqual(linhasExecutadas({}), []);
  });

  it("pela tabela entra o item ativo, orçável e com preço; o resto volta para lançar à mão", () => {
    const { entradas, fora } = separarPelaTabela(linhasExecutadas(DEMANDA), { lpu_mesa: { preco: "40.00" }, lpu_cadeira: { preco: "18.50" }, lpu_armaz: { preco: "9.00" } }, ITENS);
    assert.deepEqual(entradas, [
      { origem: "tabela", lpu_item_id: "lpu_mesa", quantidade: "12" },
      { origem: "tabela", lpu_item_id: "lpu_cadeira", quantidade: "38.5" },
    ]);
    assert.deepEqual(fora, [
      { item: "Içamento pela fachada", unidade: "VB", quantidade: "1" },
      { item: "Armazenagem", unidade: "M3", quantidade: "3" },
    ]);
    // Sem tabela, tudo volta para o Comercial.
    assert.equal(separarPelaTabela(linhasExecutadas(DEMANDA), null, ITENS).entradas.length, 0);
  });

  it("só a direta aberta pela Operação, executada e sem orçamento", () => {
    assert.equal(problemaParaOrcarAExecucao("10301", DEMANDA, false), null);
    assert.equal(problemaParaOrcarAExecucao("10301", DEMANDA, true), "A demanda 10301 já tem orçamento.");
    assert.equal(problemaParaOrcarAExecucao("10301", { ...DEMANDA, aberta_pela: undefined }, false), "Só a demanda direta aberta pela Operação se orça a partir da execução.");
    assert.equal(
      problemaParaOrcarAExecucao("10301", { ...DEMANDA, etapa: "para_planejar" }, false),
      "A demanda 10301 é direta e ainda não tem orçamento: está com a Operação até a execução.",
    );
    assert.equal(problemaParaOrcarAExecucao("10301", { ...DEMANDA, cancelamento: { motivo: "x" } }, false), "A demanda 10301 está perdida ou cancelada.");
  });
});
