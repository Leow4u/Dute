import { describe, expect, it } from "vitest";

import {
  buildBalanceValidation,
  buildVerdict,
  formatRequestAge,
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
