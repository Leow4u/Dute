import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areaDoLocal, areaPutawayTaskId, semGuarda } from "./area-putaway.js";

/** A ação "Guardar" no Estoque sem o banco (decisão 16, parte 7e). */

const SKU = "UNI-000001";

function saldo(location_id: string, qty_on_hand: number, qty_reserved = 0) {
  return { location_id, sku_code: SKU, qty_on_hand, qty_reserved };
}

describe("o que está sem guarda numa área", () => {
  it("o livre do local menos as guardas abertas do SKU, por linha e por caixa", () => {
    const conta = semGuarda({
      locationId: "RECEBIMENTO",
      skuCode: SKU,
      saldos: [saldo("RECEBIMENTO", 30), saldo("A-01", 12)],
      guardas: [
        // A guarda por linha da chegada, com a origem gravada.
        { status: "planned", sku_code: SKU, source_location_id: "RECEBIMENTO", quantity: 6 },
        // Sem origem gravada, a guarda tira do RECEBIMENTO.
        { status: "in_progress", sku_code: SKU, total_units: 2 },
        // A guarda da caixa tira as linhas dela desse SKU.
        { status: "planned", box_code: "CX-000001", sku_codes: [SKU, "UNI-000002"], lines: [{ sku_code: SKU, counted_qty: 4 }, { sku_code: "UNI-000002", counted_qty: 9 }] },
      ],
    });
    assert.deepEqual(conta, { livre: 30, em_guardas_abertas: 12, sem_guarda: 18 });
  });

  it("não contam a guarda concluída, a de outro SKU, a de outro local e a caixa fora do RECEBIMENTO", () => {
    const guardas = [
      { status: "completed", sku_code: SKU, source_location_id: "RECEBIMENTO", quantity: 30 },
      { status: "planned", sku_code: "UNI-000002", source_location_id: "RECEBIMENTO", quantity: 30 },
      { status: "planned", sku_code: SKU, source_location_id: "EXPEDICAO", quantity: 30 },
      { status: "cancelled", box_code: "CX-000002", lines: [{ sku_code: SKU, counted_qty: 30 }] },
    ];
    assert.deepEqual(semGuarda({ locationId: "RECEBIMENTO", skuCode: SKU, saldos: [saldo("RECEBIMENTO", 30)], guardas }), {
      livre: 30,
      em_guardas_abertas: 0,
      sem_guarda: 30,
    });
    // Na EXPEDICAO, a caixa aberta não conta, e o reservado não é livre.
    const naExpedicao = semGuarda({
      locationId: "EXPEDICAO",
      skuCode: SKU,
      saldos: [saldo("EXPEDICAO", 5, 3)],
      guardas: [{ status: "planned", box_code: "CX-000003", lines: [{ sku_code: SKU, counted_qty: 1 }] }],
    });
    assert.deepEqual(naExpedicao, { livre: 2, em_guardas_abertas: 0, sem_guarda: 2 });
  });

  it("na EXPEDICAO, a volta do pedido cancelado e a guarda aberta ali contam", () => {
    const conta = semGuarda({
      locationId: "EXPEDICAO",
      skuCode: SKU,
      saldos: [saldo("EXPEDICAO", 5)],
      guardas: [
        { status: "planned", sku_code: SKU, source_location_id: "EXPEDICAO", quantity: 3, source: "wms_order_cancel" },
        { status: "planned", sku_code: SKU, source_location_id: "EXPEDICAO", quantity: 1, source: "wms_area_putaway" },
      ],
    });
    assert.deepEqual(conta, { livre: 5, em_guardas_abertas: 4, sem_guarda: 1 });
  });

  it("três casas, e nunca abaixo de zero", () => {
    assert.deepEqual(
      semGuarda({ locationId: "RECEBIMENTO", skuCode: SKU, saldos: [saldo("RECEBIMENTO", 1.5)], guardas: [{ status: "planned", sku_code: SKU, quantity: 0.4 }] }),
      { livre: 1.5, em_guardas_abertas: 0.4, sem_guarda: 1.1 },
    );
    assert.equal(
      semGuarda({ locationId: "RECEBIMENTO", skuCode: SKU, saldos: [saldo("RECEBIMENTO", 2)], guardas: [{ status: "planned", sku_code: SKU, quantity: 5 }] }).sem_guarda,
      0,
    );
  });
});

describe("o local e a tarefa", () => {
  it("só as áreas de passagem, em qualquer grafia; a prateleira é recusada", () => {
    assert.equal(areaDoLocal("RECEBIMENTO"), "RECEBIMENTO");
    assert.equal(areaDoLocal("Expedição"), "EXPEDICAO");
    assert.throws(() => areaDoLocal("A-01"), {
      code: "failed-precondition",
      message: "O local A-01 não é uma área de passagem: o saldo dele já está guardado.",
      details: { code: "NOT_A_TRANSIT_AREA" },
    });
  });

  it("o id da guarda é sempre o mesmo para a mesma operação", () => {
    assert.equal(areaPutawayTaskId("op_1"), areaPutawayTaskId("op_1"));
    assert.notEqual(areaPutawayTaskId("op_1"), areaPutawayTaskId("op_2"));
    assert.match(areaPutawayTaskId("op_1"), /^put_area_[0-9a-f]{32}$/);
  });
});
