import { describe, expect, it } from "vitest";

import { detalheDoRetorno, linhaDoRetorno, pedidoDoRetorno, problemaDoRetorno, retornoAReceber } from "./retorno";

/** O retorno do pedido de saída no WMS (parte 4.5d): o que está a receber, o que voltou e o pedido. Dados sintéticos. */

const RETORNO = { customer_code: "BTG Pactual", order_number: "PED-0118", retorno: { status: "a_receber", os: "10050-02", demanda: "10050", chegou_em: "2026-10-30T21:40:00.000Z" } };

describe("o retorno a receber", () => {
  it("só o a receber, com a OS e quando chegou", () => {
    const retorno = retornoAReceber("ord_118", RETORNO)!;
    expect(retorno).toEqual({ orderId: "ord_118", numero: "PED-0118", customerCode: "BTG Pactual", os: "10050-02", chegouEm: "2026-10-30T21:40:00.000Z" });
    expect(detalheDoRetorno(retorno)).toBe("OS 10050-02 · chegou Sex 30/10 18:40");
    expect(retornoAReceber("ord_118", { ...RETORNO, retorno: { ...RETORNO.retorno, status: "recebido" } })).toBeNull();
    expect(retornoAReceber("ord_118", { customer_code: "BTG Pactual" })).toBeNull();
  });

  it("as linhas começam com o que saiu; voltar a mais, quebrado ou nada recusa; o pedido leva só o que voltou", () => {
    const estande = linhaDoRetorno("oit_1", { sku_code: "BTG-EST-1", client_item_code: "EST-1", product_name: "Estande modular", picked_qty: 12 })!;
    const banner = linhaDoRetorno("oit_2", { sku_code: "BTG-BAN-1", product_name: "Banner", allocated_qty: 6 })!;
    expect([estande.voltou, banner.clientItemCode]).toEqual(["12", "BTG-BAN-1"]);
    expect(linhaDoRetorno("oit_3", { sku_code: "X", picked_qty: 0 })).toBeNull();
    expect(problemaDoRetorno([estande, banner])).toBeNull();
    expect(problemaDoRetorno([{ ...estande, voltou: "13" }])).toBe("Estande modular: voltaram mais do que saiu (12).");
    expect(problemaDoRetorno([{ ...estande, voltou: "1,5" }])).toBe("Estande modular: informe quantos voltaram.");
    expect(problemaDoRetorno([{ ...estande, voltou: "0" }])).toBe("Informe ao menos um item que voltou.");
    expect(pedidoDoRetorno("ord_118", [estande, { ...banner, voltou: "0" }], " 2 painéis riscados ", "k1")).toEqual({
      idempotency_key: "k1",
      order_id: "ord_118",
      items: [{ sku_code: "BTG-EST-1", client_item_code: "EST-1", product_name: "Estande modular", quantity: 12 }],
      notes: "2 painéis riscados",
    });
  });
});
