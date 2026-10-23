import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { lerCatalogo } from "./demanda-direta-gravacao.js";
import { createOperacaoEvent } from "./events.js";
import { exigirQuemExecuta, lerParaRegistrar, type ResultadoDoRegistro } from "./execucao-gravacao.js";
import { fotosLidas } from "./fotos.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria } from "./os-gravacao.js";
import type { StatusDaOs } from "./os.js";
import type { OperacaoProfile } from "./profile.js";
import { enviarVistoria, interpretarVistoria } from "./vistoria.js";

/**
 * Envia a vistoria ao Comercial (parte 3.11a): numa transação, a OS, as
 * etapas, as fotos e o catálogo dos itens levantados; a OS vai para Revisada
 * com a vistoria e, quando faltava, a etapa Fim; a demanda recebe o resumo
 * em `vistoria`, o único campo da demanda que este envio escreve. Eventos:
 * `os.step_recorded` (o Fim registrado aqui) e `os.survey_sent`, com as
 * contagens. Nomes, medidas e observações ficam só na OS e na demanda.
 */

const DEMANDS = "demands";

export async function sendSurveyToCommercialFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarVistoria(data);
  const ids = [...new Set(pedido.ambientes.flatMap((ambiente) => ambiente.itens.map((item) => item.lpu_item_id)))];
  return runIdempotent(
    db,
    { kind: "os_survey_send", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao, data: bruto, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const catalogo = await lerCatalogo(transaction, db, ids);
      const demandaRef = db.collection(DEMANDS).doc(os.demanda);
      const demanda = await transaction.get(demandaRef);
      if (!demanda.exists) throw new HttpsError("not-found", "Demanda não encontrada.");
      const { vistoria, resumo, etapas, fim, contagem } = enviarVistoria(os, { etapas: execucao.etapas, fotos: fotosLidas(bruto), catalogo }, pedido, contexto);
      const status: StatusDaOs = "revisada";
      const edicao = os.edicao + 1;
      transaction.update(ref, { vistoria, etapas, status, edicao, ...autoria(caller) });
      transaction.update(demandaRef, { vistoria: resumo, updated_at: FieldValue.serverTimestamp(), updated_by: caller.uid });
      const comum = { entity_id: os.numero, customer_code: os.customer_code, actor: ator(caller), occurred_at: vistoria.instante, operation_id: operationId };
      if (fim) {
        createOperacaoEvent(transaction, db, {
          ...comum,
          suffix: "os.step_recorded",
          type: "os.step_recorded",
          payload: { id: os.numero, demanda: os.demanda, etapa: "fim", instante: fim.instante, canal: fim.canal, informado_por: fim.informado_por },
        });
      }
      createOperacaoEvent(transaction, db, {
        ...comum,
        type: "os.survey_sent",
        payload: { id: os.numero, demanda: os.demanda, instante: vistoria.instante, canal: vistoria.canal, informado_por: vistoria.informado_por, ...contagem },
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status } };
    },
  );
}
