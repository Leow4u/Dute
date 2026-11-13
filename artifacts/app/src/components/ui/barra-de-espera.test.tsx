// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { BarraDeEspera, type BarraDeEsperaProps } from "./barra-de-espera";

/**
 * A barra de espera do carregamento v2 (aprovado em 12/11/2026, seção 5.5 e
 * momento 4): na borda de baixo da linha em andamento ou no topo do cartão
 * que relê. Aos 300 ms o segmento em tinta varre o trilho; aos 5 s ela para
 * inteira; no sucesso completa em verde e no erro em crítico. Sempre fora da
 * árvore de acessibilidade: quem informa é o texto da linha.
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

/** Os quadros de um keyframe: [seletor do quadro, declarações]. */
function quadros(nome: string): Array<[string, string]> {
  return regras(CSS)
    .filter((regra) => regra.contexto.some((fora) => fora === `@keyframes ${nome}`))
    .map((regra) => [regra.seletor, regra.corpo.trim().replace(/\s+/g, " ").replace(/;$/, "")]);
}

const COMPONENTES = ["@layer components"];
const REDUZIDO = ["@layer components", "@media (prefers-reduced-motion: reduce)"];

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function montar(props: BarraDeEsperaProps) {
  act(() => raiz!.render(<BarraDeEspera {...props} />));
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function barra(): HTMLElement | null {
  return container!.querySelector<HTMLElement>("[data-barra]");
}

function partes(): string[] {
  return Array.from(barra()?.children ?? []).map((parte) => (parte as HTMLElement).dataset.parte ?? "");
}

describe("a barra no relógio", () => {
  it("parada e sem resultado, não desenha nada", () => {
    montar({ lugar: "linha", ativa: false });
    passar(10_000);
    expect(container!.innerHTML).toBe("");
  });

  it("nada antes de 300 ms; aos 300 ms o segmento varre o trilho", () => {
    montar({ lugar: "linha", ativa: true });
    passar(CARREGANDO.atrasoMs - 1);
    expect(barra()).toBeNull();
    passar(1);
    expect(barra()?.dataset.estado).toBe("andamento");
    expect(barra()?.dataset.lugar).toBe("linha");
    expect(barra()?.classList.contains("carregando-barra")).toBe(true);
    expect(partes()).toEqual(["trilho", "segmento", "cheio"]);
  });

  it("aos 5 s para, inteira, sem o segmento", () => {
    montar({ lugar: "topo", ativa: true });
    passar(CARREGANDO.movimentoMaxMs - 1);
    expect(barra()?.dataset.estado).toBe("andamento");
    passar(1);
    expect(barra()?.dataset.estado).toBe("parada");
    expect(barra()?.dataset.lugar).toBe("topo");
    expect(partes()).toEqual(["trilho", "cheio"]);
    // Parada, fica até a espera acabar.
    passar(CARREGANDO.demoraMs);
    expect(barra()?.dataset.estado).toBe("parada");
  });

  it("no sucesso completa em verde, depois do mínimo de 500 ms do em andamento", () => {
    montar({ lugar: "linha", ativa: true });
    passar(400);
    montar({ lugar: "linha", ativa: false, resultado: "ok" });
    expect(barra()?.dataset.estado).toBe("andamento");
    passar(399);
    expect(barra()?.dataset.estado).toBe("andamento");
    passar(1);
    expect(barra()?.dataset.estado).toBe("ok");
    expect(partes()).toEqual(["trilho", "cheio"]);
  });

  it("no erro completa em crítico; sem resultado, sai", () => {
    montar({ lugar: "linha", ativa: true });
    passar(CARREGANDO.movimentoMaxMs);
    montar({ lugar: "linha", ativa: false, resultado: "erro" });
    expect(barra()?.dataset.estado).toBe("erro");
    montar({ lugar: "linha", ativa: false });
    expect(barra()).toBeNull();
  });

  it("o resultado que chega antes de 300 ms completa na hora, sem a varredura", () => {
    montar({ lugar: "linha", ativa: true });
    passar(100);
    montar({ lugar: "linha", ativa: false, resultado: "ok" });
    expect(barra()?.dataset.estado).toBe("ok");
  });

  it("em andamento, o resultado ainda não vale", () => {
    montar({ lugar: "linha", ativa: true, resultado: "ok" });
    expect(barra()).toBeNull();
    passar(CARREGANDO.atrasoMs);
    expect(barra()?.dataset.estado).toBe("andamento");
  });

  it("determinada, enche por scaleX até o progresso, sem varrer e sem parar aos 5 s", () => {
    montar({ lugar: "topo", ativa: true, progresso: 0.25 });
    passar(CARREGANDO.atrasoMs);
    expect(barra()?.dataset.estado).toBe("progresso");
    expect(barra()?.style.getPropertyValue("--p")).toBe("0.25");
    expect(partes()).toEqual(["trilho", "cheio"]);
    passar(CARREGANDO.movimentoMaxMs);
    montar({ lugar: "topo", ativa: true, progresso: 3 });
    expect(barra()?.dataset.estado).toBe("progresso");
    expect(barra()?.style.getPropertyValue("--p")).toBe("1");
    montar({ lugar: "topo", ativa: true, progresso: Number.NaN });
    expect(barra()?.style.getPropertyValue("--p")).toBe("0");
  });
});

describe("fora da árvore de acessibilidade", () => {
  it("sempre aria-hidden, sem texto, sem região viva e sem foco", () => {
    for (const props of [
      { lugar: "linha", ativa: true },
      { lugar: "topo", ativa: true, progresso: 0.5 },
    ] satisfies BarraDeEsperaProps[]) {
      montar(props);
      passar(CARREGANDO.atrasoMs);
      expect(barra()?.getAttribute("aria-hidden"), props.lugar).toBe("true");
      expect(barra()?.querySelectorAll("[aria-hidden]")).toHaveLength(0);
      expect(textosDaTela(container!.innerHTML)).toEqual([]);
      expect(container!.querySelector("[aria-live], [role], [tabindex]")).toBeNull();
    }
    for (const resultado of ["ok", "erro"] as const) {
      montar({ lugar: "linha", ativa: false, resultado });
      expect(barra()?.getAttribute("aria-hidden"), resultado).toBe("true");
    }
  });

  it("na linha da lista, o axe não acusa nada", async () => {
    const html = renderToStaticMarkup(
      <ul>
        <li className="relative">
          Pedido 1042
          <BarraDeEspera lugar="linha" ativa={false} resultado="ok" />
        </li>
      </ul>,
    );
    expect(html).toContain('aria-hidden="true"');
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("o desenho e o movimento, no index.css", () => {
  it("na borda de baixo da linha (4 px; 6 no celular) e no topo do cartão (3 px; 4 no celular), em tinta", () => {
    const base = declaradas(".carregando-barra", COMPONENTES);
    expect(base.get("position")).toBe("absolute");
    expect(base.get("overflow")).toBe("hidden");
    expect(base.get("pointer-events")).toBe("none");
    expect(base.get("color")).toBe("hsl(var(--carregando-cor))");
    expect(base.get("animation")).toBe("carregando-barra-entra var(--carregando-t-entrada) var(--ease-carregando-entrada) both");
    const linha = declaradas('.carregando-barra[data-lugar="linha"]', COMPONENTES);
    expect(linha.get("bottom")).toBe("0");
    expect(linha.get("block-size")).toBe("var(--carregando-barra-linha)");
    expect(linha.get("transform-origin")).toBe("50% 100%");
    const topo = declaradas('.carregando-barra[data-lugar="topo"]', COMPONENTES);
    expect(topo.get("top")).toBe("0");
    expect(topo.get("block-size")).toBe("var(--carregando-barra-topo)");
    expect(topo.get("transform-origin")).toBe("50% 0");
  });

  it("o trilho a 8%, o segmento de 32% varrendo só por transform, e parada inteira a 0,6", () => {
    expect(declaradas('.carregando-barra > [data-parte="trilho"]', COMPONENTES).get("opacity")).toBe("0.08");
    const segmento = declaradas('.carregando-barra > [data-parte="segmento"]', COMPONENTES);
    expect(segmento.get("inline-size")).toBe("32%");
    expect(segmento.get("animation")).toBe("carregando-varre var(--carregando-t-varredura) var(--ease-carregando-padrao) infinite");
    expect(Object.fromEntries(declaradas('.carregando-barra[data-estado="parada"] > [data-parte="cheio"]', COMPONENTES))).toEqual({
      transform: "none",
      opacity: "0.6",
    });
    expect(quadros("carregando-varre")).toEqual([
      ["from", "transform: translateX(-100%)"],
      ["to", "transform: translateX(312.5%)"],
    ]);
  });

  it("entra em 150 ms (escala vertical de 0,25 e opacidade) e completa em 220 ms por scaleX: verde no ok, crítico no erro", () => {
    expect(quadros("carregando-barra-entra")).toEqual([["from", "opacity: 0; transform: scaleY(0.25)"]]);
    expect(quadros("carregando-barra-completa")).toEqual([["from", "transform: scaleX(0)"]]);
    expect(declaradas(":root").get("--carregando-t-barra-completa")).toBe("220ms");
    for (const [estado, cor] of [
      ["ok", "hsl(var(--carregando-ok))"],
      ["erro", "hsl(var(--carregando-erro))"],
    ]) {
      const cheio = declaradas(`.carregando-barra[data-estado="${estado}"] > [data-parte="cheio"]`, COMPONENTES);
      expect(cheio.get("background-color"), estado).toBe(cor);
      expect(cheio.get("transform"), estado).toBe("none");
      expect(cheio.get("opacity"), estado).toBe("1");
      expect(cheio.get("animation"), estado).toBe("carregando-barra-completa var(--carregando-t-barra-completa) var(--ease-carregando-padrao) both");
    }
    const cheio = declaradas('.carregando-barra > [data-parte="cheio"]', COMPONENTES);
    expect(cheio.get("transform")).toBe("scaleX(0)");
    expect(cheio.get("transform-origin")).toBe("0 50%");
    const progresso = declaradas('.carregando-barra[data-estado="progresso"] > [data-parte="cheio"]', COMPONENTES);
    expect(progresso.get("transform")).toBe("scaleX(var(--p, 0))");
  });

  it("movimento reduzido: só opacidade na entrada, sem varredura, parada inteira a 0,6 desde o início e o verde de uma vez", () => {
    expect(declaradas(".carregando-barra", REDUZIDO).get("animation-name")).toBe("carregando-aparece");
    expect(declaradas('.carregando-barra > [data-parte="segmento"]', REDUZIDO).get("display")).toBe("none");
    expect(Object.fromEntries(declaradas('.carregando-barra[data-estado="andamento"] > [data-parte="cheio"]', REDUZIDO))).toEqual({
      transform: "none",
      opacity: "0.6",
    });
    expect(declaradas('.carregando-barra[data-estado="progresso"] > [data-parte="cheio"]', REDUZIDO).get("transition")).toBe("none");
    expect(declaradas(":root", ["@media (prefers-reduced-motion: reduce)"]).get("--carregando-t-barra-completa")).toBe("0ms");
    expect(quadros("carregando-aparece")).toEqual([["from", "opacity: 0"]]);
  });
});
