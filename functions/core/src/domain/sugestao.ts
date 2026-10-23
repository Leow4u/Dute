import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { milesimos } from "./medidas.js";

/**
 * A duração sugerida no Planejar OS (docs/plataforma/fase-5-memoria.md, parte
 * 5.2a). Funções puras: a gravação (sugestao-gravacao.ts) lê a demanda e as
 * medidas e chama estas contas.
 *
 * A base de cada item é a medida do cliente com 5 execuções; sem ela, a geral
 * com 15 (pergunta 19, pela recomendação). Abaixo disso, o item fica sem base
 * e a sugestão diz isso. A sugestão é o tempo de trabalho, sem o
 * deslocamento (pergunta 28): quem planeja soma o trajeto.
 */

export const AI_SUGGESTIONS_COLLECTION = "ai_suggestions";

/** O mínimo de execuções do item no cliente, e na média interna. */
export const MINIMO_DO_CLIENTE = 5;
export const MINIMO_GERAL = 15;

/** A jornada de uma OS: acima dela, a sugestão divide em mais de uma. */
export const JORNADA_MINUTOS = 480;

/** O erro médio do planejamento a partir do qual a sugestão avisa que os planos desse cliente costumam ser otimistas. */
export const PLANO_OTIMISTA_PCT = 15;

/** A duração sugerida arredonda para cima, de 5 em 5 minutos. */
const PASSO_MINUTOS = 5;

export const DECISOES = ["aceitou", "mudou", "recusou"] as const;
export type Decisao = (typeof DECISOES)[number];

// --- Entrada ------------------------------------------------------------------------------

const numeroDaDemanda = z.string().trim().regex(/^\d{5,8}$/, "Demanda inválida.");
const quantidade = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantidade inválida.")
  .refine((valor) => milesimos(valor) > 0, "Quantidade inválida.");

const ItemPedido = z
  .object({
    lpu_item_id: z.string().trim().min(1).max(120).nullable(),
    item: z.string().trim().max(200),
    quantidade,
  })
  .strict();

const PedidoDeSugestao = z
  .object({
    demanda: numeroDaDemanda,
    pessoas: z.number().int().min(1, "Informe a equipe.").max(20),
    itens: z.array(ItemPedido).min(1, "Informe os itens da OS.").max(100),
  })
  .strict();

const RespostaASugestao = PedidoDeSugestao.extend({
  idempotency_key: z.string().trim().min(8).max(200),
  os: z.string().trim().regex(/^\d{5,8}-\d{2}$/, "OS inválida."),
  decisao: z.enum(DECISOES),
  minutos_escolhidos: z.number().int().min(1).max(100_000).nullable(),
}).strict();

export type PedidoDeSugestao = z.infer<typeof PedidoDeSugestao>;
export type RespostaASugestao = z.infer<typeof RespostaASugestao>;

function interpretar<T>(schema: z.ZodType<T>, data: unknown): T {
  const lido = schema.safeParse(data);
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

export function interpretarPedido(data: unknown): PedidoDeSugestao {
  return interpretar(PedidoDeSugestao, data);
}

export function interpretarResposta(data: unknown): RespostaASugestao {
  const resposta = interpretar(RespostaASugestao, data);
  if (!resposta.os.startsWith(`${resposta.demanda}-`)) throw new HttpsError("invalid-argument", `A OS ${resposta.os} não é da demanda ${resposta.demanda}.`);
  return resposta;
}

// --- A sugestão ---------------------------------------------------------------------------

/** A medida lida do Firestore, só com o que a sugestão usa. */
export type MedidaLida = { homemMinutoPorUnidade: number; execucoes: number; osRecentes: string[] };

/** A base do item: de onde a sugestão tirou, para a tela mostrar. */
export type BaseDoItem = { escopo: "cliente" | "geral"; execucoes: number; homem_minuto_por_unidade: number; os_recentes: string[] };

export type ItemSugerido = { lpu_item_id: string | null; item: string; quantidade: string; minutos: number | null; base: BaseDoItem | null };

export type HistoricoDoPlanejamento = { escopo: "cliente" | "geral"; execucoes: number; erro_medio_pct: number; acima_da_janela: number };

export type Sugestao = {
  pessoas: number;
  itens: ItemSugerido[];
  /** A soma dos itens com base, arredondada para cima de 5 em 5; null quando nenhum tem base. */
  minutos_total: number | null;
  /** Todos os itens têm base. */
  completa: boolean;
  /** Acima da jornada: em quantas OS dividir e quanto fica em cada uma. */
  divisao: { os: number; minutos_por_os: number } | null;
  /** Os planos desse cliente costumam passar da janela: o erro médio, quando passa do limite. */
  plano_otimista: HistoricoDoPlanejamento | null;
};

function arredondar(minutos: number): number {
  return Math.ceil(minutos / PASSO_MINUTOS) * PASSO_MINUTOS;
}

/** A base do item: a medida do cliente com o mínimo dela, senão a geral com o mínimo dela, senão nenhuma. */
export function baseDoItem(doCliente: MedidaLida | null, geral: MedidaLida | null): BaseDoItem | null {
  const escolhida =
    doCliente && doCliente.execucoes >= MINIMO_DO_CLIENTE
      ? { escopo: "cliente" as const, medida: doCliente }
      : geral && geral.execucoes >= MINIMO_GERAL
        ? { escopo: "geral" as const, medida: geral }
        : null;
  if (!escolhida || escolhida.medida.homemMinutoPorUnidade <= 0) return null;
  return {
    escopo: escolhida.escopo,
    execucoes: escolhida.medida.execucoes,
    homem_minuto_por_unidade: escolhida.medida.homemMinutoPorUnidade,
    os_recentes: escolhida.medida.osRecentes,
  };
}

/** O histórico do planejamento que vale: o do cliente com o mínimo, senão o geral com o mínimo. */
export function historicoQueVale(
  doCliente: (HistoricoDoPlanejamento & { escopo: "cliente" }) | null,
  geral: (HistoricoDoPlanejamento & { escopo: "geral" }) | null,
): HistoricoDoPlanejamento | null {
  if (doCliente && doCliente.execucoes >= MINIMO_DO_CLIENTE) return doCliente;
  if (geral && geral.execucoes >= MINIMO_GERAL) return geral;
  return null;
}

/**
 * A duração sugerida da OS: cada item com base leva o homem-minuto por
 * unidade vezes a quantidade, dividido pela equipe. O total soma os itens com
 * base. Acima da jornada, sugere dividir.
 */
export function sugerirDuracao(
  pedido: Pick<PedidoDeSugestao, "pessoas" | "itens">,
  bases: ReadonlyMap<string, BaseDoItem | null>,
  historico: HistoricoDoPlanejamento | null,
): Sugestao {
  const itens = pedido.itens.map((item): ItemSugerido => {
    const base = item.lpu_item_id ? (bases.get(item.lpu_item_id) ?? null) : null;
    const minutos = base ? Math.round((base.homem_minuto_por_unidade * (milesimos(item.quantidade) / 1000)) / pedido.pessoas) : null;
    return { lpu_item_id: item.lpu_item_id, item: item.item, quantidade: item.quantidade, minutos, base };
  });
  const comBase = itens.filter((item) => item.minutos !== null);
  const minutosTotal = comBase.length ? arredondar(comBase.reduce((soma, item) => soma + (item.minutos ?? 0), 0)) : null;
  const divisao =
    minutosTotal !== null && minutosTotal > JORNADA_MINUTOS
      ? { os: Math.ceil(minutosTotal / JORNADA_MINUTOS), minutos_por_os: arredondar(minutosTotal / Math.ceil(minutosTotal / JORNADA_MINUTOS)) }
      : null;
  return {
    pessoas: pedido.pessoas,
    itens,
    minutos_total: minutosTotal,
    completa: comBase.length === itens.length,
    divisao,
    plano_otimista: historico && historico.erro_medio_pct >= PLANO_OTIMISTA_PCT ? historico : null,
  };
}

/** O erro da sugestão contra o tempo real de trabalho, em pontos percentuais inteiros. */
export function erroDaSugestao(sugeridos: number, reais: number): number {
  return Math.round(((reais - sugeridos) / sugeridos) * 100);
}
