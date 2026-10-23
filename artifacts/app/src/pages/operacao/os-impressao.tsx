import { collection, doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { ROTULO_DO_STATUS } from "@/components/operacao/partes";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { clienteDaLeitura, nomesPorCodigo } from "@/lib/operacao/fila";
import { demandaDoHoje } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { fichaDaBusca } from "@/lib/operacao/navegacao";
import { documentoDaOs } from "@/lib/operacao/os-documento";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { OsImpressaoView, type EstadoDaImpressao } from "./os-impressao-view";

/**
 * Operação › Imprimir OS (parte 3.9d): a OS da URL (?numero=), a demanda (o
 * pedido) e o cliente; concluída, a imagem da assinatura. Imprimir é o do
 * navegador (Imprimir → Salvar como PDF), como o orçamento do Comercial.
 */
export default function PaginaOsImpressao() {
  const numero = fichaDaBusca(useSearch()) ?? "";
  const os = useDocumento(numero ? `service_orders/${numero}` : null, (db) => doc(db, "service_orders", numero), fichaDaLeitura);
  const demandaNumero = os.item?.demanda ?? null;
  const demanda = useDocumento(demandaNumero ? `demands/${demandaNumero}` : null, (db) => doc(db, "demands", demandaNumero ?? "-"), demandaDoHoje);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const assinatura = os.item?.conclusao?.assinatura ?? null;
  const urls = useUrlsDasFotos(assinatura ? [assinatura] : []);

  const estado: EstadoDaImpressao = !numero || os.item === null ? "nao_encontrada" : os.erro ? "erro" : os.item === undefined ? "carregando" : "pronto";
  const ficha = os.item ?? null;
  const documento = ficha
    ? documentoDaOs(ficha, {
        cliente: nomesPorCodigo(clientes.itens ?? [])[ficha.customerCode] || "",
        titulo: demanda.item?.titulo ?? null,
        status: ROTULO_DO_STATUS[ficha.status],
        agora: new Date(),
      })
    : null;
  return <OsImpressaoView estado={estado} numero={numero} documento={documento} urlDaAssinatura={assinatura ? (urls[assinatura] ?? null) : null} onImprimir={() => window.print()} />;
}
