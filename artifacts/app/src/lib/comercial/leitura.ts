import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, type DocumentData, type Firestore, type Query } from "firebase/firestore";

import { useAppUser } from "../auth";
import { firestore } from "../firebase";
import type { Carga } from "./clientes";

/**
 * Leitura do Firestore nas telas do Comercial (Clientes, Contratos, fila e
 * montagem do orçamento): coleção (ou consulta) e documento ao vivo, para a
 * tela ver o que a callable gravou sem recarregar,
 * e o nome de quem fez cada passo. As regras abrem a leitura a owner, admin e
 * comercial; a escrita é só das callables (lib/comercial/api.ts).
 */

export type Leitura<T> = { itens: T[] | null; erro: boolean };

/** Coleção (ou consulta) ao vivo. Chave null: nada a ler ainda. */
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

export type LeituraDoDocumento = {
  /** undefined: carregando; null: não existe. */
  dados: DocumentData | null | undefined;
  erro: boolean;
};

/** Um documento ao vivo ("demands/10045"). Caminho null: nada a ler. */
export function useDocumento(caminho: string | null): LeituraDoDocumento {
  const [estado, setEstado] = useState<LeituraDoDocumento & { caminho: string | null }>({
    caminho: null,
    dados: undefined,
    erro: false,
  });
  useEffect(() => {
    if (!caminho) return undefined;
    if (!firestore) {
      setEstado({ caminho, dados: undefined, erro: true });
      return undefined;
    }
    return onSnapshot(
      doc(firestore, caminho),
      (snapshot) => setEstado({ caminho, dados: snapshot.exists() ? snapshot.data() : null, erro: false }),
      () => setEstado({ caminho, dados: undefined, erro: true }),
    );
  }, [caminho]);
  return estado.caminho === caminho ? estado : { dados: undefined, erro: false };
}

/**
 * Nome de quem fez cada passo: o próprio usuário, ou o perfil quando quem lê
 * pode (owner e admin leem `users`). O comercial não lê o perfil de outra
 * pessoa: o nome fica de fora (null).
 */
export function useNomes(uids: ReadonlyArray<string | null | undefined>): (uid: string | null) => string | null {
  const { user } = useAppUser();
  const [nomes, setNomes] = useState<Record<string, string | null>>({});
  const pedidos = useRef(new Set<string>());
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );
  const chave = Array.from(new Set(uids.filter((uid): uid is string => Boolean(uid))))
    .sort()
    .join(",");
  useEffect(() => {
    if (!chave || !firestore) return;
    const db = firestore;
    for (const uid of chave.split(",")) {
      // Cada pessoa é lida uma vez só; quem não lê `users` fica sem o nome.
      if (uid === user?.uid || pedidos.current.has(uid)) continue;
      pedidos.current.add(uid);
      const guardar = (nome: string | null) => {
        if (montado.current) setNomes((atual) => ({ ...atual, [uid]: nome }));
      };
      getDoc(doc(db, "users", uid))
        .then((snapshot) => {
          const nome = snapshot.get("nome");
          guardar(typeof nome === "string" && nome.trim() ? nome.trim() : null);
        })
        .catch(() => guardar(null));
    }
  }, [chave, user?.uid]);
  return useCallback(
    (uid: string | null) => {
      if (!uid) return null;
      if (uid === user?.uid) return user?.fullName || null;
      return nomes[uid] ?? null;
    },
    [nomes, user?.uid, user?.fullName],
  );
}
