// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { Anunciador } from "@/lib/carregando/anunciador";

/**
 * O Início da Armazenagem com uma fonte que falhou, com as leituras de
 * verdade (`useInicioDoWms`; carregamento v2, parte 13e). Antes: o "Tentar de
 * novo" e a releitura de cada minuto voltavam a fonte que falhou a
 * "carregando", o aviso saía da tela com o foco nele e a tela anunciava
 * "Carregando o que precisa de você" sem ninguém pedir; o toque não relia as
 * anotações nem os playbooks do Agent Dute; e "Hoje no armazém" afirmava
 * zero com o armazém sem leitura. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  opsFalha: true,
  opsPresa: false,
  opsDemora: 0,
  leiturasOps: 0,
  leiturasNotas: 0,
  notasFalham: false,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u1", fullName: "Sandra Melo", publicMetadata: { role: "admin" } } }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetDashboard: () => useQuery({ queryKey: ["dashboard"], queryFn: async () => ({ total_skus: 7 }) }),
}));
vi.mock("@/lib/agente/navegacao", async (original) => ({ ...(await original<typeof import("@/lib/agente/navegacao")>()), revisaODoAgente: () => true }));
vi.mock("@/lib/agente/cliente", async (original) => ({
  ...(await original<typeof import("@/lib/agente/cliente")>()),
  clienteDoNucleo: () => ({
    chave: ["nucleo", "wms", "BTG"],
    anotacoes: {
      listar: async () => {
        estado.leiturasNotas += 1;
        if (estado.notasFalham) throw new Error("Falhou.");
        return { notes: [] };
      },
    },
    playbooks: { listar: async () => ({ playbooks: [] }) },
  }),
}));

import Home from "./home";

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(estado, { opsFalha: true, opsPresa: false, opsDemora: 0, leiturasOps: 0, leiturasNotas: 0, notasFalham: false });
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/warehouse/ops") {
        estado.leiturasOps += 1;
        if (estado.opsPresa) return new Promise<Response>(() => undefined);
        if (estado.opsDemora) await new Promise((pronto) => setTimeout(pronto, estado.opsDemora));
        if (estado.opsFalha) return new Response(JSON.stringify({ message: "Caiu." }), { status: 500 });
        return new Response(JSON.stringify({ orders: [], alerts: [], metrics: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

const tentar = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((botao) => /Tentar de novo|Tentando de novo…/.test(botao.textContent ?? ""));
const aviso = () => container.querySelector<HTMLElement>("[data-falha-na-secao]");
const anuncio = () => document.querySelector("[data-anunciador]")?.textContent ?? "";

async function abrir() {
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Router ssrPath="/dashboard">
          <main>
            <Home />
          </main>
        </Router>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
}

function numerosDoDia() {
  return [...container.querySelectorAll('section[aria-labelledby="hoje-no-armazem"] li')].map((linha) => linha.textContent);
}

describe("o Início do WMS com o armazém que falhou sem nada lido", () => {
  it("Hoje no armazém não afirma zero: os números do dia ficam —", async () => {
    await abrir();
    await ate(() => aviso());
    expect(aviso()!.textContent).toContain("Não foi possível carregar: armazém.");
    expect(numerosDoDia().slice(0, 4)).toEqual(["Pedidos para separar—", "Prontos para envio—", "Em rota de entrega—", "Recebimentos em aberto—"]);
  });

  it("o toque em Tentar de novo mantém o aviso e o foco no botão, com Tentando de novo…", async () => {
    await abrir();
    await ate(() => aviso());
    const avisoDaFalha = aviso();
    estado.opsDemora = 1_500;
    tentar()!.focus();
    await act(async () => tentar()!.click());
    await ate(() => tentar()?.textContent === "Tentando de novo…");
    expect(aviso()).toBe(avisoDaFalha);
    expect(document.activeElement).toBe(tentar());
    expect(tentar()!.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).not.toContain("Carregando o que precisa de você");
  });

  it("a releitura de cada minuto não tira o aviso, não mexe no foco nem no botão, e não fala", async () => {
    await abrir();
    await ate(() => aviso());
    const avisoDaFalha = aviso();
    tentar()!.focus();
    await espera(2_100);
    const falado = anuncio();
    // A releitura do intervalo, presa: a pessoa não pediu.
    estado.opsPresa = true;
    await act(async () => void cliente.refetchQueries({ queryKey: ["warehouse-ops"] }));
    await espera(500);
    expect(aviso()).toBe(avisoDaFalha);
    expect(document.activeElement).toBe(tentar());
    expect(tentar()!.textContent).toBe("Tentar de novo");
    expect(container.querySelectorAll("[data-linha-fantasma]")).toHaveLength(0);
    expect(container.textContent).not.toContain("Carregando o que precisa de você");
    expect(anuncio()).toBe(falado);
  });
});

describe("o Início do WMS com o Agent Dute que falhou", () => {
  it("o toque em Tentar de novo relê a fonte que falhou", async () => {
    estado.opsFalha = false;
    estado.notasFalham = true;
    await abrir();
    await ate(() => aviso()?.textContent?.includes("Agent Dute"));
    const antes = estado.leiturasNotas;
    estado.notasFalham = false;
    await act(async () => tentar()!.click());
    await ate(() => estado.leiturasNotas > antes);
    await ate(() => !aviso());
    expect(estado.leiturasNotas).toBeGreaterThan(antes);
  });
});

describe("o Início do WMS com a releitura que falha depois de lido", () => {
  it("a falha fica escrita em cima do que estava lido, sem falar (momento 7)", async () => {
    estado.opsFalha = false;
    await abrir();
    await ate(() => numerosDoDia()[0] === "Pedidos para separar0");
    estado.opsFalha = true;
    await act(async () => void cliente.refetchQueries({ queryKey: ["warehouse-ops"] }));
    await ate(() => aviso());
    expect(aviso()!.querySelector('[role="alert"]')).toBeNull();
    // O que estava lido fica.
    expect(numerosDoDia()[0]).toBe("Pedidos para separar0");
  });
});
