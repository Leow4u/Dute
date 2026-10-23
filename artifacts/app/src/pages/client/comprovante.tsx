import { doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { useDocumento } from "@/lib/operacao/leitura";
import { osDaBusca } from "@/lib/operacao/navegacao";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";
import { comprovanteDaOs } from "@/lib/portal/comprovante";

import { ComprovanteView, type EstadoDoComprovante } from "./comprovante-view";

/**
 * Portal › Minhas OS › Comprovante (parte 4.3d): a OS da URL (`?os=`), lida
 * pelas regras do portal (a do próprio cliente, com a Operação no contrato),
 * e a assinatura e as fotos do final, que o Storage abre ao cliente da OS
 * concluída (parte 4.3c). Baixar é a impressão do navegador (Salvar como PDF).
 */
export function ClienteComprovante() {
  const numero = osDaBusca(useSearch()) ?? "";
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const comprovante = os.item ? comprovanteDaOs(os.item, os.item.clienteNome ?? "") : null;
  const caminhos = comprovante ? [comprovante.aceite.assinatura, ...comprovante.fotos].filter((caminho): caminho is string => Boolean(caminho)) : [];
  const urls = useUrlsDasFotos(caminhos);
  const estado: EstadoDoComprovante = !numero || os.item === null ? "sem_comprovante" : os.erro ? "erro" : os.item === undefined ? "carregando" : comprovante ? "pronto" : "sem_comprovante";
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <ComprovanteView estado={estado} numero={numero} comprovante={comprovante} urls={urls} onBaixar={() => window.print()} />
    </main>
  );
}
