import { describe, expect, it } from "vitest";

import { buildHomeInbox } from "../home-inbox";
import { alertaLido, alternarItem, alternarTodos, itensMarcados, itensParadosEmTexto, rotuloDoAlerta } from "./alertas";

/**
 * O alerta do item parado para aprovar (parte 5.4e): a proposta aberta lida
 * do núcleo, a escolha dos itens e a linha do "Precisa de você" da
 * Armazenagem. Dados sintéticos.
 */

const PROPOSTA = {
  id: "alerta_0123456789abcdef01234567",
  customer_code: "ITAU",
  status: "proposta",
  regra: { parado_dias: 90, sem_giro_dias: 180 },
  itens: [
    { sku_code: "ITAU-000001", client_item_code: "POLO-M", product_name: "Camisa polo", saldo: 30, ultima_movimentacao: "2026-04-03T15:00:00.000Z", dias_parado: 200 },
    { sku_code: "ITAU-000002", client_item_code: null, product_name: null, saldo: 4, ultima_movimentacao: "2026-07-12T15:00:00.000Z", dias_parado: 100 },
    { sku_code: "", ultima_movimentacao: "2026-07-12T15:00:00.000Z" },
  ],
};

describe("a proposta aberta", () => {
  it("lê os itens; o item sem SKU fica de fora", () => {
    expect(alertaLido(PROPOSTA)).toEqual({
      id: PROPOSTA.id,
      customerCode: "ITAU",
      regra: { parado_dias: 90, sem_giro_dias: 180 },
      itens: [
        { skuCode: "ITAU-000001", clientItemCode: "POLO-M", productName: "Camisa polo", saldo: 30, ultimaMovimentacao: "2026-04-03T15:00:00.000Z", diasParado: 200 },
        { skuCode: "ITAU-000002", clientItemCode: null, productName: null, saldo: 4, ultimaMovimentacao: "2026-07-12T15:00:00.000Z", diasParado: 100 },
      ],
    });
  });

  it("a decidida e a sem item não aparecem", () => {
    expect(alertaLido({ ...PROPOSTA, status: "aprovada" })).toBeNull();
    expect(alertaLido({ ...PROPOSTA, itens: [] })).toBeNull();
    expect(alertaLido({ ...PROPOSTA, customer_code: "" })).toBeNull();
  });

  it("os textos do alerta", () => {
    expect([itensParadosEmTexto(1), itensParadosEmTexto(3)]).toEqual(["1 item parado", "3 itens parados"]);
    expect(rotuloDoAlerta(alertaLido(PROPOSTA)!)).toBe("Parado 90+ dias");
  });
});

describe("a escolha dos itens", () => {
  const alerta = alertaLido(PROPOSTA)!;
  const todos = new Set(["ITAU-000001", "ITAU-000002"]);

  it("marca e desmarca um ou todos, e manda os marcados na ordem do alerta", () => {
    const sem = alternarItem(todos, "ITAU-000001");
    expect([...sem]).toEqual(["ITAU-000002"]);
    expect(itensMarcados(alerta, alternarItem(sem, "ITAU-000001"))).toEqual(["ITAU-000001", "ITAU-000002"]);
    expect(alternarTodos(alerta, todos).size).toBe(0);
    expect([...alternarTodos(alerta, sem)]).toEqual(["ITAU-000001", "ITAU-000002"]);
  });
});

describe("o Precisa de você da Armazenagem", () => {
  const alertas = [
    { id: "a1", customer_code: "ITAU", itens: 2 },
    { id: "a2", customer_code: "SAFRA", itens: 1 },
  ];

  it("um alerta: os itens; vários: quantos alertas; leva a Estoque › Alertas", () => {
    const um = buildHomeInbox({ role: "admin", stockAlerts: alertas.slice(0, 1) }).items.find((item) => item.id === "stock-alerts");
    expect(um).toMatchObject({ tone: "attention", title: "Alerta de 2 itens parados para aprovar", detail: "ITAU", href: "/estoque/alertas", actionLabel: "Revisar" });
    const varios = buildHomeInbox({ role: "interno", stockAlerts: alertas }).items.find((item) => item.id === "stock-alerts");
    expect(varios).toMatchObject({ title: "2 alertas de itens parados para aprovar", detail: "ITAU · SAFRA" });
  });

  it("quem não decide não vê a linha", () => {
    for (const role of ["wms", "suporte", "financeiro"] as const) {
      expect(buildHomeInbox({ role, stockAlerts: alertas }).items.some((item) => item.id === "stock-alerts")).toBe(false);
    }
  });
});
