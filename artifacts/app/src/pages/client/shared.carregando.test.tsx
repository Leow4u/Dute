// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
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
const atrasada = (ms: number, corpo: unknown, status = 200) => () =>
  new Promise<Response>((pronto) =>
    setTimeout(() => pronto(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } })), ms),
  );

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

async function montar(
  tela: (overview: { customer?: { name?: string } }) => React.ReactNode = (overview) => <h1>{`Portal de ${overview.customer?.name ?? ""}`}</h1>,
  forma: { titulo?: string; largura?: string } = {},
) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <ClientDataBoundary {...forma}>{tela}</ClientDataBoundary>
        <Anunciador />
      </QueryClientProvider>,
    ),
  );
  return cliente;
}

const OVERVIEW = { customer: { code: "BTG", name: "BTG Pactual" } };

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

describe("o portal lendo, a forma e a árvore (revisão da parte 13f)", () => {
  it("a tela nasce com o título dela, na largura dela, sem o ícone que nenhuma tela tem", async () => {
    estado.respostas = [presa];
    await montar(undefined, { titulo: "Pedidos", largura: "max-w-6xl" });
    // Já no 0 ms: o título real da tela, no lugar do bloco.
    expect(container.querySelector("main h1")?.textContent).toBe("Pedidos");
    expect(container.querySelector("main > div")!.className).toContain("max-w-6xl");
    expect(container.querySelector("main > div")!.className).not.toContain("max-w-7xl");
    expect(container.querySelector(".h-12.w-12")).toBeNull();
    await ate(() => container.textContent?.includes("Carregando o portal…"));
    const html = container.querySelector("main")!.outerHTML;
    expect(textosForaDaLista(html, ["Pedidos", "Carregando o portal…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a linha de estado fica fora do aria-busy e nunca encolhe; os blocos cabem no que sobra, sem rolar", async () => {
    estado.respostas = [presa];
    await montar();
    await ate(() => container.textContent?.includes("Carregando o portal…"));
    const main = container.querySelector("main")!;
    expect(main.hasAttribute("aria-busy")).toBe(false);
    const linha = container.querySelector<HTMLElement>("[data-carregando-na-regiao]")!;
    expect(linha.closest("[aria-busy='true']")).toBeNull();
    expect(linha.className).toContain("shrink-0");
    const blocos = container.querySelector<HTMLElement>("[data-blocos-do-portal]")!;
    expect(blocos.getAttribute("aria-busy")).toBe("true");
    expect(blocos.getAttribute("aria-describedby")).toBe(linha.id);
    // Os blocos encolhem e cortam (overflow-hidden), em vez de passar por cima da linha.
    expect(blocos.className).toContain("min-h-0");
    expect(blocos.className).toContain("overflow-hidden");
  });
});

describe("a espera do portal que a tela continua (revisão da parte 13f)", () => {
  it("a tela que chega e ainda lê o que é dela segue a mesma espera: o indicador não some, nada é anunciado de novo, e a demora conta do começo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      estado.respostas = [atrasada(1_000, OVERVIEW)];
      const falas: string[] = [];
      await montar(() => <CarregandoNaRegiao rotulo="Carregando eventos…" continuaARota />);
      const ouvir = () => {
        const texto = anunciado();
        if (texto && falas[falas.length - 1] !== texto) falas.push(texto);
      };
      for (let ms = 0; ms < 1_000; ms += 50) {
        await act(async () => vi.advanceTimersByTime(50));
        ouvir();
      }
      expect(container.textContent).toContain("Carregando o portal…");
      // O portal chegou e a tela lê os eventos: na mesma hora, a caixa e o rótulo da tela, sem o vão de 300 ms.
      await act(async () => vi.advanceTimersByTime(20));
      expect(container.textContent).toContain("Carregando eventos…");
      // A caixa da tela continua a do portal: não entra de novo (sem o desvanecer da entrada).
      expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.hasAttribute("data-continua")).toBe(true);
      for (let ms = 0; ms < 9_100; ms += 100) {
        await act(async () => vi.advanceTimersByTime(100));
        ouvir();
      }
      // Aos 10 s do começo da espera (e não aos 10 s da leitura dos eventos), a demora.
      expect(container.textContent).toContain("Demorando mais que o normal");
      expect(falas.filter((fala) => fala.startsWith("Carregando"))).toEqual(["Carregando o portal"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a região que sai com o foco (revisão da parte 13f)", () => {
  it("depois do Tentar de novo da demora, quando o portal chega, o foco vai ao título da tela, e não ao body", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    try {
      estado.respostas = [presa, atrasada(1_500, OVERVIEW)];
      await montar();
      await act(async () => vi.advanceTimersByTime(10_100));
      const tentar = botao("Tentar de novo")!;
      tentar.focus();
      await act(async () => tentar.click());
      expect(container.querySelector("[data-carregando-na-regiao]")!.contains(document.activeElement)).toBe(true);
      for (let ms = 0; ms < 1_700; ms += 50) await act(async () => vi.advanceTimersByTime(50));
      expect(container.textContent).toContain("Portal de BTG Pactual");
      expect(document.activeElement?.textContent).toBe("Portal de BTG Pactual");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a releitura do portal que falha (revisão da parte 13f)", () => {
  it("com o portal lido, a falha que não é de conexão não apaga a tela: a frase fica escrita em cima, sem falar", async () => {
    estado.respostas = [json(OVERVIEW), json({ message: "Falha interna" }, 500)];
    const cliente = await montar();
    await ate(() => container.textContent?.includes("Portal de BTG Pactual"));
    await act(async () => cliente.invalidateQueries());
    await ate(() => container.textContent?.includes("Não foi possível atualizar o portal."));
    expect(container.textContent).toContain("Portal de BTG Pactual");
    expect(container.textContent).not.toContain("Não foi possível carregar o portal.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Portal de BTG Pactual", "Não foi possível atualizar o portal.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("o portal que não carregou", () => {
  it("a falha da primeira leitura nasce dizendo Tentar de novo, e não Tentando de novo…", async () => {
    estado.respostas = [atrasada(700, { message: "Falha interna" }, 500)];
    await montar();
    let disseTentando = false;
    for (let vez = 0; vez < 60 && !botao("Tentar de novo"); vez += 1) {
      await espera(20);
      disseTentando ||= Boolean(botao("Tentando de novo…"));
    }
    for (let vez = 0; vez < 15; vez += 1) {
      disseTentando ||= Boolean(botao("Tentando de novo…"));
      await espera(20);
    }
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(disseTentando).toBe(false);
  });

  it("a nova tentativa que falha de novo antes de 300 ms não pisca o botão nem muda o alerta", async () => {
    estado.respostas = [json({ message: "Falha interna" }, 500), atrasada(150, { message: "Falha interna" }, 500)];
    await montar();
    await ate(() => botao("Tentar de novo"));
    const alerta = container.querySelector('[role="alert"]')!;
    const frases = new Set([alerta.textContent]);
    await act(async () => botao("Tentar de novo")!.click());
    for (let vez = 0; vez < 15; vez += 1) {
      await espera(20);
      frases.add(container.querySelector('[role="alert"]')?.textContent ?? "");
      expect(botao("Tentando de novo…")).toBeUndefined();
    }
    expect(estado.leituras).toBe(2);
    expect([...frases]).toEqual(["Não foi possível carregar o portal.Tentar de novo"]);
  });

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
