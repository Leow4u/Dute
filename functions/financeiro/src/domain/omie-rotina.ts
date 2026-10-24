import { type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import {
  AMBIENTE_DA_OMIE,
  CONFIGURACAO_DA_OMIE,
  EMISSOES_COLLECTION,
  ETAPAS_DA_ROTINA,
  comFalha,
  comResposta,
  emissaoLida,
  omieLiberada,
  paradaSemChaves,
  passoDaEmissao,
  pedidoDoPasso,
  type Avanco,
  type Emissao,
} from "./emissao-omie.js";
import {
  BAIXAS_COLLECTION,
  ETAPAS_DA_ROTINA_DA_BAIXA,
  baixaLida,
  baixaSemChaves,
  comFalhaDaBaixa,
  comRespostaDaBaixa,
  passoDaBaixa,
  pedidoDaBaixa,
  type Baixa,
} from "./baixa-omie.js";
import { gravarBaixa } from "./baixa-gravacao.js";
import { gravarEmissao, lerReservas, soltarReservas } from "./emissao-gravacao.js";
import { createFinanceiroEvent } from "./events.js";
import { FATURAS_COLLECTION, faturaIdDaNf } from "./fatura.js";
import { gravarFatura, lerParaFaturar } from "./fatura-gravacao.js";
import { ErroDaOmie, chamarOmie, type ChavesDaOmie, type TransporteDaOmie } from "./omie.js";
import type { FinanceiroActor } from "./operations.js";

/**
 * A rotina da emissão da NFS-e pela Omie (parte 7.4d; desenho em
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie").
 *
 * A cada passada, cada emissão que é hora de andar dá um passo: uma chamada
 * à Omie (emissao-omie.ts diz qual) e uma transação que grava o resultado.
 * Uma chamada por vez, para respeitar os limites da Omie. A chave inválida
 * para a passada inteira: as outras emissões falhariam igual. Sem as chaves
 * no ambiente, nada se chama: a emissão que é hora de andar para com o
 * motivo `sem_chaves` e espera uma pessoa, em vez de prender as reservas.
 *
 * Na NFS-e autorizada, a fatura nasce na mesma transação, pela
 * lerParaFaturar e pela gravarFatura do registerNf, com o número da nota e a
 * série 1. Se a fatura não puder nascer (a NF já registrada à mão, a demanda
 * que mudou), a emissão para com o motivo e a reserva continua: a nota
 * existe, e uma pessoa decide.
 *
 * Se uma pessoa mexeu na emissão entre a leitura e a gravação (a edição
 * mudou), o resultado da Omie se descarta; a próxima passada lê de novo, e
 * o código de integração (cCodIntOS) e o StatusOS reconciliam.
 */

export const ATOR_DA_ROTINA: FinanceiroActor = { uid: "rotina-omie", role: "sistema", name: "Rotina da Omie" };

/** Quantas emissões andam por passada, dentro do tempo da função. */
export const EMISSOES_POR_PASSADA = 20;

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export type ResumoDaRotina = {
  liberada: boolean;
  sem_chaves: boolean;
  passos: number;
  autorizadas: number;
  paradas: number;
  descartadas: number;
  parou_pela_chave: boolean;
};

export type OpcoesDaRotina = {
  projectId: string;
  chaves: ChavesDaOmie | null;
  transporte: TransporteDaOmie;
  agora?: () => Date;
  limite?: number;
};

function resumoVazio(liberada: boolean, semChaves: boolean): ResumoDaRotina {
  return { liberada, sem_chaves: semChaves, passos: 0, autorizadas: 0, paradas: 0, descartadas: 0, parou_pela_chave: false };
}

export async function runOmieSyncFor(db: Firestore, opcoes: OpcoesDaRotina): Promise<ResumoDaRotina> {
  if (!omieLiberada(opcoes.projectId)) return resumoVazio(false, false);
  const ambiente = AMBIENTE_DA_OMIE[opcoes.projectId];
  const configuracao = CONFIGURACAO_DA_OMIE[opcoes.projectId];
  if (!ambiente || !configuracao) return resumoVazio(false, false);
  const chaves = opcoes.chaves?.app_key && opcoes.chaves.app_secret ? opcoes.chaves : null;
  const agora = opcoes.agora ?? (() => new Date());
  const resumo = resumoVazio(true, chaves === null);

  const snapshot = await db.collection(EMISSOES_COLLECTION).where("etapa", "in", [...ETAPAS_DA_ROTINA]).get();
  const inicio = agora();
  const prontas = snapshot.docs
    .flatMap((doc) => {
      try {
        return [emissaoLida(doc.id, doc.data())];
      } catch {
        console.error("runOmieSync: emissão ilegível", doc.id);
        return [];
      }
    })
    .filter((emissao) => passoDaEmissao(emissao, inicio) !== null)
    .sort((a, b) => a.proxima_em.localeCompare(b.proxima_em) || a.id.localeCompare(b.id))
    .slice(0, opcoes.limite ?? EMISSOES_POR_PASSADA);

  if (!chaves) {
    for (const emissao of prontas) {
      const instante = agora();
      const gravado = await gravarPasso(db, emissao, paradaSemChaves(emissao, instante), instante);
      if (gravado === "descartado") resumo.descartadas += 1;
      if (gravado === "parada") resumo.paradas += 1;
    }
    return resumo;
  }

  for (const emissao of prontas) {
    const instante = agora();
    const passo = passoDaEmissao(emissao, instante);
    if (!passo) continue;
    const pedido = pedidoDoPasso(passo, emissao, DIA_EM_SAO_PAULO.format(instante), configuracao);
    let avanco: Avanco;
    let pelaChave = false;
    try {
      const corpo = await chamarOmie(opcoes.transporte, chaves, pedido.servico, pedido.call, pedido.param);
      avanco = comResposta(emissao, passo, corpo, { agora: instante, ambiente });
    } catch (error) {
      if (!(error instanceof ErroDaOmie)) throw error;
      avanco = { emissao: comFalha(emissao, passo, error.falha, instante), efeito: "nenhum" };
      pelaChave = error.falha.tipo === "chave";
    }
    resumo.passos += 1;
    const gravado = await gravarPasso(db, emissao, avanco, instante);
    if (gravado === "descartado") resumo.descartadas += 1;
    if (gravado === "autorizada") resumo.autorizadas += 1;
    if (gravado === "parada") resumo.paradas += 1;
    if (pelaChave) {
      resumo.parou_pela_chave = true;
      break;
    }
  }
  return resumo;
}

// --- A baixa do pagamento (parte 7.4g) ------------------------------------------------------

/** Quantas baixas andam por passada, depois das emissões. */
export const BAIXAS_POR_PASSADA = 20;

export type ResumoDasBaixas = {
  liberada: boolean;
  sem_chaves: boolean;
  passos: number;
  lancadas: number;
  canceladas: number;
  paradas: number;
  descartadas: number;
  parou_pela_chave: boolean;
};

function resumoDasBaixasVazio(liberada: boolean, semChaves: boolean): ResumoDasBaixas {
  return { liberada, sem_chaves: semChaves, passos: 0, lancadas: 0, canceladas: 0, paradas: 0, descartadas: 0, parou_pela_chave: false };
}

/**
 * A passada das baixas: cada baixa que é hora de andar dá um passo
 * (conferir o título, lançar ou cancelar o recebimento), uma chamada por
 * vez. Sem as chaves, nada se chama e a baixa para com o motivo
 * `sem_chaves`; a chave inválida para a passada.
 */
export async function runOmieBaixasFor(db: Firestore, opcoes: OpcoesDaRotina): Promise<ResumoDasBaixas> {
  if (!omieLiberada(opcoes.projectId)) return resumoDasBaixasVazio(false, false);
  const configuracao = CONFIGURACAO_DA_OMIE[opcoes.projectId];
  if (!configuracao) return resumoDasBaixasVazio(false, false);
  const chaves = opcoes.chaves?.app_key && opcoes.chaves.app_secret ? opcoes.chaves : null;
  const agora = opcoes.agora ?? (() => new Date());
  const resumo = resumoDasBaixasVazio(true, chaves === null);

  const snapshot = await db.collection(BAIXAS_COLLECTION).where("etapa", "in", [...ETAPAS_DA_ROTINA_DA_BAIXA]).get();
  const inicio = agora();
  const prontas = snapshot.docs
    .flatMap((doc) => {
      try {
        return [baixaLida(doc.id, doc.data())];
      } catch {
        console.error("runOmieSync: baixa ilegível", doc.id);
        return [];
      }
    })
    .filter((baixa) => passoDaBaixa(baixa, inicio) !== null)
    .sort((a, b) => a.proxima_em.localeCompare(b.proxima_em) || a.id.localeCompare(b.id))
    .slice(0, opcoes.limite ?? BAIXAS_POR_PASSADA);

  for (const baixa of prontas) {
    const instante = agora();
    const passo = passoDaBaixa(baixa, instante);
    if (!passo) continue;
    let nova: Baixa;
    let pelaChave = false;
    if (!chaves) {
      nova = baixaSemChaves(baixa, instante);
    } else {
      const pedido = pedidoDaBaixa(passo, baixa);
      try {
        const corpo = await chamarOmie(opcoes.transporte, chaves, pedido.servico, pedido.call, pedido.param);
        nova = comRespostaDaBaixa(baixa, passo, corpo, instante, configuracao);
      } catch (error) {
        if (!(error instanceof ErroDaOmie)) throw error;
        nova = comFalhaDaBaixa(baixa, error.falha, instante);
        pelaChave = error.falha.tipo === "chave";
      }
      resumo.passos += 1;
    }
    const gravado = await gravarPassoDaBaixa(db, baixa, nova, instante);
    if (gravado === "descartado") resumo.descartadas += 1;
    if (gravado === "lancada") resumo.lancadas += 1;
    if (gravado === "cancelada") resumo.canceladas += 1;
    if (gravado === "parada") resumo.paradas += 1;
    if (pelaChave) {
      resumo.parou_pela_chave = true;
      break;
    }
  }
  return resumo;
}

/** A baixa nova, se ninguém mexeu nela durante a chamada, com o evento da etapa a que chegou. */
async function gravarPassoDaBaixa(db: Firestore, lida: Baixa, nova: Baixa, instante: Date): Promise<"gravado" | "descartado" | "lancada" | "cancelada" | "parada"> {
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(db.collection(BAIXAS_COLLECTION).doc(lida.id));
    if (!snap.exists || Number(snap.get("edicao")) !== lida.edicao) return "descartado";
    const iso = instante.toISOString();
    gravarBaixa(transaction, db, nova);
    if (nova.etapa === lida.etapa) return "gravado";
    const evento = { operation_id: `rotina-omie:${nova.id}:${nova.edicao}`, entity_id: nova.id, customer_code: nova.customer_code, actor: ATOR_DA_ROTINA, occurred_at: iso };
    if (nova.etapa === "lancada") {
      createFinanceiroEvent(transaction, db, { ...evento, type: "nf.settlement_posted", payload: { id: nova.id, pagamento_id: nova.pagamento_id } });
      return "lancada";
    }
    if (nova.etapa === "cancelada") {
      createFinanceiroEvent(transaction, db, { ...evento, type: "nf.settlement_cancelled", payload: { id: nova.id, pagamento_id: nova.pagamento_id } });
      return "cancelada";
    }
    if (nova.etapa === "parada" && nova.motivo_da_parada) {
      createFinanceiroEvent(transaction, db, { ...evento, type: "nf.settlement_stopped", payload: { id: nova.id, motivo: nova.motivo_da_parada } });
      return "parada";
    }
    return "gravado";
  });
}

type Gravado = "gravado" | "descartado" | "autorizada" | "parada";

async function gravarPasso(db: Firestore, lida: Emissao, avanco: Avanco, instante: Date): Promise<Gravado> {
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(db.collection(EMISSOES_COLLECTION).doc(lida.id));
    if (!snap.exists || Number(snap.get("edicao")) !== lida.edicao) return "descartado";
    const iso = instante.toISOString();
    const operationId = `rotina-omie:${lida.id}:${avanco.emissao.edicao}`;
    let nova = avanco.emissao;
    let fatura: { id: string } | null = null;

    if (avanco.efeito === "registrar_fatura") {
      const tentativa = await prepararFatura(transaction, db, nova, iso);
      if ("problema" in tentativa) {
        nova = { ...nova, etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: "fatura_recusada", mensagem: tentativa.problema };
      } else {
        fatura = { id: tentativa.id };
        // Todas as leituras antes: a gravação vem depois de gravarEmissao.
        gravarEmissao(transaction, db, nova, { fatura_id: tentativa.id, autorizada_em: iso });
        tentativa.gravar(operationId);
        createFinanceiroEvent(transaction, db, {
          operation_id: operationId,
          suffix: "nf.emission_authorized",
          type: "nf.emission_authorized",
          entity_id: nova.id,
          customer_code: nova.customer_code,
          payload: { id: nova.id, fatura_id: tentativa.id },
          actor: ATOR_DA_ROTINA,
          occurred_at: iso,
        });
        return "autorizada";
      }
    }

    if (avanco.efeito === "liberar_reservas") {
      const reservas = await lerReservas(transaction, db, nova);
      gravarEmissao(transaction, db, nova);
      soltarReservas(transaction, reservas);
      createFinanceiroEvent(transaction, db, {
        operation_id: operationId,
        type: "nf.emission_released",
        entity_id: nova.id,
        customer_code: nova.customer_code,
        payload: { id: nova.id, demandas: reservas.demandas, competencias: reservas.competencias },
        actor: ATOR_DA_ROTINA,
        occurred_at: iso,
      });
      return "gravado";
    }

    gravarEmissao(transaction, db, nova);
    if (nova.etapa !== lida.etapa && nova.etapa === "rejeitada") {
      createFinanceiroEvent(transaction, db, {
        operation_id: operationId,
        type: "nf.emission_rejected",
        entity_id: nova.id,
        customer_code: nova.customer_code,
        payload: { id: nova.id },
        actor: ATOR_DA_ROTINA,
        occurred_at: iso,
      });
    }
    if (nova.etapa !== lida.etapa && nova.etapa === "parada" && nova.motivo_da_parada) {
      createFinanceiroEvent(transaction, db, {
        operation_id: operationId,
        type: "nf.emission_stopped",
        entity_id: nova.id,
        customer_code: nova.customer_code,
        payload: { id: nova.id, motivo: nova.motivo_da_parada },
        actor: ATOR_DA_ROTINA,
        occurred_at: iso,
      });
      return "parada";
    }
    return fatura ? "autorizada" : "gravado";
  });
}

type FaturaPreparada = { id: string; gravar: (operationId: string) => void } | { problema: string };

/**
 * As leituras da fatura da NFS-e autorizada, e a gravação para depois. O
 * número é o da NFS-e, a série é 1 (a mesma do registro à mão) e a emissão
 * é o dia da autorização em São Paulo.
 */
async function prepararFatura(transaction: Transaction, db: Firestore, emissao: Emissao, iso: string): Promise<FaturaPreparada> {
  const numero = (emissao.omie.nfse ?? "").replace(/^0+(?=\d)/, "");
  if (!/^\d{1,15}$/.test(numero)) return { problema: `A Omie devolveu o número da NFS-e fora do formato (${emissao.omie.nfse ?? "vazio"}).` };
  const id = faturaIdDaNf("1", numero);
  const existente = await transaction.get(db.collection(FATURAS_COLLECTION).doc(id));
  const anterior = existente.exists ? (existente.data() ?? {}) : null;
  if (anterior && anterior.status !== "cancelada") return { problema: `A NF ${numero} da série 1 já está registrada: cancele o registro à mão e retome a emissão.` };
  const pedido = {
    demandas: emissao.itens.filter((item) => item.origem === "demanda").map((item) => item.referencia),
    armazenagem: emissao.itens.filter((item) => item.origem === "armazenagem").map((item) => item.referencia),
  };
  let lido: Awaited<ReturnType<typeof lerParaFaturar>>;
  try {
    lido = await lerParaFaturar(transaction, db, pedido, emissao.id);
  } catch (error) {
    if (error instanceof HttpsError) return { problema: `A NFS-e ${numero} foi autorizada, mas a fatura não nasceu: ${error.message}` };
    throw error;
  }
  return {
    id,
    gravar: (operationId) =>
      gravarFatura(transaction, db, {
        id,
        lido,
        nf: { numero, serie: "1", emitida_em: DIA_EM_SAO_PAULO.format(new Date(iso)) },
        vencimento: emissao.vencimento,
        forma: emissao.forma,
        observacao: emissao.observacao,
        anterior,
        iso,
        operationId,
        ator: ATOR_DA_ROTINA,
        extra: {
          origem_nf: "omie",
          emissao_id: emissao.id,
          omie: { os: emissao.omie.os, codigo_verificacao: emissao.omie.codigo_verificacao, url_nfse: emissao.omie.url_nfse, url_pdf: emissao.omie.url_pdf },
        },
      }),
  };
}
