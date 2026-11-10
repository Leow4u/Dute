import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import type { CaixaDaLinha } from "@workspace/dominio";

import { ConcluirSeparacaoDialog } from "@/features/warehouse-ops/concluir-separacao";
import { OutraCaixaDialog, type OutraCaixaDaLinha } from "@/features/warehouse-ops/outra-caixa";
import { SepararMenosDialog, type DiferencaDaLinha } from "@/features/warehouse-ops/separar-menos";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { textoDoParaQuando } from "@/lib/order-queue";
import { canDecideRequests, canOperateWarehouse } from "@/lib/permissions";
import { useItemPhotos } from "@/lib/use-item-photos";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import {
  caixasComOItem,
  caixasGravadas,
  caixasParaEnviar,
  entradaDasCaixas,
  linhaDeEntrada,
  sugestaoDaLinha,
  type CaixaDaPrateleira,
} from "@/lib/warehouse-ops/caixas-da-separacao";
import { hrefDaListaDeSeparacao, pedidoDaBusca, resumoDoGrupo, type LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import { fetchJson, type WarehouseOpsResponse, type WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { groupWarehouseOrders } from "@/lib/warehouse-ops/orders";
import { estadoDaLinha, idDaTarefaDeSeparacao, itemDaLinhaDeSeparacao, progressoDoPedido, separacaoComecou } from "@/lib/warehouse-ops/separacao";
import { useLeituraDaLista } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { concluirSeparacao, desfazerLinha, separarLinha, separarMenos } from "@/lib/wms/separacao";

import { PedidosSepararView, type EstadoDaBancada } from "./pedidos-separar-view";

const SEM_ITENS: WarehouseTaskItem[] = [];

type Acao =
  | { tipo: "separar" | "desfazer"; linha: LinhaDaLista }
  | { tipo: "menos"; linha: LinhaDaLista; diferenca: DiferencaDaLinha }
  | { tipo: "outra"; linha: LinhaDaLista; caixas: Array<{ box_code: string; qty: number }> };

/**
 * Pedidos › Separar (separação com caixas, partes 2, 3b e 5): a bancada do
 * pedido da URL (?pedido=). As linhas vêm ao vivo do servidor: o que outra
 * pessoa separa aparece sem recarregar, e quem volta no dia seguinte continua
 * de onde parou. Cada "Separar", "Desfazer" e "Separar menos" grava na hora
 * pela callable; "Concluir separação" fecha a separação e a embalagem, com o
 * lacre, numa chamada.
 *
 * As caixas (parte 3b) também vêm ao vivo: a linha por separar mostra de qual
 * caixa o sistema vai tirar, e a separada, de onde saiu. "Separar" deixa o
 * servidor baixar a caixa mais antiga; "Outra caixa" manda as que a pessoa
 * informou.
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

  // As caixas guardadas do cliente e o conteúdo de entrada das da abertura, ao vivo.
  const caixasAoVivo = useLeitura(
    codigoDoCliente ? `warehouse_boxes:${codigoDoCliente}:guardadas` : null,
    (db) => query(collection(db, "warehouse_boxes"), where("customer_code", "==", codigoDoCliente), where("status", "==", "stored")),
    (id, data) => warehouseBoxFromRecord({ id, ...data }),
  );
  const entradaAoVivo = useLeitura(
    codigoDoCliente ? `opening_inventory_lines:${codigoDoCliente}` : null,
    (db) => query(collection(db, "opening_inventory_lines"), where("customer_code", "==", codigoDoCliente)),
    linhaDeEntrada,
  );
  // De qual caixa cada linha sai: a sugestão, na linha por separar; o gravado, na separada.
  const { caixasDaLinha, candidatasDaLinha } = useMemo(() => {
    const daLinha = new Map<string, CaixaDaLinha[]>();
    const candidatas = new Map<string, CaixaDaPrateleira[]>();
    const guardadas = caixasAoVivo.itens;
    const entrada = guardadas && entradaAoVivo.itens ? entradaDasCaixas(guardadas, entradaAoVivo.itens) : null;
    for (const linha of lista.grupos.flatMap((grupo) => grupo.linhas)) {
      if (estadoDaLinha(linha.item) !== "pendente") {
        daLinha.set(linha.id, caixasGravadas(linha.item));
      } else if (guardadas && entrada) {
        const daPrateleira = caixasComOItem(linha.item, guardadas, entrada, codigoDoCliente);
        candidatas.set(linha.id, daPrateleira);
        daLinha.set(linha.id, sugestaoDaLinha(linha.item, daPrateleira).caixas);
      }
    }
    return { caixasDaLinha: daLinha, candidatasDaLinha: candidatas };
  }, [lista.grupos, caixasAoVivo.itens, entradaAoVivo.itens, codigoDoCliente]);
  // "Outra caixa" só faz sentido com mais de uma caixa na prateleira para escolher.
  const comOutraCaixa = useMemo(
    () => new Set([...candidatasDaLinha].filter(([, daPrateleira]) => daPrateleira.length > 1).map(([id]) => id)),
    [candidatasDaLinha],
  );

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
  const [outraCaixa, setOutraCaixa] = useState<OutraCaixaDaLinha | null>(null);
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
      // "Outra caixa" manda as caixas informadas; "Separar" deixa o servidor baixar a mais antiga.
      if (acao.tipo === "outra") return separarLinha({ ...entrada, boxes: acao.caixas });
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
      if (acao.tipo === "outra") setOutraCaixa(null);
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
    onError: (falha: Error) => {
      erro("Não foi possível concluir a separação")(falha);
      // Outra pessoa pode ter concluído por baixo: a fila lê de novo e a bancada mostra onde o pedido está.
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
    },
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
        caixasDaLinha={caixasDaLinha}
        comOutraCaixa={comOutraCaixa}
        fotoDe={(item) => fotoDoItem(item.sku_code, item.sku, item.client_item_code)}
        onSeparar={(linha) => gravar.mutate({ tipo: "separar", linha })}
        onDesfazer={(linha) => gravar.mutate({ tipo: "desfazer", linha })}
        onOutraCaixa={(linha) =>
          setOutraCaixa({
            id: linha.id,
            nome: linha.nome || linha.codigos,
            posicao: String(linha.item.location ?? ""),
            quantidade: linha.quantidade,
            caixas: candidatasDaLinha.get(linha.id) ?? [],
            // Começa na sugestão do sistema: a pessoa só corrige.
            informadas: Object.fromEntries((caixasDaLinha.get(linha.id) ?? []).map((caixa) => [caixa.box_code, caixa.qty])),
          })
        }
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
      <OutraCaixaDialog
        linha={outraCaixa}
        confirmando={gravar.isPending}
        onMudar={setOutraCaixa}
        onFechar={() => setOutraCaixa(null)}
        onConfirmar={() => {
          const linha = outraCaixa ? lista.grupos.flatMap((grupo) => grupo.linhas).find((candidata) => candidata.id === outraCaixa.id) : undefined;
          if (linha && outraCaixa) gravar.mutate({ tipo: "outra", linha, caixas: caixasParaEnviar(outraCaixa.informadas) });
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
