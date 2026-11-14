import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";

import { firebaseStorage } from "../firebase";

/**
 * As URLs das fotos com o estado da leitura (carregamento v2, parte 13f): as
 * que ainda chegam (`lendo`), as que não vieram (`falharam`, pelo caminho) e a
 * nova tentativa (`tentar`), que lê a lista de novo. A foto que falha não some
 * calada: quem mostra diz qual faltou.
 */
export type UrlsDasFotos = {
  urls: Record<string, string>;
  /** A primeira leitura desta lista de fotos ainda não respondeu. */
  lendo: boolean;
  /** Os caminhos que não vieram; ficam durante a nova tentativa, até ela responder. */
  falharam: string[];
  /** A nova tentativa pedida ainda não respondeu. */
  tentando: boolean;
  tentar: () => void;
};

/** A URL de cada foto pelo caminho no Storage, com o estado da leitura. */
export function useUrlsDasFotosComEstado(caminhos: readonly string[]): UrlsDasFotos {
  const [estado, setEstado] = useState<{ chave: string; tentativa: number; urls: Record<string, string>; falharam: string[] }>({
    chave: "",
    tentativa: 0,
    urls: {},
    falharam: [],
  });
  const [tentativa, setTentativa] = useState(0);
  const chave = caminhos.join("|");
  useEffect(() => {
    if (!firebaseStorage || !caminhos.length) return undefined;
    let vivo = true;
    const storage = firebaseStorage;
    void Promise.all(
      caminhos.map(async (caminho) => {
        try {
          return [caminho, await getDownloadURL(ref(storage, caminho))] as const;
        } catch {
          return [caminho, null] as const;
        }
      }),
    ).then((pares) => {
      if (!vivo) return;
      setEstado({
        chave,
        tentativa,
        urls: Object.fromEntries(pares.filter((par): par is readonly [string, string] => par[1] !== null)),
        falharam: pares.filter(([, url]) => url === null).map(([caminho]) => caminho),
      });
    });
    return () => {
      vivo = false;
    };
    // Os caminhos mudam só quando a lista de fotos muda; a nova tentativa lê de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, tentativa]);
  const lidas = estado.chave === chave;
  return {
    // Na nova tentativa, as que já tinham vindo continuam na tela.
    urls: estado.urls,
    lendo: Boolean(firebaseStorage) && caminhos.length > 0 && !lidas,
    falharam: lidas ? estado.falharam : [],
    tentando: lidas && estado.tentativa !== tentativa,
    tentar: () => setTentativa((atual) => atual + 1),
  };
}

/** A URL de cada foto pelo caminho no Storage (as regras liberam a leitura a quem coordena). */
export function useUrlsDasFotos(caminhos: readonly string[]): Record<string, string> {
  return useUrlsDasFotosComEstado(caminhos).urls;
}
