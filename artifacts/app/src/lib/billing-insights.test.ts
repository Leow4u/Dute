import { describe, expect, it } from "vitest";

import {
  billingInsights,
  billingReport,
  closedInvoices,
  deliveriesByMonth,
  monthLabel,
  monthRange,
  shiftCompetencia,
} from "./billing-insights";

const invoice = (competencia: string, total: number, status: string, armazenagem: number, expedicao: number) => ({
  id: competencia,
  competencia,
  status,
  total,
  emitido_em: `${shiftCompetencia(competencia, 1)}-01T12:00:00Z`,
  pago_em: status === "pago" ? `${shiftCompetencia(competencia, 1)}-08T12:00:00Z` : undefined,
  groups: [
    { grupo: "armazenamento", itens: [{ item: "Posição palete", qtde: 10, valor_unit: armazenagem / 10, total: armazenagem }] },
    { grupo: "expedicao", itens: [{ item: "Saída por peça", qtde: 100, valor_unit: expedicao / 100, total: expedicao }] },
  ],
});

const raw = [
  invoice("2026-07", 9800, "pago", 7000, 2800),
  invoice("2026-08", 21400, "pago", 15000, 6400),
  invoice("2026-09", 23900, "emitido", 16000, 7900),
  { id: "2026-10", competencia: "2026-10", status: "aberto", total: 5000 },
];

describe("meses", () => {
  it("formata e anda pelos meses", () => {
    expect(monthLabel("2026-09")).toBe("set/26");
    expect(monthLabel("2026-09", true)).toBe("Setembro/2026");
    expect(shiftCompetencia("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("faturas fechadas", () => {
  it("só emitidas e pagas, da mais recente para a mais antiga, com os serviços", () => {
    const closed = closedInvoices(raw);
    expect(closed.map((item) => item.competencia)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(closed[0]).toMatchObject({ total: 23900, status: "emitida" });
    expect(closed[1]?.status).toBe("paga");
    expect(closed[0]?.services.map((service) => service.label)).toEqual(["Armazenamento", "Expedição"]);
  });
});

describe("pedidos entregues", () => {
  it("conta por mês da entrega", () => {
    const counts = deliveriesByMonth([
      { status: "delivered", delivered_at: "2026-09-10T12:00:00Z" },
      { status: "delivered", timeline: [{ status: "delivered", occurred_at: "2026-09-20T12:00:00Z" }] },
      { status: "delivered", delivered_at: "2026-08-02T12:00:00Z" },
      { status: "dispatched", delivered_at: "2026-09-21T12:00:00Z" },
    ]);
    expect(counts.get("2026-09")).toBe(2);
    expect(counts.get("2026-08")).toBe(1);
  });
});

describe("painel", () => {
  it("última fatura, variação, média dos meses faturados e acumulado do ano", () => {
    const insights = billingInsights(closedInvoices(raw), new Map([["2026-09", 14]]), 6);
    expect(insights.latest?.competencia).toBe("2026-09");
    expect(insights.change).toBe(11.68);
    expect(insights.months.map((month) => month.label)).toEqual(["abr/26", "mai/26", "jun/26", "jul/26", "ago/26", "set/26"]);
    expect(insights.months[0]?.total).toBeNull();
    expect(insights.average).toBe(18366.67);
    expect(insights).toMatchObject({ yearTotal: 55100, yearCount: 3, yearPaid: 2, year: "2026", deliveredLatest: 14 });
  });

  it("sem fatura fechada fica vazio", () => {
    expect(billingInsights([], new Map()).latest).toBeNull();
  });
});

describe("relatório", () => {
  it("serviço × mês, totais e entregues do período", () => {
    const report = billingReport(closedInvoices(raw), new Map([["2026-08", 3], ["2026-09", 14]]), "2026-08", "2026-09");
    expect(report.months).toEqual(["2026-08", "2026-09"]);
    expect(report.services).toEqual([
      { label: "Armazenamento", byMonth: [15000, 16000], total: 31000 },
      { label: "Expedição", byMonth: [6400, 7900], total: 14300 },
    ]);
    expect(report.monthTotals).toEqual([21400, 23900]);
    expect(report).toMatchObject({ total: 45300, average: 22650, deliveredTotal: 17 });
    expect(report.invoices.map((item) => item.competencia)).toEqual(["2026-08", "2026-09"]);
  });
});
