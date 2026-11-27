import { ref } from "firebase/storage";

import { compactarFoto, enviarComProgresso } from "../envio-de-fotos";
import { firebaseStorage } from "../firebase";
import { novaChave } from "../operacao/api";
import { anexarDocumento } from "../wms/eventos";
import { tipoDoArquivo } from "./anexos";
import { caminhoDoArquivoDaEdicao, nomeDoArquivo } from "./arquivos";

/**
 * O anexo do cliente na edição (parte 3, "Fotos e documentos"): sobe ao
 * Storage no caminho do portal (portal/<cliente>/eventos/<edição>/an_…, que o
 * storage.rules abre ao cliente com a armazenagem) e chama
 * attachEventDocument, que confere o arquivo no bucket antes de gravar. A
 * imagem sobe compactada, no tipo dela; o PDF e a planilha, como vieram. O
 * tipo do .xlsx que chega vazio sai da extensão.
 */
export async function enviarAnexoDoEvento(
  customerCode: string,
  editionId: string,
  arquivo: File,
  aoProgredir?: (fracao: number) => void,
): Promise<{ documento_id: string }> {
  if (!firebaseStorage) throw new Error("Firebase não configurado.");
  const tipo = tipoDoArquivo(arquivo);
  const nome = nomeDoArquivo("an", tipo);
  if (!nome) throw new Error("Use PDF, imagem ou planilha (.xlsx).");
  const pronto = await compactarFoto(arquivo, { manterTipo: true });
  await enviarComProgresso(ref(firebaseStorage, caminhoDoArquivoDaEdicao("anexo", customerCode, editionId, nome)), pronto, { contentType: tipo }, aoProgredir).catch(
    (erro: unknown) => {
      // O mesmo arquivo já subiu numa tentativa anterior: o storage.rules não deixa regravar.
      if ((erro as { code?: string } | null)?.code !== "storage/unauthorized") throw erro;
    },
  );
  const resposta = await anexarDocumento({
    edition_id: editionId,
    arquivo: nome,
    nome: arquivo.name.trim().slice(0, 120) || nome,
    idempotency_key: novaChave(),
  });
  return { documento_id: resposta.documento.id };
}
