/** Receber: ficha da chegada, chegada avulsa e conferência física. */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Box,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Hash,
  ImagePlus,
  MessageSquareWarning,
  PackageOpen,
  PackageSearch,
  PlayCircle,
  RefreshCw,
  Route,
  Sparkles,
  Trash2,
  type LucideIcon,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type AnyRecord,
  type LineConfirmationMap,
  type OpsAlert,
  type TaskQueueEntry,
  type WarehouseTask,
  canAdvanceTask,
  canRegisterException,
  coerceNumber,
  coerceText,
  formatDate,
  formatDeltaUnits,
  formatNumber,
  getErrorMessage,
  getPhysicalLineRows,
  getTaskTitle,
  normalizeStatus,
  statusClass,
  statusLabel,
  fetchJson,
  TERMINAL_STATUSES,
} from "@/lib/warehouse-ops/model";
import {
  type ProductLookupItem,
  type ProductPhoto,
  productLookupFromRecord,
  uploadProductPhoto,
} from "@/features/warehouse-ops/shared";
import { customerRows } from "@/lib/active-customer";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { ProductPhotoStudio } from "./product-photo-studio";
import {
  barcodeKey,
  findProductByAnyCode,
  findProductByBarcode,
} from "@/lib/product-match";
import { ProductIdentityCard, NewProductNotice } from "./product-identity";

function DetailField({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-primary" />
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

export type ReceiptDraftLine = {
  sku: string;
  clientCode: string;
  product: string;
  category: string;
  barcode: string;
  brand: string;
  size: string;
  color: string;
  photos: ProductPhoto[];
  photoUploading: boolean;
  quantity: string;
  unitCost: string;
  location: string;
  createNew: boolean;
};

export const emptyReceiptLine = (): ReceiptDraftLine => ({
  sku: "",
  clientCode: "",
  product: "",
  category: "",
  barcode: "",
  brand: "",
  size: "",
  color: "",
  photos: [],
  photoUploading: false,
  quantity: "1",
  unitCost: "",
  location: "RECEBIMENTO",
  createNew: false,
});

export function normalizeProductKey(value: string) {
  return value.trim().toUpperCase();
}

export function mergeProductLookup(
  skus: ProductLookupItem[],
  products: ProductLookupItem[],
) {
  const productByClientCode = new Map(
    products
      .filter((product) => product.clientCode)
      .map((product) => [normalizeProductKey(product.clientCode), product]),
  );

  const mergedSkus = skus.map((sku) => {
    const product = productByClientCode.get(normalizeProductKey(sku.clientCode));
    return {
      ...sku,
      productName: sku.productName || product?.productName || sku.skuCode,
      barcode: sku.barcode || product?.barcode || "",
      brand: sku.brand || product?.brand || "",
      size: sku.size || product?.size || "",
      color: sku.color || product?.color || "",
      photoUrl: sku.photoUrl || product?.photoUrl || "",
      unitCost: sku.unitCost || product?.unitCost || 0,
      source: { ...(product?.source ?? {}), ...sku.source },
    };
  });
  const skuClientCodes = new Set(
    mergedSkus.map((sku) => normalizeProductKey(sku.clientCode)),
  );
  return [
    ...mergedSkus,
    ...products.filter(
      (product) =>
        product.clientCode &&
        !skuClientCodes.has(normalizeProductKey(product.clientCode)),
    ),
  ];
}

/**
 * Cadastro existente da linha: vale qualquer código que a pessoa tenha na mão
 * (o do cliente, o SKU da etiqueta ou o de barras), e o de barras sozinho
 * também acha (lib/product-match.ts).
 */
export function findExistingProduct(
  line: ReceiptDraftLine,
  products: ProductLookupItem[],
) {
  return (
    findProductByAnyCode(products, line.sku)?.product ??
    findProductByAnyCode(products, line.clientCode)?.product ??
    findProductByBarcode(products, line.barcode)
  );
}

export function normalizeApiRows(payload: unknown): AnyRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is AnyRecord => Boolean(item) && typeof item === "object",
    );
  }
  if (payload && typeof payload === "object") {
    const record = payload as AnyRecord;
    const candidates = [record.items, record.data, record.products, record.rows];
    const rows = candidates.find(Array.isArray);
    if (Array.isArray(rows)) {
      return rows.filter(
        (item): item is AnyRecord => Boolean(item) && typeof item === "object",
      );
    }
  }
  return [];
}

export function receiptIdFromTask(task: WarehouseTask) {
  return task.reference || task.id.replace(/^receiving:/, "");
}

export function ReceivingTaskDetailCard({
  entry,
  alerts,
  advancingTaskId,
  registeringExceptionId,
  onAdvance,
  onOpenException,
}: {
  entry?: TaskQueueEntry;
  alerts: OpsAlert[];
  advancingTaskId?: string;
  registeringExceptionId?: string;
  onAdvance: (id: string) => void;
  onOpenException: (task: WarehouseTask, suggestedNote?: string) => void;
}) {
  if (!entry) {
    return (
      <Empty className="min-h-[520px] rounded-lg border border-dashed border-border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardCheck className="size-5" />
          </EmptyMedia>
          <EmptyTitle className="text-base">Pronto para receber</EmptyTitle>
          <EmptyDescription>
            Registre uma chegada avulsa ou aguarde uma chegada prevista do portal.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const { task, queue } = entry;
  const canAdvance = canAdvanceTask(task);
  const canRegister = canRegisterException(task);
  const taskAlerts = alerts.filter((alert) => alert.task_id === task.id);

  return (
    <Card className="min-w-0 overflow-hidden border-border bg-card">
      <CardHeader className="border-b border-border/60 bg-card p-5">
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                {queue.label}
              </Badge>
              <Badge variant="outline" className={statusClass(task.status)}>
                {statusLabel(task.status)}
              </Badge>
              {task.blocked_reason ? (
                <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                  bloqueada
                </Badge>
              ) : null}
            </div>
            <CardTitle className="mt-3 text-xl">{getTaskTitle(task)}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            {canRegister ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenException(task)}
                disabled={registeringExceptionId === task.id}
              >
                {registeringExceptionId === task.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <MessageSquareWarning data-icon="inline-start" />
                )}
                Divergência
              </Button>
            ) : null}
            {canAdvance ? (
              <Button
                type="button"
                onClick={() => onAdvance(task.id)}
                disabled={advancingTaskId === task.id}
              >
                {advancingTaskId === task.id ? (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                ) : (
                  <CheckCircle2 data-icon="inline-start" />
                )}
                Concluir entrada
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <DetailField icon={Hash} label="Referência" value={task.reference || task.id} />
          <DetailField
            icon={Box}
            label="Itens"
            value={`${formatNumber(task.items?.length ?? 1)} linha(s)`}
          />
          <DetailField
            icon={ClipboardCheck}
            label="Quantidade"
            value={
              typeof task.quantity === "number"
                ? `${formatNumber(task.quantity)} un.`
                : "Qtde aberta"
            }
          />
          <DetailField icon={Clock3} label="Prazo" value={formatDate(task.due_at)} />
        </div>

        {task.blocked_reason ? (
          <Alert className="border-destructive/20 bg-destructive/10 text-destructive">
            <Ban className="size-4" />
            <AlertTitle>Recebimento bloqueado</AlertTitle>
            <AlertDescription>{task.blocked_reason}</AlertDescription>
          </Alert>
        ) : null}

        <ReceivingConferenceSection task={task} />

        {taskAlerts.length > 0 ? (
          <Alert className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
            <Sparkles className="size-4" />
            <AlertTitle>Agent Dute observou este recebimento</AlertTitle>
            <AlertDescription>{taskAlerts[0]?.message || taskAlerts[0]?.title}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Route className="size-3.5 text-primary" />
            Próximo passo
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {task.next_action ||
              "Salvar conferência física e concluir entrada para liberar o saldo ao cliente."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function UnplannedReceiptDialog({
  open,
  isPending,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  // A chegada é do cliente ativo: só os produtos dele aparecem na busca.
  const { code: customerCode, active: activeCustomer } = useActiveCustomer();
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptDraftLine[]>([emptyReceiptLine()]);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const lookupQuery = useQuery({
    queryKey: ["receiving-product-lookup", customerCode],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const [skusPayload, productsPayload] = await Promise.all([
        fetchJson<unknown>("/api/skus"),
        fetchJson<unknown>("/api/products"),
      ]);
      const skus = customerRows(normalizeApiRows(skusPayload), customerCode).map(productLookupFromRecord);
      const products = customerRows(normalizeApiRows(productsPayload), customerCode).map(productLookupFromRecord);
      return mergeProductLookup(skus, products);
    },
  });
  const productLookup = lookupQuery.data ?? [];

  function updateLine(index: number, patch: Partial<ReceiptDraftLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function applyExistingProduct(index: number, product: ProductLookupItem) {
    updateLine(index, {
      sku: product.skuCode,
      clientCode: product.clientCode,
      product: product.productName,
      unitCost: product.unitCost > 0 ? String(product.unitCost) : "",
      createNew: false,
    });
  }

  function removeLine(index: number) {
    setActiveLineIndex((current) =>
      current > index ? current - 1 : Math.min(current, Math.max(0, lines.length - 2)),
    );
    setLines((current) =>
      current.length === 1
        ? [emptyReceiptLine()]
        : current.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  async function addPhotos(index: number, files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 4);
    if (!selected.length) return;
    const line = lines[index];
    const clientItemCode =
      line?.clientCode.trim() || line?.sku.trim() || `rascunho-${index + 1}`;
    updateLine(index, { photoUploading: true });
    try {
      const uploaded = await Promise.all(
        selected.map((file) => uploadProductPhoto(file, clientItemCode, customerCode)),
      );
      setLines((current) =>
        current.map((currentLine, lineIndex) =>
          lineIndex === index
            ? {
                ...currentLine,
                photos: [...currentLine.photos, ...uploaded].slice(0, 8),
                photoUploading: false,
              }
            : currentLine,
        ),
      );
    } catch (error) {
      updateLine(index, { photoUploading: false });
      toast({
        title: "Não consegui anexar a foto",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  // Duas linhas do mesmo produto, mesmo que por códigos diferentes (o do
  // cliente numa, o de barras na outra), são uma linha só.
  function lineIdentity(line: ReceiptDraftLine) {
    const existing = findExistingProduct(line, productLookup);
    return existing
      ? `cadastro:${existing.id}`
      : normalizeProductKey(line.clientCode || line.sku);
  }

  function sameProduct(line: ReceiptDraftLine, other: ReceiptDraftLine) {
    if (lineIdentity(line) === lineIdentity(other)) return true;
    const barcode = barcodeKey(line.barcode);
    return Boolean(barcode) && barcode === barcodeKey(other.barcode);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasInvalidLine = lines.some((line, index) => {
      const currentKey = normalizeProductKey(line.clientCode || line.sku);
      const quantity = Number(line.quantity);
      const duplicateInDraft =
        currentKey &&
        lines.some(
          (otherLine, otherIndex) =>
            otherIndex !== index && sameProduct(line, otherLine),
        );
      const existing = findExistingProduct(line, productLookup);
      return (
        !currentKey ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        duplicateInDraft ||
        (!existing && line.createNew && !line.product.trim()) ||
        (!existing &&
          line.createNew &&
          (!line.category.trim() ||
            !Number.isFinite(Number(line.unitCost)) ||
            Number(line.unitCost) <= 0 ||
            line.photos.length === 0 ||
            line.photoUploading)) ||
        (!existing && !line.createNew) ||
        (existing && line.createNew)
      );
    });

    if (hasInvalidLine) return;

    const items = lines
      .map((line) => {
        const existing = findExistingProduct(line, productLookup);
        return {
          // Produto novo não leva SKU: as Functions geram na sigla do cliente.
          sku_code: existing?.skuCode || undefined,
          client_item_code: existing?.clientCode || line.clientCode.trim(),
          product_name: existing?.productName || line.product.trim(),
          category: line.category.trim() || undefined,
          barcode: line.barcode.trim() || undefined,
          brand: line.brand.trim() || undefined,
          size: line.size.trim() || undefined,
          color: line.color.trim() || undefined,
          photo_urls: line.photos.map((photo) => photo.fileUrl),
          photo_storage_paths: line.photos.map((photo) => photo.storagePath),
          quantity: Number(line.quantity),
          unit_cost: line.unitCost.trim()
            ? Number(line.unitCost)
            : existing?.unitCost || undefined,
          location_id: line.location.trim() || "RECEBIMENTO",
          product_registration: existing ? "existing" : "new",
        };
      })
      .filter((line) => line.product_name && line.quantity > 0);

    if (!items.length) return;

    onCreate({
      customer_code: customerCode,
      supplier: supplier.trim() || undefined,
      invoice_number: invoiceNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      priority: "normal",
      received_at: new Date().toISOString(),
      idempotency_key: crypto.randomUUID(),
      items,
    });
  }

  const lineIssues = lines.map((line, index) => {
    const currentKey = normalizeProductKey(line.clientCode || line.sku);
    const quantity = Number(line.quantity);
    const duplicateInDraft = Boolean(
      currentKey &&
        lines.some(
          (otherLine, otherIndex) =>
            otherIndex !== index && sameProduct(line, otherLine),
        ),
    );
    const existing = findExistingProduct(line, productLookup);
    return {
      duplicateInDraft,
      existing,
      hasCode: Boolean(currentKey),
      invalidQuantity: !Number.isFinite(quantity) || quantity <= 0,
      missingProduct: !existing && line.createNew && !line.product.trim(),
      missingNewProductData:
        !existing &&
        line.createNew &&
        (!line.category.trim() ||
          !Number.isFinite(Number(line.unitCost)) ||
          Number(line.unitCost) <= 0 ||
          line.photos.length === 0),
      photoUploading: line.photoUploading,
    };
  });
  const canSubmit =
    lines.some((line) => line.clientCode.trim() || line.sku.trim()) &&
    lineIssues.every(
      (issue, index) =>
        issue.hasCode &&
        !issue.invalidQuantity &&
        !issue.missingProduct &&
        !issue.missingNewProductData &&
        !issue.photoUploading &&
        !issue.duplicateInDraft &&
        (Boolean(issue.existing) || lines[index]?.createNew) &&
        !(issue.existing && lines[index]?.createNew),
    );
  const receiptDraftSummary = lines.reduce(
    (acc, line, index) => {
      const quantity = Number(line.quantity);
      if (Number.isFinite(quantity) && quantity > 0) acc.quantity += quantity;
      if (lineIssues[index]?.existing) acc.existing += 1;
      if (line.createNew && !lineIssues[index]?.existing) acc.newProducts += 1;
      return acc;
    },
    { quantity: 0, existing: 0, newProducts: 0 },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Registrar chegada avulsa · {activeCustomer.name}</DialogTitle>
          <DialogDescription>
            Use quando o fornecedor entregou sem aviso da cliente. Isso cria a tarefa de conferência, não lança estoque ainda.
            A chegada entra para {activeCustomer.name}, o cliente ativo no menu.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Input
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="Nome do fornecedor"
              />
            </div>
            <div className="space-y-2">
              <Label>NF / pedido</Label>
              <Input
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                placeholder="Documento recebido"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Itens recebidos</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  setActiveLineIndex(lines.length);
                  setLines((current) => [...current, emptyReceiptLine()]);
                }}
              >
                Adicionar linha
              </Button>
            </div>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-2" aria-label="Linhas da chegada">
                {lines.map((line, index) => {
                  const issue = lineIssues[index];
                  const existing = issue?.existing;
                  const status = issue?.duplicateInDraft
                    ? "Produto repetido"
                    : issue?.invalidQuantity
                      ? "Quantidade inválida"
                      : issue?.missingProduct || issue?.missingNewProductData
                        ? "Cadastro incompleto"
                        : existing
                          ? "Cadastro encontrado"
                          : line.createNew ? "Produto novo confirmado" : "Identificação pendente";
                  return (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={activeLineIndex === index}
                      aria-controls="receipt-product-editor"
                      onClick={() => setActiveLineIndex(index)}
                      className={cn(
                        "w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        activeLineIndex === index ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Linha {index + 1}</span>
                        <span>{status}</span>
                      </div>
                      <p className="mt-2 break-words text-sm font-semibold text-foreground">
                        {existing?.productName || line.product || "Identificar produto"}
                      </p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        Cód. cliente: {existing?.clientCode || line.clientCode || "Não informado"}
                      </p>
                      {existing?.skuCode ? <p className="mt-1 break-words text-xs text-muted-foreground">SKU: {existing.skuCode}</p> : null}
                      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-foreground">
                        <span>{[existing?.size || line.size, existing?.color || line.color].filter(Boolean).join(" · ")}</span>
                        <span>{line.quantity || "0"} un.</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <section id="receipt-product-editor" aria-labelledby="receipt-editor-heading" className="min-w-0 space-y-3">
                <h3 id="receipt-editor-heading" className="text-base font-semibold text-foreground">Identificar produto · Linha {activeLineIndex + 1}</h3>
                {lines.map((line, index) => {
                  if (index !== activeLineIndex) return null;
                  const issue = lineIssues[index];
                  const existing = issue?.existing;
                  const mustCreate =
                    !existing && Boolean(line.clientCode.trim() || line.sku.trim());
                  return (
                    <div
                      key={index}
                      className={cn(
                        "rounded-lg border bg-card p-3",
                        issue?.duplicateInDraft || (existing && line.createNew)
                          ? "border-destructive/25 bg-destructive/5"
                          : existing
                            ? "border-primary/25 bg-primary/5"
                            : mustCreate && !line.createNew
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
                              produto repetido nesta NF
                            </Badge>
                          ) : issue?.invalidQuantity ? (
                            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                              quantidade inválida
                            </Badge>
                          ) : issue?.missingProduct ? (
                            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                              informe o produto
                            </Badge>
                          ) : issue?.missingNewProductData ? (
                            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                              complete cadastro e foto
                            </Badge>
                          ) : existing ? (
                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                              produto existente
                            </Badge>
                          ) : line.createNew ? (
                            <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                              novo cadastro
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
                              localizar ou cadastrar
                            </Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={`Excluir linha ${index + 1}`}
                          disabled={isPending || lines.some((item) => item.photoUploading)}
                          onClick={() => removeLine(index)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>Cód. cliente, SKU ou barras</span>
                          <Input
                            value={line.clientCode}
                            onChange={(event) =>
                              updateLine(index, {
                                clientCode: event.target.value,
                                sku: "",
                                createNew: false,
                              })
                            }
                            placeholder="Cód. cliente, SKU ou barras"
                            aria-label={`Código do produto da linha ${index + 1}`}
                          />
                        </label>
                        {/* O SKU não se digita: é o do cadastro achado ou o gerado ao salvar. */}
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>SKU</span>
                          <Input
                            value={existing?.skuCode ?? ""}
                            readOnly
                            tabIndex={-1}
                            className="bg-muted"
                            placeholder={line.createNew ? "Gerado ao salvar" : "SKU"}
                            aria-label={`SKU da linha ${index + 1}`}
                          />
                        </label>
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>Produto</span>
                          <Input
                            value={line.product}
                            onChange={(event) => updateLine(index, { product: event.target.value })}
                            placeholder="Produto"
                          />
                        </label>
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>Quantidade</span>
                          <Input
                            value={line.quantity}
                            onChange={(event) => updateLine(index, { quantity: event.target.value })}
                            type="number"
                            min="1"
                            placeholder="Qtde"
                          />
                        </label>
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>Custo unitário</span>
                          <Input
                            value={line.unitCost}
                            onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Custo"
                          />
                        </label>
                        <label className="space-y-1.5 text-sm text-foreground">
                          <span>Local</span>
                          <Input
                            value={line.location}
                            onChange={(event) => updateLine(index, { location: event.target.value })}
                            placeholder="Local"
                          />
                        </label>
                      </div>

                      {existing ? (
                        <div className="mt-3">
                          <ProductIdentityCard product={existing} onSelect={() => applyExistingProduct(index, existing)} />
                        </div>
                      ) : mustCreate ? (
                        <div className="mt-3">
                          <NewProductNotice
                            confirmed={line.createNew}
                            note="SKU gerado ao salvar o novo cadastro."
                            onToggle={() => updateLine(index, { createNew: !line.createNew })}
                          />
                        </div>
                      ) : null}

                      {line.createNew && !existing ? (
                        <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              Cadastro do novo produto
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Categoria, custo e ao menos uma foto são obrigatórios.
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1.5 text-sm text-foreground">
                              <span>Categoria *</span>
                              <Input
                                value={line.category}
                                onChange={(event) =>
                                  updateLine(index, { category: event.target.value })
                                }
                                placeholder="Categoria *"
                              />
                            </label>
                            <label className="space-y-1.5 text-sm text-foreground">
                              <span>Marca</span>
                              <Input
                                value={line.brand}
                                onChange={(event) =>
                                  updateLine(index, { brand: event.target.value })
                                }
                                placeholder="Marca"
                              />
                            </label>
                            <label className="space-y-1.5 text-sm text-foreground">
                              <span>Tamanho</span>
                              <Input
                                value={line.size}
                                onChange={(event) =>
                                  updateLine(index, { size: event.target.value })
                                }
                                placeholder="Tamanho"
                              />
                            </label>
                            <label className="space-y-1.5 text-sm text-foreground">
                              <span>Cor</span>
                              <Input
                                value={line.color}
                                onChange={(event) =>
                                  updateLine(index, { color: event.target.value })
                                }
                                placeholder="Cor"
                              />
                            </label>
                            <label className="space-y-1.5 text-sm text-foreground">
                              <span>Código de barras</span>
                              <Input
                                value={line.barcode}
                                onChange={(event) =>
                                  updateLine(index, { barcode: event.target.value })
                                }
                                placeholder="Código de barras"
                              />
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <label
                              htmlFor={`receipt-photo-${index}`}
                              className={cn(
                                "inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted",
                                line.photoUploading && "pointer-events-none opacity-60",
                              )}
                            >
                              {line.photoUploading ? (
                                <RefreshCw className="size-4 animate-spin" />
                              ) : (
                                <Camera className="size-4" />
                              )}
                              {line.photoUploading ? "Enviando..." : "Fotografar ou anexar"}
                            </label>
                            <input
                              id={`receipt-photo-${index}`}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              className="sr-only"
                              onChange={(event) => {
                                void addPhotos(index, event.target.files);
                                event.currentTarget.value = "";
                              }}
                            />
                            <span className="text-xs text-muted-foreground">
                              {line.photos.length}/8 foto(s)
                            </span>
                          </div>
                          {line.photos.length ? (
                            <div className="flex flex-wrap gap-2">
                              {line.photos.map((photo, photoIndex) => (
                                <div
                                  key={photo.storagePath}
                                  className="group relative size-20 overflow-hidden rounded-md border border-border bg-muted"
                                >
                                  <img
                                    src={photo.fileUrl}
                                    alt={`Foto ${photoIndex + 1} de ${line.product || "produto"}`}
                                    className="size-full object-cover"
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-card text-foreground shadow-sm"
                                    aria-label={`Remover foto ${photoIndex + 1}`}
                                    onClick={() =>
                                      updateLine(index, {
                                        photos: line.photos.filter(
                                          (_, currentIndex) => currentIndex !== photoIndex,
                                        ),
                                      })
                                    }
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {line.photos.length ? <ProductPhotoStudio key={`${customerCode}:${index}:${line.clientCode}`} photos={line.photos} customerCode={customerCode} productName={line.product} category={line.category} disabled={isPending || line.photoUploading}
                            onApprove={(generated, primaryUrl) => setLines((current) => current.map((entry, entryIndex) => {
                              if (entryIndex !== index) return entry;
                              const merged = [...entry.photos, ...generated];
                              return { ...entry, photos: primaryUrl ? [...merged.filter((photo) => photo.fileUrl === primaryUrl), ...merged.filter((photo) => photo.fileUrl !== primaryUrl)] : merged };
                            }))} /> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Volumes, contato, avaria aparente, falta de NF..."
            />
          </div>

          <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Peças esperadas</div>
              <div className="mt-1 font-semibold text-foreground">
                {formatNumber(receiptDraftSummary.quantity)} un.
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Produtos existentes</div>
              <div className="mt-1 font-semibold text-foreground">
                {formatNumber(receiptDraftSummary.existing)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Novos cadastros</div>
              <div className="mt-1 font-semibold text-foreground">
                {formatNumber(receiptDraftSummary.newProducts)}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !canSubmit}>
              {isPending ? (
                <RefreshCw data-icon="inline-start" className="animate-spin" />
              ) : (
                <PackageOpen data-icon="inline-start" />
              )}
              Criar conferência
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function sourceText(source: AnyRecord, ...keys: string[]) {
  return coerceText(...keys.map((key) => source[key]));
}

export function sourcePhotos(source: AnyRecord): ProductPhoto[] {
  const urls = Array.isArray(source.photo_urls)
    ? source.photo_urls.filter((value): value is string => typeof value === "string")
    : [];
  const paths = Array.isArray(source.photo_storage_paths)
    ? source.photo_storage_paths.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return urls.map((fileUrl, index) => ({
    fileName: `foto-${index + 1}`,
    fileUrl,
    storagePath: photoPathFromUrl(fileUrl) || paths[index] || `catalog:${fileUrl}`,
  }));
}

/** URL is authoritative when legacy records have missing or reordered paths. */
function photoPathFromUrl(fileUrl: string) {
  try {
    const url = new URL(fileUrl);
    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
      return match ? decodeURIComponent(match[1]!) : "";
    }
    if (url.hostname === "storage.googleapis.com") {
      return decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
    }
  } catch { /* Keep the historical fallback for non-Storage images. */ }
  return "";
}


export function ReceivingConferenceSection({
  task,
}: {
  task: WarehouseTask;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [lines, setLines] = useState(() =>
    (task.items ?? []).map((item) => ({
      id: item.id || "",
      receivedQty:
        typeof item.received_qty === "number" &&
        ["ok", "short", "over", "divergent"].includes(
          normalizeStatus(item.conference_status),
        )
          ? String(item.received_qty)
          : "",
      location: item.location || "RECEBIMENTO",
      unitCost:
        typeof item.unit_cost === "number" && item.unit_cost > 0
          ? String(item.unit_cost)
          : "",
      notes: "",
      code: "",
    })),
  );
  useEffect(() => {
    setLines(
      (task.items ?? []).map((item) => ({
        id: item.id || "",
        receivedQty:
          typeof item.received_qty === "number" &&
          ["ok", "short", "over", "divergent"].includes(
            normalizeStatus(item.conference_status),
          )
            ? String(item.received_qty)
            : "",
        location: item.location || "RECEBIMENTO",
        unitCost:
          typeof item.unit_cost === "number" && item.unit_cost > 0
            ? String(item.unit_cost)
            : "",
        notes: "",
        code: "",
      })),
    );
  }, [task.id, task.items]);

  const conferenceRows = (task.items ?? []).map((item, index) => {
    const line = lines[index];
    const expected = coerceNumber(item.expected_quantity ?? item.quantity);
    const hasPhysicalCount = Boolean(line?.receivedQty.trim());
    const received = hasPhysicalCount ? Number(line?.receivedQty) : Number.NaN;
    const validReceived =
      hasPhysicalCount && Number.isFinite(received) && received >= 0;
    const difference = validReceived ? received - expected : undefined;
    // Aviso do cliente sem código: o conferente lê a etiqueta e informa.
    const needsCode = !(item.sku_code || item.sku || item.client_item_code);
    return { item, line, expected, received, validReceived, difference, needsCode };
  });
  const summary = conferenceRows.reduce(
    (acc, row) => {
      acc.expected += row.expected;
      if (row.validReceived) acc.received += row.received;
      if (typeof row.difference === "number") {
        acc.difference += row.difference;
        if (row.difference !== 0) acc.divergences += 1;
      } else {
        acc.invalid += 1;
      }
      return acc;
    },
    { expected: 0, received: 0, difference: 0, divergences: 0, invalid: 0 },
  );
  const hasInvalidLine =
    !conferenceRows.length ||
    summary.invalid > 0 ||
    conferenceRows.some((row) => !row.line?.id || (row.needsCode && !row.line?.code.trim()));
  const pendingCodes = conferenceRows.filter((row) => row.needsCode && !row.line?.code.trim()).length;
  const hasDivergence = summary.divergences > 0;

  function setLine(index: number, patch: Partial<(typeof lines)[number]>) {
    setLines((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function conferenceBadge(difference?: number) {
    if (difference === undefined) {
      return (
        <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
          revisar
        </Badge>
      );
    }
    if (difference === 0) {
      return (
        <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
          OK físico
        </Badge>
      );
    }
    if (difference < 0) {
      return (
        <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
          falta {formatNumber(Math.abs(difference))}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
        sobra {formatNumber(difference)}
      </Badge>
    );
  }

  const saveConference = useMutation<unknown, Error>({
    mutationFn: () =>
      fetchJson(`/api/warehouse/receipts/${encodeURIComponent(receiptIdFromTask(task))}/conference`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_status: normalizeStatus(task.status),
          idempotency_key: crypto.randomUUID(),
          lines: lines
            .filter((line) => line.id)
            .map((line) => ({
              inbound_item_id: line.id,
              received_qty: Number(line.receivedQty),
              location_id: line.location,
              unit_cost: line.unitCost.trim() ? Number(line.unitCost) : undefined,
              notes: line.notes || undefined,
              client_item_code: line.code.trim() || undefined,
            })),
        }),
      }),
    onSuccess: () => {
      toast({
        title: "Conferência salva",
        description: hasDivergence
          ? "Divergência registrada. Revise antes de concluir a entrada."
          : "Agora a entrada pode ser concluída para atualizar o estoque.",
      });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Não foi possível salvar a conferência",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  if (!task.items?.length) return null;

  return (
    <div className="@container rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Conferência de recebimento
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Salve a quantidade física contada antes de concluir a entrada no estoque.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => saveConference.mutate()}
            disabled={saveConference.isPending || hasInvalidLine}
          >
            {saveConference.isPending ? (
              <RefreshCw data-icon="inline-start" className="animate-spin" />
            ) : (
              <ClipboardCheck data-icon="inline-start" />
            )}
            Salvar conferência
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Esperado</div>
          <div className="mt-1 text-lg font-semibold">{formatNumber(summary.expected)} un.</div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Físico contado</div>
          <div className="mt-1 text-lg font-semibold">{formatNumber(summary.received)} un.</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatNumber(conferenceRows.length - summary.invalid)} de {formatNumber(conferenceRows.length)} linha(s)
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Diferença</div>
          <div className={cn(
            "mt-1 text-lg font-semibold",
            summary.difference === 0 ? "text-foreground" : "text-warning-soft-foreground",
          )}>
            {formatDeltaUnits(summary.difference)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">Divergências</div>
          <div className={cn(
            "mt-1 text-lg font-semibold",
            hasDivergence ? "text-warning-soft-foreground" : "text-foreground",
          )}>
            {formatNumber(summary.divergences)}
          </div>
        </div>
      </div>

      {pendingCodes ? (
        <Alert className="mt-4 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
          <AlertTriangle className="size-4" />
          <AlertTitle>Código a definir</AlertTitle>
          <AlertDescription>
            {pendingCodes === 1 ? "1 linha foi avisada" : `${pendingCodes} linhas foram avisadas`} pelo cliente sem o código. Leia a etiqueta e informe o código: se já existir no cadastro, liga ao item; senão, entra como produto novo.
          </AlertDescription>
        </Alert>
      ) : null}

      {hasDivergence ? (
        <Alert className="mt-4 border-warning-soft-border bg-warning-soft text-warning-soft-foreground">
          <AlertTriangle className="size-4" />
          <AlertTitle>Divergência física detectada</AlertTitle>
          <AlertDescription>
            O estoque será liberado com a quantidade física salva. Registre exceção quando precisar justificar falta, sobra ou avaria.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 space-y-3">
        {conferenceRows.map(({ item, line, expected, difference, needsCode }, index) => {
          return (
            <div
              key={item.id || index}
              className={cn(
                "rounded-lg border bg-card p-3",
                difference === undefined
                  ? "border-destructive/20"
                  : difference === 0
                    ? "border-border"
                    : "border-warning-soft-border bg-warning-soft/45",
              )}
            >
              <div className="grid gap-3 @xl:grid-cols-[minmax(0,1.35fr)_104px_120px_120px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {item.product_name || item.name || item.description || item.sku || item.sku_code}
                    </div>
                    {conferenceBadge(difference)}
                  </div>
                  {needsCode ? (
                    <div className="mt-2 space-y-1">
                      <Label className="text-xs text-warning-soft-foreground">Código da etiqueta · esperado {formatNumber(Number(expected))} un.</Label>
                      <Input
                        value={line?.code ?? ""}
                        onChange={(event) => setLine(index, { code: event.target.value })}
                        placeholder="Código a definir"
                        aria-label="Código da etiqueta"
                        className={cn(!line?.code.trim() && "border-warning")}
                      />
                      {item.notes ? <div className="text-xs text-muted-foreground">{item.notes}</div> : null}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.client_item_code || item.sku || item.sku_code} · esperado {formatNumber(Number(expected))} un.
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 @xl:contents">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Físico</Label>
                  <Input
                    value={line?.receivedQty ?? ""}
                    onChange={(event) => setLine(index, { receivedQty: event.target.value })}
                    type="number"
                    min="0"
                    aria-label="Quantidade conferida"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Local</Label>
                  <Input
                    value={line?.location ?? ""}
                    onChange={(event) => setLine(index, { location: event.target.value })}
                    placeholder="Local"
                    aria-label="Local de recebimento"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Custo</Label>
                  <Input
                    value={line?.unitCost ?? ""}
                    onChange={(event) => setLine(index, { unitCost: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Custo"
                    aria-label="Custo unitário"
                  />
                </div>
                </div>
              </div>
              <Textarea
                value={line?.notes ?? ""}
                onChange={(event) => setLine(index, { notes: event.target.value })}
                className="mt-3 min-h-16"
                placeholder="Observação da conferência, avaria, falta ou sobra..."
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

