import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Os outros módulos no carregamento v2 (parte 13g): o Comercial, a Operação,
 * o campo, a TV da sala, o Financeiro e o RH. Nenhuma tela deles gira o
 * Loader2 ou o RefreshCw (`animate-spin`), pulsa (`animate-pulse`, o
 * `Skeleton` antigo) ou escreve "Carregando" solto: a espera é o `Spinner`, o
 * `Esqueleto`, a `CarregandoNaRegiao` (o rótulo no gerúndio aos 300 ms) e o
 * `BotaoDeAcao`. Nenhuma tem região viva solta (`aria-live`, `role="status"`):
 * quem fala é o `Anunciador`, um por tela. A reticência é o caractere único, e
 * o botão que grava não troca o texto sozinho ("{ocupado ? 'Salvando...' :
 * 'Salvar'}"): o gerúndio é a camada do `BotaoDeAcao`, que nunca fica
 * `disabled` (o foco cairia no `body`).
 */

const RAIZ = join(__dirname, "..");
const LUGARES = [
  "pages/comercial",
  "pages/operacao",
  "pages/campo",
  "pages/tv",
  "pages/financeiro",
  "pages/rh",
  "components/comercial",
  "components/operacao",
  "components/campo",
  "components/financeiro",
  "components/relatorios",
  "components/layout/campo-layout.tsx",
  "components/layout/comercial-layout.tsx",
  "components/layout/operacao-layout.tsx",
  "components/layout/financeiro-layout.tsx",
  "components/layout/rh-layout.tsx",
  "components/layout/tv-layout.tsx",
];

function fontes(lugar: string): string[] {
  const caminho = join(RAIZ, lugar);
  if (!statSync(caminho).isDirectory()) return [lugar];
  return (readdirSync(caminho, { recursive: true }) as string[])
    .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
    .map((nome) => `${lugar}/${nome}`);
}

const ARQUIVOS = LUGARES.flatMap(fontes).map((caminho) => ({ caminho, fonte: readFileSync(join(RAIZ, caminho), "utf8") }));

/** A linha que é só comentário (o JSDoc, o `//` e o `{/* … *\/}`): o texto dela não chega à tela. */
const COMENTARIO = /^\s*(?:\*|\/\/|\/\*|\{\/\*)/;

/** As linhas da fonte que casam com o padrão, como "arquivo:linha: trecho". */
function ocorrencias(padrao: RegExp, { comentarios = true }: { comentarios?: boolean } = {}): string[] {
  return ARQUIVOS.flatMap(({ caminho, fonte }) =>
    fonte
      .split("\n")
      .map((linha, indice) => ({ linha, numero: indice + 1 }))
      .filter(({ linha }) => (comentarios || !COMENTARIO.test(linha)) && padrao.test(linha))
      .map(({ linha, numero }) => `${caminho}:${numero}: ${linha.trim()}`),
  );
}

describe("os outros módulos no carregamento v2", () => {
  it("lê as telas dos seis módulos", () => {
    // A trava que não acha arquivo nenhum passaria sem olhar nada.
    expect(ARQUIVOS.length).toBeGreaterThan(80);
    for (const modulo of ["pages/comercial/", "pages/operacao/", "pages/campo/", "pages/tv/", "pages/financeiro/", "pages/rh/"]) {
      expect(ARQUIVOS.some(({ caminho }) => caminho.startsWith(modulo)), modulo).toBe(true);
    }
  });

  it("nada gira nem pulsa fora das peças: sem animate-spin, animate-pulse, Loader2 nem o Skeleton antigo", () => {
    expect(ocorrencias(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
    expect(ocorrencias(/["']@\/components\/ui\/skeleton["']/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    // Nem aria-live nem os papéis que já são regiões vivas (status, log; o alert é a falha e fica de fora).
    expect(ocorrencias(/aria-live|role=["'{](?:status|log|marquee|timer)\b/)).toEqual([]);
  });

  it("nenhum \"Carregando\" solto: a espera é a CarregandoNaRegiao, com o que se lê no gerúndio", () => {
    expect(ocorrencias(/>\s*Carregando(?:…|\.\.\.)?\s*</, { comentarios: false })).toEqual([]);
    expect(ocorrencias(/["'`]Carregando(?:…|\.\.\.)?["'`]/, { comentarios: false })).toEqual([]);
  });

  it("a reticência é o caractere único, nunca três pontos", () => {
    // Uma letra seguida de "..." e do fim do texto: o espalhamento ({...x}, [...x]) não entra.
    expect(ocorrencias(/\p{L}\.\.\.(?=["'`<\s])/u, { comentarios: false })).toEqual([]);
  });

  it("o botão que grava não troca o próprio texto: o gerúndio é a camada do BotaoDeAcao", () => {
    // "{ocupado ? 'Salvando…' : 'Salvar'}" no filho de um Button; o `andamento=` do BotaoDeAcao é a forma certa.
    expect(ocorrencias(/(?<!andamento=)\{\s*[\w.!]+\s*\?\s*"[^"]*(?:ando|endo|indo)(?:…|\.\.\.)"\s*:/)).toEqual([]);
  });
});
