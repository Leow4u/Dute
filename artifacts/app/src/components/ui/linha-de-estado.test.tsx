// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, useState, type ReactElement } from "react";
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

/** O corpo da primeira regra com esse seletor sozinho. */
function regra(seletor: string): string {
  const inicio = CSS.indexOf(`\n  ${seletor} {`);
  expect(inicio, seletor).toBeGreaterThan(0);
  return CSS.slice(inicio, CSS.indexOf("}", inicio));
}

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
      expect(html, nome).toMatch(/^<div tabindex="-1" data-linha-de-estado="" data-estado="vazia" class="linha-de-estado"><\/div>$/);
    }
  });

  it("a releitura com a lista lida e o erro que não é falta de conexão: a lista fica, com a hora dela", () => {
    const html = naConexao("conectado", <LinhaDeEstado leitura={leitura({ isError: true, error: new Error("Falha interna.") })} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Atualizado às 10:42"]);
  });

  it("a linha tem 24 px sempre reservados, e o Tentar de novo tem o toque de 44 px por um ::before, sem mudar a altura", () => {
    expect(regra(".linha-de-estado")).toContain("min-block-size: 24px;");
    expect(regra(".linha-de-estado-tentar")).toContain("block-size: 24px;");
    expect(regra(".linha-de-estado-tentar::before")).toContain("inset: -10px;");
    expect(regra(".linha-de-estado-tentar:focus-visible")).toContain("outline: 2px solid currentColor;");
  });

  it("no celular estreito, o que não cabe passa à linha de baixo, sem sair da tela: cada peça inteira, e os vãos de 6 px da prancha", () => {
    // A linha cresce quando quebra; nunca a altura fixa que fazia o conteúdo sair pela direita.
    expect(regra(".linha-de-estado")).not.toMatch(/(^|[^-])block-size: 24px;/m);
    const camada = regra(".linha-de-estado [data-camada]");
    expect(camada).toContain("flex-wrap: wrap;");
    expect(camada).toContain("white-space: nowrap;");
    expect(camada).toContain("column-gap: 10px;");
    const celular = CSS.slice(CSS.indexOf("@media (max-width: 639px) {", CSS.indexOf(".linha-de-estado-tentar:focus-visible")));
    expect(celular.slice(0, celular.indexOf("}"))).toContain("column-gap: 6px;");
    // O texto da primeira leitura ocupa o resto da linha e quebra dentro dela.
    expect(regra(".linha-de-estado [data-textos]")).toContain("flex: 1 1 0%;");
  });

  it("o aparelho sem rede há 3 s e nenhuma leitura falhando ainda: a lista lida já diz Sem conexão, com a hora da mais antiga (momento 8)", () => {
    const html = naConexao("sem-conexao", <LinhaDeEstado leitura={[leitura(), leitura({ dataUpdatedAt: LIDA_EM + 2 * 60_000 })]} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(html).toContain("linha-de-estado-pilula");
    // Reconectando é o servidor sem resposta, e é de quem falhou: sem falha, a lista conectada fica com a hora.
    expect(textosDaTela(naConexao("reconectando", <LinhaDeEstado leitura={leitura()} objeto="pedidos" />))).toEqual(["Atualizado às 10:42"]);
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
  /** A camada que se vê: a atual, sem nada do que sai (a que sai fica fora da árvore, também a do texto dentro dela). */
  function camadaAtual(): HTMLElement | null {
    const atual = linha().querySelector<HTMLElement>(":scope > [data-camada]:not([data-sai])");
    if (!atual) return null;
    const copia = atual.cloneNode(true) as HTMLElement;
    copia.querySelectorAll("[data-sai]").forEach((sai) => sai.remove());
    return copia;
  }
  /** O texto que se vê na linha. */
  const naLinha = () => textosDaTela(camadaAtual()?.outerHTML ?? "");
  /** O "Tentar de novo" que se vê. */
  const tentarNaLinha = () => Array.from(linha().querySelectorAll<HTMLButtonElement>(".linha-de-estado-tentar")).find((botao) => !botao.closest("[data-sai]"))!;
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
    const tentar = tentarNaLinha();
    await act(async () => tentar.click());
    await passar(1);
    expect(leiturasFeitas).toBe(lidas + 1);
    expect(tentar.hasAttribute("aria-disabled")).toBe(false);
    await passar(400);
    expect(naLinha()).toEqual(["Demorando mais que o normal", "Tentando de novo…"]);
    const ocupado = tentarNaLinha();
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

  /** A lista com o resumo falado no fim da primeira leitura (parte 8) e o id para a lista apontar. */
  function ListaComResumo({ atrasoMs, falha = false }: { atrasoMs: number; falha?: boolean }) {
    const pedidos = useQuery({
      queryKey: ["pedidos", "resumo"],
      queryFn: () => new Promise((ok, erro) => setTimeout(() => (falha ? erro(new Error("Falha interna.")) : ok({ itens: 6 })), atrasoMs)),
    });
    return <LinhaDeEstado id="estado-dos-pedidos" leitura={pedidos} objeto="pedidos" resumo="3 para aprovar, 2 para separar, 1 para entregar" />;
  }

  it("na chegada da primeira leitura, o resumo da lista, depois de Carregando pedidos (um anúncio a cada 2 s); a linha leva o id que a lista aponta", async () => {
    const falas: string[] = [];
    await montar(<ListaComResumo atrasoMs={1_000} />);
    const observador = new MutationObserver(() => falas.push(anuncio()));
    observador.observe(container.querySelector("[data-anunciador]")!, { subtree: true, childList: true, characterData: true });
    expect(linha().id).toBe("estado-dos-pedidos");
    await passar(310);
    await passar(800);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    // O resumo espera os 2 s do anúncio anterior.
    expect(anuncio()).toBe("Carregando pedidos");
    await passar(1_300);
    expect(anuncio()).toBe("3 para aprovar, 2 para separar, 1 para entregar");
    observador.disconnect();
    expect(falas.filter(Boolean)).toEqual(["Carregando pedidos", "3 para aprovar, 2 para separar, 1 para entregar"]);
  });

  it("a leitura que chega antes dos 300 ms não fala nada, nem o resumo; a que falha também não diz o resumo", async () => {
    await montar(<ListaComResumo atrasoMs={100} />);
    await passar(3_000);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    expect(anuncio()).toBe("");
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();
    await montar(<ListaComResumo atrasoMs={1_000} falha />);
    await passar(310);
    expect(anuncio()).toBe("Carregando pedidos");
    await passar(3_200);
    expect(anuncio()).toBe("Carregando pedidos");
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
    const tentar = tentarNaLinha();
    await act(async () => tentar.click());
    await passar(1);
    expect(passos).toEqual(["acordou", "leu"]);
    await passar(350);
    expect(naLinha()).toEqual(["Reconectando…", "· lista de 10:42", "Tentando de novo…"]);
    const ocupado = tentarNaLinha();
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
    for (let t = 0; t < 61_500; t += 500) {
      await passar(500);
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
    // Mais de cem passos com o relógio falso: o tempo dele, como o dos testes das telas, e não o padrão de 5 s.
  }, 30_000);

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
    // A caixa sai em 180 ms, e só então o ícone volta; ela deixa a árvore quando ele acabou de entrar.
    await passar(CARREGANDO.saidaMs + CARREGANDO.trocaEntraMs);
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

  it("o texto troca em sequência: o que sai fica fora da árvore e sem toque; a espera que acaba sai em 180 ms, como o indicador, e o resto em 80", async () => {
    await montar(<Lista atrasoMs={1_000} intervaloMs={60_000} />);
    await passar(500);
    expect(naLinha()).toEqual(["Carregando pedidos…"]);
    await passar(550);
    // Na chegada, "Carregando pedidos…" sai em 180 ms (momento 2), e só então entra a hora.
    const sai = linha().querySelector(":scope > [data-sai]");
    expect(sai?.getAttribute("data-sai")).toBe("espera");
    expect(sai?.getAttribute("aria-hidden")).toBe("true");
    expect(sai?.hasAttribute("inert")).toBe(true);
    expect(linha().querySelector(":scope > [data-entra]")?.getAttribute("data-entra")).toBe("depois-da-espera");
    await passar(CARREGANDO.saidaMs);
    // Saiu (invisível, no CSS), e a hora entra agora: a camada que saiu só deixa a árvore quando ela acabou de entrar.
    expect(linha().querySelector(":scope > [data-sai]"), "ainda na árvore aos 180 ms").not.toBeNull();
    await passar(CARREGANDO.trocaEntraMs);
    expect(linha().querySelector("[data-sai]")).toBeNull();
    // A entrada guarda o atraso dela até o fim: tirar a que saiu não a faz pular para o fim.
    expect(linha().querySelector(":scope > [data-entra]")?.getAttribute("data-entra")).toBe("depois-da-espera");
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    // A hora que muda é texto que troca: sai em 80 ms, e a nova entra depois.
    vi.setSystemTime(LIDA_EM + 2 * 60_000);
    await passar(59_000);
    for (let passo = 0; passo < 60 && !linha().querySelector(":scope > [data-sai]"); passo += 1) await passar(50);
    expect(linha().querySelector(":scope > [data-sai]")?.getAttribute("data-sai")).toBe("");
    expect(linha().querySelector(":scope > [data-entra]")?.getAttribute("data-entra")).toBe("depois");
    await passar(CARREGANDO.trocaSaiMs);
    expect(linha().querySelector(":scope > [data-sai]")).not.toBeNull();
    await passar(CARREGANDO.trocaEntraMs);
    expect(linha().querySelector("[data-sai]")).toBeNull();
    expect(linha().querySelector(":scope > [data-entra]")?.getAttribute("data-entra")).toBe("depois");
  }, 30_000);
  /** Desenha de novo com outra conexão (a troca de Reconectando para Sem conexão, a volta da rede). */
  async function naConexaoAgora(outra: Conexao, elemento: ReactElement) {
    await act(async () => {
      raiz!.render(
        <ProvedorDaConexao value={outra}>
          <QueryClientProvider client={cliente}>
            <Anunciador />
            {elemento}
          </QueryClientProvider>
        </ProvedorDaConexao>,
      );
    });
  }

  /** Uma lista que leu e depois fica sem resposta, enquanto `falhar.agora`. */
  const falhar = { agora: false, atrasoMs: 1_000 };
  function ListaQueCai() {
    const pedidos = useQuery({
      queryKey: ["cai"],
      queryFn: () =>
        new Promise((ok, recusar) => setTimeout(() => (falhar.agora ? recusar(new SemResposta()) : ok({ itens: Date.now() })), falhar.atrasoMs)),
    });
    return (
      <>
        <LinhaDeEstado leitura={pedidos} objeto="pedidos" />
        <button type="button">Fora da linha</button>
      </>
    );
  }

  async function lerECair(conexaoAtual: Conexao) {
    falhar.agora = false;
    falhar.atrasoMs = 1_000;
    raiz = createRoot(container);
    await naConexaoAgora(conexaoAtual, <ListaQueCai />);
    await passar(1_100);
    falhar.agora = true;
    await act(async () => {
      void cliente.refetchQueries({ type: "active" });
    });
    await passar(1_200);
  }

  it("o Tentar de novo da demora recomeça só as leituras da lista: o que a tela lê além dela (o cliente ativo, as caixas) segue e chega", async () => {
    const fora = vi.fn(() => new Promise((ok) => setTimeout(() => ok({ fora: true }), 12_000)));
    function Fora() {
      const outra = useQuery({ queryKey: ["fora-da-lista"], queryFn: fora, staleTime: Number.POSITIVE_INFINITY });
      return <p data-fora="">{outra.status}</p>;
    }
    await montar(
      <>
        <Fora />
        <Lista atrasoMs={12_000} />
      </>,
    );
    await passar(10_100);
    expect(naLinha()).toEqual(["Demorando mais que o normal", "Tentar de novo"]);
    const lidas = leiturasFeitas;
    await act(async () => tentarNaLinha().click());
    await passar(1);
    // A leitura presa da lista recomeçou...
    expect(leiturasFeitas).toBe(lidas + 1);
    // ...e a de fora não foi cancelada: chega aos 12 s, sem ninguém precisar reler.
    await passar(2_000);
    expect(fora).toHaveBeenCalledTimes(1);
    expect(cliente.getQueryState(["fora-da-lista"])?.status).toBe("success");
    expect(container.querySelector("[data-fora]")?.textContent).toBe("success");
    await passar(11_000);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    expect(fora).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("a releitura automática que passa de 5 s também não diz Atualizando…: só a releitura pedida pela pessoa (a volta do app)", async () => {
    await montar(<Lista atrasoMs={8_000} intervaloMs={60_000} />);
    await passar(8_100);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    // O intervalo conta da última leitura: a releitura começa aos 68 s e leva 8 s, passando dos 5 s.
    const lidas = leiturasFeitas;
    await passar(59_400);
    const vistos = new Set<string>();
    for (let t = 0; t < 11_000; t += 500) {
      await passar(500);
      vistos.add(naLinha().join(" "));
      expect(linha().querySelector("[data-spinner]"), `${t} ms`).toBeNull();
    }
    expect(leiturasFeitas).toBe(lidas + 1);
    expect([...vistos]).toEqual(["Atualizado às 10:42", "Atualizado às 10:43"]);
  }, 30_000);

  it("a primeira leitura que falhou não fala de novo na releitura automática da tela (o intervalo), nem a entrada nem a demora", async () => {
    let atrasoMs = 1_000;
    function ListaQueFalha() {
      const pedidos = useQuery({
        queryKey: ["falha"],
        queryFn: () => new Promise((_, recusar) => setTimeout(() => recusar(new SemResposta()), atrasoMs)),
        refetchInterval: 60_000,
      });
      return <LinhaDeEstado leitura={pedidos} objeto="pedidos" />;
    }
    await montar(<ListaQueFalha />);
    const falas: string[] = [];
    const anotar = (registros: MutationRecord[]) => {
      for (const registro of registros) for (const no of registro.addedNodes) falas.push(no.textContent ?? "");
    };
    const observador = new MutationObserver(anotar);
    observador.observe(container.querySelector("[data-anunciador]")!, { subtree: true, childList: true });
    /** Tudo o que a região viva disse até agora, também o que o observador ainda não entregou. */
    const ditas = () => {
      anotar(observador.takeRecords());
      return falas;
    };
    // Em passos curtos, como a tela vive: cada tique do relógio desenha.
    const andar = async (ms: number) => {
      for (let t = 0; t < ms; t += 100) await passar(100);
    };
    await andar(1_100);
    // A primeira leitura fala uma vez, aos 300 ms.
    expect(ditas()).toEqual(["Carregando pedidos"]);
    // A releitura do intervalo, aos 60 s, demora 12 s: nem "Carregando pedidos" aos 300 ms dela, nem a demora aos 10 s.
    atrasoMs = 12_000;
    await passar(58_800);
    await andar(1_200);
    await passar(8_500);
    await andar(1_500);
    await passar(3_000);
    expect(ditas()).toEqual(["Carregando pedidos"]);
    observador.disconnect();
  }, 30_000);

  it("com o foco no Tentar de novo, a troca de Reconectando para Sem conexão leva o foco ao Tentar de novo novo, e a tentativa que deu certo, à linha; nunca ao body", async () => {
    await lerECair(conexaoEm("reconectando"));
    expect(naLinha()).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
    tentarNaLinha().focus();
    expect(document.activeElement).toBe(tentarNaLinha());
    await naConexaoAgora(conexaoEm("sem-conexao"), <ListaQueCai />);
    expect(naLinha()).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(document.activeElement?.textContent).toBe("Tentar de novo");
    expect(document.activeElement).toBe(tentarNaLinha());
    // A rede volta, e a tentativa dá certo: o botão sai, e o foco fica na linha, que diz a hora.
    await naConexaoAgora(conexaoEm("conectado"), <ListaQueCai />);
    expect(document.activeElement).toBe(tentarNaLinha());
    falhar.agora = false;
    await act(async () => tentarNaLinha().click());
    await passar(1_200);
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
    expect(document.activeElement).toBe(linha());
    expect(linha().getAttribute("tabindex")).toBe("-1");
  });

  it("com o foco fora da linha, a troca não mexe nele", async () => {
    await lerECair(conexaoEm("reconectando"));
    const fora = Array.from(container.querySelectorAll("button")).find((botao) => botao.textContent === "Fora da linha")!;
    fora.focus();
    await naConexaoAgora(conexaoEm("sem-conexao"), <ListaQueCai />);
    expect(naLinha()).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    expect(document.activeElement).toBe(fora);
  });

  it("na volta da rede, Sem conexão fica até a leitura voltar e vai direto a Atualizado às, sem passar por Reconectando…; se o servidor não responde em 2 s, Reconectando…", async () => {
    await lerECair(conexaoEm("sem-conexao"));
    expect(naLinha()).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    // A rede volta: a conexão passa a "reconectando" antes de o servidor responder.
    falhar.agora = false;
    falhar.atrasoMs = 400;
    await naConexaoAgora(conexaoEm("reconectando"), <ListaQueCai />);
    await act(async () => {
      void cliente.refetchQueries({ type: "active" });
    });
    const vistos = new Set<string>();
    for (let t = 0; t < 1_000; t += 50) {
      vistos.add(naLinha().join(" "));
      await passar(50);
    }
    expect([...vistos]).toEqual(["Sem conexão · lista de 10:42 Tentar de novo", "Atualizado às 10:42"]);

    // O servidor que ainda não responde: depois do mínimo de 2 s do aviso, Reconectando….
    falhar.agora = true;
    falhar.atrasoMs = 100;
    await naConexaoAgora(conexaoEm("sem-conexao"), <ListaQueCai />);
    await act(async () => {
      void cliente.refetchQueries({ type: "active" });
    });
    await passar(300);
    expect(naLinha()).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    await naConexaoAgora(conexaoEm("reconectando"), <ListaQueCai />);
    await passar(1_900);
    expect(naLinha()).toEqual(["Sem conexão · lista de 10:42", "Tentar de novo"]);
    await passar(200);
    expect(naLinha()).toEqual(["Reconectando…", "· lista de 10:42", "Tentar de novo"]);
  });

  it("o Atualizar tocado numa tela que a pessoa deixa antes da leitura voltar não diz Lista atualizada na tela seguinte", async () => {
    let mostrar: (sim: boolean) => void = () => undefined;
    function Alterna() {
      const [sim, setSim] = useState(true);
      mostrar = setSim;
      return sim ? <Lista atrasoMs={1_500} /> : <p>Outra tela</p>;
    }
    await montar(<Alterna />);
    await passar(1_600);
    const antes = anuncio();
    await act(async () => atualizar().click());
    await passar(200);
    await act(async () => mostrar(false));
    await passar(3_000);
    expect(anuncio()).toBe(antes);
    expect(anuncio()).not.toBe("Lista atualizada");
  });

  it("aos 10 s a caixa fica: a mesma passa à volta calma, e só o texto troca; na chegada, a camada inteira sai sem remontar a caixa", async () => {
    await montar(<Lista atrasoMs={12_000} />);
    await passar(9_900);
    const caixa = linha().querySelector("[data-spinner]");
    expect(caixa).not.toBeNull();
    await passar(200);
    expect(naLinha()).toEqual(["Demorando mais que o normal", "Tentar de novo"]);
    // Uma caixa só, a mesma, na camada atual, agora calma.
    expect(linha().querySelectorAll("[data-spinner]")).toHaveLength(1);
    expect(linha().querySelector("[data-spinner]")).toBe(caixa);
    expect(caixa!.hasAttribute("data-calmo")).toBe(true);
    expect(caixa!.closest("[data-sai]")).toBeNull();
    await passar(1_950);
    // A chegada: a camada sai com a mesma caixa (nada remonta nem recomeça a entrada), em 180 ms.
    const sai = linha().querySelector(":scope > [data-sai]");
    expect(sai?.getAttribute("data-sai")).toBe("espera");
    expect(sai?.querySelector("[data-spinner]")).toBe(caixa);
    await passar(CARREGANDO.saidaMs + CARREGANDO.trocaEntraMs);
    expect(linha().querySelector("[data-spinner]")).toBeNull();
    expect(naLinha()).toEqual(["Atualizado às 10:42"]);
  }, 30_000);

  it("o Atualizar tocado troca em sequência: o ícone sai em 80 ms e só então a caixa entra; no fim, a caixa sai em 180 ms e o ícone volta", async () => {
    await montar(<Lista atrasoMs={1_500} />);
    await passar(1_600);
    const camadas = () => Array.from(atualizar().querySelectorAll<HTMLElement>("[data-icones] > [data-camada]"));
    expect(camadas().map((camada) => camada.querySelector("[data-spinner]") ? "caixa" : "icone")).toEqual(["icone"]);
    await act(async () => atualizar().click());
    await passar(310);
    expect(camadas().map((camada) => [camada.querySelector("[data-spinner]") ? "caixa" : "icone", camada.getAttribute("data-sai"), camada.getAttribute("data-entra")])).toEqual([
      ["icone", "", null],
      ["caixa", null, "depois"],
    ]);
    await passar(CARREGANDO.trocaSaiMs + CARREGANDO.trocaEntraMs);
    expect(camadas()).toHaveLength(1);
    expect(camadas()[0]!.getAttribute("data-entra")).toBe("depois");
    await passar(1_050);
    expect(camadas().map((camada) => [camada.querySelector("[data-spinner]") ? "caixa" : "icone", camada.getAttribute("data-sai"), camada.getAttribute("data-entra")])).toEqual([
      ["caixa", "espera", null],
      ["icone", null, "depois-da-espera"],
    ]);
    await passar(CARREGANDO.saidaMs + CARREGANDO.trocaEntraMs);
    expect(camadas()).toHaveLength(1);
    expect(atualizar().querySelector("[data-spinner]")).toBeNull();
  });

  it("o Atualizar travado na primeira leitura volta a 1 em 150 ms, sem saltar; e a linha recebe o foco com o contorno visível", () => {
    const html = renderToStaticMarkup(<BotaoAtualizar atualizando={false} travado onAtualizar={() => undefined} />);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bopacity-45\b/);
    expect(html).toMatch(/<button[^>]*class="[^"]*\btransition-\[color,background-color,border-color,opacity\]/);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bduration-150\b/);
    expect(regra(".linha-de-estado:focus-visible")).toContain("outline: 2px solid hsl(var(--foreground));");
  });
});
