import { useEffect, useState } from "react";
import { onSnapshot, type DocumentData, type Firestore, type Query } from "firebase/firestore";

import { firestore } from "../firebase";
import type { Carga } from "./clientes";

/**
 * Leitura ao vivo das telas do Comercial (Clientes, Contratos): a tela vê o
 * que a callable gravou sem recarregar. As regras do Firestore decidem quem
 * lê; a escrita é só pelas callables (lib/comercial/api.ts).
 */

export type Leitura<T> = { itens: T[] | null; erro: boolean };

/** Coleção (ou consulta) ao vivo. Sem chave, não consulta nada. */
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

/** A leitura como a tela mostra: erro e carregando nunca viram lista vazia. */
export function carga<T>(leitura: Leitura<T>): Carga<T> {
  return leitura.erro ? "erro" : (leitura.itens ?? "carregando");
}
