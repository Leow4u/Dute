import { doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { useDocumento } from "@/lib/operacao/leitura";
import { pedidoDaBusca } from "@/lib/warehouse-ops/lista-de-separacao";
import { folhaDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import { hrefDaBancada } from "@/lib/warehouse-ops/separacao";
import { useVolumesDoPedido } from "@/lib/warehouse-ops/use-volumes-do-pedido";

import { PedidosRomaneioView, type EstadoDoRomaneio } from "./pedidos-romaneio-view";

/**
 * Pedidos › Romaneio (separação com caixas, parte 4c): o pedido da URL
 * (?pedido=), com os volumes lidos dos `packages` e o "Para quando" da
 * solicitação que o originou. Só leitura, e só do pedido já separado: antes
 * de concluir, os volumes ainda mudam. Imprimir é o do navegador (Imprimir →
 * Salvar como PDF), como a lista de separação.
 */
export default function PaginaPedidosRomaneio() {
  const pedidoId = pedidoDaBusca(useSearch());
  const { options: clientes } = useActiveCustomer();
  const leitura = useVolumesDoPedido(pedidoId);
  const pedido = leitura.pedido;
  const solicitacaoId = pedido?.solicitacaoId ?? null;
  const solicitacao = useDocumento(
    solicitacaoId ? `customer_requests/${solicitacaoId}:romaneio` : null,
    (db) => doc(db, "customer_requests", solicitacaoId ?? "-"),
    (_id, data) => ({ paraQuando: data.due_at as unknown }),
  );
  const esperandoSolicitacao = Boolean(solicitacaoId) && solicitacao.item === undefined && !solicitacao.erro;
  // "Tentar de novo" (na demora, na desistência e na falha): assina de novo o que ainda não chegou, os volumes ou o prazo.
  const tentar = () => Promise.all([leitura.tentar(), esperandoSolicitacao ? solicitacao.tentar() : undefined]);

  const estado: EstadoDoRomaneio =
    leitura.estado !== "pronto" ? leitura.estado : !pedido?.concluido ? "em_separacao" : esperandoSolicitacao ? "carregando" : "pronto";
  const folha =
    estado === "pronto" && pedido
      ? folhaDoRomaneio({
          numero: pedido.numero,
          cliente: clientes.find((cliente) => cliente.code === pedido.clienteCodigo)?.name || pedido.clienteCodigo,
          destino: pedido.destino,
          paraQuando: solicitacao.item?.paraQuando,
          lacre: pedido.lacre,
          separadoDe: pedido.separadoDe,
          separadoAte: pedido.separadoAte,
          por: pedido.por,
          volumes: leitura.volumes,
        })
      : null;
  return (
    <PedidosRomaneioView
      estado={estado}
      folha={folha}
      voltar={pedido && pedidoId ? { href: hrefDaBancada(pedidoId), rotulo: pedido.numero || "Pedidos" } : null}
      avisos={solicitacao.erro ? ["Não foi possível carregar o prazo do pedido."] : []}
      onImprimir={() => window.print()}
      onTentar={tentar}
    />
  );
}
