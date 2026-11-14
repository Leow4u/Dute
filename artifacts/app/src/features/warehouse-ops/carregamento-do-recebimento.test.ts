import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A migração de Receber, Operações, Pedidos e Solicitações (carregamento v2,
 * parte 13c): nas telas da área, nenhum ícone antigo girando (o `RefreshCw` e
 * o `Loader2` com `animate-spin`), nenhum `animate-pulse`, nenhum
 * `role="status"` nem `aria-live` solto (a região viva é o Anunciador),
 * nenhum rótulo, placeholder ou texto com três pontos no lugar da reticência
 * "…" e nenhum "Carregando" seco. A trava do app inteiro é a parte 13h; esta
 * vale só para a área. Os cartões de identificação de `product-identity.tsx`
 * (o produto novo e a família, que não são espera) ficam fora da trava da
 * região viva.
 */

const SRC = path.resolve(__dirname, "..", "..");

const ARQUIVOS = [
  "pages/receber.tsx",
  "features/warehouse-ops/receiving.tsx",
  "features/warehouse-ops/cancelar-recebimento.tsx",
  "features/warehouse-ops/falta-da-linha.tsx",
  "features/warehouse-ops/guarda-da-caixa.tsx",
  "features/warehouse-ops/destino-da-caixa.tsx",
  "features/warehouse-ops/guardar-da-area.tsx",
  "features/warehouse-ops/chegada-por-caixa.tsx",
  "features/warehouse-ops/chegada-por-caixa-conteudo.tsx",
  "pages/warehouse-ops.tsx",
  "features/warehouse-ops/task-actions.tsx",
  "features/warehouse-ops/exceptions.tsx",
  "features/warehouse-ops/order-returns.tsx",
  "pages/wms-returns.tsx",
  "features/warehouse-ops/order-delivery.tsx",
  "features/warehouse-ops/cancel-order.tsx",
  "features/warehouse-ops/concluir-separacao.tsx",
  "features/warehouse-ops/dividir-em-volumes.tsx",
  "features/warehouse-ops/separar-menos.tsx",
  "features/warehouse-ops/outra-caixa.tsx",
  "features/warehouse-ops/product-identity.tsx",
  "pages/pedidos.tsx",
  "pages/pedidos-lista.tsx",
  "pages/pedidos-lista-view.tsx",
  "pages/pedidos-separar.tsx",
  "pages/pedidos-separar-view.tsx",
  "pages/pedido-separado-view.tsx",
  "pages/pedidos-romaneio.tsx",
  "pages/pedidos-romaneio-view.tsx",
  "pages/orders.tsx",
  "pages/customer-requests.tsx",
];

/** Os cartões de identificação (não são espera) usam `role="status"` desde antes do carregamento v2. */
const COM_STATUS_DE_IDENTIFICACAO = new Set(["features/warehouse-ops/product-identity.tsx"]);

/** O comentário vira linhas em branco: a linha do achado continua a do arquivo. */
const emBranco = (comentario: string) => comentario.replace(/[^\n]/g, " ");

function codigoDa(arquivo: string): string {
  return readFileSync(path.join(SRC, arquivo), "utf8")
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, (achado, antes: string) => antes + emBranco(achado.slice(antes.length)))
    .split("\n")
    .map((linha) => linha.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

function achados(padrao: RegExp, arquivos: readonly string[] = ARQUIVOS): string[] {
  return arquivos.flatMap((arquivo) =>
    codigoDa(arquivo)
      .split("\n")
      .flatMap((linha, indice) => (padrao.test(linha) ? [`${arquivo}:${indice + 1}: ${linha.trim().slice(0, 120)}`] : [])),
  );
}

describe("o carregamento em Receber, Operações, Pedidos e Solicitações (parte 13c)", () => {
  it("nenhum ícone girando fora do Spinner nem bloco pulsando fora do Esqueleto", () => {
    expect(achados(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    const daEspera = ARQUIVOS.filter((arquivo) => !COM_STATUS_DE_IDENTIFICACAO.has(arquivo));
    expect(achados(/role=["{]["']?status|aria-live/, daEspera)).toEqual([]);
    // Nos cartões de identificação, o catálogo que verifica e o que não veio são a espera e a falha do carregamento v2.
    const identificacao = readFileSync(path.join(SRC, "features/warehouse-ops/product-identity.tsx"), "utf8");
    const catalogo = identificacao.slice(identificacao.indexOf("export function CatalogoVerificando"));
    expect(catalogo).not.toMatch(/role=["{]["']?status|aria-live|disabled=\{tentando\}/);
  });

  it("a reticência é o caractere único, nunca três pontos num texto ou placeholder da tela", () => {
    // Três pontos dentro de aspas ou entre tags (o espalhamento `...objeto` do código fica de fora).
    expect(achados(/["'`>][^"'`<>{}]*[^.\s]\.\.\.(?=\s*["'`<])/)).toEqual([]);
  });

  it("nenhum \"Carregando\" seco num parágrafo ou célula: a espera é a CarregandoNaRegiao ou a linha de estado", () => {
    expect(achados(/>\s*Carregando[^<]*<\/(p|td|span|div)>/)).toEqual([]);
  });
});
