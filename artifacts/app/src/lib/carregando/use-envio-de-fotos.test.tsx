// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const falados = vi.hoisted(() => [] as string[]);
vi.mock("./anunciador", () => ({ useAnuncio: () => (texto: string) => falados.push(texto) }));

import { EnvioCancelado, FOTO_PARADA } from "@/lib/envio-de-fotos";

import { CARREGANDO } from "./tempo";
import { anuncioDoComeco, anuncioDoFim, restanteDoEnvio, useEnvioDeFotos, type EnvioDeFotos, type OpcoesDoEnvio } from "./use-envio-de-fotos";

/**
 * O envio das fotos (carregamento v2, parte 11 e momento 6): uma por vez, na
 * ordem da escolha, a fração dos bytes que só cresce, a que falha fica "não
 * enviada" sem derrubar as outras (o Promise.all de antes perdia todas), a
 * parada por 70 s também, e o Anunciador fala o começo e o fim.
 */

type Pendente = { arquivo: File; aoProgredir: (fracao: number) => void; sinal: AbortSignal; resolver: (url: string) => void; rejeitar: (erro: unknown) => void };

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let envio: EnvioDeFotos<string> | null = null;
let pendentes: Pendente[] = [];
let entregues: string[][] = [];
let falhas: unknown[] = [];

function Espiao({ opcoes }: { opcoes: OpcoesDoEnvio<string> }) {
  const atual = useEnvioDeFotos(opcoes);
  useEffect(() => {
    envio = atual;
  });
  return null;
}

const opcoes: OpcoesDoEnvio<string> = {
  enviarUma: (arquivo, aoProgredir, sinal) =>
    new Promise<string>((resolver, rejeitar) => {
      pendentes.push({ arquivo, aoProgredir, sinal, resolver, rejeitar });
      sinal.addEventListener("abort", () => rejeitar(new EnvioCancelado()));
    }),
  aoConcluir: (resultados) => entregues.push(resultados),
  aoFalhar: (erro) => falhas.push(erro),
};

function foto(nome: string) {
  return new File(["x"], nome, { type: "image/jpeg" });
}

async function passo(fazer: () => void) {
  await act(async () => {
    fazer();
    await Promise.resolve();
  });
}

const estados = () => envio!.itens.map((item) => item.estado);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pendentes = [];
  entregues = [];
  falhas = [];
  falados.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => raiz!.render(<Espiao opcoes={opcoes} />));
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  envio = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("o envio das fotos, uma por vez", () => {
  it("sobe na ordem da escolha, uma de cada vez, e entrega as enviadas quando a fila esvazia", async () => {
    await passo(() => envio!.enviar([foto("1.jpg"), foto("2.jpg"), foto("3.jpg"), foto("4.jpg")]));
    expect(falados).toEqual(["Enviando 4 fotos"]);
    expect(estados()).toEqual(["andamento", "fila", "fila", "fila"]);
    expect(pendentes.map((pendente) => pendente.arquivo.name)).toEqual(["1.jpg"]);
    expect(envio!.enviando).toBe(true);
    for (const [indice, url] of ["u1", "u2", "u3"].entries()) {
      await passo(() => pendentes[indice].resolver(url));
    }
    expect(estados()).toEqual(["feito", "feito", "feito", "andamento"]);
    expect(entregues).toEqual([]);
    await passo(() => pendentes[3].resolver("u4"));
    expect(estados()).toEqual(["feito", "feito", "feito", "feito"]);
    expect(envio!.enviando).toBe(false);
    expect(entregues).toEqual([["u1", "u2", "u3", "u4"]]);
    expect(falados).toEqual(["Enviando 4 fotos", "4 fotos enviadas"]);
  });

  it("a fração anda por evento de bytes e nunca volta", async () => {
    await passo(() => envio!.enviar([foto("1.jpg")]));
    await passo(() => pendentes[0].aoProgredir(0.4));
    expect(envio!.itens[0].fracao).toBe(0.4);
    await passo(() => pendentes[0].aoProgredir(0.2));
    expect(envio!.itens[0].fracao).toBe(0.4);
    await passo(() => pendentes[0].aoProgredir(0.9));
    expect(envio!.itens[0].fracao).toBe(0.9);
  });

  it("a que falha fica não enviada, com o motivo, e as outras sobem; o Tentar de novo a põe de volta na fila", async () => {
    await passo(() => envio!.enviar([foto("1.jpg"), foto("2.jpg"), foto("3.jpg")]));
    await passo(() => pendentes[0].resolver("u1"));
    const recusa = new Error("Somente imagens podem ser anexadas ao produto.");
    await passo(() => pendentes[1].rejeitar(recusa));
    expect(estados()).toEqual(["feito", "erro", "andamento"]);
    expect(falhas).toEqual([recusa]);
    await passo(() => pendentes[2].resolver("u3"));
    expect(entregues).toEqual([["u1", "u3"]]);
    expect(falados[falados.length - 1]).toBe("1 foto não enviada");
    await passo(() => envio!.tentarDeNovo(envio!.itens[1].chave));
    expect(estados()).toEqual(["feito", "andamento", "feito"]);
    await passo(() => pendentes[3].resolver("u2"));
    expect(entregues).toEqual([["u1", "u3"], ["u2"]]);
    expect(falados[falados.length - 1]).toBe("3 fotos enviadas");
  });

  it("a foto que fica 70 s sem um byte novo é cancelada e fica não enviada", async () => {
    await passo(() => envio!.enviar([foto("1.jpg"), foto("2.jpg")]));
    await passo(() => vi.advanceTimersByTime(CARREGANDO.desisteMs - 1_000));
    await passo(() => pendentes[0].aoProgredir(0.5));
    // O byte novo recomeça o prazo.
    await passo(() => vi.advanceTimersByTime(CARREGANDO.desisteMs - 1));
    expect(pendentes[0].sinal.aborted).toBe(false);
    await passo(() => vi.advanceTimersByTime(1));
    expect(pendentes[0].sinal.aborted).toBe(true);
    expect(estados()).toEqual(["erro", "andamento"]);
    expect((falhas[0] as Error).message).toBe(FOTO_PARADA);
  });

  it("a escolha nova tira da lista as enviadas da vez anterior e guarda as não enviadas", async () => {
    await passo(() => envio!.enviar([foto("1.jpg"), foto("2.jpg")]));
    await passo(() => pendentes[0].resolver("u1"));
    await passo(() => pendentes[1].rejeitar(new Error("falhou")));
    await passo(() => envio!.enviar([foto("3.jpg")]));
    expect(envio!.itens.map((item) => item.arquivo.name)).toEqual(["2.jpg", "3.jpg"]);
    expect(estados()).toEqual(["erro", "andamento"]);
  });

  it("limpar cancela a que sobe e não entrega nada", async () => {
    await passo(() => envio!.enviar([foto("1.jpg")]));
    await passo(() => envio!.limpar());
    expect(pendentes[0].sinal.aborted).toBe(true);
    expect(envio!.itens).toEqual([]);
    expect(entregues).toEqual([]);
    expect(falhas).toEqual([]);
  });
});

describe("as frases e a estimativa", () => {
  it("o começo e o fim, no singular e no plural", () => {
    expect(anuncioDoComeco(1)).toBe("Enviando 1 foto");
    expect(anuncioDoFim(4, 0)).toBe("4 fotos enviadas");
    expect(anuncioDoFim(1, 0)).toBe("1 foto enviada");
    expect(anuncioDoFim(2, 2)).toBe("2 fotos não enviadas");
  });

  it("o que falta, pelo que já subiu", () => {
    // Duas e meia de quatro em 10 s: falta 1,5 foto, 6 s.
    const itens = [
      { estado: "feito" as const, fracao: 1 },
      { estado: "feito" as const, fracao: 1 },
      { estado: "andamento" as const, fracao: 0.5 },
      { estado: "fila" as const, fracao: 0 },
    ];
    expect(restanteDoEnvio(itens, 10_000)).toBeCloseTo(6_000);
    expect(restanteDoEnvio([{ estado: "andamento", fracao: 0 }], 10_000)).toBeUndefined();
  });
});
