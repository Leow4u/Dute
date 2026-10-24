import { formatarReais } from "@workspace/dominio";
import { Banknote } from "lucide-react";

import type { ItemDoInicio } from "../inicio-do-modulo";

/**
 * As baixas do pagamento na Omie na tela (Fase 7, parte 7.4h;
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie"): a
 * leitura do que listNfSettlements devolve (as abertas: paradas e em
 * andamento), os rótulos de cada etapa e de cada motivo, as ações da parada
 * e o "Precisa de você" delas. As etapas e os motivos são os de
 * functions/financeiro/src/domain/baixa-omie.ts (trava em
 * platform-lists.test.ts).
 */

export const ETAPAS_DA_BAIXA = ["na_fila", "lancada", "cancelando", "cancelada", "parada", "dispensada"] as const;
export type EtapaDaBaixa = (typeof ETAPAS_DA_BAIXA)[number];

export const ETAPA_DA_BAIXA_ROTULO: Record<EtapaDaBaixa, string> = {
  na_fila: "Na fila",
  lancada: "Lançada",
  cancelando: "Cancelando na Omie",
  cancelada: "Cancelada",
  parada: "Parada",
  dispensada: "Dispensada",
};

export const MOTIVOS_DA_PARADA_DA_BAIXA = [
  "titulo_nao_achado",
  "titulo_repetido",
  "titulo_liquidado",
  "sem_conta_corrente",
  "chave",
  "sem_chaves",
  "falhas_seguidas",
] as const;
export type MotivoDaParadaDaBaixa = (typeof MOTIVOS_DA_PARADA_DA_BAIXA)[number];

export const MOTIVO_DA_BAIXA_ROTULO: Record<MotivoDaParadaDaBaixa, string> = {
  titulo_nao_achado: "Título não achado na Omie",
  titulo_repetido: "Título repetido na Omie",
  titulo_liquidado: "Título já recebido na Omie",
  sem_conta_corrente: "Sem a conta corrente",
  chave: "Chave da Omie recusada",
  sem_chaves: "Sem as chaves da Omie",
  falhas_seguidas: "Falhas seguidas na Omie",
};

export type BaixaDoFinanceiro = {
  id: string;
  pagamentoId: string;
  faturaId: string;
  customerCode: string;
  cliente: string;
  nfNumero: string | null;
  etapa: EtapaDaBaixa;
  motivo: MotivoDaParadaDaBaixa | null;
  mensagem: string | null;
  valorCents: number;
  recebidoEm: string;
  criadaEm: string;
  edicao: number;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function baixaLida(valor: unknown): BaixaDoFinanceiro | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Registro;
  if (!/^bxa_[a-f0-9]{24}$/.test(texto(item.id))) return null;
  if (!(ETAPAS_DA_BAIXA as readonly string[]).includes(texto(item.etapa))) return null;
  if (typeof item.valor_cents !== "number" || !Number.isSafeInteger(item.valor_cents) || typeof item.edicao !== "number") return null;
  const motivo = texto(item.motivo_da_parada);
  return {
    id: texto(item.id),
    pagamentoId: texto(item.pagamento_id),
    faturaId: texto(item.fatura_id),
    customerCode: texto(item.customer_code),
    cliente: texto(item.customer_name) || texto(item.customer_code),
    nfNumero: texto(item.nf_numero) || null,
    etapa: texto(item.etapa) as EtapaDaBaixa,
    motivo: (MOTIVOS_DA_PARADA_DA_BAIXA as readonly string[]).includes(motivo) ? (motivo as MotivoDaParadaDaBaixa) : null,
    mensagem: texto(item.mensagem) || null,
    valorCents: item.valor_cents,
    recebidoEm: texto(item.recebido_em),
    criadaEm: texto(item.criada_em),
    edicao: item.edicao,
  };
}

/** O que listNfSettlements devolve, ou null fora do formato. As baixas ilegíveis ficam de fora. */
export function baixasLidas(valor: unknown): BaixaDoFinanceiro[] | null {
  if (!valor || typeof valor !== "object" || !Array.isArray((valor as Registro).baixas)) return null;
  return ((valor as Registro).baixas as unknown[]).map(baixaLida).filter((item): item is BaixaDoFinanceiro => item !== null);
}

/** "Itaú Unibanco · NF 815": o cliente e a NF do pagamento. */
export function tituloDaBaixa(baixa: Pick<BaixaDoFinanceiro, "cliente" | "nfNumero">): string {
  return baixa.nfNumero ? `${baixa.cliente} · NF ${baixa.nfNumero.replace(/^0+(?=\d)/, "")}` : baixa.cliente;
}

export type AcaoNaBaixa = "retomar" | "dispensar";

/** Só a parada tem ação: tentar de novo ou dispensar (resolvida na Omie à mão). */
export function acoesDaBaixa(baixa: Pick<BaixaDoFinanceiro, "etapa">): AcaoNaBaixa[] {
  return baixa.etapa === "parada" ? ["retomar", "dispensar"] : [];
}

/** As paradas primeiro, depois as que a rotina anda; dentro de cada uma, a ordem em que vieram. */
export function baixasNaOrdem(baixas: readonly BaixaDoFinanceiro[]): BaixaDoFinanceiro[] {
  return [...baixas.filter((baixa) => baixa.etapa === "parada"), ...baixas.filter((baixa) => baixa.etapa === "na_fila" || baixa.etapa === "cancelando")];
}

function previa(valores: readonly string[], max = 2): string {
  const unicos = [...new Set(valores)];
  const mostrados = unicos.slice(0, max).join(" · ");
  return unicos.length > max ? `${mostrados} e mais ${unicos.length - max}` : mostrados;
}

/** O "Precisa de você" das baixas: a parada é crítica, porque o recebimento da Dute não chegou à Omie. */
export function pendenciasDasBaixas(baixas: readonly BaixaDoFinanceiro[], rota: string): ItemDoInicio[] {
  const paradas = baixas.filter((baixa) => baixa.etapa === "parada");
  if (!paradas.length) return [];
  return [
    {
      id: "financeiro-baixas-paradas",
      tone: "critical",
      icon: Banknote,
      title: `${paradas.length} ${paradas.length === 1 ? "baixa parada" : "baixas paradas"} na Omie`,
      detail: [previa(paradas.map((baixa) => baixa.cliente)), formatarReais(paradas.reduce((soma, baixa) => soma + baixa.valorCents, 0))].join(" · "),
      href: rota,
      actionLabel: "Abrir",
    },
  ];
}
