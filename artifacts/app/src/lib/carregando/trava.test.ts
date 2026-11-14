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

/*
 * O foco sem anel (revisão da parte 13h; WCAG 2.4.7 e 1.4.11). O anel não é
 * o único sinal de foco do app: o campo acende a borda, e o item de menu do
 * Radix acende o fundo. Mas o contorno do navegador só sai de cena com outro
 * sinal no lugar, e nunca pelo outline-none, que o tira também das cores
 * forçadas (lá a sombra do anel e o fundo somem, e o que fica é o contorno
 * transparente do outline-hidden, que o sistema pinta):
 *
 * - `outline-none` em nenhuma classe do app;
 * - a borda do foco é cheia (o --primary tem 4,6:1 no branco da v3 e 4,4:1 no
 *   cartão escuro); a 40%, 50% ou 60%, ela fica abaixo de 3:1;
 * - quem esconde o contorno (o outline-hidden) mostra o foco no mesmo lugar:
 *   o anel, a borda cheia ou, nos itens dos menus, listas e abas do Radix e
 *   do cmdk (o foco que anda pelas setas), o fundo realçado. O resto mostra o
 *   foco em outro lugar, e está na lista abaixo, com o porquê.
 */

/** Os componentes cujo item com foco é o realçado pelo fundo (o foco que anda pelas setas). */
const MENUS = new Set([
  "components/ui/command.tsx",
  "components/ui/context-menu.tsx",
  "components/ui/dropdown-menu.tsx",
  "components/ui/menubar.tsx",
  "components/ui/navigation-menu.tsx",
  "components/ui/select.tsx",
]);

/**
 * Quem esconde o contorno e mostra o foco em outro lugar, com o trecho da
 * classe e o porquê. O campo sem moldura dentro da caixa que acende com o
 * foco de dentro (focus-within), os títulos que só recebem o foco do código
 * (tabIndex -1, fora do Tab) e os painéis que passam o foco para dentro.
 */
const FOCO_EM_OUTRO_LUGAR: ReadonlyArray<{ arquivo: string; trecho: string; porque: string }> = [
  { arquivo: "components/agent/agent-screen.tsx", trecho: "min-w-0 flex-1 bg-transparent text-foreground", porque: "a busca de conversas: o rótulo em volta acende a borda" },
  { arquivo: "components/agent/agent-screen.tsx", trecho: "block max-h-[200px] w-full resize-none bg-transparent", porque: "o compositor: a caixa em volta acende a borda" },
  { arquivo: "components/ui/command.tsx", trecho: "flex h-10 w-full rounded-md bg-transparent py-3", porque: "a busca do cmdk: a caixa em volta acende a borda" },
  { arquivo: "pages/billing.tsx", trecho: "w-32 bg-transparent text-sm text-foreground", porque: "o mês: o rótulo em volta mostra o anel" },
  { arquivo: "pages/client/estoque.tsx", trecho: "min-w-0 flex-1 cursor-pointer appearance-none bg-transparent", porque: "o filtro: o rótulo em volta mostra o anel" },
  { arquivo: "pages/client/inicio.tsx", trecho: "min-w-0 flex-1 bg-transparent py-1 text-base", porque: "a pergunta ao Agent Dute: a caixa em volta acende a borda" },
  { arquivo: "pages/client/estoque.tsx", trecho: "relative w-full overflow-hidden text-foreground", porque: "o painel do item: o Radix passa o foco ao primeiro controle de dentro" },
  { arquivo: "components/ui/popover.tsx", trecho: "z-50 w-72 rounded-md border bg-popover", porque: "o painel: o Radix passa o foco ao primeiro controle de dentro" },
  { arquivo: "components/ui/hover-card.tsx", trecho: "z-50 w-64 rounded-md border bg-popover", porque: "o cartão que abre no ponteiro, sem tela que o use" },
];

const VARIANTE_DE_FOCO_NO_FIM = /(?:^|:)(?:group-|peer-)?(?:focus|focus-visible|focus-within|has-focus)$/;

/** A classe que esconde o contorno: o outline-hidden solto ou numa variante de foco. */
function escondeOContorno(classe: string): boolean {
  if (!/(?:^|:)outline-hidden$/.test(classe)) return false;
  const corte = classe.lastIndexOf(":");
  return corte < 0 || VARIANTE_DE_FOCO_NO_FIM.test(classe.slice(0, corte));
}

/** O sinal do foco no mesmo lugar: o anel com cor, a borda cheia ou, num menu, o fundo realçado. */
function mostraOFoco(classes: string[], arquivo: string): boolean {
  if (classes.some((classe) => corDoAnel(classe) !== null)) return true;
  if (classes.some((classe) => /(?:^|:)(?:focus|focus-visible|focus-within|has-focus):border-(?!\[)[\w-]+$/.test(classe) && !/\/\d+$/.test(classe))) return true;
  return MENUS.has(arquivo) && classes.some((classe) => /(?:^|:)(?:focus|focus-visible|data-\[highlighted\]|data-\[selected=true\]|data-\[state=active\]):bg-/.test(classe));
}

function problemasDoFoco(texto: string, arquivo: string): string[] {
  const classes = texto.split(/\s+/).filter(Boolean);
  const problemas: string[] = [];
  for (const classe of classes) if (/(?:^|:)outline-none$/.test(classe)) problemas.push(classe);
  // Sem a variante do foco, o contorno transparente fica sempre: nas cores forçadas, o sistema o pinta em todo item.
  for (const classe of classes) if (classe === "outline-hidden") problemas.push("outline-hidden sem a variante do foco");
  for (const classe of classes) {
    if (/(?:^|:)(?:focus|focus-visible|focus-within|has-focus):border-(?:primary|ring|foco)\/\d+$/.test(classe)) problemas.push(classe);
  }
  if (classes.some(escondeOContorno) && !mostraOFoco(classes, arquivo)) {
    const aceito = FOCO_EM_OUTRO_LUGAR.some((excecao) => excecao.arquivo === arquivo && texto.includes(excecao.trecho));
    if (!aceito) problemas.push("esconde o contorno sem outro sinal");
  }
  return problemas;
}

describe("o foco sem anel (revisão da parte 13h)", () => {
  it("a regra separa o foco que se vê do apagado", () => {
    expect(problemasDoFoco("rounded-xl outline-none hover:bg-card", "x.tsx")).toEqual(["outline-none"]);
    expect(problemasDoFoco("rounded-lg border outline-none focus:border-primary/40", "x.tsx")).toEqual(["outline-none", "focus:border-primary/40"]);
    expect(problemasDoFoco("border focus-visible:outline-hidden focus-visible:border-primary", "x.tsx")).toEqual([]);
    expect(problemasDoFoco("focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco", "x.tsx")).toEqual([]);
    expect(problemasDoFoco("text-xs font-medium focus-visible:outline-hidden focus-visible:bg-surface-hover", "x.tsx")).toEqual([
      "esconde o contorno sem outro sinal",
    ]);
    // O item do menu do Radix: o realce pelo fundo, com o contorno das cores forçadas.
    expect(problemasDoFoco("rounded-sm px-2 focus:outline-hidden focus:bg-accent", "components/ui/dropdown-menu.tsx")).toEqual([]);
    expect(problemasDoFoco("rounded-sm px-2 outline-none focus:bg-accent", "components/ui/dropdown-menu.tsx")).toEqual(["outline-none"]);
    expect(problemasDoFoco("rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-foco", "x.tsx")).toEqual(["outline-hidden sem a variante do foco"]);
    // Sem esconder o contorno, o do navegador fica: não é problema desta regra.
    expect(problemasDoFoco("rounded-md px-3 hover:bg-card", "x.tsx")).toEqual([]);
  });

  it("nenhum foco do app sem sinal, e as exceções ainda existem", () => {
    const achados = TRECHOS.flatMap((trecho) => {
      const problemas = problemasDoFoco(trecho.texto, arquivoDo(trecho));
      return problemas.length ? [`${trecho.onde} ${problemas.join(", ")}`] : [];
    });
    expect(achados).toEqual([]);
    for (const excecao of FOCO_EM_OUTRO_LUGAR) {
      const achou = TRECHOS.some((trecho) => arquivoDo(trecho) === excecao.arquivo && trecho.texto.includes(excecao.trecho));
      expect(achou, `${excecao.arquivo}: ${excecao.trecho}`).toBe(true);
    }
  });

  it("no index.css, o foco visível não apaga o contorno, e o :focus que o apaga tem o :focus-visible com contorno", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const blocos = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletor, corpo]) => ({ seletor: seletor.trim().replace(/\s+/g, " "), corpo }));
    const apaga = (corpo: string) => /(?:^|;)\s*outline\s*:\s*(?:none|0)\s*(?:;|$)/.test(corpo);
    const problemas: string[] = [];
    for (const { seletor, corpo } of blocos) {
      if (!apaga(corpo)) continue;
      for (const parte of seletor.split(",").map((pedaco) => pedaco.trim())) {
        if (/:focus-visible|:focus-within/.test(parte)) problemas.push(parte);
        else if (/:focus\b/.test(parte)) {
          const visivel = parte.replace(/:focus\b/, ":focus-visible");
          const temContorno = blocos.some((bloco) => bloco.seletor.split(",").map((pedaco) => pedaco.trim()).includes(visivel) && /outline\s*:\s*\d/.test(bloco.corpo));
          if (!temContorno) problemas.push(parte);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});

/*
 * A borda do fundo cheio (revisão da parte 13k). O `bg-primary` e o
 * `bg-destructive` leem o fundo (`--primary-fundo`, `--destructive-fundo`),
 * mais fundo que o texto no escuro; o `border-primary` e o
 * `border-destructive` seguem o texto. Onde os dois se juntam (o Checkbox
 * marcado, as etapas, o toast de erro), a borda ficava 1 px mais clara que o
 * preenchimento, um aro em volta dele. O preenchimento com borda usa a borda
 * do fundo (`border-primary-fundo`, `border-destructive-fundo`), na mesma
 * variante do fundo.
 */

/** As classes de fundo cheio com a borda do texto no mesmo trecho, sem a borda do fundo na mesma variante. */
function aroEmVoltaDoFundo(texto: string): string[] {
  const classes = texto.split(/\s+/).filter(Boolean);
  const partes = (classe: string) => {
    const corte = classe.lastIndexOf(":");
    return { variante: corte < 0 ? "" : classe.slice(0, corte + 1), utilidade: classe.slice(corte + 1) };
  };
  const problemas: string[] = [];
  for (const cor of ["primary", "destructive"]) {
    if (!classes.some((classe) => partes(classe).utilidade === `border-${cor}`)) continue;
    for (const classe of classes) {
      const { variante, utilidade } = partes(classe);
      if (utilidade === `bg-${cor}` && !classes.includes(`${variante}border-${cor}-fundo`)) problemas.push(classe);
    }
  }
  return problemas;
}

describe("a borda do fundo cheio (revisão da parte 13k)", () => {
  it("a regra acha o fundo cheio com a borda do texto, na variante dele", () => {
    expect(aroEmVoltaDoFundo("rounded-full border-2 border-primary bg-primary")).toEqual(["bg-primary"]);
    expect(aroEmVoltaDoFundo("rounded-full border-2 border-primary-fundo bg-primary")).toEqual([]);
    expect(aroEmVoltaDoFundo("border border-primary data-[state=checked]:bg-primary")).toEqual(["data-[state=checked]:bg-primary"]);
    expect(aroEmVoltaDoFundo("border border-primary data-[state=checked]:border-primary-fundo data-[state=checked]:bg-primary")).toEqual([]);
    expect(aroEmVoltaDoFundo("group border-destructive bg-destructive text-destructive-foreground")).toEqual(["bg-destructive"]);
    // A borda translúcida e o fundo translúcido não fazem o aro.
    expect(aroEmVoltaDoFundo("border-primary/20 bg-primary/10 text-primary")).toEqual([]);
    expect(aroEmVoltaDoFundo("border-primary bg-primary/5")).toEqual([]);
  });

  it("nenhum fundo cheio do app tem a borda do texto em volta", () => {
    const achados = TRECHOS.flatMap((trecho) => {
      const problemas = aroEmVoltaDoFundo(trecho.texto);
      return problemas.length ? [`${trecho.onde} ${problemas.join(", ")}`] : [];
    });
    expect(achados).toEqual([]);
  });
});
