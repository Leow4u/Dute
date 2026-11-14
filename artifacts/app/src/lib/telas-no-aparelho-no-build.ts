/**
 * O mapa das telas para a guarda no aparelho (lib/telas-no-aparelho.ts),
 * gerado no build e publicado como `telas-no-aparelho.json`: de cada tela
 * declarada com `telaSobDemanda("pages/…", …)`, os arquivos que o import dela
 * baixa (o dela e os que ela importa, menos os do shell, que o service worker
 * já guarda) e as telas declaradas dentro dela (as abas do Faturamento).
 * Assim a guarda baixa os arquivos sem importar a tela. Usado pelo
 * vite.config.ts.
 */
import path from "node:path";

/** `telaSobDemanda("pages/billing-hub", …)`: a chave é o primeiro argumento, em texto. */
const DECLARACAO = /\btelaSobDemanda\(\s*"([^"]+)"/g;

/** As telas declaradas num arquivo do código. */
export function telasDeclaradas(codigo: string): string[] {
  return [...codigo.matchAll(DECLARACAO)].map((achado) => achado[1]);
}

/** O pedaço do bundle que o mapa usa (o `OutputChunk` do Rollup e o CSS que o Vite associa a ele). */
export interface PedacoDoBuild {
  type: "chunk" | "asset";
  fileName: string;
  isEntry?: boolean;
  imports?: string[];
  moduleIds?: string[];
  viteMetadata?: { importedCss?: Set<string> };
}

export interface MapaDoBuild {
  versao: string;
  telas: Record<string, { arquivos: string[]; dentro: string[] }>;
}

const EXTENSOES = [".tsx", ".ts", ".jsx", ".js"];

function semConsulta(id: string): string {
  return id.replace(/[?#].*$/, "");
}

/** A chave de um módulo do código: o caminho a partir de `src`, sem a extensão e sem o `/index`. */
function chaveDoModulo(id: string, src: string): string | null {
  const relativo = path.relative(src, semConsulta(id)).split(path.sep).join("/");
  if (relativo.startsWith("..") || path.isAbsolute(relativo)) return null;
  const extensao = EXTENSOES.find((fim) => relativo.endsWith(fim));
  if (!extensao) return null;
  return relativo.slice(0, -extensao.length).replace(/\/index$/, "");
}

/**
 * Monta o mapa a partir do bundle. `declaradas` diz, de cada módulo do
 * código, as telas que ele declara. Uma tela declarada que não está no build
 * derruba o build: a guarda deixaria de baixá-la sem ninguém ver.
 */
export function mapaDasTelas(
  bundle: Record<string, PedacoDoBuild>,
  declaradas: ReadonlyMap<string, readonly string[]>,
  src: string,
  versao: string,
): MapaDoBuild {
  const pedacos = Object.values(bundle).filter((pedaco) => pedaco.type === "chunk");
  const pedacoDoModulo = new Map<string, string>();
  const pedacoDaChave = new Map<string, string>();
  for (const pedaco of pedacos) {
    for (const id of pedaco.moduleIds ?? []) {
      pedacoDoModulo.set(semConsulta(id), pedaco.fileName);
      const chave = chaveDoModulo(id, src);
      if (chave !== null) pedacoDaChave.set(chave, pedaco.fileName);
    }
  }

  const fechamento = (inicio: Iterable<string>): Set<string> => {
    const vistos = new Set<string>();
    const fila = [...inicio];
    while (fila.length > 0) {
      const nome = fila.shift()!;
      if (vistos.has(nome)) continue;
      vistos.add(nome);
      fila.push(...(bundle[nome]?.imports ?? []));
    }
    return vistos;
  };
  const cssDe = (nomes: Iterable<string>): Set<string> => {
    const css = new Set<string>();
    for (const nome of nomes) for (const folha of bundle[nome]?.viteMetadata?.importedCss ?? []) css.add(folha);
    return css;
  };

  // O shell: a entrada e o que ela importa já vêm com a página (e o service worker os guarda).
  const shell = fechamento(pedacos.filter((pedaco) => pedaco.isEntry).map((pedaco) => pedaco.fileName));
  const cssDoShell = cssDe(shell);

  const telas: MapaDoBuild["telas"] = {};
  const todas = new Set([...declaradas.values()].flat());
  for (const chave of [...todas].sort()) {
    const pedaco = pedacoDaChave.get(chave);
    if (!pedaco) throw new Error(`A tela "${chave}" foi declarada com telaSobDemanda, mas não está no build.`);
    const usados = [...fechamento([pedaco])].filter((nome) => !shell.has(nome));
    const arquivos = [...usados, ...[...cssDe(usados)].filter((folha) => !cssDoShell.has(folha))];
    const dentro = new Set<string>();
    for (const [modulo, chaves] of declaradas) {
      const onde = pedacoDoModulo.get(semConsulta(modulo));
      if (onde && usados.includes(onde)) for (const outra of chaves) if (outra !== chave) dentro.add(outra);
    }
    telas[chave] = { arquivos, dentro: [...dentro].sort() };
  }
  return { versao, telas };
}

interface ContextoDoGenerate {
  emitFile(arquivo: { type: "asset"; fileName: string; source: string }): string;
}

/** O plugin do Vite: lê as declarações nos módulos do código e publica o mapa no build. */
export function pluginDoMapaDasTelas(opcoes: { src: string; versao: string; nome: string }) {
  const declaradas = new Map<string, string[]>();
  return {
    name: "dute-telas-no-aparelho",
    apply: "build" as const,
    enforce: "pre" as const,
    transform(codigo: string, id: string) {
      if (!codigo.includes("telaSobDemanda(")) return null;
      const telas = telasDeclaradas(codigo);
      if (telas.length > 0) declaradas.set(semConsulta(id), telas);
      return null;
    },
    generateBundle(this: ContextoDoGenerate, _saida: unknown, bundle: Record<string, PedacoDoBuild>) {
      const mapa = mapaDasTelas(bundle, declaradas, opcoes.src, opcoes.versao);
      this.emitFile({ type: "asset", fileName: opcoes.nome, source: `${JSON.stringify(mapa)}\n` });
    },
  };
}
