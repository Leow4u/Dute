/**
 * O Tamanho do cadastro do SKU, para o volume de expedição (separação com
 * caixas, parte 4) mostrar o tamanho que mora só no campo Tamanho, e não no
 * fim do código do cliente: a capacidade do copo, "475ML"
 * (lib/dominio/src/nome-do-produto.casos.json). As linhas da separação
 * (`pick_lines`) e os itens dos volumes (`package_items`) não gravam o
 * tamanho; o cadastro (`skus`) tem o campo. A etiqueta da caixa não precisa
 * disto: as linhas da abertura e da chegada já trazem o `size`.
 */

/** O Tamanho de cada SKU do cadastro, pelo código do SKU em maiúsculas. */
export type TamanhosDoCatalogo = ReadonlyMap<string, string>;

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

/** Os tamanhos dos SKUs como /api/skus os devolve: o código em `cod_btg` e `sku_code`, o tamanho em `tamanho` (ou `size`). */
export function tamanhosDoCatalogo(skus: ReadonlyArray<Record<string, unknown>> | null | undefined): TamanhosDoCatalogo {
  const tamanhos = new Map<string, string>();
  for (const sku of skus ?? []) {
    const tamanho = texto(sku.tamanho) || texto(sku.size);
    if (!tamanho) continue;
    for (const codigo of [sku.cod_btg, sku.sku_code]) {
      const chave = texto(codigo).toUpperCase();
      if (chave && !tamanhos.has(chave)) tamanhos.set(chave, tamanho);
    }
  }
  return tamanhos;
}

/**
 * A linha com o Tamanho do cadastro do SKU, quando ela não traz o dela. O
 * nome com o tamanho (nomeComTamanho) continua preferindo o tamanho do fim
 * do código: o do cadastro só aparece no que o código não diz. Sem o cadastro
 * lido, as linhas ficam como estão.
 */
export function comTamanhoDoCatalogo<T extends { sku_code?: unknown; sku?: unknown; size?: unknown }>(
  linhas: readonly T[],
  tamanhos: TamanhosDoCatalogo | undefined,
): T[] {
  if (!tamanhos?.size) return [...linhas];
  return linhas.map((linha) => {
    if (texto(linha.size)) return linha;
    const tamanho = tamanhos.get((texto(linha.sku_code) || texto(linha.sku)).toUpperCase());
    return tamanho ? { ...linha, size: tamanho } : linha;
  });
}
