// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const falados = vi.hoisted(() => [] as string[]);
// O anunciador de verdade é estável, como este.
const anunciar = vi.hoisted(() => (texto: string) => {
  falados.push(texto);
});
vi.mock("@/lib/carregando/anunciador", () => ({ useAnuncio: () => anunciar }));

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ATE_OITO_POR_PRODUTO, ProgressoDasFotosDoProduto, SO_QUATRO_POR_VEZ, useFotosDoProduto, type FotosDoProduto } from "./fotos-enviando";

/**
 * As fotos do produto no WMS (carregamento v2, parte 11 e momento 6): o
 * limite da escolha dito também ao leitor de tela, o lugar do aviso de 10 s
 * guardado enquanto as fotos sobem (o aviso entra sem empurrar o que está
 * embaixo), o fim que diz quantas subiram mesmo com uma não enviada e a
 * estimativa que sai com a foto parada. Dados sintéticos.
 */

type Pendente = { aoProgredir: (fracao: number) => void; resolver: (url: string) => void; rejeitar: (erro: unknown) => void };

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let fotos: FotosDoProduto<string> | null = null;
let pendentes: Pendente[] = [];

function Tela() {
  const atual = useFotosDoProduto<string>({
    enviarUma: (_arquivo, aoProgredir) =>
      new Promise<string>((resolver, rejeitar) => {
        pendentes.push({ aoProgredir, resolver, rejeitar });
      }),
  });
  useEffect(() => {
    fotos = atual;
  });
  return <ProgressoDasFotosDoProduto fotos={atual} />;
}

const foto = (nome: string) => new File(["x"], nome, { type: "image/jpeg" });

async function passo(fazer: () => void) {
  await act(async () => {
    fazer();
    await Promise.resolve();
  });
}

const TEXTOS = [
  "Enviando fotos",
  /^\d$/,
  /^de \d$/,
  /^\d fotos? enviadas?$/,
  /^\d fotos? não enviadas?$/,
  /^Foto \d não enviada$/,
  "Tentar de novo",
  "Demorando mais que o normal",
  /^\d:\d\d$/,
  /^cerca de \d+ (s|min)$/,
  SO_QUATRO_POR_VEZ,
  ATE_OITO_POR_PRODUTO,
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  falados.length = 0;
  pendentes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => raiz!.render(<Tela />));
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  fotos = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("as fotos do produto", () => {
  it("o limite da escolha também é falado, no mesmo anúncio do começo: seis escolhidas, \"Enviando 4 de 6 fotos\"", async () => {
    // Um anúncio só: com a região ocupada, só o último pedido vale, e o começo do envio não se perde atrás do limite.
    await passo(() => fotos!.escolher(["1", "2", "3", "4", "5", "6"].map((nome) => foto(`${nome}.jpg`))));
    expect(container!.textContent).toContain(SO_QUATRO_POR_VEZ);
    expect(falados).toEqual(["Enviando 4 de 6 fotos"]);
  });

  it("com vaga para menos de 4, o começo diz quantas das escolhidas sobem", async () => {
    await passo(() => fotos!.escolher(["1", "2", "3"].map((nome) => foto(`${nome}.jpg`)), 2));
    expect(container!.textContent).toContain(ATE_OITO_POR_PRODUTO);
    expect(falados).toEqual(["Enviando 2 de 3 fotos"]);
  });

  it("o produto que já tem 8 fotos: nada sobe, e o leitor de tela ouve por quê", async () => {
    await passo(() => fotos!.escolher([foto("1.jpg")], 0));
    expect(container!.textContent).toBe(ATE_OITO_POR_PRODUTO);
    expect(falados).toEqual([ATE_OITO_POR_PRODUTO]);
  });

  it("o lugar do aviso fica guardado enquanto as fotos sobem: aos 10 s ele entra sem empurrar o que está embaixo", async () => {
    await passo(() => fotos!.escolher([foto("1.jpg"), foto("2.jpg")]));
    const lugar = () => container!.querySelector<HTMLElement>("[data-lugar-do-aviso]");
    expect(lugar()).not.toBeNull();
    expect(lugar()!.className).toContain("min-h-9");
    expect(lugar()!.textContent).toBe("");
    await passo(() => vi.advanceTimersByTime(1_000));
    await passo(() => pendentes[0].aoProgredir(0.3));
    await passo(() => vi.advanceTimersByTime(CARREGANDO.demoraMs - 1_000));
    expect(lugar()!.textContent).toContain("Demorando mais que o normal");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    expect(await axe(container!.innerHTML)).toEqual([]);
  });

  it("a foto parada tira a estimativa do aviso: sem um byte novo há 10 s, só a demora e o relógio", async () => {
    await passo(() => fotos!.escolher([foto("1.jpg"), foto("2.jpg")]));
    await passo(() => vi.advanceTimersByTime(1_000));
    await passo(() => pendentes[0].aoProgredir(0.4));
    await passo(() => vi.advanceTimersByTime(CARREGANDO.demoraMs - 1_000));
    expect(container!.textContent).toMatch(/cerca de \d+ s/);
    await passo(() => vi.advanceTimersByTime(CARREGANDO.estimativaSemByteMs));
    expect(container!.querySelector("[data-aviso-de-espera]")?.textContent).not.toMatch(/cerca de/);
    expect(container!.textContent).toContain("Demorando mais que o normal");
  });

  it("a vez que termina com uma não enviada diz quantas subiram, sem continuar \"Enviando fotos\"", async () => {
    await passo(() => fotos!.escolher([foto("1.jpg"), foto("2.jpg"), foto("3.jpg")]));
    await passo(() => pendentes[0].resolver("u1"));
    await passo(() => pendentes[1].rejeitar(new Error("falhou")));
    await passo(() => pendentes[2].resolver("u3"));
    expect(fotos!.enviando).toBe(false);
    expect(container!.querySelector("[data-titulo]")?.textContent).toBe("2 fotos enviadas");
    expect(container!.textContent).toContain("Foto 2 não enviada");
    expect(container!.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("2 fotos enviadas");
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
  });

  it("nenhuma subiu: o fim diz quantas não foram enviadas", async () => {
    await passo(() => fotos!.escolher([foto("1.jpg")]));
    await passo(() => pendentes[0].rejeitar(new Error("falhou")));
    expect(container!.querySelector("[data-titulo]")?.textContent).toBe("1 foto não enviada");
  });
});

/** O axe espera com timers de verdade. */
async function axe(html: string) {
  vi.useRealTimers();
  return violacoesDeAcessibilidade(html);
}
