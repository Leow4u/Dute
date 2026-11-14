import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CURVA_DO_REFLUXO } from "./palco-sem-saltos";
import { CARREGANDO } from "./tempo";

/**
 * Os tokens e os keyframes do carregamento em index.css (carregamento v2,
 * seções 4 e 8 da especificação de 12/11/2026). Tudo o que repete anda só
 * por transform e opacity: o laço que mexe em largura, stroke-dash ou
 * background-position roda na thread principal e congela junto com ela.
 */

const CSS = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

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
      const seletor = (texto.slice(desde, i).split(";").pop() ?? "").trim();
      pilha.push({ seletor, inicio: i + 1, temFilhos: false });
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

function declaracoes(corpo: string): Array<[string, string]> {
  return corpo
    .split(";")
    .map((linha) => linha.trim())
    .filter((linha) => linha.includes(":"))
    .map((linha) => [linha.slice(0, linha.indexOf(":")).trim(), linha.slice(linha.indexOf(":") + 1).trim()]);
}

/** Os seletores de uma regra, separados nas vírgulas e com os espaços juntos. */
function seletores(regra: Regra): string[] {
  return regra.seletor.split(",").map((parte) => parte.trim().replace(/\s+/g, " "));
}

/** As variáveis de um seletor (sozinho ou numa lista), na ordem do arquivo (a última vale). */
function variaveis(seletor: string, contexto: string[] = []): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const regra of regras(CSS)) {
    if (!seletores(regra).includes(seletor) || regra.contexto.join(" | ") !== contexto.join(" | ")) continue;
    for (const [nome, valor] of declaracoes(regra.corpo)) if (nome.startsWith("--")) mapa.set(nome, valor);
  }
  return mapa;
}

/** As propriedades que cada keyframe `carregando-*` anima e não são transform nem opacity. */
function foraDoCompositor(css: string): string[] {
  return regras(css)
    .filter((regra) => regra.contexto.some((fora) => /^@(?:-webkit-)?keyframes\s+carregando-/.test(fora)))
    .flatMap((regra) => {
      const nome = regra.contexto.find((fora) => /keyframes/.test(fora))!.replace(/^@(?:-webkit-)?keyframes\s+/, "");
      return declaracoes(regra.corpo)
        .map(([propriedade]) => propriedade)
        .filter((propriedade) => propriedade !== "transform" && propriedade !== "opacity")
        .map((propriedade) => `${nome}: ${propriedade}`);
    });
}

function nomesDosKeyframes(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)].map((achado) => achado[1]);
}

/** O valor com os espaços juntos, para comparar com o texto da especificação. */
const junto = (valor: string | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();

describe("os keyframes do carregamento", () => {
  it("a trava acusa o laço que anima fora do compositor", () => {
    expect(
      foraDoCompositor(`
        @keyframes carregando-bom { from { opacity: 0; transform: scale(.8) } to { opacity: 1 } }
        @keyframes carregando-largura { to { width: 100% } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes carregando-traco { 50% { stroke-dashoffset: 0; opacity: .5 } }
        }
        @keyframes carregando-fundo { 0%, 100% { background-position: 0 0 } }
        @keyframes carregando-variavel { to { --p: 1 } }
        @keyframes outro-qualquer { to { width: 10px } }
      `),
    ).toEqual([
      "carregando-largura: width",
      "carregando-traco: stroke-dashoffset",
      "carregando-fundo: background-position",
      "carregando-variavel: --p",
    ]);
  });

  it("os keyframes das peças estão no index.css", () => {
    expect(nomesDosKeyframes(CSS)).toEqual(
      expect.arrayContaining([
        "carregando-giro",
        "carregando-entra",
        "carregando-respira",
        "carregando-varre",
        "carregando-brilho",
        "carregando-listras",
        "carregando-arco",
        "carregando-aceso",
        "carregando-sai-linha",
        "carregando-chega-linha",
        "carregando-realce",
        "carregando-conta-sai",
        "carregando-conta-entra",
      ]),
    );
  });

  it("nenhum keyframe carregando-* anima algo além de transform e opacity", () => {
    expect(foraDoCompositor(CSS)).toEqual([]);
  });

  it("o realce verde só na linha que chegou por uma ação nesta tela (data-realce), nunca na releitura", () => {
    const comRealce = regras(CSS).filter((regra) => declaracoes(regra.corpo).some(([nome, valor]) => nome === "animation" && /\bcarregando-realce\b/.test(valor)));
    expect(comRealce.length).toBeGreaterThan(0);
    for (const regra of comRealce) for (const seletor of seletores(regra)) expect(seletor).toContain("[data-realce]");
  });

  it("o respiro do movimento reduzido desce só até o piso de contraste", () => {
    const respira = regras(CSS).filter((regra) => regra.contexto.some((fora) => /keyframes\s+carregando-respira$/.test(fora)));
    expect(respira.map((regra) => [regra.seletor, declaracoes(regra.corpo)])).toEqual([
      ["50%", [["opacity", "var(--carregando-piso, 0.6)"]]],
    ]);
  });
});

/** 4.1: o relógio também em CSS, para quem anima. */
const MOVIMENTO: Record<string, string> = {
  "--carregando-t-toque": "100ms",
  "--carregando-t-atraso": "300ms",
  "--carregando-t-minimo": "500ms",
  "--carregando-t-entrada": "150ms",
  "--carregando-t-saida": "180ms",
  "--carregando-t-giro": "1200ms",
  "--carregando-t-giro-calmo": "2000ms",
  "--carregando-t-varredura": "1400ms",
  "--carregando-t-brilho": "2000ms",
  "--carregando-t-chegada": "150ms",
  "--carregando-passo": "30ms",
  "--carregando-subida": "4px",
  "--carregando-t-troca-sai": "80ms",
  "--carregando-t-troca-entra": "150ms",
  "--carregando-t-barra-fim": "200ms",
  "--carregando-t-barra-some": "150ms",
  "--carregando-t-sucesso": "520ms",
  "--carregando-mola": "cubic-bezier(0.34, 1.56, 0.64, 1)",
  "--carregando-t-sucesso-visivel": "1000ms",
  "--carregando-t-erro-visivel": "2000ms",
  "--carregando-t-sai-linha": "200ms",
  "--carregando-sai-linha-y": "-6px",
  "--carregando-t-reflui": "240ms",
  "--carregando-t-chega-linha": "240ms",
  "--carregando-t-chega-espera": "180ms",
  "--carregando-t-destaque": "1000ms",
  "--carregando-t-conta": "160ms",
  "--carregando-conta-y": "8px",
  "--carregando-t-listras": "600ms",
  "--carregando-t-segmento": "200ms",
  "--carregando-t-fio": "300ms",
  "--carregando-t-arcos": "1200ms",
  "--carregando-t-pulso": "2000ms",
  "--carregando-t-abertura-sai": "260ms",
  "--carregando-t-abertura-completa": "200ms",
  "--carregando-t-abertura-segmento-sai": "60ms",
  "--carregando-t-abertura-marca-sai": "200ms",
  "--carregando-t-dedo": "700ms",
  "--carregando-t-sem-rede": "3000ms",
  "--carregando-t-aviso-minimo": "2000ms",
  "--carregando-t-releitura": "2000ms",
  "--carregando-t-releitura-max": "30000ms",
};

const CAIXA = "M6 3.5H18A2.5 2.5 0 0 1 20.5 6V14.5L14.5 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Z";

describe("os tokens do carregamento", () => {
  const raiz = variaveis(":root");

  it("4.1 movimento: os tempos, as curvas e a mola", () => {
    for (const [nome, valor] of Object.entries(MOVIMENTO)) expect(junto(raiz.get(nome)), nome).toBe(valor);
    const tema = variaveis("@theme static");
    expect(tema.get("--ease-carregando-entrada")).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(tema.get("--ease-carregando-saida")).toBe("cubic-bezier(0.4, 0, 1, 1)");
    expect(tema.get("--ease-carregando-padrao")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    // O refluxo do palco (Web Animations) anda na mesma curva.
    expect(tema.get("--ease-carregando-padrao")).toBe(CURVA_DO_REFLUXO);
    // A mola de rigidez 200 e amortecimento 0,6 (pico de 9,5%), onde o navegador tem linear().
    const mola = variaveis(":root", ["@supports (transition-timing-function: linear(0, 1))"]).get("--carregando-mola");
    expect(junto(mola)).toBe(
      "linear(0, 0.054 5%, 0.185 10%, 0.352 15%, 0.527 20%, 0.69 25%, 0.827 30%, 0.934 35%, 1.011 40%, 1.06 45%, " +
        "1.086 50%, 1.095 55%, 1.091 60%, 1.079 65%, 1.063 70%, 1.047 75%, 1.031 80%, 1.018 85%, 1.007 90%, 1)",
    );
  });

  it("os tempos do CSS são os do relógio de lib/carregando/tempo.ts", () => {
    expect(raiz.get("--carregando-t-atraso")).toBe(`${CARREGANDO.atrasoMs}ms`);
    expect(raiz.get("--carregando-t-minimo")).toBe(`${CARREGANDO.minimoMs}ms`);
    expect(raiz.get("--carregando-t-sucesso-visivel")).toBe(`${CARREGANDO.sucessoVisivelMs}ms`);
    expect(raiz.get("--carregando-t-erro-visivel")).toBe(`${CARREGANDO.erroVisivelMs}ms`);
    expect(raiz.get("--carregando-t-dedo")).toBe(`${CARREGANDO.dedoMs}ms`);
    expect(raiz.get("--carregando-t-sai-linha")).toBe(`${CARREGANDO.saiLinhaMs}ms`);
    expect(raiz.get("--carregando-t-reflui")).toBe(`${CARREGANDO.refluiMs}ms`);
    expect(raiz.get("--carregando-t-chega-linha")).toBe(`${CARREGANDO.chegaLinhaMs}ms`);
    expect(raiz.get("--carregando-t-chega-espera")).toBe(`${CARREGANDO.chegaEsperaMs}ms`);
    // A que chega começa 60 ms antes do fim do refluxo, quando o cartão já chegou (a prancha).
    expect(CARREGANDO.refluiMs - CARREGANDO.chegaEsperaMs).toBe(60);
    expect(raiz.get("--carregando-t-destaque")).toBe(`${CARREGANDO.destaqueMs}ms`);
    expect(raiz.get("--carregando-t-conta")).toBe(`${CARREGANDO.contaMs}ms`);
    // O dado que chega no lugar das linhas-fantasma (parte 8): 150 ms por linha, 30 ms entre elas.
    expect(raiz.get("--carregando-t-chegada")).toBe(`${CARREGANDO.chegadaMs}ms`);
    expect(raiz.get("--carregando-passo")).toBe(`${CARREGANDO.passoMs}ms`);
    expect(CARREGANDO.linhasNaCascata).toBe(6);
    // O texto que sai da linha de estado (parte 7b) some no tempo da troca do rótulo do botão.
    expect(raiz.get("--carregando-t-troca-sai")).toBe(`${CARREGANDO.trocaSaiMs}ms`);
    expect(raiz.get("--carregando-t-troca-entra")).toBe(`${CARREGANDO.trocaEntraMs}ms`);
    // A espera que sai da linha de estado e do Atualizar sai no tempo de qualquer indicador; a barra do topo
    // que voltou a ler completa e esmaece nos dela.
    expect(raiz.get("--carregando-t-saida")).toBe(`${CARREGANDO.saidaMs}ms`);
    expect(raiz.get("--carregando-t-barra-fim")).toBe(`${CARREGANDO.barraFimMs}ms`);
    expect(raiz.get("--carregando-t-barra-some")).toBe(`${CARREGANDO.barraSomeMs}ms`);
    // As operações longas (parte 11): o segmento da foto e o fio das etapas.
    expect(raiz.get("--carregando-t-segmento")).toBe(`${CARREGANDO.segmentoMs}ms`);
    expect(raiz.get("--carregando-t-fio")).toBe(`${CARREGANDO.fioMs}ms`);
    // A abertura (index.html) esmaece e, antes, completa o trilho: lib/abertura.ts conta com os mesmos tempos.
    expect(raiz.get("--carregando-t-abertura-sai")).toBe(`${CARREGANDO.aberturaSaiMs}ms`);
    expect(raiz.get("--carregando-t-abertura-completa")).toBe(`${CARREGANDO.aberturaCompletaMs}ms`);
    expect(raiz.get("--carregando-t-abertura-segmento-sai")).toBe(`${CARREGANDO.aberturaSegmentoSaiMs}ms`);
    expect(raiz.get("--carregando-t-abertura-marca-sai")).toBe(`${CARREGANDO.aberturaMarcaSaiMs}ms`);
    // A conexão (momento 8): a histerese, o mínimo de cada aviso e a espera das releituras sozinhas.
    expect(raiz.get("--carregando-t-sem-rede")).toBe(`${CARREGANDO.semRedeMs}ms`);
    expect(raiz.get("--carregando-t-aviso-minimo")).toBe(`${CARREGANDO.avisoMinimoMs}ms`);
    expect(raiz.get("--carregando-t-releitura")).toBe(`${CARREGANDO.releituraMs}ms`);
    expect(raiz.get("--carregando-t-releitura-max")).toBe(`${CARREGANDO.releituraMaxMs}ms`);
  });

  it("4.2 forma: a caixa chanfrada em três traços, a cabeça, o trilho, o piso e as barras", () => {
    const mascaras = { "--carregando-mascara-16": "3.4", "--carregando-mascara-24": "3", "--carregando-mascara-40": "2.4" };
    for (const [nome, traco] of Object.entries(mascaras)) {
      const svg = decodeURIComponent(raiz.get(nome) ?? "");
      expect(svg, nome).toContain(`d='${CAIXA}'`);
      expect(svg, nome).toContain(`stroke-width='${traco}'`);
      expect(svg, nome).toContain("fill='none'");
    }
    expect(junto(raiz.get("--carregando-cabeca"))).toBe("conic-gradient(from 0turn, transparent 0 35%, currentColor 60% 100%)");
    expect(raiz.get("--carregando-trilho")).toBe("0.16");
    expect(raiz.get("--carregando-trilho-sobre-preto")).toBe("0.25");
    expect(raiz.get("--carregando-trilho-na-cor")).toBe("0.35");
    expect(raiz.get("--carregando-piso")).toBe("0.6");
    expect(raiz.get("--carregando-piso-na-cor")).toBe("0.8");
    // O violeta do Agent Dute (parte 12): 0,75 no claro e 0,85 no escuro, e a trilha lê o dele.
    expect(raiz.get("--carregando-piso-agente")).toBe("0.75");
    expect(variaveis(".dark").get("--carregando-piso-agente")).toBe("0.85");
    expect(variaveis(".trilha-do-agente", ["@layer components"]).get("--carregando-piso")).toBe("var(--carregando-piso-agente)");
    expect(raiz.get("--carregando-barra-linha")).toBe("4px");
    expect(raiz.get("--carregando-barra-topo")).toBe("3px");
    expect(raiz.get("--carregando-chanfro")).toBe("4px");
    const celular = variaveis(":root", ["@media (max-width: 767px)"]);
    expect(celular.get("--carregando-barra-linha")).toBe("6px");
    expect(celular.get("--carregando-barra-topo")).toBe("4px");
    const tema = variaveis("@theme static");
    expect(tema.get("--text-contagem")).toBe("2.75rem");
    expect(tema.get("--text-contagem--font-weight")).toBe("800");
    expect(tema.get("--text-contagem-sm")).toBe("1.75rem");
    expect(tema.get("--text-contagem-sm--font-weight")).toBe("800");
  });

  it("4.3 cor: leem os tokens do app, com o esqueleto neutro no claro, na v3 e no escuro", () => {
    expect(raiz.get("--carregando-cor")).toBe("var(--foreground)");
    expect(raiz.get("--carregando-agente")).toBe("var(--agent)");
    expect(raiz.get("--carregando-marca")).toBe("358 81% 51%");
    expect(raiz.get("--carregando-aviso")).toBe("var(--amber-soft-foreground)");
    expect(raiz.get("--carregando-ok")).toBe("var(--success)");
    expect(raiz.get("--carregando-erro")).toBe("var(--destructive)");
    expect(raiz.get("--carregando-brilho")).toBe("hsl(var(--card) / 0.6)");
    expect(raiz.get("--carregando-esqueleto")).toBe("214 16% 87%");
    // Na v3 e no .dark (também o de dentro da página, a TV), o apelido relê o token de lá.
    for (const seletor of [".v3", ".dark"]) {
      expect(variaveis(seletor).get("--carregando-cor"), seletor).toBe("var(--foreground)");
      expect(variaveis(seletor).get("--carregando-brilho"), seletor).toBe("hsl(var(--card) / 0.6)");
    }
    expect(variaveis(".v3").get("--carregando-esqueleto-preto")).toBe("hsl(var(--v3-header-foreground) / 0.12)");
    expect(variaveis(":root:not(.dark) .v3").get("--carregando-esqueleto")).toBe("51 10% 86%");
    expect(variaveis(".dark").get("--carregando-esqueleto")).toBe("var(--muted)");
    const tema = variaveis("@theme inline");
    for (const nome of ["cor", "agente", "marca", "esqueleto", "aviso", "ok", "erro"]) {
      expect(tema.get(`--color-carregando-${nome}`), nome).toBe(`hsl(var(--carregando-${nome}))`);
    }
    expect(tema.get("--color-carregando-esqueleto-preto")).toBe("var(--carregando-esqueleto-preto)");
    expect(tema.get("--color-carregando-brilho")).toBe("var(--carregando-brilho)");
  });

  it("movimento reduzido: nada desliza nem pula com mola; as trocas são de uma vez", () => {
    expect(Object.fromEntries(variaveis(":root", ["@media (prefers-reduced-motion: reduce)"]))).toMatchObject({
      "--carregando-subida": "0px",
      "--carregando-t-troca-sai": "0ms",
      "--carregando-t-troca-entra": "0ms",
      "--carregando-t-barra-fim": "0ms",
      "--carregando-t-sucesso": "0ms",
      "--carregando-sai-linha-y": "0px",
      "--carregando-t-reflui": "0ms",
      "--carregando-t-chega-espera": "0ms",
      "--carregando-t-conta": "0ms",
      "--carregando-mola": "var(--ease-carregando-entrada)",
    });
    // A linha nova não desliza, mas esmaece em 240 ms: a entrada fica, só por opacidade (a subida é 0).
    expect(variaveis(":root", ["@media (prefers-reduced-motion: reduce)"]).has("--carregando-t-chega-linha")).toBe(false);
  });
});

/* Contraste (WCAG 2.1), com os valores do próprio index.css. */

type Rgb = [number, number, number];

function hslParaRgb(triplo: string): Rgb {
  const partes = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(triplo.trim());
  if (!partes) throw new Error(`não é um HSL do tema: ${triplo}`);
  const [h, s, l] = [Number(partes[1]), Number(partes[2]) / 100, Number(partes[3]) / 100];
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const canal = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [canal(0), canal(8), canal(4)];
}

function luminancia([r, g, b]: Rgb): number {
  const linear = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contraste(a: Rgb, b: Rgb): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** A cor `a` com opacidade sobre o fundo `b`. */
function sobre(a: Rgb, b: Rgb, opacidade: number): Rgb {
  return [0, 1, 2].map((i) => opacidade * a[i] + (1 - opacidade) * b[i]) as Rgb;
}

/*
 * A cascata das variáveis, como o navegador faz: em cada elemento valem as
 * regras de fora das @-regras que casam com ele (pela especificidade e, no
 * empate, pela ordem do arquivo), e o var() de uma variável se resolve no
 * elemento que a declara; o filho herda o valor já resolvido. Por isso o
 * apelido declarado só na raiz levaria a tinta clara para um .dark dentro da
 * página. O modelo entende os seletores do tema: :root, .classe, :not(.classe)
 * e o descendente; o resto não casa.
 */

/** Um elemento da cadeia, pelas classes; o primeiro é a raiz (o html). */
type Cadeia = string[][];

function casaComposto(composto: string, cadeia: Cadeia, indice: number): boolean {
  const partes = composto.match(/:root|:not\(\.[\w-]+\)|\.[\w-]+|[^:.]+|[:.]+/g) ?? [];
  return partes.every((parte) => {
    if (parte === ":root") return indice === 0;
    const nao = /^:not\(\.([\w-]+)\)$/.exec(parte);
    if (nao) return !cadeia[indice].includes(nao[1]);
    if (/^\.[\w-]+$/.test(parte)) return cadeia[indice].includes(parte.slice(1));
    return false;
  });
}

function casa(seletor: string, cadeia: Cadeia, indice: number): boolean {
  const compostos = seletor.split(" ");
  if (!casaComposto(compostos[compostos.length - 1], cadeia, indice)) return false;
  let acima = indice - 1;
  for (let k = compostos.length - 2; k >= 0; k -= 1) {
    while (acima >= 0 && !casaComposto(compostos[k], cadeia, acima)) acima -= 1;
    if (acima < 0) return false;
    acima -= 1;
  }
  return true;
}

/** A especificidade nos seletores do tema: :root e cada classe (também a de dentro do :not) contam uma vez. */
const especificidade = (seletor: string) => (seletor.match(/:root|\.[\w-]+/g) ?? []).length;

const REGRAS_DE_TOPO = regras(CSS)
  .filter((regra) => regra.contexto.length === 0 && !regra.seletor.startsWith("@"))
  .map((regra, ordem) => ({
    seletores: seletores(regra),
    ordem,
    declaracoes: declaracoes(regra.corpo).filter(([nome]) => nome.startsWith("--")),
  }));

/** As variáveis do último elemento da cadeia, resolvidas como o navegador as deixa. */
function computar(cadeia: Cadeia): Map<string, string> {
  let herdado = new Map<string, string>();
  cadeia.forEach((_, indice) => {
    const valem = REGRAS_DE_TOPO.flatMap((regra) => {
      const casados = regra.seletores.filter((seletor) => casa(seletor, cadeia, indice));
      return casados.length > 0 ? [{ ...regra, peso: Math.max(...casados.map(especificidade)) }] : [];
    }).sort((a, b) => a.peso - b.peso || a.ordem - b.ordem);
    const declarado = new Map<string, string>();
    for (const regra of valem) for (const [nome, valor] of regra.declaracoes) declarado.set(nome, valor);
    const resolvido = new Map<string, string | undefined>();
    const valor = (nome: string, pilha: string[]): string | undefined => {
      if (resolvido.has(nome)) return resolvido.get(nome);
      const bruto = declarado.get(nome);
      if (bruto === undefined) return herdado.get(nome);
      if (pilha.includes(nome)) return undefined;
      let falta = false;
      const pronto = bruto.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_trecho, outro: string, reserva?: string) => {
        const achado = valor(outro, [...pilha, nome]) ?? reserva?.trim();
        if (achado === undefined) falta = true;
        return achado ?? "";
      });
      resolvido.set(nome, falta ? undefined : pronto);
      return resolvido.get(nome);
    };
    const proprio = new Map(herdado);
    for (const nome of declarado.keys()) {
      const pronto = valor(nome, []);
      if (pronto === undefined) proprio.delete(nome);
      else proprio.set(nome, pronto);
    }
    herdado = proprio;
  });
  return herdado;
}

/** Os tokens no último elemento da cadeia. */
function tema(cadeia: Cadeia) {
  const mapa = computar(cadeia);
  const valor = (nome: string): string => {
    const achado = mapa.get(nome);
    if (achado === undefined) throw new Error(`token ausente: ${nome}`);
    return achado.trim();
  };
  return { valor, cor: (nome: string) => hslParaRgb(valor(nome)), numero: (nome: string) => Number(valor(nome)) };
}

describe("a cascata do modelo", () => {
  it("resolve o var() no elemento que declara e herda o valor pronto", () => {
    expect(computar([[]]).get("--carregando-cor")).toBe(computar([[]]).get("--foreground"));
    // O --v3-marca só existe dentro do .v3.
    expect(computar([[]]).has("--v3-marca")).toBe(false);
    expect(computar([[], ["v3"]]).get("--v3-marca")).toBe("358 81% 51%");
    // A v3 clara (:root:not(.dark) .v3) vence o .v3 e não vale com a raiz escura.
    expect(computar([[], ["v3"]]).get("--foreground")).toBe("0 0% 9%");
    expect(computar([["dark"], ["v3"]]).get("--foreground")).toBe("210 40% 98%");
  });
});

/**
 * Os contextos do app: o claro, a v3 e o escuro na raiz, e a TV (/tv,
 * components/layout/tv-layout.tsx), sempre escura num .dark dentro do .v3,
 * com a raiz no tema de quem a abre.
 */
const CONTEXTOS: Record<string, Cadeia> = {
  claro: [[]],
  v3: [[], ["v3"]],
  escuro: [["dark"]],
  v3Escuro: [["dark"], ["v3"]],
  tv: [[], ["v3"], ["dark"]],
  tvEscuro: [["dark"], ["v3"], ["dark"]],
};

describe("os apelidos de cor, em cada contexto", () => {
  const temas = Object.fromEntries(Object.entries(CONTEXTOS).map(([nome, cadeia]) => [nome, tema(cadeia)]));

  it("valem o token do app que leem, também no .dark dentro da página (a TV)", () => {
    for (const [nome, t] of Object.entries(temas)) {
      expect(t.valor("--carregando-cor"), `${nome} cor`).toBe(t.valor("--foreground"));
      expect(t.valor("--carregando-agente"), `${nome} agente`).toBe(t.valor("--agent"));
      expect(t.valor("--carregando-aviso"), `${nome} aviso`).toBe(t.valor("--amber-soft-foreground"));
      expect(t.valor("--carregando-ok"), `${nome} ok`).toBe(t.valor("--success"));
      expect(t.valor("--carregando-erro"), `${nome} erro`).toBe(t.valor("--destructive"));
      expect(t.valor("--carregando-brilho"), `${nome} brilho`).toBe(`hsl(${t.valor("--card")} / 0.6)`);
    }
  });

  it("o vermelho é o da marca da v3, e o esqueleto é o do tema de cada contexto", () => {
    for (const nome of ["v3", "v3Escuro", "tv", "tvEscuro"]) {
      expect(temas[nome].valor("--carregando-marca"), nome).toBe(temas[nome].valor("--v3-marca"));
    }
    expect(temas.claro.valor("--carregando-esqueleto")).toBe("214 16% 87%");
    expect(temas.v3.valor("--carregando-esqueleto")).toBe("51 10% 86%");
    for (const nome of ["escuro", "v3Escuro", "tv", "tvEscuro"]) {
      expect(temas[nome].valor("--carregando-esqueleto"), nome).toBe(temas[nome].valor("--muted"));
    }
  });
});

describe("o contraste dos tokens, no claro, na v3, no escuro e na TV", () => {
  const temas = Object.fromEntries(Object.entries(CONTEXTOS).map(([nome, cadeia]) => [nome, tema(cadeia)]));
  const { v3, v3Escuro, tv, tvEscuro } = temas;

  it("a tinta no vale do respiro (0,6) ainda tem 3:1 no cartão e no fundo", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of ["--card", "--background"]) {
        const vale = sobre(t.cor("--carregando-cor"), t.cor(fundo), t.numero("--carregando-piso"));
        expect(contraste(vale, t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("o branco no vale do respiro (0,8) ainda tem 3:1 sobre o botão de cor", () => {
    for (const [nome, t] of Object.entries(temas)) {
      const vale = sobre(t.cor("--primary-foreground"), t.cor("--primary"), t.numero("--carregando-piso-na-cor"));
      expect(contraste(vale, t.cor("--primary")), nome).toBeGreaterThanOrEqual(3);
    }
  });

  it("o violeta do agente tem 3:1 na caixa dele e no cartão", () => {
    for (const [nome, t] of Object.entries(temas)) {
      expect(contraste(t.cor("--carregando-agente"), t.cor("--agent-soft")), nome).toBeGreaterThanOrEqual(3);
      expect(contraste(t.cor("--carregando-agente"), t.cor("--card")), nome).toBeGreaterThanOrEqual(3);
    }
  });

  it("o violeta no vale do respiro (o piso do agente) ainda tem 3:1 na caixa dele e no cartão", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of ["--agent-soft", "--card"]) {
        const vale = sobre(t.cor("--carregando-agente"), t.cor(fundo), t.numero("--carregando-piso-agente"));
        expect(contraste(vale, t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("o texto violeta da trilha e dos chips tem 4,5:1 na caixa do agente (6,8:1 no claro; o --agent-strong no escuro)", () => {
    expect(contraste(temas.v3.cor("--carregando-agente"), temas.v3.cor("--agent-soft"))).toBeGreaterThanOrEqual(6.8);
    for (const nome of ["claro", "v3"]) {
      expect(contraste(temas[nome].cor("--carregando-agente"), temas[nome].cor("--agent-soft")), nome).toBeGreaterThanOrEqual(4.5);
    }
    for (const nome of ["escuro", "v3Escuro", "tv", "tvEscuro"]) {
      expect(contraste(temas[nome].cor("--agent-strong"), temas[nome].cor("--agent-soft")), nome).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o texto do aviso, do erro e do confirmado tem 4,5:1", () => {
    for (const [nome, t] of Object.entries(temas)) {
      expect(contraste(t.cor("--carregando-aviso"), t.cor("--warning-soft")), `${nome} aviso`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.cor("--carregando-erro"), t.cor("--destructive-soft")), `${nome} erro`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.cor("--success-foreground"), t.cor("--carregando-ok")), `${nome} ok`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o vermelho da marca tem 3:1 na barra preta", () => {
    for (const t of [v3, v3Escuro, tv, tvEscuro]) {
      expect(contraste(t.cor("--carregando-marca"), t.cor("--v3-header"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("o esqueleto se vê no cartão, sem virar sinal", () => {
    for (const [nome, t] of Object.entries(temas)) {
      const medida = contraste(t.cor("--carregando-esqueleto"), t.cor("--card"));
      expect(medida, nome).toBeGreaterThanOrEqual(1.2);
      expect(medida, nome).toBeLessThan(1.6);
    }
  });
});

/**
 * O anel do foco (parte 13h; WCAG 1.4.11 e 2.4.7). O --ring a 40% do Button e
 * das peças que o copiavam tinha 1,91:1 no claro da v3 e 1,65:1 no escuro. O
 * --foco é o anel cheio: 3:1 ou mais em toda superfície onde um foco aparece,
 * em todos os contextos do app (a classe é a ring-foco, travada em
 * trava.test.ts).
 */
describe("o anel do foco, em cada contexto", () => {
  const temas = Object.fromEntries(Object.entries(CONTEXTOS).map(([nome, cadeia]) => [nome, tema(cadeia)]));
  const SUPERFICIES = ["--background", "--card", "--popover", "--muted", "--secondary", "--primary-soft", "--sidebar"];

  it("vira utilidade (ring-foco) e lê o --ring do contexto, também no .dark dentro da página", () => {
    expect(variaveis("@theme inline").get("--color-foco")).toBe("hsl(var(--foco))");
    for (const [nome, t] of Object.entries(temas)) expect(t.valor("--foco"), nome).toBe(t.valor("--ring"));
  });

  it("tem 3:1 ou mais no fundo, no cartão, no muted e na superfície escolhida", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of SUPERFICIES) {
        expect(contraste(t.cor("--foco"), t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("o antigo, a 40% no cartão, ficava abaixo de 3:1 (o que a parte 13h corrige)", () => {
    for (const nome of ["v3", "escuro"]) {
      const t = temas[nome];
      expect(contraste(sobre(t.cor("--ring"), t.cor("--card"), 0.4), t.cor("--card")), nome).toBeLessThan(2);
    }
  });
});

/**
 * O primário como texto no cartão (o "Ver itens" da fila, parte 13h): 4,5:1
 * em todos os contextos. O --primary do escuro, como texto, dava 4,4:1 no
 * cartão.
 */
describe("o primário como texto, em cada contexto", () => {
  const temas = Object.fromEntries(Object.entries(CONTEXTOS).map(([nome, cadeia]) => [nome, tema(cadeia)]));

  it("vira utilidade (text-primary-texto): o próprio --primary no claro e na v3", () => {
    expect(variaveis("@theme inline").get("--color-primary-texto")).toBe("hsl(var(--primary-texto))");
    for (const nome of ["claro", "v3"]) expect(temas[nome].valor("--primary-texto"), nome).toBe(temas[nome].valor("--primary"));
  });

  it("tem 4,5:1 no cartão e no popover", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of ["--card", "--popover"]) {
        expect(contraste(t.cor("--primary-texto"), t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("o --primary do escuro, como texto no cartão, ficava abaixo de 4,5:1", () => {
    expect(contraste(temas.escuro.cor("--primary"), temas.escuro.cor("--card"))).toBeLessThan(4.5);
  });
});

/**
 * O fundo do primário (parte 13k): o branco sobre o botão primário do escuro
 * tinha 4,30:1 (o #2B75EE, o --primary), abaixo dos 4,5:1. O fundo do
 * primário é o --primary-fundo: o bg-primary o lê pelo `--background-color-primary`
 * do tema, sem trocar classe nenhuma, e o text-primary, a borda e o anel
 * seguem o --primary. No claro e na v3, é o próprio --primary (o vermelho da
 * marca na v3); no escuro, o mesmo azul, mais fundo.
 */
describe("o fundo do primário, em cada contexto", () => {
  const temas = Object.fromEntries(Object.entries(CONTEXTOS).map(([nome, cadeia]) => [nome, tema(cadeia)]));

  it("o bg-primary lê o --primary-fundo, e o text-primary segue o --primary", () => {
    const doTema = variaveis("@theme inline");
    expect(doTema.get("--background-color-primary")).toBe("hsl(var(--primary-fundo))");
    expect(doTema.get("--color-primary")).toBe("hsl(var(--primary))");
    for (const nome of ["claro", "v3"]) expect(temas[nome].valor("--primary-fundo"), nome).toBe(temas[nome].valor("--primary"));
    // O vermelho da marca na v3 clara fica o mesmo.
    expect(temas.v3.valor("--primary-fundo")).toBe("358 81% 51%");
  });

  it("o texto do primário tem 4,5:1 sobre o fundo, no repouso, no hover e no toque, em todos os contextos", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of ["--primary-fundo", "--primary-hover", "--primary-pressed"]) {
        expect(contraste(t.cor("--primary-foreground"), t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("o botão cheio se destaca do fundo e do cartão (3:1), e o azul do escuro continua o do --primary", () => {
    for (const [nome, t] of Object.entries(temas)) {
      for (const fundo of ["--background", "--card"]) {
        expect(contraste(t.cor("--primary-fundo"), t.cor(fundo)), `${nome} ${fundo}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const nome of ["escuro", "v3Escuro", "tv", "tvEscuro"]) {
      const [matiz, saturacao] = temas[nome].valor("--primary-fundo").split(/\s+/);
      const [matizDoTexto, saturacaoDoTexto] = temas[nome].valor("--primary").split(/\s+/);
      expect([matiz, saturacao], nome).toEqual([matizDoTexto, saturacaoDoTexto]);
    }
  });

  it("o --primary do escuro, com o branco, ficava abaixo de 4,5:1 (o que a parte 13k corrige)", () => {
    expect(contraste(temas.escuro.cor("--primary-foreground"), temas.escuro.cor("--primary"))).toBeLessThan(4.5);
  });
});

/**
 * A capa de entrada (components/auth-shell.tsx, `.auth-cover`): sempre escura,
 * nos dois temas, com as cores dela (o cartão #101112). As peças do
 * carregamento leem os tokens do tema; dentro da capa, a tinta e o aviso da
 * espera são os dela (revisão da parte 13h: no claro, "Conferindo seu
 * convite…" e "Reenviando…" saíam em #1F2A3D sobre o cartão, a 1,3:1).
 */
describe("a capa de entrada, sempre escura", () => {
  const CAPAS: Record<string, Cadeia> = { claro: [[], ["auth-cover"]], escuro: [["dark"], ["auth-cover"]] };

  function hexParaRgb(hex: string): Rgb {
    const limpo = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!limpo) throw new Error(`não é um hex: ${hex}`);
    const n = Number.parseInt(limpo[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** O rgba() de uma declaração sobre o fundo dado. */
  function rgbaSobre(rgba: string, fundo: Rgb): Rgb {
    const partes = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba.trim());
    if (!partes) throw new Error(`não é um rgba: ${rgba}`);
    return sobre([Number(partes[1]), Number(partes[2]), Number(partes[3])], fundo, Number(partes[4]));
  }

  /** A declaração que vale para o seletor, somando as regras de topo que o citam (a última vence). */
  const declaracaoDe = (seletor: string, propriedade: string) => {
    const valores = regras(CSS)
      .filter((achada) => achada.contexto.length === 0 && seletores(achada).includes(seletor))
      .flatMap((achada) => declaracoes(achada.corpo).filter(([nome]) => nome === propriedade).map(([, valor]) => valor));
    return valores[valores.length - 1];
  };

  it("a tinta e o aviso da espera têm 4,5:1 no cartão da capa, e a tinta, 3:1 no vale do respiro", () => {
    for (const [nome, cadeia] of Object.entries(CAPAS)) {
      const t = tema(cadeia);
      const cartao = hexParaRgb(t.valor("--auth-surface"));
      expect(contraste(t.cor("--carregando-cor"), cartao), `${nome} tinta`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.cor("--carregando-aviso"), cartao), `${nome} aviso`).toBeGreaterThanOrEqual(4.5);
      const vale = sobre(t.cor("--carregando-cor"), cartao, t.numero("--carregando-piso"));
      expect(contraste(vale, cartao), `${nome} respiro`).toBeGreaterThanOrEqual(3);
    }
  });

  it("o toque dos botões escuros da capa fica escuro: o texto dela continua com 4,5:1", () => {
    const fundo = declaracaoDe(".auth-cover button[type='button'].w-full [data-fundo=\"toque\"]", "background-color");
    expect(fundo).toBeDefined();
    const t = tema(CAPAS.claro);
    const cartao = hexParaRgb(t.valor("--auth-surface"));
    expect(contraste(hexParaRgb(t.valor("--auth-text")), rgbaSobre(fundo!, cartao))).toBeGreaterThanOrEqual(4.5);
  });

  it("o branco do botão principal da capa tem 4,5:1, e o alvo dos controles, 44 px", () => {
    const t = tema(CAPAS.claro);
    const fundo = declaracaoDe('.auth-cover button[type="submit"]', "background-color");
    expect(fundo).toBe("var(--auth-accent-fundo)");
    expect(contraste([255, 255, 255], hexParaRgb(t.valor("--auth-accent-fundo")))).toBeGreaterThanOrEqual(4.5);
    // O acento como texto (o "Esqueci minha senha") e como borda do foco continua no cartão escuro.
    expect(contraste(hexParaRgb(t.valor("--auth-accent")), hexParaRgb(t.valor("--auth-surface")))).toBeGreaterThanOrEqual(4.5);
    for (const seletor of [".auth-cover input", '.auth-cover button[type="submit"]', ".auth-cover button[type='button'].w-full"]) {
      expect(declaracaoDe(seletor, "height"), seletor).toBe("44px");
    }
  });
});
