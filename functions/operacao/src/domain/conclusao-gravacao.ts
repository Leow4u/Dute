import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { caminhoDaAssinatura, concluirOs, interpretarConclusao } from "./conclusao.js";
import { guardarConclusaoRecusada } from "./conclusao-recusada-gravacao.js";
import { ORDERS_COLLECTION, retornoAoArmazem, retornoNoPedido } from "./demanda-do-armazem.js";
import { createOperacaoEvent } from "./events.js";
import { exigirQuemExecuta, lerParaRegistrar, type ResultadoDoRegistro } from "./execucao-gravacao.js";
import { fotosLidas } from "./fotos.js";
import type { ConferirArquivo } from "./fotos-gravacao.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria } from "./os-gravacao.js";
import type { StatusDaOs } from "./os.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Conclui a OS (parte 3.9a): a assinatura é conferida no Storage antes da
 * transação; a OS, as etapas, os itens e as fotos, dentro dela. A OS vai
 * para Em revisão com a conclusão e, quando faltava, a etapa Fim. Eventos:
 * `os.step_recorded` (o Fim registrado aqui), `os.completed` e o aceite,
 * `os.signed` ou `os.completed_without_acceptance`. O nome e o documento do
 * responsável ficam só na OS.
 *
 * A OS de volta da entrega do WMS (`retorno_ao_armazem`, parte 4.5d) marca,
 * na mesma transação, o retorno a receber no pedido de saída: o caminhão
 * chegou ao armazém e o WMS confere e recebe o que voltou (`os.warehouse_return_due`).
 *
 * A conclusão do celular recusada com a assinatura conferida fica guardada na
 * OS para a coordenação (pergunta 66, domain/conclusao-recusada.ts), e a
 * recusa chega ao celular como antes.
 */
export async function completeServiceOrderFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  conferir: ConferirArquivo,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarConclusao(data);
  const assinatura = pedido.assinatura ? await conferir(caminhoDaAssinatura(pedido.numero, pedido.assinatura)) : null;
  try {
    return await concluir(db, caller, pedido, assinatura, agora);
  } catch (error) {
    if (caller.role === "campo" && assinatura && pedido.assinatura && error instanceof HttpsError && error.code === "failed-precondition") {
      const caminho = caminhoDaAssinatura(pedido.numero, pedido.assinatura);
      // Guardar não esconde a recusa: sem conseguir, o log registra e a recusa segue.
      await guardarConclusaoRecusada(db, caller, pedido, caminho, error.message, agora()).catch((erro: unknown) =>
        console.error("[completeServiceOrder] conclusão recusada não guardada", { numero: pedido.numero, erro }),
      );
    }
    throw error;
  }
}

function concluir(
  db: Firestore,
  caller: OperacaoProfile,
  pedido: ReturnType<typeof interpretarConclusao>,
  assinatura: Awaited<ReturnType<ConferirArquivo>>,
  agora: () => Date,
): Promise<ResultadoDoRegistro & { replayed?: true }> {
  return runIdempotent(
    db,
    { kind: "os_complete", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao, itens, data: bruto, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const retorno = retornoAoArmazem(bruto);
      const pedidoRef = retorno ? db.collection(ORDERS_COLLECTION).doc(retorno.order_id) : null;
      const pedidoSnap = pedidoRef ? await transaction.get(pedidoRef) : null;
      const { conclusao, etapas, fim, fotosDoFinal } = concluirOs(os, { etapas: execucao.etapas, itens, fotos: fotosLidas(bruto), assinatura }, pedido, contexto);
      const status: StatusDaOs = "em_revisao";
      const edicao = os.edicao + 1;
      transaction.update(ref, { conclusao, etapas, status, edicao, ...autoria(caller) });
      const base = { id: os.numero, demanda: os.demanda, instante: conclusao.instante, canal: conclusao.canal };
      const comum = { entity_id: os.numero, customer_code: os.customer_code, actor: ator(caller), occurred_at: conclusao.instante, operation_id: operationId };
      if (fim) {
        createOperacaoEvent(transaction, db, {
          ...comum,
          suffix: "os.step_recorded",
          type: "os.step_recorded",
          payload: { ...base, etapa: "fim", informado_por: fim.informado_por },
        });
      }
      createOperacaoEvent(transaction, db, {
        ...comum,
        type: "os.completed",
        payload: {
          ...base,
          informado_por: conclusao.informado_por,
          aceite: conclusao.aceite,
          itens_a_menos: conclusao.diferencas.length,
          fotos_do_final: fotosDoFinal,
        },
      });
      if (conclusao.aceite === "assinatura") {
        createOperacaoEvent(transaction, db, { ...comum, type: "os.signed", payload: base });
      } else {
        createOperacaoEvent(transaction, db, { ...comum, type: "os.completed_without_acceptance", payload: base });
      }
      const noPedido = pedidoRef && pedidoSnap?.exists ? retornoNoPedido(pedidoSnap.data() ?? {}, os, conclusao.instante) : null;
      if (pedidoRef && noPedido) {
        transaction.update(pedidoRef, { retorno: noPedido, updated_at: FieldValue.serverTimestamp() });
        createOperacaoEvent(transaction, db, { ...comum, type: "os.warehouse_return_due", payload: { id: os.numero, demanda: os.demanda, instante: conclusao.instante, pedido: pedidoRef.id } });
      }
      return { target_id: os.numero, result: { numero: os.numero, edicao, status } };
    },
  );
}
