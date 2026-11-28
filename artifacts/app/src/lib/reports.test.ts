import { describe, expect, it } from "vitest";

import {
  belowMinimumReport,
  classifyMovement,
  dayRange,
  formatCell,
  formatDateCell,
  idleReport,
  monthRange,
  motivoDoMovimento,
  movementsReport,
  positionReport,
  quemFezOMovimento,
  requestsReport,
  toExcelCsv,
} from "./reports";
import type { StockItem } from "./stock-items";

function item(partial: Partial<StockItem> & { skuCode: string }): StockItem {
  return {
    key: partial.skuCode,
    name: partial.skuCode,
    detail: "",
    onHand: 0,
    reserved: 0,
    available: 0,
    locations: [],
    photos: [],
    low: false,
    zero: false,
    sku: {},
    ...partial,
  };
}

describe("períodos em horário de Brasília", () => {
  it("o mês vai da meia-noite do dia 1 até a meia-noite do mês seguinte", () => {
    expect(monthRange("2026-09")).toEqual({
      from: "2026-09-01T03:00:00.000Z",
      to: "2026-10-01T03:00:00.000Z",
    });
    expect(monthRange("2026-12").to).toBe("2027-01-01T03:00:00.000Z");
  });

  it("datas escolhidas incluem o último dia inteiro", () => {
    expect(dayRange("2026-09-10", "2026-09-12")).toEqual({
      from: "2026-09-10T03:00:00.000Z",
      to: "2026-09-13T03:00:00.000Z",
    });
  });
});

describe("posição de estoque", () => {
  it("só itens com saldo, do maior valor ao menor, com o total", () => {
    const report = positionReport([
      item({ skuCode: "A", clientCode: "C1", onHand: 2, available: 2, unitCost: 10, locations: [{ id: "A-01", qty: 2 }] }),
      item({ skuCode: "B", clientCode: "C2", onHand: 5, available: 3, reserved: 2, unitCost: 100 }),
      item({ skuCode: "Z", onHand: 0, unitCost: 999 }),
    ]);
    expect(report.rows.map((row) => row.sku)).toEqual(["B", "A"]);
    expect(report.rows[1]).toMatchObject({ locations: "A-01", value: 20 });
    expect(report.summary[2].value).toBe("R$ 520,00");
  });
});

describe("abaixo do mínimo", () => {
  it("usa o mínimo da ficha e inclui o zerado; sem mínimo não entra", () => {
    const report = belowMinimumReport([
      item({ skuCode: "A", onHand: 3, minimum: 10 }),
      item({ skuCode: "B", onHand: 0, minimum: 5 }),
      item({ skuCode: "C", onHand: 20, minimum: 10 }),
      item({ skuCode: "D", onHand: 0 }),
    ]);
    expect(report.rows.map((row) => [row.code, row.missing])).toEqual([
      ["A", 7],
      ["B", 5],
    ]);
  });
});

describe("itens parados", () => {
  const now = new Date("2026-10-01T15:00:00.000Z");
  it("conta do último movimento do item e, sem movimento, do go-live", () => {
    const report = idleReport(
      [
        item({ skuCode: "A", onHand: 5, unitCost: 1 }),
        item({ skuCode: "B", onHand: 5, unitCost: 2 }),
        item({ skuCode: "C", onHand: 5 }),
        item({ skuCode: "D", onHand: 0 }),
      ],
      [
        { sku_code: "A", data: "2026-09-25T10:00:00.000Z" },
        { cod_sku: "B", data: "2026-07-31T10:00:00.000Z" },
        { cod_sku: "B", data: "2026-07-30T10:00:00.000Z" },
      ],
      60,
      now,
    );
    expect(report.rows.map((row) => [row.code, row.idleDays])).toEqual([
      ["B", 62],
      ["C", 63],
    ]);
  });
});

describe("movimentações", () => {
  it("classifica pelo vínculo gravado no ledger", () => {
    expect(classifyMovement({ tipo_mov: "ENTRADA", receipt_id: "r1", receipt_number: "R-0031" })).toEqual({
      kind: "Entrada",
      origin: "Recebimento R-0031",
    });
    expect(classifyMovement({ tipo_mov: "SAIDA", order_id: "o1", order_number: "P-0128" }).origin).toBe("Pedido P-0128");
    expect(classifyMovement({ tipo_mov: "SAIDA", putaway_task_id: "t", origem: "DOCA", destino: "A-01" }).kind).toBe("Transferência");
    expect(classifyMovement({ tipo_mov: "SAIDA", cycle_count_id: "c" })).toEqual({ kind: "Ajuste", origin: "Contagem" });
    expect(classifyMovement({ tipo_mov: "ENTRADA", reason: "Avaria", operational_operation_id: "op" }).origin).toBe("Ajuste: Avaria");
    // O mover caixa (19/11/2026): a mudança de prateleira é transferência, não ajuste.
    const mover = { reason: "Mudança de prateleira", operational_operation_id: "op", box_move_id: "bmv_1", from_location_id: "A-01", to_location_id: "B-09" };
    expect(classifyMovement({ ...mover, tipo_mov: "SAIDA", movement_kind: "box_move_out" })).toEqual({ kind: "Transferência", origin: "Mudança de prateleira A-01 → B-09" });
    expect(classifyMovement({ ...mover, tipo_mov: "ENTRADA", movement_kind: "box_move_in" })).toEqual({ kind: "Transferência", origin: "Mudança de prateleira A-01 → B-09" });
  });

  it("o mover caixa não entra nos totais nem nos ajustes", () => {
    const mover = { data: "2026-11-19T17:32:00.000Z", quantity: 20, reason: "Mudança de prateleira", operational_operation_id: "op", box_move_id: "bmv_1", from_location_id: "A-01", to_location_id: "B-09" };
    const report = movementsReport([
      { ...mover, tipo_mov: "SAIDA", movement_kind: "box_move_out" },
      { ...mover, tipo_mov: "ENTRADA", movement_kind: "box_move_in" },
    ]);
    expect(report.summary.map((linha) => linha.value)).toEqual(["+0 un.", "−0 un.", "0"]);
  });

  it("quantidade com sinal e totais sem contar transferência", () => {
    const report = movementsReport([
      { data: "2026-09-02T10:00:00.000Z", tipo_mov: "ENTRADA", quantity: 60, receipt_id: "r", actor: { name: "Rafael" } },
      { data: "2026-09-03T10:00:00.000Z", tipo_mov: "SAIDA", quantity: 4, order_id: "o" },
      { data: "2026-09-04T10:00:00.000Z", tipo_mov: "SAIDA", quantity: 60, putaway_task_id: "t" },
    ]);
    expect(report.rows.map((row) => [row.kind, row.quantity])).toEqual([
      ["Transferência", -60],
      ["Saída", -4],
      ["Entrada", 60],
    ]);
    expect(report.rows[2].who).toBe("Rafael");
    expect(report.summary.map((entry) => entry.value)).toEqual(["+60 un.", "−4 un.", "0"]);
  });
});

/**
 * Quem fez e por quê, como as Movimentações: a ficha do item e o Histórico do
 * Estoque leem daqui (anotado em 18/11/2026: as duas telas liam o
 * `responsavel`, que nenhuma Function grava).
 */
describe("quem fez o movimento e por quê", () => {
  it("quem fez: o nome do ator que o servidor grava, o e-mail sem o nome e, no movimento antigo, o responsavel", () => {
    expect(
      quemFezOMovimento({ actor: { uid: "u-1", email: "guilherme@dutelog.com.br", name: "Guilherme Dantas", role: "admin" } }),
    ).toBe("Guilherme Dantas");
    expect(quemFezOMovimento({ actor: { uid: "u-2", email: "rafael@dutelog.com.br", role: "interno" } })).toBe("rafael@dutelog.com.br");
    expect(quemFezOMovimento({ responsavel: "João Operador" })).toBe("João Operador");
    expect(quemFezOMovimento({ actor: { uid: "u-3", name: " ", email: "" }, responsavel: "" })).toBe("");
    expect(quemFezOMovimento({})).toBe("");
  });

  it("as Movimentações dizem quem pela mesma regra", () => {
    const [comAtor, antigo] = movementsReport([
      { data: "2026-11-27T15:00:00.000Z", tipo_mov: "SAIDA", quantity: 4, order_id: "o", actor: { uid: "u-2", email: "rafael@dutelog.com.br" } },
      { data: "2026-11-26T15:00:00.000Z", tipo_mov: "ENTRADA", quantity: 6, receipt_id: "r", responsavel: "João Operador" },
    ]).rows;
    expect([comAtor.who, antigo.who]).toEqual(["rafael@dutelog.com.br", "João Operador"]);
  });

  it("por quê: a origem das Movimentações, pelo vínculo ou pelo motivo digitado", () => {
    expect(motivoDoMovimento({ tipo_mov: "SAIDA", order_id: "creq_1", order_number: "PED-0012", source: "wms_shipping" })).toBe("Pedido PED-0012");
    expect(motivoDoMovimento({ tipo_mov: "ENTRADA", receipt_id: "rcp_1", receipt_number: "AVL-1A2B3C4D", source: "wms_receiving" })).toBe(
      "Recebimento AVL-1A2B3C4D",
    );
    expect(
      motivoDoMovimento({ tipo_mov: "SAIDA", reason: "Avaria na caixa", operational_operation_id: "op_1", source: "functions_manual_inventory" }),
    ).toBe("Ajuste: Avaria na caixa");
    expect(motivoDoMovimento({ tipo_mov: "SAIDA", putaway_task_id: "pt_1", origem: "RECEBIMENTO", destino: "B-05", source: "wms_putaway" })).toBe(
      "Guarda RECEBIMENTO → B-05",
    );
    expect(motivoDoMovimento({ tipo_mov: "ENTRADA", cycle_count_id: "cc_1", reason: "Recontagem geral", source: "functions_cycle_count" })).toBe(
      "Contagem",
    );
  });

  it("sem vínculo nem motivo, nada: o source é um nome técnico (as Movimentações seguem com ele)", () => {
    expect(motivoDoMovimento({ tipo_mov: "ENTRADA", source: "wms_receiving", responsavel: "João Operador" })).toBe("");
    expect(motivoDoMovimento({})).toBe("");
    expect(classifyMovement({ tipo_mov: "ENTRADA", source: "wms_receiving" })).toEqual({ kind: "Entrada", origin: "wms_receiving" });
  });
});

describe("pedidos", () => {
  it("traduz situação e ordena do mais recente", () => {
    const report = requestsReport(
      [
        { id: "a", status: "approved", created_at: "2026-09-01T12:00:00.000Z", requested_by: { name: "Cristiane" } },
        { id: "b", status: "rejected", created_at: "2026-09-05T12:00:00.000Z", decision_reason: "Sem saldo" },
      ],
      {
        date: (value) => (typeof value === "string" ? new Date(value) : undefined),
        type: () => "Retirada",
        status: (status) => status ?? "open",
        lines: () => 1,
        units: () => 3,
      },
    );
    expect(report.rows.map((row) => [row.id, row.status])).toEqual([
      ["b", "Recusado"],
      ["a", "Aprovado"],
    ]);
    expect(report.rows[1].requestedBy).toBe("Cristiane");
  });
});

describe("planilha para o Excel em português", () => {
  it("BOM, ponto e vírgula, vírgula decimal, data de Brasília e aspas escapadas", () => {
    const csv = toExcelCsv({
      columns: [
        { key: "name", label: "Item" },
        { key: "value", label: "Valor", kind: "money" },
        { key: "qty", label: "Qtd.", kind: "number" },
        { key: "date", label: "Data", kind: "date" },
      ],
      rows: [{ name: 'Caneca "térmica"; 500 ml', value: 1234.5, qty: -4, date: "2026-09-30T20:57:00.000Z" }],
    });
    expect(csv.startsWith("﻿Item;Valor;Qtd.;Data\r\n")).toBe(true);
    expect(csv).toContain('"Caneca ""térmica""; 500 ml";1234,50;-4;30/09/2026 17:57');
  });

  it("data vazia ou inválida não quebra a linha", () => {
    expect(formatDateCell("")).toBe("");
    expect(formatDateCell("ontem")).toBe("ontem");
    expect(formatCell("2026-07-30T03:00:00.000Z", "day")).toBe("30/07/2026");
  });
});

describe("itens parados pelo código do cliente", () => {
  it("movimento gravado só com o código do cliente também conta", () => {
    const report = idleReport(
      [item({ skuCode: "SKU1", clientCode: "C1", onHand: 5 })],
      [{ client_item_code: "C1", data: "2026-09-30T10:00:00.000Z" }],
      30,
      new Date("2026-10-01T15:00:00.000Z"),
    );
    expect(report.rows).toEqual([]);
  });
});
