import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lineArrivalStored, type ArrivalLine } from "./arrival-stored.js";

const RECEIPT = { customer_code: "Cliente", status: "received", conference_mode: "per_line", receipt_number: "AVL-0012", invoice_number: "NF-22" };
const LINE: ArrivalLine = { id: "linha-1", customer_code: "Cliente", sku_code: "CLI-1", client_item_code: "POLO", product_name: "Camiseta", size: "M", received_qty: 4, location_id: "RECEBIMENTO", line_number: 1, unit_cost: 90, box_code: "CX-000001" };
const TASK = { customer_code: "Cliente", receipt_id: "chegada", inbound_item_id: "linha-1", sku_code: "CLI-1", source: "wms_receiving", source_location_id: "RECEBIMENTO", destination_location_id: "A-01", quantity: 4, status: "completed" };

describe("a chegada por linha disponível para o cliente", () => {
  it("entrada direta ou guarda integral produzem o mesmo resumo sem valor, caixa ou posição", () => {
    const expected = { notification_model: "estoque_disponivel", id: "chegada", receipt_id: "chegada", receipt_number: "AVL-0012", invoice_number: "NF-22", items: [{ sku_code: "CLI-1", client_item_code: "POLO", product_name: "Camiseta", size: "M", quantity: 4 }] };
    assert.deepEqual(lineArrivalStored("chegada", RECEIPT, [LINE], [TASK]), expected);
    assert.deepEqual(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, location_id: "LOC-A" }], []), expected);
  });

  it("não confunde tarefa encerrada parcialmente com quantidade recebida guardada", () => {
    assert.equal(lineArrivalStored("chegada", RECEIPT, [LINE], [{ ...TASK, quantity: 3 }]), null);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [LINE], [{ ...TASK, quantity: 3 }, { ...TASK, quantity: 1, source: "wms_area_putaway", receipt_id: undefined, inbound_item_id: undefined }]), null);
  });

  it("todas as linhas positivas precisam de cobertura própria, sem somar outro cliente, SKU, linha, origem ou tarefa ainda aberta", () => {
    for (const invalid of [{ customer_code: "Outro" }, { sku_code: "OUTRO" }, { receipt_id: "outra" }, { inbound_item_id: "outra" }, { source_location_id: "EXPEDICAO" }, { destination_location_id: "EXPEDICAO" }, { status: "planned" }, { box_code: "CX-000001" }]) {
      assert.equal(lineArrivalStored("chegada", RECEIPT, [LINE], [{ ...TASK, ...invalid }]), null, JSON.stringify(invalid));
    }
    const second = { ...LINE, id: "linha-2", line_number: 2, received_qty: 2 };
    assert.equal(lineArrivalStored("chegada", RECEIPT, [LINE, second], [TASK]), null);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [LINE, second], [TASK, { ...TASK, inbound_item_id: "linha-2", quantity: 2 }])?.items.length, 2);
  });

  it("falta usa quantidade recebida, zero sai; EXPEDICAO e local vazio não são prateleira", () => {
    const short = { ...LINE, received_qty: 3, expected_qty: 4 };
    assert.equal(lineArrivalStored("chegada", RECEIPT, [short, { ...LINE, id: "zerada", received_qty: 0 }], [{ ...TASK, quantity: 3 }])?.items[0]?.quantity, 3);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, received_qty: 0 }], []), null);
    for (const location_id of ["EXPEDICAO", "Expedição", ""]) {
      assert.equal(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, location_id }], []), null);
    }
  });

  it("não anuncia antes da entrada, por caixa ou quando há quantidades inválidas", () => {
    for (const receipt of [{ ...RECEIPT, status: "checking" }, { ...RECEIPT, conference_mode: "per_box" }]) {
      assert.equal(lineArrivalStored("chegada", receipt, [{ ...LINE, location_id: "A-01" }], []), null);
    }
    for (const received_qty of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, received_qty, location_id: "A-01" }], []), null);
    }
  });

  it("a soma fracionada da guarda aceita só tolerância de ponto flutuante", () => {
    const line = { ...LINE, received_qty: 0.3 };
    assert.equal(lineArrivalStored("chegada", RECEIPT, [line], [{ ...TASK, quantity: 0.1 }, { ...TASK, quantity: 0.2 }])?.items[0]?.quantity, 0.3);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [line], [{ ...TASK, quantity: 0.299 }]), null);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, received_qty: 1e-16 }], []), null);
    assert.equal(lineArrivalStored("chegada", RECEIPT, [{ ...LINE, received_qty: 1e-16 }], [{ ...TASK, quantity: 1e-17 }]), null);
  });
});
