import { useEffect, useId, useMemo, useState } from "react";
import { type Order, useListOrders, useUpdateOrder, getListOrdersQueryKey } from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Esqueleto } from "@/components/ui/esqueleto";
import { FalhaNaLeitura } from "@/components/ui/erro-na-leitura";
import { LinhaDeEstado } from "@/components/ui/linha-de-estado";
import { ConteudoEmTroca, useListaComFiltro, useListaEmTroca } from "@/lib/carregando/use-lista-em-troca";
import { useContagemLembrada } from "@/lib/carregando/contagem-lembrada";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Boxes, CheckCircle2, ClipboardList, PackageCheck, Truck } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  formatStockNumber,
  StockFilterChip,
  StockMetricCard,
  StockMetricsGrid,
  StockPageShell,
  StockTableCard,
  StockTablePagination,
  StockToolbar,
} from "@/components/stock/stock-workbench";

export default function Orders() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  // O status, a busca e a página leem no servidor: a lista anterior fica, a 50% e inert, até a nova chegar
  // (carregamento v2, momento 7, caso 4); a releitura que falha não a apaga, e a troca que falha mostra o aviso.
  const leitura = useListOrders(
    { num_pedido: debouncedSearch || undefined, status: statusFilter || undefined, limit, offset: page * limit },
    { query: { queryKey: getListOrdersQueryKey({ num_pedido: debouncedSearch || undefined, status: statusFilter || undefined, limit, offset: page * limit }), placeholderData: keepPreviousData } }
  );
  const { data, isLoading } = leitura;
  const lista = useListaComFiltro(leitura);
  const troca = useListaEmTroca(lista.trocando);
  const idDaLinha = useId();

  const orders = data?.items ?? [];
  // Antes da primeira leitura, o bloco no lugar de cada número; com ela falhando, "—": nunca zero antes de ler, e a
  // leitura não se confunde com a falha (carregamento v2, parte 13c; momento 2 e o diagnóstico, necessidade 3).
  const lido = data !== undefined && !lista.falhou;
  const numeroLido = (valor: number) =>
    lido ? formatStockNumber(valor) : lista.falhou ? "—" : <Esqueleto forma="contagem" />;
  // As linhas-fantasma entram aos 300 ms, quantas a última leitura deixou (entre 1 e 5; sem ela, 2), com o brilho.
  const fantasmas = useEspera(isLoading);
  const contagem = useContagemLembrada("pedidos-legado", "todos", data ? { linhas: orders.length } : null);
  const stats = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        const requested = Number(order.qtd_solic ?? 0);
        const separated = Number(order.qtd_sep ?? 0);
        acc.items += requested;
        acc.separated += separated;
        if (order.status === "PENDENTE") acc.pending += 1;
        if (order.status === "SEPARACAO") acc.picking += 1;
        if (order.status === "ENTREGUE" || order.status === "FATURADO") acc.done += 1;
        return acc;
      },
      { items: 0, separated: 0, pending: 0, picking: 0, done: 0 },
    );
  }, [orders]);

  const setStatus = (status: string) => {
    setStatusFilter(status === "all" ? "" : status);
    setPage(0);
  };

  return (
    <StockPageShell
      eyebrow="Estoque"
      title="Pedidos"
      icon={<Truck className="h-6 w-6" />}
      // A casa do estado da lista, sob o título, sem empurrar a lista: "Carregando pedidos…" na primeira leitura, com as
      // linhas-fantasma no lugar da tabela (carregamento v2, parte 13c).
      estado={<LinhaDeEstado id={idDaLinha} leitura={leitura} objeto="pedidos" />}
    >
      <StockMetricsGrid>
        <StockMetricCard
          label="Pedidos / linhas"
          value={numeroLido(data?.total ?? 0)}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="blue"
        />
        <StockMetricCard
          label="Itens solicitados"
          value={numeroLido(stats.items)}
          icon={<Boxes className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Em aberto"
          value={numeroLido(stats.pending + stats.picking)}
          icon={<PackageCheck className="h-5 w-5" />}
          tone={stats.pending + stats.picking ? "amber" : "default"}
        />
        <StockMetricCard
          label="Concluídos"
          value={numeroLido(stats.done)}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </StockMetricsGrid>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por número do pedido"
      >
        <StockFilterChip active={!statusFilter} onClick={() => setStatus("all")}>
          Todos
        </StockFilterChip>
        <StockFilterChip active={statusFilter === "PENDENTE"} onClick={() => setStatus("PENDENTE")}>
          Pendente
        </StockFilterChip>
        <StockFilterChip active={statusFilter === "SEPARACAO"} onClick={() => setStatus("SEPARACAO")}>
          Separação
        </StockFilterChip>
        <StockFilterChip active={statusFilter === "ENTREGUE"} onClick={() => setStatus("ENTREGUE")}>
          Entregue
        </StockFilterChip>
        <StockFilterChip active={statusFilter === "CANCELADO"} onClick={() => setStatus("CANCELADO")}>
          Cancelado
        </StockFilterChip>
      </StockToolbar>

      <StockTableCard trocando={lista.trocando} pagina={page}>
          {lista.falhou ? (
            <FalhaNaLeitura leitura={leitura} erro={lista.erro} mensagem="Não consegui carregar os pedidos." className="rounded-none border-0" focoAoSair={idDaLinha} />
          ) : (
          <div className="overflow-x-auto" {...troca.props}>
            <ConteudoEmTroca trocando={lista.trocando}>
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border/80 bg-card">
                <tr>
                  <th className="px-5 py-4 font-medium">Nº Pedido</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Cliente / Canal</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium text-center">Progresso</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Atualizar Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border" {...(isLoading ? { "aria-busy": true, "aria-describedby": idDaLinha } : {})}>
                {isLoading ? (
                  // As linhas-fantasma da primeira leitura; quem diz é a linha de estado sob o título (momento 2).
                  Array.from({ length: contagem.linhas("linhas") }, (_, ordem) => {
                    // A mesma altura da linha real (o cliente em duas linhas, 36 px, e o seletor do status): nada pula na chegada.
                    const brilho = fantasmas.visivel && "carregando-com-brilho";
                    const celula = "flex h-9 items-center";
                    return (
                      <tr key={ordem} aria-hidden="true" data-fantasmas="" data-visivel={fantasmas.visivel ? "" : undefined}>
                        <td className="px-5 py-3"><span className={celula}><Esqueleto forma="texto" className={cn("w-16", brilho)} /></span></td>
                        <td className="px-4 py-3"><span className={celula}><Esqueleto forma="texto" className={cn("w-20", brilho)} /></span></td>
                        <td className="px-4 py-3">
                          <span className="flex h-9 flex-col justify-center gap-1.5">
                            <Esqueleto forma="texto" className={cn("w-28", brilho)} />
                            <Esqueleto forma="texto" className={cn("h-2.5 w-16", brilho)} />
                          </span>
                        </td>
                        <td className="px-4 py-3"><span className={celula}><Esqueleto forma="texto" className={cn("w-36", brilho)} /></span></td>
                        <td className="px-4 py-3"><span className={cn(celula, "justify-center")}><Esqueleto forma="texto" className={cn("w-24", brilho)} /></span></td>
                        <td className="px-4 py-3"><span className={cn(celula, "justify-center")}><Esqueleto forma="texto" className={cn("w-16", brilho)} /></span></td>
                        <td className="px-4 py-3"><span className={cn(celula, "justify-center")}><Esqueleto forma="botao" className={cn("h-8 w-28", brilho)} /></span></td>
                      </tr>
                    );
                  })
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum pedido encontrado.</td>
                  </tr>
                ) : (
                  orders.map((order: Order) => {
                    const progress = order.qtd_solic > 0 ? ((order.qtd_sep || 0) / order.qtd_solic) * 100 : 0;
                    return (
                      <tr key={order.id} className="hover:bg-muted/80 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-primary font-bold">#{order.num_pedido}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {order.data_solic ? new Date(order.data_solic).toLocaleDateString('pt-BR') : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{order.cod_cliente}</div>
                          <div className="text-xs text-muted-foreground">{order.canal || "Manual"}</div>
                        </td>
                        <td className="px-4 py-3 max-w-[200px] truncate" title={order.produto}>{order.produto}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 w-full max-w-[120px] mx-auto">
                            <div className="flex justify-between text-xs">
                              <span className="font-medium text-foreground">{order.qtd_sep || 0} / {order.qtd_solic}</span>
                              <span className="text-muted-foreground">{Math.round(progress)}%</span>
                            </div>
                            <Progress value={progress} className="h-1.5 bg-primary/10" />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="secondary" className={
                            order.status === 'ENTREGUE' || order.status === 'FATURADO' ? 'bg-success-soft text-success-soft-foreground' :
                            order.status === 'PENDENTE' ? 'bg-warning-soft text-warning-soft-foreground' :
                            order.status === 'CANCELADO' ? 'bg-destructive-soft text-destructive-soft-foreground' :
                            'bg-info-soft text-info-soft-foreground'
                          }>
                            {order.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <OrderStatusUpdater order={order} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
            </ConteudoEmTroca>
          </div>
          )}
          
          <StockTablePagination
            page={page}
            isLoading={isLoading}
            ocupada={lista.trocando}
            /* Sem a leitura, nem "Exibindo 0 de 0": a contagem só depois de ler (necessidade 3). */
            semContagem={lista.falhou || data === undefined}
            count={data?.items?.length || 0}
            total={data?.total || 0}
            limit={limit}
            label="pedidos"
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
      </StockTableCard>
    </StockPageShell>
  );
}

function OrderStatusUpdater({ order }: { order: any }) {
  const updateOrder = useUpdateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (newStatus: string) => {
    updateOrder.mutate(
      { id: order.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          // Patch cache directly to avoid refetch jumpiness
          queryClient.setQueryData(
            getListOrdersQueryKey(), 
            (old: any) => old // We'll just invalidate for simplicity, it's safer with pagination
          );
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: `Pedido ${order.num_pedido} atualizado para ${newStatus}` });
        },
        onError: () => {
          toast({ title: "Falha ao atualizar o status do pedido", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Select value={order.status} onValueChange={handleStatusChange}>
      <SelectTrigger className="w-[130px] h-8 text-xs bg-card mx-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="PENDENTE">Pendente</SelectItem>
        <SelectItem value="SEPARACAO">Separação</SelectItem>
        <SelectItem value="FATURADO">Faturado</SelectItem>
        <SelectItem value="ENTREGUE">Entregue</SelectItem>
        <SelectItem value="CANCELADO">Cancelado</SelectItem>
      </SelectContent>
    </Select>
  );
}
