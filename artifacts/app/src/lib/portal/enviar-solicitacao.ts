import { ref } from "firebase/storage";

import { compactarFoto, enviarComProgresso } from "../envio-de-fotos";
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
 *
 * A foto JPEG sobe compactada a 2000 px no lado maior e o envio conta os
 * bytes (carregamento v2, parte 11): `aoProgredir` recebe o anexo da vez e a
 * fração dele. O PDF, a PNG e a WebP sobem como vieram: o tipo confere com o
 * nome.
 */
export async function enviarSolicitacao(
  customerCode: string,
  form: FormularioDaSolicitacao,
  chave: string,
  aoProgredir?: (anexo: number, fracao: number) => void,
): Promise<{ solicitacao_id: string }> {
  if (form.anexos.length && !firebaseStorage) throw new Error("Firebase não configurado.");
  for (const [indice, anexo] of form.anexos.entries()) {
    const arquivo = await compactarFoto(anexo.arquivo, { manterTipo: true });
    await enviarComProgresso(ref(firebaseStorage!, caminhoDoAnexo(customerCode, anexo.nome)), arquivo, { contentType: arquivo.type }, (fracao) => aoProgredir?.(indice, fracao)).catch((error: unknown) => {
      // O mesmo anexo já subiu numa tentativa anterior: o storage.rules não deixa sobrescrever.
      if ((error as { code?: string })?.code !== "storage/unauthorized") throw error;
    });
  }
  return chamarOperacao<{ solicitacao_id: string }>("requestService", pedidoDaSolicitacao(form, chave));
}
