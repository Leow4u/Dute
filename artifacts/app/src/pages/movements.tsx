import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type Movement,
  type MovementInput,
  useListMovements,
  useCreateMovement,
  getListMovementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
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
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { canOperateWarehouse } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  StockFilterChip,
  StockPageShell,
  StockTableCard,
  StockTablePagination,
  StockToolbar,
} from "@/components/stock/stock-workbench";

const POSITIVE_MOVEMENTS = new Set(["ENTRADA", "DEVOLUCAO", "AJUSTE_ENTRADA"]);

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  DEVOLUCAO: "Devolução",
  AJUSTE_ENTRADA: "Ajuste +",
  AJUSTE_SAIDA: "Ajuste -",
  AJUSTE: "Ajuste",
  TRANSFERENCIA: "Transferência",
};

function movementLabel(type: string | undefined) {
  return (type && MOVEMENT_LABELS[type]) || type || "—";
}

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

/**
 * Agora, no fuso do aparelho, como o campo datetime-local mostra e o envio
 * lê (`new Date(values.data)` é hora local). O `toISOString()` daria a hora
 * de Greenwich: três horas à frente em São Paulo.
 */
export function agoraNoCampo(agora: Date): string {
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * O que a movimentação manda ao servidor: o sinal pelo tipo, a data em ISO e
 * o cliente ativo. A área interna grava para ele; sem o campo, o servidor
 * gravaria na BTG.
 */
export function payloadDaMovimentacao(
  values: MovementFormValues,
  customerCode: string,
  idempotencyKey: string,
): MovementInput & { customer_code: string } {
  return {
    ...values,
    sinal: POSITIVE_MOVEMENTS.has(values.tipo_mov) ? 1 : -1,
    data: new Date(values.data).toISOString(),
    customer_code: customerCode,
    idempotency_key: idempotencyKey,
  };
}

/**
 * Histórico de movimentos. Dentro de Estoque (aba Histórico) vem `embedded`:
 * sem cabeçalho próprio, a ação "Registrar movimentação" fica no cabeçalho
 * da página. Em /movements (rota antiga) ganha cabeçalho e ação próprios.
 */
export default function Movements({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAppUser();
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

  // Colunas sem dado em nenhuma linha da página não aparecem.
  const showRoute = movements.some((mov) => mov.origem || mov.destino);
  const showBalance = movements.some((mov) => mov.estoque_resultante != null);
  const showDoc = movements.some((mov) => mov.doc_nf);
  const showOperator = movements.some((mov) => mov.responsavel);
  const columnCount = 5 + Number(showRoute) + Number(showBalance) + Number(showDoc) + Number(showOperator);

  const content = (
    <>

      <StockToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Buscar por SKU interno da movimentação"
        filterLabel="Tipo"
        filterSummary={typeFilter === "todos" ? undefined : movementLabel(typeFilter)}
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
          <ul className="divide-y divide-border md:hidden">
            {isLoading ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando movimentações...</li>
            ) : movements.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma movimentação encontrada.</li>
            ) : (
              movements.map((mov: Movement) => <MovementCard key={mov.id} movement={mov} />)
            )}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/70 text-xs uppercase tracking-wide text-foreground/50">
                  <th className="px-5 py-2.5 font-semibold">Data</th>
                  <th className="px-3 py-2.5 font-semibold">Tipo</th>
                  <th className="px-3 py-2.5 font-semibold">Código</th>
                  <th className="px-3 py-2.5 font-semibold">Produto</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Qtde</th>
                  {showRoute ? <th className="px-3 py-2.5 font-semibold">Trajeto</th> : null}
                  {showBalance ? <th className="px-3 py-2.5 text-right font-semibold">Saldo</th> : null}
                  {showDoc ? <th className="px-3 py-2.5 font-semibold">Doc/NF</th> : null}
                  {showOperator ? <th className="px-3 py-2.5 font-semibold">Operador</th> : null}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                      Carregando movimentações...
                    </td>
                  </tr>
                ) : data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhuma movimentação encontrada.
                    </td>
                  </tr>
                ) : (
                  movements.map((mov: Movement) => {
                    const isPositive = mov.sinal > 0;
                    const Arrow = isPositive ? ArrowDownRight : ArrowUpRight;
                    return (
                      <tr key={mov.id} className="border-b border-border/40 last:border-0 hover:bg-muted/60">
                        <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                          {new Date(mov.data).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Arrow className="h-3.5 w-3.5" aria-hidden="true" />
                            {movementLabel(mov.tipo_mov)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-primary">
                          {mov.cod_sku}
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-3 font-medium text-foreground" title={mov.produto}>
                          {mov.produto}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums",
                            isPositive ? "text-success-soft-foreground" : "text-destructive-soft-foreground",
                          )}
                        >
                          {isPositive ? "+" : "-"}
                          {mov.qtde}
                        </td>
                        {showRoute ? (
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                            {mov.origem || "-"} → {mov.destino || "-"}
                          </td>
                        ) : null}
                        {showBalance ? (
                          <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                            {mov.estoque_resultante?.toLocaleString("pt-BR") ?? "-"}
                          </td>
                        ) : null}
                        {showDoc ? (
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{mov.doc_nf || "-"}</td>
                        ) : null}
                        {showOperator ? (
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-foreground">{mov.responsavel || "-"}</td>
                        ) : null}
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
    </>
  );

  if (embedded) return <div className="flex flex-col gap-4">{content}</div>;
  return (
    <StockPageShell
      title="Histórico de movimentos"
      actions={canOperateWarehouse(user?.publicMetadata.role) ? <MovementModal /> : undefined}
    >
      {content}
    </StockPageShell>
  );
}

/** Abaixo de 768px a tabela vira esta lista: produto, quantidade, código, tipo, data e trajeto. */
function MovementCard({ movement: mov }: { movement: Movement }) {
  const isPositive = mov.sinal > 0;
  const Arrow = isPositive ? ArrowDownRight : ArrowUpRight;
  const when = new Date(mov.data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const details = [
    mov.origem || mov.destino ? `${mov.origem || "-"} → ${mov.destino || "-"}` : null,
    mov.estoque_resultante != null ? `saldo ${mov.estoque_resultante.toLocaleString("pt-BR")}` : null,
    mov.doc_nf || null,
    mov.responsavel || null,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md",
          isPositive
            ? "bg-success-soft text-success-soft-foreground"
            : "bg-destructive-soft text-destructive-soft-foreground",
        )}
        aria-hidden="true"
      >
        <Arrow className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground" title={mov.produto}>
            {mov.produto}
          </span>
          <span
            className={cn(
              "shrink-0 text-sm font-semibold tabular-nums",
              isPositive ? "text-success-soft-foreground" : "text-destructive-soft-foreground",
            )}
          >
            {isPositive ? "+" : "-"}
            {mov.qtde}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap font-mono">{mov.cod_sku}</span>
          <span>{movementLabel(mov.tipo_mov)}</span>
          <span className="whitespace-nowrap">{when}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{details.join(" · ")}</div>
      </div>
    </li>
  );
}

export function MovementModal({ defaultSku, trigger }: { defaultSku?: string; trigger?: ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  // A nova tentativa do mesmo ajuste (a resposta se perdeu) repete a chave, e
  // o servidor devolve o movimento gravado em vez de lançar o saldo de novo.
  // O ajuste mudado é outro envio, com outra chave.
  const tentativa = useRef<{ chave: string; conteudo: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMovement = useCreateMovement();
  const { user } = useAppUser();
  const { code: customerCode } = useActiveCustomer();

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
      data: agoraNoCampo(new Date()),
      tipo_mov: "ENTRADA",
      cod_sku: defaultSku ?? "",
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
    const conteudo = JSON.stringify(payloadDaMovimentacao(data, customerCode, ""));
    if (tentativa.current?.conteudo !== conteudo) tentativa.current = { chave: crypto.randomUUID(), conteudo };
    createMovement.mutate(
      { data: payloadDaMovimentacao(data, customerCode, tentativa.current.chave) },
      {
        onSuccess: () => {
          tentativa.current = null;
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
    <Dialog
      open={open}
      onOpenChange={(aberto) => {
        // Cada registro abre com a hora de agora, não a de quando a tela montou.
        if (aberto) setValue("data", agoraNoCampo(new Date()));
        setOpen(aberto);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Registrar Movimentação
          </Button>
        )}
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
                      <SelectValue placeholder="—" />
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
