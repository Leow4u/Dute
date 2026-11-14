// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A TV que nunca leu o quadro (carregamento v2, momento 7; revisão da parte
 * 13g): o getRoomBoard falha, e a TV relê sozinha a cada 30 s. Antes, cada
 * releitura voltava a "Carregando o quadro…", com a caixa de 40 px e a fala, e
 * a falha saía e voltava. Agora a falha fica na tela durante a releitura, e a
 * espera fala uma vez só. Dados sintéticos; a callable é de mentira.
 */

const estado = vi.hoisted(() => ({ falas: [] as string[], chamadas: 0 }));
vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async () => {
    estado.chamadas += 1;
    throw new Error("unavailable");
  },
}));
vi.mock("@/lib/carregando/anunciador", async (original) => {
  const real = await original<typeof import("@/lib/carregando/anunciador")>();
  const anunciar = (texto: string) => {
    estado.falas.push(texto);
    return () => undefined;
  };
  return { ...real, useAnuncio: () => anunciar };
});

import Tv from "@/pages/tv/tv";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.falas = [];
  estado.chamadas = 0;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a TV sem quadro lido", () => {
  it("a releitura dos 30 s não volta a Carregando o quadro… nem fala de novo: a falha fica", async () => {
    const cliente = new QueryClient();
    await act(async () =>
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Tv />
        </QueryClientProvider>,
      ),
    );
    const linha: string[] = [];
    let anterior = "";
    for (let t = 0; t <= 120_000; t += 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      const agora = container.querySelector('[role="alert"]') ? "falha" : container.textContent?.includes("Carregando o quadro…") ? "carregando" : "nada";
      if (agora !== anterior) {
        linha.push(agora);
        anterior = agora;
      }
    }
    // A espera entra uma vez, a falha chega e fica, mesmo com o quadro relido sem parar.
    expect(estado.chamadas).toBeGreaterThan(4);
    expect(linha).toEqual(["nada", "carregando", "falha"]);
    expect(estado.falas.filter((fala) => fala === "Carregando o quadro")).toHaveLength(1);
  });
});

describe("a espera do quadro continua a da rota", () => {
  it("quando a tela chega, a caixa do quadro já está na tela (sem o vão de 300 ms) e a espera não é anunciada de novo", async () => {
    const { lazy, Suspense } = await import("react");
    const { CarregandoTela } = await import("@/components/ui/carregando-tela");
    const { TvView } = await import("./tv-view");
    let chegar: (modulo: { default: () => React.ReactElement }) => void = () => undefined;
    const Tela = lazy(() => new Promise<{ default: () => React.ReactElement }>((resolver) => (chegar = resolver)));
    act(() =>
      raiz!.render(
        <Suspense fallback={<CarregandoTela titulo="TV da sala" />}>
          <Tela />
        </Suspense>,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(container.querySelector("[data-carregando-tela]")?.textContent).toContain("Abrindo TV da sala…");
    await act(async () => {
      chegar({
        default: () => <TvView estado="carregando" painel={null} agora={new Date("2026-10-23T17:32:00.000Z")} atualizadoEm={null} semConexao={false} porColuna={4} basePath="" />,
      });
    });
    expect(container.querySelector("[data-carregando-tela]")).toBeNull();
    // Na mesma pintura, sem esperar mais 300 ms, e sem entrar de novo.
    expect(container.textContent).toContain("Carregando o quadro…");
    expect(container.querySelector("[data-spinner][data-continua]")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(estado.falas).not.toContain("Carregando o quadro");
  });
});
