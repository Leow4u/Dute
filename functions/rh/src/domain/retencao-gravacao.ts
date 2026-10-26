import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { diaEmSaoPaulo } from "./dia.js";
import { createRhEvent } from "./events.js";
import { EXPORTACOES_COLLECTION, ID_EXPORTACAO } from "./exportacao.js";
import type { RhActor } from "./operations.js";
import { substituidasParaLimpar, type VersaoGuardada } from "./retencao.js";

/**
 * A retenção da exportação no banco `dute-rh` (LGPD, decisão 7): a versão
 * substituída há mais de 30 dias perde as linhas, e o evento
 * `rh.export_lines_removed` registra a versão e a que a substituiu. Uma
 * transação por versão, que relê o documento: rodar de novo não apaga nem
 * grava mais nada.
 */

export const RETENCAO_DO_RH: RhActor = { uid: "rotina-retencao-rh", role: "sistema", name: "Rotina de retenção do RH" };

/** `falhas`: as versões que não se limparam; a rotina segue com as outras e tenta de novo amanhã. */
export type ResultadoDaRetencaoDoRh = { dia: string; substituidas: number; limpas: number; falhas: number };

export async function runRhRetentionFor(rh: Firestore, agora: Date = new Date()): Promise<ResultadoDaRetencaoDoRh> {
  // Só os campos da regra: as linhas, com o CPF, não precisam sair do banco.
  const snapshot = await rh.collection(EXPORTACOES_COLLECTION).select("competencia", "versao", "gerada_em", "linhas_apagadas_em").get();
  const versoes: VersaoGuardada[] = snapshot.docs.flatMap((doc) => {
    const data = doc.data();
    if (!ID_EXPORTACAO.test(doc.id) || typeof data.competencia !== "string" || !Number.isInteger(data.versao) || typeof data.gerada_em !== "string") return [];
    return [{ id: doc.id, competencia: data.competencia, versao: data.versao, gerada_em: data.gerada_em, limpa: typeof data.linhas_apagadas_em === "string" }];
  });
  const devidas = substituidasParaLimpar(versoes, agora);
  let limpas = 0;
  let falhas = 0;
  for (const devida of devidas) {
    try {
      const limpou = await rh.runTransaction(async (transaction) => {
        const ref = rh.collection(EXPORTACOES_COLLECTION).doc(devida.id);
        const atual = await transaction.get(ref);
        if (!atual.exists || typeof atual.get("linhas_apagadas_em") === "string") return false;
        transaction.update(ref, { exames: FieldValue.delete(), colaboradores: FieldValue.delete(), linhas_apagadas_em: agora.toISOString() });
        createRhEvent(transaction, rh, {
          operation_id: `retencao-rh:${devida.id}`,
          type: "rh.export_lines_removed",
          entity_id: devida.id,
          payload: devida,
          actor: RETENCAO_DO_RH,
          occurred_at: agora.toISOString(),
        });
        return true;
      });
      if (limpou) limpas += 1;
    } catch (erro) {
      console.error("[runRhRetention] versão não limpa", { id: devida.id, erro });
      falhas += 1;
    }
  }
  return { dia: diaEmSaoPaulo(agora), substituidas: devidas.length, limpas, falhas };
}
