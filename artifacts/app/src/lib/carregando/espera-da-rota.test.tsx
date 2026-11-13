// @vitest-environment jsdom
import { act, lazy, Suspense, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import { LinhaDeEstado, type LeituraDaLista } from "@/components/ui/linha-de-estado";
import { QueueGroup } from "@/components/ui/queue-list";

import { Anunciador, useAnuncio } from "./anunciador";
import { CARREGANDO } from "./tempo";

/**
 * A espera da rota e a da lista são uma espera só (carregamento v2, seção 3, e
 * a junção das partes 7b, 8 e 9): a `CarregandoTela` espera o arquivo da tela
 * e, quando ele chega, a lista que ainda lê continua o mesmo relógio. Sem vão
 * entre as duas, sem anunciar a mesma espera duas vezes, a demora aos 10 s do
 * toque, e o anúncio de uma espera que acabou antes da vez não é falado
 * depois: o leitor de tela não ouve "Carregando estoque" com a lista na tela.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let falados: Array<{ t: number; texto: string }> = [];
let zero = 0;

const LENDO: LeituraDaLista = { isLoading: true, isFetching: true, isError: false, error: null, dataUpdatedAt: 0, refetch: (async () => ({})) as never };
const lida = (): LeituraDaLista => ({ ...LENDO, isLoading: false, isFetching: false, dataUpdatedAt: Date.now() });
const falhou = (): LeituraDaLista => ({ ...LENDO, isLoading: false, isFetching: false, isError: true, error: new Error("Falha no servidor") });

/** A leitura da lista agora: a tela lê daqui a cada desenho. */
let leitura: LeituraDaLista = LENDO;

function Lista({ objeto, resumo }: { objeto: string; resumo?: string }) {
  return (
    <>
      <LinhaDeEstado leitura={leitura} objeto={objeto} resumo={resumo} />
      <QueueGroup
        title="Para aprovar"
        count={leitura.isLoading ? null : 1}
        empty="Nenhum pedido para aprovar."
        carregando={leitura.isLoading ? { linhas: 2, acoes: 2 } : undefined}
      >
        <p>Pedido 1042</p>
      </QueueGroup>
    </>
  );
}

let falar: (texto: string) => () => void = () => () => undefined;

function Falador() {
  falar = useAnuncio();
  return null;
}

function falarAgora(texto: string) {
  act(() => void falar(texto));
  anotar();
}

let chegar: (modulo: { default: () => ReactElement }) => void = () => undefined;

function abrir(titulo: string, objeto: string, resumo?: string) {
  const Tela = lazy(() => new Promise<{ default: () => ReactElement }>((resolver) => (chegar = resolver)));
  const desenhar = () =>
    raiz!.render(
      <>
        <Suspense fallback={<CarregandoTela titulo={titulo} />}>
          <Tela />
        </Suspense>
        <Anunciador />
        <Falador />
      </>,
    );
  act(desenhar);
  return {
    /** O arquivo da tela chega: a lista entra no lugar da espera da rota. */
    chega: async () => {
      await act(async () => {
        chegar({ default: () => <Lista objeto={objeto} resumo={resumo} /> });
      });
      anotar();
    },
    /** A leitura da lista muda. */
    muda: (nova: LeituraDaLista) => {
      leitura = nova;
      act(desenhar);
      anotar();
    },
  };
}

function anotar() {
  const texto = container!.querySelector("[data-anunciador]")?.textContent ?? "";
  if (texto && texto !== falados[falados.length - 1]?.texto) falados.push({ t: Math.round(performance.now() - zero), texto });
}

function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 10) {
    act(() => {
      vi.advanceTimersByTime(Math.min(10, ms - feito));
    });
    anotar();
  }
}

const linha = () => container!.querySelector<HTMLElement>("[data-linha-de-estado]");
const fantasmasVisiveis = () => container!.querySelectorAll("[data-fantasmas][data-visivel]").length;
const desde = (t: number) => falados.filter((fala) => fala.t > t).map((fala) => fala.texto);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  falados = [];
  leitura = LENDO;
  zero = performance.now();
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a lista que continua a espera da rota", () => {
  it("sem vão: a caixa sai da rota e a linha de estado e as linhas-fantasma já estão na tela", async () => {
    const tela = abrir("Pedidos", "pedidos");
    passar(800);
    expect(container!.querySelector("[data-carregando-tela]")?.textContent).toBe("Abrindo Pedidos…");
    await tela.chega();
    expect(container!.querySelector("[data-carregando-tela]")).toBeNull();
    // Na mesma pintura, sem esperar mais 300 ms.
    expect(linha()?.getAttribute("data-estado")).toBe("carregando");
    expect(linha()?.textContent).toBe("Carregando pedidos…");
    expect(fantasmasVisiveis()).toBe(1);
  });

  it("uma espera, um relógio: a demora vem aos 10 s do toque, e não aos 10 s da lista", async () => {
    const tela = abrir("Pedidos", "pedidos");
    passar(9_000);
    await tela.chega();
    passar(CARREGANDO.demoraMs - 9_000 - 20);
    expect(linha()?.getAttribute("data-estado")).toBe("carregando");
    passar(30);
    expect(linha()?.getAttribute("data-estado")).toBe("demorando");
    expect(falados.map((fala) => fala.texto)).toEqual(["Abrindo Pedidos", "Demorando mais que o normal"]);
  });

  it("a mesma espera não é anunciada duas vezes; quando a lista chega, o resumo", async () => {
    const tela = abrir("Pedidos", "pedidos", "3 para aprovar, 2 para separar");
    passar(800);
    await tela.chega();
    passar(1_000);
    tela.muda(lida());
    passar(3_000);
    expect(falados.map((fala) => fala.texto)).toEqual(["Abrindo Pedidos", "3 para aprovar, 2 para separar"]);
  });

  it("Estoque, sem resumo: a lista que chega antes da vez do anúncio não é anunciada depois", async () => {
    const tela = abrir("Estoque", "estoque");
    passar(800);
    await tela.chega();
    passar(400);
    const chegou = Math.round(performance.now() - zero);
    tela.muda(lida());
    expect(linha()?.getAttribute("data-estado")).toBe("lida");
    passar(3_000);
    expect(desde(chegou)).toEqual([]);
  });

  it("a leitura que falha com o anúncio na fila: ele sai, e o leitor de tela não ouve \"Carregando\" depois do aviso", async () => {
    const tela = abrir("Pedidos", "pedidos", "3 para aprovar");
    passar(800);
    await tela.chega();
    passar(400);
    const falhouEm = Math.round(performance.now() - zero);
    tela.muda(falhou());
    passar(3_000);
    expect(desde(falhouEm)).toEqual([]);
  });

  it("a entrada da rota que ainda esperava a vez quando a tela chegou passa à lista: dita uma vez se a lista ainda lê", async () => {
    const tela = abrir("Estoque", "estoque");
    // A região acabou de falar (o "Lista atualizada" da tela de antes): "Abrindo Estoque" espera a vez.
    falarAgora("Lista atualizada");
    passar(800);
    await tela.chega();
    passar(3_000);
    expect(falados.map((fala) => fala.texto)).toEqual(["Lista atualizada", "Abrindo Estoque"]);
  });

  it("e retirada se a lista chegar antes da vez", async () => {
    const tela = abrir("Estoque", "estoque");
    falarAgora("Lista atualizada");
    passar(800);
    await tela.chega();
    passar(400);
    tela.muda(lida());
    passar(3_000);
    expect(falados.map((fala) => fala.texto)).toEqual(["Lista atualizada"]);
  });

  it("a tela que chega já com a lista lida tira a entrada da rota que ainda esperava a vez", async () => {
    leitura = lida();
    const tela = abrir("Faturamento", "faturas");
    falarAgora("Lista atualizada");
    passar(800);
    await tela.chega();
    passar(3_000);
    expect(falados.map((fala) => fala.texto)).toEqual(["Lista atualizada"]);
  });
});
