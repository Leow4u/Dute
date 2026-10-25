/** Exception and return workspaces for warehouse ops. */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareWarning,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type AlertSeverity,
  type AnyRecord,
  coerceText,
  fetchJson,
  formatCurrency,
  formatDate,
  formatNumber,
  formatUnits,
  getErrorMessage,
} from "@/lib/warehouse-ops/model";
import {
  type OperationalException,
  type ProductLookupItem,
  productLookupFromRecord,
} from "@/features/warehouse-ops/shared";
import {
  type ReceiptDraftLine,
  emptyReceiptLine,
  findExistingProduct,
  mergeProductLookup,
  normalizeApiRows,
  normalizeProductKey,
} from "@/features/warehouse-ops/receiving";
import { ProductIdentityCard } from "./product-identity";
import { LEGACY_CUSTOMER_CODE, customerRows, recordCustomerCode } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";

export type ReturnReceiptResult = {
  ok?: boolean;
  return_id?: string;
  return_item_ids?: string[];
  qty_total?: number;
};

export type CreatedReturnLine = {
  itemId: string;
  returnId: string;
  skuCode: string;
  clientCode: string;
  productName: string;
  quantity: number;
  unitCost: number;
  status: "pending_disposition" | "disposition_set";
  disposition?: string;
  source?: string;
  reference?: string;
  receivedAt?: string;
};

export type ReturnDispositionDraft = {
  disposition: "available" | "damaged" | "quarantine" | "discard";
  location: string;
  notes: string;
};

function apiDateText(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: number }).seconds === "number"
  ) {
    return new Date(
      (value as { seconds: number }).seconds * 1000,
    ).toISOString();
  }
  return undefined;
}

function exceptionFromRecord(record: AnyRecord): OperationalException {
  const severity = coerceText(record.severity) as AlertSeverity;
  return {
    id: coerceText(record.id, record._docId),
    taskUid: coerceText(record.task_uid),
    taskType: coerceText(record.task_type),
    taskId: coerceText(record.task_id),
    reference: coerceText(record.reference, record.order_number, record.receipt_id),
    note: coerceText(record.note, record.description, "Exceção operacional"),
    severity: ["info", "attention", "critical"].includes(severity)
      ? severity
      : "attention",
    status: coerceText(record.status, "open"),
    customerCode: recordCustomerCode(record),
    createdAt: apiDateText(record.created_at),
    resolvedAt: apiDateText(record.resolved_at),
    resolution: coerceText(record.resolution) || undefined,
  };
}

function severityLabel(severity: AlertSeverity) {
  if (severity === "critical") return "crítica";
  if (severity === "attention") return "atenção";
  return "informativa";
}

function taskTypeLabel(type: string) {
  const labels: Record<string, string> = {
    receiving: "Recebimento",
    putaway: "Guarda",
    picking: "Picking",
    packing: "Packing",
    shipping: "Expedição",
  };
  return labels[type] ?? (type || "WMS");
}

export function ExceptionWorkspace() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedExceptionId, setSelectedExceptionId] = useState<string>();
  const [resolutionText, setResolutionText] = useState("");
  const [resolutionAction, setResolutionAction] = useState<"resolve" | "cancel">(
    "resolve",
  );

  const exceptionsQuery = useQuery({
    queryKey: ["warehouse-exceptions"],
    staleTime: 15_000,
    queryFn: async () => {
      const payload = await fetchJson<unknown>("/api/quality-exceptions?limit=500");
      return normalizeApiRows(payload)
        .map(exceptionFromRecord)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    },
  });

  const exceptions = exceptionsQuery.data ?? [];
  const openExceptions = exceptions.filter((item) =>
    ["open", "in_review"].includes(item.status),
  );
  const recentlyClosed = exceptions
    .filter((item) => !["open", "in_review"].includes(item.status))
    .slice(0, 5);
  const selectedException =
    openExceptions.find((item) => item.id === selectedExceptionId) ??
    openExceptions[0];

  useEffect(() => {
    if (!selectedException) {
      setSelectedExceptionId(undefined);
      return;
    }
    if (!selectedExceptionId || selectedExceptionId !== selectedException.id) {
      setSelectedExceptionId(selectedException.id);
    }
  }, [selectedException, selectedExceptionId]);

  const resolveException = useMutation<
    unknown,
    Error,
    { exception: OperationalException; action: "resolve" | "cancel"; resolution: string }
  >({
    mutationFn: ({ exception, action, resolution }) =>
      fetchJson(
        `/api/warehouse/exceptions/${encodeURIComponent(exception.id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resolution,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: () => {
      setResolutionText("");
      void queryClient.invalidateQueries({ queryKey: ["warehouse-exceptions"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({
        title: "Exceção tratada",
        description: "O WMS e a memória operacional do Agent Dute foram atualizados.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui tratar a exceção",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const canResolve = Boolean(
    selectedException && resolutionText.trim().length >= 6 && !resolveException.isPending,
  );

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="overflow-hidden rounded-lg border-border/80 bg-card">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
                <ShieldAlert className="size-5" />
              </div>
              <div>
                <CardTitle>Exceções operacionais</CardTitle>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                {formatNumber(openExceptions.length)} aberta(s)
              </Badge>
              <Button
                type="button"
                variant="outline"
                onClick={() => exceptionsQuery.refetch()}
                disabled={exceptionsQuery.isFetching}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={cn(exceptionsQuery.isFetching && "animate-spin")}
                />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {exceptionsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
            </div>
          ) : openExceptions.length ? (
            <div className="space-y-3">
              {openExceptions.map((exception) => {
                const isSelected = selectedException?.id === exception.id;
                return (
                  <button
                    key={exception.id}
                    type="button"
                    onClick={() => setSelectedExceptionId(exception.id)}
                    className={cn(
                      "w-full cursor-pointer rounded-lg border bg-card p-4 text-left transition hover:bg-card",
                      isSelected
                        ? "border-primary/30"
                        : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              exception.severity === "critical"
                                ? "border-destructive/25 bg-destructive/10 text-destructive"
                                : "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
                            )}
                          >
                            {severityLabel(exception.severity as AlertSeverity)}
                          </Badge>
                          <Badge variant="outline" className="border-border bg-card">
                            {taskTypeLabel(exception.taskType)}
                          </Badge>
                        </div>
                        <h3 className="mt-3 text-base font-semibold text-foreground">
                          {exception.reference || exception.taskUid}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {exception.note}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(exception.createdAt, "Sem data")}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty className="min-h-[300px] border border-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckCircle2 className="size-5" />
                </EmptyMedia>
                <EmptyTitle className="text-base">Sem exceções abertas</EmptyTitle>
                <EmptyDescription>
                  Falta, avaria ou divergência registrada no WMS aparecerá aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/80 bg-card">
          <CardHeader>
            <CardTitle className="text-base">Tratativa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedException ? (
              <>
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedException.customerCode}</Badge>
                    <Badge variant="outline">
                      {taskTypeLabel(selectedException.taskType)}
                    </Badge>
                  </div>
                  <h3 className="mt-3 font-semibold text-foreground">
                    {selectedException.reference || selectedException.taskUid}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {selectedException.note}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={resolutionAction === "resolve" ? "default" : "outline"}
                    onClick={() => setResolutionAction("resolve")}
                  >
                    Resolver
                  </Button>
                  <Button
                    type="button"
                    variant={resolutionAction === "cancel" ? "default" : "outline"}
                    onClick={() => setResolutionAction("cancel")}
                  >
                    Cancelar
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exception-resolution">
                    Como a exceção foi tratada
                  </Label>
                  <Textarea
                    id="exception-resolution"
                    value={resolutionText}
                    onChange={(event) => setResolutionText(event.target.value)}
                    placeholder="Ex.: fornecedor validou falta, saldo físico ajustado e pedido liberado para seguir."
                  />
                </div>

                <Button
                  type="button"
                  className="w-full"
                  disabled={!canResolve}
                  onClick={() =>
                    selectedException &&
                    resolveException.mutate({
                      exception: selectedException,
                      action: resolutionAction,
                      resolution: resolutionText.trim(),
                    })
                  }
                >
                  {resolveException.isPending ? (
                    <RefreshCw data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <CheckCircle2 data-icon="inline-start" />
                  )}
                  Confirmar tratativa
                </Button>
              </>
            ) : (
              <Empty className="min-h-[220px] border border-border bg-card">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquareWarning className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">Nada selecionado</EmptyTitle>
                  <EmptyDescription>
                    Selecione uma exceção aberta para registrar a tratativa.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        {recentlyClosed.length ? (
          <Card className="rounded-lg border-border/80 bg-card">
            <CardHeader>
              <CardTitle className="text-base">Recentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentlyClosed.map((exception) => (
                <div
                  key={exception.id}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {exception.reference || exception.taskUid}
                    </span>
                    <Badge variant="outline">{exception.status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {exception.resolution || exception.note}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function returnLineFromRecord(
  record: AnyRecord,
  headersById: Map<string, AnyRecord>,
): CreatedReturnLine {
  const returnId = coerceText(record.return_id);
  const header = headersById.get(returnId);
  const quantity = Number(record.quantity ?? record.qty ?? 0);
  const unitCost = Number(record.unit_cost ?? record.preco_unit ?? 0);
  return {
    itemId: coerceText(record.id, record._docId),
    returnId,
    skuCode: coerceText(record.sku_code, record.cod_sku, record.cod_btg),
    clientCode: coerceText(record.client_item_code, record.cod_cliente),
    productName: coerceText(record.product_name, record.produto, record.name),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unitCost: Number.isFinite(unitCost) ? unitCost : 0,
    status:
      coerceText(record.status) === "disposition_set"
        ? "disposition_set"
        : "pending_disposition",
    disposition: coerceText(record.disposition) || undefined,
    source: coerceText(header?.source, record.source) || undefined,
    reference: coerceText(header?.reference, record.reference) || undefined,
    receivedAt: coerceText(header?.received_at, record.received_at) || undefined,
  };
}

export function ReturnWorkspace() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // A devolução é do cliente ativo: produtos, pendências e o registro são dele.
  const { code: customerCode, active: activeCustomer } = useActiveCustomer();
  const defaultSource = customerCode === LEGACY_CUSTOMER_CODE ? "Loja BTG" : activeCustomer.name;
  const [source, setSource] = useState(defaultSource);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptDraftLine[]>([
    { ...emptyReceiptLine(), location: "" },
  ]);
  const [createdLines, setCreatedLines] = useState<CreatedReturnLine[]>([]);
  const [dispositionDrafts, setDispositionDrafts] = useState<
    Record<string, ReturnDispositionDraft>
  >({});

  const lookupQuery = useQuery({
    queryKey: ["returns-product-lookup", customerCode],
    staleTime: 60_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus?limit=5000"),
        fetchJson<unknown>("/api/products?limit=5000"),
      ]);
      const skus = customerRows(normalizeApiRows(skusPayload), customerCode).map(productLookupFromRecord);
      const products = customerRows(normalizeApiRows(productsPayload), customerCode).map(productLookupFromRecord);
      return mergeProductLookup(skus, products);
    },
  });

  const productLookup = lookupQuery.data ?? [];
  const pendingReturnLinesQuery = useQuery({
    queryKey: ["returns-pending", customerCode],
    staleTime: 20_000,
    queryFn: async () => {
      const [itemsPayload, headersPayload] = await Promise.all([
        fetchJson<unknown>("/api/return-items?status=pending_disposition&limit=500"),
        fetchJson<unknown>("/api/returns?limit=500"),
      ]);
      const headersById = new Map(
        normalizeApiRows(headersPayload).map((header) => [
          coerceText(header.id, header._docId),
          header,
        ]),
      );
      return customerRows(normalizeApiRows(itemsPayload), customerCode)
        .map((record) => returnLineFromRecord(record, headersById))
        .filter((line) => line.itemId && line.status === "pending_disposition")
        .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
    },
  });
  const visibleReturnLines = useMemo(() => {
    const linesById = new Map<string, CreatedReturnLine>();
    for (const line of pendingReturnLinesQuery.data ?? []) {
      linesById.set(line.itemId, line);
    }
    for (const line of createdLines) {
      linesById.set(line.itemId, line);
    }
    return [...linesById.values()].sort((a, b) =>
      (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""),
    );
  }, [createdLines, pendingReturnLinesQuery.data]);
  const lineIssues = lines.map((line, index) => {
    const currentKey = normalizeProductKey(line.clientCode || line.sku);
    const duplicateInDraft = Boolean(
      currentKey &&
        lines.some(
          (otherLine, otherIndex) =>
            otherIndex !== index &&
            normalizeProductKey(otherLine.clientCode || otherLine.sku) === currentKey,
        ),
    );
    const existing = findExistingProduct(line, productLookup);
    return { duplicateInDraft, existing };
  });
  const canCreate =
    lines.some((line) => line.clientCode.trim() || line.sku.trim()) &&
    lineIssues.every((issue) => !issue.duplicateInDraft && Boolean(issue.existing));

  function updateLine(index: number, patch: Partial<ReceiptDraftLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch, createNew: false } : line,
      ),
    );
  }

  function removeLine(index: number) {
    setLines((current) =>
      current.length === 1
        ? [{ ...emptyReceiptLine(), location: "" }]
        : current.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  function applyExistingProduct(index: number, product: ProductLookupItem) {
    updateLine(index, {
      sku: product.skuCode,
      clientCode: product.clientCode,
      product: product.productName,
      unitCost: product.unitCost > 0 ? String(product.unitCost) : "",
    });
  }

  const createReturn = useMutation<ReturnReceiptResult, Error>({
    mutationFn: () => {
      const items = lines.map((line) => {
        const existing = findExistingProduct(line, productLookup);
        return {
          sku_code: existing?.skuCode,
          client_item_code: existing?.clientCode,
          product_name: existing?.productName,
          quantity: Number(line.quantity),
          unit_cost: line.unitCost.trim()
            ? Number(line.unitCost)
            : existing?.unitCost || undefined,
          condition: "return_received",
        };
      });
      return fetchJson<ReturnReceiptResult>("/api/warehouse/returns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_code: customerCode,
          source: source.trim() || defaultSource,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          received_at: new Date().toISOString(),
          idempotency_key: crypto.randomUUID(),
          items,
        }),
      });
    },
    onSuccess: (result) => {
      const returnId = result.return_id || "";
      const receivedAt = new Date().toISOString();
      const nextLines = lines.reduce<CreatedReturnLine[]>((acc, line, index) => {
          const existing = findExistingProduct(line, productLookup);
          const itemId = result.return_item_ids?.[index];
          if (!existing || !itemId) return acc;
          acc.push({
            itemId,
            returnId,
            skuCode: existing.skuCode,
            clientCode: existing.clientCode,
            productName: existing.productName,
            quantity: Number(line.quantity),
            unitCost: line.unitCost.trim()
              ? Number(line.unitCost)
              : existing.unitCost || 0,
            status: "pending_disposition" as const,
            source: source.trim() || defaultSource,
            reference: reference.trim() || undefined,
            receivedAt,
          });
          return acc;
        }, []);
      setCreatedLines((current) => [...nextLines, ...current]);
      setDispositionDrafts((current) => {
        const next = { ...current };
        nextLines.forEach((line) => {
          next[line.itemId] = {
            disposition: "available",
            location: "DEVOLUCAO",
            notes: "",
          };
        });
        return next;
      });
      setLines([{ ...emptyReceiptLine(), location: "" }]);
      setReference("");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["returns-pending"] });
      toast({
        title: "Devolução registrada",
        description:
          "Agora defina a disposição física de cada item antes de liberar saldo.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a devolução",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const setDisposition = useMutation<
    unknown,
    Error,
    { line: CreatedReturnLine; draft: ReturnDispositionDraft }
  >({
    mutationFn: ({ line, draft }) =>
      fetchJson(
        `/api/warehouse/returns/items/${encodeURIComponent(line.itemId)}/disposition`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            disposition: draft.disposition,
            location_id:
              draft.disposition === "available" ? draft.location.trim() : undefined,
            unit_cost: line.unitCost || undefined,
            notes: draft.notes.trim() || undefined,
            expected_status: "pending_disposition",
            occurred_at: new Date().toISOString(),
            idempotency_key: crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: (_result, variables) => {
      setCreatedLines((current) =>
        current.map((line) =>
          line.itemId === variables.line.itemId
            ? {
                ...line,
                status: "disposition_set",
                disposition: variables.draft.disposition,
              }
            : line,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["returns-pending"] });
      toast({
        title: "Disposição registrada",
        description:
          variables.draft.disposition === "available"
            ? "O item voltou para o estoque disponível com ledger auditado."
            : "O item ficou fora do estoque disponível e entrou na memória operacional.",
      });
    },
    onError: (error) => {
      toast({
        title: "Não consegui registrar a disposição",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || createReturn.isPending) return;
    createReturn.mutate();
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="overflow-hidden rounded-lg border-border/80 bg-card">
        <CardHeader className="border-b border-border/70 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <RotateCcw className="size-5" />
              </div>
              <div>
                <CardTitle>Devoluções</CardTitle>
              </div>
            </div>
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">
              produto existente obrigatório
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form className="space-y-6" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="return-source">Origem</Label>
                <Input
                  id="return-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="Loja, unidade, cliente..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="return-reference">Referência</Label>
                <Input
                  id="return-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Pedido, protocolo, romaneio..."
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Itens devolvidos</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { ...emptyReceiptLine(), location: "" },
                    ])
                  }
                >
                  Adicionar linha
                </Button>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => {
                  const issue = lineIssues[index];
                  const existing = issue?.existing;
                  const hasKey = Boolean(line.clientCode.trim() || line.sku.trim());
                  return (
                    <div
                      key={index}
                      className={cn(
                        "rounded-lg border bg-card p-3",
                        issue?.duplicateInDraft
                          ? "border-destructive/25 bg-destructive/5"
                          : existing
                            ? "border-primary/25 bg-primary/5"
                            : hasKey
                              ? "border-warning-soft-border bg-warning-soft/70"
                              : "border-border",
                      )}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="border-border bg-card">
                            Linha {index + 1}
                          </Badge>
                          {issue?.duplicateInDraft ? (
                            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                              repetido nesta devolução
                            </Badge>
                          ) : existing ? (
                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                              cadastro localizado
                            </Badge>
                          ) : hasKey ? (
                            <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                              não localizado
                            </Badge>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={`Excluir linha ${index + 1}`}
                          onClick={() => removeLine(index)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.6fr_96px_120px]">
                        <Input
                          value={line.clientCode}
                          onChange={(event) =>
                            updateLine(index, { clientCode: event.target.value })
                          }
                          placeholder="Cod. cliente"
                        />
                        <Input
                          value={line.sku}
                          onChange={(event) =>
                            updateLine(index, { sku: event.target.value })
                          }
                          placeholder="SKU interno"
                        />
                        <Input
                          value={line.product}
                          onChange={(event) =>
                            updateLine(index, { product: event.target.value })
                          }
                          placeholder="Produto"
                        />
                        <Input
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(index, { quantity: event.target.value })
                          }
                          type="number"
                          min="1"
                          placeholder="Qtde"
                        />
                        <Input
                          value={line.unitCost}
                          onChange={(event) =>
                            updateLine(index, { unitCost: event.target.value })
                          }
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Custo"
                        />
                      </div>
                      {existing ? (
                        <div className="mt-3">
                          <ProductIdentityCard product={existing} onSelect={() => applyExistingProduct(index, existing)} />
                        </div>
                      ) : hasKey ? (
                        <Alert className="mt-3 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                          <AlertTriangle className="size-4" />
                          <AlertTitle>Não crie SKU duplicado</AlertTitle>
                          <AlertDescription>
                            Devolução aceita apenas produto já cadastrado. Se for
                            mercadoria nova, registre em Estoque › Receber.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="return-notes">Observações</Label>
              <Textarea
                id="return-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Condição física, contato, foto, motivo da devolução..."
              />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm leading-6 text-muted-foreground">
                Criar devolução não altera saldo. O estoque só muda quando a
                disposição for “volta para disponível”.
              </p>
              <Button type="submit" disabled={!canCreate || createReturn.isPending}>
                {createReturn.isPending ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <RotateCcw data-icon="inline-start" />
                )}
                Registrar devolução
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/80 bg-card">
          <CardHeader>
            <CardTitle className="text-base">Disposição física</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleReturnLines.length ? (
              visibleReturnLines.map((line) => {
                const draft = dispositionDrafts[line.itemId] ?? {
                  disposition: "available",
                  location: "DEVOLUCAO",
                  notes: "",
                };
                const isDone = line.status === "disposition_set";
                const needsNotes = draft.disposition !== "available";
                const canSubmitDisposition =
                  !isDone &&
                  (draft.disposition !== "available" || Boolean(draft.location.trim())) &&
                  (!needsNotes || draft.notes.trim().length >= 6);
                return (
                  <div
                    key={line.itemId}
                    className={cn(
                      "rounded-lg border p-4",
                      isDone
                        ? "border-primary/20 bg-primary/5"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {line.productName}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {line.clientCode} · {formatUnits(line.quantity)}
                          {line.reference ? ` · ${line.reference}` : ""}
                        </div>
                      </div>
                      <Badge variant="outline" className={isDone ? "border-primary/20 bg-primary/10 text-primary" : ""}>
                        {isDone ? "definido" : "pendente"}
                      </Badge>
                    </div>

                    {!isDone ? (
                      <div className="mt-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["available", "Volta para disponível"],
                            ["quarantine", "Quarentena"],
                            ["damaged", "Avaria"],
                            ["discard", "Descarte"],
                          ].map(([value, label]) => (
                            <Button
                              key={value}
                              type="button"
                              variant={draft.disposition === value ? "default" : "outline"}
                              size="sm"
                              className="justify-start"
                              onClick={() =>
                                setDispositionDrafts((current) => ({
                                  ...current,
                                  [line.itemId]: {
                                    ...draft,
                                    disposition:
                                      value as ReturnDispositionDraft["disposition"],
                                  },
                                }))
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                        {draft.disposition === "available" ? (
                          <div className="space-y-2">
                            <Label>Endereço de retorno</Label>
                            <Input
                              value={draft.location}
                              onChange={(event) =>
                                setDispositionDrafts((current) => ({
                                  ...current,
                                  [line.itemId]: {
                                    ...draft,
                                    location: event.target.value,
                                  },
                                }))
                              }
                              placeholder="Rua / prateleira / staging"
                            />
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          <Label>
                            Nota da triagem{needsNotes ? " obrigatória" : ""}
                          </Label>
                          <Textarea
                            value={draft.notes}
                            onChange={(event) =>
                              setDispositionDrafts((current) => ({
                                ...current,
                                [line.itemId]: {
                                  ...draft,
                                  notes: event.target.value,
                                },
                              }))
                            }
                            placeholder="Foto, avaria, motivo, orientação..."
                          />
                          {needsNotes && draft.notes.trim().length < 6 ? (
                            <p className="text-xs leading-5 text-warning-soft-foreground">
                              Explique o motivo antes de deixar a peça fora do
                              disponível.
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          className="w-full"
                          disabled={
                            !canSubmitDisposition ||
                            setDisposition.isPending
                          }
                          onClick={() =>
                            setDisposition.mutate({ line, draft })
                          }
                        >
                          {setDisposition.isPending &&
                          setDisposition.variables?.line.itemId === line.itemId ? (
                            <RefreshCw data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <CheckCircle2 data-icon="inline-start" />
                          )}
                          Registrar disposição
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md border border-primary/20 bg-card px-3 py-2 text-sm text-muted-foreground">
                        Disposição registrada: {line.disposition}.
                      </div>
                    )}
                  </div>
                );
              })
            ) : pendingReturnLinesQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
              </div>
            ) : (
              <Empty className="min-h-[260px] border border-border bg-card">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RotateCcw className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">
                    Nenhuma devolução recém registrada
                  </EmptyTitle>
                  <EmptyDescription>
                    Quando houver devolução aguardando triagem, ela aparece aqui
                    mesmo após atualizar a página.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Alert className="border-primary/20 bg-primary/5">
          <Sparkles className="size-4 text-primary" />
          <AlertTitle>Agent Dute acompanha</AlertTitle>
          <AlertDescription>
            Quarentena, avaria e descarte geram atenção operacional. Retorno para
            disponível gera movimento de entrada auditado.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

