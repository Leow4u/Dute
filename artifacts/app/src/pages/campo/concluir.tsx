import { useState } from "react";
import { doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { useFilaDoCampo } from "@/lib/campo/fila-do-campo";
import { osDoCampoDaBusca } from "@/lib/campo/navegacao";
import { registroDeFoto } from "@/lib/campo/os-no-campo";
import { escolherFotos } from "@/lib/operacao/enviar-foto";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { useDocumento } from "@/lib/operacao/leitura";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { CampoConcluirView, type EstadoDaConclusao } from "./concluir-view";

/**
 * Campo › Concluir OS (parte 3.9b): a OS da URL (?numero=) e a fila do campo.
 * As fotos do final vão pela fila com a etapa Fim, antes da conclusão.
 */
export default function PaginaCampoConcluir() {
  const numero = osDoCampoDaBusca(useSearch()) ?? "";
  const { user } = useAppUser();
  const fila = useFilaDoCampo();
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const urls = useUrlsDasFotos((os.item?.fotos ?? []).filter((foto) => foto.etapa === "fim").map((foto) => foto.caminho));
  const [erroDasFotos, setErroDasFotos] = useState<string | null>(null);

  const estado: EstadoDaConclusao = !numero || os.item === null ? "nao_encontrada" : os.erro ? "erro" : os.item === undefined ? "carregando" : "pronto";
  const ficha = os.item ?? null;

  return (
    <CampoConcluirView
      estado={estado}
      numero={numero}
      ficha={ficha}
      uid={user?.uid ?? null}
      pendentes={fila.pendentes}
      urls={urls}
      erroDasFotos={erroDasFotos}
      agora={() => new Date()}
      onConcluir={fila.enviar}
      onFotos={(arquivos, extra) => {
        if (!ficha || !arquivos.length) return;
        const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
        setErroDasFotos(escolha.problema);
        for (const foto of escolha.fotos) {
          fila.enviar(registroDeFoto(ficha, { arquivo: foto.arquivo, nome: foto.nome, contentType: foto.arquivo.type, instante: foto.instante }, extra));
        }
      }}
    />
  );
}
