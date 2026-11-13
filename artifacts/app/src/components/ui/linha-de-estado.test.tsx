// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao, criarConexao, type Conexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { useAtualizarLista, type LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { SemResposta } from "@/lib/conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import { BotaoAtualizar, LinhaDeEstado } from "./linha-de-estado";

/**
 * A linha de estado das listas (carregamento v2, seção 5.3 e momentos 2, 7 e
 * 8; parte 7b): uma linha de 24 px sob o título, sempre reservada, que é a
 * casa do estado da lista. A releitura automática não mostra nada, não fala e
 * não mexe na região viva; o Atualizar só gira quando a pessoa toca nele.
 * Dados sintéticos.
 */

// 13:42 UTC são 10:42 no armazém (America/Sao_Paulo).
const LIDA_EM = Date.parse("2026-11-13T13:42:00Z");

/** Uma leitura parada num estado, como o useQuery a daria. */
function leitura(parcial: Partial<LeituraDaLista> = {}): LeituraDaLista {
  return {
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: LIDA_EM,
    refetch: vi.fn(async () => ({ isError: false }) as never),
    ...parcial,
  };
}

function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm(estado)}>{elemento}</ProvedorDaConexao>);
}

const FALTA = { isError: true, error: new SemResposta() } as const;

// No ambiente jsdom o Vite reescreve `new URL(..., import.meta.url)` como endereço de asset.
const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

describe("a linha de estado, parada em cada estado", () => {
  it("lida: só a hora da leitura, no apoio, sem indicador e sem região viva", async () => {
    const html = naConexao("conectado", <LinhaDeEstado leitura={leitura()} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Atualizado às 10:42"]);
    expect(html).toContain("linha-de-estado-calmo");
    expect(html).not.toContain("data-spinner");
    expect(html).not.toMatch(/role="(status|alert)"|aria-live|aria-busy/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com várias leituras, a hora da mais recente: a última vez que a lista se atualizou (no Estoque, os saldos a cada 2 min e o catálogo a cada 5)", () => {
    const html = naConexao("conectado", <LinhaDeEstado leitura={[leitura(), leitura({ dataUpdatedAt: LIDA_EM + 2 * 60_000 })]} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Atualizado às 10:44"]);
  });

  it("reconectando, com a lista lida: os arcos do Wi-Fi em tinta, a hora da lista e Tentar de novo (absorve a faixa)", async () => {
    const html = naConexao("reconectando", <LinhaDeEstado leitura={leitura(FALTA)} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
    expect(html).toContain("data-arcos");
    expect(html).not.toContain("linha-de-estado-pilula");
    expect(html).not.toContain("Sem conexão");
    expect(html).not.toMatch(/role="(status|alert)"|aria-live/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem conexão, com a lista lida: a pílula âmbar com o Wi-Fi cortado, a hora da lista e Tentar de novo", async () => {
    const html = naConexao("sem-conexao", <LinhaDeEstado leitura={leitura(FALTA)} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(html).toContain("linha-de-estado-pilula");
    expect(html).toContain("lucide-wifi-off");
    expect(html).toMatch(/<button[^>]*data-tom="aviso"/);
    // "Sem conexão" o Anunciador diz uma vez, ao entrar; a linha não é região viva.
    expect(html).not.toMatch(/role="(status|alert)"|aria-live/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com a falta numa só das leituras, a hora é a da que falhou", () => {
    const html = naConexao("reconectando", <LinhaDeEstado leitura={[leitura({ dataUpdatedAt: LIDA_EM + 5 * 60_000 }), leitura({ ...FALTA, dataUpdatedAt: LIDA_EM })]} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
  });

  it("sem nada lido (o aviso fica no lugar da lista), antes de 300 ms e sem leitura: nada, nem 0 nem Nenhum, mas a linha reservada", () => {
    const vazias: Array<[string, LeituraDaLista | LeituraDaLista[]]> = [
      ["falta sem lista", leitura({ ...FALTA, dataUpdatedAt: 0 })],
      ["erro sem lista", leitura({ isError: true, error: new Error("Falha interna."), dataUpdatedAt: 0 })],
      ["primeira leitura antes de 300 ms", leitura({ isLoading: true, isFetching: true, dataUpdatedAt: 0 })],
      ["sem leitura", []],
    ];
    for (const [nome, qual] of vazias) {
      const html = naConexao("reconectando", <LinhaDeEstado leitura={qual} objeto="pedidos" />);
      expect(textosDaTela(html), nome).toEqual([]);
      expect(html, nome).toMatch(/^<div data-linha-de-estado="" data-estado="vazia" class="linha-de-estado"><\/div>$/);
    }
  });

  it("a releitura com a lista lida e o erro que não é falta de conexão: a lista fica, com a hora dela", () => {
    const html = naConexao("conectado", <LinhaDeEstado leitura={leitura({ isError: true, error: new Error("Falha interna.") })} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Atualizado às 10:42"]);
  });

  it("a linha tem 24 px sempre reservados, e o Tentar de novo tem o toque de 44 px por um ::before, sem mudar a altura", () => {
    const regra = (seletor: string) => {
      const inicio = CSS.indexOf(`${seletor} {`);
      expect(inicio, seletor).toBeGreaterThan(0);
      return CSS.slice(inicio, CSS.indexOf("}", inicio));
    };
    expect(regra(".linha-de-estado")).toContain("block-size: 24px;");
    expect(regra(".linha-de-estado-tentar")).toContain("block-size: 24px;");
    expect(regra(".linha-de-estado-tentar::before")).toContain("inset: -10px;");
    expect(regra(".linha-de-estado-tentar:focus-visible")).toContain("outline: 2px solid currentColor;");
  });
});

describe("a linha de estado no tempo", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;
  let cliente: QueryClient;
  let conexao: Conexao;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LIDA_EM);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
    conexao = criarConexao({ temRede: () => true });
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    raiz = null;
    container.remove();
    conexao.fechar();
    cliente.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** O HTML de cada estado, para o axe no fim: o axe usa o relógio de verdade. */
  const paraOAxe: string[] = [];
  async function axeNoFim() {
    vi.useRealTimers();
    for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  }

  async function montar(elemento: ReactElement) {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <ProvedorDaConexao value={conexao}>
          <QueryClientProvider client={cliente}>
            <Anunciador />
            {elemento}
          </QueryClientProvider>
        </ProvedorDaConexao>,
      );
    });
  }

  /** A lista com o Atualizar, como nas telas: o servidor responde em `atrasoMs`. */
  let leiturasFeitas = 0;
  function Lista({ atrasoMs = 30, intervaloMs }: { atrasoMs?: number; intervaloMs?: number }) {
    const pedidos = useQuery({
      queryKey: ["pedidos"],
      queryFn: () => {
        leiturasFeitas += 1;
        return new Promise((ok) => setTimeout(() => ok({ itens: Date.now() }), atrasoMs));
      },
      refetchInterval: intervaloMs,
    });
    const lista = useAtualizarLista([pedidos]);
    return (
      <div>
        <h1>Pedidos</h1>
        <LinhaDeEstado leitura={pedidos} objeto="pedidos" pedidaPelaPessoa={lista.voltando} />
        <BotaoAtualizar atualizando={lista.atualizando} travado={pedidos.isLoading} onAtualizar={lista.atualizar} />
      </div>
    );
  }

  const linha = () => container.querySelector<HTMLElement>("[data-linha-de-estado]")!;
  /** O texto que se vê na linha: só a camada atual (a que sai fica fora da árvore). */
  const naLinha = () => textosDaTela(linha().querySelector("[data-camada]:not([data-sai])")?.outerHTML ?? "");
  const anuncio = () => container.querySelector("[data-anunciador]")?.textContent ?? "";
  const atualizar = () => container.querySelector<HTMLButtonElement>("[data-atualizar]")!;

  it("a primeira leitura: nada antes de 300 ms; aos 300 ms o indicador de 24 px, Carregando pedidos… e o anúncio; na chegada, a hora", async () => {
    await montar(<Lista atrasoMs={2_000} />);
    await passar(250);
    expect(naLinha()).toEqual([]);
    expect(anuncio()).toBe("");
    await passar(60);
    expect(naLinha()).toEqual(["Carregando pedidos…"]);
    expect(linha().querySelector('[data-spinner][data-tamanho="24"]')).not.toBeNull();
    expect(anuncio()).toBe("Carregando pedidos");
    // O Atualizar fica travado na primeira leitura: aria-disabled, nunca disabled, e sem girar.
    expect(atualizar().getAttribute("aria-disabled")).toBe("true");
    expect(atualizar().hasAttribute("disabled")).toBe(false);
    expect(atualizar().querySelector("[data-spinner]")).toBeNull();
    paraOAxe.push(container.innerHTML);
    await passar(1_800);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    expect(atualizar().hasAttribute("aria-disabled")).toBe(false);
    paraOAxe.push(container.innerHTML);
    await axeNoFim();
  });

  it("aos 10 s, só na primeira leitura: a pílula âmbar Demorando mais que o normal, Tentar de novo, a volta calma e o anúncio, uma vez", async () => {
    await montar(<Lista atrasoMs={60_000} />);
    await passar(310);
    expect(anuncio()).toBe("Carregando pedidos");
    await passar(9_590);
    expect(naLinha()).toEqual(["Carregando pedidos…"]);
    await passar(200);
    expect(naLinha()).toEqual(["Demorando mais que o normal", "Tentar de novo"]);
    expect(linha().querySelector("[data-spinner][data-calmo]")).not.toBeNull();
    expect(linha().querySelector(".linha-de-estado-pilula")).not.toBeNull();
    expect(anuncio()).toBe("Demorando mais que o normal");
    paraOAxe.push(container.innerHTML);
    // O toque relê; aos 300 ms, "Tentando de novo…", ocupado (não desabilitado), e o toque repetido não relê.
    const lidas = leiturasFeitas;
    const tentar = linha().querySelector<HTMLButtonElement>("[data-camada]:not([data-sai]) button")!;
    await act(async () => tentar.click());
    await passar(1);
    expect(leiturasFeitas).toBe(lidas + 1);
    expect(tentar.hasAttribute("aria-disabled")).toBe(false);
    await passar(400);
    expect(naLinha()).toEqual(["Demorando mais que o normal", "Tentando de novo…"]);
    const ocupado = linha().querySelector<HTMLButtonElement>("[data-camada]:not([data-sai]) button")!;
    expect(ocupado.getAttribute("aria-disabled")).toBe("true");
    expect(ocupado.getAttribute("aria-busy")).toBe("true");
    expect(ocupado.hasAttribute("disabled")).toBe(false);
    await act(async () => ocupado.click());
    await passar(1);
    expect(leiturasFeitas).toBe(lidas + 1);
    paraOAxe.push(container.innerHTML);
    // A demora é dita uma vez só.
    await passar(5_000);
    expect(anuncio()).toBe("Demorando mais que o normal");
    await axeNoFim();
  });

  it("Reconectando: o Tentar de novo acorda a conexão de quem lê e só então relê; aos 300 ms, Tentando de novo…, e o toque repetido não relê", async () => {
    const passos: string[] = [];
    conexao.aoAcordar(() => {
      passos.push("acordou");
      return Promise.resolve();
    });
    let falhar = false;
    function ListaComFalta() {
      const pedidos = useQuery({
        queryKey: ["com-falta"],
        queryFn: () => {
          passos.push("leu");
          return new Promise((ok, recusar) => setTimeout(() => (falhar ? recusar(new SemResposta()) : ok({ itens: 1 })), 1_000));
        },
      });
      return <LinhaDeEstado leitura={pedidos} objeto="pedidos" />;
    }
    await montar(<ListaComFalta />);
    await passar(1_100);
    falhar = true;
    await act(async () => {
      void cliente.refetchQueries({ type: "active" });
    });
    await passar(1_200);
    expect(naLinha()).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
    passos.length = 0;
    falhar = false;
    const tentar = linha().querySelector<HTMLButtonElement>("[data-camada]:not([data-sai]) button")!;
    await act(async () => tentar.click());
    await passar(1);
    expect(passos).toEqual(["acordou", "leu"]);
    await passar(350);
    expect(naLinha()).toEqual(["Reconectando…", "· lista de 10:42", "Tentando de novo…"]);
    const ocupado = linha().querySelector<HTMLButtonElement>("[data-camada]:not([data-sai]) button")!;
    expect(ocupado.getAttribute("aria-disabled")).toBe("true");
    expect(ocupado.hasAttribute("disabled")).toBe(false);
    await act(async () => ocupado.click());
    await passar(1);
    expect(passos).toEqual(["acordou", "leu"]);
    paraOAxe.push(container.innerHTML);
    await passar(800);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    await axeNoFim();
  });

  it("a releitura automática de 60 s não mostra nada, não fala, não mexe na região viva e não gira o Atualizar; no fim, só a hora", async () => {
    await montar(<Lista atrasoMs={1_500} intervaloMs={60_000} />);
    await passar(2_000);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    const regiao = container.querySelector("[data-anunciador]")!;
    const antes = regiao.innerHTML;
    const vistos = new Set<string>();
    const mudancas: MutationRecord[] = [];
    const observador = new MutationObserver((registros) => mudancas.push(...registros));
    observador.observe(regiao, { subtree: true, childList: true, characterData: true, attributes: true });
    vi.setSystemTime(LIDA_EM + 2 * 60_000 + 30_000);
    for (let t = 0; t < 61_400; t += 100) {
      await passar(100);
      vistos.add(naLinha().join(" "));
      expect(atualizar().querySelector("[data-spinner]"), `${t} ms`).toBeNull();
      expect(atualizar().hasAttribute("disabled"), `${t} ms`).toBe(false);
      expect(atualizar().hasAttribute("aria-disabled"), `${t} ms`).toBe(false);
      expect(atualizar().hasAttribute("aria-busy"), `${t} ms`).toBe(false);
    }
    await passar(1_000);
    observador.disconnect();
    expect(mudancas).toEqual([]);
    expect(regiao.innerHTML).toBe(antes);
    // Durante a releitura, nada; na chegada, só a hora nova (o relógio andou 2 min 30 s e mais um minuto).
    expect([...vistos]).toEqual(["Atualizado às 10:42", "Atualizado às 10:45"]);
    expect(naLinha()).toEqual(["Atualizado às 10:45"]);
    expect(linha().querySelector("[data-spinner]")).toBeNull();
  });

  it("o Atualizar tocado: só o botão muda, a caixa de 16 px (20 no celular) com aria-busy aos 300 ms, o toque repetido não relê, e no fim Lista atualizada", async () => {
    const ler = vi.fn(() => new Promise((ok) => setTimeout(() => ok({ itens: 1 }), 1_500)));
    function ListaContada() {
      const pedidos = useQuery({ queryKey: ["contada"], queryFn: ler });
      const lista = useAtualizarLista([pedidos]);
      return (
        <>
          <LinhaDeEstado leitura={pedidos} objeto="pedidos" pedidaPelaPessoa={lista.voltando} />
          <BotaoAtualizar atualizando={lista.atualizando} onAtualizar={lista.atualizar} />
        </>
      );
    }
    await montar(<ListaContada />);
    await passar(1_600);
    expect(ler).toHaveBeenCalledTimes(1);
    await act(async () => atualizar().click());
    await passar(250);
    expect(atualizar().querySelector("[data-spinner]")).toBeNull();
    await passar(100);
    expect(atualizar().getAttribute("aria-busy")).toBe("true");
    expect(atualizar().getAttribute("aria-disabled")).toBe("true");
    expect(atualizar().hasAttribute("disabled")).toBe(false);
    expect([...atualizar().querySelectorAll("[data-spinner]")].map((caixa) => [caixa.getAttribute("data-tamanho"), caixa.getAttribute("class")])).toEqual([
      ["16", "carregando-caixa max-md:hidden"],
      ["20", "carregando-caixa md:hidden"],
    ]);
    // Um sinal por região: a linha continua com a hora, sem indicador.
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    expect(linha().querySelector("[data-spinner]")).toBeNull();
    paraOAxe.push(container.innerHTML);
    await act(async () => atualizar().click());
    await passar(1_300);
    expect(ler).toHaveBeenCalledTimes(2);
    expect(anuncio()).toBe("Lista atualizada");
    expect(atualizar().hasAttribute("aria-busy")).toBe(false);
    expect(atualizar().querySelector("[data-spinner]")).toBeNull();
    await axeNoFim();
  });

  it("o Atualizar tem 44 × 44 no celular, e 40 × 40 no computador", () => {
    const html = renderToStaticMarkup(<BotaoAtualizar atualizando={false} onAtualizar={() => undefined} />);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bh-10 w-10\b[^"]*\bmax-md:size-11\b/);
    expect(textosDaTela(html)).toEqual(["Atualizar"]);
  });

  it("a volta do app ao primeiro plano: a lista relê, e passados 5 s a linha diz Atualizando…; na chegada, a hora nova", async () => {
    let visivel: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visivel });
    onTestFinished(() => {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });
    await montar(<Lista atrasoMs={8_000} />);
    await passar(8_100);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    const falado = anuncio();
    visivel = "hidden";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    vi.setSystemTime(LIDA_EM + 3 * 60_000);
    visivel = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await passar(4_900);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    await passar(200);
    expect(naLinha()).toEqual(["Atualizando…"]);
    expect(linha().querySelector('[data-spinner][data-tamanho="24"]')).not.toBeNull();
    // Não fala: a releitura não é a primeira leitura.
    expect(anuncio()).toBe(falado);
    paraOAxe.push(container.innerHTML);
    await passar(3_000);
    expect(naLinha()).toEqual(["Atualizado às 10:45"]);
    await axeNoFim();
  });

  it("o texto troca em sequência: o que sai fica fora da árvore e sem toque, e some depois dos 80 ms", async () => {
    await montar(<Lista atrasoMs={1_000} />);
    await passar(500);
    expect(naLinha()).toEqual(["Carregando pedidos…"]);
    await passar(550);
    const sai = linha().querySelector("[data-sai]");
    expect(sai?.getAttribute("aria-hidden")).toBe("true");
    expect(sai?.hasAttribute("inert")).toBe(true);
    expect(linha().querySelector("[data-entra]")?.getAttribute("data-entra")).toBe("depois");
    await passar(CARREGANDO.trocaSaiMs);
    expect(linha().querySelector("[data-sai]")).toBeNull();
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
  });
});
