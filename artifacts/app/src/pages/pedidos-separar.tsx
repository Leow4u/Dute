import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { ConcluirSeparacaoDialog } from "@/features/warehouse-ops/concluir-separacao";
import { SepararMenosDialog, type DiferencaDaLinha } from "@/features/warehouse-ops/separar-menos";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { textoDoParaQuando } from "@/lib/order-queue";
import { canDecideRequests, canOperateWarehouse } from "@/lib/permissions";
import { useItemPhotos } from "@/lib/use-item-photos";
import { hrefDaListaDeSeparacao, pedidoDaBusca, resumoDoGrupo, type LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import { fetchJson, type WarehouseOpsResponse, type WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { groupWarehouseOrders } from "@/lib/warehouse-ops/orders";
import { idDaTarefaDeSeparacao, itemDaLinhaDeSeparacao, progressoDoPedido, separacaoComecou } from "@/lib/warehouse-ops/separacao";
import { useLeituraDaLista } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { concluirSeparacao, desfazerLinha, separarLinha, separarMenos } from "@/lib/wms/separacao";

import { PedidosSepararView, type EstadoDaBancada } from "./pedidos-separar-view";

const SEM_ITENS: WarehouseTaskItem[] = [];

type Acao =
  | { tipo: "separar" | "desfazer"; linha: LinhaDaLista }
  | { tipo: "menos"; linha: LinhaDaLista; diferenca: DiferencaDaLinha };

/**
 * Pedidos › Separar (separação com caixas, partes 2 e 5): a bancada do pedido
 * da URL (?pedido=). As linhas vêm ao vivo do servidor: o que outra pessoa
 * separa aparece sem recarregar, e quem volta no dia seguinte continua de
 * onde parou. Cada "Separar", "Desfazer" e "Separar menos" grava na hora pela
 * callable; "Concluir separação" fecha a separação e a embalagem, com o
 * lacre, numa chamada.
 */
export default function PaginaPedidosSeparar() {
  const chave = pedidoDaBusca(useSearch());
  const [, navegar] = useLocation();
  const { user } = useAppUser();
  const papel = user?.publicMetadata.role;
  const operador = canOperateWarehouse(papel);
  const coordenacao = canDecideRequests(papel);
  const { options: clientes } = useActiveCustomer();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fotoDoItem = useItemPhotos();

  // A mesma chave da fila de Pedidos: quem veio dela já tem o pedido lido.
  const ops = useQuery({
    queryKey: ["warehouse-ops"],
    queryFn: () => fetchJson<WarehouseOpsResponse>("/api/warehouse/ops"),
    refetchOnWindowFocus: false,
  });
  const pedido = useMemo(() => (chave ? groupWarehouseOrders(ops.data).find((order) => order.key === chave) : undefined), [chave, ops.data]);
  const tarefa = pedido?.pick;
  const pickTaskId = idDaTarefaDeSeparacao(tarefa);
  const codigoDoCliente = tarefa?.customer_code ?? null;

  // As linhas e a tarefa ao vivo; enquanto não chegam, vale o que a fila leu.
  const linhasAoVivo = useLeitura(
    pickTaskId ? `pick_lines:${pickTaskId}` : null,
    (db) => query(collection(db, "pick_lines"), where("pick_task_id", "==", pickTaskId)),
    itemDaLinhaDeSeparacao,
  );
  const tarefaAoVivo = useDocumento(
    pickTaskId ? `pick_tasks/${pickTaskId}` : null,
    (db) => doc(db, "pick_tasks", pickTaskId ?? "-"),
    (_id, data) => ({ status: String(data.status ?? ""), separation_started_at: data.separation_started_at ? String(data.separation_started_at) : null }),
  );
  const itens = linhasAoVivo.itens ?? tarefa?.items ?? SEM_ITENS;
  const situacao = tarefaAoVivo.item ?? (tarefa ? { status: String(tarefa.status ?? ""), separation_started_at: tarefa.separation_started_at ?? null } : undefined);
  const lista = useLeituraDaLista(itens, codigoDoCliente);
  const progresso = useMemo(() => progressoDoPedido(itens), [itens]);

  const solicitacaoId = pedido?.requestId ?? null;
  const solicitacao = useDocumento(
    solicitacaoId ? `customer_requests/${solicitacaoId}:bancada` : null,
    (db) => doc(db, "customer_requests", solicitacaoId ?? "-"),
    (_id, data) => ({ paraQuando: data.due_at as unknown }),
  );
  const paraQuando = solicitacao.item ? textoDoParaQuando(solicitacao.item.paraQuando) : "";
  const resumo = [
    clientes.find((cliente) => cliente.code === codigoDoCliente)?.name || codigoDoCliente,
    resumoDoGrupo({ itens: progresso.itens, unidades: progresso.unidades }),
    paraQuando ? `Para quando ${paraQuando}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const [ocupadas, setOcupadas] = useState<ReadonlySet<string>>(new Set());
  const [diferenca, setDiferenca] = useState<DiferencaDaLinha | null>(null);
  const [lacre, setLacre] = useState<string | null>(null);
  // A chave da conclusão vale enquanto o diálogo está aberto: repetir continua de onde parou.
  const chaveDaConclusao = useRef<string | null>(null);

  const erro = (titulo: string) => (falha: Error) => toast({ title: titulo, description: falha.message, variant: "destructive" });

  const gravar = useMutation({
    mutationFn: async (acao: Acao) => {
      if (!pickTaskId) throw new Error("Pedido sem separação criada.");
      const entrada = { pick_task_id: pickTaskId, pick_line_id: acao.linha.id, idempotency_key: crypto.randomUUID() };
      if (acao.tipo === "desfazer") return desfazerLinha(entrada);
      if (acao.tipo === "menos") {
        return separarMenos({ ...entrada, separated_qty: acao.diferenca.separado, shortage_reason: acao.diferenca.motivo, shortage_detail: acao.diferenca.detalhe });
      }
      return separarLinha(entrada);
    },
    onMutate: (acao) => setOcupadas((atuais) => new Set(atuais).add(acao.linha.id)),
    onSettled: (_resultado, _falha, acao) =>
      setOcupadas((atuais) => {
        const proximas = new Set(atuais);
        proximas.delete(acao.linha.id);
        return proximas;
      }),
    onSuccess: (_resultado, acao) => {
      if (acao.tipo === "menos") setDiferenca(null);
    },
    onError: erro("Não foi possível gravar a linha"),
  });

  const concluir = useMutation({
    mutationFn: async () => {
      if (!pickTaskId) throw new Error("Pedido sem separação criada.");
      chaveDaConclusao.current ??= crypto.randomUUID();
      return concluirSeparacao({ pick_task_id: pickTaskId, seal_code: (lacre ?? "").trim(), idempotency_key: chaveDaConclusao.current });
    },
    onSuccess: async () => {
      toast({ title: "Separado. O pedido está pronto para entrega." });
      setLacre(null);
      chaveDaConclusao.current = null;
      await queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      navegar("/pedidos");
    },
    onError: erro("Não foi possível concluir a separação"),
  });

  const estado: EstadoDaBancada = !chave
    ? "nao_encontrado"
    : ops.isLoading
      ? "carregando"
      : ops.isError && !ops.data
        ? "erro"
        : !pedido || !pickTaskId
          ? "nao_encontrado"
          : pedido.stage !== "separar"
            ? "concluida"
            : "pronto";

  return (
    <>
      <PedidosSepararView
        estado={estado}
        numero={pedido?.orderNumber ?? ""}
        resumo={resumo}
        comecouEm={situacao?.separation_started_at}
        comecou={separacaoComecou(situacao, itens)}
        progresso={progresso}
        grupos={lista.grupos}
        listaHref={pedido ? hrefDaListaDeSeparacao(pedido.key) : null}
        operador={operador}
        coordenacao={coordenacao}
        fechada={situacao?.status === "completed"}
        ocupadas={ocupadas}
        fotoDe={(item) => fotoDoItem(item.sku_code, item.sku, item.client_item_code)}
        onSeparar={(linha) => gravar.mutate({ tipo: "separar", linha })}
        onDesfazer={(linha) => gravar.mutate({ tipo: "desfazer", linha })}
        onSepararMenos={(linha) =>
          setDiferenca({ id: linha.id, nome: linha.nome || linha.codigos, posicao: String(linha.item.location ?? ""), pedido: linha.quantidade, separado: Math.max(0, linha.quantidade - 1), motivo: "", detalhe: "" })
        }
        onConcluir={() => {
          chaveDaConclusao.current = null;
          setLacre("");
        }}
      />
      <SepararMenosDialog
        diferenca={diferenca}
        registrando={gravar.isPending}
        onMudar={setDiferenca}
        onFechar={() => setDiferenca(null)}
        onRegistrar={() => {
          const linha = diferenca ? lista.grupos.flatMap((grupo) => grupo.linhas).find((candidata) => candidata.id === diferenca.id) : undefined;
          if (linha && diferenca) gravar.mutate({ tipo: "menos", linha, diferenca });
        }}
      />
      <ConcluirSeparacaoDialog
        aberto={lacre !== null}
        numero={pedido?.orderNumber ?? ""}
        resumo={resumo}
        lacre={lacre ?? ""}
        confirmando={concluir.isPending}
        onLacre={setLacre}
        onFechar={() => setLacre(null)}
        onConfirmar={() => concluir.mutate()}
      />
    </>
  );
}
