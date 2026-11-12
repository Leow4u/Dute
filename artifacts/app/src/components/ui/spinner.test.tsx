// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { atrasoDoCompasso } from "@/lib/carregando/use-compasso";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { Button, buttonVariants } from "./button";
import { GIRO_CALMO_MS, GIRO_MS, Spinner } from "./spinner";

/**
 * O indicador do carregamento v2 (aprovado em 12/11/2026, seção 5.1 e
 * momento 1): a caixa chanfrada do "D" da marca, com o contorno parado numa
 * máscara e a cabeça girando por transform lá dentro. No lugar do anel da
 * decisão 5 de 06/11/2026, com a mesma API: ao lado do rótulo fica fora da
 * árvore; sozinho, com aria-label, é o aviso de status.
 */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

type Regra = { contexto: string[]; seletor: string; corpo: string };

/** As regras do CSS com as declarações, cada uma com as @-regras em volta. */
function regras(css: string): Regra[] {
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const achadas: Regra[] = [];
  const pilha: Array<{ seletor: string; inicio: number; temFilhos: boolean }> = [];
  let desde = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === "{") {
      if (pilha.length > 0) pilha[pilha.length - 1].temFilhos = true;
      pilha.push({ seletor: (texto.slice(desde, i).split(";").pop() ?? "").trim(), inicio: i + 1, temFilhos: false });
      desde = i + 1;
    } else if (texto[i] === "}") {
      const bloco = pilha.pop();
      if (bloco && !bloco.temFilhos) {
        achadas.push({ contexto: pilha.map((fora) => fora.seletor), seletor: bloco.seletor, corpo: texto.slice(bloco.inicio, i) });
      }
      desde = i + 1;
    }
  }
  return achadas;
}

/** As declarações de um seletor (sozinho ou numa lista) dentro das @-regras dadas; a última vale. */
function declaradas(seletor: string, contexto: string[] = []): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const regra of regras(CSS)) {
    const lista = regra.seletor.split(",").map((parte) => parte.trim().replace(/\s+/g, " "));
    if (!lista.includes(seletor) || regra.contexto.join(" | ") !== contexto.join(" | ")) continue;
    for (const linha of regra.corpo.split(";")) {
      const dois = linha.indexOf(":");
      if (dois > 0) mapa.set(linha.slice(0, dois).trim(), linha.slice(dois + 1).trim().replace(/\s+/g, " "));
    }
  }
  return mapa;
}

const COMPONENTES = ["@layer components"];
const REDUZIDO = ["@layer components", "@media (prefers-reduced-motion: reduce)"];
const raiz = declaradas(":root");

function caixa(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  const achada = host.querySelector<HTMLElement>("[data-spinner]");
  if (!achada) throw new Error("sem o indicador");
  return achada;
}

describe("a caixa chanfrada", () => {
  it("é a caixa com o trilho e a cabeça, sem o anel antigo", () => {
    const html = renderToStaticMarkup(<Spinner />);
    const indicador = caixa(html);
    expect(indicador.tagName).toBe("SPAN");
    expect(indicador.getAttribute("data-forma")).toBe("caixa");
    expect(indicador.classList.contains("carregando-caixa")).toBe(true);
    expect(Array.from(indicador.children).map((filho) => `${filho.tagName.toLowerCase()}.${filho.className}`)).toEqual([
      "span.trilho",
      "span.cabeca",
    ]);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("animate-spin");
  });

  it("o contorno parado na máscara (com o -webkit-), o trilho em currentColor e a cabeça cônica que gira por transform", () => {
    const base = declaradas(".carregando-caixa", COMPONENTES);
    expect(base.get("mask")).toBe("var(--carregando-mascara) center / 100% 100% no-repeat");
    expect(base.get("-webkit-mask")).toBe("var(--carregando-mascara) center / 100% 100% no-repeat");
    expect(base.get("animation")).toBe("carregando-entra var(--carregando-t-entrada) var(--ease-carregando-entrada) both");
    const trilho = declaradas(".carregando-caixa > .trilho", COMPONENTES);
    expect(trilho.get("background")).toBe("currentColor");
    expect(trilho.get("opacity")).toBe("var(--carregando-trilho)");
    const cabeca = declaradas(".carregando-caixa > .cabeca", COMPONENTES);
    expect(cabeca.get("inset")).toBe("-25%");
    expect(cabeca.get("background")).toBe("var(--carregando-cabeca)");
    expect(cabeca.get("animation")).toBe("carregando-giro var(--carregando-t-giro) linear infinite");
    expect(cabeca.get("animation-delay")).toBe("var(--compasso, 0ms)");
  });
});

describe("a árvore de acessibilidade", () => {
  it("ao lado de um rótulo, fica fora da árvore", async () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(caixa(html).getAttribute("aria-hidden")).toBe("true");
    expect(html).not.toContain("role=");
    expect(await violacoesDeAcessibilidade(`<p>${html} Carregando pedidos…</p>`)).toEqual([]);
  });

  it("sozinho, com aria-label, vira o aviso de status", async () => {
    const html = renderToStaticMarkup(<Spinner aria-label="Carregando pedidos" />);
    const indicador = caixa(html);
    expect(indicador.getAttribute("role")).toBe("status");
    expect(indicador.getAttribute("aria-label")).toBe("Carregando pedidos");
    expect(indicador.hasAttribute("aria-hidden")).toBe(false);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("os quatro tamanhos", () => {
  /** O traço em px de cada tamanho, tirado do index.css: o lado vezes o traço da máscara, em 24 unidades. */
  function traco(tamanho: number): { lado: string; px: number } {
    const base = declaradas(".carregando-caixa", COMPONENTES);
    const proprio = tamanho === 16 ? base : declaradas(`.carregando-caixa[data-tamanho="${tamanho}"]`, COMPONENTES);
    const lado = proprio.get("--carregando-tamanho") ?? "";
    const mascara = /^var\((--carregando-mascara-\d+)\)$/.exec(proprio.get("--carregando-mascara") ?? "")?.[1] ?? "";
    const largura = /stroke-width='([\d.]+)'/.exec(decodeURIComponent(raiz.get(mascara) ?? ""))?.[1];
    return { lado, px: (Number.parseFloat(lado) * Number(largura)) / 24 };
  }

  it("16 por padrão, como o anel de hoje ao lado do texto e no botão", () => {
    expect(caixa(renderToStaticMarkup(<Spinner />)).getAttribute("data-tamanho")).toBe("16");
  });

  it("16, 20, 24 e 40 px, com o traço de 2,25, 2,5, 3 e 4 px", () => {
    const esperado = { 16: 2.25, 20: 2.5, 24: 3, 40: 4 } as const;
    for (const [tamanho, px] of Object.entries(esperado)) {
      const n = Number(tamanho) as 16 | 20 | 24 | 40;
      expect(caixa(renderToStaticMarkup(<Spinner tamanho={n} />)).getAttribute("data-tamanho"), tamanho).toBe(tamanho);
      const medida = traco(n);
      expect(medida.lado, tamanho).toBe(`${tamanho}px`);
      expect(medida.px, tamanho).toBeCloseTo(px, 1);
    }
  });

  it("tem o próprio tamanho, também dentro do Button, que só dimensiona o svg", () => {
    const html = renderToStaticMarkup(
      <Button>
        <Spinner />
        Salvando…
      </Button>,
    );
    const indicador = caixa(html);
    expect(indicador.tagName).toBe("SPAN");
    expect(indicador.querySelector("svg")).toBeNull();
    expect(indicador.parentElement?.classList.contains("carregando-na-cor")).toBe(true);
    const base = declaradas(".carregando-caixa", COMPONENTES);
    expect(base.get("inline-size")).toBe("var(--carregando-tamanho)");
    expect(base.get("block-size")).toBe("var(--carregando-tamanho)");
    expect(base.get("flex")).toBe("none");
  });
});

describe("o contexto muda o trilho e o piso do respiro", () => {
  it("o botão primário define 0,35 no trilho e 0,8 no piso para os filhos; os de superfície ficam com 0,16 e 0,6", () => {
    expect(buttonVariants().split(" ")).toContain("carregando-na-cor");
    for (const variant of ["secondary", "outline", "ghost", "destructive", "link"] as const) {
      expect(buttonVariants({ variant }).split(" "), variant).not.toContain("carregando-na-cor");
    }
    const naCor = declaradas(".carregando-na-cor", COMPONENTES);
    expect(naCor.get("--carregando-trilho")).toBe("var(--carregando-trilho-na-cor)");
    expect(naCor.get("--carregando-piso")).toBe("var(--carregando-piso-na-cor)");
    expect(raiz.get("--carregando-trilho")).toBe("0.16");
    expect(raiz.get("--carregando-piso")).toBe("0.6");
  });

  it("na barra preta da v3, o trilho a 0,25", () => {
    for (const seletor of [".carregando-sobre-preto", ".bg-v3-header"]) {
      expect(declaradas(seletor, COMPONENTES).get("--carregando-trilho"), seletor).toBe("var(--carregando-trilho-sobre-preto)");
    }
  });
});

describe("a volta calma e o compasso", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("as voltas de 1,2 s e de 2 s são as dos tokens", () => {
    expect(raiz.get("--carregando-t-giro")).toBe(`${GIRO_MS}ms`);
    expect(raiz.get("--carregando-t-giro-calmo")).toBe(`${GIRO_CALMO_MS}ms`);
  });

  it("calmo, a cabeça dá a volta em 2 s", () => {
    expect(caixa(renderToStaticMarkup(<Spinner />)).hasAttribute("data-calmo")).toBe(false);
    expect(caixa(renderToStaticMarkup(<Spinner calmo />)).hasAttribute("data-calmo")).toBe(true);
    expect(declaradas('.carregando-caixa[data-calmo] > .cabeca', COMPONENTES).get("animation-duration")).toBe(
      "var(--carregando-t-giro-calmo)",
    );
  });

  it("quem monta em horas diferentes gira no mesmo passo, na volta de cada um", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let agora = 5_000.4;
    vi.spyOn(performance, "now").mockImplementation(() => agora);
    host = document.createElement("div");
    document.body.appendChild(host);
    const reacao = createRoot(host);
    act(() => reacao.render(<Spinner calmo={false} />));
    const indicador = host.querySelector<HTMLElement>("[data-spinner]")!;
    expect(indicador.style.getPropertyValue("--compasso")).toBe(`${Math.round(atrasoDoCompasso(5_000.4, GIRO_MS))}ms`);
    agora = 13_700;
    act(() => reacao.render(<Spinner calmo />));
    expect(indicador.style.getPropertyValue("--compasso")).toBe(`${Math.round(atrasoDoCompasso(5_000.4, GIRO_CALMO_MS))}ms`);
    act(() => reacao.unmount());
  });
});

describe("o determinado", () => {
  it("com progresso, o contorno fecha conforme o valor, sem girar", () => {
    const indicador = caixa(renderToStaticMarkup(<Spinner progresso={0.4} />));
    expect(indicador.hasAttribute("data-determinado")).toBe(true);
    expect(indicador.style.getPropertyValue("--p")).toBe("0.4");
    expect(caixa(renderToStaticMarkup(<Spinner />)).hasAttribute("data-determinado")).toBe(false);
    const cabeca = declaradas(".carregando-caixa[data-determinado] > .cabeca", COMPONENTES);
    expect(cabeca.get("animation")).toBe("none");
    expect(cabeca.get("background")).toBe("conic-gradient(currentColor calc(var(--p, 0) * 1turn), transparent 0)");
  });

  it("o valor fica entre 0 e 1", () => {
    const p = (progresso: number) => caixa(renderToStaticMarkup(<Spinner progresso={progresso} />)).style.getPropertyValue("--p");
    expect(p(1.5)).toBe("1");
    expect(p(-0.2)).toBe("0");
    expect(p(Number.NaN)).toBe("0");
    expect(p(0)).toBe("0");
  });
});

describe("o movimento reduzido", () => {
  it("a cabeça para no canto de cima à direita e a caixa respira até o piso", () => {
    expect(declaradas(".carregando-caixa", REDUZIDO).get("animation")).toBe(
      "carregando-respira var(--carregando-t-pulso) ease-in-out infinite",
    );
    const cabeca = declaradas(".carregando-caixa > .cabeca", REDUZIDO);
    expect(cabeca.get("animation")).toBe("none");
    expect(cabeca.get("transform")).toBe("rotate(0.125turn)");
    expect(declaradas(".carregando-caixa[data-determinado] > .cabeca", REDUZIDO).get("transform")).toBe("none");
  });
});
