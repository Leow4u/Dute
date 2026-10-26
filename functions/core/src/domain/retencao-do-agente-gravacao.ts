import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import { CONVERSATIONS_COLLECTION, MESSAGES_COLLECTION, USAGE_COLLECTION } from "./agente-conversa.js";
import { createCoreEvent, type CoreSystemActor } from "./eventos.js";
import { diaEmSaoPaulo } from "./parados.js";
import { contagemPorCliente, idDaRetencao, limiteDoAgente, type Tipo } from "./retencao-do-agente.js";

/**
 * A retenção do Agent Dute no Firestore (LGPD, decisão 8): apaga a mensagem
 * e o uso com mais de 12 meses e a conversa parada há mais de 12 meses, limpa
 * o título e o resumo da conversa que fica, e grava, por cliente, um evento
 * com as contagens. Rodar de novo não apaga mais nada nem grava outro evento.
 */

export const RETENCAO_DO_AGENTE: CoreSystemActor = { uid: "rotina-retencao-agente", role: "sistema", name: "Rotina de retenção do Agent Dute" };

/** Quantos documentos de cada coleção por leitura, e até quantas leituras por rodada: o resto fica para o dia seguinte. */
const LOTE = 400;
const LEITURAS = 10;
/** O lote do Firestore aceita 500 escritas. */
const ESCRITAS_POR_LOTE = 450;

/** A mensagem e o uso pela criação; a conversa pela última mensagem (`updated_at`, que o agente do núcleo e o do WMS mexem a cada uma). */
const COLECOES: ReadonlyArray<{ tipo: Tipo; colecao: string; campo: string }> = [
  { tipo: "mensagens", colecao: MESSAGES_COLLECTION, campo: "created_at" },
  { tipo: "usos", colecao: USAGE_COLLECTION, campo: "created_at" },
  { tipo: "conversas", colecao: CONVERSATIONS_COLLECTION, campo: "updated_at" },
];

/** O resumo das mensagens antigas, que o agente refaz com as que ficaram. */
const CAMPOS_DO_RESUMO = ["summary", "summary_upto_iso", "summary_updated_at"] as const;

export type ResultadoDaRetencaoDoAgente = { antes_de: string; mensagens: number; conversas: number; usos: number; conversas_limpas: number; eventos: number; completo: boolean };

type Saido = { cliente: string; tipo: Tipo };

async function apagar(db: Firestore, docs: readonly QueryDocumentSnapshot[]): Promise<void> {
  for (let inicio = 0; inicio < docs.length; inicio += ESCRITAS_POR_LOTE) {
    const batch = db.batch();
    for (const doc of docs.slice(inicio, inicio + ESCRITAS_POR_LOTE)) batch.delete(doc.ref);
    await batch.commit();
  }
}

function clienteDe(doc: DocumentSnapshot): string {
  const codigo = doc.get("customer_code");
  return typeof codigo === "string" ? codigo.trim() : "";
}

/** O título da conversa é a primeira pergunta; o da rotina é o nome dela e fica. */
function camposParaLimpar(conversa: DocumentSnapshot): string[] {
  const campos: string[] = CAMPOS_DO_RESUMO.filter((campo) => conversa.get(campo) !== undefined);
  if (conversa.get("title") !== undefined && !conversa.get("routine_id")) campos.push("title");
  return campos;
}

/**
 * A conversa das mensagens que vão sair perde o título e o resumo, antes de
 * elas saírem: a rodada que parar no meio limpa de novo no dia seguinte. A
 * conversa parada há mais de 12 meses fica de fora, porque sai inteira.
 */
async function limparConversas(db: Firestore, mensagens: readonly QueryDocumentSnapshot[], limite: Timestamp): Promise<Saido[]> {
  const ids = [...new Set(mensagens.map((doc) => doc.get("conversation_id")).filter((id): id is string => typeof id === "string" && id.trim() !== ""))];
  if (!ids.length) return [];
  const conversas = await db.getAll(...ids.map((id) => db.collection(CONVERSATIONS_COLLECTION).doc(id)));
  const limpar = conversas
    .filter((conversa) => {
      const ultima = conversa.get("updated_at");
      return conversa.exists && !(ultima instanceof Timestamp && ultima.toMillis() < limite.toMillis());
    })
    .map((conversa) => ({ conversa, campos: camposParaLimpar(conversa) }))
    .filter(({ campos }) => campos.length > 0);
  for (let inicio = 0; inicio < limpar.length; inicio += ESCRITAS_POR_LOTE) {
    const batch = db.batch();
    for (const { conversa, campos } of limpar.slice(inicio, inicio + ESCRITAS_POR_LOTE)) {
      batch.update(conversa.ref, Object.fromEntries(campos.map((campo) => [campo, FieldValue.delete()])));
    }
    await batch.commit();
  }
  return limpar.map(({ conversa }) => ({ cliente: clienteDe(conversa), tipo: "conversas_limpas" }));
}

export async function runAgentRetentionFor(
  db: Firestore,
  opcoes: { agora?: Date; lote?: number; leituras?: number } = {},
): Promise<ResultadoDaRetencaoDoAgente> {
  const agora = opcoes.agora ?? new Date();
  const lote = opcoes.lote ?? LOTE;
  const limite = limiteDoAgente(agora);
  const antesDe = diaEmSaoPaulo(limite.toISOString())!;
  const limiteNoBanco = Timestamp.fromDate(limite);
  const saidos: Saido[] = [];
  let completo = true;
  for (const { tipo, colecao, campo } of COLECOES) {
    let acabou = false;
    for (let leitura = 0; leitura < (opcoes.leituras ?? LEITURAS) && !acabou; leitura += 1) {
      const lidos = await db.collection(colecao).where(campo, "<", limiteNoBanco).orderBy(campo).limit(lote).get();
      if (tipo === "mensagens") saidos.push(...(await limparConversas(db, lidos.docs, limiteNoBanco)));
      await apagar(db, lidos.docs);
      saidos.push(...lidos.docs.map((doc) => ({ cliente: clienteDe(doc), tipo })));
      acabou = lidos.size < lote;
    }
    if (!acabou) completo = false;
  }
  const totais = { mensagens: 0, conversas: 0, usos: 0, conversas_limpas: 0 };
  for (const { tipo } of saidos) totais[tipo] += 1;
  // O evento do núcleo é sempre de um cliente: o registro sem código fica só na contagem do log.
  const porCliente = contagemPorCliente(saidos).filter((linha) => linha.cliente);
  const id = idDaRetencao(agora);
  for (const { cliente, ...contagem } of porCliente) {
    await db.runTransaction(async (transaction) => {
      createCoreEvent(transaction, db, {
        type: "agente.retencao_aplicada",
        payload: { id, antes_de: antesDe, ...contagem },
        customer_code: cliente,
        actor: RETENCAO_DO_AGENTE,
        occurred_at: agora.toISOString(),
        chave: cliente,
      });
    });
  }
  return { antes_de: antesDe, ...totais, eventos: porCliente.length, completo };
}
