import assert from "node:assert/strict";
import { test } from "node:test";

import { ajustesDaCaixa, ajustesDoSku, caixaAjustada, conteudoDaCaixa, recontagemNoSku, resumoDosAjustes, saldoDoSku, textoDoAjuste, unidadesDaCaixaAgora } from "./ajustes-da-caixa.mjs";

// Como a recountWarehouseBox grava: o ajuste com sinal, o id da contagem e a hora; o fora da lista com o nome e de onde veio.
const menosDois = { recount_id: "brc_1", sku_code: "BTG-000100", qty: -2, at: "2026-11-17T17:05:00.000Z", round_id: "rodada-17-11" };
const foraDaLista = {
  recount_id: "brc_1",
  sku_code: "BTG-000101",
  qty: 3,
  at: "2026-11-17T17:05:00.000Z",
  client_item_code: "A.01.0805.002.GG",
  product_name: "Polo Masculino Piquet Azul-Marinho",
  moved_from: [{ box_code: "CX-000140", qty: 3 }],
};
const cedeu = { recount_id: "brc_1", sku_code: "BTG-000101", qty: -3, at: "2026-11-17T17:05:00.000Z", moved_to: "CX-000138" };

test("os ajustes da caixa: como estão gravados, sem os que a regra não soma", () => {
  const caixa = { count_adjustments: [menosDois, null, { sku_code: "", qty: 1 }, { sku_code: "BTG-000100", qty: 0 }, { sku_code: " BTG-000102 ", qty: "4" }] };
  assert.deepEqual(ajustesDaCaixa(caixa), [menosDois, { sku_code: "BTG-000102", qty: 4 }]);
  assert.deepEqual(ajustesDoSku(caixa, "BTG-000100"), [menosDois]);
  assert.deepEqual(ajustesDoSku(caixa, "BTG-000999"), []);
  assert.equal(caixaAjustada(caixa), true);
  assert.equal(caixaAjustada({ count_adjustments: [] }), false);
  assert.equal(caixaAjustada({}), false, "a caixa que nunca foi recontada");
});

test("o saldo de um SKU pela regra: a entrada menos o retirado mais os ajustes dele", () => {
  assert.equal(saldoDoSku("BTG-000100", { entrada: 61, retirado: 0, ajustes: [menosDois] }), 59);
  assert.equal(saldoDoSku("BTG-000100", { entrada: 61, retirado: 10, ajustes: [menosDois, foraDaLista] }), 49, "o ajuste de outro SKU não conta");
  assert.equal(saldoDoSku("BTG-000101", { entrada: 0, retirado: 0, ajustes: [foraDaLista] }), 3, "o item que só a recontagem pôs na caixa");
  assert.equal(saldoDoSku("BTG-000101", { entrada: 41, retirado: 0, ajustes: [cedeu] }), 38, "a peça que foi para outra caixa sai desta");
  assert.equal(saldoDoSku("BTG-000100", { entrada: 1, retirado: 0, ajustes: [menosDois] }), 0, "nunca negativo");
  assert.equal(saldoDoSku("BTG-000100", { entrada: 61 }), 61, "sem ajuste, a conta de antes");
});

test("as unidades da caixa agora, como o WMS: a entrada menos o retirado mais os ajustes", () => {
  const caixa = { unit_count: 71, taken_units: 30, count_adjustments: [menosDois, foraDaLista] };
  assert.equal(unidadesDaCaixaAgora(caixa), 42);
  assert.equal(unidadesDaCaixaAgora(caixa, { entrada: 41 }), 12, "com a entrada que a escrita vai deixar");
  assert.equal(unidadesDaCaixaAgora(caixa, { entrada: 0, retirado: 30 }), 0, "nunca negativo");
  assert.equal(unidadesDaCaixaAgora({ unit_count: 71, taken_units: 30 }), 41);
});

test("o conteúdo da caixa recontada: a entrada, o retirado, os ajustes e o que fica, por SKU", () => {
  const caixa = {
    taken_lines: [{ sku_code: "BTG-000090", qty: 30 }],
    count_adjustments: [{ ...menosDois, sku_code: "BTG-000092" }, foraDaLista],
  };
  const entrada = [
    { sku_code: "BTG-000090", qty: 30, client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto" },
    { sku_code: "BTG-000092", qty: 41, client_item_code: "A.01.0806.005.XG", product_name: "Polo Masculino Piquet Preto" },
  ];
  const conteudo = conteudoDaCaixa(caixa, entrada);
  assert.deepEqual(
    conteudo.map((x) => [x.sku_code, x.codigo, x.entrou, x.saiu, x.ajustado, x.fica]),
    [
      ["BTG-000090", "A.01.0806.005.GG", 30, 30, 0, 0],
      ["BTG-000092", "A.01.0806.005.XG", 41, 0, -2, 39],
      ["BTG-000101", "A.01.0805.002.GG", 0, 0, 3, 3],
    ],
  );
  assert.equal(conteudo[2].nome, "Polo Masculino Piquet Azul-Marinho", "o fora da lista leva o nome que o ajuste gravou");
  assert.deepEqual(conteudo[1].ajustes.map((a) => a.recount_id), ["brc_1"]);
});

test("o ajuste em texto: o sinal, a hora de São Paulo, de onde veio ou para onde foi, e a contagem", () => {
  assert.equal(textoDoAjuste(menosDois), "−2 em 17/11/2026, 14:05, contagem brc_1");
  assert.equal(textoDoAjuste(foraDaLista), "+3 em 17/11/2026, 14:05, 3 da CX-000140, contagem brc_1");
  assert.equal(textoDoAjuste(cedeu), "−3 em 17/11/2026, 14:05, para a CX-000138, contagem brc_1");
  assert.equal(textoDoAjuste({ sku_code: "BTG-000100", qty: 1200 }), "+1.200", "sem hora nem contagem");
  assert.equal(
    textoDoAjuste({ ...foraDaLista, from_loose: 1, moved_from: [{ box_code: "CX-000140", qty: 2 }] }),
    "+3 em 17/11/2026, 14:05, 1 do saldo sem caixa e 2 da CX-000140, contagem brc_1",
    "a peça a mais que veio do saldo da prateleira que nenhuma caixa cobria",
  );
});

test("o resumo dos ajustes da caixa, por SKU, para o dry-run", () => {
  assert.equal(
    resumoDosAjustes({ count_adjustments: [menosDois, foraDaLista, { ...menosDois, recount_id: "brc_2", qty: 1 }] }),
    "BTG-000100 −2 em 17/11/2026, 14:05, contagem brc_1; +1 em 17/11/2026, 14:05, contagem brc_2; BTG-000101 +3 em 17/11/2026, 14:05, 3 da CX-000140, contagem brc_1",
  );
  assert.equal(resumoDosAjustes({}), "");
});

test("a recusa começa pelo que a recontagem fez no SKU; o SKU que ela não ajustou passa", () => {
  const caixa = { count_adjustments: [menosDois, foraDaLista] };
  assert.equal(recontagemNoSku(caixa, "CX-000136", "BTG-000100", "A.01.0805.002.G (BTG-000100)"), "a recontagem já ajustou A.01.0805.002.G (BTG-000100) na caixa CX-000136 (−2 em 17/11/2026, 14:05, contagem brc_1)");
  assert.equal(recontagemNoSku(caixa, "CX-000136", "BTG-000090"), null);
  assert.equal(recontagemNoSku({}, "CX-000136", "BTG-000100"), null);
});
