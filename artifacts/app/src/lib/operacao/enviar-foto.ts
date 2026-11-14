import { ref } from "firebase/storage";

import { compactarFoto, enviarComProgresso } from "../envio-de-fotos";
import { firebaseStorage } from "../firebase";
import { instanteDaFoto, nomeDaFoto, problemaDaFoto } from "./andamento";
import { chamarOperacao } from "./api";

/**
 * Sobe a foto ao Storage no caminho da OS e a anexa pela callable
 * (parte 3.7c): o storage.rules libera o envio, e attachPhoto confere o
 * arquivo antes de gravar. O nome e o instante saem na escolha do arquivo,
 * para a mesma tentativa repetir o mesmo arquivo e a mesma chave.
 *
 * A foto JPEG do celular sobe compactada a 2000 px no lado maior, e o envio
 * conta os bytes (carregamento v2, parte 11). A PNG e a WebP sobem como
 * vieram: o nome já leva a extensão, e o tipo precisa conferir com ele.
 */

export type FotoEscolhida = { arquivo: File; nome: string; instante: string };

/** As fotos escolhidas com nome e instante, ou o problema da primeira que não vale. */
export function escolherFotos(arquivos: readonly File[], diaDaOs: string | null, agora = new Date()): { fotos: FotoEscolhida[]; problema: string | null } {
  const fotos: FotoEscolhida[] = [];
  for (const arquivo of arquivos) {
    const problema = problemaDaFoto(arquivo);
    const nome = nomeDaFoto(arquivo.type);
    if (problema || !nome) return { fotos, problema: `${arquivo.name}: ${problema ?? "Use foto JPG, PNG ou WebP."}` };
    fotos.push({ arquivo, nome, instante: instanteDaFoto(arquivo.lastModified, diaDaOs, agora) });
  }
  return { fotos, problema: null };
}

export async function enviarFoto(
  numero: string,
  foto: FotoEscolhida,
  contexto: { chave: string; ocorrencia?: string | null; etapa?: string | null; linha?: string | null },
  aoProgredir?: (fracao: number) => void,
  sinal?: AbortSignal,
): Promise<void> {
  if (!firebaseStorage) throw new Error("Firebase não configurado.");
  const arquivo = await compactarFoto(foto.arquivo, { manterTipo: true });
  await enviarComProgresso(ref(firebaseStorage, `os/${numero}/fotos/${foto.nome}`), arquivo, { contentType: arquivo.type }, aoProgredir, sinal).catch((error: unknown) => {
    // A mesma foto já subiu numa tentativa anterior: o storage.rules não deixa sobrescrever.
    if ((error as { code?: string })?.code !== "storage/unauthorized") throw error;
  });
  await chamarOperacao("attachPhoto", {
    idempotency_key: contexto.chave,
    numero,
    arquivo: foto.nome,
    instante: foto.instante,
    ...(contexto.ocorrencia ? { ocorrencia: contexto.ocorrencia } : {}),
    ...(contexto.etapa ? { etapa: contexto.etapa } : {}),
    ...(contexto.linha ? { linha: contexto.linha } : {}),
  });
}

/**
 * Sobe a assinatura (no escritório, a foto da via assinada no papel) ao
 * Storage, em os/{numero}/assinatura (parte 3.9a); completeServiceOrder
 * confere o arquivo depois. Repetir a tentativa não sobrescreve.
 */
export async function enviarAssinatura(numero: string, assinatura: { arquivo: Blob; nome: string; contentType: string }): Promise<void> {
  if (!firebaseStorage) throw new Error("Firebase não configurado.");
  // A foto da via assinada, quando JPEG, sobe compactada; a assinatura no dedo (PNG) sobe como veio.
  const arquivo = assinatura.arquivo instanceof File ? await compactarFoto(assinatura.arquivo, { manterTipo: true }) : assinatura.arquivo;
  await enviarComProgresso(ref(firebaseStorage, `os/${numero}/assinatura/${assinatura.nome}`), arquivo, { contentType: assinatura.contentType }).catch((error: unknown) => {
    if ((error as { code?: string })?.code !== "storage/unauthorized") throw error;
  });
}
