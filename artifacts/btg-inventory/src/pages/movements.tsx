import { useEffect, useMemo, useState } from "react";
import {
  type Movement,
  useListMovements,
  useCreateMovement,
  getListMovementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  ClipboardList,
  PackagePlus,
  PackageMinus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
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

const POSITIVE_MOVEMENTS = new Set(["ENTRADA", "DEVOLUCAO", "AJUSTE_ENTRADA"]);

const movementSchema = z.object({
  data: z.string().min(1, "Obrigatório"),
  tipo_mov: z.string().min(1, "Obrigatório"),
  cod_sku: z.string().min(1, "Obrigatório"),
  produto: z.string().min(1, "Obrigatório"),
  qtde: z.coerce.number().min(1, "A quantidade deve ser no mínimo 1"),
  sinal: z.coerce.number(),
  origem: z.string().optional(),
  destino: z.string().optional(),
  responsavel: z.string().optional(),
  doc_nf: z.string().optional(),
  motivo: z.string().trim().min(3, "Informe o motivo da movimentação"),
});

type MovementFormValues = z.infer<typeof movementSchema>;

export default function Movements() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<string[]>([]);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
      setCursors([]);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
    setCursors([]);
  }, [typeFilter]);

  // `search` faz match parcial na página; `cod_sku` é filtro de igualdade no
  // servidor. Mandar a caixa de busca como cod_sku transformava qualquer
  // digitação parcial em zero resultados.
  // `search` faz busca por prefixo de cod_sku no servidor (readPaged).
  // O offset segue junto do cursor apenas como base da estimativa de total.
  const listParams = {
    search: debouncedSearch || undefined,
    tipo_mov: typeFilter === "todos" ? undefined : typeFilter,
    limit,
    offset: page * limit,
    ...(page > 0 && cursors[page - 1] ? { cursor: cursors[page - 1] } : {}),
  };

  const { data, isLoading } = useListMovements(listParams, {
    query: {
      queryKey: getListMovementsQueryKey(listParams),
    },
  });

  // Keep cursor stack in sync when server returns next_cursor (extra field).
  useEffect(() => {
    const next = (data as { next_cursor?: string } | undefined)?.next_cursor;
    if (!next || page < cursors.length) return;
    setCursors((prev) => (prev[page] === next ? prev : [...prev.slice(0, page), next]));
  }, [data, page, cursors]);

  const movements = data?.items ?? [];
  const total = data?.total || 0;
  const hasMore =
    Boolean((data as { has_more?: boolean } | undefined)?.has_more) ||
    (page + 1) * limit < total;
  const stats = useMemo(() => {
    return movements.reduce(
      (acc, mov) => {
        const quantity = Number(mov.qtde ?? 0);
        if (mov.sinal > 0) {
          acc.entries += 1;
          acc.entryQuantity += quantity;
        } else {
          acc.exits += 1;
          acc.exitQuantity += quantity;
        }
        if (mov.tipo_mov?.includes("AJUSTE")) acc.adjustments += 1;
        return acc;
      },
      { entries: 0, exits: 0, adjustments: 0, entryQuantity: 0, exitQuantity: 0 },
    );
  }, [movements]);

  return (
    <StockPageShell
      eyebrow="Estoque"
      title="Movimentações"
      icon={<Activity className="h-6 w-6" />}
      actions={<MovementModal />}
    >
      <StockMetricsGrid>
        <StockMetricCard
          label="Movimentos"
          value={formatStockNumber(data?.total ?? 0)}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="blue"
        />
        <StockMetricCard
          label="Entradas"
          value={formatStockNumber(stats.entryQuantity)}
          icon={<PackagePlus className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Saídas"
          value={formatStockNumber(stats.exitQuantity)}
          icon={<PackageMinus className="h-5 w-5" />}
        />
        <StockMetricCard
          label="Ajustes"
          value={formatStockNumber(stats.adjustments)}
          icon={<Activity className="h-5 w-5" />}
          tone={stats.adjustments ? "amber" : "default"}
        />
      </StockMetricsGrid>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por SKU interno da movimentação"
      >
        <StockFilterChip active={typeFilter === "todos"} onClick={() => setTypeFilter("todos")}>
          Todos
        </StockFilterChip>
        <StockFilterChip active={typeFilter === "ENTRADA"} onClick={() => setTypeFilter("ENTRADA")}>
          Entrada
        </StockFilterChip>
        <StockFilterChip active={typeFilter === "SAIDA"} onClick={() => setTypeFilter("SAIDA")}>
          Saída
        </StockFilterChip>
        <StockFilterChip active={typeFilter === "AJUSTE_ENTRADA"} onClick={() => setTypeFilter("AJUSTE_ENTRADA")}>
          Ajuste +
        </StockFilterChip>
        <StockFilterChip active={typeFilter === "AJUSTE_SAIDA"} onClick={() => setTypeFilter("AJUSTE_SAIDA")}>
          Ajuste -
        </StockFilterChip>
      </StockToolbar>

      <StockTableCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border/80 bg-white/55">
                <tr>
                  <th className="px-5 py-4 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Cod. SKU</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium text-right">Qtde</th>
                  <th className="px-4 py-3 font-medium text-center">
                    Trajeto (Orig &rarr; Dest)
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Saldo</th>
                  <th className="px-4 py-3 font-medium">Doc/NF</th>
                  <th className="px-4 py-3 font-medium">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Carregando movimentações...
                    </td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Nenhuma movimentação encontrada.
                    </td>
                  </tr>
                ) : (
                  movements.map((mov: Movement) => {
                    const isPositive = mov.sinal > 0;
                    return (
                      <tr
                        key={mov.id}
                        className="hover:bg-gray-50/80 transition-colors"
                      >
                        <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                          {new Date(mov.data).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={
                              isPositive
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }
                          >
                            {mov.tipo_mov}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-primary font-bold">
                          {mov.cod_sku}
                        </td>
                        <td
                          className="px-4 py-2 truncate max-w-[150px] font-medium"
                          title={mov.produto}
                        >
                          {mov.produto}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div
                            className={`flex items-center justify-end gap-1 font-bold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {isPositive ? (
                              <ArrowDownRight className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            {isPositive ? "+" : "-"}
                            {mov.qtde}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-muted-foreground">
                          <div className="flex items-center justify-center gap-2">
                            <span
                              className="truncate max-w-[80px]"
                              title={mov.origem || "-"}
                            >
                              {mov.origem || "-"}
                            </span>
                            <span className="text-gray-300">&rarr;</span>
                            <span
                              className="truncate max-w-[80px]"
                              title={mov.destino || "-"}
                            >
                              {mov.destino || "-"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                          {mov.estoque_resultante?.toLocaleString("pt-BR") ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {mov.doc_nf || "-"}
                        </td>
                        <td className="px-4 py-2 text-xs font-medium text-gray-700">
                          {mov.responsavel || "-"}
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
            total={total}
            limit={limit}
            hasMore={hasMore}
            label="movimentações"
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => {
              if (!hasMore) return;
              setPage((p) => p + 1);
            }}
          />
      </StockTableCard>
    </StockPageShell>
  );
}

function MovementModal() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMovement = useCreateMovement();
  const { user } = useAppUser();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    control,
    watch,
    setValue,
  } = useForm<MovementFormValues>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      data: new Date().toISOString().slice(0, 16),
      tipo_mov: "ENTRADA",
      cod_sku: "",
      produto: "",
      qtde: 1,
      sinal: 1,
      origem: "",
      destino: "ESTOQUE_BTG",
      responsavel: user?.fullName || "Sistema",
      doc_nf: "",
      motivo: "",
    },
  });

  const tipo_mov = watch("tipo_mov");
  const isPositiveMovement = POSITIVE_MOVEMENTS.has(tipo_mov);

  const onSubmit = (data: MovementFormValues) => {
    // Ensure sinal matches tipo_mov logic
    data.sinal = POSITIVE_MOVEMENTS.has(data.tipo_mov) ? 1 : -1;

    // Ensure date is properly formatted as ISO
    data.data = new Date(data.data).toISOString();

    const payload = {
      ...data,
      idempotency_key: crypto.randomUUID(),
    };

    createMovement.mutate(
      { data: payload },
      {
        onSuccess: () => {
          // Escopado ao que uma movimentação realmente altera: invalidar tudo
          // dispara refetch de todas as telas em cache de uma vez.
          for (const key of [
            ["/api/movements"],
            ["/api/dashboard"],
            ["stock-balances"],
            ["/api/skus"],
          ]) {
            queryClient.invalidateQueries({ queryKey: key });
          }
          toast({ title: "Movimentação registrada com sucesso" });
          setOpen(false);
          reset();
        },
        onError: (error) => {
          toast({
            title: "Erro ao registrar movimentação",
            description:
              error instanceof Error
                ? error.message.replace(/^HTTP \d+[^:]*:\s*/, "")
                : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Registrar Movimentação
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Registrar Movimentação de Estoque</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="tipo_mov">Tipo de Movimentação *</Label>
              <Controller
                control={control}
                name="tipo_mov"
                render={({ field }) => (
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                      if (val === "ENTRADA" || val === "DEVOLUCAO") {
                        setValue("sinal", 1);
                        setValue("destino", "ESTOQUE_BTG");
                        setValue("origem", "FORNECEDOR");
                      } else {
                        setValue("sinal", -1);
                        setValue("origem", "ESTOQUE_BTG");
                        setValue("destino", "CLIENTE");
                      }
                    }}
                    defaultValue={field.value}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA">Entrada (+)</SelectItem>
                      <SelectItem value="SAIDA">Saída (-)</SelectItem>
                      <SelectItem value="AJUSTE_ENTRADA">
                        Ajuste Positivo (+)
                      </SelectItem>
                      <SelectItem value="AJUSTE_SAIDA">
                        Ajuste Negativo (-)
                      </SelectItem>
                      <SelectItem value="DEVOLUCAO">Devolução (+)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="motivo">Motivo *</Label>
              <Input
                id="motivo"
                placeholder="Ex.: ajuste após contagem física"
                {...register("motivo")}
              />
              {errors.motivo && (
                <p className="text-sm text-destructive">
                  {errors.motivo.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cod_sku">Cod. SKU *</Label>
              <Input id="cod_sku" {...register("cod_sku")} />
              {errors.cod_sku && (
                <span className="text-xs text-destructive">
                  {errors.cod_sku.message}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qtde">Quantidade *</Label>
              <div className="relative">
                <Input id="qtde" type="number" min="1" {...register("qtde")} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {isPositiveMovement ? "entra" : "sai"}
                </span>
              </div>
              {errors.qtde && (
                <span className="text-xs text-destructive">
                  {errors.qtde.message}
                </span>
              )}
            </div>

            <div className="space-y-2 col-span-2">
              <Label htmlFor="produto">Nome do Produto *</Label>
              <Input id="produto" {...register("produto")} />
              {errors.produto && (
                <span className="text-xs text-destructive">
                  {errors.produto.message}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="origem">Origem</Label>
              <Input id="origem" {...register("origem")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destino">Destino</Label>
              <Input id="destino" {...register("destino")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc_nf">Documento / NF</Label>
              <Input id="doc_nf" {...register("doc_nf")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data">Data</Label>
              <Input id="data" type="datetime-local" {...register("data")} />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMovement.isPending}>
              {createMovement.isPending
                ? "Salvando..."
                : "Registrar Movimentação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
