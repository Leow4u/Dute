import { useEffect, useState } from "react";
import { onSnapshot, type DocumentData, type DocumentReference, type Firestore, type Query } from "firebase/firestore";

import { firestore } from "../firebase";

/**
 * Coleção ao vivo nas telas do cadastro. As regras abrem a leitura a owner,
 * admin e interno; a escrita é só das callables.
 */

export type Leitura<T> = { itens: T[] | null; erro: boolean };

export function useLeitura<T>(
  chave: string | null,
  consulta: (db: Firestore) => Query<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): Leitura<T> {
  const [estado, setEstado] = useState<Leitura<T> & { chave: string | null }>({ chave: null, itens: null, erro: false });
  useEffect(() => {
    if (!chave) return undefined;
    if (!firestore) {
      setEstado({ chave, itens: null, erro: true });
      return undefined;
    }
    return onSnapshot(
      consulta(firestore),
      (snapshot) =>
        setEstado({
          chave,
          itens: snapshot.docs.map((row) => mapear(row.id, row.data())).filter((item): item is T => item !== null),
          erro: false,
        }),
      () => setEstado({ chave, itens: null, erro: true }),
    );
    // A consulta e o mapeamento dependem só da chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return estado.chave === chave ? estado : { itens: null, erro: false };
}

/** Um documento ao vivo: undefined enquanto carrega, null quando não existe (ou o mapeamento recusa). */
export type LeituraDeDocumento<T> = { item: T | null | undefined; erro: boolean };

export function useDocumento<T>(
  chave: string | null,
  referencia: (db: Firestore) => DocumentReference<DocumentData>,
  mapear: (id: string, data: DocumentData) => T | null,
): LeituraDeDocumento<T> {
  const [estado, setEstado] = useState<LeituraDeDocumento<T> & { chave: string | null }>({ chave: null, item: undefined, erro: false });
  useEffect(() => {
    if (!chave) return undefined;
    if (!firestore) {
      setEstado({ chave, item: undefined, erro: true });
      return undefined;
    }
    return onSnapshot(
      referencia(firestore),
      (snapshot) => setEstado({ chave, item: snapshot.exists() ? mapear(snapshot.id, snapshot.data()) : null, erro: false }),
      () => setEstado({ chave, item: undefined, erro: true }),
    );
    // A referência e o mapeamento dependem só da chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return estado.chave === chave ? estado : { item: undefined, erro: false };
}
