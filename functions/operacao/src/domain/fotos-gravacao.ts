import type { Firestore } from "firebase-admin/firestore";

import { createOperacaoEvent } from "./events.js";
import { exigirQuemExecuta, lerParaRegistrar, type ResultadoDoRegistro } from "./execucao-gravacao.js";
import { caminhoDaFoto, fotosLidas, interpretarFoto, registrarFoto, type ArquivoNoStorage } from "./fotos.js";
import { runIdempotent } from "./operations.js";
import { ator, autoria } from "./os-gravacao.js";
import type { OperacaoProfile } from "./profile.js";

/**
 * Anexa à OS a foto que já subiu ao Storage (parte 3.7c). O arquivo é
 * conferido antes da transação (existe e é imagem); a OS, a ocorrência e o
 * item, dentro dela. O evento leva o id da foto, sem a legenda.
 */

/** Lê o tipo e o tamanho do arquivo no Storage, ou null quando ele não existe. */
export type ConferirArquivo = (caminho: string) => Promise<ArquivoNoStorage | null>;

export async function attachPhotoFor(
  db: Firestore,
  caller: OperacaoProfile,
  data: unknown,
  conferir: ConferirArquivo,
  agora: () => Date = () => new Date(),
): Promise<ResultadoDoRegistro & { foto: string; replayed?: true }> {
  exigirQuemExecuta(caller);
  const pedido = interpretarFoto(data);
  const arquivo = await conferir(caminhoDaFoto(pedido.numero, pedido.arquivo));
  return runIdempotent(
    db,
    { kind: "os_photo", scope: { numero: pedido.numero }, idempotency_key: pedido.idempotency_key, input: pedido, actor: ator(caller) },
    async (transaction, { operationId }) => {
      const { ref, os, execucao, itens, data: bruto, contexto } = await lerParaRegistrar(transaction, db, pedido.numero, caller, agora());
      const { fotos, registro } = registrarFoto(os, fotosLidas(bruto), pedido, contexto, {
        arquivo,
        ocorrencias: execucao.ocorrencias.map((ocorrencia) => ocorrencia.id),
        linhas: itens.map((item) => item.id),
      });
      const edicao = os.edicao + 1;
      transaction.update(ref, { fotos, edicao, ...autoria(caller) });
      createOperacaoEvent(transaction, db, {
        operation_id: operationId,
        type: "os.photo_attached",
        entity_id: os.numero,
        customer_code: os.customer_code,
        payload: {
          id: os.numero,
          demanda: os.demanda,
          foto: registro.id,
          etapa: registro.etapa,
          ocorrencia: registro.ocorrencia,
          linha: registro.linha,
          instante: registro.instante,
          canal: registro.canal,
        },
        actor: ator(caller),
        occurred_at: registro.instante,
      });
      return { target_id: os.numero, result: { numero: os.numero, edicao, status: os.status, foto: registro.id } };
    },
  );
}
