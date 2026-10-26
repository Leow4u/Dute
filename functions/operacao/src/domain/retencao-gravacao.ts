import { Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import { CLIENT_NOTIFICATIONS_COLLECTION, EMAIL_OUTBOX_COLLECTION } from "./avisos-gravacao.js";
import { createOperacaoEvent } from "./events.js";
import type { OperacaoActor } from "./operations.js";
import { contagemPorCliente, emailForaDaFila, idDaRetencao, limiteDosAvisos } from "./retencao.js";
import { diaEmSaoPaulo } from "./tv.js";

/**
 * A retenção dos avisos no Firestore (LGPD, decisão 8): apaga o aviso do
 * sino e o e-mail que já saiu da fila com mais de 90 dias e grava um evento
 * com as contagens por cliente. Rodar de novo não apaga mais nada nem grava
 * outro evento. Apagar não refaz o aviso: a rotina dos avisos só anda para a
 * frente, pelo cursor.
 */

export const RETENCAO_ACTOR: OperacaoActor = { uid: "rotina-retencao", role: "sistema", name: "Rotina de retenção da Operação" };

/** Quantos documentos de cada coleção por leitura, e até quantas leituras por rodada: o resto fica para o dia seguinte. */
const LOTE = 400;
const LEITURAS = 10;
/** O lote do Firestore aceita 500 escritas. */
const ESCRITAS_POR_LOTE = 450;

export type ResultadoDaRetencao = { antes_de: string; avisos: number; emails: number; evento: string | null; completo: boolean };

function clienteDe(doc: QueryDocumentSnapshot): string {
  const codigo = doc.get("customer_code");
  return typeof codigo === "string" ? codigo : "";
}

async function apagar(db: Firestore, docs: readonly QueryDocumentSnapshot[]): Promise<void> {
  for (let inicio = 0; inicio < docs.length; inicio += ESCRITAS_POR_LOTE) {
    const batch = db.batch();
    for (const doc of docs.slice(inicio, inicio + ESCRITAS_POR_LOTE)) batch.delete(doc.ref);
    await batch.commit();
  }
}

export async function runRetentionFor(
  db: Firestore,
  opcoes: { agora?: Date; lote?: number; leituras?: number } = {},
): Promise<ResultadoDaRetencao> {
  const agora = opcoes.agora ?? new Date();
  const lote = opcoes.lote ?? LOTE;
  const limite = limiteDosAvisos(agora);
  const antesDe = diaEmSaoPaulo(limite);
  const limiteNoBanco = Timestamp.fromDate(limite);
  const clientesDosAvisos: string[] = [];
  const clientesDosEmails: string[] = [];
  // O e-mail pendente fica: a leitura seguinte começa depois do último lido, para não voltar a ele.
  let depoisDoEmail: QueryDocumentSnapshot | undefined;
  let completo = false;
  for (let leitura = 0; leitura < (opcoes.leituras ?? LEITURAS); leitura += 1) {
    let consultaDosEmails = db.collection(EMAIL_OUTBOX_COLLECTION).where("created_at", "<", limiteNoBanco).orderBy("created_at").limit(lote);
    if (depoisDoEmail) consultaDosEmails = consultaDosEmails.startAfter(depoisDoEmail);
    const [avisos, emails] = await Promise.all([
      db.collection(CLIENT_NOTIFICATIONS_COLLECTION).where("created_at", "<", limiteNoBanco).orderBy("created_at").limit(lote).get(),
      consultaDosEmails.get(),
    ]);
    const emailsQueSaem = emails.docs.filter((doc) => emailForaDaFila(doc.get("status")));
    await apagar(db, [...avisos.docs, ...emailsQueSaem]);
    clientesDosAvisos.push(...avisos.docs.map(clienteDe));
    clientesDosEmails.push(...emailsQueSaem.map(clienteDe));
    depoisDoEmail = emails.docs.at(-1) ?? depoisDoEmail;
    if (avisos.size < lote && emails.size < lote) {
      completo = true;
      break;
    }
  }
  if (!clientesDosAvisos.length && !clientesDosEmails.length) {
    return { antes_de: antesDe, avisos: 0, emails: 0, evento: null, completo };
  }
  const id = idDaRetencao(agora);
  const evento = await db.runTransaction(async (transaction) =>
    createOperacaoEvent(transaction, db, {
      operation_id: `retencao:${id}`,
      type: "retention.applied",
      entity_id: id,
      payload: {
        id,
        antes_de: antesDe,
        avisos: clientesDosAvisos.length,
        emails: clientesDosEmails.length,
        por_cliente: contagemPorCliente(clientesDosAvisos, clientesDosEmails).slice(0, 500),
      },
      actor: RETENCAO_ACTOR,
      occurred_at: agora.toISOString(),
    }),
  );
  return { antes_de: antesDe, avisos: clientesDosAvisos.length, emails: clientesDosEmails.length, evento: evento.id, completo };
}
