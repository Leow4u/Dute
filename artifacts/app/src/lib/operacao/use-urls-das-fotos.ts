import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";

import { firebaseStorage } from "../firebase";

/** A URL de cada foto pelo caminho no Storage (as regras liberam a leitura a quem coordena). */
export function useUrlsDasFotos(caminhos: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
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
          return null;
        }
      }),
    ).then((pares) => {
      if (vivo) setUrls(Object.fromEntries(pares.filter((par): par is readonly [string, string] => par !== null)));
    });
    return () => {
      vivo = false;
    };
    // Os caminhos mudam só quando a lista de fotos muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return urls;
}
