import assert from "node:assert/strict";
import { test } from "node:test";

import { ficaVazia, recusaNaCaixa, recusaNoSku, resumoDaCaixa, retiradoCom, retiradoDe, retiradoGravado } from "./caixa.mjs";

const apagar = () => "<apagar>";
// Como a recountWarehouseBox grava: o ajuste com sinal, o id da contagem e a hora.
const ajuste = (sku_code, qty, extra = {}) => ({ recount_id: "brc_1", sku_code, qty, at: "2026-11-17T17:05:00.000Z", ...extra });

test("o retirado da caixa: o que as separações tiraram de um SKU, e o retirado depois de mover", () => {
  const caixa = { taken_lines: [{ sku_code: "BTG-000099", qty: 41 }, { sku_code: "BTG-000119", qty: 1 }] };
  assert.equal(retiradoDe(caixa, "BTG-000099"), 41);
  assert.equal(retiradoDe(caixa, "BTG-000100"), 0);
  assert.deepEqual(retiradoCom(caixa.taken_lines, "BTG-000099", -41), [{ sku_code: "BTG-000119", qty: 1 }]);
  assert.deepEqual(retiradoCom(undefined, "BTG-000099", 1), [{ sku_code: "BTG-000099", qty: 1 }], "a caixa intacta não tem o campo");
});

test("o retirado gravado: sem linhas, a caixa volta à entrada; com ajuste da recontagem, a hora do saldo fica", () => {
  assert.deepEqual(retiradoGravado([{ sku_code: "BTG-000099", qty: 1 }], "agora", {}, apagar), { taken_lines: [{ sku_code: "BTG-000099", qty: 1 }], taken_units: 1, balance_at: "agora" });
  assert.deepEqual(retiradoGravado([], "agora", { taken_lines: [] }, apagar), { taken_lines: "<apagar>", taken_units: "<apagar>", balance_at: "<apagar>" });
  // A caixa recontada continua aberta sem o retirado: apagar a hora do saldo poria de novo em "Etiquetas para trocar" a etiqueta já trocada.
  assert.deepEqual(retiradoGravado([], "agora", { count_adjustments: [ajuste("BTG-000100", -2)] }, apagar), { taken_lines: "<apagar>", taken_units: "<apagar>", balance_at: "agora" });
});

test("a caixa vazia pela regra: a entrada menos o retirado mais os ajustes da recontagem", () => {
  const guardada = (extra = {}) => ({ status: "stored", ...extra });
  assert.equal(ficaVazia(guardada(), { entrada: 30, retirado: 30 }), true);
  assert.equal(ficaVazia(guardada({ count_adjustments: [ajuste("BTG-000101", 2)] }), { entrada: 30, retirado: 30 }), false, "a recontagem achou 2 a mais: a caixa não está vazia");
  assert.equal(ficaVazia(guardada({ count_adjustments: [ajuste("BTG-000100", -2)] }), { entrada: 30, retirado: 28 }), true, "a recontagem achou 2 a menos: o resto já saiu");
  assert.equal(ficaVazia(guardada(), { entrada: 30, retirado: 0 }), false, "sem retirado, não é a separação que esvazia");
  assert.equal(ficaVazia({ status: "emptied" }, { entrada: 30, retirado: 30 }), false, "a que já saiu da prateleira");
});

test("a recusa diz o que a recontagem fez, o que a operação faria por cima e como conferir", () => {
  const caixa = { count_adjustments: [ajuste("BTG-000100", -2), ajuste("BTG-000101", 3, { moved_from: [{ box_code: "CX-000140", qty: 3 }] })] };
  assert.equal(
    recusaNoSku(caixa, "CX-000136", "BTG-000100", "BTG-000100 (A.01.0805.002.G)", "a baixa pela linha da abertura contaria de novo o que ela acertou"),
    "a recontagem já ajustou BTG-000100 (A.01.0805.002.G) na caixa CX-000136 (−2 em 17/11/2026, 14:05, contagem brc_1): a baixa pela linha da abertura contaria de novo o que ela acertou. Confira com --caixa CX-000136",
  );
  assert.equal(recusaNoSku(caixa, "CX-000136", "BTG-000090", "BTG-000090", "x"), null, "o item que a recontagem não ajustou passa");
  assert.equal(
    recusaNaCaixa(caixa, "CX-000136", "removê-la apagaria do registro o que a recontagem acertou"),
    "a recontagem já ajustou a caixa CX-000136 (BTG-000100 −2 em 17/11/2026, 14:05, contagem brc_1; BTG-000101 +3 em 17/11/2026, 14:05, 3 da CX-000140, contagem brc_1): removê-la apagaria do registro o que a recontagem acertou. Confira com --caixa CX-000136",
  );
  assert.equal(recusaNaCaixa({ taken_lines: [{ sku_code: "BTG-000100", qty: 1 }] }, "CX-000136", "x"), null);
});

test("o --caixa mostra a recontagem e o que fica de cada item pela regra", () => {
  const daAbertura = { status: "stored", taken_lines: [{ sku_code: "BTG-000099", qty: 10 }], count_adjustments: [ajuste("BTG-000099", -1), ajuste("BTG-000101", 3, { client_item_code: "A.01.0805.002.GG" })] };
  const linhas = [{ sku_code: "BTG-000099", client_item_code: "A.01.0805.002.G", counted_qty: 41 }];
  assert.deepEqual(resumoDaCaixa(daAbertura, linhas), [
    "separação tirou: BTG-000099 (A.01.0805.002.G) 10",
    "recontagem: BTG-000099 (A.01.0805.002.G) −1 em 17/11/2026, 14:05, contagem brc_1; BTG-000101 (A.01.0805.002.GG) +3 em 17/11/2026, 14:05, contagem brc_1",
    "fica pela regra (entrada − retirado + ajustes): BTG-000099 (A.01.0805.002.G) 30, BTG-000101 (A.01.0805.002.GG) 3",
  ]);
  const doReceber = { status: "stored", lines: [{ sku_code: "BTG-000074", client_item_code: "A.01.0806.005.XG", counted_qty: 41 }] };
  assert.deepEqual(resumoDaCaixa(doReceber, []), [
    'conteúdo da caixa (Receber): BTG-000074 · "A.01.0806.005.XG" · 41',
    "fica pela regra (entrada − retirado + ajustes): BTG-000074 (A.01.0806.005.XG) 41",
  ]);
});
