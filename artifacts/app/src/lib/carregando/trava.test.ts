import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A trava do carregamento v2 (parte 13h, a última da seção 10.4 do
 * diagnóstico; especificação de 12/11/2026, seção 10, PR 13). Lê os arquivos
 * do app e reprova o que as partes 1 a 13g tiraram de cena, com a lista do
 * que achou:
 *
 * - `animate-spin` fora do `Spinner`: o indicador é a caixa chanfrada, que
 *   gira pelo compasso dela (`components/ui/spinner.tsx`);
 * - `animate-pulse` fora do `Esqueleto` e do `Skeleton`: o bloco pulsando
 *   saiu, e o esqueleto é neutro, com o brilho de dois ciclos;
 * - "..." com três pontos num rótulo ou texto da tela: a reticência é o
 *   caractere "…", no DOM (seção 7).
 *
 * E o anel do foco (WCAG 1.4.11 e 2.4.7): o anel é o token `--foco` cheio
 * (`ring-foco`, 3:1 nos dois temas, conferido em tokens.test.ts), nunca o
 * `--ring` a 40% (1,91:1 no claro e 1,65:1 no escuro), e o contorno sai pelo
 * `outline-hidden`, que nas cores forçadas desenha o contorno transparente
 * que o sistema pinta. O `outline-none` do Tailwind v4 o tiraria também lá, e
 * o anel, que é sombra, some nas cores forçadas.
 *
 * Só conta o que é texto do código: os literais de string, os modelos e o
 * texto do JSX. Os comentários e os testes ficam de fora.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Os arquivos do app, sem os testes e sem o apoio deles (src/test). */
function arquivosDoApp(pasta = SRC): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return relative(SRC, caminho) === "test" ? [] : arquivosDoApp(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !/\.d\.ts$/.test(nome) ? [caminho] : [];
  });
}

type Trecho = { onde: string; texto: string };

/** O texto do código de um arquivo: cada literal de string, cada pedaço de modelo e cada texto do JSX, com a linha. */
function trechosDe(nome: string, fonte: string): Trecho[] {
  const arquivo = ts.createSourceFile(nome, fonte, ts.ScriptTarget.Latest, true, nome.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const achados: Trecho[] = [];
  const visitar = (no: ts.Node) => {
    if (
      ts.isStringLiteral(no) ||
      ts.isNoSubstitutionTemplateLiteral(no) ||
      ts.isTemplateHead(no) ||
      ts.isTemplateMiddle(no) ||
      ts.isTemplateTail(no) ||
      ts.isJsxText(no)
    ) {
      const { line } = arquivo.getLineAndCharacterOfPosition(no.getStart(arquivo));
      achados.push({ onde: `${nome}:${line + 1}`, texto: no.text });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

const TRECHOS: Trecho[] = arquivosDoApp().flatMap((caminho) =>
  trechosDe(relative(SRC, caminho).split(sep).join("/"), readFileSync(caminho, "utf8")),
);

const arquivoDo = (trecho: Trecho) => trecho.onde.replace(/:\d+$/, "");
const lista = (trechos: Trecho[]) => trechos.map((trecho) => `${trecho.onde} ${JSON.stringify(trecho.texto.trim().slice(0, 80))}`);

const GIRO = /\banimate-(?:spin\b|\[spin)/;
const PULSO = /\banimate-(?:pulse\b|\[pulse)/;
const TRES_PONTOS = /\.\.\./;

/** Quem pode girar e pulsar. Vazias de exceção: só as peças. */
const PODE_GIRAR = new Set(["components/ui/spinner.tsx"]);
const PODE_PULSAR = new Set(["components/ui/esqueleto.tsx", "components/ui/skeleton.tsx"]);

describe("a leitura do código", () => {
  it("acha a classe e o texto da tela, e não o comentário nem o espalhamento", () => {
    const fonte = [
      "// animate-spin e Carregando... no comentário não contam",
      "/* animate-pulse */",
      "const outro = { ...base };",
      'export const A = () => <p className={`flex ${x ? "animate-spin" : ""}`} title="Abrindo...">Salvando...</p>;',
    ].join("\n");
    const trechos = trechosDe("exemplo.tsx", fonte);
    expect(trechos.filter((trecho) => GIRO.test(trecho.texto)).map((trecho) => trecho.onde)).toEqual(["exemplo.tsx:4"]);
    expect(trechos.filter((trecho) => PULSO.test(trecho.texto))).toEqual([]);
    expect(trechos.filter((trecho) => TRES_PONTOS.test(trecho.texto)).map((trecho) => trecho.texto)).toEqual(["Abrindo...", "Salvando..."]);
  });

  it("lê o app inteiro", () => {
    const arquivos = new Set(TRECHOS.map(arquivoDo));
    expect(arquivos.size).toBeGreaterThan(400);
    for (const peca of ["components/ui/spinner.tsx", "components/ui/esqueleto.tsx", "components/ui/button.tsx", "App.tsx"]) {
      expect(arquivos.has(peca), peca).toBe(true);
    }
  });
});

describe("a trava do carregamento v2", () => {
  it("animate-spin só no Spinner", () => {
    expect(lista(TRECHOS.filter((trecho) => GIRO.test(trecho.texto) && !PODE_GIRAR.has(arquivoDo(trecho))))).toEqual([]);
  });

  it("animate-pulse só no Esqueleto e no Skeleton", () => {
    expect(lista(TRECHOS.filter((trecho) => PULSO.test(trecho.texto) && !PODE_PULSAR.has(arquivoDo(trecho))))).toEqual([]);
  });

  it("nenhum texto com três pontos: a reticência é o caractere …", () => {
    expect(lista(TRECHOS.filter((trecho) => TRES_PONTOS.test(trecho.texto)))).toEqual([]);
  });

  it("o index.css não gira nem pulsa por fora das peças", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/@apply[^;]*\banimate-(?:spin|pulse)\b|animation(?:-name)?\s*:[^;]*\b(?:spin|pulse)\b/g) ?? []).toEqual([]);
  });
});

/*
 * O anel do foco. Uma classe é anel de foco quando a variante tem o foco
 * (focus, focus-visible, focus-within, has-focus…) e a utilidade é a cor do
 * ring. A largura (ring-2), o recuo (ring-offset-*) e o ring-inset não são cor.
 */

const VARIANTE_DO_FOCO = /(?:^|:)(?:group-|peer-)?(?:focus|focus-visible|focus-within|has-focus)(?::|$)/;

function corDoAnel(classe: string): string | null {
  const corte = classe.lastIndexOf(":");
  if (corte < 0) return null;
  const variante = classe.slice(0, corte);
  const utilidade = classe.slice(corte + 1);
  if (!VARIANTE_DO_FOCO.test(variante)) return null;
  const cor = /^ring-(?!\d|\[|offset-|inset$)(.+)$/.exec(utilidade);
  return cor ? cor[1] : null;
}

/**
 * As cores que o anel pode ter: o --foco; na barra preta, o branco dela a 80%
 * (11,6:1 sobre o #161616); no toast crítico, a cor do texto dele.
 */
const CORES_DO_ANEL = new Set(["foco", "v3-header-foreground/80"]);
const CORES_NO_TOAST_CRITICO = new Set(["destructive", "destructive-foreground"]);

/**
 * O campo cujo foco é a borda cheia (o --primary, 4,58:1 no branco da v3 e
 * 4,4:1 no cartão escuro) pode ter, além dela, o halo claro do --ring ou do
 * --primary. A borda a 60% não conta: no branco, ela fica abaixo de 3:1.
 */
const BORDA_DO_FOCO = /(?:^|:)(?:focus|focus-visible|has-focus):border-(?:primary|ring|foco)$/;

/** O que, nas cores forçadas, fica à vista no foco: o contorno transparente do outline-hidden, ou um contorno de verdade. */
const CONTORNO_DO_FOCO = /^(?:[\w-]+:)*(?:focus|focus-visible|focus-within|has-focus):outline-(?:hidden|solid|2)$/;

function problemasDoAnel(texto: string): string[] {
  const classes = texto.split(/\s+/).filter(Boolean);
  const cores = classes.flatMap((classe) => {
    const cor = corDoAnel(classe);
    return cor === null ? [] : [{ classe, cor }];
  });
  if (cores.length === 0) return [];
  const problemas: string[] = [];
  const temBorda = classes.some((classe) => BORDA_DO_FOCO.test(classe));
  for (const { classe, cor } of cores) {
    if (CORES_DO_ANEL.has(cor)) continue;
    if (classe.includes("group-[.destructive]:") && CORES_NO_TOAST_CRITICO.has(cor)) continue;
    if (temBorda && /^(?:ring|primary)\/\d+$/.test(cor)) continue;
    problemas.push(classe);
  }
  for (const classe of classes) if (/(?:^|:)outline-none$/.test(classe)) problemas.push(classe);
  if (!classes.some((classe) => CONTORNO_DO_FOCO.test(classe))) problemas.push("sem outline-hidden no foco");
  return problemas;
}

describe("o anel do foco (parte 13h)", () => {
  it("a regra separa o anel bom do apagado", () => {
    expect(problemasDoAnel("rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco focus-visible:ring-offset-2")).toEqual([]);
    expect(problemasDoAnel("rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40")).toEqual([
      "focus-visible:ring-ring/40",
      "focus-visible:outline-none",
      "sem outline-hidden no foco",
    ]);
    expect(problemasDoAnel("outline-none focus-visible:ring-2 focus-visible:ring-ring")).toEqual([
      "focus-visible:ring-ring",
      "outline-none",
      "sem outline-hidden no foco",
    ]);
    // O label que embrulha o arquivo escondido: o anel de quem está dentro, também nas cores forçadas.
    expect(problemasDoAnel("focus-within:ring-2 focus-within:ring-foco")).toEqual(["sem outline-hidden no foco"]);
    // O campo com a borda cheia pode ter o halo; a borda a 60% não conta como borda.
    expect(problemasDoAnel("border-input focus-visible:border-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/25")).toEqual([]);
    expect(problemasDoAnel("focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/15")).toEqual([]);
    expect(problemasDoAnel("outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15")).toEqual([
      "focus:ring-primary/15",
      "outline-none",
      "sem outline-hidden no foco",
    ]);
    // A largura, o recuo e o inset não são cor; sem cor de anel, a classe não é anel.
    expect(problemasDoAnel("ring-2 ring-offset-2 ring-ring/60 outline-none")).toEqual([]);
  });

  it("todo anel de foco do app é o --foco cheio, com o contorno das cores forçadas", () => {
    const achados = TRECHOS.flatMap((trecho) => {
      const problemas = problemasDoAnel(trecho.texto);
      return problemas.length ? [`${trecho.onde} ${problemas.join(", ")}`] : [];
    });
    expect(achados).toEqual([]);
  });

  it("o Button e o título dos grupos da fila usam o anel cheio", () => {
    const fonte = (arquivo: string) => readFileSync(join(SRC, arquivo), "utf8");
    for (const arquivo of ["components/ui/button.tsx", "components/ui/queue-list.tsx", "components/ui/carregando-na-regiao.tsx"]) {
      expect(fonte(arquivo), arquivo).toContain("focus-visible:ring-foco");
      expect(fonte(arquivo), arquivo).not.toMatch(/ring-ring\/\d+/);
    }
  });
});
