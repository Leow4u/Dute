import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ajustesDaCaixa, caixasComOItem, unidadesDaCaixaAgora, type CaixasDaPrateleira } from "./box-balance.js";
import { caixaAberta, etiquetaParaTrocar } from "./box-relabel.js";
import type { Row } from "./operations.js";

/**
 * O saldo da caixa no banco com os ajustes da recontagem (contagem por
 * caixa, docs/plataforma/diagnostico-contagem-ciclica.md, seção 6, item 4):
 * a separação, a etiqueta para trocar e a conta das unidades leem os
 * ajustes pela regra de saldo-da-caixa.ts. Antes, a caixa recontada seguia
 * com o conteúdo de entrada para todos eles.
 */

const POLO = "BTG-000123";
const POLO_GG = "BTG-000125";

function caixa(code: string, data: Record<string, unknown>): Row {
  return { id: code, ref: {} as Row["ref"], data: { code, status: "stored", location_id: "A-03", ...data } };
}

function prateleira(caixas: Array<{ box: Row; entrada: number }>): CaixasDaPrateleira {
  return {
    porCodigo: new Map(caixas.map(({ box }) => [box.id, box])),
    entradaDoItem: new Map(caixas.map(({ box, entrada }) => [box.id, entrada])),
  };
}

describe("os ajustes da recontagem na caixa", () => {
  it("lê os ajustes com o sinal, na ordem gravada, e ignora o que não é ajuste", () => {
    assert.deepEqual(
      ajustesDaCaixa({
        count_adjustments: [
          { recount_id: "brc_1", sku_code: POLO, qty: -12 },
          { recount_id: "brc_1", sku_code: POLO_GG, qty: 2, product_name: "Polo" },
          { recount_id: "brc_1", sku_code: "", qty: 3 },
          { recount_id: "brc_1", sku_code: POLO, qty: "muitas" },
          null,
        ],
      }),
      [
        { sku_code: POLO, qty: -12 },
        { sku_code: POLO_GG, qty: 2 },
      ],
    );
    assert.deepEqual(ajustesDaCaixa({}), []);
  });

  it("as unidades da caixa são a entrada menos o retirado mais os ajustes, nunca negativas", () => {
    assert.equal(unidadesDaCaixaAgora({ unit_count: 60, taken_units: 5, count_adjustments: [{ sku_code: POLO, qty: -12 }, { sku_code: POLO_GG, qty: 2 }] }), 45);
    assert.equal(unidadesDaCaixaAgora({ unit_count: 60, count_adjustments: [{ sku_code: POLO, qty: -70 }] }), 0);
    assert.equal(unidadesDaCaixaAgora({ unit_count: 60 }), 60);
  });
});

describe("a separação lê o que a recontagem acertou", () => {
  it("a caixa tem do item o que a recontagem deixou; a que só tem o item pela recontagem também entra", () => {
    const recontada = caixa("CX-000012", { stored_at: "2026-10-20T13:00:00.000Z", unit_count: 60, count_adjustments: [{ sku_code: POLO, qty: -12 }] });
    const achou = caixa("CX-000014", { stored_at: "2026-10-21T13:00:00.000Z", unit_count: 50, count_adjustments: [{ sku_code: POLO, qty: 2 }] });
    const intacta = caixa("CX-000013", { stored_at: "2026-10-20T14:00:00.000Z", unit_count: 80 });
    const candidatas = caixasComOItem(
      prateleira([
        { box: recontada, entrada: 60 },
        { box: achou, entrada: 0 },
        { box: intacta, entrada: 80 },
      ]),
      new Map(),
      POLO,
    );
    assert.deepEqual(
      candidatas.map((item) => [item.code, item.disponivel, item.saldo, item.intacta]),
      [
        ["CX-000012", 48, 48, true],
        ["CX-000014", 2, 52, true],
        ["CX-000013", 80, 80, true],
      ],
    );
  });

  it("o retirado da transação conta junto com o ajuste, e a caixa que a recontagem zerou não entra", () => {
    const recontada = caixa("CX-000012", { unit_count: 60, taken_lines: [{ sku_code: POLO, qty: 10 }], taken_units: 10, count_adjustments: [{ sku_code: POLO, qty: -45 }] });
    const zerada = caixa("CX-000013", { unit_count: 80, count_adjustments: [{ sku_code: POLO, qty: -80 }] });
    const shelf = prateleira([
      { box: recontada, entrada: 60 },
      { box: zerada, entrada: 80 },
    ]);
    assert.deepEqual(caixasComOItem(shelf, new Map(), POLO).map((item) => [item.code, item.disponivel, item.saldo, item.intacta]), [["CX-000012", 5, 5, false]]);
    // A linha que muda devolve antes o que tinha tirado: a conta parte do retirado da transação.
    assert.deepEqual(caixasComOItem(shelf, new Map([["CX-000012", []]]), POLO).map((item) => [item.code, item.disponivel]), [["CX-000012", 15]]);
  });
});

describe("a etiqueta para trocar da caixa recontada", () => {
  it("a caixa ajustada pela recontagem fica aberta e pede a etiqueta do saldo até a impressão", () => {
    const recontada = { status: "stored", unit_count: 60, count_adjustments: [{ recount_id: "brc_1", sku_code: POLO, qty: -12 }], balance_at: "2026-11-17T12:00:00.000Z" };
    assert.equal(caixaAberta(recontada), true);
    assert.equal(etiquetaParaTrocar(recontada), true);
    assert.equal(etiquetaParaTrocar({ ...recontada, balance_label_printed_for: "2026-11-17T12:00:00.000Z" }), false);
    // Sem ajuste e sem retirado, a caixa segue intacta; a vazia não pede etiqueta.
    assert.equal(caixaAberta({ status: "stored", unit_count: 60 }), false);
    assert.equal(caixaAberta({ ...recontada, status: "emptied" }), false);
  });
});
