import { doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { osDaBusca } from "@/lib/operacao/navegacao";
import { useUrlsDasFotosComEstado } from "@/lib/operacao/use-urls-das-fotos";
import { comprovanteDaOs } from "@/lib/portal/comprovante";
import { useDocumentoDoPortal } from "@/lib/portal/leitura-do-portal";

import { ComprovanteView, type EstadoDoComprovante } from "./comprovante-view";

/**
 * Portal › Minhas OS › Comprovante (parte 4.3d): a OS da URL (`?os=`), lida
 * pelas regras do portal (a do próprio cliente, com a Operação no contrato),
 * e a assinatura e as fotos do final, que o Storage abre ao cliente da OS
 * concluída (parte 4.3c). Baixar é a impressão do navegador (Salvar como PDF).
 * A leitura da OS e a das imagens têm a nova tentativa (parte 13f).
 */
export function ClienteComprovante() {
  const numero = osDaBusca(useSearch()) ?? "";
  const os = useDocumentoDoPortal(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const comprovante = os.item ? comprovanteDaOs(os.item, os.item.clienteNome ?? "") : null;
  const caminhos = comprovante ? [comprovante.aceite.assinatura, ...comprovante.fotos].filter((caminho): caminho is string => Boolean(caminho)) : [];
  const fotos = useUrlsDasFotosComEstado(caminhos);
  const estado: EstadoDoComprovante = !numero || os.item === null ? "sem_comprovante" : os.erro ? "erro" : os.item === undefined ? "carregando" : comprovante ? "pronto" : "sem_comprovante";
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <ComprovanteView
        estado={estado}
        numero={numero}
        comprovante={comprovante}
        urls={fotos.urls}
        onBaixar={() => window.print()}
        leitura={{ tentando: os.tentando, onTentar: os.tentar, falta: os.falta, lidaEm: os.lidaEm }}
        fotos={{ lendo: fotos.lendo, falharam: fotos.falharam, tentando: fotos.tentando, onTentar: fotos.tentar }}
      />
    </main>
  );
}
