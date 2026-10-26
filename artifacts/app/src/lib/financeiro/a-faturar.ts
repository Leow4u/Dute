import { MESES_PAGAMENTO, TIPOS_PAGAMENTO, dataValida, formatarReais, pagamentoPrevisto, type ContratoParaPagamento, type FaixaPagamento } from "@workspace/dominio";
import { ClipboardCheck, FileText, Hourglass } from "lucide-react";

import { rotuloDaRv } from "../comercial/autorizacoes";
import { LEGACY_CUSTOMER_CODE } from "../operations";
import type { ItemDoInicio } from "../inicio-do-modulo";

/**
 * A fila A faturar do Financeiro (docs/plataforma/fase-4-financeiro.md,
 * parte 4.1b): as demandas A faturar e as que esperam (autorização ou
 * medição), o valor de cada uma e o formulário da NF. O valor aqui é para
 * ler e conferir: o servidor (registerNf) lê de novo e decide. A regra é a
 * mesma: a RV validada, que as autorizações citam.
 *
 * Desde a parte 7.2b (docs/plataforma/fase-7-financeiro-unificado.md), a fila
 * também traz a armazenagem que o WMS emitiu e ainda não está numa NF, pelo
 * total congelado na emissão. Ela vira uma linha como a da demanda, com o
 * `periodoId`; o servidor (registerNf, parte 7.2a) confere de novo.
 *
 * A medição aprovada (pergunta 64) também vira uma linha só, pelo total
 * aprovado, com o `medicaoId` e o que vai na NF linha por linha: as demandas
 * dela e as linhas sem demanda. A demanda da medição não aparece à parte.
 */

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function inteiro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

/** Os tipos de autorização que o contrato exige antes de faturar (functions/financeiro, AUTORIZACOES_EXIGIDAS). */
export const AUTORIZACOES_EXIGIDAS = ["pedido_aceite", "portal", "medicao_aprovada"] as const;

export type DemandaDoFinanceiro = {
  numero: string;
  customerCode: string;
  cliente: string;
  titulo: string | null;
  etapa: "a_faturar" | "aguardando_autorizacao";
  /** Desde quando está na etapa (ISO). */
  desde: string | null;
  contratoId: string | null;
  rv: number | null;
  /** O tipo de autorização que o contrato pede (o que a validação guardou). */
  autorizacao: string | null;
  medicaoId: string | null;
  medicaoPendente: boolean;
  autorizacaoIds: string[];
  /** A emissão da NFS-e pela Omie que reservou a demanda (parte 7.4b); null sem reserva. */
  emissaoNf: string | null;
};

/** A reserva da emissão da NFS-e pela Omie: `emissao_nf.id`, como o servidor lê (functions/financeiro, emissaoReservada). */
export function emissaoReservada(dados: Registro): string | null {
  const reserva = dados.emissao_nf && typeof dados.emissao_nf === "object" ? (dados.emissao_nf as Registro) : {};
  return texto(reserva.id) || null;
}

/** As etapas que a fila lê: A faturar e as que esperam a autorização. */
export const ETAPAS_DA_FILA = ["a_faturar", "aguardando_autorizacao"] as const;

/** A demanda como o Financeiro lê de `demands`; só as etapas da fila. */
export function demandaDoFinanceiro(id: string, dados: Registro): DemandaDoFinanceiro | null {
  const etapa = texto(dados.etapa);
  if (etapa !== "a_faturar" && etapa !== "aguardando_autorizacao") return null;
  const validacao = dados.validacao && typeof dados.validacao === "object" ? (dados.validacao as Registro) : {};
  const ids = Array.isArray(dados.autorizacao_ids) ? dados.autorizacao_ids : [];
  const antigo = typeof dados.autorizacao_id === "string" ? [dados.autorizacao_id] : [];
  const customerCode = texto(dados.customer_code);
  return {
    numero: id,
    customerCode,
    cliente: texto(dados.customer_name) || customerCode,
    titulo: texto(dados.titulo) || null,
    etapa,
    desde: texto(dados.etapa_desde) || null,
    contratoId: texto(dados.contrato_id) || null,
    rv: inteiro(validacao.rv),
    autorizacao: texto(validacao.autorizacao) || null,
    medicaoId: texto(validacao.medicao_id) || texto(dados.medicao_id) || null,
    medicaoPendente: dados.medicao_pendente === true,
    autorizacaoIds: [...new Set([...ids, ...antigo].filter((item): item is string => typeof item === "string" && item.length > 0))],
    emissaoNf: emissaoReservada(dados),
  };
}

export type AutorizacaoDoFinanceiro = {
  id: string;
  customerCode: string;
  registrada: boolean;
  tipo: string;
  pedido: string | null;
  aceite: string | null;
  /** A RV que a autorização cita para cada demanda. */
  rvs: ReadonlyMap<string, number>;
};

export function autorizacaoDoFinanceiro(id: string, dados: Registro): AutorizacaoDoFinanceiro {
  const status = texto(dados.status);
  const rvs = new Map<string, number>();
  for (const item of Array.isArray(dados.demandas) ? dados.demandas : []) {
    if (!item || typeof item !== "object") continue;
    const numero = texto((item as Registro).numero);
    const rv = inteiro((item as Registro).rv);
    if (numero && rv !== null) rvs.set(numero, rv);
  }
  return {
    id,
    customerCode: texto(dados.customer_code),
    registrada: status === "registrada" || status === "a_faturar",
    tipo: texto(dados.tipo),
    pedido: texto(dados.pedido) || null,
    aceite: texto(dados.aceite) || null,
    rvs,
  };
}

/** As autorizações que valem para a demanda: registradas e do mesmo cliente (como registerNf). */
export function autorizacoesValidas(demanda: DemandaDoFinanceiro, autorizacoes: ReadonlyMap<string, AutorizacaoDoFinanceiro>): AutorizacaoDoFinanceiro[] {
  return demanda.autorizacaoIds.flatMap((id) => {
    const autorizacao = autorizacoes.get(id);
    return autorizacao?.registrada && autorizacao.customerCode === demanda.customerCode ? [autorizacao] : [];
  });
}

/** O total da RV validada em centavos, ou null. */
export function valorDaRv(revisao: Registro | null | undefined): number | null {
  const total = inteiro(revisao?.total_cents);
  return total !== null && total >= 0 ? total : null;
}

// --- A fila -------------------------------------------------------------------------------

export type SituacaoNaFila =
  | "pronta"
  | "na_emissao"
  | "aguardando_autorizacao"
  | "medicao_pendente"
  | "demanda_pendente"
  | "sem_autorizacao"
  | "rv_diferente"
  | "sem_valor";

export const SITUACAO_ROTULO: Record<Exclude<SituacaoNaFila, "pronta">, string> = {
  na_emissao: "Na emissão da NFS-e",
  aguardando_autorizacao: "Aguardando autorização",
  medicao_pendente: "Medição pendente",
  demanda_pendente: "Demanda pendente",
  sem_autorizacao: "Sem autorização registrada",
  rv_diferente: "A autorização cita outra RV",
  sem_valor: "Sem o valor para faturar",
};

/** Uma linha do que vai na NF da medição: uma demanda dela ou as linhas sem demanda de um serviço. */
export type ItemDaComposicao = { chave: string; rotulo: string; detalhe: string | null; valorCents: number };

export type LinhaAFaturar = {
  /**
   * O item da linha. Na armazenagem, `numero` é o id do período no WMS, e na
   * medição, o id da medição (nunca só dígitos, então não colidem com a
   * demanda); o resto vem do período ou da medição.
   */
  demanda: DemandaDoFinanceiro;
  /** O id de `billing_periods` na armazenagem; null na demanda. */
  periodoId: string | null;
  /** O id da medição na linha da medição (pergunta 64); null nas outras. */
  medicaoId: string | null;
  situacao: SituacaoNaFila;
  valorCents: number | null;
  /** "RV 2", "Fatura do WMS" ou "Contrato CT-2026-007". */
  origem: string;
  /** "Pedido 4500000009 · aceite ACE-1", "Medição aprovada 05/11", "Sem exigência de autorização". */
  autorizacaoTexto: string;
  /** Na medição, "3 demandas e equipe fixa"; null nas outras. */
  resumo: string | null;
  /** Na medição, o que vai na NF linha por linha; vazio nas outras. */
  composicao: ItemDaComposicao[];
};

function textoDaAutorizacao(demanda: DemandaDoFinanceiro, validas: readonly AutorizacaoDoFinanceiro[]): string {
  const comPedido = validas.find((item) => item.pedido);
  if (comPedido) return [`Pedido ${comPedido.pedido}`, comPedido.aceite ? `aceite ${comPedido.aceite}` : null].filter(Boolean).join(" · ");
  if (validas.length) return "Autorização registrada";
  return exigeAutorizacao(demanda) ? "Sem autorização registrada" : "Sem exigência de autorização";
}

/** "Medição 10/2026" pela competência no fim do id da medição (`{contrato}_{AAAA-MM}`), ou "Medição". */
export function rotuloDaMedicao(medicaoId: string): string {
  const competencia = /_(\d{4})-(\d{2})$/.exec(medicaoId);
  return competencia ? `Medição ${competencia[2]}/${competencia[1]}` : "Medição";
}

/** Como autorizacaoExigida (functions/financeiro, fatura.ts): a autorização da medição só se exige da demanda que tem medição. */
function exigeAutorizacao(demanda: DemandaDoFinanceiro): boolean {
  if (!(AUTORIZACOES_EXIGIDAS as readonly string[]).includes(demanda.autorizacao ?? "")) return false;
  return demanda.autorizacao !== "medicao_aprovada" || demanda.medicaoId !== null;
}

/** Uma autorização válida cita outra RV da demanda (registerNf recusa). */
function citaOutraRv(demanda: DemandaDoFinanceiro, validas: readonly AutorizacaoDoFinanceiro[]): boolean {
  if (demanda.medicaoId || demanda.rv === null) return false;
  return validas.some((autorizacao) => {
    const citada = autorizacao.rvs.get(demanda.numero);
    return citada !== undefined && citada !== demanda.rv;
  });
}

/**
 * A linha da demanda fora de medição e por que ela ainda não fatura, na
 * ordem em que o servidor confere: etapa, medição, autorização, RV citada e
 * valor. A demanda presa a uma medição vai na linha da medição
 * (linhaDaMedicao); a pendência da medição aqui é a da demanda que ainda não
 * entrou numa.
 */
export function linhaAFaturar(
  demanda: DemandaDoFinanceiro,
  autorizacoes: ReadonlyMap<string, AutorizacaoDoFinanceiro>,
  valorCents: number | null,
): LinhaAFaturar {
  const validas = autorizacoesValidas(demanda, autorizacoes);
  const situacao: SituacaoNaFila =
    demanda.emissaoNf
      ? "na_emissao"
      : demanda.etapa === "aguardando_autorizacao"
      ? "aguardando_autorizacao"
      : demanda.medicaoPendente
        ? "medicao_pendente"
        : exigeAutorizacao(demanda) && validas.length === 0
          ? "sem_autorizacao"
          : citaOutraRv(demanda, validas)
            ? "rv_diferente"
            : valorCents === null
              ? "sem_valor"
              : "pronta";
  return {
    demanda,
    periodoId: null,
    medicaoId: null,
    situacao,
    valorCents,
    origem: demanda.rv !== null ? `RV ${demanda.rv}` : "Sem RV validada",
    autorizacaoTexto: textoDaAutorizacao(demanda, validas),
    resumo: null,
    composicao: [],
  };
}

// --- A armazenagem do WMS -----------------------------------------------------------------

/** O id do período no WMS: `{cliente}__{AAAA-MM}`, ou o antigo da BTG, só `AAAA-MM`. */
const PERIODO_ID = /^(?:([\w.-]{1,200})__)?(\d{4}-(?:0[1-9]|1[0-2]))$/;

export type CompetenciaDoFinanceiro = {
  periodoId: string;
  customerCode: string;
  competencia: string;
  /** Quando o WMS emitiu (ISO). */
  emitidaEm: string | null;
  /** O total congelado na emissão; null sem a foto. */
  valorCents: number | null;
  /** A emissão da NFS-e pela Omie que reservou a competência (parte 7.4b); null sem reserva. */
  emissaoNf: string | null;
};

/** "09/2026". */
export function rotuloDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  return ano && mes ? `${mes}/${ano}` : competencia;
}

/**
 * O período como o Financeiro lê de `billing_periods`: só o emitido no WMS e
 * fora de NF. O valor é o da foto da emissão, nunca o total solto do período.
 */
export function competenciaDoFinanceiro(id: string, dados: Registro): CompetenciaDoFinanceiro | null {
  if (texto(dados.status) !== "emitido") return null;
  const faturamento = dados.faturamento && typeof dados.faturamento === "object" ? (dados.faturamento as Registro) : {};
  if (texto(faturamento.fatura_id)) return null;
  const casado = PERIODO_ID.exec(id);
  if (!casado) return null;
  // O id antigo (`AAAA-MM`) é só da BTG, que nem sempre gravou o cliente.
  const customerCode = texto(dados.customer_code) || (casado[1] ? "" : LEGACY_CUSTOMER_CODE);
  if (!customerCode) return null;
  const foto = dados.invoice_snapshot && typeof dados.invoice_snapshot === "object" ? (dados.invoice_snapshot as Registro) : {};
  const total = inteiro(foto.total_cents);
  return {
    periodoId: id,
    customerCode,
    competencia: texto(dados.competencia) || casado[2],
    emitidaEm: texto(dados.emitido_em) || null,
    valorCents: total !== null && total >= 0 ? total : null,
    emissaoNf: emissaoReservada(dados),
  };
}

/** A competência emitida como uma linha da fila: pronta com o total da foto. */
export function linhaDaArmazenagem(competencia: CompetenciaDoFinanceiro): LinhaAFaturar {
  return {
    demanda: {
      numero: competencia.periodoId,
      customerCode: competencia.customerCode,
      cliente: competencia.customerCode,
      titulo: null,
      etapa: "a_faturar",
      desde: competencia.emitidaEm,
      contratoId: null,
      rv: null,
      autorizacao: null,
      medicaoId: null,
      medicaoPendente: false,
      autorizacaoIds: [],
      emissaoNf: competencia.emissaoNf,
    },
    periodoId: competencia.periodoId,
    medicaoId: null,
    situacao: competencia.emissaoNf ? "na_emissao" : competencia.valorCents === null ? "sem_valor" : "pronta",
    valorCents: competencia.valorCents,
    origem: "Fatura do WMS",
    autorizacaoTexto: "Emitida na Armazenagem",
    resumo: null,
    composicao: [],
  };
}

// --- A medição aprovada (pergunta 64) -----------------------------------------------------

/** O serviço da linha sem demanda cujo item não tem serviço (functions/financeiro, SEM_SERVICO). */
export const SEM_SERVICO = "Sem serviço";

export type MedicaoDoFinanceiro = {
  id: string;
  customerCode: string;
  contratoId: string | null;
  competencia: string;
  /** A enviada espera o cliente; a aprovada fatura. */
  status: "enviada" | "aprovada";
  /** Quando o cliente aprovou, ou quando foi enviada (ISO); null sem a data. */
  desde: string | null;
  /** O total aprovado; null quando as linhas não fecham (o servidor recusa). */
  totalCents: number | null;
  /** As demandas das linhas, na ordem, cada uma com a soma das linhas dela. */
  demandas: Array<{ numero: string; valorCents: number }>;
  /** As linhas sem demanda, somadas pelo serviço dos itens. */
  semDemanda: Array<{ servico: string; valorCents: number }>;
  autorizacaoId: string;
  emissaoNf: string | null;
};

function centavosDe(valor: unknown): number | null {
  const lido = inteiro(valor);
  return lido !== null && lido >= 0 && Number.isSafeInteger(lido) ? lido : null;
}

/**
 * A medição como o Financeiro lê de `medicoes`: só a enviada e a aprovada,
 * fora de NF. As contas são as de functions/financeiro (medicaoLida): o total
 * é a soma das linhas e confere com o gravado, e cada linha sem demanda soma
 * os itens dela; fora disso, o total fica null.
 */
export function medicaoDoFinanceiro(id: string, dados: Registro): MedicaoDoFinanceiro | null {
  const status = texto(dados.status);
  if (status !== "enviada" && status !== "aprovada") return null;
  const faturamento = dados.faturamento && typeof dados.faturamento === "object" ? (dados.faturamento as Registro) : {};
  const customerCode = texto(dados.customer_code);
  if (texto(faturamento.fatura_id) || !customerCode || !/_\d{4}-\d{2}$/.test(id)) return null;
  const linhas = (Array.isArray(dados.linhas) ? dados.linhas : []).map((linha): Registro => (linha && typeof linha === "object" ? (linha as Registro) : {}));
  const porDemanda = new Map<string, number>();
  const porServico = new Map<string, number>();
  let soma: number | null = 0;
  for (const linha of linhas) {
    const total = centavosDe(linha.total_cents);
    if (total === null || soma === null) {
      soma = null;
      continue;
    }
    soma += total;
    const numero = texto(linha.demanda_numero);
    if (numero) {
      porDemanda.set(numero, (porDemanda.get(numero) ?? 0) + total);
      continue;
    }
    const itens = (Array.isArray(linha.itens) ? linha.itens : []).map((item): Registro => (item && typeof item === "object" ? (item as Registro) : {}));
    const valores = itens.map((item) => centavosDe(item.total_cents));
    if (!itens.length || valores.some((valor) => valor === null) || valores.reduce<number>((total_, valor) => total_ + (valor ?? 0), 0) !== total) {
      soma = null;
      continue;
    }
    itens.forEach((item, indice) => {
      const servico = texto(item.servico) || SEM_SERVICO;
      porServico.set(servico, (porServico.get(servico) ?? 0) + (valores[indice] ?? 0));
    });
  }
  const gravado = centavosDe(dados.total_cents);
  return {
    id,
    customerCode,
    contratoId: texto(dados.contrato_id) || null,
    competencia: texto(dados.competencia) || id.slice(-7),
    status,
    desde: (status === "aprovada" ? texto(dados.aprovada_em) : texto(dados.enviada_em)) || null,
    totalCents: soma !== null && linhas.length > 0 && gravado === soma ? soma : null,
    demandas: [...porDemanda.entries()].map(([numero, valorCents]) => ({ numero, valorCents })),
    semDemanda: [...porServico.entries()].filter(([, valor]) => valor > 0).map(([servico, valorCents]) => ({ servico, valorCents })),
    autorizacaoId: texto(dados.autorizacao_id) || `aut_${id}`,
    emissaoNf: emissaoReservada(dados),
  };
}

const MES_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

/** "Outubro de 2026". */
export function mesPorExtenso(competencia: string): string {
  const data = new Date(`${competencia}-01T12:00:00Z`);
  if (Number.isNaN(data.getTime())) return competencia;
  const texto_ = MES_POR_EXTENSO.format(data);
  return texto_.charAt(0).toUpperCase() + texto_.slice(1);
}

/** "equipe fixa" no meio da frase; a sigla fica como está ("VUC"). */
function noMeioDaFrase(servico: string): string {
  return /^\p{Lu}{2}/u.test(servico) ? servico : servico.charAt(0).toLowerCase() + servico.slice(1);
}

/** "dd/mm" da data ISO, em São Paulo. */
function diaEMes(iso: string | null): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(data);
}

/**
 * A medição como uma linha da fila, pelo total aprovado, e por que ela ainda
 * não fatura, na ordem em que o servidor confere: a reserva da emissão, a
 * aprovação, o total, as demandas (todas A faturar, presas a ela) e a
 * autorização que a aprovação criou. `demandas` são as da fila, pelo
 * número (o nome do cliente também sai delas); `contrato`, o rótulo do
 * contrato ("CT-2026-007"), quando já se leu.
 */
export function linhaDaMedicao(
  medicao: MedicaoDoFinanceiro,
  demandas: ReadonlyMap<string, DemandaDoFinanceiro>,
  autorizacoes: ReadonlyMap<string, AutorizacaoDoFinanceiro>,
  contrato: string | null = null,
): LinhaAFaturar {
  const pendentes = medicao.demandas.filter(({ numero }) => {
    const demanda = demandas.get(numero);
    return !demanda || demanda.etapa !== "a_faturar" || demanda.medicaoPendente || demanda.medicaoId !== medicao.id || (demanda.emissaoNf !== null && demanda.emissaoNf !== medicao.emissaoNf);
  });
  const autorizacao = autorizacoes.get(medicao.autorizacaoId);
  const situacao: SituacaoNaFila = medicao.emissaoNf
    ? "na_emissao"
    : medicao.status !== "aprovada"
      ? "medicao_pendente"
      : medicao.totalCents === null
        ? "sem_valor"
        : pendentes.length
          ? "demanda_pendente"
          : !autorizacao?.registrada || autorizacao.customerCode !== medicao.customerCode
            ? "sem_autorizacao"
            : "pronta";
  // A medição só tem o código do cliente: o nome vem de uma demanda dele na fila.
  const comNome = [...demandas.values()].find((demanda) => demanda.customerCode === medicao.customerCode && demanda.cliente !== demanda.customerCode);
  const resumo = [
    medicao.demandas.length ? plural(medicao.demandas.length, "demanda", "demandas") : null,
    ...medicao.semDemanda.map(({ servico }) => noMeioDaFrase(servico)),
  ].filter((parte): parte is string => Boolean(parte));
  const dia = diaEMes(medicao.desde);
  return {
    demanda: {
      numero: medicao.id,
      customerCode: medicao.customerCode,
      cliente: comNome?.cliente ?? medicao.customerCode,
      titulo: null,
      etapa: "a_faturar",
      desde: medicao.desde,
      contratoId: medicao.contratoId,
      rv: null,
      autorizacao: "medicao_aprovada",
      medicaoId: medicao.id,
      medicaoPendente: false,
      autorizacaoIds: [medicao.autorizacaoId],
      emissaoNf: medicao.emissaoNf,
    },
    periodoId: null,
    medicaoId: medicao.id,
    situacao,
    valorCents: medicao.totalCents,
    origem: contrato ? `Contrato ${contrato}` : "Medição mensal",
    autorizacaoTexto: [medicao.status === "aprovada" ? "Medição aprovada" : "Medição enviada", dia].filter(Boolean).join(" "),
    resumo: [juntar(resumo), pendentes.length ? `pendente: ${pendentes.map(({ numero }) => numero).join(", ")}` : null].filter(Boolean).join(" · ") || null,
    composicao: [
      ...medicao.demandas.map(({ numero, valorCents }) => ({ chave: numero, rotulo: `Demanda ${numero}`, detalhe: demandas.get(numero)?.titulo ?? null, valorCents })),
      ...medicao.semDemanda.map(({ servico, valorCents }) => ({ chave: `servico:${servico}`, rotulo: servico, detalhe: mesPorExtenso(medicao.competencia), valorCents })),
    ],
  };
}

/** A competência da linha da armazenagem ("2026-09"), ou null na demanda. */
function competenciaDaLinha(linha: LinhaAFaturar): string | null {
  return linha.periodoId ? (PERIODO_ID.exec(linha.periodoId)?.[2] ?? null) : null;
}

/** De onde sai o valor da demanda: a RV validada. O caminho do documento, ou null. */
export function fonteDoValor(demanda: DemandaDoFinanceiro): string | null {
  return demanda.rv !== null ? `quotes/${demanda.numero}/revisoes/${demanda.rv}` : null;
}

/** "10045 – RV02" como o cliente cita; na armazenagem, "Armazenagem 09/2026"; na medição, "Medição 10/2026". */
export function rotuloDaLinha(linha: LinhaAFaturar): string {
  if (linha.medicaoId) return rotuloDaMedicao(linha.medicaoId);
  const competencia = competenciaDaLinha(linha);
  if (competencia) return `Armazenagem ${rotuloDaCompetencia(competencia)}`;
  return rotuloDaRv(linha.demanda.numero, linha.demanda.rv);
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** A busca da tela: número, cliente, título, pedido ou aceite; na medição, também as demandas dela. */
export function filtrarLinhas(linhas: readonly LinhaAFaturar[], busca: string): LinhaAFaturar[] {
  const termo = semAcento(busca.trim());
  if (!termo) return [...linhas];
  return linhas.filter((linha) =>
    [
      rotuloDaLinha(linha),
      linha.demanda.numero,
      linha.demanda.cliente,
      linha.demanda.titulo ?? "",
      linha.autorizacaoTexto,
      linha.origem,
      ...linha.composicao.flatMap((item) => [item.rotulo, item.detalhe ?? ""]),
    ].some((campo) => semAcento(campo).includes(termo)),
  );
}

/** Dias inteiros na etapa até agora, ou null sem a data. */
export function diasNaEtapa(linha: LinhaAFaturar, agora: Date): number | null {
  const desde = linha.demanda.desde ? Date.parse(linha.demanda.desde) : Number.NaN;
  if (Number.isNaN(desde)) return null;
  return Math.max(0, Math.floor((agora.getTime() - desde) / 86_400_000));
}

export type GrupoDaFila = { customerCode: string; cliente: string; linhas: LinhaAFaturar[]; totalCents: number };

/** Por cliente, em ordem alfabética; dentro do cliente, a mais antiga primeiro. */
export function gruposPorCliente(linhas: readonly LinhaAFaturar[]): GrupoDaFila[] {
  const grupos = new Map<string, GrupoDaFila>();
  for (const linha of linhas) {
    const atual = grupos.get(linha.demanda.customerCode) ?? { customerCode: linha.demanda.customerCode, cliente: linha.demanda.cliente, linhas: [], totalCents: 0 };
    // A armazenagem só tem o código; o nome vem da demanda do mesmo cliente.
    if (atual.cliente === atual.customerCode) atual.cliente = linha.demanda.cliente;
    atual.linhas.push(linha);
    atual.totalCents += linha.valorCents ?? 0;
    grupos.set(linha.demanda.customerCode, atual);
  }
  return [...grupos.values()]
    .map((grupo) => ({ ...grupo, linhas: [...grupo.linhas].sort((a, b) => (a.demanda.desde ?? "").localeCompare(b.demanda.desde ?? "") || a.demanda.numero.localeCompare(b.demanda.numero)) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
}

/** A demanda entra na NF quando está pronta e é do mesmo cliente das já marcadas. */
export function podeMarcarNaNf(linha: LinhaAFaturar, marcadas: readonly LinhaAFaturar[]): boolean {
  if (linha.situacao !== "pronta") return false;
  return marcadas.length === 0 || marcadas[0].demanda.customerCode === linha.demanda.customerCode;
}

// --- A NF ---------------------------------------------------------------------------------

export const FORMAS_DE_PAGAMENTO = ["boleto", "pix", "transferencia", "cartao", "dinheiro"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];
export const FORMA_ROTULO: Record<FormaDePagamento, string> = {
  boleto: "Boleto",
  pix: "Pix",
  transferencia: "Transferência",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

/**
 * Como a NF sai (parte 7.4e): pela Omie, que emite a NFS-e e numera, ou
 * emitida fora (o CT-e, que a Omie não emite) e registrada aqui.
 */
export const VIAS_DA_NF = ["omie", "fora"] as const;
export type ViaDaNf = (typeof VIAS_DA_NF)[number];
export const VIA_ROTULO: Record<ViaDaNf, string> = { omie: "Pela Omie", fora: "Emitida fora" };

export type FormDaNf = { via: ViaDaNf; numero: string; serie: string; emissao: string; vencimento: string; forma: FormaDePagamento; observacao: string };

/** A regra de pagamento do contrato como o Financeiro lê de `contracts`. */
export type PagamentoDoContrato = ContratoParaPagamento["pagamento"];

function faixaLida(faixa: unknown): FaixaPagamento | null {
  if (!faixa || typeof faixa !== "object") return null;
  const item = faixa as Registro;
  const [de, ate, dia] = [inteiro(item.de), inteiro(item.ate), inteiro(item.dia)];
  const mes = (MESES_PAGAMENTO as readonly string[]).includes(texto(item.mes)) ? (texto(item.mes) as FaixaPagamento["mes"]) : null;
  return de !== null && ate !== null && dia !== null && mes ? { de, ate, dia, mes } : null;
}

export function pagamentoDoContrato(dados: Registro | null | undefined): PagamentoDoContrato | null {
  const regra = dados?.pagamento;
  if (!regra || typeof regra !== "object") return null;
  const bruto = regra as Registro;
  const tipo = texto(bruto.tipo);
  if (!(TIPOS_PAGAMENTO as readonly string[]).includes(tipo)) return null;
  const faixas = (Array.isArray(bruto.faixas) ? bruto.faixas : []).map(faixaLida).filter((faixa): faixa is FaixaPagamento => faixa !== null);
  return { tipo: tipo as PagamentoDoContrato["tipo"], dias: inteiro(bruto.dias), faixas, texto: texto(bruto.texto) || null };
}

/** O vencimento pela regra do contrato (dias depois da NF ou faixas do dia), ou vazio. */
export function vencimentoPeloContrato(pagamento: PagamentoDoContrato | null, emissao: string): string {
  if (!pagamento || !dataValida(emissao)) return "";
  return pagamentoPrevisto({ pagamento }, emissao) ?? "";
}

/** Onde a emissão pela Omie está liberada, a NF sai por ela; senão, só o registro da emitida fora. */
export function formInicial(hoje: string, pagamento: PagamentoDoContrato | null, omie = false): FormDaNf {
  return { via: omie ? "omie" : "fora", numero: "", serie: "1", emissao: hoje, vencimento: vencimentoPeloContrato(pagamento, hoje), forma: "boleto", observacao: "" };
}

/** O vencimento segue a regra do contrato até a pessoa mexer nele; sem regra calculável, fica o digitado. */
export function formComVencimento(form: FormDaNf, editado: boolean, pagamento: PagamentoDoContrato | null): FormDaNf {
  if (editado) return form;
  const sugerido = vencimentoPeloContrato(pagamento, form.emissao);
  return sugerido ? { ...form, vencimento: sugerido } : form;
}

/** O que impede registrar a NF, na ordem do formulário. O servidor confere de novo. */
export function problemasDaNf(form: FormDaNf, marcadas: readonly LinhaAFaturar[], hoje: string): string[] {
  const problemas: string[] = [];
  if (!marcadas.length) problemas.push("Marque ao menos uma demanda.");
  if (form.via === "omie") {
    // A Omie numera e emite hoje: só o vencimento, a forma e a observação.
    if (!dataValida(form.vencimento)) problemas.push("Informe o vencimento.");
    else if (form.vencimento < hoje) problemas.push("O vencimento vem de hoje em diante.");
    if (form.observacao.trim().length > 300) problemas.push("Use até 300 caracteres na observação.");
    return problemas;
  }
  if (!/^\d{1,15}$/.test(form.numero.trim())) problemas.push("Informe o número da NF, só dígitos.");
  if (!/^[A-Za-z0-9]{1,5}$/.test(form.serie.trim())) problemas.push("Informe a série da NF.");
  if (!dataValida(form.emissao)) problemas.push("Informe a data de emissão.");
  else if (form.emissao > hoje) problemas.push("A data de emissão ainda não chegou.");
  if (!dataValida(form.vencimento)) problemas.push("Informe o vencimento.");
  else if (dataValida(form.emissao) && form.vencimento < form.emissao) problemas.push("O vencimento vem depois da emissão.");
  if (form.observacao.trim().length > 300) problemas.push("Use até 300 caracteres na observação.");
  return problemas;
}

/** O pedido para `registerNf`. Sem valor: o servidor calcula. A armazenagem e a medição vão à parte, só quando há. */
export function pedidoDaNf(form: FormDaNf, marcadas: readonly LinhaAFaturar[], chave: string): Record<string, unknown> {
  const armazenagem = marcadas.flatMap((linha) => (linha.periodoId ? [linha.periodoId] : []));
  const medicoes = marcadas.flatMap((linha) => (linha.medicaoId ? [linha.medicaoId] : []));
  return {
    idempotency_key: chave,
    demandas: marcadas.filter((linha) => !linha.periodoId && !linha.medicaoId).map((linha) => linha.demanda.numero),
    ...(armazenagem.length ? { armazenagem } : {}),
    ...(medicoes.length ? { medicoes } : {}),
    nf: { numero: form.numero.trim(), serie: form.serie.trim().toUpperCase(), emitida_em: form.emissao },
    vencimento: form.vencimento,
    forma: form.forma,
    ...(form.observacao.trim() ? { observacao: form.observacao.trim() } : {}),
  };
}

/** O pedido para `emitNfOmie` (parte 7.4c): o do `registerNf` sem a NF. */
export function pedidoDaEmissao(form: FormDaNf, marcadas: readonly LinhaAFaturar[], chave: string): Record<string, unknown> {
  const { nf: _nf, ...pedido } = pedidoDaNf(form, marcadas, chave);
  return pedido;
}

/** "a medição de 10/2026", "as medições de 09/2026 e 10/2026". */
function textoDasMedicoes(ids: readonly string[]): string | null {
  if (!ids.length) return null;
  const meses = ids.map((id) => rotuloDaMedicao(id).replace(/^Medição /, ""));
  return ids.length === 1 ? `a medição de ${meses[0]}` : `as medições de ${juntar(meses)}`;
}

/** A confirmação depois de emitNfOmie: a NFS-e vai pela rotina, que a tela de emissões acompanha. */
export function textoDaEmissao(marcadas: readonly LinhaAFaturar[]): string {
  const meses = marcadas.flatMap((linha) => {
    const competencia = competenciaDaLinha(linha);
    return competencia ? [rotuloDaCompetencia(competencia)] : [];
  });
  const quantas = marcadas.filter((linha) => !linha.periodoId && !linha.medicaoId).length;
  const medicoes = textoDasMedicoes(marcadas.flatMap((linha) => (linha.medicaoId ? [linha.medicaoId] : [])));
  const partes = [quantas ? plural(quantas, "demanda", "demandas") : null, meses.length ? `a armazenagem de ${juntar(meses)}` : null, medicoes].filter(
    (parte): parte is string => Boolean(parte),
  );
  return `NFS-e pedida à Omie: ${juntar(partes)}`;
}

/** A confirmação depois de registerNf: a NF, quantas demandas, as competências de armazenagem, as medições e o total que o servidor calculou. */
export function textoDoRegistro(form: FormDaNf, resultado: { valor_cents?: unknown; demandas?: unknown; armazenagem?: unknown; medicoes?: unknown }): string {
  const quantas = Array.isArray(resultado.demandas) ? resultado.demandas.length : 0;
  const meses = (Array.isArray(resultado.armazenagem) ? resultado.armazenagem : []).flatMap((id) => {
    const competencia = typeof id === "string" ? PERIODO_ID.exec(id)?.[2] : undefined;
    return competencia ? [rotuloDaCompetencia(competencia)] : [];
  });
  const medicoes = textoDasMedicoes((Array.isArray(resultado.medicoes) ? resultado.medicoes : []).filter((id): id is string => typeof id === "string"));
  const valor = typeof resultado.valor_cents === "number" ? ` · ${formatarReais(resultado.valor_cents)}` : "";
  const outras = [meses.length ? `a armazenagem de ${juntar(meses)}` : null, medicoes].filter((parte): parte is string => Boolean(parte));
  let itens: string;
  if (!outras.length) itens = plural(quantas, "demanda faturada", "demandas faturadas");
  else {
    const partes = [quantas ? plural(quantas, "demanda", "demandas") : null, ...outras].filter((parte): parte is string => Boolean(parte));
    itens = `${juntar(partes)} ${partes.length > 1 || medicoes?.startsWith("as ") ? "faturadas" : "faturada"}`;
  }
  return `NF ${form.numero.trim()} registrada: ${itens}${valor}`;
}

/** "08/2026", "08/2026 e 09/2026", "07/2026, 08/2026 e 09/2026". */
function juntar(valores: readonly string[]): string {
  return valores.length < 2 ? (valores[0] ?? "") : `${valores.slice(0, -1).join(", ")} e ${valores.at(-1)}`;
}

export function totalDasMarcadas(marcadas: readonly LinhaAFaturar[]): number {
  return marcadas.reduce((soma, linha) => soma + (linha.valorCents ?? 0), 0);
}

// --- O Início -----------------------------------------------------------------------------

/** Os números da fila para o Início: as prontas (e o total delas), as que esperam autorização e as sem valor. */
export type NumerosDaFila = { prontas: number; prontasCents: number; aguardando: number; semValor: number };

const ESPERAM_AUTORIZACAO: readonly SituacaoNaFila[] = ["aguardando_autorizacao", "sem_autorizacao", "rv_diferente", "demanda_pendente"];
const SEM_VALOR: readonly SituacaoNaFila[] = ["medicao_pendente", "sem_valor"];

export function numerosDaFila(linhas: readonly LinhaAFaturar[]): NumerosDaFila {
  const prontas = linhas.filter((linha) => linha.situacao === "pronta");
  return {
    prontas: prontas.length,
    prontasCents: totalDasMarcadas(prontas),
    aguardando: linhas.filter((linha) => ESPERAM_AUTORIZACAO.includes(linha.situacao)).length,
    semValor: linhas.filter((linha) => SEM_VALOR.includes(linha.situacao)).length,
  };
}

/** Quantos dias A faturar deixam o item crítico no Início. */
export const DIAS_PARA_FATURAR = 15;

function previa(valores: readonly string[], max = 2): string {
  const unicos = [...new Set(valores)];
  const mostrados = unicos.slice(0, max).join(" · ");
  return unicos.length > max ? `${mostrados} e mais ${unicos.length - max}` : mostrados;
}

function plural(quantos: number, singular: string, pluralForm: string) {
  return `${quantos} ${quantos === 1 ? singular : pluralForm}`;
}

/** "2 demandas", "1 armazenagem", "2 demandas e 1 armazenagem" ou "1 medição". */
function contagemDaFila(linhas: readonly LinhaAFaturar[]): string {
  const armazenagem = linhas.filter((linha) => linha.periodoId).length;
  const medicoes = linhas.filter((linha) => linha.medicaoId).length;
  const demandas = linhas.length - armazenagem - medicoes;
  return juntar(
    [
      demandas ? plural(demandas, "demanda", "demandas") : null,
      armazenagem ? plural(armazenagem, "armazenagem", "armazenagens") : null,
      medicoes ? plural(medicoes, "medição", "medições") : null,
    ].filter((parte): parte is string => Boolean(parte)),
  );
}

/** O "Precisa de você" do Financeiro: a faturar (crítico depois de DIAS_PARA_FATURAR) e o que espera. */
export function pendenciasDoFinanceiro(linhas: readonly LinhaAFaturar[], agora: Date, rota: string): ItemDoInicio[] {
  const prontas = linhas.filter((linha) => linha.situacao === "pronta");
  const itens: ItemDoInicio[] = [];
  if (prontas.length) {
    const antiga = prontas.some((linha) => linha.demanda.desde && agora.getTime() - Date.parse(linha.demanda.desde) > DIAS_PARA_FATURAR * 86_400_000);
    itens.push({
      id: "financeiro-a-faturar",
      tone: antiga ? "critical" : "attention",
      icon: FileText,
      title: `${contagemDaFila(prontas)} a faturar`,
      detail: [previa(prontas.map((linha) => linha.demanda.cliente)), formatarReais(totalDasMarcadas(prontas))].join(" · "),
      href: rota,
      actionLabel: "Faturar",
    });
  }
  const aguardando = linhas.filter((linha) => ESPERAM_AUTORIZACAO.includes(linha.situacao));
  if (aguardando.length) {
    itens.push({
      id: "financeiro-aguardando",
      tone: "info",
      icon: ClipboardCheck,
      title: `${contagemDaFila(aguardando)} aguardando autorização`,
      detail: previa(aguardando.map((linha) => linha.demanda.cliente)),
      href: rota,
      actionLabel: "Ver",
    });
  }
  const medicao = linhas.filter((linha) => SEM_VALOR.includes(linha.situacao));
  if (medicao.length) {
    itens.push({
      id: "financeiro-medicao",
      tone: "info",
      icon: Hourglass,
      title: `${contagemDaFila(medicao)} sem valor para faturar`,
      detail: previa(medicao.map((linha) => linha.demanda.cliente)),
      href: rota,
      actionLabel: "Ver",
    });
  }
  return itens;
}
