import { ref, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../firebase";
import { chamarOperacao } from "../operacao/api";
import { caminhoDoAnexo, pedidoDaSolicitacao, type FormularioDaSolicitacao } from "./solicitacao";

/**
 * Envia a solicitação de OS (parte 4.4b): sobe cada anexo ao Storage no
 * caminho do cliente (o storage.rules libera só o cliente com a Operação no
 * contrato) e chama `requestService`, que confere os arquivos antes de
 * gravar. O nome do anexo e a chave saem na escolha e na abertura do
 * formulário, para a mesma tentativa repetir os mesmos arquivos e a mesma
 * solicitação.
 */
export async function enviarSolicitacao(customerCode: string, form: FormularioDaSolicitacao, chave: string): Promise<{ solicitacao_id: string }> {
  if (form.anexos.length && !firebaseStorage) throw new Error("Firebase não configurado.");
  for (const anexo of form.anexos) {
    await uploadBytes(ref(firebaseStorage!, caminhoDoAnexo(customerCode, anexo.nome)), anexo.arquivo, { contentType: anexo.arquivo.type }).catch((error: unknown) => {
      // O mesmo anexo já subiu numa tentativa anterior: o storage.rules não deixa sobrescrever.
      if ((error as { code?: string })?.code !== "storage/unauthorized") throw error;
    });
  }
  return chamarOperacao<{ solicitacao_id: string }>("requestService", pedidoDaSolicitacao(form, chave));
}
