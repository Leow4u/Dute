import { describe, expect, it } from "vitest";

import {
  homeNotices,
  homeOrders,
  invoiceLines,
  noticeView,
  orderProgress,
  orderSummary,
  orderTitle,
  parseDate,
  requestKind,
} from "./client-home";

describe("régua do pedido", () => {
  it.each([
    [{ status: "open", operational_status: "reserved_awaiting_review" }, 0],
    [{ status: "approved", operational_status: "picking_planned" }, 1],
    [{ status: "approved", operational_status: "separating" }, 2],
    [{ status: "approved", operational_status: "ready_to_dispatch" }, 2],
    [{ status: "approved", operational_status: "dispatched" }, 3],
    [{ status: "closed", operational_status: "delivered" }, 4],
  ])("%o fica na etapa %i", (request, step) => {
    expect(orderProgress(request)).toMatchObject({ step, rejected: false });
  });

  it("recusado traz o motivo", () => {
    expect(orderProgress({ status: "rejected", decision_reason: "Sem saldo" })).toEqual({
      step: 0,
      rejected: true,
      reason: "Sem saldo",
    });
  });
});

describe("título e resumo", () => {
  const created = { seconds: Date.parse("2026-09-30T15:00:00Z") / 1000 };
  it("usa o título da cliente; o genérico vira a data do pedido", () => {
    expect(orderTitle({ title: "Abastecimento loja Faria Lima" })).toBe("Abastecimento loja Faria Lima");
    expect(orderTitle({ title: "retirada", created_at: created })).toBe("Pedido de 30/09");
  });

  it("resumo com itens e peças; entregue mostra a data da entrega", () => {
    expect(orderSummary({ created_at: created, item_count: 12, quantity_total: 140 }, { step: 1, rejected: false, reason: "" })).toBe(
      "pedido em 30/09 · 12 itens · 140 peças",
    );
    expect(
      orderSummary({ created_at: created, updated_at: "2026-10-01T18:00:00Z", item_count: 1 }, { step: 4, rejected: false, reason: "" }),
    ).toBe("entregue em 01/10 · 1 item");
  });

  it("lê Timestamp, {seconds} e texto", () => {
    expect(parseDate({ toDate: () => new Date("2026-09-01T00:00:00Z") })?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(parseDate(created)?.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(parseDate("ontem")).toBeUndefined();
  });
});

describe("pedidos e avisos no Início", () => {
  const requests = [
    { id: "a", type: "retirada", status: "closed", operational_status: "delivered", created_at: "2026-09-26T10:00:00Z" },
    { id: "b", type: "retirada", status: "approved", operational_status: "separating", created_at: "2026-09-30T10:00:00Z" },
    { id: "c", type: "recebimento", status: "open", created_at: "2026-09-29T10:00:00Z", supplier: "Gráfica Alfa", invoice_number: "48213" },
    { id: "d", type: "retirada", status: "open", created_at: "2026-09-29T10:00:00Z" },
  ];

  it("separa pedido de aviso de chegada", () => {
    expect(requests.map(requestKind)).toEqual(["pedido", "pedido", "aviso", "pedido"]);
  });

  it("em andamento primeiro, depois os concluídos", () => {
    expect(homeOrders(requests).map(({ request }) => request.id)).toEqual(["b", "d", "a"]);
  });

  it("aviso: aguardando, recebido ou recusado", () => {
    expect(homeNotices(requests)).toEqual([
      { title: "Gráfica Alfa · NF 48213", detail: "aguardando a entrega do fornecedor", label: "Aguardando", tone: "waiting" },
    ]);
    expect(noticeView({ status: "closed", operational_status: "received", updated_at: "2026-09-29T15:00:00Z" })).toMatchObject({
      label: "Recebido",
      detail: "recebido e conferido em 29/09",
    });
  });
});

describe("faturas no Início", () => {
  const now = new Date("2026-10-01T15:00:00Z");
  it("mês corrente em andamento e o anterior em fechamento quando ainda não emitido", () => {
    expect(invoiceLines([], now).map((line) => [line.label, line.state])).toEqual([
      ["Outubro/2026", "running"],
      ["Setembro/2026", "closing"],
    ]);
  });

  it("mostra emitida/paga com valor e a anterior mais recente", () => {
    const lines = invoiceLines(
      [
        { competencia: "2026-09", status: "emitido", total: 18420 },
        { competencia: "2026-08", status: "pago", payment_status: "paid", total: 17000 },
      ],
      now,
    );
    expect(lines.map((line) => [line.competencia, line.state, line.amount])).toEqual([
      ["2026-10", "running", undefined],
      ["2026-09", "issued", 18420],
      ["2026-08", "paid", 17000],
    ]);
  });
});
