import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AREAS_DE_PASSAGEM,
  areaDePassagem,
  livreParaOCliente,
  problemaDoLocalDoPedido,
} from "./areas-de-passagem.js";

/** Só prateleira para o cliente (recebimento com caixas, decisão 10 e parte 7), sem o banco. */

describe("as áreas de passagem", () => {
  it("RECEBIMENTO e EXPEDICAO, sem diferenciar maiúscula nem acento; o resto é prateleira", () => {
    assert.deepEqual([...AREAS_DE_PASSAGEM], ["RECEBIMENTO", "EXPEDICAO"]);
    for (const local of ["RECEBIMENTO", " recebimento ", "Recebimento"]) {
      assert.equal(areaDePassagem(local), "RECEBIMENTO", local);
    }
    for (const local of ["EXPEDICAO", "expedicao", "EXPEDIÇÃO", "Expedição"]) {
      assert.equal(areaDePassagem(local), "EXPEDICAO", local);
    }
    for (const local of ["A-01", "S-01", "LOC-12", "DEVOLUCAO", "RUA-A/PRAT-01/CX-001", "RECEBIMENTO-2", "", undefined, null, 7]) {
      assert.equal(areaDePassagem(local), null, String(local));
    }
  });

  it("o pedido não reserva de área de passagem: o local pedido numa delas é recusado", () => {
    assert.equal(
      problemaDoLocalDoPedido("RECEBIMENTO"),
      "O local RECEBIMENTO não atende pedido: o pedido só reserva o que está na prateleira.",
    );
    assert.equal(
      problemaDoLocalDoPedido("expedição"),
      "O local expedição não atende pedido: o pedido só reserva o que está na prateleira.",
    );
    for (const local of ["A-01", "DEVOLUCAO", "", undefined]) {
      assert.equal(problemaDoLocalDoPedido(local), null, String(local));
    }
  });
});

describe("o livre do cliente", () => {
  it("o livre de cada saldo vai para a prateleira ou para o recebimento; a EXPEDICAO só conta no total", () => {
    assert.deepEqual(
      livreParaOCliente([
        { location_id: "A-01", qty_on_hand: 3, qty_reserved: 1 },
        { location_id: "S-01", qty_on_hand: 4 },
        { location_id: "DEVOLUCAO", qty_on_hand: 1 },
        { location_id: "RECEBIMENTO", qty_on_hand: 5, qty_reserved: 2 },
        { location_id: "recebimento", qty_on_hand: 1 },
        { location_id: "EXPEDICAO", qty_on_hand: 2 },
      ]),
      { qty_available: 2 + 4 + 1, qty_receiving: 3 + 1 },
    );
  });

  it("sem saldo é zero, e o saldo inconsistente não deixa o livre negativo", () => {
    assert.deepEqual(livreParaOCliente([]), { qty_available: 0, qty_receiving: 0 });
    assert.deepEqual(
      livreParaOCliente([
        { location_id: "A-01", qty_on_hand: 1, qty_reserved: 3 },
        { location_id: "A-02", qty_on_hand: "2" },
        { location_id: "RECEBIMENTO", qty_on_hand: -4 },
      ]),
      { qty_available: 2, qty_receiving: 0 },
    );
  });
});
