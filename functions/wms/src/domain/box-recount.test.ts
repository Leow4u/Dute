import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { FORA_DA_LISTA_SEM_PECA, QUANTIDADE_NEGATIVA, entradaDaRecontagem, problemaDaLinhaContada } from "./box-recount.js";
import { QUANTIDADE_ACIMA_DO_TETO, QUANTIDADE_FRACIONADA } from "./cycle-count-input.js";

/**
 * A entrada de recountWarehouseBox (contagem por caixa, diagnóstico da
 * Contagem cíclica, seção 6, item 4): a quantidade segue a regra da contagem
 * cíclica (inteira, até 100.000), o item fora da lista tem peça, e a recusa
 * diz o que corrigir, com a frase para quem opera, em vez do ZodError cru.
 */

const valida = {
  customer_code: "BTG Pactual",
  box_code: "cx-000012",
  location_id: "A-03",
  lines: [{ sku_code: "btg-000123", counted_qty: 48 }],
  extra_lines: [{ sku_code: "BTG-000125", counted_qty: 2 }],
  idempotency_key: "recontar-000001",
};

function recusa(raw: unknown): HttpsError {
  try {
    entradaDaRecontagem(raw);
  } catch (error) {
    assert.ok(error instanceof HttpsError);
    return error;
  }
  assert.fail("a entrada passou");
}

describe("a entrada da recontagem da caixa", () => {
  it("passa, com a caixa e os itens em maiúsculas", () => {
    const entrada = entradaDaRecontagem(valida);
    assert.deepEqual([entrada.box_code, entrada.lines[0]!.sku_code, entrada.extra_lines![0]!.sku_code], ["CX-000012", "BTG-000123", "BTG-000125"]);
    assert.equal(entradaDaRecontagem({ ...valida, extra_lines: undefined }).extra_lines, undefined);
  });

  it("a quantidade segue a regra da contagem cíclica: inteira, sem passar de 100.000, nunca negativa", () => {
    assert.equal(problemaDaLinhaContada(0, false), null);
    assert.equal(problemaDaLinhaContada(100_000, false), null);
    assert.equal(problemaDaLinhaContada(2.5, false), QUANTIDADE_FRACIONADA);
    assert.equal(problemaDaLinhaContada(100_001, false), QUANTIDADE_ACIMA_DO_TETO);
    assert.equal(problemaDaLinhaContada(-1, false), QUANTIDADE_NEGATIVA);
    // O item fora da lista tem peça: zero não é fora da lista.
    assert.equal(problemaDaLinhaContada(0, true), FORA_DA_LISTA_SEM_PECA);
    assert.equal(problemaDaLinhaContada(1, true), null);
  });

  it("a recusa diz a quantidade a corrigir, com a frase para quem opera", () => {
    let erro = recusa({ ...valida, lines: [{ sku_code: "BTG-000123", counted_qty: 2.5 }] });
    assert.deepEqual([erro.code, erro.message], ["invalid-argument", QUANTIDADE_FRACIONADA]);
    erro = recusa({ ...valida, lines: [{ sku_code: "BTG-000123", counted_qty: 250_000 }] });
    assert.equal(erro.message, QUANTIDADE_ACIMA_DO_TETO);
    erro = recusa({ ...valida, extra_lines: [{ sku_code: "BTG-000125", counted_qty: 0 }] });
    assert.equal(erro.message, FORA_DA_LISTA_SEM_PECA);
    assert.deepEqual((erro.details as { issues: string[] }).issues, ["extra_lines.0.counted_qty"]);
  });

  it("o resto fora do formato é genérico, com os campos no detalhe", () => {
    for (const [raw, campo] of [
      [{ ...valida, box_code: "B-10" }, "box_code"],
      [{ ...valida, idempotency_key: "curta" }, "idempotency_key"],
      [{ ...valida, lines: [{ sku_code: "", counted_qty: 1 }] }, "lines.0.sku_code"],
      [{ ...valida, unit_cost: 12 }, ""],
      [{ ...valida, customer_code: undefined }, "customer_code"],
    ] as const) {
      const erro = recusa(raw);
      assert.equal(erro.message, "Contagem da caixa inválida: confira os campos e tente de novo.", campo);
      if (campo) assert.ok((erro.details as { issues: string[] }).issues.includes(campo), `${campo}: ${JSON.stringify(erro.details)}`);
    }
    assert.equal(recusa(null).message, "Contagem da caixa inválida: confira os campos e tente de novo.");
  });
});
