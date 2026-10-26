import { formatarReais } from "@workspace/dominio";
import { CirclePause, FileWarning } from "lucide-react";

import type { ItemDoInicio } from "../inicio-do-modulo";

/**
 * As emissões da NFS-e pela Omie na tela (Fase 7, parte 7.4f;
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie"): a
 * leitura do que listNfEmissions devolve, os rótulos de cada etapa e de cada
 * motivo, as ações de cada emissão e o "Precisa de você" delas. As etapas e
 * os motivos são os de functions/financeiro/src/domain/emissao-omie.ts
 * (trava em platform-lists.test.ts).
 */

export const ETAPAS_DA_EMISSAO = [
  "na_fila",
  "os_incluida",
  "na_prefeitura",
  "autorizada",
  "rejeitada",
  "reenviando",
  "cancelando",
  "parada",
  "desistida",
] as const;
export type EtapaDaEmissao = (typeof ETAPAS_DA_EMISSAO)[number];

export const ETAPA_ROTULO: Record<EtapaDaEmissao, string> = {
  na_fila: "Na fila",
  os_incluida: "OS incluída",
  na_prefeitura: "Na prefeitura",
  autorizada: "Autorizada",
  rejeitada: "Rejeitada",
  reenviando: "Reenviando",
  cancelando: "Cancelando na Omie",
  parada: "Parada",
  desistida: "Desistida",
};

export const MOTIVOS_DA_PARADA = [
  "cliente_nao_achado",
  "cliente_repetido",
  "ambiente_errado",
  "chave",
  "sem_chaves",
  "falhas_seguidas",
  "cancelada_na_omie",
  "prefeitura_demorou",
  "fatura_recusada",
  "nfse_autorizada",
] as const;
export type MotivoDaParada = (typeof MOTIVOS_DA_PARADA)[number];

export const MOTIVO_ROTULO: Record<MotivoDaParada, string> = {
  cliente_nao_achado: "Cliente não achado na Omie",
  cliente_repetido: "Cliente repetido na Omie",
  ambiente_errado: "Ambiente da Omie errado",
  chave: "Chave da Omie recusada",
  sem_chaves: "Sem as chaves da Omie",
  falhas_seguidas: "Falhas seguidas na Omie",
  cancelada_na_omie: "OS cancelada na Omie",
  prefeitura_demorou: "Prefeitura sem resposta",
  fatura_recusada: "Fatura não nasceu",
  nfse_autorizada: "NFS-e autorizada na prefeitura",
};

/** As que esperam uma pessoa, as que andam sozinhas e as que acabaram. */
export const ETAPAS_QUE_PRECISAM: readonly EtapaDaEmissao[] = ["parada", "rejeitada"];
export const ETAPAS_EM_ANDAMENTO: readonly EtapaDaEmissao[] = ["na_fila", "os_incluida", "na_prefeitura", "reenviando", "cancelando"];

export type MensagemDaPrefeitura = { codigo: string; descricao: string; correcao: string };

export type EmissaoDoFinanceiro = {
  id: string;
  customerCode: string;
  cliente: string;
  etapa: EtapaDaEmissao;
  motivo: MotivoDaParada | null;
  mensagem: string | null;
  mensagens: MensagemDaPrefeitura[];
  demandas: string[];
  armazenagem: string[];
  /** As medições da emissão (pergunta 64). */
  medicoes: string[];
  totalCents: number;
  vencimento: string;
  nfse: string | null;
  urlNfse: string | null;
  urlPdf: string | null;
  criadaEm: string;
  edicao: number;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function urlSegura(valor: unknown): string | null {
  const url = texto(valor);
  return /^https:\/\//.test(url) ? url : null;
}

function emissaoLida(valor: unknown): EmissaoDoFinanceiro | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Registro;
  if (!/^nfe_[a-f0-9]{20}$/.test(texto(item.id))) return null;
  if (!(ETAPAS_DA_EMISSAO as readonly string[]).includes(texto(item.etapa))) return null;
  if (typeof item.total_cents !== "number" || !Number.isSafeInteger(item.total_cents) || typeof item.edicao !== "number") return null;
  const lista = (campo: unknown) => (Array.isArray(campo) ? campo.filter((valor): valor is string => typeof valor === "string") : []);
  const motivo = texto(item.motivo_da_parada);
  const mensagens = Array.isArray(item.mensagens_da_prefeitura) ? (item.mensagens_da_prefeitura as Registro[]) : [];
  return {
    id: texto(item.id),
    customerCode: texto(item.customer_code),
    cliente: texto(item.customer_name) || texto(item.customer_code),
    etapa: texto(item.etapa) as EtapaDaEmissao,
    motivo: (MOTIVOS_DA_PARADA as readonly string[]).includes(motivo) ? (motivo as MotivoDaParada) : null,
    mensagem: texto(item.mensagem) || null,
    mensagens: mensagens.map((mensagem) => ({ codigo: texto(mensagem?.codigo), descricao: texto(mensagem?.descricao), correcao: texto(mensagem?.correcao) })),
    demandas: lista(item.demandas),
    armazenagem: lista(item.armazenagem),
    medicoes: lista(item.medicoes),
    totalCents: item.total_cents,
    vencimento: texto(item.vencimento),
    nfse: texto(item.nfse) || null,
    urlNfse: urlSegura(item.url_nfse),
    urlPdf: urlSegura(item.url_pdf),
    criadaEm: texto(item.criada_em),
    edicao: item.edicao,
  };
}

/** O que listNfEmissions devolve, ou null fora do formato. As emissões ilegíveis ficam de fora. */
export function emissoesLidas(valor: unknown): EmissaoDoFinanceiro[] | null {
  if (!valor || typeof valor !== "object" || !Array.isArray((valor as Registro).emissoes)) return null;
  return ((valor as Registro).emissoes as unknown[]).map(emissaoLida).filter((item): item is EmissaoDoFinanceiro => item !== null);
}

/** "Demandas 10045 e 10046 · Armazenagem 09/2026 · Medição 10/2026". */
export function itensDaEmissao(emissao: Pick<EmissaoDoFinanceiro, "demandas" | "armazenagem"> & { medicoes?: readonly string[] }): string {
  const juntar = (valores: readonly string[]) => (valores.length < 2 ? (valores[0] ?? "") : `${valores.slice(0, -1).join(", ")} e ${valores.at(-1)}`);
  const mes = (id: string) => {
    const competencia = /(\d{4})-(\d{2})$/.exec(id);
    return competencia ? `${competencia[2]}/${competencia[1]}` : id;
  };
  const meses = emissao.armazenagem.map(mes);
  const medicoes = (emissao.medicoes ?? []).map(mes);
  return [
    emissao.demandas.length ? `${emissao.demandas.length === 1 ? "Demanda" : "Demandas"} ${juntar(emissao.demandas)}` : null,
    meses.length ? `Armazenagem ${juntar(meses)}` : null,
    medicoes.length ? `${medicoes.length === 1 ? "Medição" : "Medições"} ${juntar(medicoes)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type AcaoDaEmissao = "retomar" | "desistir";

/**
 * A parada e a rejeitada se retomam ou se desistem; a parada pela OS
 * cancelada na Omie só se desiste; com a NFS-e autorizada, que vale na
 * prefeitura e a Dute não cancela, só se retoma.
 */
export function acoesDaEmissao(emissao: Pick<EmissaoDoFinanceiro, "etapa" | "motivo" | "nfse">): AcaoDaEmissao[] {
  if (!ETAPAS_QUE_PRECISAM.includes(emissao.etapa)) return [];
  if (emissao.motivo === "cancelada_na_omie") return ["desistir"];
  return emissao.nfse ? ["retomar"] : ["retomar", "desistir"];
}

export type GruposDasEmissoes = { precisam: EmissaoDoFinanceiro[]; andamento: EmissaoDoFinanceiro[]; concluidas: EmissaoDoFinanceiro[] };

export function gruposDasEmissoes(emissoes: readonly EmissaoDoFinanceiro[]): GruposDasEmissoes {
  return {
    precisam: emissoes.filter((emissao) => ETAPAS_QUE_PRECISAM.includes(emissao.etapa)),
    andamento: emissoes.filter((emissao) => ETAPAS_EM_ANDAMENTO.includes(emissao.etapa)),
    concluidas: emissoes.filter((emissao) => !ETAPAS_QUE_PRECISAM.includes(emissao.etapa) && !ETAPAS_EM_ANDAMENTO.includes(emissao.etapa)),
  };
}

function plural(quantos: number, singular: string, varios: string): string {
  return `${quantos} ${quantos === 1 ? singular : varios}`;
}

function previa(valores: readonly string[], max = 2): string {
  const unicos = [...new Set(valores)];
  const mostrados = unicos.slice(0, max).join(" · ");
  return unicos.length > max ? `${mostrados} e mais ${unicos.length - max}` : mostrados;
}

/** O "Precisa de você" das emissões: a rejeitada e a parada, críticas, porque a NFS-e não sai sem uma pessoa. */
export function pendenciasDasEmissoes(emissoes: readonly EmissaoDoFinanceiro[], rota: string): ItemDoInicio[] {
  const itens: ItemDoInicio[] = [];
  const rejeitadas = emissoes.filter((emissao) => emissao.etapa === "rejeitada");
  if (rejeitadas.length) {
    itens.push({
      id: "financeiro-nfse-rejeitadas",
      tone: "critical",
      icon: FileWarning,
      title: plural(rejeitadas.length, "NFS-e rejeitada", "NFS-e rejeitadas"),
      detail: [previa(rejeitadas.map((emissao) => emissao.cliente)), formatarReais(rejeitadas.reduce((soma, emissao) => soma + emissao.totalCents, 0))].join(" · "),
      href: rota,
      actionLabel: "Abrir",
    });
  }
  const paradas = emissoes.filter((emissao) => emissao.etapa === "parada");
  if (paradas.length) {
    itens.push({
      id: "financeiro-nfse-paradas",
      tone: "critical",
      icon: CirclePause,
      title: plural(paradas.length, "emissão parada", "emissões paradas"),
      detail: previa(paradas.map((emissao) => (emissao.motivo ? MOTIVO_ROTULO[emissao.motivo] : emissao.cliente))),
      href: rota,
      actionLabel: "Abrir",
    });
  }
  return itens;
}
