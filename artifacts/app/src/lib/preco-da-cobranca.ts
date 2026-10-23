/**
 * De onde vem o preço de um item da Tabela de preços do WMS (parte 7.3c,
 * docs/plataforma/fase-7-financeiro-unificado.md). O item ligado ao catálogo
 * do Comercial (`lpu_item_id`, parte 7.3b) tira o preço da tabela do cliente
 * vigente no fim da competência (parte 7.3a): o valor do WMS não vale e não
 * se edita aqui (mutateManagedEntity recusa).
 */

export type FonteDoPreco = { tipo: "comercial" } | { tipo: "wms"; valor: number };

export function ligadoAoComercial(item: { lpu_item_id?: unknown }): boolean {
  return typeof item.lpu_item_id === "string" && item.lpu_item_id.trim().length > 0;
}

export function fonteDoPreco(item: { valor_unit?: unknown; lpu_item_id?: unknown; auto_source?: unknown }): FonteDoPreco {
  // O ad valorem é taxa do billing_config, ligado ou não.
  if (ligadoAoComercial(item) && item.auto_source !== "ad_valorem") return { tipo: "comercial" };
  const valor = Number(item.valor_unit ?? 0);
  return { tipo: "wms", valor: Number.isFinite(valor) ? valor : 0 };
}

export const ROTULO_DO_COMERCIAL = "Tabela do Comercial";

/** O que o formulário grava: o item ligado não manda o valor unitário. */
export function payloadDoItem<T extends { valor_unit: number }>(payload: T, ligado: boolean): Omit<T, "valor_unit"> | T {
  if (!ligado) return payload;
  const { valor_unit: _valor, ...resto } = payload;
  return resto;
}
