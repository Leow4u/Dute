// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao, criarConexao, type Conexao } from "@/lib/carregando/estado-da-conexao";
import { useAtualizarLista, type LeituraDaLista } from "@/lib/carregando/use-atualizar-lista";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import { BotaoAtualizar, LinhaDeEstado } from "./linha-de-estado";

/**
 * A linha de estado na troca de filtro e na releitura que falha (carregamento
 * v2, momento 7; parte 10). A leitura que troca (`placeholderData`) mostra a
 * lista anterior: a linha continua com a hora dela, e não fica vazia. A
 * releitura que falha por outro motivo que não a conexão, com a lista lida,
 * não a apaga: a linha diz "Não consegui atualizar · lista de 10:42", com
 * "Tentar de novo". Dados sintéticos.
 */

// 13:42 UTC são 10:42 no armazém (America/Sao_Paulo).
const LIDA_EM = Date.parse("2026-11-13T13:42:00Z");

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

function conectada(elemento: ReactElement) {
  return renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm("conectado")}>{elemento}</ProvedorDaConexao>);
}

describe("a linha de estado, parada", () => {
  it("a troca de filtro: a leitura com a lista anterior conta como lida, e a linha fica com a hora da lista na tela", () => {
    const trocando = leitura({ dataUpdatedAt: 0, isPlaceholderData: true, isFetching: true });
    expect(textosDaTela(conectada(<LinhaDeEstado leitura={[leitura(), trocando]} objeto="chegadas" />))).toEqual(["Atualizado às 10:42"]);
  });

  it("a releitura que falha com a lista lida: Não consegui atualizar · lista de 10:42 e Tentar de novo, sem região viva", async () => {
    const html = conectada(<LinhaDeEstado leitura={leitura({ isError: true, error: new Error("Falha interna no servidor.") })} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual(["Não consegui atualizar", "· lista de 10:42", "Tentar de novo"]);
    expect(html).not.toMatch(/role="(status|alert)"|aria-live|aria-busy/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("com várias leituras, a hora da mais antiga das que falharam", () => {
    const html = conectada(
      <LinhaDeEstado
        leitura={[leitura({ dataUpdatedAt: LIDA_EM + 3 * 60_000 }), leitura({ isError: true, error: new Error("Falha interna no servidor.") })]}
        objeto="pedidos"
      />,
    );
    expect(textosDaTela(html)).toEqual(["Não consegui atualizar", "· lista de 10:42", "Tentar de novo"]);
  });

  it("sem a hora (a aba Histórico, sob a linha do Estoque): lida, vazia; a releitura que falha, sim", () => {
    expect(textosDaTela(conectada(<LinhaDeEstado leitura={leitura()} objeto="movimentações" semHora />))).toEqual([]);
    const falhou = leitura({ isError: true, error: new Error("Falha interna no servidor.") });
    expect(textosDaTela(conectada(<LinhaDeEstado leitura={falhou} objeto="movimentações" semHora />))).toEqual([
      "Não consegui atualizar",
      "· lista de 10:42",
      "Tentar de novo",
    ]);
  });

  it("a primeira leitura que falha continua sem nada na linha: o aviso fica no lugar da lista", () => {
    const html = conectada(<LinhaDeEstado leitura={leitura({ isError: true, error: new Error("Falha"), dataUpdatedAt: 0 })} objeto="pedidos" />);
    expect(textosDaTela(html)).toEqual([]);
  });
});

describe("o Atualizar tocado que falha", () => {
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

  let falhar = false;
  function Lista() {
    const pedidos = useQuery({
      queryKey: ["pedidos"],
      queryFn: () =>
        new Promise((ok, falha) =>
          setTimeout(() => (falhar ? falha(new Error("Falha interna no servidor.")) : ok({ itens: Date.now() })), 30),
        ),
    });
    const lista = useAtualizarLista([pedidos]);
    return (
      <div>
        <LinhaDeEstado leitura={pedidos} objeto="pedidos" pedidaPelaPessoa={lista.voltando} />
        <BotaoAtualizar atualizando={lista.atualizando} travado={pedidos.isLoading} onAtualizar={lista.atualizar} />
      </div>
    );
  }

  it("a lista fica, a linha diz Não consegui atualizar, e quem tocou ouve isso no Anunciador", async () => {
    falhar = false;
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <ProvedorDaConexao value={conexao}>
          <QueryClientProvider client={cliente}>
            <Anunciador />
            <Lista />
          </QueryClientProvider>
        </ProvedorDaConexao>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    falhar = true;
    const atualizar = container.querySelector<HTMLButtonElement>("[data-atualizar]")!;
    await act(async () => atualizar.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(container.querySelector("[data-anunciador]")?.textContent).toBe("Não consegui atualizar");
    const linha = container.querySelector<HTMLElement>("[data-linha-de-estado] > [data-camada]:not([data-sai])")!;
    expect(textosDaTela(linha.outerHTML)).toEqual(["Não consegui atualizar", "· lista de 10:42", "Tentar de novo"]);
  });

  it("nas telas que ainda dizem a primeira leitura na tabela (primeiraNaLista), a linha fica vazia e calada enquanto ela lê", async () => {
    function Lendo() {
      const produtos = useQuery({ queryKey: ["produtos"], queryFn: () => new Promise((ok) => setTimeout(() => ok({ itens: 1 }), 2_000)) });
      return <LinhaDeEstado leitura={produtos} objeto="produtos" primeiraNaLista />;
    }
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <ProvedorDaConexao value={conexao}>
          <QueryClientProvider client={cliente}>
            <Anunciador />
            <Lendo />
          </QueryClientProvider>
        </ProvedorDaConexao>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.querySelector("[data-linha-de-estado]")?.getAttribute("data-estado")).toBe("vazia");
    expect(container.querySelector("[data-anunciador]")?.textContent).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(container.querySelector("[data-linha-de-estado]")?.getAttribute("data-estado")).toBe("lida");
  });

  it("o Tentar de novo da linha que falha de novo depois que a pessoa saiu da tela não fala na tela seguinte", async () => {
    falhar = false;
    raiz = createRoot(container);
    const montar = (tela: ReactElement) =>
      act(async () => {
        raiz!.render(
          <ProvedorDaConexao value={conexao}>
            <QueryClientProvider client={cliente}>
              <Anunciador />
              {tela}
            </QueryClientProvider>
          </ProvedorDaConexao>,
        );
      });
    await montar(<Lista />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    falhar = true;
    await act(async () => void cliente.invalidateQueries());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    const regiao = () => container.querySelector("[data-anunciador]")?.textContent;
    expect(regiao()).toBe("");
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>(".linha-de-estado-tentar")).find((botao) => !botao.closest("[data-sai]"))!;
    await act(async () => tentar.click());
    // A pessoa sai da tela antes de a leitura responder (e falhar de novo).
    await montar(<p>Outra tela</p>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(regiao()).toBe("");
  });
});
