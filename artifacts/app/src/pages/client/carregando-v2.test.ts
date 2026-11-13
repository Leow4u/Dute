import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O portal do cliente no carregamento v2 (parte 13f): nenhuma tela do portal
 * gira o Loader2 ou o RefreshCw (`animate-spin`) nem pulsa (`animate-pulse`)
 * por conta própria; a espera é o `Spinner`, o `Esqueleto`, a
 * `CarregandoNaRegiao` e o `BotaoDeAcao`. Nenhuma tem região viva solta
 * (`aria-live`): quem fala é o `Anunciador`, um por tela. Os rótulos usam a
 * reticência de um caractere, e o botão que espera uma ação nunca fica
 * `disabled` (o foco cairia no `body`): `aria-disabled`, com a trava no código.
 */

const RAIZ = join(__dirname, "..", "..");
const PASTAS = ["pages/client", "components/portal"];

function arquivosDoPortal(): Array<{ caminho: string; fonte: string }> {
  return PASTAS.flatMap((pasta) =>
    readdirSync(join(RAIZ, pasta))
      .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
      .map((nome) => ({ caminho: `${pasta}/${nome}`, fonte: readFileSync(join(RAIZ, pasta, nome), "utf8") })),
  );
}

/** As linhas da fonte que casam com o padrão, como "arquivo:linha: trecho". */
function ocorrencias(padrao: RegExp): string[] {
  return arquivosDoPortal().flatMap(({ caminho, fonte }) =>
    fonte
      .split("\n")
      .map((linha, indice) => ({ linha, numero: indice + 1 }))
      .filter(({ linha }) => padrao.test(linha))
      .map(({ linha, numero }) => `${caminho}:${numero}: ${linha.trim()}`),
  );
}

describe("o portal do cliente no carregamento v2", () => {
  it("nada gira nem pulsa fora das peças: sem animate-spin, animate-pulse nem Loader2", () => {
    expect(ocorrencias(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    expect(ocorrencias(/aria-live/)).toEqual([]);
  });

  it("a reticência é o caractere único, nunca três pontos", () => {
    // Uma letra seguida de "..." e do fim do texto: o espalhamento ({...x}, [...x]) não entra.
    expect(ocorrencias(/\p{L}\.\.\.(?=["'`<\s])/u)).toEqual([]);
  });

  it("o botão que espera uma ação não fica disabled: aria-disabled com a trava no código", () => {
    expect(ocorrencias(/(?<!aria-)disabled=\{[^}]*\b(?:isPending|isRetrying|isFetching|isSavingEvent|isSubmitting|busy|enviando|reading|preparing)\b/)).toEqual([]);
  });
});
