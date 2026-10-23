import { createHash } from "node:crypto";

import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { idadeDoItem, instanteValido, type RegraDeParado, type RelogioDoItem } from "./parados.js";

/**
 * O alerta do item parado (docs/plataforma/fase-5-memoria.md, parte 5.4d).
 * Funções puras: a rotina (alertas-parados-gravacao.ts) lê os itens e os
 * alertas do cliente e chama estas contas.
 *
 * Uma vez por dia, a rotina propõe a cada cliente com portal um alerta com os
 * itens que passaram do limite da regra do modelo dele. Uma pessoa da
 * coordenação aprova (escolhendo os itens) ou descarta. Só o aprovado vira
 * aviso ao cliente (parte 5.4f). O item decidido não volta enquanto não se
 * mexer: a chave dele é o SKU com o último movimento.
 */

export const AI_STOCK_ALERTS_COLLECTION = "ai_stock_alerts";

export const STATUS_DO_ALERTA = ["proposta", "aprovada", "descartada"] as const;
export type StatusDoAlerta = (typeof STATUS_DO_ALERTA)[number];

/** Os itens de um alerta, no máximo: os mais parados primeiro; o resto entra depois da decisão. */
export const ITENS_POR_ALERTA = 200;

/** O item que a rotina dos dias parado grava em `ai_stock_age`, como o alerta lê. */
export type ItemDaMemoria = {
  sku_code: string;
  client_item_code: string | null;
  product_name: string | null;
  saldo: number;
  relogio: RelogioDoItem;
};

export type ItemDoAlerta = {
  sku_code: string;
  client_item_code: string | null;
  product_name: string | null;
  saldo: number;
  /** O último movimento que conta: a entrada ou a saída mais nova. */
  ultima_movimentacao: string;
  dias_parado: number;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function hash(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

export function idDoAlerta(customerCode: string, dia: string): string {
  return `alerta_${hash([customerCode, dia]).slice(0, 24)}`;
}

/** A chave do item decidido: o SKU e o último movimento. O item que se mexe volta a valer. */
export function chaveDoItemDecidido(item: Pick<ItemDoAlerta, "sku_code" | "ultima_movimentacao">): string {
  return `${item.sku_code}|${item.ultima_movimentacao}`;
}

/** O item gravado pela rotina dos dias parado; null sem SKU. */
export function itemDaMemoria(dados: Record<string, unknown>): ItemDaMemoria | null {
  const skuCode = texto(dados.sku_code);
  if (!skuCode) return null;
  const relogio = dados.relogio && typeof dados.relogio === "object" ? (dados.relogio as Record<string, unknown>) : {};
  const saldo = Number(dados.saldo);
  return {
    sku_code: skuCode,
    client_item_code: texto(dados.client_item_code) || null,
    product_name: texto(dados.product_name) || null,
    saldo: Number.isFinite(saldo) ? saldo : 0,
    relogio: {
      primeira_entrada: instanteValido(relogio.primeira_entrada),
      ultima_entrada: instanteValido(relogio.ultima_entrada),
      ultima_saida: instanteValido(relogio.ultima_saida),
    },
  };
}

/**
 * Os itens que o alerta propõe hoje: os parados pela regra, menos os já
 * decididos; os mais parados primeiro, e no máximo ITENS_POR_ALERTA.
 */
export function itensParaAlertar(itens: readonly ItemDaMemoria[], regra: RegraDeParado, hoje: string, decididos: ReadonlySet<string>): ItemDoAlerta[] {
  return itens
    .flatMap((item): ItemDoAlerta[] => {
      const idade = idadeDoItem(item.relogio, item.saldo, regra, hoje);
      const ultima = [item.relogio.ultima_entrada, item.relogio.ultima_saida].filter((instante): instante is string => instante !== null).sort().at(-1);
      if (!idade.etiquetas.includes("parado") || idade.dias_parado === null || !ultima) return [];
      const alertado: ItemDoAlerta = {
        sku_code: item.sku_code,
        client_item_code: item.client_item_code,
        product_name: item.product_name,
        saldo: item.saldo,
        ultima_movimentacao: ultima,
        dias_parado: idade.dias_parado,
      };
      return decididos.has(chaveDoItemDecidido(alertado)) ? [] : [alertado];
    })
    .sort((a, b) => b.dias_parado - a.dias_parado || a.sku_code.localeCompare(b.sku_code))
    .slice(0, ITENS_POR_ALERTA);
}

// --- A decisão ------------------------------------------------------------------------------

const RespostaDoAlerta = z
  .object({
    alerta_id: z.string().trim().regex(/^alerta_[a-f0-9]{24}$/, "Alerta inválido."),
    decisao: z.enum(["aprovar", "descartar"]),
    itens: z.array(z.string().trim().min(1).max(120)).max(ITENS_POR_ALERTA).default([]),
  })
  .strict();

export type RespostaDoAlerta = z.infer<typeof RespostaDoAlerta>;

export function interpretarRespostaDoAlerta(data: unknown): RespostaDoAlerta {
  const lido = RespostaDoAlerta.safeParse(data);
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Resposta inválida.");
  return lido.data;
}

/**
 * Os itens que a aprovação manda ao cliente, na ordem da proposta. O SKU que
 * não está na proposta recusa; aprovar sem item também.
 */
export function itensEscolhidos(proposta: readonly ItemDoAlerta[], escolhidos: readonly string[]): ItemDoAlerta[] {
  const naProposta = new Set(proposta.map((item) => item.sku_code));
  const fora = escolhidos.find((sku) => !naProposta.has(sku));
  if (fora) throw new HttpsError("invalid-argument", `O item ${fora} não está no alerta.`);
  const pedidos = new Set(escolhidos);
  const itens = proposta.filter((item) => pedidos.has(item.sku_code));
  if (!itens.length) throw new HttpsError("invalid-argument", "Escolha os itens do alerta.");
  return itens;
}
