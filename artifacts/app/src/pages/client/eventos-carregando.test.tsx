// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import type { ClientEvent } from "@/lib/client-events";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Eventos do portal lendo e na falha (carregamento v2, parte 13f). Antes: com
 * o portal já lido, a lista dos eventos trocava a tela inteira por um segundo
 * esqueleto, sem o título e com o "Carregando eventos" só para o leitor de
 * tela; a falha dizia o erro cru, sem "Tentar de novo". Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ respostas: [] as Array<() => Promise<Response>>, leituras: 0 }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return {
    ...original,
    ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</>,
  };
});

import { ClienteEventos } from "./eventos";

const EVENTO: ClientEvent = {
  id: "ev_1",
  name: "Feira de Investimentos",
  description: null,
  venue: "Expo Center Norte",
  address: null,
  next_date: "2026-12-10",
  schedule: null,
  logistics: null,
  items: [],
};

const json = (corpo: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }));
const presa = () => new Promise<Response>(() => undefined);
const lenta = (corpo: unknown, ms: number) => () =>
  new Promise<Response>((pronto) => setTimeout(() => pronto(new Response(JSON.stringify(corpo), { status: 200 })), ms));

let raiz: Root | null = null;
let ultimoCliente: QueryClient | null = null;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.respostas = [];
  estado.leituras = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      estado.leituras += 1;
      const proxima = estado.respostas.length > 1 ? estado.respostas.shift()! : estado.respostas[0];
      return proxima ? proxima() : presa();
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
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

async function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  ultimoCliente = cliente;
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Router>
          <ClienteEventos />
        </Router>
      </QueryClientProvider>,
    ),
  );
}

const botao = (rotulo: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);

const DESCRICAO =
  "Cada evento já tem a lista do que vai para o local. Na próxima edição, é só usar no pedido: a Dutelog leva, monta e traz de volta.";

describe("Eventos lendo", () => {
  it("o título fica desde o começo, e aos 300 ms a caixa e 'Carregando eventos…', sem um segundo esqueleto da tela", async () => {
    estado.respostas = [presa];
    await montar();
    expect(container.querySelector("h1")?.textContent).toBe("Eventos");
    await ate(() => container.textContent?.includes("Carregando eventos…"));
    expect(container.querySelector("h1")?.textContent).toBe("Eventos");
    expect(container.querySelector("[data-esqueleto]")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    // Nunca "Nenhum evento ainda" antes de ler.
    expect(container.textContent).not.toContain("Nenhum evento ainda");
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Eventos", DESCRICAO, "Carregando eventos…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("Eventos que não carregaram", () => {
  it("dizem que não carregaram, com 'Tentar de novo'; a nova tentativa fica no aviso e traz a lista", async () => {
    estado.respostas = [json({ message: "Falha interna" }, 500), lenta({ events: [EVENTO] }, 1_500)];
    await montar();
    await ate(() => botao("Tentar de novo"));
    expect(container.textContent).toContain("Não foi possível carregar os eventos.");
    expect(container.textContent).not.toContain("Nenhum evento ainda");
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Eventos", DESCRICAO, "Não foi possível carregar os eventos.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    await act(async () => botao("Tentar de novo")!.click());
    // No relógio da espera: no toque, ainda "Tentar de novo"; "Tentando de novo…" só aos 300 ms (a nova tentativa que
    // falha antes não pisca o botão).
    // (o react-query avisa a leitura nova num setTimeout: 30 ms bastam para o botão cru já dizer "Tentando".)
    await espera(30);
    expect(botao("Tentando de novo…")).toBeUndefined();
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(container.textContent).not.toContain("Carregando eventos…");
    await ate(() => botao("Tentando de novo…"));
    const tentando = botao("Tentando de novo…");
    expect(tentando).toBeTruthy();
    expect(tentando!.hasAttribute("disabled")).toBe(false);
    expect(container.textContent).not.toContain("Carregando eventos…");
    await ate(() => container.textContent?.includes("Feira de Investimentos"));
    expect(container.textContent).not.toContain("Não foi possível carregar os eventos.");
  });
});

describe("Eventos que não se atualizaram (revisão da parte 13f)", () => {
  it("a releitura que falha não apaga a lista: a frase fica escrita em cima dela, sem falar, com Tentar de novo", async () => {
    estado.respostas = [json({ events: [EVENTO] }), json({ message: "Falha interna" }, 500)];
    await montar();
    await ate(() => container.textContent?.includes("Feira de Investimentos"));
    await act(async () => ultimoCliente!.invalidateQueries());
    await ate(() => container.textContent?.includes("Não foi possível atualizar os eventos."));
    expect(container.textContent).toContain("Feira de Investimentos");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const falha = container.querySelector<HTMLElement>("[data-falha-na-secao]")!;
    expect(textosForaDaLista(falha.outerHTML, ["Não foi possível atualizar os eventos.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(falha.outerHTML)).toEqual([]);
  });
});
