import { useEffect, useMemo, useState, type ReactNode } from "react";
import { type Sku, useListSkus, useCreateSku, useUpdateSku, useDeleteSku, getListSkusQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Boxes, ClipboardCheck, Edit, Layers, MapPin, PackageCheck, PackagePlus, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { useAppUser } from "@/lib/auth";
import { canWriteCatalog, humanApiError } from "@/lib/permissions";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
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

const skuSchema = z.object({
  cod_btg: z.string().min(1, "Obrigatório"),
  cod_cliente: z.string().min(1, "Obrigatório"),
  produto: z.string().min(1, "Obrigatório"),
  estoque_tipo: z.string().optional(),
  genero: z.string().optional(),
  categoria: z.string().optional(),
  cor: z.string().optional(),
  tamanho: z.string().optional(),
  estado: z.string().optional(),
  // Vazio = sem mínimo (o item nunca aparece como "Baixo").
  estoque_minimo: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .refine(
      (value) =>
        value === undefined || value === null || /^\d*$/.test(String(value).trim()),
      "Use um número inteiro, ou deixe vazio",
    ),
});

type SkuFormValues = z.infer<typeof skuSchema>;

export default function Skus() {
  // Espelho do requireCatalogWrite do servidor (mesma regra de Produtos).
  const { user } = useAppUser();
  const catalogWriter = canWriteCatalog(user?.publicMetadata.role);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("todos");
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useListSkus(
    { search: debouncedSearch || undefined, limit, offset: page * limit },
    { query: { queryKey: getListSkusQueryKey({ search: debouncedSearch || undefined, limit, offset: page * limit }) } }
  );

  const skus = data?.items ?? [];

  // Endereço mora no SALDO (stock_balances.location_id) — é lá que a
  // contagem de abertura grava rua/prateleira/caixa. Os campos rua/
  // prateleira/caixa do catálogo são herança da planilha e ficam como
  // fallback para dados importados.
  const balancesQuery = useQuery({
    queryKey: ["stock-balances", "skus-screen"],
    queryFn: async () => {
      const response = await fetch("/api/stock-balances?limit=1000");
      if (!response.ok) throw new Error("HTTP " + response.status);
      return (await response.json()) as {
        items?: Array<{
          sku_code?: string;
          client_item_code?: string;
          location_id?: string;
        }>;
      };
    },
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  const balancesBySku = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const balance of balancesQuery.data?.items ?? []) {
      const location = String(balance.location_id ?? "").trim();
      if (!location) continue;
      for (const key of [balance.sku_code, balance.client_item_code]) {
        const normalized = String(key ?? "").trim();
        if (!normalized) continue;
        const list = map.get(normalized) ?? [];
        if (!list.includes(location)) list.push(location);
        map.set(normalized, list);
      }
    }
    return map;
  }, [balancesQuery.data]);

  const locationsForSku = (sku: {
    cod_btg?: string | null;
    cod_cliente?: string | null;
    rua?: string | null;
    prateleira?: string | null;
    caixa?: string | null;
    endereco?: string | null;
  }) => {
    const fromBalances =
      balancesBySku.get(String(sku.cod_btg ?? "").trim()) ??
      balancesBySku.get(String(sku.cod_cliente ?? "").trim()) ??
      [];
    if (fromBalances.length) return fromBalances;
    const legacy =
      sku.endereco ||
      [
        sku.rua && "R" + sku.rua,
        sku.prateleira && "P" + sku.prateleira,
        sku.caixa && "C" + sku.caixa,
      ]
        .filter(Boolean)
        .join(" ");
    return legacy ? [legacy] : [];
  };
  const stats = useMemo(() => {
    return skus.reduce(
      (acc, sku) => {
        const current = Number(sku.estoque_atual ?? 0);
        const reserved = Number((sku as any).estoque_reservado ?? 0);
        const available = Number((sku as any).estoque_disponivel ?? Math.max(0, current - reserved));
        acc.physical += current;
        acc.available += available;
        acc.reserved += reserved;
        if (current <= 0) acc.zero += 1;
        if (current > 0 && current <= 10) acc.low += 1;
        if (!locationsForSku(sku).length) acc.noLocation += 1;
        return acc;
      },
      { physical: 0, available: 0, reserved: 0, low: 0, zero: 0, noLocation: 0 },
    );
  }, [skus, balancesBySku]);

  const filteredSkus = skus.filter((sku) => {
    const current = Number(sku.estoque_atual ?? 0);
    const hasLocation = locationsForSku(sku).length > 0;
    if (quickFilter === "baixo") return current > 0 && current <= 10;
    if (quickFilter === "zerado") return current <= 0;
    if (quickFilter === "sem-local") return !hasLocation;
    return true;
  });

  return (
    <StockPageShell
      eyebrow="Estoque"
      title="SKUs e saldos"
      icon={<Layers className="h-6 w-6" />}
      actions={catalogWriter ? <SkuModal /> : undefined}
    >
      {/* "SKUs carregados" era contagem técnica da página, não decisão de
          estoque — o total já aparece na paginação da tabela. */}
      <StockMetricsGrid>
        <StockMetricCard
          label="Saldo físico"
          value={formatStockNumber(stats.physical)}
          icon={<Boxes className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Disponível"
          value={formatStockNumber(stats.available)}
          icon={<PackageCheck className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Atenção"
          value={formatStockNumber(stats.low + stats.zero + stats.noLocation)}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={stats.low + stats.zero + stats.noLocation ? "amber" : "default"}
        />
      </StockMetricsGrid>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por cod. cliente, SKU interno, produto ou localização"
        resultText={`${formatStockNumber(filteredSkus.length)} SKU(s) exibido(s) nesta página.`}
      >
        <StockFilterChip active={quickFilter === "todos"} onClick={() => setQuickFilter("todos")} count={skus.length}>
          Todos
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "baixo"} onClick={() => setQuickFilter("baixo")} count={stats.low}>
          Baixo estoque
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "zerado"} onClick={() => setQuickFilter("zerado")} count={stats.zero}>
          Zerados
        </StockFilterChip>
        <StockFilterChip active={quickFilter === "sem-local"} onClick={() => setQuickFilter("sem-local")} count={stats.noLocation}>
          Sem endereço
        </StockFilterChip>
      </StockToolbar>

      <StockTableCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border/80 bg-white/55">
                <tr>
                  <th className="px-5 py-4 font-medium">Cod. cliente</th>
                  <th className="px-4 py-4 font-medium">SKU interno</th>
                  <th className="px-4 py-3 font-medium">Detalhes do Produto</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium">Localização</th>
                  <th className="px-4 py-3 font-medium text-right">Estoque Atual</th>
                  <th className="px-4 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Carregando SKUs...</td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhum SKU encontrado.</td>
                  </tr>
                ) : (
                  filteredSkus.map((sku: Sku) => {
                    const reserved = Number((sku as any).estoque_reservado ?? 0);
                    const current = Number(sku.estoque_atual ?? 0);
                    const available = Number(
                      (sku as any).estoque_disponivel ?? Math.max(0, current - reserved),
                    );
                    const isLow = current > 0 && current <= 10;
                    const noLocation = !locationsForSku(sku).length;

                    return (
                      <tr key={sku.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-primary font-bold">{sku.cod_cliente}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{sku.cod_btg}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900 truncate max-w-[200px]" title={sku.produto}>{sku.produto}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {sku.categoria && `${sku.categoria} • `}
                            {sku.cor || "-"} / {sku.tamanho || "-"}
                          </div>
                        </td>
                        {/* Coluna "Tipo" (estoque_tipo) removida: era campo
                            exclusivo da planilha Excel — o fluxo nativo nunca
                            o preenche e o histórico foi zerado no go-live.
                            Status sem estado legado = OK (saldo saudável). */}
                        <td className="px-4 py-2 text-center">
                          <Badge variant="secondary" className={
                            current <= 0 ? 'bg-rose-50 text-rose-700' :
                            isLow ? 'bg-amber-50 text-amber-700' :
                            sku.estado === 'AVARIADO' ? 'bg-rose-50 text-rose-700' :
                            'bg-primary/10 text-primary'
                          }>
                            {current <= 0 ? "ZERADO" : isLow ? "BAIXO" : sku.estado || "OK"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          {locationsForSku(sku).length ? (
                            <div
                              className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-1 rounded w-fit border border-indigo-100"
                              title={locationsForSku(sku).join(" · ")}
                            >
                              <MapPin className="h-3 w-3" />
                              {locationsForSku(sku)[0]}
                              {locationsForSku(sku).length > 1
                                ? " +" + (locationsForSku(sku).length - 1)
                                : ""}
                            </div>
                          ) : (
                            <span className="text-xs text-amber-700">Sem endereço</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className={`font-semibold ${current === 0 ? 'text-rose-500' : 'text-gray-900'}`}>
                            {current.toLocaleString('pt-BR')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            disp. {available.toLocaleString('pt-BR')}
                            {reserved > 0 ? ` · res. ${reserved.toLocaleString('pt-BR')}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {catalogWriter ? (
                            <div className="flex items-center justify-center gap-2">
                              <SkuModal sku={sku} />
                              <DeleteSkuButton id={sku.id} cod_btg={sku.cod_btg} />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <StockTablePagination
            page={page}
            isLoading={isLoading}
            count={data?.items?.length || 0}
            total={data?.total || 0}
            limit={limit}
            label="SKUs"
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
      </StockTableCard>
    </StockPageShell>
  );
}

export function SkuModal({ sku, trigger }: { sku?: any; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createSku = useCreateSku();
  const updateSku = useUpdateSku();

  const isEdit = !!sku;

  const { register, handleSubmit, formState: { errors }, reset } = useForm<SkuFormValues>({
    resolver: zodResolver(skuSchema),
    defaultValues: sku ? { ...sku, estoque_minimo: sku.estoque_minimo ?? "" } : {
      cod_btg: "",
      cod_cliente: "",
      produto: "",
      estoque_tipo: "BTG",
      genero: "",
      categoria: "",
      cor: "",
      tamanho: "",
      estado: "NOVO",
      estoque_minimo: "",
    }
  });

  const onSubmit = (data: SkuFormValues) => {
    if (isEdit) {
      updateSku.mutate(
        { id: sku.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            queryClient.invalidateQueries({ queryKey: ["estoque"] });
            toast({ title: "SKU atualizado com sucesso" });
            setOpen(false);
          },
          onError: (error) => {
            toast({
              title: "Erro ao atualizar SKU",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    } else {
      createSku.mutate(
        { data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
            queryClient.invalidateQueries({ queryKey: ["estoque"] });
            toast({ title: "SKU criado com sucesso" });
            setOpen(false);
            reset();
          },
          onError: (error) => {
            toast({
              title: "Erro ao criar SKU",
              description: humanApiError(error, "Tente novamente em instantes."),
              variant: "destructive",
            });
          }
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ? trigger : isEdit ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
            <Edit className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Adicionar SKU
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cadastro mestre" : "Novo cadastro mestre de SKU"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Identificadores</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cod_btg">Cod. BTG *</Label>
                <Input id="cod_btg" {...register("cod_btg")} />
                {errors.cod_btg && <span className="text-xs text-destructive">{errors.cod_btg.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cod_cliente">Cod. Cliente *</Label>
                <Input id="cod_cliente" {...register("cod_cliente")} />
                {errors.cod_cliente && <span className="text-xs text-destructive">{errors.cod_cliente.message}</span>}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="produto">Nome do Produto *</Label>
                <Input id="produto" {...register("produto")} />
                {errors.produto && <span className="text-xs text-destructive">{errors.produto.message}</span>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Atributos</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="categoria">Categoria</Label>
                <Input id="categoria" {...register("categoria")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cor">Cor</Label>
                <Input id="cor" {...register("cor")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tamanho">Tamanho</Label>
                <Input id="tamanho" {...register("tamanho")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estoque_tipo">Tipo de Estoque</Label>
                <Input id="estoque_tipo" placeholder="BTG" {...register("estoque_tipo")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estado">Condição</Label>
                <Input id="estado" placeholder="NOVO" {...register("estado")} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Reposição</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="estoque_minimo">Estoque mínimo</Label>
                <Input
                  id="estoque_minimo"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Sem mínimo"
                  {...register("estoque_minimo")}
                />
              </div>
              <p className="col-span-2 self-end pb-2 text-xs leading-5 text-muted-foreground">
                Com saldo igual ou abaixo deste número o item aparece como “Baixo” no Estoque. Vazio: sem alerta.
              </p>
            </div>
            {errors.estoque_minimo && <span className="text-xs text-destructive">{errors.estoque_minimo.message}</span>}
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/55 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white text-blue-600">
                <Boxes className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Saldo e endereço são registrados no WMS</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Depois de salvar o SKU, escolha o fluxo que corresponde à movimentação física.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button asChild type="button" variant="outline" className="h-auto min-h-16 justify-between gap-3 bg-white px-4 py-3 text-left">
                <Link href="/wms/inventario" onClick={() => setOpen(false)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <ClipboardCheck className="h-4 w-4 shrink-0 text-blue-600" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Inventário de abertura</span>
                      <span className="block text-xs font-normal text-muted-foreground">Registrar o primeiro saldo</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </Button>

              <Button asChild type="button" variant="outline" className="h-auto min-h-16 justify-between gap-3 bg-white px-4 py-3 text-left">
                <Link href="/wms/recebimento" onClick={() => setOpen(false)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <PackagePlus className="h-4 w-4 shrink-0 text-blue-600" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Recebimento</span>
                      <span className="block text-xs font-normal text-muted-foreground">Lançar as próximas entradas</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </Button>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              {isEdit ? "Caminhos" : "Salve este cadastro antes de seguir. Depois, use"}: WMS &gt; Inventário &gt; Inventário de abertura ou WMS &gt; Recebimento.
            </p>
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createSku.isPending || updateSku.isPending}>
              {createSku.isPending || updateSku.isPending ? "Salvando..." : "Salvar SKU"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSkuButton({ id, cod_btg, trigger }: { id: number, cod_btg: string, trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteSku = useDeleteSku();

  const onDelete = () => {
    deleteSku.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSkusQueryKey() });
          toast({ title: "Item arquivado" });
          setOpen(false);
        },
        onError: (error) => {
          toast({
            title: "Erro ao arquivar item",
            description: humanApiError(error, "Tente novamente em instantes."),
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Arquivar item</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Arquivar <strong className="text-foreground">{cod_btg}</strong>? O item sai das
            listas; o histórico de movimentos continua guardado.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleteSku.isPending}>
            {deleteSku.isPending ? "Arquivando..." : "Arquivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
