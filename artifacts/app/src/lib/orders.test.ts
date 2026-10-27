import { describe, expect, it } from "vitest";

import { homeOrderViews, orderNumber, orderStage, orderTitle, orderView, splitOrders } from "./orders";

const request = {
  id: "creq_c2a648db96a33d6453643a98d298cec5",
  request_number: "PED-0043",
  type: "retirada",
  title: "Pedido do estoque com 2 item(ns)",
  destination: "BTG Faria Lima",
  status: "approved",
  item_count: 2,
  quantity_total: 100,
  requested_by_name: "Leonardo Silva",
  created_at: "2026-10-01T12:40:00Z",
  items: [
    { line_number: 1, client_item_code: "A.01.0594.005.M", product_name: "POLO PIQUET AZUL M", quantity: 40 },
    { line_number: 2, product_name: "CANECA", quantity: 60, code_pending: true },
  ],
};

const tracking = {
  id: "ord_creq_c2a648db96a33d6453643a98d298cec5",
  customer_request_id: "creq_c2a648db96a33d6453643a98d298cec5",
  order_number: "PED-0043",
  status: "dispatched",
  carrier: "Transportadora Expressa",
  vehicle_plate: "ABC1D23",
  timeline: [
    { status: "pending", label: "Pedido recebido", occurred_at: "2026-10-01T14:05:00Z" },
    { status: "separating", label: "Em separação", occurred_at: "2026-10-02T13:12:00Z" },
    { status: "dispatched", label: "Saiu para entrega", occurred_at: "2026-10-02T17:20:00Z" },
  ],
};

describe("número do pedido", () => {
  it("mostra PED-0043; pedido antigo sem número mostra um curto, nunca o id inteiro", () => {
    expect(orderNumber(request)).toBe("PED-0043");
    expect(orderNumber({ id: "creq_c2a648db96a33d6453643a98d298cec5" })).toBe("#98CEC5");
    expect(orderNumber({ id: "creq_x" }, { order_number: "SOL-98D298CE" })).toBe("SOL-98D298CE");
  });

  it("título automático vira 'Pedido do estoque'", () => {
    expect(orderTitle(request)).toBe("Pedido do estoque");
    expect(orderTitle({ title: "Kit boas-vindas" })).toBe("Kit boas-vindas");
  });
});

describe("etapa do pedido", () => {
  it("segue o acompanhamento da operação", () => {
    expect(orderStage({ status: "open" })).toBe("placed");
    expect(orderStage({ status: "approved" })).toBe("confirmed");
    expect(orderStage({ status: "approved" }, { status: "separating" })).toBe("picking");
    expect(orderStage({ status: "approved" }, { status: "ready_to_dispatch" })).toBe("picking");
    expect(orderStage(request, tracking)).toBe("dispatched");
    expect(orderStage({ status: "approved" }, { status: "delivered" })).toBe("delivered");
    expect(orderStage({ status: "cancelled" }, { status: "separating" })).toBe("cancelled");
    expect(orderStage({ status: "rejected" })).toBe("rejected");
  });
});

describe("como o pedido aparece", () => {
  it("resume itens, datas das etapas, entrega e linha do tempo", () => {
    const view = orderView(request, tracking);
    expect(view.number).toBe("PED-0043");
    expect(view.summary).toBe("2 itens · 100 peças");
    expect(orderView({ id: "r1", type: "pedido", item_count: 1, quantity_total: 1 }).summary).toBe("1 item · 1 peça");
    expect(view.destination).toBe("BTG Faria Lima");
    expect(view.delivery).toBe("Transportadora Expressa · placa ABC1D23");
    expect(view.stepDates[0]).toBe("01/10, 09:40");
    expect(view.stepDates[1]).toBe("02/10, 10:12");
    expect(view.stepDates[2]).toBe("02/10, 14:20");
    expect(view.stepDates[3]).toBe("");
    expect(view.timeline.map((event) => event.label)).toEqual([
      "Saiu para entrega",
      "Em separação",
      "Pedido confirmado pela Dutelog",
      "Pedido feito no portal",
    ]);
    expect(view.detail).toBe("saiu para entrega · 02/10, 14:20");
    expect(view.items[1]).toEqual({ code: "", name: "CANECA", quantity: 60, codePending: true });
    expect(view.canCancel).toBe(false);
  });

  it("aguardando a Dutelog: pode cancelar", () => {
    const view = orderView({ ...request, status: "open" });
    expect(view.stage).toBe("placed");
    expect(view.canCancel).toBe(true);
    expect(view.detail).toBe("pedido por Leonardo em 01/10 · aguardando a Dutelog confirmar");
  });

  it("cancelado pela Dutelog: quem cancelou e a data, sem o motivo (pergunta 59)", () => {
    const cancelado = { ...request, status: "cancelled", operational_status: "cancelled", cancel_origin: "dutelog", cancelled_at: "2026-10-26T13:30:00Z" };
    const acompanhamento = {
      ...tracking,
      status: "cancelled",
      status_label: "Cancelado pela Dutelog",
      cancel_origin: "dutelog",
      cancelled_at: "2026-10-26T13:30:00Z",
      timeline: [
        ...tracking.timeline.slice(0, 2),
        { status: "cancelled", label: "Cancelado pela Dutelog", occurred_at: "2026-10-26T13:30:00Z" },
      ],
    };
    const view = orderView(cancelado, acompanhamento);
    expect(view.stage).toBe("cancelled");
    expect(view.detail).toBe("cancelado pela Dutelog em 26/10");
    expect(view.timeline.map((event) => event.label)).toEqual([
      "Cancelado pela Dutelog",
      "Em separação",
      "Pedido confirmado pela Dutelog",
      "Pedido feito no portal",
    ]);
    expect(view.canCancel).toBe(false);
    // Sem o acompanhamento, a solicitação basta.
    const semAcompanhamento = orderView(cancelado);
    expect(semAcompanhamento.detail).toBe("cancelado pela Dutelog em 26/10");
    expect(semAcompanhamento.timeline[0]?.label).toBe("Cancelado pela Dutelog");
    // O cancelado pelo cliente continua como antes.
    expect(orderView({ ...request, status: "cancelled", updated_at: "2026-10-02T12:00:00Z" }).detail).toBe("cancelado por você em 02/10");
  });

  it("separa em andamento e histórico e ignora avisos de envio", () => {
    const { active, history } = splitOrders(
      [
        request,
        { id: "creq_b", type: "retirada", status: "cancelled", created_at: "2026-09-03T12:00:00Z" },
        { id: "creq_env", type: "recebimento", status: "open" },
      ],
      [tracking],
    );
    expect(active.map((view) => view.number)).toEqual(["PED-0043"]);
    expect(history.map((view) => view.stage)).toEqual(["cancelled"]);
  });
});

describe("pedidos no Início", () => {
  const now = new Date("2026-10-02T15:00:00Z");
  const base = { type: "retirada", item_count: 1, quantity_total: 1 };
  const requests = [
    { ...base, id: "a", request_number: "PED-0044", status: "open", created_at: "2026-10-01T12:00:00Z" },
    { ...base, id: "b", request_number: "PED-0042", status: "rejected", decision_reason: "saldo insuficiente", created_at: "2026-09-30T12:00:00Z", updated_at: "2026-10-01T18:00:00Z" },
    { ...base, id: "c", request_number: "PED-0030", status: "rejected", created_at: "2026-09-03T12:00:00Z", updated_at: "2026-09-04T12:00:00Z" },
    { ...base, id: "d", request_number: "PED-0040", status: "closed", operational_status: "delivered", created_at: "2026-09-28T12:00:00Z" },
    { ...base, id: "e", request_number: "PED-0041", status: "cancelled", created_at: "2026-10-01T10:00:00Z" },
  ];

  it("em andamento e recusados dos últimos 7 dias; entregues, cancelados e recusados antigos ficam fora", () => {
    const views = homeOrderViews(requests, [], now);
    expect(views.map((view) => [view.number, view.stage])).toEqual([
      ["PED-0044", "placed"],
      ["PED-0042", "rejected"],
    ]);
    expect(views[1]?.detail).toContain("saldo insuficiente");
  });
});
