import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { entradaDaPreviaDoMover, entradaDoMover, prateleirasNaContagem } from "./box-move.js";
import type { CaixaDaRodada } from "./count-rounds.js";

/**
 * As regras puras do mover de caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md):
 * a entrada das callables e a contagem aberta, que confere a origem como está
 * (com a caixa) e o destino como ficaria (com a caixa).
 */

const BTG = "BTG Pactual";

function recusa(acao: () => unknown): HttpsError {
  try {
    acao();
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error;
  }
  assert.fail("a entrada passou");
}

const caixa = (code: string, location_id: string, sku_codes: string[] = ["BTG-000112"]): CaixaDaRodada => ({ code, status: "stored", location_id, sku_codes, last_recount_round_id: null });

describe("a entrada do mover", () => {
  const mover = { customer_code: BTG, box_code: " cx-000121 ", from_location_id: "A-01", to_location_id: "B-09", idempotency_key: "k-00000001" };

  it("normaliza o código da caixa e aceita a sugestão", () => {
    assert.equal(entradaDoMover(mover).box_code, "CX-000121");
    assert.deepEqual(entradaDoMover({ ...mover, suggestion: { position: "B-09", alternatives: ["B-10", "C-02"] } }).suggestion, { position: "B-09", alternatives: ["B-10", "C-02"] });
    assert.equal(entradaDaPreviaDoMover({ customer_code: BTG, box_code: "cx-000121" }).box_code, "CX-000121");
  });

  it("a entrada recusa o código que não é de caixa e o campo a mais", () => {
    for (const errada of [{ ...mover, box_code: "A-01" }, { ...mover, foo: 1 }, { ...mover, to_location_id: "" }, { ...mover, idempotency_key: "curta" }]) {
      const erro = recusa(() => entradaDoMover(errada));
      assert.deepEqual([erro.code, erro.message], ["invalid-argument", "Caixa inválida: confira o código e tente de novo."]);
    }
    const erro = recusa(() => entradaDaPreviaDoMover({ customer_code: BTG, box_code: "121" }));
    assert.deepEqual([erro.code, erro.message, (erro.details as { issues: string[] }).issues], ["invalid-argument", "Caixa inválida: confira o código e tente de novo.", ["box_code"]]);
  });
});

describe("a contagem aberta no mover", () => {
  const geral = { id: "cr_geral", alcance: { scope: "general" as const } };
  const ruaA = { id: "cr_rua", alcance: { scope: "aisle" as const, aisle: "A" } };
  const doItem = { id: "cr_item", alcance: { scope: "item" as const, sku_code: "BTG-000112" } };
  const caixas = [caixa("CX-000121", "A-01"), caixa("CX-000300", "C-01", ["BTG-000200"])];

  it("a contagem geral trava a origem", () => {
    assert.deepEqual(prateleirasNaContagem(geral, caixas, { box_code: "CX-000121", origem: "A-01", destino: "C-02" }), { origem: true, destino: true });
  });

  it("a contagem por rua trava só a rua", () => {
    assert.deepEqual(prateleirasNaContagem(ruaA, caixas, { box_code: "CX-000121", origem: "A-01", destino: "C-02" }), { origem: true, destino: false });
    assert.deepEqual(prateleirasNaContagem(ruaA, caixas, { box_code: "CX-000300", origem: "C-01", destino: "A-02" }), { origem: false, destino: true });
    assert.deepEqual(prateleirasNaContagem(ruaA, caixas, { box_code: "CX-000300", origem: "C-01", destino: "C-02" }), { origem: false, destino: false });
  });

  it("a contagem por item vê a caixa chegando", () => {
    assert.deepEqual(prateleirasNaContagem(doItem, caixas, { box_code: "CX-000121", origem: "A-01", destino: "C-02" }), { origem: true, destino: true });
    assert.deepEqual(prateleirasNaContagem(doItem, caixas, { box_code: "CX-000300", origem: "C-01", destino: "A-02" }), { origem: false, destino: false });
  });

  it("sem rodada, nada trava", () => {
    assert.deepEqual(prateleirasNaContagem(null, caixas, { box_code: "CX-000121", origem: "A-01", destino: "C-02" }), { origem: false, destino: false });
  });
});
