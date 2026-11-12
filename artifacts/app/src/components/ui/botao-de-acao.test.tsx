// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import axe from "axe-core";
import { Check } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERVALO_DO_TOQUE_MS } from "@/lib/campo/toque-unico";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { BotaoDeAcao, FIM_DA_TROCA_MS, type BotaoDeAcaoProps, type EstadoDaAcao } from "./botao-de-acao";

/**
 * O botão de ação do carregamento v2 (aprovado em 12/11/2026, seção 5.4 e
 * momento 3): repouso, em andamento, sucesso, erro e sem resposta, com a
 * largura do rótulo mais largo. As camadas ficam empilhadas na mesma célula da
 * grade e só a atual fica visível e na árvore de acessibilidade. O toque afunda
 * o botão e trava o segundo; aos 300 ms entram o indicador e o gerúndio, com
 * aria-busy; nunca disabled durante a ação.
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
const REDUZIDO_NOS_COMPONENTES = ["@layer components", "@media (prefers-reduced-motion: reduce)"];
const raiz = declaradas(":root");
const raizReduzida = declaradas(":root", ["@media (prefers-reduced-motion: reduce)"]);
const ms = (valor: string | undefined) => Number.parseFloat(valor ?? "");

const TEXTOS = {
  rotulo: "Aprovar",
  andamento: "Aprovando…",
  sucesso: "Aprovado",
  erro: "Não aprovado",
  conferir: "Conferir",
} as const;

const PERMITIDOS = Object.values(TEXTOS);

const ROTULO_DE: Record<EstadoDaAcao, string> = {
  repouso: TEXTOS.rotulo,
  andamento: TEXTOS.andamento,
  sucesso: TEXTOS.sucesso,
  erro: TEXTOS.erro,
  "sem-resposta": TEXTOS.conferir,
};

let reacao: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  reacao = createRoot(container);
});

afterEach(() => {
  act(() => reacao?.unmount());
  container?.remove();
  reacao = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function montar(estado: EstadoDaAcao, extra: Partial<BotaoDeAcaoProps> = {}) {
  act(() =>
    reacao!.render(
      <BotaoDeAcao
        estado={estado}
        icone={<Check />}
        rotulo={TEXTOS.rotulo}
        andamento={TEXTOS.andamento}
        sucesso={TEXTOS.sucesso}
        erro={TEXTOS.erro}
        conferir={TEXTOS.conferir}
        {...extra}
      />,
    ),
  );
}

function passar(tempo: number) {
  act(() => {
    vi.advanceTimersByTime(tempo);
  });
}

function botao(): HTMLButtonElement {
  const achado = container!.querySelector("button");
  if (!achado) throw new Error("sem o botão");
  return achado;
}

/** O nome acessível do botão, calculado pelo axe-core. */
function nome(): string {
  axe.setup(document);
  try {
    return (axe as unknown as { commons: { text: { accessibleText(no: Element): string } } }).commons.text.accessibleText(botao());
  } finally {
    axe.teardown();
  }
}

function camadas(): HTMLElement[] {
  return Array.from(botao().querySelectorAll<HTMLElement>(".botao-acao-camada"));
}

/** As camadas que ficam na árvore de acessibilidade (sem aria-hidden). */
function camadasNaArvore(): string[] {
  return camadas()
    .filter((camada) => camada.getAttribute("aria-hidden") !== "true")
    .map((camada) => camada.dataset.camada ?? "");
}

function clicar() {
  act(() => {
    botao().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Leva o botão até o estado dado pelo caminho de verdade: o em andamento aparece aos 300 ms e fica 500 ms. */
function chegarEm(estado: EstadoDaAcao, extra: Partial<BotaoDeAcaoProps> = {}) {
  montar("repouso", extra);
  if (estado === "repouso") return;
  montar("andamento", extra);
  passar(CARREGANDO.atrasoMs);
  if (estado === "andamento") return;
  passar(CARREGANDO.minimoMs);
  montar(estado, extra);
  passar(0);
}

const ESTADOS: EstadoDaAcao[] = ["repouso", "andamento", "sucesso", "erro", "sem-resposta"];

describe("só o rótulo atual na árvore", () => {
  it.each(ESTADOS)("%s: o nome é o rótulo do estado, e as outras camadas ficam escondidas", (estado) => {
    chegarEm(estado);
    expect(nome()).toBe(ROTULO_DE[estado]);
    expect(camadasNaArvore()).toEqual([estado]);
    for (const camada of camadas()) {
      const atual = camada.dataset.camada === estado;
      expect(camada.hasAttribute("data-atual"), camada.dataset.camada).toBe(atual);
      if (!atual) expect(camada.getAttribute("aria-hidden"), camada.dataset.camada).toBe("true");
    }
  });

  it("as camadas escondidas não aparecem: visibility hidden, e a atual herda a do botão", () => {
    const camada = declaradas(".botao-acao-camada", COMPONENTES);
    expect(camada.get("visibility")).toBe("hidden");
    expect(camada.get("opacity")).toBe("0");
    const atual = declaradas(".botao-acao-camada[data-atual]", COMPONENTES);
    expect(atual.get("visibility")).toBe("inherit");
    expect(atual.get("opacity")).toBe("1");
  });
});

describe("a largura do rótulo mais largo", () => {
  it.each(ESTADOS)("%s: as cinco camadas estão no botão, na mesma célula da grade", (estado) => {
    chegarEm(estado);
    expect(camadas().map((camada) => camada.dataset.camada)).toEqual(ESTADOS);
    expect(botao().classList.contains("inline-grid")).toBe(true);
    expect(botao().classList.contains("inline-flex")).toBe(false);
  });

  it("todas as camadas ficam na célula 1/1, e os fundos não ocupam lugar", () => {
    expect(declaradas(".botao-acao-camada", COMPONENTES).get("grid-area")).toBe("1 / 1");
    const recorte = declaradas(".botao-acao > [data-recorte]", COMPONENTES);
    expect(recorte.get("position")).toBe("absolute");
    expect(recorte.get("pointer-events")).toBe("none");
    expect(recorte.get("z-index")).toBe("-1");
    expect(recorte.get("overflow")).toBe("hidden");
    expect(declaradas(".botao-acao [data-fundo]", COMPONENTES).get("position")).toBe("absolute");
  });
});

describe("em andamento", () => {
  it("o toque afunda o botão na hora; aos 300 ms entram o indicador e o gerúndio, com aria-busy", () => {
    montar("repouso");
    montar("andamento");
    expect(botao().hasAttribute("data-afundado")).toBe(true);
    expect(botao().getAttribute("aria-disabled")).toBe("true");
    expect(botao().hasAttribute("aria-busy")).toBe(false);
    expect(nome()).toBe(TEXTOS.rotulo);
    expect(botao().querySelector("[data-spinner]")).toBeNull();
    passar(CARREGANDO.atrasoMs - 1);
    expect(nome()).toBe(TEXTOS.rotulo);
    passar(1);
    expect(botao().hasAttribute("data-afundado")).toBe(false);
    expect(botao().getAttribute("aria-busy")).toBe("true");
    expect(nome()).toBe(TEXTOS.andamento);
    const indicador = botao().querySelector<HTMLElement>("[data-spinner]");
    expect(indicador?.closest(".botao-acao-camada")?.getAttribute("data-camada")).toBe("andamento");
    expect(indicador?.getAttribute("data-tamanho")).toBe("16");
    expect(indicador?.getAttribute("aria-hidden")).toBe("true");
  });

  it("no tamanho grande, o indicador é o de 20 px", () => {
    chegarEm("andamento", { size: "lg" });
    expect(botao().querySelector("[data-spinner]")?.getAttribute("data-tamanho")).toBe("20");
  });

  it("depois do aviso de 10 s, a volta calma", () => {
    chegarEm("andamento");
    expect(botao().querySelector("[data-spinner]")?.hasAttribute("data-calmo")).toBe(false);
    passar(CARREGANDO.demoraMs);
    expect(botao().querySelector("[data-spinner]")?.hasAttribute("data-calmo")).toBe(true);
  });

  it("fica pelo menos 500 ms na tela antes do resultado", () => {
    chegarEm("andamento");
    passar(100);
    montar("sucesso");
    expect(nome()).toBe(TEXTOS.andamento);
    passar(CARREGANDO.minimoMs - 100 - 1);
    expect(nome()).toBe(TEXTOS.andamento);
    passar(1);
    expect(nome()).toBe(TEXTOS.sucesso);
  });

  it("a ação que volta antes de 300 ms não mostra o em andamento", () => {
    montar("repouso");
    montar("andamento");
    passar(200);
    montar("sucesso");
    expect(nome()).toBe(TEXTOS.sucesso);
    passar(1_000);
    expect(nome()).toBe(TEXTOS.sucesso);
    expect(botao().hasAttribute("aria-busy")).toBe(false);
  });

  it("o indicador sai da árvore do DOM depois da troca, para não girar escondido", () => {
    chegarEm("sucesso");
    passar(FIM_DA_TROCA_MS);
    expect(botao().querySelector("[data-spinner]")).toBeNull();
  });
});

describe("ocupado não é desabilitado", () => {
  it.each(ESTADOS)("%s: nunca disabled", (estado) => {
    chegarEm(estado);
    expect(botao().hasAttribute("disabled")).toBe(false);
    expect(botao().disabled).toBe(false);
  });

  it("em andamento: aria-busy e aria-disabled, e o foco fica no botão", () => {
    montar("repouso");
    botao().focus();
    montar("andamento");
    passar(CARREGANDO.atrasoMs);
    expect(botao().getAttribute("aria-busy")).toBe("true");
    expect(botao().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(botao());
  });

  it("no repouso, no erro e sem resposta, nem aria-busy nem aria-disabled", () => {
    for (const estado of ["repouso", "erro", "sem-resposta"] as const) {
      chegarEm(estado);
      expect(botao().hasAttribute("aria-busy"), estado).toBe(false);
      expect(botao().hasAttribute("aria-disabled"), estado).toBe(false);
    }
  });

  it("bloqueado (o Recusar da linha que aprova): aria-disabled a 0,45, sem disabled e sem chamar", () => {
    const aoClicar = vi.fn();
    montar("repouso", { bloqueado: true, onClick: aoClicar });
    expect(botao().getAttribute("aria-disabled")).toBe("true");
    expect(botao().hasAttribute("disabled")).toBe(false);
    expect(botao().classList.contains("opacity-45")).toBe(true);
    clicar();
    expect(aoClicar).not.toHaveBeenCalled();
  });
});

describe("o segundo toque", () => {
  it("dois cliques antes de a tela mudar chamam uma vez só", () => {
    const aoClicar = vi.fn();
    montar("repouso", { onClick: aoClicar });
    clicar();
    clicar();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("em andamento e no sucesso o clique não chama de novo", () => {
    const aoClicar = vi.fn();
    montar("repouso", { onClick: aoClicar });
    clicar();
    montar("andamento", { onClick: aoClicar });
    passar(INTERVALO_DO_TOQUE_MS);
    clicar();
    passar(CARREGANDO.atrasoMs);
    clicar();
    montar("sucesso", { onClick: aoClicar });
    passar(CARREGANDO.minimoMs);
    expect(nome()).toBe(TEXTOS.sucesso);
    clicar();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("o clique travado não envia o formulário", () => {
    chegarEm("andamento", { type: "submit" });
    const evento = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      botao().dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(true);
  });

  it("sem resposta, Conferir chama a ação, uma vez", () => {
    const aoClicar = vi.fn();
    chegarEm("sem-resposta", { onClick: aoClicar });
    clicar();
    clicar();
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});

describe("o fim também é um estado", () => {
  it("sucesso: a caixa fechada, com o miolo e o check vazado desenhado uma vez", () => {
    chegarEm("sucesso");
    const camada = botao().querySelector('.botao-acao-camada[data-camada="sucesso"]')!;
    const caixa = camada.querySelector("svg.botao-acao-caixa")!;
    expect(caixa.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(caixa.querySelectorAll("path")).map((parte) => parte.getAttribute("data-parte"))).toEqual(["contorno", "miolo", "check"]);
    expect(caixa.querySelector('[data-parte="check"]')?.getAttribute("pathLength")).toBe("1");
    const check = declaradas('.botao-acao-caixa > [data-parte="check"]', COMPONENTES);
    expect(check.get("stroke")).toBe("hsl(var(--carregando-ok))");
    expect(check.get("stroke-dasharray")).toBe("1");
    expect(check.get("stroke-dashoffset")).toBe("1");
    expect(botao().querySelector('[data-fundo="onda"]')?.getAttribute("data-cor")).toBe("ok");
  });

  it("erro: a caixa com o \"!\" e o fundo crítico suave com a borda", () => {
    chegarEm("erro");
    const camada = botao().querySelector('.botao-acao-camada[data-camada="erro"]')!;
    expect(Array.from(camada.querySelectorAll("svg.botao-acao-caixa path")).map((parte) => parte.getAttribute("data-parte"))).toEqual([
      "contorno",
      "marca",
    ]);
    expect(botao().querySelector('[data-fundo="onda"]')?.getAttribute("data-cor")).toBe("erro");
    expect(botao().querySelector('[data-fundo="borda"]')?.getAttribute("data-cor")).toBe("erro");
    expect(declaradas('.botao-acao [data-fundo="onda"][data-cor="erro"]', COMPONENTES).get("background-color")).toBe(
      "hsl(var(--destructive-soft))",
    );
    expect(declaradas('.botao-acao [data-fundo="borda"][data-cor="erro"]', COMPONENTES).get("border-color")).toBe(
      "hsl(var(--destructive-soft-border))",
    );
    expect(declaradas('.botao-acao-camada[data-camada="erro"]', COMPONENTES).get("color")).toBe("hsl(var(--carregando-erro))");
  });

  it("sem resposta: Conferir, secundário, em tinta", () => {
    chegarEm("sem-resposta");
    expect(botao().querySelector('[data-fundo="borda"]')?.getAttribute("data-cor")).toBe("conferir");
    const borda = declaradas('.botao-acao [data-fundo="borda"][data-cor="conferir"]', COMPONENTES);
    expect(borda.get("background-color")).toBe("hsl(var(--card))");
    expect(borda.get("border-color")).toBe("hsl(var(--border))");
    expect(declaradas('.botao-acao-camada[data-camada="sem-resposta"]', COMPONENTES).get("color")).toBe("hsl(var(--foreground))");
  });

  it("quando o fundo do fim já cobre, o botão fica sem o fundo e a borda da variante", () => {
    chegarEm("erro", { variant: "destructive" });
    expect(botao().hasAttribute("data-borda")).toBe(true);
    // Na troca, o fundo da variante ainda aparece onde a onda não chegou.
    expect(botao().hasAttribute("data-cobre")).toBe(false);
    expect(botao().classList.contains("bg-card")).toBe(true);
    passar(FIM_DA_TROCA_MS);
    expect(botao().hasAttribute("data-cobre")).toBe(true);
    for (const classe of ["bg-transparent", "border-transparent", "hover:bg-transparent", "active:bg-transparent"]) {
      expect(botao().classList.contains(classe), classe).toBe(true);
    }
    expect(botao().classList.contains("bg-card")).toBe(false);
    expect(botao().classList.contains("border-destructive/40")).toBe(false);
    // De volta ao repouso, o fundo da variante volta.
    montar("repouso", { variant: "destructive" });
    expect(botao().hasAttribute("data-cobre")).toBe(false);
    expect(botao().classList.contains("bg-card")).toBe(true);
  });

  it("o recorte dos fundos cobre a borda das variantes que a têm; o toque fica dentro dela", () => {
    expect(declaradas(".botao-acao > [data-recorte]", COMPONENTES).get("inset")).toBe("calc(-1 * var(--botao-acao-borda))");
    expect(declaradas(".botao-acao", COMPONENTES).get("--botao-acao-borda")).toBe("0px");
    expect(declaradas(".botao-acao[data-borda]", COMPONENTES).get("--botao-acao-borda")).toBe("1px");
    expect(declaradas('.botao-acao [data-fundo="toque"]', COMPONENTES).get("inset")).toBe("var(--botao-acao-borda)");
    for (const variant of ["secondary", "outline", "destructive"] as const) {
      montar("repouso", { variant });
      expect(botao().hasAttribute("data-borda"), variant).toBe(true);
    }
    for (const variant of ["default", "ghost"] as const) {
      montar("repouso", { variant });
      expect(botao().hasAttribute("data-borda"), variant).toBe(false);
    }
  });

  it("sem os rótulos do fim, ficam o do repouso e o Conferir", () => {
    montar("sem-resposta", { sucesso: undefined, erro: undefined, conferir: undefined });
    expect(nome()).toBe("Conferir");
    const textos = camadas().map((camada) => camada.textContent);
    expect(textos).toEqual([TEXTOS.rotulo, TEXTOS.andamento, TEXTOS.rotulo, TEXTOS.rotulo, "Conferir"]);
  });
});

describe("acessibilidade e textos", () => {
  it.each(ESTADOS)("%s: axe sem violação", async (estado) => {
    chegarEm(estado);
    const html = container!.innerHTML;
    // O axe-core espera pelos próprios timers.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it.each(ESTADOS)("%s: só os textos da lista, com as camadas escondidas também", (estado) => {
    chegarEm(estado);
    expect(textosForaDaLista(container!.innerHTML, PERMITIDOS)).toEqual([]);
    expect(textosDaTela(container!.innerHTML)).toEqual(PERMITIDOS);
  });
});

describe("a troca de rótulo em sequência, nunca sobreposta", () => {
  it("quem sai some em 80 ms e só então quem entra aparece, em 150 ms", () => {
    expect(raiz.get("--carregando-t-troca-sai")).toBe("80ms");
    expect(raiz.get("--carregando-t-troca-entra")).toBe("150ms");
    const sai = declaradas(".botao-acao > .botao-acao-camada[data-sai]", COMPONENTES);
    expect(sai.get("animation")).toBe(
      "carregando-troca-sai var(--carregando-t-troca-sai) var(--ease-carregando-saida) var(--botao-acao-espera) both",
    );
    // Visível até o fim da saída, e só então fora da tela.
    expect(sai.get("transition")).toBe("visibility 0s linear calc(var(--botao-acao-espera) + var(--carregando-t-troca-sai))");
    const entra = declaradas(".botao-acao[data-de] > .botao-acao-camada[data-atual]", COMPONENTES);
    expect(entra.get("animation")).toBe(
      "carregando-troca-entra var(--carregando-t-troca-entra) var(--ease-carregando-entrada) calc(var(--botao-acao-espera) + var(--carregando-t-troca-sai)) both",
    );
    // O começo explícito: por baixo, a camada que sai já está escondida (opacity 0).
    expect(quadros("carregando-troca-sai")).toEqual([
      ["from", "opacity: 1; transform: none"],
      ["to", "opacity: 0; transform: translateY(-3px)"],
    ]);
    expect(quadros("carregando-troca-entra")).toEqual([["from", "opacity: 0; transform: translateY(3px)"]]);
  });

  it("a troca marca quem sai e quem entra, e a marca sai quando a troca acaba", () => {
    chegarEm("andamento");
    expect(botao().getAttribute("data-de")).toBe("repouso");
    expect(botao().querySelector('.botao-acao-camada[data-sai]')?.getAttribute("data-camada")).toBe("repouso");
    passar(FIM_DA_TROCA_MS);
    expect(botao().hasAttribute("data-de")).toBe(false);
    expect(botao().querySelector(".botao-acao-camada[data-sai]")).toBeNull();
  });

  it("na primeira pintura nada entra: a camada só anima depois de uma troca", () => {
    montar("erro");
    expect(botao().hasAttribute("data-de")).toBe(false);
  });
});

describe("o tempo do fim", () => {
  it("o sucesso leva 520 ms: o contorno completa (200 ms), a onda cobre (300 ms) e o check entra com a mola", () => {
    expect(raiz.get("--carregando-t-sucesso")).toBe("520ms");
    expect(raiz.get("--carregando-t-contorno")).toBe("200ms");
    expect(raiz.get("--carregando-t-onda")).toBe("300ms");
    expect(raiz.get("--carregando-t-check")).toBe("200ms");
    expect(raiz.get("--carregando-t-miolo")).toBe(
      "calc(var(--carregando-t-sucesso) - var(--carregando-t-contorno) - var(--carregando-t-troca-sai))",
    );
    expect(declaradas('.botao-acao[data-camada="sucesso"][data-de="andamento"]', COMPONENTES).get("--botao-acao-espera")).toBe(
      "var(--carregando-t-contorno)",
    );
    const miolo = declaradas('.botao-acao[data-de] > .botao-acao-camada[data-atual] [data-parte="miolo"]', COMPONENTES);
    expect(miolo.get("animation")).toBe(
      "carregando-miolo var(--carregando-t-miolo) var(--carregando-mola) calc(var(--botao-acao-espera) + var(--carregando-t-troca-sai)) both",
    );
    expect(quadros("carregando-miolo")).toEqual([["from", "transform: scale(0.6)"]]);
    const check = declaradas('.botao-acao[data-de] > .botao-acao-camada[data-atual] [data-parte="check"]', COMPONENTES);
    expect(check.get("transition")).toBe(
      "stroke-dashoffset var(--carregando-t-check) var(--ease-carregando-entrada) calc(var(--botao-acao-espera) + var(--carregando-t-troca-sai))",
    );
  });

  it("a onda nasce da caixa e cobre o botão, só por scale", () => {
    const onda = declaradas('.botao-acao [data-fundo="onda"]', COMPONENTES);
    expect(onda.get("left")).toBe("var(--botao-acao-onda-x, 50%)");
    expect(onda.get("inline-size")).toBe("300%");
    expect(onda.get("transform")).toBe("scale(0)");
    expect(declaradas('.botao-acao [data-fundo="onda"][data-cor="ok"]', COMPONENTES).get("background-color")).toBe(
      "hsl(var(--carregando-ok))",
    );
    expect(quadros("carregando-onda")).toEqual([["from", "transform: scale(0)"]]);
  });

  it("saindo do fim, a onda volta para a caixa, sem esmaecer por cima do vermelho, e o fundo da variante volta de uma vez", () => {
    expect(declaradas('.botao-acao[data-de] [data-fundo="onda"][data-sai]', COMPONENTES).get("animation")).toBe(
      "carregando-onda-volta var(--carregando-t-troca-entra) var(--ease-carregando-saida) both",
    );
    expect(quadros("carregando-onda-volta")).toEqual([
      ["from", "transform: none"],
      ["to", "transform: scale(0)"],
    ]);
    chegarEm("sucesso");
    passar(FIM_DA_TROCA_MS);
    expect(botao().classList.contains("transition-colors")).toBe(true);
    montar("repouso");
    const onda = botao().querySelector('[data-fundo="onda"]')!;
    expect(onda.getAttribute("data-cor")).toBe("ok");
    expect(onda.hasAttribute("data-sai")).toBe(true);
    expect(botao().classList.contains("transition-none")).toBe(true);
    expect(botao().classList.contains("transition-colors")).toBe(false);
    passar(FIM_DA_TROCA_MS);
    expect(onda.hasAttribute("data-cor")).toBe(false);
    expect(botao().classList.contains("transition-colors")).toBe(true);
  });

  it("o erro: a onda clara de 300 ms e o tremor de 3 px em 240 ms", () => {
    expect(raiz.get("--carregando-t-tremor")).toBe("240ms");
    expect(declaradas('.botao-acao[data-de][data-camada="erro"]', COMPONENTES).get("animation")).toBe(
      "carregando-tremor var(--carregando-t-tremor) var(--ease-carregando-padrao) var(--carregando-t-onda) both",
    );
    expect(quadros("carregando-tremor")).toEqual([
      ["25%", "transform: translateX(-3px)"],
      ["50%", "transform: translateX(3px)"],
      ["75%", "transform: translateX(-2px)"],
    ]);
  });

  it("o toque afunda (escala 0,97) em 100 ms", () => {
    for (const seletor of ['.botao-acao[data-afundado][data-camada]', '.botao-acao:active:not([aria-disabled="true"])']) {
      expect(declaradas(seletor, COMPONENTES).get("animation"), seletor).toBe(
        "carregando-afunda var(--carregando-t-toque) var(--ease-carregando-entrada) both",
      );
    }
    expect(quadros("carregando-afunda")).toEqual([["to", "transform: scale(0.97)"]]);
  });

  it("a troca acaba antes de a marca sair: o tempo mais longo cabe no FIM_DA_TROCA_MS", () => {
    const sucesso = ms(raiz.get("--carregando-t-sucesso"));
    const erro = ms(raiz.get("--carregando-t-onda")) + ms(raiz.get("--carregando-t-tremor"));
    expect(Math.max(sucesso, erro)).toBeLessThan(FIM_DA_TROCA_MS);
  });
});

describe("o movimento reduzido", () => {
  it("sem afundar, sem onda, sem tremor e sem deslize: as camadas trocam de uma vez e a caixa aparece pronta", () => {
    expect(raizReduzida.get("--carregando-t-troca-sai")).toBe("0ms");
    expect(raizReduzida.get("--carregando-t-troca-entra")).toBe("0ms");
    expect(raizReduzida.get("--carregando-t-sucesso")).toBe("0ms");
    for (const nome of ["--carregando-t-contorno", "--carregando-t-onda", "--carregando-t-check", "--carregando-t-tremor"]) {
      expect(raizReduzida.get(nome), nome).toBe("0ms");
    }
    for (const seletor of [
      '.botao-acao[data-afundado][data-camada]',
      '.botao-acao:active:not([aria-disabled="true"])',
      ".botao-acao[data-de][data-camada]",
    ]) {
      expect(declaradas(seletor, REDUZIDO_NOS_COMPONENTES).get("animation"), seletor).toBe("none");
    }
  });
});
