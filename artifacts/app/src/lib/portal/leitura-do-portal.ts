import type { DocumentData, DocumentReference, Firestore, Query } from "firebase/firestore";

import { useDocumento, useLeitura, type FaltaAoVivo } from "../operacao/leitura";

/**
 * A leitura ao vivo do portal (as OS, as NFs, as solicitações, os avisos do
 * sino) com a nova tentativa (carregamento v2, parte 13f): o `onSnapshot` que
 * falha não volta sozinho, e a falha sem "Tentar de novo" deixava a pessoa sem
 * saída. `tentar` assina de novo; enquanto a nova assinatura não responde, a
 * falha fica na tela (`erro`, com `tentando`), para o aviso não sair com o
 * foco nele nem a seção voltar a "carregando" (como a `useLeituraComFalha`).
 * Sem a `chave` (o módulo fora do contrato, a conta sem cliente), nada é
 * assinado: `itens` fica `null`, sem erro.
 *
 * A nova tentativa é a da `useLeitura` da Operação (parte 13g), que faz o
 * mesmo: o portal não conta outra por cima (antes da parte 13j, a assinatura
 * levava dois `#n`). A falta (`falta`, `lidaEm`) diz se é a conexão ou o
 * servidor (parte 13j).
 */
export type LeituraDoPortal<T> = {
  itens: T[] | null;
  erro: boolean;
  /** A nova tentativa que a pessoa pediu ainda não respondeu. */
  tentando: boolean;
  tentar: () => void;
} & FaltaAoVivo;

export function useLeituraDoPortal<T>(
  chave: string | null,
  consulta: (db: Firestore) => Query<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): LeituraDoPortal<T> {
  const leitura = useLeitura(chave, consulta, mapear);
  // O toque não espera a resposta: o "Tentando de novo…" é o `tentando`.
  return { ...leitura, tentar: () => void leitura.tentar() };
}

/** Um documento ao vivo do portal (o comprovante da OS), com a mesma nova tentativa. */
export type DocumentoDoPortal<T> = {
  /** `undefined` enquanto carrega; `null` quando não existe. */
  item: T | null | undefined;
  erro: boolean;
  tentando: boolean;
  tentar: () => void;
} & FaltaAoVivo;

export function useDocumentoDoPortal<T>(
  chave: string | null,
  referencia: (db: Firestore) => DocumentReference<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): DocumentoDoPortal<T> {
  const leitura = useDocumento(chave, referencia, mapear);
  return { ...leitura, tentar: () => void leitura.tentar() };
}
