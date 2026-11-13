// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act, lazy, Suspense, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fecharAbertura } from "@/lib/abertura";
import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { nomeDaTela } from "@/lib/document-title";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { CarregandoTela, rotuloDaCarregandoTela } from "./carregando-tela";

/**
 * A tela que ainda abre (carregamento v2, seção 9): depois de 300 ms, a caixa
 * de 40 px e "Abrindo Faturamento…", no lugar do "Carregando..." solto dos
 * dois Suspense do App, dos `fallback={null}` (Faturamento, Catálogo, painel
 * antigo do agente) e do `null` de HomeRedirect, ProtectedRoute e RoleGate,
 * que deixavam a tela em branco.
 */

const TEXTOS = ["Abrindo Faturamento…", "Abrindo a Dutelog…"];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const tela = () => container!.querySelector<HTMLElement>("[data-carregando-tela]")!;
const indicador = () => tela().querySelector<HTMLElement>("[data-spinner]");
const anuncio = () => document.querySelector('[role="status"]')?.textContent ?? "";

describe("CarregandoTela", () => {
  it("antes de 300 ms não mostra nada; aos 300 ms, a caixa de 40 px e \"Abrindo Faturamento…\"", () => {
    act(() => raiz!.render(<CarregandoTela titulo="Faturamento" />));
    expect(tela().textContent).toBe("");
    expect(indicador()).toBeNull();
    passar(CARREGANDO.atrasoMs - 1);
    expect(indicador()).toBeNull();
    passar(1);
    expect(indicador()?.getAttribute("data-tamanho")).toBe("40");
    expect(indicador()?.getAttribute("data-forma")).toBe("caixa");
    expect(indicador()?.getAttribute("aria-hidden")).toBe("true");
    expect(tela().textContent).toBe("Abrindo Faturamento…");
  });

  it("sem o nome da tela, diz que abre a Dutelog", () => {
    expect(rotuloDaCarregandoTela()).toBe("Abrindo a Dutelog…");
    expect(rotuloDaCarregandoTela(null)).toBe("Abrindo a Dutelog…");
    expect(rotuloDaCarregandoTela("  ")).toBe("Abrindo a Dutelog…");
    expect(rotuloDaCarregandoTela("Pedidos")).toBe("Abrindo Pedidos…");
    // O nome é o da aba do navegador.
    expect(rotuloDaCarregandoTela(nomeDaTela("/faturamento"))).toBe("Abrindo Faturamento…");
    expect(rotuloDaCarregandoTela(nomeDaTela("/rota-que-nao-existe"))).toBe("Abrindo a Dutelog…");
  });

  it("anuncia uma vez aos 300 ms, pela região do Anunciador", () => {
    act(() =>
      raiz!.render(
        <>
          <CarregandoTela titulo="Pedidos" />
          <Anunciador />
        </>,
      ),
    );
    passar(CARREGANDO.atrasoMs - 1);
    expect(anuncio()).toBe("");
    passar(1);
    expect(anuncio()).toBe("Abrindo Pedidos…");
    // Nenhuma região viva própria: só a do Anunciador.
    expect(tela().querySelector("[role], [aria-live]")).toBeNull();
  });

  it("com a abertura na tela, não anuncia (ela já diz \"Abrindo a Dutelog\"); quando ela sai, anuncia", () => {
    const abertura = document.createElement("div");
    abertura.id = "abertura";
    document.body.prepend(abertura);
    act(() =>
      raiz!.render(
        <>
          <CarregandoTela titulo="Pedidos" />
          <Anunciador />
        </>,
      ),
    );
    passar(1_000);
    expect(indicador()).not.toBeNull();
    expect(anuncio()).toBe("");
    act(() => fecharAbertura());
    expect(anuncio()).toBe("Abrindo Pedidos…");
  });

  it("depois de 10 s, a volta fica calma", () => {
    act(() => raiz!.render(<CarregandoTela titulo="Estoque" />));
    passar(CARREGANDO.demoraMs - 1);
    expect(indicador()?.hasAttribute("data-calmo")).toBe(false);
    passar(1);
    expect(indicador()?.hasAttribute("data-calmo")).toBe(true);
  });

  it("é o fallback que abre a tela sob demanda: some quando a tela chega", async () => {
    let chegar: (modulo: { default: () => ReactElement }) => void = () => undefined;
    const Tela = lazy(() => new Promise<{ default: () => ReactElement }>((resolver) => (chegar = resolver)));
    act(() =>
      raiz!.render(
        <Suspense fallback={<CarregandoTela titulo="Faturamento" />}>
          <Tela />
        </Suspense>,
      ),
    );
    passar(CARREGANDO.atrasoMs);
    expect(tela().textContent).toBe("Abrindo Faturamento…");
    await act(async () => {
      chegar({ default: () => <p>Fechamento do mês</p> });
    });
    expect(container!.textContent).toBe("Fechamento do mês");
  });

  it("os textos da lista e o axe", async () => {
    act(() => raiz!.render(<CarregandoTela titulo="Faturamento" />));
    passar(CARREGANDO.atrasoMs);
    act(() => raiz!.render(<CarregandoTela />));
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    act(() => raiz!.render(<CarregandoTela titulo="Faturamento" />));
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    const html = container!.innerHTML;
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

// O App e as telas lidos como texto: importar o App puxaria o Firebase.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fonte = (arquivo: string) => readFileSync(resolve(SRC, arquivo), "utf8");

/** O corpo da função `nome` no App, até a próxima função do topo do arquivo. */
function corpoDaFuncao(codigo: string, nome: string): string {
  const inicio = codigo.indexOf(`function ${nome}(`);
  expect(inicio, nome).toBeGreaterThanOrEqual(0);
  const proxima = codigo.slice(inicio + 1).search(/\n(?:export )?(?:default )?(?:function|const|class) /);
  return proxima < 0 ? codigo.slice(inicio) : codigo.slice(inicio, inicio + 1 + proxima);
}

describe("a CarregandoTela no lugar do branco", () => {
  const APP = fonte("App.tsx");

  it("os dois Suspense do App esperam com a CarregandoTela, sem o \"Carregando...\" solto", () => {
    expect(APP).not.toMatch(/Carregando\.\.\./);
    const fallbacks = [...APP.matchAll(/<Suspense\s+fallback=\{([\s\S]*?)\}\s*>/g)].map(([, fallback]) => fallback.trim());
    // A da rota, com o nome da tela; a de fora das rotas, na altura da tela inteira.
    expect(fallbacks).toEqual(["<CarregandoTela titulo={titulo} />", '<CarregandoTela className="min-h-dvh" />']);
    expect(corpoDaFuncao(APP, "ProtectedRoute")).toMatch(/const titulo = nomeDaTela\(rest\.path\)/);
  });

  it.each(["HomeRedirect", "ProtectedRoute", "RoleGate", "RoleHome", "EntradaPorModulo"])(
    "%s não devolve null enquanto espera",
    (nome) => {
      const corpo = corpoDaFuncao(APP, nome);
      expect(corpo).not.toMatch(/return null/);
      expect(corpo).toMatch(/<CarregandoTela/);
    },
  );

  it.each([
    ["pages/billing-hub.tsx", '<CarregandoTela titulo="Faturamento" />'],
    ["pages/catalog.tsx", "<CarregandoTela titulo={"],
    ["pages/agente-painel.tsx", '<CarregandoTela titulo="Painel" />'],
  ])("%s espera com a CarregandoTela, não com fallback={null}", (arquivo, esperado) => {
    const codigo = fonte(arquivo);
    expect(codigo).not.toMatch(/fallback=\{null\}/);
    expect(codigo).toContain(`<Suspense fallback={${esperado}`);
  });
});
