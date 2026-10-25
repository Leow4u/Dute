// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import type { OrderDraft, ShipmentDraft } from "@/lib/agent-draft";

/**
 * O cartão do Agent Dute levado à tela ("Abrir no Estoque", "Abrir na tela
 * Envios") vai com a mensagem dele: o envio pela tela fica ligado ao cartão,
 * e a mesma mensagem nunca vira dois pedidos. Antes, o rascunho ia sem ela,
 * e o cartão continuava oferecendo o próprio envio.
 */

vi.mock("@/pages/client/shared", async (original) => ({
  ...(await original<typeof import("@/pages/client/shared")>()),
  useClientOverview: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import { OrderDraftCard } from "./order-draft-card";
import { ShipmentDraftCard } from "./shipment-draft-card";

const PEDIDO: OrderDraft = {
  tipo: "pedido",
  destino: "Agência Faria Lima",
  linhas: [{ sku_code: "BTG-000101", codigo: "A.01.0805.002.PP", nome: "Polo PP", quantidade: 10, disponivel: 12 }],
  pendencias: [],
};

const AVISO: ShipmentDraft = {
  tipo: "envio",
  fornecedor: "Malharia Sul",
  linhas: [{ codigo: "A.01.0805.002.PP", nome: "Polo PP", quantidade: 50, situacao: "no_estoque" }],
};

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function mostrar(cartao: React.ReactNode) {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Router ssrPath="/portal/agente">{cartao}</Router>
      </QueryClientProvider>,
    ),
  );
}

async function clicar(texto: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!botao) throw new Error(`Sem o botão ${texto}`);
  await act(async () => botao.click());
}

function rascunhoGuardado() {
  return JSON.parse(window.sessionStorage.getItem("dute.agent-draft") ?? "null") as Record<string, unknown> | null;
}

beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("o cartão do agente levado à tela", () => {
  it('"Abrir no Estoque" leva a mensagem do cartão no rascunho', async () => {
    await mostrar(<OrderDraftCard draft={PEDIDO} messageId="msg_agent_1" />);
    await clicar("Abrir no Estoque para adicionar itens");
    expect(rascunhoGuardado()).toMatchObject({ tipo: "pedido", mensagem: "msg_agent_1", destino: "Agência Faria Lima" });
  });

  it('"Abrir na tela Envios" leva a mensagem do cartão no rascunho', async () => {
    await mostrar(<ShipmentDraftCard draft={AVISO} messageId="msg_agent_2" />);
    await clicar("Abrir na tela Envios");
    expect(rascunhoGuardado()).toMatchObject({ tipo: "envio", mensagem: "msg_agent_2", fornecedor: "Malharia Sul" });
  });
});
