import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { semelhanca, vetorDosItens, type ItemDoCaso } from "./lembrancas.js";
import { milesimos } from "./medidas.js";

/**
 * Os orçamentos parecidos no Comercial (docs/plataforma/fase-5-memoria.md,
 * parte 5.3b). Funções puras: a leitura (parecidos-gravacao.ts) lê a demanda
 * e as lembranças do cliente dela e chama estas contas.
 *
 * O parecido é a demanda fechada do mesmo cliente que pediu os mesmos itens da
 * LPU, em quantidades parecidas (a semelhança dos vetores, pergunta 29). Vão
 * os três mais parecidos, a partir de 50%; empatados, o mais recente.
 */

/** A semelhança mínima, em pontos percentuais, e quantos casos voltam. */
export const SEMELHANCA_MINIMA_PCT = 50;
export const CASOS_POR_PEDIDO = 3;

// --- Entrada ------------------------------------------------------------------------------

const quantidade = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantidade inválida.")
  .refine((valor) => milesimos(valor) > 0, "Quantidade inválida.");

const PedidoDeParecidos = z
  .object({
    demanda: z.string().trim().regex(/^\d{5,8}$/, "Demanda inválida."),
    itens: z
      .array(z.object({ lpu_item_id: z.string().trim().min(1).max(120), quantidade }).strict())
      .min(1, "Informe os itens do orçamento.")
      .max(200),
  })
  .strict();

export type PedidoDeParecidos = z.infer<typeof PedidoDeParecidos>;

export function interpretarPedidoDeParecidos(data: unknown): PedidoDeParecidos {
  const lido = PedidoDeParecidos.safeParse(data);
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

// --- Os parecidos -------------------------------------------------------------------------

/** A lembrança lida do Firestore, só com o que a tela mostra. */
export type CasoLido = {
  demanda: string;
  customer_code: string;
  titulo: string | null;
  itens: ItemDoCaso[];
  vetor: Record<string, number>;
  orcado_cents: number | null;
  realizado_cents: number | null;
  executado_de: string | null;
  executado_ate: string | null;
  os: string[];
  minutos_de_trabalho: number | null;
  fechada_em: string | null;
};

export type CasoParecido = Omit<CasoLido, "vetor" | "customer_code" | "os"> & {
  /** De 0 a 100. */
  semelhanca_pct: number;
  /** Quantos itens do pedido o caso também teve. */
  itens_em_comum: number;
  os: number;
};

export type Parecidos = { casos: CasoParecido[]; lembrancas: number };

export function vetorDoPedido(pedido: Pick<PedidoDeParecidos, "itens">): Record<string, number> {
  return vetorDosItens(pedido.itens.map((item) => ({ lpuItemId: item.lpu_item_id, milesimos: milesimos(item.quantidade) })));
}

/**
 * Os casos mais parecidos com o pedido, do mesmo cliente: nunca o de outro
 * cliente, nem a própria demanda. A partir da semelhança mínima, os mais
 * parecidos primeiro; empatados, o fechado mais recente.
 */
export function parecidosDoPedido(pedido: PedidoDeParecidos, customerCode: string, casos: readonly CasoLido[]): Parecidos {
  const vetor = vetorDoPedido(pedido);
  const doCliente = casos.filter((caso) => caso.customer_code === customerCode && caso.demanda !== pedido.demanda);
  const comparados = doCliente
    .map((caso) => ({ caso, pct: Math.round(semelhanca(vetor, caso.vetor) * 100) }))
    .filter(({ pct }) => pct >= SEMELHANCA_MINIMA_PCT)
    .sort((a, b) => b.pct - a.pct || (b.caso.fechada_em ?? "").localeCompare(a.caso.fechada_em ?? "") || a.caso.demanda.localeCompare(b.caso.demanda))
    .slice(0, CASOS_POR_PEDIDO);
  return {
    casos: comparados.map(({ caso, pct }): CasoParecido => {
      const { vetor: vetorDoCaso, customer_code: _cliente, os, ...resto } = caso;
      return { ...resto, os: os.length, semelhanca_pct: pct, itens_em_comum: Object.keys(vetor).filter((lpu) => lpu in vetorDoCaso).length };
    }),
    lembrancas: doCliente.length,
  };
}
