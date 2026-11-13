import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A migração do Faturamento, dos Relatórios, dos Documentos e do Catálogo
 * (carregamento v2, parte 13d): nas telas da área, nenhum ícone antigo
 * girando (o `RefreshCw` e o `Loader2` com `animate-spin`), nenhum
 * `animate-pulse`, nenhum `role="status"` nem `aria-live` solto (a região viva
 * é o Anunciador), nenhum rótulo, placeholder ou texto com três pontos no
 * lugar da reticência "…", nenhum "Carregando" ou "Calculando" seco, nenhuma
 * falha de leitura fora da `FalhaNaLeitura` (o "Tentando de novo…" só na nova
 * tentativa que a pessoa pede) e nenhum botão que só apaga durante a ação
 * (`disabled={….isPending}`: ocupado não é desabilitado). A trava do app
 * inteiro é a parte 13h; esta vale só para a área.
 */

const SRC = path.resolve(__dirname, "..");

const ARQUIVOS = [
  "pages/billing-hub.tsx",
  "pages/billing.tsx",
  "pages/billing-invoice.tsx",
  "components/billing/invoice-document.tsx",
  "pages/price-list.tsx",
  "pages/reports.tsx",
  "pages/documents.tsx",
  "pages/catalog.tsx",
  "pages/products.tsx",
  "pages/skus.tsx",
];

/** O comentário vira linhas em branco: a linha do achado continua a do arquivo. */
const emBranco = (comentario: string) => comentario.replace(/[^\n]/g, " ");

function codigoDa(arquivo: string): string {
  return readFileSync(path.join(SRC, arquivo), "utf8")
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, (achado, antes: string) => antes + emBranco(achado.slice(antes.length)))
    .split("\n")
    .map((linha) => linha.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

function achados(padrao: RegExp): string[] {
  return ARQUIVOS.flatMap((arquivo) =>
    codigoDa(arquivo)
      .split("\n")
      .flatMap((linha, indice) => (padrao.test(linha) ? [`${arquivo}:${indice + 1}: ${linha.trim().slice(0, 120)}`] : [])),
  );
}

describe("o carregamento no Faturamento, nos Relatórios, nos Documentos e no Catálogo (parte 13d)", () => {
  it("nenhum ícone girando fora do Spinner nem bloco pulsando fora do Esqueleto", () => {
    expect(achados(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    expect(achados(/role=["{]["']?status|aria-live/)).toEqual([]);
  });

  it("a reticência é o caractere único, nunca três pontos num texto ou placeholder da tela", () => {
    // Três pontos dentro de aspas ou entre tags (o espalhamento `...objeto` do código fica de fora).
    expect(achados(/["'`>}][^"'`<>{}]*[^.\s]\.\.\.(?=\s*["'`<])|\}\.\.\.(?=\s*["'`<])/)).toEqual([]);
  });

  it("nenhum \"Carregando\" ou \"Calculando\" seco num parágrafo ou célula: a espera é a linha de estado, o esqueleto ou a CarregandoNaRegiao", () => {
    expect(achados(/>\s*(Carregando|Calculando)\b[^<]*<\/(p|td|span|div)>|>\s*(Carregando|Calculando) \{/)).toEqual([]);
  });

  it("a falha da leitura é a FalhaNaLeitura: o \"Tentando de novo…\" só na nova tentativa que a pessoa pede", () => {
    // O ErroNaLeitura direto, com o isFetching da leitura, dizia "Tentando de novo…" na releitura automática.
    expect(achados(/<ErroNaLeitura\b|<BlocoSemConexao\b/)).toEqual([]);
  });

  it("nenhum botão que só apaga durante a ação: ocupado não é desabilitado", () => {
    expect(achados(/disabled=\{[^}]*isPending/)).toEqual([]);
  });
});
