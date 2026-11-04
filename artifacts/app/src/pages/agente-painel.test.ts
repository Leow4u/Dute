import { describe, expect, it } from "vitest";

import type { HomeInboxItem } from "@/lib/home-inbox";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";

import { abasDoAgente, LINHAS_DO_AGENTE, linhasDoPainel } from "./agente-painel";

/**
 * O que o painel do Agent Dute lê do Início (04/11/2026): só as linhas do
 * agente, na mesma ordem, e as abas que o papel abre.
 */

const ITENS: HomeInboxItem[] = [
  { id: "blocked:ord_3", tone: "critical", title: "Pedido PED-3 com exceção", detail: "Falta física", href: "/pedidos", actionLabel: "Resolver" },
  { id: "stock-alerts", tone: "attention", title: "Alerta de 12 itens parados para aprovar", detail: "BTG", href: "/estoque/alertas", actionLabel: "Revisar" },
  { id: "receipts", tone: "info", title: "1 recebimento para conferir", detail: "NF 48.301", href: "/wms/receber", actionLabel: "Conferir" },
  { id: "agent-notes", tone: "agent", title: "2 anotações do Agent Dute para aprovar", detail: "A BTG pede a entrega", href: "/agente/painel", actionLabel: "Revisar" },
  { id: "agent-playbooks", tone: "agent", title: "1 playbook do Agent Dute para aprovar", detail: "Receber", href: "/agente/conhecimento", actionLabel: "Revisar" },
  { id: "agent", tone: "agent", title: "10 avisos para revisar", detail: "Conferência de recebimento salva", href: "/agente/painel", actionLabel: "Revisar" },
];

describe("o painel do Agent Dute lê o Início", () => {
  it("só as linhas do agente, na ordem do Início, sem repetir o nome do agente", () => {
    expect(linhasDoPainel(ITENS).map((item) => [item.id, item.title])).toEqual([
      ["stock-alerts", "Alerta de 12 itens parados para aprovar"],
      ["agent-notes", "2 anotações para aprovar"],
      ["agent-playbooks", "1 playbook para aprovar"],
    ]);
    // A caixa antiga (a linha "agent") não entra: o painel novo não a lê.
    expect(LINHAS_DO_AGENTE).not.toContain("agent");
  });

  it("as abas que o papel abre, com a aberta marcada", () => {
    expect(abasDoAgente("interno", "/agente/painel")).toEqual([
      { href: "/agente", rotulo: "Conversa", atual: false },
      { href: "/agente/painel", rotulo: "Painel", atual: true },
      { href: "/agente/conhecimento", rotulo: "Conhecimento", atual: false },
    ]);
    expect(abasDoAgente("wms", "/agente").map((aba) => aba.rotulo)).toEqual(["Conversa"]);
  });

  it("na v3 só com o agente do núcleo", () => {
    expect(telaDoWmsNaV3("/agente/painel", undefined, true)).toBe(true);
    expect(telaDoWmsNaV3("/agente/painel", undefined, false)).toBe(false);
  });
});
