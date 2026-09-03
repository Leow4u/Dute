import { describe, expect, it } from "vitest";

import {
  buildBalanceValidation,
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
