import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { createRhEvent } from "./events.js";
import { atorDoRh, exigeQuemGrava, lerColaborador } from "./ficha-gravacao.js";
import { actorPayload, runIdempotent } from "./operations.js";
import type { RhProfile } from "./profile.js";
import { VINCULOS_COLLECTION, entradaDoVinculo, vinculoLido, vinculoSalvo } from "./vinculo.js";

/**
 * As datas do vínculo no Firestore (parte 8.4). A gravação confere o
 * colaborador no cadastro da Operação (banco padrão) e grava as datas, o
 * recibo e o evento numa transação do banco `dute-rh`, como a ficha. O
 * cadastro da Operação não muda.
 */

export type ResultadoDoVinculo = { colaborador_id: string; edicao: number };

/** saveRhVinculo: grava a admissão e o desligamento do colaborador de vínculo próprio. Só o rh grava. */
export async function saveRhVinculoFor(padrao: Firestore, rh: Firestore, caller: RhProfile, data: unknown) {
  exigeQuemGrava(caller);
  const entrada = entradaDoVinculo(data);
  const colaborador = await lerColaborador(padrao, entrada.colaborador_id);
  if (colaborador.vinculo !== "proprio") throw new HttpsError("failed-precondition", "Só o vínculo próprio tem admissão e desligamento.");
  const actor = atorDoRh(caller);
  const { idempotency_key, ...input } = entrada;
  return runIdempotent<ResultadoDoVinculo>(
    rh,
    { kind: "vinculo_rh", scope: { colaborador_id: entrada.colaborador_id }, idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const ref = rh.collection(VINCULOS_COLLECTION).doc(entrada.colaborador_id);
      const snapshot = await transaction.get(ref);
      const atual = snapshot.exists ? vinculoLido(snapshot.id, snapshot.data() ?? {}) : null;
      const salvo = vinculoSalvo(atual, entrada);
      const carimbo = { updated_at: FieldValue.serverTimestamp(), updated_by: actorPayload(actor) };
      if (atual) transaction.update(ref, { ...salvo, ...carimbo });
      else transaction.create(ref, { ...salvo, created_at: FieldValue.serverTimestamp(), created_by: actorPayload(actor), ...carimbo });
      createRhEvent(transaction, rh, {
        operation_id: operationId,
        type: "rh.vinculo_saved",
        entity_id: salvo.colaborador_id,
        payload: {
          id: salvo.colaborador_id,
          admissao: salvo.admissao,
          desligamento: salvo.desligamento,
          edicao_antes: atual?.edicao ?? null,
          edicao_depois: salvo.edicao,
        },
        actor,
      });
      return { target_id: salvo.colaborador_id, result: { colaborador_id: salvo.colaborador_id, edicao: salvo.edicao } };
    },
  );
}
