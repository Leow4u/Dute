// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BlocoSemConexao } from "@/components/ui/erro-na-leitura";
import { SemResposta, semConexaoNaLeitura } from "@/lib/conexao";
import { ClientDataBoundary } from "@/pages/client/shared";

import { ProvedorDaConexao, criarConexao, ligarConexaoDoApp, type Conexao } from "./estado-da-conexao";

/**
 * A releitura sozinha na tela (carregamento v2, momentos 7 e 8; parte 7a):
 * na tela ainda não lida, com o aparelho conectado e o servidor sem
 * resposta, a releitura de 2, 4, 8, 16 e 30 s não mostra nada. O bloco
 * "Reconectando…" não sai da tela nem volta montado de novo, o foco no
 * "Tentar de novo" fica nele, e o alerta da falha não é dito de novo a cada
 * releitura.
 */

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;
let conexao: Conexao;
let desligar: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  conexao = criarConexao({ temRede: () => true });
  desligar = ligarConexaoDoApp(cliente, conexao, window);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  desligar();
  conexao.fechar();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function montar(elemento: React.ReactNode) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexao}>
        <QueryClientProvider client={cliente}>{elemento}</QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** O ramo de pages/estoque.tsx: carregando antes do bloco, e o bloco quando a falta deixou a tela sem nada lido. */
function Estoque({ ler }: { ler: () => Promise<unknown> }) {
  const skus = useQuery({ queryKey: ["skus"], queryFn: ler });
  const semRede = semConexaoNaLeitura(skus);
  if (skus.isLoading) return <p>Carregando estoque...</p>;
  if (semRede && semRede.lidaEm === null) return <BlocoSemConexao tentando={skus.isFetching} onTentar={() => void skus.refetch()} />;
  return <p>estoque</p>;
}

describe("na tela ainda não lida", () => {
  it("o bloco Reconectando… fica, o mesmo, e o foco no Tentar de novo também, por todas as releituras sozinhas", async () => {
    const ler = vi.fn(() => new Promise((_, recusar) => setTimeout(() => recusar(new SemResposta()), 30)));
    await montar(<Estoque ler={ler} />);
    await passar(100);
    const bloco = container.querySelector("[data-falta]");
    expect(bloco?.textContent).toBe("Reconectando…Tentar de novo");
    const botao = bloco!.querySelector("button")!;
    botao.focus();
    const vistos = new Set<string>();
    for (let t = 0; t < 31_000; t += 50) {
      await passar(50);
      vistos.add(container.textContent ?? "");
      expect(container.querySelector("[data-falta]"), `${t} ms`).toBe(bloco);
      expect(document.activeElement, `${t} ms`).toBe(botao);
    }
    expect([...vistos]).toEqual(["Reconectando…Tentar de novo"]);
    // Releu em 2, 6, 14 e 30 s.
    expect(ler).toHaveBeenCalledTimes(5);
  });

  it("o portal: o aviso da conexão entra uma vez, e não a cada releitura (parte 13f: o bloco da falta no lugar do Portal indisponível)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolver) => setTimeout(resolver, 5));
        return new Response(JSON.stringify({ message: "Sem resposta do servidor.", code: "sem_resposta" }), { status: 503 });
      }),
    );
    await montar(<ClientDataBoundary>{() => <p>portal</p>}</ClientDataBoundary>);
    let entradas = 0;
    let antes: Element | null = null;
    for (let t = 0; t <= 62_000; t += 10) {
      await passar(10);
      const aviso = container.querySelector("[data-falta]");
      if (aviso && aviso !== antes) entradas += 1;
      antes = aviso;
    }
    // Sem nada lido e o servidor sem resposta: o aviso da conexão no lugar do portal, nunca o alerta vermelho.
    expect(antes?.textContent).toMatch(/Reconectando…|Sem conexão\./);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(entradas).toBe(1);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
