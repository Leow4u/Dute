// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { CABECALHO_DO_CLIENTE } from "@/lib/active-customer";

/**
 * O Fechamento do mês mostra e grava no cliente ativo desta aba. Antes, a
 * leitura ficava guardada só pelo mês, e a emissão, o pagamento e as
 * quantidades iam para o cliente que estivesse guardado no aparelho na hora
 * do clique: trocar o cliente (aqui ou em outra aba) deixava na tela o mês
 * de um cliente, e "Emitir" congelava e publicava o de outro.
 */

const estado = vi.hoisted(() => ({
  cliente: "BTG Pactual",
  chamadas: [] as Array<{ metodo: string; caminho: string; cliente: string | null }>,
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: estado.cliente, isLoading: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "fin-1", publicMetadata: { role: "financeiro" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Billing from "./billing";

/** O total de setembro de cada cliente, para ver de quem é o mês na tela. */
const TOTAL: Record<string, number> = { "BTG Pactual": 48_210, "Itaú": 1_350 };

function periodo(cliente: string) {
  return {
    competencia: "2026-09",
    status: "aberto",
    custo_estoque: 0,
    ad_valorem_rate: 0,
    total: TOTAL[cliente],
    grupos: [
      {
        grupo: "Armazenagem",
        total: TOTAL[cliente],
        itens: [{ price_list_id: 1, item: "Posição palete", unidade: "posição", qtde: 1, valor_unit: TOTAL[cliente], total: TOTAL[cliente], auto: true }],
      },
    ],
    emission: { can_emit: true, available_from: "2026-10-01" },
  };
}

function resposta(corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let consultas: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function mostrar() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={consultas}>
        <Router ssrPath="/faturamento">
          <Billing />
        </Router>
      </QueryClientProvider>,
    ),
  );
}

function botao(texto: string) {
  const achado = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado;
}

const textoDaTela = () => container!.textContent ?? "";
const leiturasDo = (cliente: string) =>
  estado.chamadas.filter((chamada) => chamada.metodo === "GET" && chamada.caminho === "/api/billing/periods/2026-09" && chamada.cliente === cliente);

beforeEach(() => {
  estado.cliente = "BTG Pactual";
  estado.chamadas = [];
  window.history.replaceState(null, "", "/faturamento?competencia=2026-09");
  // Outra aba guardou o Itaú como cliente ativo neste aparelho.
  window.localStorage.setItem("dute.active-customer.fin-1", "Itaú");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      const metodo = (init?.method ?? "GET").toUpperCase();
      const cliente = new Headers(init?.headers).get(CABECALHO_DO_CLIENTE);
      estado.chamadas.push({ metodo, caminho: url.pathname, cliente });
      if (url.pathname === "/api/billing/periods") return resposta({ items: [] });
      if (url.pathname === "/api/billing/periods/2026-09") return resposta(periodo(cliente ?? "BTG Pactual"));
      if (url.pathname === "/api/billing/periods/2026-09/emit") return resposta({ ok: true });
      throw new Error(`Rota inesperada: ${metodo} ${url.pathname}`);
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
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("o Fechamento do mês grava no cliente que mostra", () => {
  it("lê o mês do cliente ativo e emite para ele, não para o guardado por outra aba", async () => {
    await mostrar();
    await esperar(() => textoDaTela().includes("48.210,00"), "o mês da BTG na tela");
    expect(leiturasDo("BTG Pactual").length).toBeGreaterThan(0);

    await act(async () => botao("Emitir e publicar para a cliente").click());
    await esperar(() => [...document.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Emitir"), "a confirmação");
    await act(async () => botao("Emitir").click());
    await esperar(() => estado.chamadas.some((chamada) => chamada.caminho.endsWith("/emit")), "a emissão");

    const emissoes = estado.chamadas.filter((chamada) => chamada.caminho.endsWith("/emit"));
    expect(emissoes).toEqual([{ metodo: "POST", caminho: "/api/billing/periods/2026-09/emit", cliente: "BTG Pactual" }]);
  });

  it("trocar o cliente ativo troca o mês da tela, que não fica com o do anterior", async () => {
    await mostrar();
    await esperar(() => textoDaTela().includes("48.210,00"), "o mês da BTG na tela");

    estado.cliente = "Itaú";
    await mostrar();
    await esperar(() => textoDaTela().includes("1.350,00"), "o mês do Itaú na tela");
    expect(textoDaTela()).not.toContain("48.210,00");
    expect(leiturasDo("Itaú").length).toBeGreaterThan(0);
  });
});
