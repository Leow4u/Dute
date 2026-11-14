import { useRef, useState } from "react";
import type { DocumentData, DocumentReference, Firestore, Query } from "firebase/firestore";

import { useDocumento, useLeitura } from "../operacao/leitura";

/**
 * A leitura ao vivo do portal (as OS, as NFs, as solicitações, os avisos do
 * sino) com a nova tentativa (carregamento v2, parte 13f): o `onSnapshot` que
 * falha não volta sozinho, e a falha sem "Tentar de novo" deixava a pessoa sem
 * saída. `tentar` assina de novo; enquanto a nova assinatura não responde, a
 * falha fica na tela (`erro`, com `tentando`), para o aviso não sair com o
 * foco nele nem a seção voltar a "carregando" (como a `useLeituraComFalha`).
 * Sem a `chave` (o módulo fora do contrato, a conta sem cliente), nada é
 * assinado: `itens` fica `null`, sem erro.
 */
export type LeituraDoPortal<T> = {
  itens: T[] | null;
  erro: boolean;
  /** A nova tentativa que a pessoa pediu ainda não respondeu. */
  tentando: boolean;
  tentar: () => void;
};

export function useLeituraDoPortal<T>(
  chave: string | null,
  consulta: (db: Firestore) => Query<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): LeituraDoPortal<T> {
  const [tentativa, setTentativa] = useState(0);
  const leitura = useLeitura(chave ? `${chave}#${tentativa}` : null, consulta, mapear);
  // A chave que falhou por último: a nova tentativa dela fica na falha até responder.
  const falhou = useRef<string | null>(null);
  if (leitura.erro) falhou.current = chave;
  else if (leitura.itens) falhou.current = null;
  const tentando = chave !== null && tentativa > 0 && falhou.current === chave && !leitura.erro && leitura.itens === null;
  return {
    itens: leitura.itens,
    erro: leitura.erro || tentando,
    tentando,
    tentar: () => setTentativa((atual) => atual + 1),
  };
}

/** Um documento ao vivo do portal (o comprovante da OS), com a mesma nova tentativa. */
export type DocumentoDoPortal<T> = {
  /** `undefined` enquanto carrega; `null` quando não existe. */
  item: T | null | undefined;
  erro: boolean;
  tentando: boolean;
  tentar: () => void;
};

export function useDocumentoDoPortal<T>(
  chave: string | null,
  referencia: (db: Firestore) => DocumentReference<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): DocumentoDoPortal<T> {
  const [tentativa, setTentativa] = useState(0);
  const leitura = useDocumento(chave ? `${chave}#${tentativa}` : null, referencia, mapear);
  const falhou = useRef<string | null>(null);
  if (leitura.erro) falhou.current = chave;
  else if (leitura.item !== undefined) falhou.current = null;
  const tentando = chave !== null && tentativa > 0 && falhou.current === chave && !leitura.erro && leitura.item === undefined;
  return {
    item: leitura.item,
    erro: leitura.erro || tentando,
    tentando,
    tentar: () => setTentativa((atual) => atual + 1),
  };
}
