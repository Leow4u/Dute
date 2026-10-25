// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O detalhe da Solicitações não passa sozinho à vizinha. A que está na tela
 * e sai da aba por outra mão (o cliente a cancelou no portal, outra pessoa
 * a aprovou) continua nela, com a situação nova e sem as ações que não valem
 * mais. Antes, o detalhe mostrava a primeira da aba, no mesmo lugar, e
 * "Aprovar e separar" aprovava a que ninguém tinha conferido.
 */

const estado = vi.hoisted(() => ({
  solicitacoes: [] as Array<Record<string, unknown>>,
  decisoes: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "coord-1", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => () => undefined }));

import CustomerRequests from "./customer-requests";

function solicitacao(id: string, descricao: string, criadaEm: string, status = "pending") {
  return {
    id,
    customer_code: "BTG Pactual",
    type: "retirada",
    priority: "normal",
    status,
    description: descricao,
    created_at: criadaEm,
    items: [{ sku_code: "BTG-000101", quantity: 10 }],
  };
}

const FARIA_LIMA = solicitacao("creq_0412", "Pedido da Faria Lima", "2026-10-25T09:00:00.000Z");
const LEBLON = solicitacao("creq_0398", "Pedido do Leblon", "2026-10-25T10:00:00.000Z");

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let consultas: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const tituloDoDetalhe = () => container!.querySelector("h2")?.textContent ?? "";
const botao = (texto: string) => [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto) ?? null;

async function abrir() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consultas}>
        <Router ssrPath="/solicitacoes">
          <CustomerRequests />
        </Router>
      </QueryClientProvider>,
    ),
  );
  await esperar(() => tituloDoDetalhe() === "Pedido da Faria Lima", "o detalhe da que espera há mais tempo");
  await esperar(() => !botao("Aprovar e separar")?.disabled, "o saldo conferido");
}

beforeEach(() => {
  estado.solicitacoes = [FARIA_LIMA, LEBLON];
  estado.decisoes = [];
  window.history.replaceState(null, "", "/solicitacoes");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/customer-requests") return json({ items: estado.solicitacoes });
      if (url.pathname === "/api/stock-balances") {
        return json({ items: [{ sku_code: "BTG-000101", customer_code: "BTG Pactual", qty_on_hand: 100, qty_reserved: 0, qty_available: 100 }] });
      }
      const decisao = /^\/api\/customer-requests\/([^/]+)\/(approve|reject|close)$/.exec(url.pathname);
      if (decisao && init?.method === "POST") {
        estado.decisoes.push(`${decodeURIComponent(decisao[1]!)}:${decisao[2]}`);
        return json({ ok: true, status: decisao[2] === "approve" ? "approved" : "closed" });
      }
      return json({});
    }),
  );
  consultas = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("o detalhe da Solicitações", () => {
  it("a que o cliente cancelou continua na tela, sem aprovar, e a vizinha não toma o lugar", async () => {
    await abrir();

    // O cliente cancela a da Faria Lima no portal; a lista chega de novo.
    estado.solicitacoes = [{ ...FARIA_LIMA, status: "cancelled" }, LEBLON];
    await act(async () => {
      await consultas.invalidateQueries();
    });
    await esperar(() => !botao("Aprovar e separar"), "a cancelada sem as ações de aprovar");

    expect(tituloDoDetalhe()).toBe("Pedido da Faria Lima");
    expect(botao("Recusar com motivo")).toBeNull();
    expect(estado.decisoes).toEqual([]);
  });

  it("aprovada aqui, o detalhe passa à próxima da aba, como antes", async () => {
    await abrir();

    await act(async () => botao("Aprovar e separar")!.click());
    await esperar(() => estado.decisoes.length === 1, "a aprovação");
    estado.solicitacoes = [{ ...FARIA_LIMA, status: "approved" }, LEBLON];
    await act(async () => {
      await consultas.invalidateQueries();
    });
    await esperar(() => tituloDoDetalhe() === "Pedido do Leblon", "a próxima no detalhe");

    expect(estado.decisoes).toEqual(["creq_0412:approve"]);
  });
});
