// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { aberturaAberta, aberturaNaTela, duracaoDaSaida, fecharAbertura, FOLGA_DA_SAIDA_MS, saidaDaAbertura } from "./abertura";
import { folhasDepoisDaAbertura } from "./abertura-no-build";
import { INTERVALO_DO_ANUNCIO_MS } from "./carregando/anunciador";
import { CARREGANDO } from "./carregando/tempo";

/**
 * A abertura do app (carregamento v2, momento 5, decisão P4 de 12/11/2026):
 * preta, fora do #root, pintada antes do JavaScript e da fonte, com a marca,
 * o trilho chanfrado e nenhum texto visível; a folha do Google não segura a
 * primeira pintura. Antes dela, a tela ficava 100% em branco até o perfil
 * chegar, e o <link> do Google Fonts (Inter e JetBrains Mono, que o app não
 * usa) e o @import da Manrope seguravam a pintura com sinal fraco.
 */

// No ambiente jsdom o Vite reescreve `new URL("..", import.meta.url)` como endereço de asset.
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = readFileSync(resolve(APP, "index.html"), "utf8");
const INDEX_CSS = readFileSync(resolve(APP, "src/index.css"), "utf8");
const VITE = readFileSync(resolve(APP, "vite.config.ts"), "utf8");

function pagina() {
  return new JSDOM(HTML).window.document;
}

/** O CSS da abertura, no <style> do index.html. */
function estiloDaAbertura(): string {
  const estilos = [...pagina().querySelectorAll("head style")].map((estilo) => estilo.textContent ?? "");
  const css = estilos.find((texto) => texto.includes("#abertura"));
  if (!css) throw new Error("sem o CSS da abertura no index.html");
  return css;
}

/** O script da abertura (o único script clássico do index.html). */
function scriptDaAbertura(): string {
  const scripts = [...pagina().querySelectorAll("body script:not([type]), body script[type='text/javascript']")];
  expect(scripts).toHaveLength(1);
  return scripts[0].textContent ?? "";
}

type Regra = { contexto: string[]; seletor: string; corpo: string };

/** As regras de um CSS com as declarações, cada uma com as @-regras em volta (o mesmo leitor de tokens.test.ts). */
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

function declaracoes(corpo: string): Array<[string, string]> {
  return corpo
    .split(";")
    .map((linha) => linha.trim())
    .filter((linha) => linha.includes(":"))
    .map((linha) => [linha.slice(0, linha.indexOf(":")).trim(), linha.slice(linha.indexOf(":") + 1).trim()]);
}

/** As declarações de um seletor (exato) fora ou dentro das @-regras dadas; a última vale. */
function declarado(css: string, seletor: string, contexto: string[] = []): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const regra of regras(css)) {
    const lista = regra.seletor.split(",").map((parte) => parte.trim().replace(/\s+/g, " "));
    if (!lista.includes(seletor) || regra.contexto.join(" | ") !== contexto.join(" | ")) continue;
    for (const [nome, valor] of declaracoes(regra.corpo)) mapa.set(nome, valor);
  }
  return mapa;
}

const REDUZIDO = ["@media (prefers-reduced-motion: reduce)"];

/** A largura e a altura do PNG embutido (o cabeçalho IHDR). */
function dimensoesDoPng(src: string): [number, number] {
  const prefixo = "data:image/png;base64,";
  expect(src.startsWith(prefixo), src.slice(0, 40)).toBe(true);
  const bytes = Buffer.from(src.slice(prefixo.length), "base64");
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** Os tokens de tempo do index.css (`--carregando-t-*`), pelo valor. */
const TOKENS = new Map(
  [...INDEX_CSS.matchAll(/(--carregando-t-[\w-]+):\s*([^;]+);/g)].map(([, nome, valor]) => [nome, valor.trim()]),
);

describe("a abertura no index.html", () => {
  it("fica fora do #root, como irmão dele e antes dele, para o React nunca apagá-la", () => {
    const documento = pagina();
    const abertura = documento.getElementById("abertura");
    const raiz = documento.getElementById("root");
    expect(abertura).not.toBeNull();
    expect(raiz).not.toBeNull();
    expect(abertura!.parentElement).toBe(documento.body);
    expect(raiz!.parentElement).toBe(documento.body);
    expect(raiz!.contains(abertura)).toBe(false);
    expect(abertura!.compareDocumentPosition(raiz!) & documento.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A primeira coisa do corpo: nada pinta antes dela.
    expect(documento.body.firstElementChild).toBe(abertura);
  });

  it("tem a região de status com \"Abrindo a Dutelog\", só para o leitor de tela, desde a primeira pintura", () => {
    const abertura = pagina().getElementById("abertura")!;
    const status = abertura.querySelectorAll('[role="status"]');
    expect(status).toHaveLength(1);
    const leitor = status[0].querySelector(".ab-leitor");
    expect(leitor?.textContent).toBe("Abrindo a Dutelog");
    // A classe só para o leitor de tela recorta o texto (a mesma do sr-only).
    const css = declarado(estiloDaAbertura(), "#abertura .ab-leitor");
    expect(css.get("position")).toBe("absolute");
    expect(css.get("clip-path")).toBe("inset(50%)");
    expect(css.get("width")).toBe("1px");
    // Nenhum aria-live solto: só a região de status.
    expect(abertura.querySelectorAll("[aria-live]")).toHaveLength(0);
  });

  it("não tem texto visível na primeira pintura: o que tem texto é só do leitor ou está escondido", () => {
    const abertura = pagina().getElementById("abertura")!;
    const visivel = abertura.cloneNode(true) as HTMLElement;
    for (const fora of [...visivel.querySelectorAll(".ab-leitor, [hidden]")]) fora.remove();
    expect(textosDaTela(visivel.outerHTML)).toEqual([]);
    // Os textos que existem, para o leitor e para depois de 10 s.
    expect(textosDaTela(abertura.outerHTML)).toEqual(["Abrindo a Dutelog", "Tentar de novo"]);
  });

  it("traz a marca de 96 px decorativa e a palavra \"Dutelog\" com 24 px embutidas: nenhuma das duas espera a rede", () => {
    const abertura = pagina().getElementById("abertura")!;
    const marca = abertura.querySelector<HTMLImageElement>("img.ab-marca")!;
    // A marca de 180 px (a de dutelog-mark-180.png, já sobre o preto e com a paleta reduzida), mostrada em 96.
    expect(dimensoesDoPng(marca.getAttribute("src")!)).toEqual([180, 180]);
    expect(marca.getAttribute("alt")).toBe("");
    expect([marca.getAttribute("width"), marca.getAttribute("height")]).toEqual(["96", "96"]);
    const palavra = abertura.querySelector<HTMLImageElement>("img.ab-palavra")!;
    // A palavra clara em 3×, para ficar nítida também no celular de tela densa.
    expect(dimensoesDoPng(palavra.getAttribute("src")!)).toEqual([324, 72]);
    expect(palavra.getAttribute("alt")).toBe("Dutelog");
    expect([palavra.getAttribute("width"), palavra.getAttribute("height")]).toEqual(["108", "24"]);
    // As duas juntas pesam pouco: o HTML continua leve na primeira pintura.
    expect(marca.getAttribute("src")!.length + palavra.getAttribute("src")!.length).toBeLessThan(12_000);
    const css = estiloDaAbertura();
    expect(declarado(css, "#abertura .ab-marca").get("border-radius")).toBe("22px");
    expect(declarado(css, "#abertura .ab-palavra").get("height")).toBe("24px");
    expect(declarado(css, "#abertura .ab-palavra").get("bottom")).toBe("calc(48px + env(safe-area-inset-bottom, 0px))");
    // O trilho de 160 × 6 px, 40 px abaixo da marca, com o canto de 45° e o segmento de 36% em vermelho.
    const trilho = declarado(css, "#abertura .ab-trilho");
    expect([trilho.get("width"), trilho.get("height"), trilho.get("margin-top")]).toEqual(["160px", "6px", "40px"]);
    expect(trilho.get("clip-path")).toContain("calc(100% - 4px)");
    expect(declarado(css, "#abertura .ab-seg").get("width")).toBe("36%");
    expect(declarado(css, "#abertura .ab-seg").get("background")).toBe("#E71C23");
    expect(abertura.querySelector(".ab-trilho")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("é preta nos dois temas, sem depender da fonte, e a barra do navegador e o manifest emendam no mesmo preto", () => {
    const css = estiloDaAbertura();
    const raiz = declarado(css, "#abertura");
    expect(raiz.get("background")).toBe("#161616");
    expect(raiz.get("position")).toBe("fixed");
    expect(raiz.get("font")).toMatch(/Manrope,\s*system-ui/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(pagina().querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#161616");
    const manifest = VITE.slice(VITE.indexOf("manifest:"), VITE.indexOf("workbox:"));
    expect(manifest).toContain('background_color: "#161616"');
    expect(manifest).toContain('theme_color: "#161616"');
  });

  it("nenhuma folha externa segura a primeira pintura: sem rel=stylesheet de fora e sem @import do Google no index.css", () => {
    const documento = pagina();
    const externas = [...documento.querySelectorAll('link[rel~="stylesheet"]')].filter((link) =>
      /^(?:https?:)?\/\//.test(link.getAttribute("href") ?? ""),
    );
    expect(externas.map((link) => link.getAttribute("href"))).toEqual([]);
    // A Inter e a JetBrains Mono, que o app não usa, saíram.
    const fontes = [...documento.querySelectorAll("link[href]")].map((link) => link.getAttribute("href") ?? "");
    expect(fontes.filter((href) => /family=(?:Inter|JetBrains)/.test(href))).toEqual([]);
    // A Manrope (e as fontes do WMS) chegam por preload e viram folha quando chegam, com swap.
    const preload = documento.querySelector('link[rel="preload"][as="style"]');
    expect(preload?.getAttribute("href")).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=Manrope.*&display=swap$/);
    expect(preload?.getAttribute("onload")).toBe("this.onload=null;this.rel='stylesheet'");
    // Um @import na folha do app seguraria a pintura até o Google responder.
    const semComentarios = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/@import\s+(?:url\()?['"]?https?:/);
    for (const estilo of documento.querySelectorAll("style")) expect(estilo.textContent).not.toMatch(/@import/);
  });

  it("cada tempo do CSS da abertura é um token do relógio, e o script usa os mesmos", () => {
    const css = estiloDaAbertura();
    // Toda duração e todo atraso escritos no CSS, com a regra em que aparecem.
    const tempos = regras(css)
      .filter((regra) => !regra.contexto.some((fora) => fora.startsWith("@keyframes")))
      .flatMap((regra) =>
        declaracoes(regra.corpo)
          .filter(([nome]) => nome === "animation" || nome === "transition" || nome === "--ab-espera")
          .flatMap(([, valor]) => [...valor.matchAll(/(\d+)ms/g)].map(([, ms]) => Number(ms))),
      );
    const doRelogio = new Set([
      0,
      CARREGANDO.atrasoMs,
      CARREGANDO.aberturaSaiMs,
      CARREGANDO.aberturaCompletaMs,
      CARREGANDO.aberturaMarcaSaiMs,
      CARREGANDO.aberturaSegmentoSaiMs,
      parseInt(TOKENS.get("--carregando-t-entrada")!, 10),
      parseInt(TOKENS.get("--carregando-t-saida")!, 10),
      parseInt(TOKENS.get("--carregando-t-varredura")!, 10),
    ]);
    expect(tempos.filter((ms) => !doRelogio.has(ms))).toEqual([]);
    // Cada um no seu lugar.
    expect(declarado(css, "#abertura[data-fechando] .ab-centro").get("animation")).toMatch(
      new RegExp(`^abertura-recua ${CARREGANDO.aberturaMarcaSaiMs}ms `),
    );
    expect(declarado(css, "#abertura[data-fechando] .ab-palavra").get("animation")).toMatch(
      new RegExp(`^abertura-esmaece ${CARREGANDO.aberturaMarcaSaiMs}ms `),
    );
    expect(declarado(css, '#abertura[data-fechando="completa"] .ab-seg').get("transition")).toBe(
      `opacity ${CARREGANDO.aberturaSegmentoSaiMs}ms linear`,
    );
    expect(declarado(css, "#abertura .ab-linha").get("animation")).toMatch(new RegExp(`^abertura-aviso ${TOKENS.get("--carregando-t-entrada")} `));
    expect(declarado(css, "#abertura .ab-tentar").get("animation")).toMatch(new RegExp(`^abertura-aviso ${TOKENS.get("--carregando-t-entrada")} `));
    expect(declarado(css, "#abertura .ab-linha[data-sai]").get("animation")).toMatch(
      new RegExp(`^abertura-aviso-sai ${TOKENS.get("--carregando-t-saida")} `),
    );
    // O script: a saída do aviso e o intervalo entre avisos, os mesmos do CSS e do Anunciador.
    const script = scriptDaAbertura();
    expect(`${/var SAIDA_MS = (\d+);/.exec(script)?.[1]}ms`).toBe(TOKENS.get("--carregando-t-saida"));
    expect(Number(/var INTERVALO_MS = (\d+);/.exec(script)?.[1])).toBe(INTERVALO_DO_ANUNCIO_MS);
  });

  it("o aviso que sai sobe e esmaece (só opacidade no reduzido)", () => {
    const css = estiloDaAbertura();
    const sai = regras(css).filter((regra) => regra.contexto.includes("@keyframes abertura-aviso-sai"));
    expect(sai.flatMap((regra) => declaracoes(regra.corpo))).toEqual([
      ["opacity", "0"],
      ["transform", "translateY(-4px)"],
    ]);
    expect(declarado(css, "#abertura .ab-linha[data-sai]", REDUZIDO).get("animation-name")).toBe("abertura-esmaece");
  });

  it("no alto contraste do Windows, mantém as próprias cores: o trilho e a palavra não somem no fundo forçado", () => {
    expect(declarado(estiloDaAbertura(), "#abertura", ["@media (forced-colors: active)"]).get("forced-color-adjust")).toBe("none");
  });

  it("quando o aviso não cabe acima da palavra (o celular deitado), a palavra cede o lugar", () => {
    expect(declarado(estiloDaAbertura(), "#abertura[data-apertada] .ab-palavra").get("visibility")).toBe("hidden");
  });

  it("enquanto ela cobre a tela, o #root fica inerte: nem o Tab nem o leitor de tela chegam ao que está por baixo", () => {
    expect(pagina().getElementById("root")?.hasAttribute("inert")).toBe(true);
  });

  it("o movimento: em laço só transform e opacity, nos tempos do relógio", () => {
    const css = estiloDaAbertura();
    const foraDoCompositor = regras(css)
      .filter((regra) => regra.contexto.some((fora) => /^@keyframes\s+/.test(fora)))
      .flatMap((regra) =>
        declaracoes(regra.corpo)
          .map(([propriedade]) => propriedade)
          .filter((propriedade) => propriedade !== "transform" && propriedade !== "opacity"),
      );
    expect(foraDoCompositor).toEqual([]);
    expect(regras(css).some((regra) => regra.contexto.includes("@keyframes abertura-varre"))).toBe(true);
    // O trilho entra aos 300 ms em 150 ms; o segmento varre em 1,4 s (o --carregando-t-varredura), em laço.
    const tokens = new Map(
      [...INDEX_CSS.matchAll(/(--carregando-t-[\w-]+):\s*([^;]+);/g)].map(([, nome, valor]) => [nome, valor.trim()]),
    );
    expect(declarado(css, "#abertura .ab-trilho").get("animation")).toBe(
      `abertura-entra ${tokens.get("--carregando-t-entrada")} cubic-bezier(.2,0,0,1) ${CARREGANDO.atrasoMs}ms both`,
    );
    expect(declarado(css, "#abertura .ab-seg").get("animation")).toBe(
      `abertura-varre ${tokens.get("--carregando-t-varredura")} cubic-bezier(.2,.55,.8,.45) ${CARREGANDO.atrasoMs}ms infinite both`,
    );
    // A saída: o trilho completa em 200 ms e tudo esmaece em 260 ms, com a marca a 0,96.
    expect(declarado(css, '#abertura[data-fechando="completa"]').get("--ab-espera")).toBe(`${CARREGANDO.aberturaCompletaMs}ms`);
    expect(declarado(css, '#abertura[data-fechando="completa"] .ab-completa').get("animation")).toMatch(
      new RegExp(`^abertura-completa ${CARREGANDO.aberturaCompletaMs}ms `),
    );
    expect(declarado(css, "#abertura[data-fechando]").get("animation")).toMatch(
      new RegExp(`^abertura-esmaece ${CARREGANDO.aberturaSaiMs}ms `),
    );
    expect(declarado(css, "#abertura[data-fechando]").get("pointer-events")).toBe("none");
    const recua = regras(css).find((regra) => regra.contexto.includes("@keyframes abertura-recua"));
    expect(declaracoes(recua!.corpo)).toEqual([
      ["opacity", "0"],
      ["transform", "scale(.96)"],
    ]);
    // Antes de 300 ms, o trilho nem aparece na saída.
    expect(declarado(css, '#abertura[data-fechando="cedo"] .ab-trilho').get("opacity")).toBe("0");
  });

  it("no movimento reduzido, o trilho fica inteiro em vermelho, parado, e tudo entra e sai só por opacidade", () => {
    const css = estiloDaAbertura();
    expect(declarado(css, "#abertura .ab-seg", REDUZIDO).get("animation")).toBe("none");
    expect(declarado(css, "#abertura .ab-seg", REDUZIDO).get("width")).toBe("100%");
    expect(declarado(css, "#abertura .ab-linha", REDUZIDO).get("animation-name")).toBe("abertura-entra");
    expect(declarado(css, "#abertura[data-fechando] .ab-centro", REDUZIDO).get("animation-name")).toBe("abertura-esmaece");
    expect(declarado(css, '#abertura[data-fechando="completa"] .ab-completa', REDUZIDO).get("animation")).toBe("none");
    const entra = regras(css).filter((regra) => regra.contexto.includes("@keyframes abertura-entra"));
    expect(entra.flatMap((regra) => declaracoes(regra.corpo).map(([nome]) => nome))).toEqual(["opacity"]);
  });

  it("\"Tentar de novo\" tem 44 px, o foco visível e as cores com contraste sobre o preto", () => {
    const css = estiloDaAbertura();
    const botao = declarado(css, "#abertura .ab-tentar");
    expect(botao.get("height")).toBe("44px");
    expect(declarado(css, "#abertura .ab-tentar:focus-visible").get("outline")).toBe("2px solid #fff");
    // #F3DCA3 sobre #161616: 13,4:1.
    expect(declarado(css, "#abertura .ab-aviso").get("color")).toBe("#F3DCA3");
    const tentar = pagina().querySelector("#abertura .ab-tentar")!;
    expect(tentar.getAttribute("type")).toBe("button");
    expect(tentar.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("no build, nada antes da abertura segura a primeira pintura", () => {
  // O <head> e o fim do <body> como o Vite os deixa no build (dist/public/index.html).
  const DO_BUILD = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <style>#abertura{background:#161616}</style>
    <script type="module" crossorigin src="/assets/shell-app-BcoCtmB8.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/shell-react-DLrhNm74.js">
    <link rel="stylesheet" crossorigin href="/assets/index-DHVW3yKc.css">
  <link rel="manifest" href="/manifest.webmanifest"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js" defer></script></head>
  <body>
    <div id="abertura"><img class="ab-marca" src="/dutelog-mark-180.png" alt="" /></div>
    <script>(function () {})();</script>
    <div id="root"></div>
  </body>
</html>`;

  it("a folha do app sai do <head> e fica logo antes do #root, depois da abertura", () => {
    const html = folhasDepoisDaAbertura(DO_BUILD);
    const documento = new JSDOM(html).window.document;
    expect(documento.head.querySelector('link[rel="stylesheet"]')).toBeNull();
    const folha = documento.body.querySelector('link[rel="stylesheet"]');
    expect(folha?.getAttribute("href")).toBe("/assets/index-DHVW3yKc.css");
    expect(folha?.nextElementSibling?.id).toBe("root");
    expect(html).toContain('    <link rel="stylesheet" crossorigin href="/assets/index-DHVW3yKc.css">\n    <div id="root"></div>');
    // O resto do HTML não muda, e rodar de novo não mexe.
    expect(html.replace(/\s+/g, "")).toHaveLength(DO_BUILD.replace(/\s+/g, "").length);
    expect(folhasDepoisDaAbertura(html)).toBe(html);
  });

  it("com o #root inerte (o index.html real), a folha também fica logo antes dele", () => {
    const html = folhasDepoisDaAbertura(DO_BUILD.replace('<div id="root"></div>', '<div id="root" inert></div>'));
    const folha = new JSDOM(html).window.document.body.querySelector('link[rel="stylesheet"]');
    expect(folha?.nextElementSibling?.id).toBe("root");
  });

  it("sem a abertura antes do #root, o build falha em vez de servir a folha no lugar errado", () => {
    expect(() => folhasDepoisDaAbertura(DO_BUILD.replace('<div id="abertura">', '<div id="outra">'))).toThrow(/abertura/);
    // Sem folha do app (o desenvolvimento, em que o Vite põe o CSS pelo JavaScript), nada muda.
    const semFolha = DO_BUILD.replace(/\s*<link rel="stylesheet"[^>]*>/, "");
    expect(folhasDepoisDaAbertura(semFolha)).toBe(semFolha);
  });

  it("o vite.config.ts usa a troca no build e registra o service worker com defer, sem parar a leitura do HTML", () => {
    expect(VITE).toContain('import { folhasDepoisDaAbertura } from "./src/lib/abertura-no-build";');
    expect(VITE).toMatch(/transformIndexHtml: \{ order: "post", handler: folhasDepoisDaAbertura \}/);
    expect(VITE).toMatch(/plugins: \[[\s\S]*folhaDepoisDaAbertura\(\),[\s\S]*VitePWA\(/);
    expect(VITE).toContain('injectRegister: "script-defer"');
  });

  it("a abertura não pede nada à rede; no <head>, nenhum script que pare a leitura", () => {
    const documento = pagina();
    // A marca e a palavra vêm embutidas: nenhum pedido de imagem disputa a rede com o JavaScript.
    expect(documento.querySelector('link[rel="preload"][as="image"]')).toBeNull();
    for (const imagem of documento.querySelectorAll("#abertura img")) expect(imagem.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    const bloqueiam = [...documento.head.querySelectorAll("script[src]")].filter(
      (script) => script.getAttribute("type") !== "module" && !script.hasAttribute("defer") && !script.hasAttribute("async"),
    );
    expect(bloqueiam).toEqual([]);
  });
});

describe("o script da abertura: sem rede aos 3 s, demorando aos 10 s", () => {
  const navegador = { onLine: true };
  const recarregar = vi.fn();

  function montar() {
    document.body.innerHTML = pagina().body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "");
    const janela = {
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      location: { reload: recarregar },
    };
    // O script do index.html, com a janela, o navegador e o relógio do teste.
    new Function("window", "navigator", "document", "performance", "setTimeout", "clearTimeout", scriptDaAbertura())(
      janela,
      navegador,
      document,
      performance,
      setTimeout,
      clearTimeout,
    );
    return document.getElementById("abertura")!;
  }

  const linha = () => document.querySelector<HTMLElement>("#abertura .ab-linha")!;
  const tentar = () => document.querySelector<HTMLButtonElement>("#abertura .ab-tentar")!;
  const status = () => document.querySelector('#abertura [role="status"]')!.textContent;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    navegador.onLine = true;
    recarregar.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("marca quando apareceu, para a saída saber se o trilho já está à vista", () => {
    vi.advanceTimersByTime(1234);
    expect(montar().getAttribute("data-desde")).toBe("1234");
  });

  it("com rede, nada aparece até 10 s; aos 10 s, \"Demorando mais que o normal\" e \"Tentar de novo\"", () => {
    montar();
    vi.advanceTimersByTime(9_999);
    expect(linha().hidden).toBe(true);
    expect(tentar().hidden).toBe(true);
    expect(status()).toBe("Abrindo a Dutelog");
    vi.advanceTimersByTime(1);
    expect(linha().hidden).toBe(false);
    expect(linha().textContent).toBe("Demorando mais que o normal");
    expect(linha().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(tentar().hidden).toBe(false);
    // O aviso entra na região de status; o botão fica fora dela e não rouba o foco.
    expect(status()).toBe("Abrindo a DutelogDemorando mais que o normal");
    expect(document.activeElement).toBe(document.body);
    tentar().click();
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("sem rede, \"Sem conexão\" aos 3 s; quando a rede volta, ele sobe e esmaece, no máximo um aviso a cada 2 s", () => {
    navegador.onLine = false;
    montar();
    vi.advanceTimersByTime(2_999);
    expect(linha().hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(linha().textContent).toBe("Sem conexão");
    expect(linha().hasAttribute("data-sai")).toBe(false);
    expect(tentar().hidden).toBe(true);
    // A rede volta logo: o aviso fica até completar 2 s na região, e então sai em 180 ms.
    vi.advanceTimersByTime(500);
    navegador.onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(linha().textContent).toBe("Sem conexão");
    vi.advanceTimersByTime(INTERVALO_DO_ANUNCIO_MS - 500);
    expect(linha().textContent).toBe("Sem conexão");
    expect(linha().hasAttribute("data-sai")).toBe(true);
    vi.advanceTimersByTime(180);
    expect(linha().hidden).toBe(true);
    expect(linha().hasAttribute("data-sai")).toBe(false);
    // Cai de novo depois de 2 s: entra uma linha nova (a entrada roda outra vez).
    vi.advanceTimersByTime(INTERVALO_DO_ANUNCIO_MS);
    navegador.onLine = false;
    window.dispatchEvent(new Event("offline"));
    expect(linha().textContent).toBe("Sem conexão");
    // Aos 10 s sem rede, continua "Sem conexão", agora com "Tentar de novo".
    vi.advanceTimersByTime(10_000);
    expect(linha().textContent).toBe("Sem conexão");
    expect(tentar().hidden).toBe(false);
  });

  it("a rede que oscila não faz a região falar mais de uma vez a cada 2 s", () => {
    navegador.onLine = false;
    montar();
    vi.advanceTimersByTime(3_000);
    const falas: string[] = [];
    const regiao = document.querySelector('#abertura [role="status"]')!;
    const observador = new MutationObserver(() => falas.push(regiao.textContent ?? ""));
    observador.observe(regiao, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
    const trocas: number[] = [];
    let ultimo = linha().hidden ? "" : linha().textContent;
    for (let passo = 0; passo < 12; passo += 1) {
      navegador.onLine = !navegador.onLine;
      window.dispatchEvent(new Event(navegador.onLine ? "online" : "offline"));
      for (let ms = 0; ms < 400; ms += 20) {
        vi.advanceTimersByTime(20);
        const agora = linha().hidden ? "" : linha().textContent;
        if (agora !== ultimo) {
          trocas.push(performance.now());
          ultimo = agora;
        }
      }
    }
    observador.disconnect();
    // Em 4,8 s de rede oscilando a cada 400 ms, no máximo três textos novos na região.
    expect(trocas.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < trocas.length; i += 1) expect(trocas[i] - trocas[i - 1]).toBeGreaterThanOrEqual(INTERVALO_DO_ANUNCIO_MS);
  });

  it("aos 70 s, \"Sem resposta\", depois que \"Demorando mais que o normal\" sai", () => {
    montar();
    vi.advanceTimersByTime(10_000);
    expect(linha().textContent).toBe("Demorando mais que o normal");
    vi.advanceTimersByTime(60_000);
    expect(linha().hasAttribute("data-sai")).toBe(true);
    vi.advanceTimersByTime(180);
    expect(linha().textContent).toBe("Sem resposta");
    expect(linha().hasAttribute("data-sai")).toBe(false);
    expect(tentar().hidden).toBe(false);
  });

  it("quando o aviso e o botão não cabem acima da palavra, a palavra cede o lugar; com espaço, fica", () => {
    const abertura = montar();
    const palavra = abertura.querySelector<HTMLElement>(".ab-palavra")!;
    const aviso = abertura.querySelector<HTMLElement>(".ab-aviso")!;
    let topoDaPalavra = 318;
    palavra.getBoundingClientRect = () => ({ top: topoDaPalavra, height: 24, bottom: topoDaPalavra + 24 }) as DOMRect;
    aviso.getBoundingClientRect = () => ({ top: 273, height: 93, bottom: 366 }) as DOMRect;
    // Sem aviso, nada a ceder.
    vi.advanceTimersByTime(9_999);
    expect(abertura.hasAttribute("data-apertada")).toBe(false);
    // O celular deitado (844 × 390): o botão iria até 366 px e a palavra começa em 318.
    vi.advanceTimersByTime(1);
    expect(abertura.hasAttribute("data-apertada")).toBe(true);
    // Girou para em pé: a palavra desce para 772 px e volta.
    topoDaPalavra = 772;
    window.dispatchEvent(new Event("resize"));
    expect(abertura.hasAttribute("data-apertada")).toBe(false);
  });

  it("o axe, na primeira pintura e com o aviso e o botão à vista", async () => {
    navegador.onLine = false;
    montar();
    const primeira = document.getElementById("abertura")!.outerHTML;
    vi.advanceTimersByTime(10_000);
    const comAviso = document.getElementById("abertura")!.outerHTML;
    expect(textosDaTela(comAviso)).toEqual(["Abrindo a Dutelog", "Sem conexão", "Tentar de novo"]);
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(primeira)).toEqual([]);
    expect(await violacoesDeAcessibilidade(comAviso)).toEqual([]);
  });

  it("os marcos são os do relógio (3 s, 10 s e 70 s)", () => {
    const marcos = /\[(\d+),\s*(\d+),\s*(\d+)\]\.forEach/.exec(scriptDaAbertura())?.slice(1).map(Number);
    expect(marcos).toEqual([CARREGANDO.objetoNaLinhaMs, CARREGANDO.demoraMs, CARREGANDO.desisteMs]);
  });

  it("para quando a abertura começa a sair", () => {
    const abertura = montar();
    abertura.setAttribute("data-fechando", "completa");
    vi.advanceTimersByTime(10_000);
    expect(linha().hidden).toBe(true);
    expect(tentar().hidden).toBe(true);
  });
});

describe("fecharAbertura", () => {
  function comAbertura(desde: number | null) {
    document.body.innerHTML = '<div id="abertura"></div><div id="root"></div>';
    const abertura = document.getElementById("abertura")!;
    if (desde !== null) abertura.setAttribute("data-desde", String(desde));
    return abertura;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("antes de 300 ms só esmaece, em 260 ms, e sai do documento", () => {
    vi.advanceTimersByTime(100);
    const abertura = comAbertura(0);
    expect(aberturaAberta()).toBe(true);
    fecharAbertura();
    expect(abertura.getAttribute("data-fechando")).toBe("cedo");
    expect(aberturaAberta()).toBe(false);
    // Sai da árvore de acessibilidade e do toque na hora.
    expect(abertura.getAttribute("aria-hidden")).toBe("true");
    expect(abertura.hasAttribute("inert")).toBe(true);
    expect(duracaoDaSaida("cedo")).toBe(260);
    // Sai quando o esmaecer termina.
    abertura.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), { animationName: "abertura-esmaece" }));
    expect(document.getElementById("abertura")).toBeNull();
    expect(document.getElementById("root")).not.toBeNull();
  });

  it("sem o fim da animação, sai logo depois dos 260 ms", () => {
    const abertura = comAbertura(performance.now());
    fecharAbertura();
    vi.advanceTimersByTime(CARREGANDO.aberturaSaiMs + FOLGA_DA_SAIDA_MS - 1);
    expect(abertura.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(abertura.isConnected).toBe(false);
  });

  it("com o trilho à vista, o segmento completa (200 ms) antes do esmaecer", () => {
    const abertura = comAbertura(0);
    vi.advanceTimersByTime(300);
    fecharAbertura();
    expect(abertura.getAttribute("data-fechando")).toBe("completa");
    expect(duracaoDaSaida("completa")).toBe(460);
    // O filho que esmaece (a palavra) não tira a abertura antes da hora.
    const filho = document.createElement("img");
    abertura.append(filho);
    filho.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), { animationName: "abertura-esmaece" }));
    expect(abertura.isConnected).toBe(true);
    vi.advanceTimersByTime(460 + FOLGA_DA_SAIDA_MS);
    expect(abertura.isConnected).toBe(false);
  });

  it("no movimento reduzido, só esmaece, mesmo com o trilho à vista", () => {
    const abertura = document.createElement("div");
    abertura.setAttribute("data-desde", "0");
    expect(saidaDaAbertura(abertura, 5_000, true)).toBe("esmaece");
    expect(saidaDaAbertura(abertura, 5_000, false)).toBe("completa");
    expect(saidaDaAbertura(abertura, 299, false)).toBe("cedo");
    // Sem a marca do script, conta como à vista.
    expect(saidaDaAbertura(document.createElement("div"), 0, false)).toBe("completa");
    const original = window.matchMedia;
    window.matchMedia = ((consulta: string) => ({ matches: consulta === "(prefers-reduced-motion: reduce)" })) as typeof window.matchMedia;
    try {
      const real = comAbertura(0);
      vi.advanceTimersByTime(1_000);
      fecharAbertura();
      expect(real.getAttribute("data-fechando")).toBe("esmaece");
    } finally {
      window.matchMedia = original;
    }
  });

  it("é idempotente: a segunda chamada, no meio do esmaecer, não refaz a saída nem adia o fim", () => {
    const abertura = comAbertura(0);
    fecharAbertura();
    expect(abertura.getAttribute("data-fechando")).toBe("cedo");
    // No meio do esmaecer, com o trilho já "à vista": sem a trava, a saída viraria "completa" e ganharia outro prazo.
    vi.advanceTimersByTime(100);
    abertura.setAttribute("data-desde", "-5000");
    fecharAbertura();
    expect(abertura.getAttribute("data-fechando")).toBe("cedo");
    vi.advanceTimersByTime(CARREGANDO.aberturaSaiMs + FOLGA_DA_SAIDA_MS - 100);
    expect(abertura.isConnected).toBe(false);
    expect(() => fecharAbertura()).not.toThrow();
  });

  it("solta o #root na hora em que começa a sair; sem a abertura, solta do mesmo jeito", () => {
    const abertura = comAbertura(0);
    const raiz = document.getElementById("root")!;
    raiz.setAttribute("inert", "");
    expect(aberturaNaTela()).toBe(true);
    fecharAbertura();
    expect(raiz.hasAttribute("inert")).toBe(false);
    // Esmaecendo, ela ainda está na tela.
    expect(aberturaNaTela()).toBe(true);
    vi.advanceTimersByTime(CARREGANDO.aberturaSaiMs + FOLGA_DA_SAIDA_MS);
    expect(abertura.isConnected).toBe(false);
    expect(aberturaNaTela()).toBe(false);
    document.body.innerHTML = '<div id="root" inert></div>';
    fecharAbertura();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(false);
  });

  it("sem a abertura (os testes, a demo), não faz nada", () => {
    document.body.innerHTML = '<div id="root"></div>';
    expect(() => fecharAbertura()).not.toThrow();
    expect(aberturaAberta()).toBe(false);
  });
});
