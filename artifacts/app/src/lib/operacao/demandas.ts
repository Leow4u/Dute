import { formatarData } from "./cadastro";
import type { OsDaFila, StatusDaOs } from "./fila";
import { demandaDoHoje, milesimos, prazoDaDemanda, type DemandaDoHoje, type EntradaDaDemanda, type PrazoDoHoje, type TipoDaDemanda } from "./hoje";

/**
 * Operação › Demandas e a ficha da Demanda (docs/plataforma/fase-3-operacao.md,
 * parte 3.5b; docs/mockups/OpDemandas.dc.html e OpDemanda.dc.html). A demanda
 * é do Comercial; a Operação a vê pela etapa dela e pelas OS. O escopo é o
 * que a demanda grava sem preço. Nunca valor.
 */

/** A etapa da demanda como a Operação a vê: a do Comercial, e as OS dentro de Para planejar. */
export const ETAPAS_NA_OPERACAO = [
  "no_comercial",
  "aguardando_cliente",
  "para_planejar",
  "para_agendar",
  "agendada",
  "em_execucao",
  "em_revisao",
  "execucao_a_orcar",
  "a_faturar",
  "faturada",
  "perdida",
  "cancelada",
] as const;
export type EtapaNaOperacao = (typeof ETAPAS_NA_OPERACAO)[number];

export const ETAPA_NA_OPERACAO_ROTULO: Record<EtapaNaOperacao, string> = {
  no_comercial: "No comercial",
  aguardando_cliente: "Aguardando cliente",
  para_planejar: "Para planejar",
  para_agendar: "Para agendar",
  agendada: "Agendada",
  em_execucao: "Em execução",
  em_revisao: "Em revisão",
  execucao_a_orcar: "Execução a orçar",
  a_faturar: "A faturar",
  faturada: "Faturada",
  perdida: "Perdida",
  cancelada: "Cancelada",
};

/** A demanda com o que a ficha mostra além do Hoje. */
export type DemandaDaOperacao = DemandaDoHoje & {
  recebidaEm: string | null;
  canal: string | null;
  /** Quem pediu, na direta (nome e telefone digitados na Operação). */
  pedidoPor: { nome: string; telefone: string | null } | null;
  origem: { localId: string | null; complemento: string | null } | null;
  destino: { localId: string | null; complemento: string | null } | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function localDaLeitura(valor: unknown): DemandaDaOperacao["origem"] {
  if (!valor || typeof valor !== "object") return null;
  const local = valor as Record<string, unknown>;
  const localId = texto(local.local_id) || null;
  const complemento = texto(local.complemento) || null;
  return localId || complemento ? { localId, complemento } : null;
}

export function demandaDaOperacao(id: string, data: Record<string, unknown>): DemandaDaOperacao | null {
  const base = demandaDoHoje(id, data);
  if (!base) return null;
  const pedido = data.pedido_por && typeof data.pedido_por === "object" ? (data.pedido_por as Record<string, unknown>) : null;
  return {
    ...base,
    recebidaEm: texto(data.recebida_em) || null,
    canal: texto(data.canal) || null,
    pedidoPor: pedido && texto(pedido.nome) ? { nome: texto(pedido.nome), telefone: texto(pedido.telefone) || null } : null,
    origem: localDaLeitura(data.origem),
    destino: localDaLeitura(data.destino),
  };
}

/** As OS da demanda, sem a cancelada, em ordem de número. */
export function osDaDemanda(numero: string, ordens: readonly OsDaFila[], comCanceladas = false): OsDaFila[] {
  return ordens
    .filter((os) => os.demanda === numero && (comCanceladas || os.status !== "cancelada"))
    .sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR"));
}

const ORDEM_DO_STATUS: readonly StatusDaOs[] = ["em_execucao", "em_revisao", "agendada", "aberta", "revisada", "cancelada"];

/**
 * A etapa na Operação. Fora de Para planejar vale a do Comercial (agrupada).
 * Em Para planejar, a OS que mais avançou diz onde a demanda está; sem OS, ou
 * com saldo e todas revisadas, é Para planejar.
 */
export function etapaNaOperacao(demanda: Pick<DemandaDoHoje, "numero" | "etapa" | "fora">, ordens: readonly OsDaFila[]): EtapaNaOperacao {
  if (demanda.fora) return demanda.fora;
  switch (demanda.etapa) {
    case "em_montagem":
    case "para_aprovar":
    case "para_enviar":
      return "no_comercial";
    case "aguardando_cliente":
      return "aguardando_cliente";
    case "execucao_a_orcar":
      return "execucao_a_orcar";
    case "aguardando_autorizacao":
    case "a_faturar":
      return "a_faturar";
    case "faturada":
      return "faturada";
    case "perdida":
      return "perdida";
    case "cancelada":
      return "cancelada";
  }
  const status = new Set(osDaDemanda(demanda.numero, ordens).map((os) => os.status));
  const primeiro = ORDEM_DO_STATUS.find((item) => status.has(item));
  if (primeiro === "em_execucao") return "em_execucao";
  if (primeiro === "em_revisao") return "em_revisao";
  if (primeiro === "agendada") return "agendada";
  if (primeiro === "aberta") return "para_agendar";
  return "para_planejar";
}

const STATUS_ROTULO: Record<StatusDaOs, string> = {
  aberta: "para agendar",
  agendada: "agendada",
  em_execucao: "em execução",
  em_revisao: "em revisão",
  revisada: "revisada",
  cancelada: "cancelada",
};

/** "Nenhuma"; "1 · para agendar"; "3 · 1 em execução". */
export function resumoDasOs(numero: string, ordens: readonly OsDaFila[]): string {
  const lista = osDaDemanda(numero, ordens);
  if (!lista.length) return "Nenhuma";
  if (lista.length === 1) return `1 · ${STATUS_ROTULO[lista[0].status]}`;
  const principal = ORDEM_DO_STATUS.find((status) => lista.some((os) => os.status === status)) ?? "aberta";
  const quantas = lista.filter((os) => os.status === principal).length;
  return `${lista.length} · ${quantas} ${STATUS_ROTULO[principal]}`;
}

/** A próxima OS agendada da demanda, para a coluna Próximo: "OS 10049-01 · 28/10/2026 15:00". */
export function proximaOs(numero: string, ordens: readonly OsDaFila[], hoje: string): string | null {
  const proxima = osDaDemanda(numero, ordens)
    .filter((os) => os.status === "agendada" && os.agenda && os.agenda.data >= hoje)
    .sort((a, b) => `${a.agenda!.data}${a.agenda!.hora ?? ""}`.localeCompare(`${b.agenda!.data}${b.agenda!.hora ?? ""}`))[0];
  if (!proxima?.agenda) return null;
  return `OS ${proxima.numero} · ${[formatarData(proxima.agenda.data), proxima.agenda.hora].filter(Boolean).join(" ")}`;
}

export type LinhaDeDemanda = {
  demanda: DemandaDaOperacao;
  cliente: string;
  etapa: EtapaNaOperacao;
  os: string;
  proximo: string | null;
  prazo: PrazoDoHoje | null;
};

export type FiltrosDeDemandas = { tipo: TipoDaDemanda | ""; entrada: EntradaDaDemanda | ""; cliente: string; etapa: EtapaNaOperacao | "" };

export const SEM_FILTRO_DE_DEMANDAS: FiltrosDeDemandas = { tipo: "", entrada: "", cliente: "", etapa: "" };

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** As linhas da lista, mais recentes primeiro, com os filtros e a busca. */
export function linhasDeDemandas(entrada: {
  demandas: readonly DemandaDaOperacao[];
  ordens: readonly OsDaFila[];
  nomesClientes: Readonly<Record<string, string>>;
  hoje: string;
  agora: Date;
  filtros: FiltrosDeDemandas;
  busca: string;
}): LinhaDeDemanda[] {
  const termo = normalizar(entrada.busca.trim());
  const { tipo, entrada: porEntrada, cliente, etapa } = entrada.filtros;
  return entrada.demandas
    .map((demanda) => {
      const etapaDaLinha = etapaNaOperacao(demanda, entrada.ordens);
      return {
        demanda,
        cliente: entrada.nomesClientes[demanda.customerCode] || demanda.customerCode,
        etapa: etapaDaLinha,
        os: resumoDasOs(demanda.numero, entrada.ordens),
        proximo: etapaDaLinha === "para_planejar" ? "Planejar OS" : proximaOs(demanda.numero, entrada.ordens, entrada.hoje),
        prazo: demanda.entrada === "direta" && ["para_planejar", "para_agendar", "agendada"].includes(etapaDaLinha) ? prazoDaDemanda(demanda.executarAte, entrada.agora) : null,
      } satisfies LinhaDeDemanda;
    })
    .filter(
      (linha) =>
        (!tipo || linha.demanda.tipo === tipo) &&
        (!porEntrada || linha.demanda.entrada === porEntrada) &&
        (!cliente || linha.demanda.customerCode === cliente) &&
        (!etapa || linha.etapa === etapa) &&
        (!termo || [linha.demanda.numero, linha.cliente, linha.demanda.titulo ?? "", ...osDaDemanda(linha.demanda.numero, entrada.ordens).map((os) => os.numero)].some((campo) => normalizar(campo).includes(termo))),
    )
    .sort((a, b) => Number(b.demanda.numero) - Number(a.demanda.numero));
}

export type LinhaDoSaldo = {
  id: string;
  item: string;
  unidade: string | null;
  /** O que o escopo pede (contratado ou pedido). */
  escopo: string;
  /** A soma das fatias nas OS que não foram canceladas. */
  nasOs: string;
  osNumeros: string[];
  saldo: string;
};

function deMilesimos(valor: number): string {
  const sinal = valor < 0 ? "-" : "";
  const absoluto = Math.abs(valor);
  const inteiro = Math.floor(absoluto / 1000);
  const resto = String(absoluto % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sinal}${resto ? `${inteiro}.${resto}` : inteiro}`;
}

/** O escopo linha a linha: quanto está nas OS (e em quais) e o saldo, com a conta da callable. */
export function escopoComSaldo(demanda: Pick<DemandaDoHoje, "numero" | "escopo">, ordens: readonly OsDaFila[]): LinhaDoSaldo[] {
  const lista = osDaDemanda(demanda.numero, ordens);
  return demanda.escopo.map((linha) => {
    let nasOs = 0;
    const numeros: string[] = [];
    for (const os of lista) {
      for (const item of os.itens) {
        if (item.id !== linha.id) continue;
        nasOs += milesimos(item.quantidade);
        if (!numeros.includes(os.numero)) numeros.push(os.numero);
      }
    }
    const total = milesimos(linha.quantidade);
    return {
      id: linha.id,
      item: linha.item,
      unidade: linha.unidade ?? null,
      escopo: deMilesimos(total),
      nasOs: deMilesimos(nasOs),
      osNumeros: numeros,
      saldo: deMilesimos(total - nasOs),
    };
  });
}

/** As opções do filtro de cliente: os clientes das demandas, por nome. */
export function clientesDasDemandas(demandas: readonly DemandaDaOperacao[], nomes: Readonly<Record<string, string>>) {
  return [...new Set(demandas.map((demanda) => demanda.customerCode))]
    .map((code) => ({ valor: code, rotulo: nomes[code] || code }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

const CANAL_ROTULO: Record<string, string> = { email: "E-mail", telefone: "Telefone", whatsapp: "WhatsApp", portal: "Portal", wms: "Pedido do portal" };

/** "WhatsApp · 20/10/2026 13:05": por onde e quando o pedido chegou. */
export function chegadaDaDemanda(demanda: Pick<DemandaDaOperacao, "canal" | "recebidaEm">): string | null {
  const quando = demanda.recebidaEm && !Number.isNaN(Date.parse(demanda.recebidaEm))
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(demanda.recebidaEm)).replace(",", "")
    : null;
  const canal = demanda.canal ? CANAL_ROTULO[demanda.canal] ?? demanda.canal : null;
  const partes = [canal, quando].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}
