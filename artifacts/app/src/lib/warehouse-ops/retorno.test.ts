import { describe, expect, it } from "vitest";

import { codigosDaLinha, detalheDoRetorno, linhaDoRetorno, pedidoDoRetorno, problemaDoRetorno, retornoAReceber } from "./retorno";

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

  it("a tela mostra o item com o tamanho e o código do cliente; o servidor recebe o nome gravado, como antes", () => {
    const polo = linhaDoRetorno("oit_4", { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo masculino piquet preto - GG", picked_qty: 20 })!;
    const toalha = linhaDoRetorno("oit_5", { sku_code: "BTG-000301", client_item_code: "C.0659.001.U", product_name: "Toalha de Academia", picked_qty: 3 })!;
    const banner = linhaDoRetorno("oit_2", { sku_code: "BTG-BAN-1", product_name: "Banner", allocated_qty: 6 })!;
    expect([polo.item, polo.nome, codigosDaLinha(polo)]).toEqual(["Polo masculino piquet preto · GG", "Polo masculino piquet preto - GG", "A.01.0806.005.GG · BTG-000125"]);
    // Tamanho único fica só com o nome; sem o código do cliente, só o SKU.
    expect([toalha.item, codigosDaLinha(toalha)]).toEqual(["Toalha de Academia", "C.0659.001.U · BTG-000301"]);
    expect([banner.item, codigosDaLinha(banner)]).toEqual(["Banner", "BTG-BAN-1"]);
    expect(problemaDoRetorno([{ ...polo, voltou: "21" }])).toBe("Polo masculino piquet preto · GG: voltaram mais do que saiu (20).");
    expect(problemaDoRetorno([{ ...polo, voltou: "" }])).toBe("Polo masculino piquet preto · GG: informe quantos voltaram.");
    expect(pedidoDoRetorno("ord_118", [polo], "", "k2")).toEqual({
      idempotency_key: "k2",
      order_id: "ord_118",
      items: [{ sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo masculino piquet preto - GG", quantity: 20 }],
    });
  });
});
