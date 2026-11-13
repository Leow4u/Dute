// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { Anunciador, useAnuncio } from "./anunciador";
import { ProvedorDaConexao, criarConexao } from "./estado-da-conexao";

/**
 * A região viva do carregamento (carregamento v2, seção 7): uma por tela, só
 * para o leitor de tela, montada desde o início no App; no máximo um anúncio
 * a cada 2 s.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let anunciar: (texto: string) => void = () => undefined;
let falados: string[] = [];

function Quem() {
  const anuncio = useAnuncio();
  useEffect(() => {
    anunciar = anuncio;
  });
  return null;
}

function regiao(): HTMLElement {
  return container!.querySelector<HTMLElement>("[data-anunciador]")!;
}

function falar(texto: string) {
  act(() => anunciar(texto));
  anotar();
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  anotar();
}

/** O que a região passou a dizer (o leitor de tela fala cada texto novo). */
function anotar() {
  const texto = container!.querySelector("[data-anunciador]")?.textContent ?? "";
  if (texto && texto !== falados[falados.length - 1]) falados.push(texto);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  falados = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz!.render(
      <>
        <Anunciador />
        <Quem />
      </>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  anunciar = () => undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("o anunciador", () => {
  it("é uma região de status só para o leitor de tela, na página desde o início e vazia", async () => {
    const elemento = regiao();
    expect(elemento.getAttribute("role")).toBe("status");
    expect(elemento.getAttribute("aria-live")).toBe("polite");
    expect(elemento.getAttribute("aria-atomic")).toBe("true");
    expect(elemento.className).toBe("sr-only");
    expect(elemento.textContent).toBe("");
    falar("Carregando pedidos");
    expect(elemento.textContent).toBe("Carregando pedidos");
    vi.useRealTimers(); // o axe usa os timers de verdade
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("fala no máximo um anúncio a cada 2 s, e o que espera é o último", () => {
    falar("Carregando pedidos");
    passar(500);
    falar("Sem conexão");
    falar("Demorando mais que o normal");
    expect(regiao().textContent).toBe("Carregando pedidos");
    passar(1_499);
    expect(regiao().textContent).toBe("Carregando pedidos");
    passar(1);
    expect(regiao().textContent).toBe("Demorando mais que o normal");
    falar("Sem resposta do servidor");
    passar(1_999);
    expect(regiao().textContent).toBe("Demorando mais que o normal");
    passar(1);
    expect(falados).toEqual(["Carregando pedidos", "Demorando mais que o normal", "Sem resposta do servidor"]);
  });

  it("depois de 2 s em silêncio, fala na hora", () => {
    falar("Carregando pedidos");
    passar(2_000);
    falar("3 para aprovar, 2 para separar");
    expect(regiao().textContent).toBe("3 para aprovar, 2 para separar");
  });

  it("o mesmo texto não repete dentro dos 2 s; depois, fala de novo como texto novo", () => {
    falar("Sem conexão");
    const primeiro = regiao().firstElementChild;
    passar(1_000);
    falar("Sem conexão");
    passar(5_000);
    expect(regiao().firstElementChild).toBe(primeiro);
    falar("Sem conexão");
    expect(regiao().textContent).toBe("Sem conexão");
    expect(regiao().firstElementChild).not.toBe(primeiro);
  });

  it("ignora o texto vazio e junta os espaços", () => {
    falar("   ");
    expect(regiao().textContent).toBe("");
    falar("  Carregando   pedidos ");
    expect(regiao().textContent).toBe("Carregando pedidos");
  });

  it("sem o anunciador na página, falar não faz nada", () => {
    act(() => raiz!.render(<Quem />));
    expect(() => falar("Carregando pedidos")).not.toThrow();
    passar(5_000);
    expect(container!.textContent).toBe("");
  });

  it("o anúncio que esperava não sai depois que o anunciador sai da página", () => {
    falar("Carregando pedidos");
    falar("Sem conexão");
    act(() => raiz!.render(<Quem />));
    passar(5_000);
    expect(container!.textContent).toBe("");
  });
});

describe("a falta de conexão", () => {
  it("diz Sem conexão uma vez, ao entrar, com a histerese; nunca Reconectando, nem a volta", () => {
    let rede = true;
    const conexao = criarConexao({ temRede: () => rede });
    act(() =>
      raiz!.render(
        <ProvedorDaConexao value={conexao}>
          <Anunciador />
        </ProvedorDaConexao>,
      ),
    );
    // O servidor sem resposta com o aparelho conectado: Reconectando, que não fala.
    act(() => conexao.ficouSemResposta());
    passar(5_000);
    expect(falados).toEqual([]);
    // O aparelho perde a rede: nada antes dos 3 s; aos 3 s, "Sem conexão", uma vez.
    rede = false;
    act(() => conexao.redeMudou());
    passar(2_999);
    expect(falados).toEqual([]);
    passar(1);
    expect(falados).toEqual(["Sem conexão"]);
    passar(30_000);
    // A volta da rede e a do servidor não falam.
    rede = true;
    act(() => conexao.redeMudou());
    passar(3_000);
    act(() => conexao.leuDoServidor());
    passar(3_000);
    expect(falados).toEqual(["Sem conexão"]);
    expect(regiao().textContent).toBe("Sem conexão");
    conexao.fechar();
  });
});

// No ambiente jsdom o Vite reescreve `new URL("../..", import.meta.url)` como endereço de asset.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fontes(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return fontes(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("o anunciador no App", () => {
  it("fica montado uma vez só, no App, fora das rotas: existe em toda tela, desde o início", () => {
    const usos = fontes(SRC).flatMap((arquivo) =>
      (readFileSync(arquivo, "utf8").match(/<Anunciador\b/g) ?? []).map(() => relative(SRC, arquivo).split("\\").join("/")),
    );
    expect(usos).toEqual(["App.tsx"]);
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const lugar = app.indexOf("<Anunciador />");
    expect(lugar).toBeGreaterThan(app.indexOf("</Switch>"));
    expect(lugar).toBeLessThan(app.indexOf("</TooltipProvider>"));
    expect(app.indexOf("<Switch>")).toBeLessThan(app.indexOf("</Switch>"));
  });
});
