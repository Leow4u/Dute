import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A migração do Estoque e do armazém (carregamento v2, parte 13b): nas telas
 * da área, nenhum ícone antigo girando (o `RefreshCw` e o `Loader2` com
 * `animate-spin`), nenhum `animate-pulse`, nenhum `role="status"` nem
 * `aria-live` solto (a região viva é o Anunciador), nenhum rótulo com três
 * pontos no lugar da reticência "…", nenhuma falha de leitura fora da
 * `FalhaNaLeitura` e nenhum gerúndio de outro verbo. A trava do app inteiro é a parte 13h;
 * esta vale só para a área. As Devoluções (a `ReturnWorkspace`, no mesmo
 * arquivo das Exceções) são da parte 13c.
 */

const SRC = path.resolve(__dirname, "..", "..");

const ARQUIVOS = [
  "features/warehouse-ops/inventory.tsx",
  "features/warehouse-ops/task-detail.tsx",
  "features/warehouse-ops/exceptions.tsx",
  "features/warehouse-ops/opening-line-correction.tsx",
  "features/warehouse-ops/opening-conference-summary.tsx",
  "pages/estoque.tsx",
  "pages/estoque-alertas.tsx",
  "pages/estoque-alertas-view.tsx",
  "pages/warehouse-map.tsx",
  "pages/warehouse-positions.tsx",
  "pages/warehouse-labels.tsx",
  "pages/wms-inventory.tsx",
];

/** O comentário vira linhas em branco: a linha do achado continua a do arquivo. */
const emBranco = (comentario: string) => comentario.replace(/[^\n]/g, " ");

/** O código da área, sem os comentários e, nas Exceções, sem as Devoluções. */
function codigoDa(arquivo: string): string {
  let texto = readFileSync(path.join(SRC, arquivo), "utf8");
  if (arquivo.endsWith("exceptions.tsx")) texto = texto.slice(0, texto.indexOf("export function ReturnWorkspace"));
  return (
    texto
      // O comentário de bloco começa no começo da linha, depois de um espaço ou de "{" (o do JSX); o "image/*" fica.
      .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, (achado, antes: string) => antes + emBranco(achado.slice(antes.length)))
      .split("\n")
      .map((linha) => linha.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n")
  );
}

function achados(padrao: RegExp): string[] {
  return ARQUIVOS.flatMap((arquivo) =>
    codigoDa(arquivo)
      .split("\n")
      .flatMap((linha, indice) => (padrao.test(linha) ? [`${arquivo}:${indice + 1}: ${linha.trim().slice(0, 120)}`] : [])),
  );
}

describe("o carregamento no Estoque e no armazém (parte 13b)", () => {
  it("nenhum ícone girando fora do Spinner nem bloco pulsando fora do Esqueleto", () => {
    expect(achados(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    expect(achados(/role=["{]["']?status|aria-live/)).toEqual([]);
  });

  it("a reticência é o caractere único, nunca três pontos num texto da tela", () => {
    // Três pontos dentro de aspas ou entre tags (o espalhamento `...objeto` do código fica de fora).
    expect(achados(/["'`>][^"'`<>{}]*[^.\s]\.\.\.(?=\s*["'`<])/)).toEqual([]);
  });

  it("a falha da leitura é a FalhaNaLeitura: o \"Tentando de novo…\" só na nova tentativa que a pessoa pede", () => {
    // O ErroNaLeitura direto, com o isFetching da leitura, dizia "Tentando de novo…" na releitura automática (o
    // intervalo, a gravação que relê): o aviso é um alerta, e o leitor de tela o relia duas vezes. A FalhaNaLeitura
    // também escolhe o "Sem conexão." ou o "Reconectando…" na falta de conexão.
    expect(achados(/<ErroNaLeitura\b|<BlocoSemConexao\b/)).toEqual([]);
  });

  it("o gerúndio é o do rótulo: \"Enviar evidência\" diz \"Enviando…\"", () => {
    const pares = ARQUIVOS.flatMap((arquivo) =>
      [...codigoDa(arquivo).matchAll(/rotulo="(Enviar[^"]*)"\s*andamento="([^"]*)"/g)].map(([, rotulo, andamento]) => `${rotulo} → ${andamento}`),
    );
    expect(pares.length).toBeGreaterThan(0);
    expect(pares.filter((par) => !par.endsWith("→ Enviando…"))).toEqual([]);
  });
});
