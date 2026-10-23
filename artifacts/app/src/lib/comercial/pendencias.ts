import { CalendarRange, ClipboardList, FileCheck, FilePlus2, FileText, Hourglass, Send, Undo2 } from "lucide-react";

import type { ItemDoInicio, TomDoItem } from "../inicio-do-modulo";
import { COMERCIAL_LIBERADO } from "../liberacao";
import type { ProfileRole } from "../modules";
import { itensDoAditivoEmTexto, type AditivoAFazer } from "./aditivos-da-operacao";
import type { OrcamentoParaAprovarNoInicio } from "./aprovar";
import type { PendenciasDoInicio } from "./autorizacoes";
import { dataBr } from "./clientes";
import { quandoEmDias, type AlertaDoInicio } from "./contratos";
import { rotuloDaCompetencia, type AlertaDeMedicaoDoInicio } from "./medicoes";
import { ROTA_APROVAR, ROTA_AUTORIZACOES, abreComercial, aprovaOrcamento, hrefDaMedicao, hrefDoContrato } from "./navegacao";
import type { VistoriaAUsar } from "./vistoria-da-operacao";
import { dataHoraCurta, demandaDiretaNaOperacao, hrefDoOrcamento, rotuloDoOrcamento, type EtapaDemanda } from "./orcamentos";

/**
 * O "Precisa de você" do Início do Comercial (docs/plataforma/plano-de-implantacao.md,
 * parte 2.5) e os números da coluna ao lado. Até a parte 2.5 estes itens
 * moravam no Início do WMS, que o papel comercial não abre.
 *
 * Cada `ve...` é também o `enabled` da consulta da página: para quem não vê,
 * nada é lido.
 */

/** Orçamentos para aprovar: só o owner, que aprova, com a liberação do Comercial. */
export function veAprovacoesNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return aprovaOrcamento(role, comercialLiberado);
}

/** Alertas de contrato: owner, admin e comercial, com a liberação. */
export function veContratosNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** Prazo de perda e executados esperando autorização: owner, admin e comercial, com a liberação. */
export function veAutorizacoesNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** Medição do mês que passou sem envio: owner, admin e comercial, com a liberação. */
export function veMedicoesNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** Proposta sem resposta do cliente: owner, admin e comercial, com a liberação. */
export function veSemRespostaNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** Os aditivos pedidos pela Operação: owner, admin e comercial, com a liberação (parte 3.10c). */
export function veAditivosNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** As vistorias que a Operação enviou e o orçamento ainda não carregou: owner, admin e comercial, com a liberação (parte 3.11e). */
export function veVistoriasNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** O orçamento que a pessoa montou e o owner devolveu: quem abre o Comercial, com a liberação. */
export function veDevolvidosNoInicio(role: ProfileRole | null | undefined, comercialLiberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, comercialLiberado);
}

/** A partir de quantos dias corridos sem resposta a proposta enviada entra no Início. */
export const DIAS_SEM_RESPOSTA = 5;

/** A demanda aguardando o cliente há mais de DIAS_SEM_RESPOSTA dias. */
export type PropostaSemResposta = { numero: string; cliente: string; enviadaEm: string; dias: number };

/** O orçamento em rascunho de novo porque o owner devolveu, com a nota dele. */
export type OrcamentoDevolvido = { numero: string; rotulo: string; nota: string | null; em: string };

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function listPreview(values: Array<string | null | undefined>, max = 2) {
  const clean = values.filter((value): value is string => Boolean(value));
  if (!clean.length) return "";
  const shown = clean.slice(0, max).join(" · ");
  return clean.length > max ? `${shown} e mais ${clean.length - max}` : shown;
}

function itemDeAprovacao(paraAprovar: readonly OrcamentoParaAprovarNoInicio[]): ItemDoInicio {
  return {
    id: "comercial:aprovar",
    tone: "attention",
    icon: FileCheck,
    title: `${plural(paraAprovar.length, "orçamento", "orçamentos")} para aprovar`,
    detail: listPreview(paraAprovar.map((orcamento) => [orcamento.numero, orcamento.cliente].filter(Boolean).join(" · "))),
    href: ROTA_APROVAR,
    actionLabel: "Aprovar",
  };
}

/** Um item por alerta (renovação, fim da vigência, reajuste), levando à ficha do contrato. */
function itensDeContrato(alertas: readonly AlertaDoInicio[]): ItemDoInicio[] {
  return alertas.flatMap((alerta) => {
    const href = hrefDoContrato(alerta.contratoId);
    if (!href) return [];
    return [
      {
        id: `contrato:${alerta.contratoId}:${alerta.tipo}`,
        tone: alerta.tom === "critico" ? "critical" : "attention",
        icon: FileText,
        title: `${alerta.titulo} · ${alerta.cliente}`,
        detail: `${alerta.contrato} · ${alerta.quando}`,
        href,
        actionLabel: "Abrir contrato",
      } satisfies ItemDoInicio,
    ];
  });
}

/** O prazo de perda de cada demanda (o mais próximo primeiro) e um item com os executados esperando há mais de 30 dias. */
function itensDeAutorizacao(pendencias: PendenciasDoInicio): ItemDoInicio[] {
  const itens: ItemDoInicio[] = pendencias.prazos.map((prazo) => ({
    id: `autorizacoes:prazo:${prazo.numero}`,
    tone: prazo.critico ? "critical" : "attention",
    icon: Hourglass,
    title: prazo.vencido
      ? `Prazo de faturamento vencido em ${dataBr(prazo.limite)} · ${prazo.cliente}`
      : `Faturar até ${dataBr(prazo.limite)} · ${prazo.cliente}`,
    detail: `${prazo.rotulo} · ${quandoEmDias(prazo.restantes)}`,
    href: ROTA_AUTORIZACOES,
    actionLabel: "Abrir autorizações",
  }));
  const esperando = pendencias.esperandoMaisDe30;
  if (esperando.length) {
    itens.push({
      id: "autorizacoes:mais-de-30",
      tone: "attention",
      icon: FileCheck,
      title: `${plural(esperando.length, "executado", "executados")} esperando autorização há mais de 30 dias`,
      detail: listPreview(esperando.map((item) => item.rotulo), 3),
      href: ROTA_AUTORIZACOES,
      actionLabel: "Abrir autorizações",
    });
  }
  return itens;
}

/** Um item por medição do mês que passou sem envio (rascunho ou ainda não aberta), levando a ela. */
function itensDeMedicao(alertas: readonly AlertaDeMedicaoDoInicio[]): ItemDoInicio[] {
  return alertas.flatMap((alerta) => {
    const href = hrefDaMedicao(alerta.contratoId, alerta.competencia);
    if (!href) return [];
    const prazo =
      alerta.diasDeAtraso === 0
        ? "prazo hoje"
        : `${alerta.diasDeAtraso} ${alerta.diasDeAtraso === 1 ? "dia" : "dias"} de atraso`;
    return [
      {
        id: `medicao:${alerta.medicaoId}`,
        tone: alerta.diasDeAtraso > 0 ? "critical" : "attention",
        icon: CalendarRange,
        title: `Medição de ${rotuloDaCompetencia(alerta.competencia).toLocaleLowerCase("pt-BR")} não enviada · ${alerta.cliente}`,
        detail: [alerta.contrato, alerta.situacao === "rascunho" ? "em rascunho" : "ainda não aberta", prazo].join(" · "),
        href,
        actionLabel: "Abrir medição",
      } satisfies ItemDoInicio,
    ];
  });
}

function itemDeDevolvido(devolvido: OrcamentoDevolvido): ItemDoInicio {
  return {
    id: `devolvido:${devolvido.numero}`,
    tone: "attention",
    icon: Undo2,
    title: `Orçamento ${devolvido.rotulo} devolvido`,
    detail: [devolvido.nota ? `“${devolvido.nota}”` : null, dataHoraCurta(devolvido.em)].filter(Boolean).join(" · "),
    href: hrefDoOrcamento(devolvido.numero),
    actionLabel: "Abrir orçamento",
  };
}

function itemDeSemResposta(proposta: PropostaSemResposta): ItemDoInicio {
  return {
    id: `sem-resposta:${proposta.numero}`,
    tone: "info",
    icon: Send,
    title: `${proposta.numero} aguardando o cliente há ${proposta.dias} dias`,
    detail: `${proposta.cliente} · enviado ${dataBr(proposta.enviadaEm)}`,
    href: hrefDoOrcamento(proposta.numero),
    actionLabel: "Abrir orçamento",
  };
}

function itemDeAditivo(aditivo: AditivoAFazer): ItemDoInicio {
  return {
    id: `aditivo:${aditivo.numero}`,
    tone: "attention",
    icon: FilePlus2,
    title: `Aditivo a fazer · ${aditivo.numero}`,
    detail: [aditivo.cliente, itensDoAditivoEmTexto(aditivo.itens), `pedido pela Operação ${dataBr(diaDoInstante(aditivo.pedidoEm) ?? aditivo.pedidoEm.slice(0, 10))}`].filter(Boolean).join(" · "),
    href: hrefDoOrcamento(aditivo.numero),
    actionLabel: "Abrir orçamento",
  };
}

function itemDeVistoria(vistoria: VistoriaAUsar): ItemDoInicio {
  return {
    id: `vistoria:${vistoria.numero}`,
    tone: "attention",
    icon: ClipboardList,
    title: `Vistoria concluída · ${vistoria.numero}`,
    detail: [
      vistoria.cliente,
      `${vistoria.itens} ${vistoria.itens === 1 ? "item levantado" : "itens levantados"}`,
      `enviada pela Operação ${dataBr(diaDoInstante(vistoria.enviadaEm) ?? vistoria.enviadaEm.slice(0, 10))}`,
    ].join(" · "),
    href: hrefDoOrcamento(vistoria.numero),
    actionLabel: "Abrir orçamento",
  };
}

const PESO_DO_TOM: Record<TomDoItem, number> = { critical: 0, attention: 1, info: 2, agent: 3 };

/**
 * As pendências do Comercial, o mais urgente primeiro (crítico, atenção,
 * informação). No mesmo tom, a ordem das fontes: aprovar, devolvidos,
 * contratos, autorizações, medições e propostas sem resposta. Cada fonte só
 * entra para quem a vê.
 */
export function pendenciasDoComercial({
  role,
  paraAprovar,
  contratos,
  autorizacoes,
  medicoes,
  devolvidos,
  semResposta,
  aditivos,
  vistorias,
  comercialLiberado = COMERCIAL_LIBERADO,
}: {
  role: ProfileRole | null | undefined;
  /** Orçamentos em "Para aprovar" (lib/comercial/inicio.ts, lerOrcamentosParaAprovar). */
  paraAprovar?: readonly OrcamentoParaAprovarNoInicio[];
  /** Alertas dos contratos (lib/comercial/contratos.ts, alertasParaOInicio). */
  contratos?: readonly AlertaDoInicio[];
  /** Pendências das autorizações (lib/comercial/autorizacoes.ts, autorizacoesParaOInicio). */
  autorizacoes?: PendenciasDoInicio;
  /** Medições do mês que passou sem envio (lib/comercial/medicoes.ts, alertasDeMedicaoParaOInicio). */
  medicoes?: readonly AlertaDeMedicaoDoInicio[];
  /** Orçamentos que a pessoa montou e o owner devolveu (lerDevolvidos). */
  devolvidos?: readonly OrcamentoDevolvido[];
  /** Propostas aguardando o cliente há mais de DIAS_SEM_RESPOSTA dias (o resumo). */
  semResposta?: readonly PropostaSemResposta[];
  /** Os aditivos pedidos pela revisão da Operação (lerAditivosAFazer, parte 3.10c). */
  aditivos?: readonly AditivoAFazer[];
  /** As vistorias enviadas pela Operação que o orçamento ainda não carregou (lerVistoriasAUsar, parte 3.11e). */
  vistorias?: readonly VistoriaAUsar[];
  comercialLiberado?: boolean;
}): ItemDoInicio[] {
  const itens: ItemDoInicio[] = [];
  if (paraAprovar?.length && veAprovacoesNoInicio(role, comercialLiberado)) itens.push(itemDeAprovacao(paraAprovar));
  if (devolvidos?.length && veDevolvidosNoInicio(role, comercialLiberado)) itens.push(...devolvidos.map(itemDeDevolvido));
  if (aditivos?.length && veAditivosNoInicio(role, comercialLiberado)) itens.push(...aditivos.map(itemDeAditivo));
  if (vistorias?.length && veVistoriasNoInicio(role, comercialLiberado)) itens.push(...vistorias.map(itemDeVistoria));
  if (contratos?.length && veContratosNoInicio(role, comercialLiberado)) itens.push(...itensDeContrato(contratos));
  if (autorizacoes && veAutorizacoesNoInicio(role, comercialLiberado)) itens.push(...itensDeAutorizacao(autorizacoes));
  if (medicoes?.length && veMedicoesNoInicio(role, comercialLiberado)) itens.push(...itensDeMedicao(medicoes));
  if (semResposta?.length && veSemRespostaNoInicio(role, comercialLiberado)) itens.push(...semResposta.map(itemDeSemResposta));
  // Array.prototype.sort é estável: no mesmo tom, fica a ordem das fontes.
  return itens.sort((a, b) => PESO_DO_TOM[a.tone] - PESO_DO_TOM[b.tone]);
}

/**
 * Os orçamentos em rascunho que a pessoa montou e o owner devolveu: o
 * `quotes/{numero}` com `devolucao` e `status` rascunho. Ao reenviar para
 * aprovação o rascunho deixa de ser rascunho e sai do Início.
 */
export function devolvidosDe(quotes: ReadonlyArray<{ id: string; data: Record<string, unknown> }>, uid: string): OrcamentoDevolvido[] {
  return quotes
    .flatMap(({ id, data }) => {
      if (data.status !== "rascunho" || data.autor_uid !== uid) return [];
      const devolucao = data.devolucao && typeof data.devolucao === "object" ? (data.devolucao as Record<string, unknown>) : null;
      const em = devolucao ? texto(devolucao.em) : "";
      if (!em) return [];
      const rv = typeof data.rv === "number" && Number.isInteger(data.rv) ? data.rv : 0;
      return [{ numero: id, rotulo: texto(data.rotulo) || rotuloDoOrcamento(id, rv), nota: texto(devolucao?.nota).trim() || null, em }];
    })
    .sort((a, b) => b.em.localeCompare(a.em));
}

// --- Coluna ao lado: orçamentos por etapa e os números do mês ----------------------

/** As etapas em que a demanda ainda espera alguém do Comercial ou do cliente, na ordem da fila. */
export const ETAPAS_DO_RESUMO = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
  "a_faturar",
] as const satisfies readonly EtapaDemanda[];

export type DemandaDoResumo = {
  numero: string;
  /** O nome do cliente gravado na demanda (customer_name), ou o código. */
  cliente: string;
  etapa: EtapaDemanda;
  /** Instante ISO em que a demanda entrou na etapa atual (etapa_desde). */
  etapaDesde: string | null;
  /** Os marcos da demanda (etapa e instante ISO), na ordem em que aconteceram. */
  marcos: ReadonlyArray<{ etapa: string; em: string }>;
  /** Instante ISO da perda, quando a demanda está perdida. */
  perdaEm: string | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * A demanda lida do Firestore, só com o que o resumo usa; sem etapa conhecida,
 * nada. A demanda direta ainda na Operação não conta para o Comercial.
 */
export function demandaDoResumo(numero: string, data: Record<string, unknown>, etapasConhecidas: readonly string[]): DemandaDoResumo | null {
  const etapa = texto(data.etapa);
  if (!etapasConhecidas.includes(etapa)) return null;
  if (demandaDiretaNaOperacao(data)) return null;
  const marcos = Array.isArray(data.marcos)
    ? data.marcos.flatMap((marco) => {
        if (!marco || typeof marco !== "object") return [];
        const { etapa: etapaDoMarco, em } = marco as Record<string, unknown>;
        return texto(etapaDoMarco) && texto(em) ? [{ etapa: texto(etapaDoMarco), em: texto(em) }] : [];
      })
    : [];
  const perda = data.perda && typeof data.perda === "object" ? (data.perda as Record<string, unknown>) : null;
  return {
    numero,
    cliente: texto(data.customer_name) || texto(data.customer_code) || numero,
    etapa: etapa as EtapaDemanda,
    etapaDesde: texto(data.etapa_desde) || null,
    marcos,
    perdaEm: perda ? texto(perda.em) || null : null,
  };
}

/** Quantas demandas há em cada etapa do resumo. */
export function contagemPorEtapa(demandas: readonly DemandaDoResumo[]): Record<(typeof ETAPAS_DO_RESUMO)[number], number> {
  const contagem = Object.fromEntries(ETAPAS_DO_RESUMO.map((etapa) => [etapa, 0])) as Record<(typeof ETAPAS_DO_RESUMO)[number], number>;
  for (const demanda of demandas) {
    if ((ETAPAS_DO_RESUMO as readonly string[]).includes(demanda.etapa)) contagem[demanda.etapa as (typeof ETAPAS_DO_RESUMO)[number]] += 1;
  }
  return contagem;
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** "AAAA-MM-DD" do instante no fuso de São Paulo, onde a Dutelog trabalha. */
export function diaDoInstante(iso: string): string | null {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const partes = DIA_EM_SAO_PAULO.formatToParts(data);
  const parte = (tipo: string) => partes.find((item) => item.type === tipo)?.value;
  const [ano, mes, dia] = [parte("year"), parte("month"), parte("day")];
  return ano && mes && dia ? `${ano}-${mes}-${dia}` : null;
}

/** "AAAA-MM" do instante no fuso de São Paulo. */
export function competenciaDoInstante(iso: string): string | null {
  return diaDoInstante(iso)?.slice(0, 7) ?? null;
}

const UM_DIA_MS = 86_400_000;

/** Dias corridos entre dois dias do calendário ("AAAA-MM-DD"). */
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA_MS);
}

/**
 * As propostas enviadas que esperam o cliente há mais de `dias` dias corridos
 * (desde que a demanda entrou em "Aguardando cliente"), a mais antiga primeiro.
 */
export function propostasSemResposta(
  demandas: readonly DemandaDoResumo[],
  hoje: string,
  dias: number = DIAS_SEM_RESPOSTA,
): PropostaSemResposta[] {
  return demandas
    .flatMap((demanda) => {
      if (demanda.etapa !== "aguardando_cliente" || !demanda.etapaDesde) return [];
      const enviadaEm = diaDoInstante(demanda.etapaDesde);
      if (!enviadaEm) return [];
      const passados = diasEntre(enviadaEm, hoje);
      return passados > dias ? [{ numero: demanda.numero, cliente: demanda.cliente, enviadaEm, dias: passados }] : [];
    })
    .sort((a, b) => b.dias - a.dias || a.numero.localeCompare(b.numero));
}

function primeiroMarco(demanda: DemandaDoResumo, etapa: EtapaDemanda): string | null {
  return demanda.marcos.find((marco) => marco.etapa === etapa)?.em ?? null;
}

export type NumerosDoMes = { enviados: number; fechados: number; perdidos: number };

/**
 * O mês do Comercial: demandas enviadas ao cliente pela primeira vez, fechadas
 * pela primeira vez e perdidas na competência. Uma revisão enviada de novo não
 * conta outra vez.
 */
export function numerosDoMes(demandas: readonly DemandaDoResumo[], competencia: string): NumerosDoMes {
  const noMes = (iso: string | null) => Boolean(iso) && competenciaDoInstante(iso!) === competencia;
  return {
    enviados: demandas.filter((demanda) => noMes(primeiroMarco(demanda, "aguardando_cliente"))).length,
    fechados: demandas.filter((demanda) => noMes(primeiroMarco(demanda, "para_planejar"))).length,
    perdidos: demandas.filter((demanda) => demanda.etapa === "perdida" && noMes(demanda.perdaEm)).length,
  };
}

/** Início da competência no fuso de São Paulo (sem horário de verão desde 2019). */
export function inicioDaCompetencia(competencia: string): Date {
  return new Date(`${competencia}-01T00:00:00-03:00`);
}
