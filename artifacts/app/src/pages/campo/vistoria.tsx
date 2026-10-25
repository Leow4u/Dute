import { useEffect, useState } from "react";

import type { NovoRegistro, RegistroNaFila } from "@/lib/campo/fila";
import { registroDeFoto } from "@/lib/campo/os-no-campo";
import { useRascunhoDaVistoria } from "@/lib/campo/use-rascunho-da-vistoria";
import { comFotos, semFotosRecusadas } from "@/lib/campo/vistoria";
import type { ItemDoCatalogo } from "@/lib/operacao/demanda-direta";
import { escolherFotos } from "@/lib/operacao/enviar-foto";
import type { FichaDaOs } from "@/lib/operacao/ficha-da-os";

import { CampoVistoriaView } from "./vistoria-view";

function idLocal(prefixo: string): string {
  return `${prefixo}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * A OS de vistoria no celular (parte 3.11b): o rascunho guardado no aparelho
 * e as fotos de cada ambiente pela fila do campo, com o nome do ambiente na
 * legenda. A página monta uma por OS (`key` com o número). A foto que o
 * servidor recusou sai do rascunho: a falha no topo diz por quê.
 */
export function VistoriaNoCampo({
  ficha,
  uid,
  pendentes,
  fotosRecusadas = [],
  urls,
  catalogo,
  enviar,
}: {
  ficha: FichaDaOs;
  uid: string | null;
  pendentes: readonly RegistroNaFila[];
  fotosRecusadas?: readonly string[];
  urls: Readonly<Record<string, string>>;
  catalogo: readonly ItemDoCatalogo[];
  enviar: (novo: NovoRegistro) => void;
}) {
  const [rascunho, mudar] = useRascunhoDaVistoria(ficha.numero, ficha.status === "revisada");
  const [erroDasFotos, setErroDasFotos] = useState<string | null>(null);
  const recusadas = fotosRecusadas.join(",");
  useEffect(() => {
    if (recusadas) mudar((atual) => semFotosRecusadas(atual, new Set(recusadas.split(","))));
  }, [recusadas, mudar]);
  return (
    <CampoVistoriaView
      ficha={ficha}
      uid={uid}
      pendentes={pendentes}
      urls={urls}
      catalogo={catalogo}
      rascunho={rascunho}
      onMudar={mudar}
      erroDasFotos={erroDasFotos}
      agora={() => new Date()}
      novoId={() => idLocal("amb")}
      onRegistrar={enviar}
      onFotos={(arquivos, ambiente) => {
        if (!arquivos.length) return;
        const escolha = escolherFotos(arquivos, ficha.janela?.data ?? null);
        setErroDasFotos(escolha.problema);
        for (const foto of escolha.fotos) {
          enviar(registroDeFoto(ficha, { arquivo: foto.arquivo, nome: foto.nome, contentType: foto.arquivo.type, instante: foto.instante }, { legenda: ambiente.nome }));
        }
        mudar((atual) => comFotos(atual, ambiente.id, escolha.fotos.map((foto) => foto.nome.replace(/\.[a-z]+$/, ""))));
      }}
    />
  );
}
