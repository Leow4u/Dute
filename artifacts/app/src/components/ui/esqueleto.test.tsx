// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import {
  BRILHO_MS,
  CICLOS_DO_BRILHO,
  CartaoComBrilho,
  DEFASAGEM_DO_BRILHO_MS,
  Esqueleto,
  ORDEM_MAXIMA_DO_BRILHO,
  type FormaDoEsqueleto,
} from "./esqueleto";

/**
 * O esqueleto do carregamento v2 (aprovado em 12/11/2026, seção 5.2 e
 * momento 2): blocos neutros com a anatomia da linha real, sempre fora da
 * árvore de acessibilidade, e o brilho de uma faixa por cartão que faz dois
 * ciclos e para. No lugar do `bg-primary/10 animate-pulse`, rosado na v3.
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
const FORMAS: FormaDoEsqueleto[] = ["texto", "icone", "botao", "contagem", "bloco"];

function elemento(html: string, seletor: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  const achado = host.querySelector<HTMLElement>(seletor);
  if (!achado) throw new Error(`sem ${seletor}`);
  return achado;
}

describe("o bloco do esqueleto", () => {
  it("as cinco formas são blocos neutros, sem o rosado nem o pulso antigo", () => {
    for (const forma of FORMAS) {
      const html = renderToStaticMarkup(<Esqueleto forma={forma} />);
      const bloco = elemento(html, "[data-esqueleto]");
      expect(bloco.tagName, forma).toBe("SPAN");
      expect(bloco.getAttribute("data-forma"), forma).toBe(forma);
      expect(bloco.classList.contains("carregando-esqueleto"), forma).toBe(true);
      expect(html, forma).not.toContain("bg-primary");
      expect(html, forma).not.toContain("animate-pulse");
    }
  });

  it("sem forma, é o bloco, que quem usa dimensiona", () => {
    const bloco = elemento(renderToStaticMarkup(<Esqueleto className="h-20 w-1/2" />), "[data-esqueleto]");
    expect(bloco.getAttribute("data-forma")).toBe("bloco");
    expect(bloco.classList.contains("h-20")).toBe(true);
    expect(bloco.classList.contains("w-1/2")).toBe(true);
  });

  it("todas as formas ficam fora da árvore de acessibilidade", async () => {
    for (const forma of FORMAS) {
      const html = renderToStaticMarkup(<Esqueleto forma={forma} />);
      expect(elemento(html, "[data-esqueleto]").getAttribute("aria-hidden"), forma).toBe("true");
    }
    const linha = renderToStaticMarkup(
      <ul>
        <li>
          Para aprovar <Esqueleto forma="contagem" />
        </li>
      </ul>,
    );
    expect(await violacoesDeAcessibilidade(linha)).toEqual([]);
  });

  it("a cor é o --carregando-esqueleto (claro, v3 e escuro), com o raio 6 dos blocos", () => {
    const base = declaradas(".carregando-esqueleto", COMPONENTES);
    expect(base.get("background-color")).toBe("hsl(var(--carregando-esqueleto))");
    expect(base.get("border-radius")).toBe("6px");
    expect(base.get("display")).toBe("block");
  });

  it("as medidas da seção 4.2: título de 14 px, ícone de 44 com raio 12, botão de 40 com raio 10, número de 16 × 12 com raio 4", () => {
    const forma = (nome: FormaDoEsqueleto) => declaradas(`.carregando-esqueleto[data-forma="${nome}"]`, COMPONENTES);
    expect(Object.fromEntries(forma("texto"))).toEqual({ "block-size": "14px" });
    expect(Object.fromEntries(forma("icone"))).toEqual({ flex: "none", "inline-size": "44px", "block-size": "44px", "border-radius": "12px" });
    expect(Object.fromEntries(forma("botao"))).toEqual({ flex: "none", "block-size": "40px", "border-radius": "10px" });
    expect(Object.fromEntries(forma("contagem"))).toEqual({
      display: "inline-block",
      flex: "none",
      "inline-size": "16px",
      "block-size": "12px",
      "border-radius": "4px",
      "vertical-align": "middle",
    });
    // O bloco é só o da base: quem usa dá o tamanho.
    expect(forma("bloco").size).toBe(0);
  });

  it("na barra preta da v3, os blocos ficam no branco a 12%", () => {
    for (const seletor of [".carregando-sobre-preto .carregando-esqueleto", ".bg-v3-header .carregando-esqueleto"]) {
      expect(declaradas(seletor, COMPONENTES).get("background-color"), seletor).toBe("var(--carregando-esqueleto-preto)");
    }
  });
});

describe("o cartão com o brilho", () => {
  it("guarda os filhos e põe a ordem para a defasagem entre cartões", () => {
    const html = renderToStaticMarkup(
      <CartaoComBrilho ordem={2} className="rounded-lg border">
        <Esqueleto forma="icone" />
        <Esqueleto forma="texto" className="w-2/5" />
      </CartaoComBrilho>,
    );
    const cartao = elemento(html, "[data-brilho]");
    expect(cartao.tagName).toBe("DIV");
    expect(cartao.classList.contains("carregando-com-brilho")).toBe(true);
    expect(cartao.classList.contains("rounded-lg")).toBe(true);
    expect(cartao.style.getPropertyValue("--ordem")).toBe("2");
    expect(cartao.querySelectorAll("[data-esqueleto]")).toHaveLength(2);
    expect(html).not.toContain("animate-pulse");
  });

  it("sem ordem, é o primeiro; a ordem é um inteiro de 0 em diante", () => {
    const ordem = (valor?: number) =>
      elemento(renderToStaticMarkup(<CartaoComBrilho ordem={valor} />), "[data-brilho]").style.getPropertyValue("--ordem");
    expect(ordem()).toBe("0");
    expect(ordem(1)).toBe("1");
    expect(ordem(2.7)).toBe("2");
    expect(ordem(-1)).toBe("0");
    expect(ordem(Number.NaN)).toBe("0");
  });

  it("a defasagem nunca leva o brilho além dos 5 s: do décimo cartão em diante, a ordem é a do nono", () => {
    const ordem = (valor: number) =>
      elemento(renderToStaticMarkup(<CartaoComBrilho ordem={valor} />), "[data-brilho]").style.getPropertyValue("--ordem");
    expect(ordem(8)).toBe("8");
    expect(ordem(9)).toBe("8");
    // Com 40 × 120 ms, a faixa só começaria aos 4,8 s e andaria até os 8,4 s.
    expect(ordem(40)).toBe("8");
    // A última ordem com os dois ciclos inteiros dentro dos 5 s do movimento decorativo.
    expect(ORDEM_MAXIMA_DO_BRILHO).toBe(8);
    expect(CICLOS_DO_BRILHO * BRILHO_MS + ORDEM_MAXIMA_DO_BRILHO * DEFASAGEM_DO_BRILHO_MS).toBeLessThanOrEqual(CARREGANDO.movimentoMaxMs);
    expect(CICLOS_DO_BRILHO * BRILHO_MS + (ORDEM_MAXIMA_DO_BRILHO + 1) * DEFASAGEM_DO_BRILHO_MS).toBeGreaterThan(CARREGANDO.movimentoMaxMs);
  });

  it("uma faixa por cartão, inclinada a 20°, na cor do cartão a 60%, que só anda por transform", () => {
    const cartao = declaradas(".carregando-com-brilho", COMPONENTES);
    expect(cartao.get("position")).toBe("relative");
    expect(cartao.get("overflow")).toBe("hidden");
    expect(cartao.get("isolation")).toBe("isolate");
    const faixa = declaradas(".carregando-com-brilho::after", COMPONENTES);
    expect(faixa.get("content")).toBe('""');
    expect(faixa.get("pointer-events")).toBe("none");
    expect(faixa.get("background")).toBe("linear-gradient(90deg, transparent, var(--carregando-brilho) 50%, transparent)");
    expect(faixa.get("transform")).toBe("translateX(-130%) skewX(-20deg)");
    // Parada, a faixa não aparece: num bloco alto e estreito, a ponta inclinada sobraria no canto.
    expect(faixa.get("opacity")).toBe("0");
    expect(faixa.has("will-change")).toBe(false);
  });

  it("o brilho faz dois ciclos de 2 s e para, com 120 ms entre um cartão e outro", () => {
    expect(CICLOS_DO_BRILHO).toBe(2);
    expect(BRILHO_MS).toBe(2000);
    expect(DEFASAGEM_DO_BRILHO_MS).toBe(120);
    const faixa = declaradas(".carregando-com-brilho::after", COMPONENTES);
    expect(faixa.get("animation")).toBe(
      `carregando-brilho var(--carregando-t-brilho) var(--ease-carregando-padrao) ${CICLOS_DO_BRILHO}`,
    );
    expect(faixa.get("animation")).not.toContain("infinite");
    expect(faixa.get("animation-delay")).toBe(`calc(var(--ordem, 0) * ${DEFASAGEM_DO_BRILHO_MS}ms)`);
    expect(declaradas(":root").get("--carregando-t-brilho")).toBe(`${BRILHO_MS}ms`);
    // Com até cinco cartões, o brilho para antes dos 5 s do movimento decorativo.
    expect(CICLOS_DO_BRILHO * BRILHO_MS + 4 * DEFASAGEM_DO_BRILHO_MS).toBeLessThanOrEqual(CARREGANDO.movimentoMaxMs);
  });

  it("a faixa aparece e some dentro do ciclo: 1,6 s de varredura e 0,4 s de pausa, sem nada parado na pausa", () => {
    const quadros = regras(CSS).filter((regra) => regra.contexto.some((fora) => /^@keyframes\s+carregando-brilho$/.test(fora)));
    const em = (quadro: string) => {
      const regra = quadros.find((achada) => achada.seletor.split(",").map((parte) => parte.trim()).includes(quadro));
      if (!regra) return new Map<string, string>();
      return new Map(
        regra.corpo
          .split(";")
          .filter((linha) => linha.includes(":"))
          .map((linha) => [linha.slice(0, linha.indexOf(":")).trim(), linha.slice(linha.indexOf(":") + 1).trim()] as [string, string]),
      );
    };
    expect(em("0%").get("transform")).toBe("translateX(-130%) skewX(-20deg)");
    expect(em("0%").get("opacity")).toBe("0");
    expect(em("80%").get("transform")).toBe("translateX(330%) skewX(-20deg)");
    expect(em("80%").get("opacity")).toBe("0");
    expect(em("100%").get("transform")).toBe("translateX(330%) skewX(-20deg)");
    expect(em("100%").get("opacity")).toBe("0");
    // No meio da varredura, a faixa está acesa.
    const acesos = quadros.filter((regra) => /opacity:\s*1\b/.test(regra.corpo));
    expect(acesos.length).toBeGreaterThan(0);
  });

  it("no movimento reduzido, nenhum brilho", () => {
    const faixa = declaradas(".carregando-com-brilho::after", REDUZIDO);
    expect(faixa.get("animation")).toBe("none");
    expect(faixa.get("opacity")).toBe("0");
  });

  it("um cartão de linhas-fantasma não tem violação de acessibilidade", async () => {
    const html = renderToStaticMarkup(
      <section aria-labelledby="titulo">
        <h2 id="titulo">
          Para aprovar <Esqueleto forma="contagem" />
        </h2>
        <CartaoComBrilho ordem={0} className="rounded-lg border">
          {[0, 1].map((linha) => (
            <div key={linha} className="flex items-center gap-4">
              <Esqueleto forma="icone" />
              <span className="flex flex-1 flex-col">
                <Esqueleto forma="texto" className="w-2/5" />
                <Esqueleto forma="texto" className="mt-3 h-2.5 w-3/5" />
              </span>
              <Esqueleto forma="botao" className="w-24" />
              <Esqueleto forma="botao" className="w-28" />
            </div>
          ))}
        </CartaoComBrilho>
      </section>,
    );
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    const host = document.createElement("div");
    host.innerHTML = html;
    const blocos = Array.from(host.querySelectorAll("[data-esqueleto]"));
    // O bloco da contagem e, em cada uma das duas linhas, o ícone, o título, o apoio e os dois botões.
    expect(blocos).toHaveLength(11);
    expect(blocos.every((bloco) => bloco.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});
