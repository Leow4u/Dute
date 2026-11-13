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

const TEXTOS = [
  "Abrindo Faturamento…",
  "Abrindo a Dutelog…",
  "Demorando mais que o normal",
  "Tentar de novo",
  "Sem resposta do servidor.",
];

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

  it("o nome que não é substantivo (verbo, artigo, \"Hoje\") vem com \"a tela\" antes", () => {
    expect(rotuloDaCarregandoTela("Separar")).toBe("Abrindo a tela Separar…");
    expect(rotuloDaCarregandoTela("Receber")).toBe("Abrindo a tela Receber…");
    expect(rotuloDaCarregandoTela("A faturar")).toBe("Abrindo a tela A faturar…");
    expect(rotuloDaCarregandoTela("A receber")).toBe("Abrindo a tela A receber…");
    expect(rotuloDaCarregandoTela("Hoje")).toBe("Abrindo a tela Hoje…");
    expect(rotuloDaCarregandoTela("Planejar OS")).toBe("Abrindo a tela Planejar OS…");
    // Os substantivos entram direto.
    expect(rotuloDaCarregandoTela("Agenda")).toBe("Abrindo Agenda…");
    expect(rotuloDaCarregandoTela("Aplicativo no celular")).toBe("Abrindo Aplicativo no celular…");
    expect(rotuloDaCarregandoTela("Orçamentos")).toBe("Abrindo Orçamentos…");
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

  it("com a abertura na tela, também enquanto ela esmaece, não desenha nem anuncia; quando ela sai, aparece e anuncia", () => {
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
    // Por baixo da abertura, nada: nem a caixa, nem o rótulo na árvore do leitor de tela.
    expect(indicador()).toBeNull();
    expect(tela().textContent).toBe("");
    expect(anuncio()).toBe("");
    act(() => fecharAbertura());
    // Esmaecendo, a abertura ainda cobre a tela: a caixa não aparece por baixo dela.
    expect(abertura.isConnected).toBe(true);
    expect(indicador()).toBeNull();
    expect(anuncio()).toBe("");
    passar(CARREGANDO.aberturaCompletaMs + CARREGANDO.aberturaSaiMs + 100);
    expect(abertura.isConnected).toBe(false);
    expect(indicador()).not.toBeNull();
    expect(tela().textContent).toBe("Abrindo Pedidos…");
    expect(anuncio()).toBe("Abrindo Pedidos…");
  });

  it("aos 10 s, a volta calma, \"Demorando mais que o normal\" e \"Tentar de novo\", com o anúncio", () => {
    const tentar = vi.fn();
    act(() =>
      raiz!.render(
        <>
          <CarregandoTela titulo="Estoque" onTentar={tentar} />
          <Anunciador />
        </>,
      ),
    );
    passar(CARREGANDO.atrasoMs);
    expect(anuncio()).toBe("Abrindo Estoque…");
    passar(CARREGANDO.demoraMs - CARREGANDO.atrasoMs - 1);
    expect(indicador()?.hasAttribute("data-calmo")).toBe(false);
    expect(tela().textContent).toBe("Abrindo Estoque…");
    expect(tela().querySelector("button")).toBeNull();
    passar(1);
    expect(indicador()?.hasAttribute("data-calmo")).toBe(true);
    expect(tela().textContent).toBe("Abrindo Estoque…Demorando mais que o normalTentar de novo");
    expect(anuncio()).toBe("Demorando mais que o normal");
    const botao = tela().querySelector("button")!;
    expect(botao.className).toContain("min-h-11");
    act(() => botao.click());
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("aos 70 s, desiste: \"Sem resposta do servidor.\" com \"Tentar de novo\", no alerta da leitura", () => {
    const tentar = vi.fn();
    act(() => raiz!.render(<CarregandoTela titulo="Estoque" onTentar={tentar} />));
    passar(CARREGANDO.desisteMs - 1);
    expect(tela().querySelector('[role="alert"]')).toBeNull();
    passar(1);
    const alerta = tela().querySelector('[role="alert"]')!;
    expect(alerta.textContent).toBe("Sem resposta do servidor.Tentar de novo");
    expect(indicador()).toBeNull();
    // O alvo de 44 px no "Tentar de novo".
    expect(tela().className).toContain("[&_button]:min-h-11");
    act(() => alerta.querySelector("button")!.click());
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("a que continua uma espera (desde) segue o mesmo relógio: aparece na hora e não repete o anúncio da entrada", () => {
    act(() =>
      raiz!.render(
        <>
          <CarregandoTela titulo="Pedidos" />
          <Anunciador />
        </>,
      ),
    );
    passar(CARREGANDO.atrasoMs);
    expect(anuncio()).toBe("Abrindo Pedidos…");
    passar(5_000);
    const desde = performance.now() - 5_000 - CARREGANDO.atrasoMs;
    // Outra instância (a da fronteira), com o relógio de quando a tela começou a abrir.
    act(() =>
      raiz!.render(
        <>
          <CarregandoTela key="continua" titulo="Pedidos" desde={desde} />
          <Anunciador />
        </>,
      ),
    );
    expect(tela().textContent).toBe("Abrindo Pedidos…");
    passar(CARREGANDO.demoraMs - 5_000 - CARREGANDO.atrasoMs - 1);
    expect(tela().textContent).toBe("Abrindo Pedidos…");
    passar(1);
    expect(tela().textContent).toContain("Demorando mais que o normal");
    expect(anuncio()).toBe("Demorando mais que o normal");
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

  it("os textos da lista e o axe, em cada estado", async () => {
    act(() => raiz!.render(<CarregandoTela titulo="Faturamento" />));
    passar(CARREGANDO.atrasoMs);
    act(() => raiz!.render(<CarregandoTela />));
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    act(() => raiz!.render(<CarregandoTela titulo="Faturamento" />));
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    const abrindo = container!.innerHTML;
    passar(CARREGANDO.demoraMs);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    const demorando = container!.innerHTML;
    passar(CARREGANDO.desisteMs);
    expect(textosForaDaLista(container!.innerHTML, TEXTOS)).toEqual([]);
    const semResposta = container!.innerHTML;
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(abrindo)).toEqual([]);
    expect(await violacoesDeAcessibilidade(demorando)).toEqual([]);
    expect(await violacoesDeAcessibilidade(semResposta)).toEqual([]);
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

  it.each(["pages/billing-hub.tsx", "pages/catalog.tsx", "pages/agente-painel.tsx"])(
    "%s espera com a CarregandoTela e o mesmo nome da rota, não com fallback={null}",
    (arquivo) => {
      const codigo = fonte(arquivo);
      expect(codigo).not.toMatch(/fallback=\{null\}/);
      // O nome da aba, o mesmo da espera de fora: a tela não troca de nome no meio da espera.
      expect(codigo).toContain("<Suspense fallback={<CarregandoTela titulo={nomeDaTela(location)} />}>");
    },
  );

  it("a fronteira das rotas confere o arquivo com o mesmo nome da tela", () => {
    expect(corpoDaFuncao(APP, "ProtectedRoute")).toContain("<ChunkErrorBoundary titulo={titulo}>");
  });

  it("toda rota tem nome: a espera nunca diz \"Abrindo a Dutelog…\" com o app aberto", () => {
    const caminhos = [...APP.matchAll(/protectedRoute\(\s*"([^"]+)"/g)].map(([, caminho]) => caminho);
    expect(caminhos.length).toBeGreaterThan(100);
    expect(caminhos.filter((caminho) => nomeDaTela(caminho) === null)).toEqual([]);
    expect(rotuloDaCarregandoTela(nomeDaTela("/operacao/os"))).toBe("Abrindo OS…");
    expect(rotuloDaCarregandoTela(nomeDaTela("/campo/os"))).toBe("Abrindo OS em execução…");
    expect(rotuloDaCarregandoTela(nomeDaTela("/pedidos/separar"))).toBe("Abrindo a tela Separar…");
    expect(rotuloDaCarregandoTela(nomeDaTela("/financeiro/a-faturar"))).toBe("Abrindo a tela A faturar…");
  });
});
