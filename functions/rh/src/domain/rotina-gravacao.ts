import type { Firestore } from "firebase-admin/firestore";

import { diaEmSaoPaulo, somarDias } from "./dia.js";
import { EVENTS_COLLECTION, createRhEvent, rhEventId } from "./events.js";
import { COLLABORATORS_COLLECTION, DIAS_PARA_O_VENCIMENTO, REGISTROS_COLLECTION, marcoDoVencimento, vencimentosDoDia } from "./ficha.js";
import { registroLido } from "./ficha-gravacao.js";
import type { RhActor } from "./operations.js";

/**
 * A rotina diária do RH (parte 8.2a): o registro vigente de quem está ativo
 * que vence em até DIAS_PARA_O_VENCIMENTO dias vira o evento
 * `rh.record_expiring`, e o vencido, `rh.record_expired`. Uma vez por
 * registro, por vencimento e por marco: o id do evento sai dos três, então
 * rodar de novo não duplica, e o vencimento corrigido avisa de novo. O Início
 * do RH mostra o mesmo pela leitura dos registros (getRhPanel); o evento é o
 * que a IA mede.
 */

export const ROTINA_ACTOR: RhActor = { uid: "rotina-rh", role: "sistema", name: "Rotina diária do RH" };

/** `falhas`: os registros cujo evento não se gravou; a rotina segue com os outros e tenta de novo amanhã. */
export type ResultadoDaRotina = { dia: string; vencimentos: number; criados: number; falhas: number };

export async function runRhAlertsFor(padrao: Firestore, rh: Firestore, agora: Date = new Date()): Promise<ResultadoDaRotina> {
  const dia = diaEmSaoPaulo(agora);
  const [cadastro, registros] = await Promise.all([
    padrao.collection(COLLABORATORS_COLLECTION).where("ativo", "==", true).get(),
    rh.collection(REGISTROS_COLLECTION).where("vence_em", "<=", somarDias(dia, DIAS_PARA_O_VENCIMENTO)).get(),
  ]);
  const lidos = registros.docs.flatMap((doc) => {
    try {
      return [registroLido(doc.id, doc.data())];
    } catch {
      // Registro ilegível fica de fora do alerta; a ficha mostra o problema.
      return [];
    }
  });
  const vencimentos = vencimentosDoDia(dia, lidos, new Set(cadastro.docs.map((doc) => doc.id)));
  let criados = 0;
  let falhas = 0;
  for (const vencimento of vencimentos) {
    const marco = marcoDoVencimento(vencimento.dias);
    const operationId = `rotina-rh:${vencimento.registro_id}:${vencimento.vence_em}`;
    try {
      const criou = await rh.runTransaction(async (transaction) => {
        const ref = rh.collection(EVENTS_COLLECTION).doc(rhEventId(operationId, marco));
        if ((await transaction.get(ref)).exists) return false;
        createRhEvent(transaction, rh, {
          operation_id: operationId,
          suffix: marco,
          type: marco === "vencido" ? "rh.record_expired" : "rh.record_expiring",
          entity_id: vencimento.registro_id,
          payload: {
            id: vencimento.registro_id,
            colaborador_id: vencimento.colaborador_id,
            categoria: vencimento.categoria,
            tipo: vencimento.tipo,
            vence_em: vencimento.vence_em,
            dias: vencimento.dias,
          },
          actor: ROTINA_ACTOR,
          occurred_at: agora.toISOString(),
        });
        return true;
      });
      if (criou) criados += 1;
    } catch (error) {
      // Um registro que não vira evento não para os outros.
      falhas += 1;
      console.error("runRhAlerts: registro sem evento", { registro_id: vencimento.registro_id, erro: error instanceof Error ? error.message : String(error) });
    }
  }
  return { dia, vencimentos: vencimentos.length, criados, falhas };
}
