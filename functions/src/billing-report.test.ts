import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { billingReportWorkbook, buildBillingReport, reportMonths } from "./domain/billing-report.js";

const invoice = (competencia: string, status: string, armazenagem: number, expedicao: number) => ({
  id: competencia,
  competencia,
  status,
  total: armazenagem + expedicao,
  emitido_em: `${competencia}-28T12:00:00Z`,
  pago_em: status === "pago" ? `${competencia}-30T12:00:00Z` : undefined,
  groups: [
    { grupo: "armazenamento", itens: [{ item: "Posição palete", unidade: "pallet", qtde: 10, valor_unit: armazenagem / 10, total: armazenagem }] },
    {
      grupo: "expedicao",
      itens: [
        { item: "Saída por peça", unidade: "peça", qtde: 100, valor_unit: expedicao / 100, total: expedicao },
        { item: "Etiqueta", unidade: "un", qtde: 0, valor_unit: 1, total: 0 },
      ],
    },
  ],
});

const invoices = [
  invoice("2026-07", "pago", 7000, 2800),
  invoice("2026-08", "pago", 15000, 6400),
  invoice("2026-09", "emitido", 16000, 7900),
  { id: "2026-10", competencia: "2026-10", status: "aberto", total: 5000 },
];

const trackings = [
  { id: "ord_a", order_number: "PED-0040", status: "delivered", delivered_at: "2026-08-20T15:00:00Z", destination: "BTG Rio", item_count: 3, quantity_total: 200 },
  { id: "ord_b", order_number: "PED-0042", status: "delivered", timeline: [{ status: "delivered", occurred_at: "2026-09-05T15:00:00Z" }], item_count: 1, quantity_total: 40 },
  { id: "ord_c", order_number: "PED-0043", status: "dispatched", delivered_at: "2026-09-06T15:00:00Z" },
];

describe("relatório de faturas", () => {
  it("valida o período", () => {
    assert.deepEqual(reportMonths("2026-11", "2027-01"), ["2026-11", "2026-12", "2027-01"]);
    assert.throws(() => reportMonths("2026-09", "2026-08"), /Período inválido/);
    assert.throws(() => reportMonths("2026-9", "2026-10"), /Período inválido/);
    assert.throws(() => reportMonths("2024-01", "2026-01"), /no máximo 24/);
  });

  it("só faturas fechadas do período, serviço × mês e pedidos entregues", () => {
    const report = buildBillingReport({ customerCode: "BTG Pactual", from: "2026-08", to: "2026-10", invoices, trackings });
    assert.deepEqual(report.invoices.map((item) => item.competencia), ["2026-08", "2026-09"]);
    assert.deepEqual(report.services, [
      { label: "Armazenamento", byMonth: [15000, 16000, 0], total: 31000 },
      { label: "Expedição", byMonth: [6400, 7900, 0], total: 14300 },
    ]);
    assert.deepEqual(report.monthTotals, [21400, 23900, 0]);
    assert.equal(report.total, 45300);
    assert.equal(report.average, 22650);
    assert.deepEqual(report.deliveries.map((item) => item.number), ["PED-0040", "PED-0042"]);
    assert.equal(report.invoices[1]?.lines.length, 2, "linha com quantidade zero não entra");
  });

  it("gera a planilha com as cinco abas", async () => {
    const report = buildBillingReport({ customerCode: "BTG Pactual", from: "2026-07", to: "2026-09", invoices, trackings });
    const buffer = await billingReportWorkbook(report, "Leonardo");
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    assert.deepEqual(workbook.worksheets.map((sheet: { name: string }) => sheet.name), ["Resumo", "Por serviço", "Itens", "Faturas", "Pedidos entregues"]);
    const resumo = workbook.getWorksheet("Resumo");
    assert.equal(resumo.getCell("B3").value, "Julho/2026 a Setembro/2026");
    assert.equal(resumo.getCell("B7").value, 55100);
    const porServico = workbook.getWorksheet("Por serviço");
    assert.deepEqual(porServico.getRow(1).values.slice(1), ["Serviço", "Julho/2026", "Agosto/2026", "Setembro/2026", "Total"]);
    assert.deepEqual(porServico.getRow(4).values.slice(1), ["Total", 9800, 21400, 23900, 55100]);
    assert.equal(workbook.getWorksheet("Itens").rowCount, 7);
    assert.equal(workbook.getWorksheet("Faturas").getCell("C2").value, "Paga em 30/07/2026");
    assert.equal(workbook.getWorksheet("Pedidos entregues").rowCount, 3);
  });
});
