// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ClientDataBoundary } from "./shared";

/**
 * A leitura do portal no carregamento v2 (parte 13f), que toda tela do portal
 * espera (`ClientDataBoundary`). Antes: o "Carregando portal do cliente" só
 * existia para o leitor de tela, fora de qualquer região viva, e nada dizia
 * nada à vista; a falha dizia "Portal indisponível" com o "Tentar novamente"
 * que girava o RefreshCw e se desabilitava (o foco caía no `body`), e a nova
 * tentativa trocava o aviso pelo esqueleto. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ respostas: [] as Array<() => Promise<Response>>, leituras: 0 }));

const json = (corpo: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }));
const presa = () => new Promise<Response>(() => undefined);

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
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
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <ClientDataBoundary>{(overview) => <h1>{`Portal de ${overview.customer?.name ?? ""}`}</h1>}</ClientDataBoundary>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
}

const botao = (rotulo: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);
const anunciado = () => container.querySelector("[data-anunciador]")?.textContent ?? "";

describe("o portal lendo", () => {
  it("aos 300 ms, a caixa e 'Carregando o portal…' à vista, com o anúncio; os blocos ficam fora da árvore", async () => {
    estado.respostas = [presa];
    await montar();
    // Antes dos 300 ms, nada à vista: nem a caixa nem o rótulo.
    expect(container.textContent).not.toContain("Carregando o portal…");
    await ate(() => container.textContent?.includes("Carregando o portal…"));
    expect(container.querySelector(".sr-only:not([data-anunciador])")).toBeNull();
    const caixa = container.querySelector("[data-carregando-na-regiao] [data-spinner]");
    expect(caixa?.getAttribute("aria-hidden")).toBe("true");
    for (const bloco of container.querySelectorAll("[data-esqueleto]")) expect(bloco.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".animate-spin, .animate-pulse")).toBeNull();
    await ate(() => anunciado().includes("Carregando o portal"));
    const html = container.querySelector("main")!.outerHTML;
    expect(textosForaDaLista(html, ["Carregando o portal…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("aos 10 s, a demora com 'Tentar de novo', que lê de novo do zero", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      estado.respostas = [presa];
      await montar();
      await act(async () => vi.advanceTimersByTime(10_100));
      expect(container.textContent).toContain("Demorando mais que o normal");
      const leiturasAntes = estado.leituras;
      await act(async () => botao("Tentar de novo")!.click());
      await act(async () => vi.advanceTimersByTime(50));
      expect(estado.leituras).toBe(leiturasAntes + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("o portal que não carregou", () => {
  it("diz que não carregou, com 'Tentar de novo'; a nova tentativa fica no aviso, sem esqueleto e sem desabilitar", async () => {
    estado.respostas = [json({ message: "Falha interna" }, 500), presa];
    await montar();
    await ate(() => botao("Tentar de novo"));
    expect(container.textContent).toContain("Não foi possível carregar o portal.");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Não foi possível carregar o portal.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    botao("Tentar de novo")!.focus();
    await act(async () => botao("Tentar de novo")!.click());
    await espera(400);
    // A falha fica na tela durante a nova tentativa: nada de esqueleto, e o foco não cai no body.
    expect(container.querySelector("[data-esqueleto]")).toBeNull();
    const tentando = botao("Tentando de novo…");
    expect(tentando).toBeTruthy();
    expect(tentando!.hasAttribute("disabled")).toBe(false);
    expect(tentando!.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(tentando);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("sem nada lido e sem conexão, o aviso da conexão no lugar do portal", async () => {
    estado.respostas = [json({ message: "Sem conexão. Tente de novo quando o sinal voltar." }, 503)];
    await montar();
    await ate(() => botao("Tentar de novo"));
    expect(container.textContent).toMatch(/Reconectando…|Sem conexão\./);
    expect(container.textContent).not.toContain("Portal indisponível");
  });
});
