import { instanteValido, rotuloDaEtiqueta, type RegraDeParado } from "@workspace/dominio";

import type { ProfileRole } from "../modules";

/**
 * O alerta do item parado para aprovar (docs/plataforma/fase-5-memoria.md,
 * parte 5.4e): a proposta do dia de cada cliente que a rotina do núcleo grava
 * em `ai_stock_alerts`, e a escolha dos itens. Quem decide é a coordenação;
 * a decisão passa pela callable answerStockAlert, que grava o evento.
 */

/** Quem aprova ou descarta o alerta: a mesma lista de ALERTA_ROLES de functions/core (trava em platform-lists.test.ts). */
export const ALERTA_PARADO_ROLES: ProfileRole[] = ["owner", "admin", "interno"];

export type ItemDoAlerta = {
  skuCode: string;
  clientItemCode: string | null;
  productName: string | null;
  saldo: number;
  ultimaMovimentacao: string;
  diasParado: number;
};

export type AlertaProposto = {
  id: string;
  customerCode: string;
  regra: RegraDeParado;
  itens: ItemDoAlerta[];
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function numero(valor: unknown): number {
  const lido = Number(valor);
  return Number.isFinite(lido) ? lido : 0;
}

/** A proposta aberta gravada pela rotina; null para a decidida ou sem item. */
export function alertaLido(dados: Registro): AlertaProposto | null {
  const id = texto(dados.id);
  const customerCode = texto(dados.customer_code);
  if (!id || !customerCode || dados.status !== "proposta") return null;
  const regra = dados.regra && typeof dados.regra === "object" ? (dados.regra as Registro) : {};
  const itens = (Array.isArray(dados.itens) ? dados.itens : []).flatMap((item): ItemDoAlerta[] => {
    const registro = item && typeof item === "object" ? (item as Registro) : {};
    const skuCode = texto(registro.sku_code);
    const ultima = instanteValido(registro.ultima_movimentacao);
    if (!skuCode || !ultima) return [];
    return [
      {
        skuCode,
        clientItemCode: texto(registro.client_item_code) || null,
        productName: texto(registro.product_name) || null,
        saldo: numero(registro.saldo),
        ultimaMovimentacao: ultima,
        diasParado: numero(registro.dias_parado),
      },
    ];
  });
  if (!itens.length) return null;
  return { id, customerCode, regra: { parado_dias: numero(regra.parado_dias) || 90, sem_giro_dias: numero(regra.sem_giro_dias) || 180 }, itens };
}

/** "1 item parado", "3 itens parados". */
export function itensParadosEmTexto(quantidade: number): string {
  return quantidade === 1 ? "1 item parado" : `${quantidade} itens parados`;
}

/** O rótulo do limite do alerta: "Parado 90+ dias". */
export function rotuloDoAlerta(alerta: Pick<AlertaProposto, "regra">): string {
  return rotuloDaEtiqueta("parado", alerta.regra);
}

/** A seleção do alerta: todos marcados ao abrir; marcar e desmarcar um ou todos. */
export function alternarItem(marcados: ReadonlySet<string>, sku: string): Set<string> {
  const proximos = new Set(marcados);
  if (proximos.has(sku)) proximos.delete(sku);
  else proximos.add(sku);
  return proximos;
}

export function alternarTodos(alerta: Pick<AlertaProposto, "itens">, marcados: ReadonlySet<string>): Set<string> {
  return marcados.size === alerta.itens.length ? new Set() : new Set(alerta.itens.map((item) => item.skuCode));
}

/** Os SKUs marcados, na ordem do alerta: o que a aprovação manda à callable. */
export function itensMarcados(alerta: Pick<AlertaProposto, "itens">, marcados: ReadonlySet<string>): string[] {
  return alerta.itens.filter((item) => marcados.has(item.skuCode)).map((item) => item.skuCode);
}
