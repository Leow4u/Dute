import type { DocumentData, Firestore } from "firebase-admin/firestore";

import type { ColaboradorGravado, VeiculoGravado } from "./cadastro.js";
import { EVENTS_COLLECTION, createOperacaoEvent, operacaoEventId } from "./events.js";
import { colaboradorLido, veiculoLido } from "./gravacao.js";
import type { OperacaoActor } from "./operations.js";
import { alertasDoDia } from "./rotina.js";
import { diaEmSaoPaulo } from "./tv.js";

/**
 * A rotina diária no Firestore (parte 3.13a): lê quem e o que está ativo e
 * grava o evento de cada alerta. O id do evento sai do dia e do item, então
 * rodar de novo no mesmo dia não duplica: uma vez por dia por item.
 */

export const ROTINA_ACTOR: OperacaoActor = { uid: "rotina-diaria", role: "sistema", name: "Rotina diária da Operação" };

export type ResultadoDaRotina = { dia: string; alertas: number; criados: number };

function lidos<T>(docs: ReadonlyArray<{ id: string; data: () => DocumentData }>, ler: (id: string, data: DocumentData) => T): T[] {
  return docs.flatMap((doc) => {
    try {
      return [ler(doc.id, doc.data())];
    } catch {
      // Cadastro ilegível fica de fora do alerta; a tela do cadastro mostra o problema.
      return [];
    }
  });
}

export async function runDailyAlertsFor(db: Firestore, agora: Date = new Date()): Promise<ResultadoDaRotina> {
  const dia = diaEmSaoPaulo(agora);
  const [colaboradores, veiculos] = await Promise.all([
    db.collection("collaborators").where("ativo", "==", true).get(),
    db.collection("vehicles").where("ativo", "==", true).get(),
  ]);
  const alertas = alertasDoDia(dia, lidos<ColaboradorGravado>(colaboradores.docs, colaboradorLido), lidos<VeiculoGravado>(veiculos.docs, veiculoLido));
  const operationId = `rotina:${dia}`;
  let criados = 0;
  for (const alerta of alertas) {
    const suffix = `${alerta.tipo}:${alerta.id}`;
    const criou = await db.runTransaction(async (transaction) => {
      const ref = db.collection(EVENTS_COLLECTION).doc(operacaoEventId(operationId, suffix));
      if ((await transaction.get(ref)).exists) return false;
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        suffix,
        type: alerta.tipo,
        entity_id: alerta.id,
        payload: { id: alerta.id, dia, dias: alerta.dias },
        actor: ROTINA_ACTOR,
        occurred_at: agora.toISOString(),
      });
      return true;
    });
    if (criou) criados += 1;
  }
  return { dia, alertas: alertas.length, criados };
}
