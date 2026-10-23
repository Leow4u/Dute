import { useState } from "react";
import { collection, doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { useFilaDoCampo } from "@/lib/campo/fila-do-campo";
import { osDoCampoDaBusca } from "@/lib/campo/navegacao";
import { registroDeFoto } from "@/lib/campo/os-no-campo";
import { itemDoCatalogo } from "@/lib/operacao/demanda-direta";
import { escolherFotos } from "@/lib/operacao/enviar-foto";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { CampoOsView, type EstadoDaOsNoCampo, type ExtraDaFoto } from "./os-view";
import { VistoriaNoCampo } from "./vistoria";

/**
 * Campo › OS em execução (parte 3.8b): a OS da URL (?numero=), o catálogo sem
 * preço (para incluir o item além do planejado) e a fila do campo. Cada
 * toque vira um registro na fila, com o instante do toque. A OS de vistoria
 * (parte 3.11b) abre a tela da vistoria.
 */
export default function PaginaCampoOs() {
  const numero = osDoCampoDaBusca(useSearch()) ?? "";
  const { user } = useAppUser();
  const fila = useFilaDoCampo();
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const catalogo = useLeitura("lpu_items:campo", (db) => collection(db, "lpu_items"), itemDoCatalogo);
  const urls = useUrlsDasFotos((os.item?.fotos ?? []).map((foto) => foto.caminho));
  const [erroDasFotos, setErroDasFotos] = useState<string | null>(null);

  const estado: EstadoDaOsNoCampo = !numero || os.item === null ? "nao_encontrada" : os.erro ? "erro" : os.item === undefined ? "carregando" : "pronto";
  const ficha = os.item ?? null;

  function fotos(arquivos: File[], extra: ExtraDaFoto) {
    if (!ficha || !arquivos.length) return;
    const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
    setErroDasFotos(escolha.problema);
    for (const foto of escolha.fotos) {
      fila.enviar(registroDeFoto(ficha, { arquivo: foto.arquivo, nome: foto.nome, contentType: foto.arquivo.type, instante: foto.instante }, extra));
    }
  }

  if (estado === "pronto" && ficha?.tipo === "vistoria") {
    return <VistoriaNoCampo key={ficha.numero} ficha={ficha} uid={user?.uid ?? null} pendentes={fila.pendentes} urls={urls} catalogo={catalogo.itens ?? []} enviar={fila.enviar} />;
  }

  return (
    <CampoOsView
      estado={estado}
      numero={numero}
      ficha={ficha}
      uid={user?.uid ?? null}
      pendentes={fila.pendentes}
      urls={urls}
      catalogo={catalogo.itens ?? []}
      erroDasFotos={erroDasFotos}
      agora={() => new Date()}
      onRegistrar={fila.enviar}
      onFotos={fotos}
    />
  );
}
