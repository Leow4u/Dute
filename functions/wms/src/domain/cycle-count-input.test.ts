import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTAGEM_CICLICA_MAXIMA,
  CycleCountSchema,
  QUANTIDADE_ACIMA_DO_TETO,
  QUANTIDADE_FRACIONADA,
  problemaDaEntradaDaContagem,
  problemaDaQuantidadeContada,
} from "./cycle-count-input.js";

const openingNew = {
  mode: "opening",
  session_id: "opening_BTG_Pactual",
  customer_code: "BTG Pactual",
  client_item_code: "F-POLO-AZ-M",
  product_name: "Polo piquet azul",
  product_registration: "new",
  location_id: "A-01-01",
  counted_qty: 4,
  unit_cost: 39.9,
  reason: "Inventário físico de abertura do estoque",
  idempotency_key: "count-1",
};

/** A contagem cíclica como a tela manda: sem `mode`, que vale `cycle`. */
const cycle = {
  customer_code: "BTG Pactual",
  sku_code: "BTG-000001",
  client_item_code: "F-POLO-AZ-M",
  location_id: "A-01",
  counted_qty: 4,
  reason: "Contagem cíclica da rua A",
  idempotency_key: "count-2",
};

/** A frase que a callable devolve para a entrada, ou null quando ela passa. */
function recusa(input: Record<string, unknown>) {
  const parsed = CycleCountSchema.safeParse(input);
  return parsed.success ? null : problemaDaEntradaDaContagem(parsed.error);
}

describe("entrada de recordCycleCount", () => {
  it("produto novo na abertura vem sem SKU: ele é gerado na transação", () => {
    const parsed = CycleCountSchema.parse(openingNew);
    assert.equal(parsed.sku_code, undefined);
    assert.equal(parsed.product_registration, "new");
  });

  it("local, quantidade, motivo e chave de idempotência continuam obrigatórios", () => {
    for (const field of ["location_id", "counted_qty", "reason", "idempotency_key"]) {
      const input: Record<string, unknown> = { ...openingNew };
      delete input[field];
      assert.equal(CycleCountSchema.safeParse(input).success, false, field);
    }
  });

  it("a contagem cíclica é de unidades inteiras: 2,5 é recusado com a frase; 0, 1 e o teto passam", () => {
    assert.equal(recusa({ ...cycle, counted_qty: 2.5 }), QUANTIDADE_FRACIONADA);
    assert.equal(recusa({ ...cycle, mode: "cycle", counted_qty: 0.001 }), QUANTIDADE_FRACIONADA);
    for (const counted_qty of [0, 1, CONTAGEM_CICLICA_MAXIMA]) {
      assert.equal(recusa({ ...cycle, counted_qty }), null, String(counted_qty));
    }
  });

  it("a contagem cíclica tem teto de 100.000 unidades, e a frase diz o teto", () => {
    assert.equal(CONTAGEM_CICLICA_MAXIMA, 100_000);
    assert.match(QUANTIDADE_ACIMA_DO_TETO, /100\.000 unidades/);
    assert.equal(recusa({ ...cycle, counted_qty: 100_001 }), QUANTIDADE_ACIMA_DO_TETO);
    assert.equal(recusa({ ...cycle, counted_qty: 2_500_000 }), QUANTIDADE_ACIMA_DO_TETO);
  });

  it("a transação usa a mesma regra do esquema", () => {
    assert.equal(problemaDaQuantidadeContada("cycle", 2.5), QUANTIDADE_FRACIONADA);
    assert.equal(problemaDaQuantidadeContada(undefined, 100_001), QUANTIDADE_ACIMA_DO_TETO);
    assert.equal(problemaDaQuantidadeContada("cycle", 100_000), null);
  });

  it("a abertura não muda aqui: a quantidade dela segue como antes", () => {
    // A abertura da BTG está concluída; a regra dela fica fora deste PR.
    assert.equal(problemaDaQuantidadeContada("opening", 4.5), null);
    assert.equal(CycleCountSchema.safeParse({ ...openingNew, counted_qty: 250_000 }).success, true);
  });

  it("o resto da entrada fora do formato recebe a frase genérica, nunca o texto do ZodError", () => {
    const generica = "Contagem inválida: confira os campos e tente de novo.";
    assert.equal(recusa({ ...cycle, reason: "ab" }), generica);
    assert.equal(recusa({ ...cycle, counted_qty: "quatro" }), generica);
    assert.equal(recusa({ ...cycle, counted_qty: -1 }), generica);
  });
});
