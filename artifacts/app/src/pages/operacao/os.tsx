import { useEffect, useState } from "react";
import { collection, doc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { useSearch } from "wouter";

import { firebaseStorage } from "@/lib/firebase";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { clienteDaLeitura, hojeIso, nomesPorCodigo } from "@/lib/operacao/fila";
import { demandaDoHoje } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { fichaDaBusca } from "@/lib/operacao/navegacao";

import { OsView, type EstadoDaFicha } from "./os-view";

/** Operação › OS (parte 3.7d): a OS da URL (?numero=), a demanda, o cliente e as fotos sobre OsView. */

/** A URL de cada foto pelo caminho no Storage (as regras liberam a leitura a quem coordena). */
function useUrlsDasFotos(caminhos: readonly string[]): Record<string, string> {
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

export default function PaginaOs() {
  const numero = fichaDaBusca(useSearch()) ?? "";
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const demandaNumero = os.item?.demanda ?? null;
  const demanda = useDocumento(demandaNumero ? `demands/${demandaNumero}` : null, (db) => doc(db, "demands", demandaNumero ?? "-"), demandaDoHoje);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const urls = useUrlsDasFotos((os.item?.fotos ?? []).map((foto) => foto.caminho));

  const estado: EstadoDaFicha = !numero || os.item === null ? "nao_encontrada" : os.erro ? "erro" : os.item === undefined ? "carregando" : "pronto";
  const ficha = os.item ?? null;
  return (
    <OsView
      estado={estado}
      numero={numero}
      ficha={ficha}
      cabecalho={{
        cliente: ficha ? nomesPorCodigo(clientes.itens ?? [])[ficha.customerCode] || ficha.customerCode : "",
        titulo: demanda.item?.titulo ?? null,
        tipo: demanda.item?.tipo ?? null,
      }}
      hoje={hojeIso()}
      urls={urls}
    />
  );
}
