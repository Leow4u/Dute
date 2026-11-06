import { describe, expect, it } from "vitest";

import {
  buildBalanceValidation,
  buildVerdict,
  canCloseRequest,
  codigosDaLinha,
  formatRequestAge,
  getRequestValidationLines,
  lineSituation,
  parseRequestDate,
  requestTab,
  type CustomerRequest,
  type StockBalance,
} from "./customer-requests";

function outboundRequest(
  overrides: Partial<CustomerRequest> = {},
): CustomerRequest {
  return {
    id: "creq_test",
    customer_code: "BTG Pactual",
    type: "retirada",
    items: [
      { sku_code: "SKU-A", quantity: 40 },
      { sku_code: "SKU-B", quantity: 30 },
    ],
    ...overrides,
  };
}

describe("buildBalanceValidation: pedido ja reservado no envio", () => {
  it("nao reporta saldo insuficiente quando stock_reservation_status e 'reserved'", () => {
    const request = outboundRequest({ stock_reservation_status: "reserved" });
    // createCustomerRequestTransaction ja reservou no envio: o saldo ao vivo
    // reflete a propria reserva deste pedido, entao "disponivel" ja saiu
    // zerado para cada SKU pedido por inteiro.
    const balances: StockBalance[] = [
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        qty_on_hand: 40,
        qty_reserved: 40,
      },
      {
        sku_code: "SKU-B",
        customer_code: "BTG Pactual",
        qty_on_hand: 30,
        qty_reserved: 30,
      },
    ];

    const validation = buildBalanceValidation(request, balances, false, false);

    expect(validation.status).toBe("ready");
    expect(validation.canApprove).toBe(true);
    expect(
      validation.lines.every((line) => line.status !== "insufficient"),
    ).toBe(true);
  });

  it("continua validando contra o saldo ao vivo quando o pedido nao esta reservado", () => {
    const request = outboundRequest({ stock_reservation_status: undefined });
    const balances: StockBalance[] = [
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        qty_on_hand: 5,
        qty_reserved: 0,
      },
      {
        sku_code: "SKU-B",
        customer_code: "BTG Pactual",
        qty_on_hand: 30,
        qty_reserved: 0,
      },
    ];

    const validation = buildBalanceValidation(request, balances, false, false);

    expect(validation.status).toBe("insufficient");
    expect(validation.canApprove).toBe(false);
  });
});

describe("buildBalanceValidation: soma saldo entre localizacoes", () => {
  it("soma o disponivel de todas as localizacoes do mesmo SKU antes de comparar", () => {
    const request = outboundRequest({
      items: [{ sku_code: "SKU-A", quantity: 50 }],
    });
    const balances: StockBalance[] = [
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        location_id: "LOC-1",
        qty_on_hand: 30,
        qty_reserved: 0,
      },
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        location_id: "LOC-2",
        qty_on_hand: 30,
        qty_reserved: 0,
      },
    ];

    const validation = buildBalanceValidation(request, balances, false, false);

    expect(validation.status).toBe("ready");
    expect(validation.lines[0]?.available).toBe(60);
  });

  it("ainda reporta insuficiente quando a soma das localizacoes nao cobre o pedido", () => {
    const request = outboundRequest({
      items: [{ sku_code: "SKU-A", quantity: 50 }],
    });
    const balances: StockBalance[] = [
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        location_id: "LOC-1",
        qty_on_hand: 10,
        qty_reserved: 0,
      },
      {
        sku_code: "SKU-A",
        customer_code: "BTG Pactual",
        location_id: "LOC-2",
        qty_on_hand: 10,
        qty_reserved: 0,
      },
    ];

    const validation = buildBalanceValidation(request, balances, false, false);

    expect(validation.status).toBe("insufficient");
    expect(validation.lines[0]?.available).toBe(20);
  });
});

describe("buildBalanceValidation: só a prateleira atende o pedido (recebimento com caixas, parte 7)", () => {
  const saldo = (location_id: string, qty_on_hand: number): StockBalance => ({
    sku_code: "SKU-A",
    customer_code: "BTG Pactual",
    location_id,
    qty_on_hand,
    qty_reserved: 0,
  });

  it("o saldo do RECEBIMENTO e da EXPEDICAO não conta, como na reserva do servidor", () => {
    const request = outboundRequest({ items: [{ sku_code: "SKU-A", quantity: 6 }] });
    const balances = [saldo("A-01", 3), saldo("EXPEDICAO", 2), saldo("Recebimento", 5)];

    const validation = buildBalanceValidation(request, balances, false, false);

    expect(validation.status).toBe("insufficient");
    expect(validation.canApprove).toBe(false);
    expect(validation.lines[0]?.available).toBe(3);
    expect(validation.lines[0]?.message).toBe("Disponível: 3.");
  });

  it("o item que pede o local de uma área é recusado com a frase do servidor", () => {
    const request = outboundRequest({ items: [{ sku_code: "SKU-A", quantity: 1, location_id: "RECEBIMENTO" }] });

    const validation = buildBalanceValidation(request, [saldo("RECEBIMENTO", 5)], false, false);

    expect(validation.canApprove).toBe(false);
    expect(validation.lines[0]?.message).toBe(
      "O local RECEBIMENTO não atende pedido: o pedido só reserva o que está na prateleira.",
    );
  });

  it("só com saldo nas áreas, a linha fica sem saldo", () => {
    const request = outboundRequest({ items: [{ sku_code: "SKU-A", quantity: 1 }] });

    const validation = buildBalanceValidation(request, [saldo("EXPEDICAO", 2)], false, false);

    expect(validation.status).toBe("missing-balance");
    expect(validation.canApprove).toBe(false);
  });
});

describe("o rótulo das linhas de item (padrão do nome, 06/11/2026)", () => {
  it("o nome com o tamanho no rótulo e o código do cliente antes do SKU no apoio", () => {
    const lines = getRequestValidationLines(
      outboundRequest({
        items: [
          { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo masculino piquet preto - GG", quantity: 20 },
          { sku_code: "BTG-000084", client_item_code: "A.01.0712.001.42", product_name: "Calça Social Masculino Preta", quantity: 6 },
          { product_name: "Camiseta dry fit M", client_item_code: "CAM-01", size: "M", quantity: 3 },
          { sku_code: "BTG-000300", client_item_code: "A.05.0101.001.U", product_name: "Boné BTG", quantity: 2 },
          { sku_code: "BTG-000200", quantity: 1 },
          { client_item_code: "A.09.0001.002", quantity: 2 },
        ],
      }),
    );
    expect(lines.map((line) => [line.label, codigosDaLinha(line)])).toEqual([
      ["Polo masculino piquet preto · GG", "A.01.0806.005.GG · BTG-000125"],
      ["Calça Social Masculino Preta · 42", "A.01.0712.001.42 · BTG-000084"],
      ["Camiseta dry fit · M", "CAM-01"],
      ["Boné BTG", "A.05.0101.001.U · BTG-000300"],
      ["BTG-000200", ""],
      ["A.09.0001.002", ""],
    ]);
  });

  it("a solicitação de um item só, sem a lista de itens, também leva o nome com o tamanho", () => {
    const [line] = getRequestValidationLines(
      outboundRequest({ items: undefined, product_name: "Polo preto XG", client_item_code: "A.01.0806.005.XG", sku_code: "BTG-000126", quantity: 2 }),
    );
    expect([line?.label, codigosDaLinha(line!)]).toEqual(["Polo preto · XG", "A.01.0806.005.XG · BTG-000126"]);
  });
});

describe("tela de triagem", () => {
  it("lê a data no formato em que a lista do Firestore entrega", () => {
    const expected = new Date("2026-09-29T19:12:00.000Z");
    // Timestamp serializado pelo JSON da lista (o que antes virava "Sem data").
    expect(parseRequestDate({ seconds: expected.getTime() / 1000, nanoseconds: 0 })).toEqual(expected);
    expect(parseRequestDate({ toDate: () => expected })).toEqual(expected);
    expect(parseRequestDate("2026-09-29T19:12:00.000Z")).toEqual(expected);
    expect(parseRequestDate(undefined)).toBeUndefined();
    expect(parseRequestDate("não é data")).toBeUndefined();
  });

  it("mostra a idade da solicitação em linguagem de gente", () => {
    const now = new Date("2026-09-30T12:00:00.000Z").getTime();
    expect(formatRequestAge("2026-09-30T11:55:00.000Z", now)).toBe("há 5 min");
    expect(formatRequestAge("2026-09-30T10:00:00.000Z", now)).toBe("há 2 h");
    expect(formatRequestAge("2026-09-29T11:00:00.000Z", now)).toBe("ontem");
    expect(formatRequestAge(undefined, now)).toBeUndefined();
  });

  it("separa as abas pelo status", () => {
    expect(["open", "Enviada", "pendente", undefined].map(requestTab)).toEqual([
      "decide",
      "decide",
      "decide",
      "decide",
    ]);
    expect(requestTab("approved")).toBe("approved");
    expect(requestTab("rejected")).toBe("done");
    expect(requestTab("Encerrada")).toBe("done");
    expect(requestTab("cancelled")).toBe("done");
  });

  it("a solicitação que o cliente cancelou não volta para decidir", () => {
    const request = outboundRequest({ status: "cancelled", cancel_reason: "Pedido em duplicidade" });
    expect(buildVerdict(request, buildBalanceValidation(request, [], false, false))).toEqual({
      tone: "cancelled",
      title: "Cancelada pelo cliente",
      detail: "Motivo: Pedido em duplicidade",
    });
    const semMotivo = outboundRequest({ status: "cancelled" });
    expect(buildVerdict(semMotivo, buildBalanceValidation(semMotivo, [], false, false)).detail).toBe("Cancelada antes da aprovação.");
  });

  it("o pedido que a Dutelog cancelou diz quem cancelou, com o motivo para a equipe (pergunta 59)", () => {
    const request = outboundRequest({ status: "cancelled", cancel_origin: "dutelog", cancel_reason: "O cliente desistiu do evento." });
    expect(buildVerdict(request, buildBalanceValidation(request, [], false, false))).toEqual({
      tone: "cancelled",
      title: "Cancelada pela Dutelog",
      detail: "Motivo: O cliente desistiu do evento.",
    });
  });

  it("a saída aprovada só se encerra depois da entrega; a entrada, quando quiser (pergunta 59)", () => {
    expect(canCloseRequest(outboundRequest({ status: "approved", operational_status: "packing_ready" }))).toBe(false);
    expect(canCloseRequest(outboundRequest({ status: "approved", operational_status: "dispatched" }))).toBe(false);
    expect(canCloseRequest(outboundRequest({ status: "approved", operational_status: "delivered" }))).toBe(true);
    expect(canCloseRequest(outboundRequest({ status: "approved", fulfillment_status: "completed" }))).toBe(true);
    expect(canCloseRequest(outboundRequest({ status: "approved", type: "recebimento" }))).toBe(true);
    expect(canCloseRequest(outboundRequest({ status: "open" }))).toBe(false);
    expect(canCloseRequest(outboundRequest({ status: "closed", operational_status: "delivered" }))).toBe(false);
  });

  it("explica em uma frase por que não dá para aprovar", () => {
    const request = outboundRequest({
      items: [
        { sku_code: "SKU-A", quantity: 40 },
        { sku_code: "SKU-B", quantity: 30 },
        { sku_code: "SKU-C", quantity: 10 },
      ],
    });
    const balances: StockBalance[] = [
      { sku_code: "SKU-A", location_id: "L1", qty_available: 79 },
      { sku_code: "SKU-B", location_id: "L2", qty_available: 12 },
    ];
    const validation = buildBalanceValidation(request, balances, false, false);
    const verdict = buildVerdict(request, validation);

    expect(verdict.tone).toBe("blocked");
    expect(verdict.title).toBe(
      "Ainda não dá para aprovar: 2 de 3 itens sem saldo suficiente",
    );
    expect(verdict.detail).toBe(
      "1 item sem saldo cadastrado e 1 item com saldo menor que o pedido. O outro item tem saldo. Confira os códigos com o cliente ou recuse explicando o motivo.",
    );
    expect(verdict.readyCount).toBe(1);

    const [ready, short, missing] = validation.lines;
    expect(lineSituation(ready, false)).toEqual({ label: "OK", tone: "ok" });
    expect(lineSituation(short, false)).toEqual({ label: "Faltam 18", tone: "warn" });
    expect(lineSituation(missing, false)).toEqual({
      label: "Sem saldo cadastrado",
      tone: "bad",
    });
  });

  it("pedido com reserva feita no envio está pronto para aprovar", () => {
    const request = outboundRequest({ stock_reservation_status: "reserved" });
    const verdict = buildVerdict(
      request,
      buildBalanceValidation(request, [], false, false),
    );
    expect(verdict).toMatchObject({
      tone: "ready",
      title: "Pronta para aprovar",
      detail: "O estoque já foi reservado quando o cliente enviou o pedido.",
    });
  });

  it("pedido recusado mostra o motivo e não é revalidado contra o saldo", () => {
    const request = outboundRequest({
      status: "rejected",
      stock_reservation_status: "released",
      decision_reason: "Sem janela de expedição",
    });
    const verdict = buildVerdict(
      request,
      buildBalanceValidation(request, [], false, false),
    );
    expect(verdict).toEqual({
      tone: "rejected",
      title: "Recusada",
      detail: "Motivo: Sem janela de expedição",
    });
  });
});
