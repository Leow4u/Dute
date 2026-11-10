import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { doc } from "firebase/firestore";
import { useSearch } from "wouter";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { useDocumento } from "@/lib/operacao/leitura";
import { folhaDaLista, pedidoDaBusca } from "@/lib/warehouse-ops/lista-de-separacao";
import { fetchJson, type WarehouseOpsResponse, type WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { groupWarehouseOrders } from "@/lib/warehouse-ops/orders";
import { useLeituraDaLista } from "@/lib/warehouse-ops/use-lista-de-separacao";

import { PedidosListaView, type EstadoDaLista } from "./pedidos-lista-view";

const SEM_ITENS: WarehouseTaskItem[] = [];

/**
 * Pedidos › Lista de separação (separação com caixas, parte 1b): o pedido da
 * URL (?pedido=), lido da mesma leitura da fila de Pedidos; o destino e o
 * "Para quando" vêm da solicitação que o originou. A folha espera a ordem das
 * prateleiras e as caixas, para o papel não sair pela metade. Só leitura.
 * Imprimir é o do navegador (Imprimir → Salvar como PDF), como as Etiquetas
 * e a OS.
 */
export default function PaginaPedidosLista() {
  const chave = pedidoDaBusca(useSearch());
  const { user } = useAppUser();
  const { options: clientes } = useActiveCustomer();
  // A mesma chave da fila de Pedidos: quem veio dela já tem o pedido lido.
  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchOnWindowFocus: false,
  });
  const pedido = useMemo(() => (chave ? groupWarehouseOrders(ops.data).find((order) => order.key === chave) : undefined), [chave, ops.data]);
  const tarefa = pedido?.pick ?? pedido?.pack ?? pedido?.ship;
  const itens = tarefa?.items ?? SEM_ITENS;
  const codigoDoCliente = tarefa?.customer_code ?? null;
  // A caixa só entra na folha do pedido que ainda está para separar: depois, o item já saiu dela.
  const lista = useLeituraDaLista(itens, pedido?.stage === "separar" ? codigoDoCliente : null);
  const solicitacaoId = pedido?.requestId ?? null;
  const solicitacao = useDocumento(
    solicitacaoId ? `customer_requests/${solicitacaoId}` : null,
    (db) => doc(db, "customer_requests", solicitacaoId ?? "-"),
    (_id, data) => ({ destino: typeof data.destination === "string" ? data.destination : "", paraQuando: data.due_at as unknown }),
  );
  const esperandoSolicitacao = Boolean(solicitacaoId) && solicitacao.item === undefined && !solicitacao.erro;
  // A hora da folha: a da abertura e, ao imprimir, a do clique.
  const [agora, setAgora] = useState(() => new Date());

  const estado: EstadoDaLista = !chave
    ? "nao_encontrado"
    : ops.isLoading
      ? "carregando"
      : ops.isError && !ops.data
        ? "erro"
        : !pedido
          ? "nao_encontrado"
          : lista.carregando || esperandoSolicitacao
            ? "carregando"
            : "pronto";
  const folha =
    estado === "pronto" && pedido
      ? folhaDaLista({
          numero: pedido.orderNumber,
          cliente: clientes.find((cliente) => cliente.code === codigoDoCliente)?.name || codigoDoCliente,
          destino: solicitacao.item?.destino,
          paraQuando: solicitacao.item?.paraQuando,
          por: user?.fullName,
          agora,
          grupos: lista.grupos,
        })
      : null;
  const avisos = [
    lista.semPosicoes ? "Não foi possível carregar a ordem das prateleiras." : null,
    lista.semCaixas ? "Não foi possível carregar as caixas." : null,
    solicitacao.erro ? "Não foi possível carregar o destino do pedido." : null,
  ].filter((aviso): aviso is string => Boolean(aviso));
  const imprimir = () => {
    // A hora entra na folha antes de o navegador abrir a impressão.
    flushSync(() => setAgora(new Date()));
    window.print();
  };
  return <PedidosListaView estado={estado} folha={folha} avisos={avisos} onImprimir={imprimir} />;
}
