import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  PackageCheck,
  PackagePlus,
  Paperclip,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  clientOverviewQueryKey,
  createClientRequest,
  firstText,
  formatMoney,
  formatNumber,
  getInventoryItems,
  inventoryItemClientCode,
  inventoryItemName,
  inventoryItemSku,
  type ClientOverview,
  type ClientRequestAttachment,
  type CreateClientRequestItem,
  type InventoryItem,
} from "./shared";

type FormStep = "delivery" | "items" | "review";
type RegistrationState = "existing" | "new" | "unknown";

type ReceiptLine = {
  id: string;
  clientCode: string;
  productName: string;
  quantity: string;
  registration: RegistrationState;
  category: string;
  barcode: string;
  brand: string;
  size: string;
  color: string;
  unitCost: string;
  notes: string;
};

type UploadTarget = ClientRequestAttachment & {
  upload_url: string;
  upload_headers?: Record<string, string>;
};

type ClientOperationalRequestFormProps = {
  overview: ClientOverview;
  onBack?: () => void;
  onCreated?: () => void;
};

const steps: Array<{ id: FormStep; label: string }> = [
  { id: "delivery", label: "Entrega" },
  { id: "items", label: "Itens" },
  { id: "review", label: "Revisão" },
];

export function ClientOperationalRequestForm({
  overview,
  onBack,
  onCreated,
}: ClientOperationalRequestFormProps) {
  const [step, setStep] = useState<FormStep>("delivery");
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()]);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const formId = useId();
  const draftId = useMemo(() => localId("receipt-draft"), []);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const customerCode = firstText(overview.customer?.code);
  const inventoryItems = useMemo(
    () =>
      getInventoryItems(overview)
        .filter((item) => inventoryItemSku(item) !== "SKU")
        .sort((left, right) =>
          inventoryItemClientCode(left).localeCompare(
            inventoryItemClientCode(right),
            "pt-BR",
          ),
        ),
    [overview],
  );
  const duplicateLineIds = useMemo(() => findDuplicateLines(lines), [lines]);
  const totalQuantity = lines.reduce(
    (sum, line) => sum + positiveNumber(line.quantity),
    0,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerCode) throw new Error("Conta do cliente não identificada.");

      const attachments: ClientRequestAttachment[] = [];
      for (const [index, file] of files.entries()) {
        setUploadingLabel(`Enviando ${index + 1} de ${files.length}: ${file.name}`);
        attachments.push(
          await uploadReceiptAttachment(file, customerCode, draftId),
        );
      }

      setUploadingLabel("Registrando a previsão para a Dutelog");
      return createClientRequest({
        type: "recebimento",
        priority: "normal",
        title: `Entrega de ${supplier.trim()}`,
        description: notes.trim() || "Entrega de fornecedor avisada pelo cliente.",
        destination: "Recebimento Dutelog",
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        supplier: supplier.trim(),
        invoice_number: invoiceNumber.trim() || undefined,
        attachments,
        items: lines.map((line) => toRequestItem(line, inventoryItems)),
      });
    },
    onSuccess: () => {
      setUploadingLabel(null);
      toast({
        title: "Entrega avisada à Dutelog",
        description:
          "A equipe fará a conferência física. O saldo do estoque ainda não foi alterado.",
      });
      void queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
      onCreated?.();
    },
    onError: (error) => {
      setUploadingLabel(null);
      toast({
        title: "Não foi possível enviar o aviso",
        description:
          error instanceof Error
            ? error.message
            : "Revise as informações e tente novamente.",
        variant: "destructive",
      });
    },
  });

  function updateLine(id: string, patch: Partial<ReceiptLine>) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        const match = findCatalogMatch(
          inventoryItems,
          next.clientCode,
          next.productName,
        );

        if (!match) {
          return {
            ...next,
            registration:
              line.registration === "existing" ? "unknown" : next.registration,
          };
        }

        return {
          ...next,
          clientCode: inventoryItemClientCode(match),
          productName: inventoryItemName(match),
          registration: "existing",
        };
      }),
    );
  }

  function validateDelivery() {
    if (!supplier.trim()) {
      toast({
        title: "Informe o fornecedor",
        description: "A equipe precisa identificar a origem da entrega.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  function validateItems() {
    if (duplicateLineIds.size > 0) {
      toast({
        title: "Há produtos repetidos",
        description:
          "Use uma única linha para cada código ou produto e some as quantidades.",
        variant: "destructive",
      });
      return false;
    }

    const invalidIndex = lines.findIndex(
      (line) =>
        !line.clientCode.trim() ||
        !line.productName.trim() ||
        positiveNumber(line.quantity) <= 0,
    );
    if (invalidIndex >= 0) {
      toast({
        title: `Revise o item ${invalidIndex + 1}`,
        description: "Informe código do cliente, produto e quantidade.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  }

  function goNext() {
    if (step === "delivery") {
      if (validateDelivery()) setStep("items");
      return;
    }
    if (step === "items" && validateItems()) setStep("review");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "review") {
      goNext();
      return;
    }
    if (!validateDelivery() || !validateItems()) return;
    mutation.mutate();
  }

  function selectFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    const accepted = [...nextFiles].filter(isAcceptedAttachment);
    const combined = [...files, ...accepted].slice(0, 8);
    setFiles(combined);

    if (accepted.length !== nextFiles.length || combined.length < files.length + accepted.length) {
      toast({
        title: "Alguns arquivos não foram adicionados",
        description: "Use PDF, JPG, PNG ou WEBP, com até 30 MB por arquivo e no máximo 8 anexos.",
        variant: "destructive",
      });
    }
  }

  return (
    <section className="rounded-[24px] border border-border bg-white/68 shadow-[0_18px_60px_rgba(15,23,42,.05)] backdrop-blur-[40px]">
      <div className="border-b border-border/70 px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Avisar nova entrega
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Crie uma previsão para a conferência da Dutelog. Este fluxo não altera o estoque.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-white/55 p-1">
            {steps.map((item, index) => {
              const activeIndex = steps.findIndex((entry) => entry.id === step);
              const isActive = item.id === step;
              const isComplete = index < activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (index <= activeIndex) setStep(item.id);
                  }}
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium transition",
                    isActive
                      ? "bg-white text-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)]"
                      : isComplete
                        ? "cursor-pointer text-primary"
                        : "cursor-default text-muted-foreground",
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isComplete ? <Check className="h-3.5 w-3.5" /> : null}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="space-y-6 px-5 py-6 md:px-6">
          {step === "delivery" ? (
            <DeliveryStep
              formId={formId}
              supplier={supplier}
              invoiceNumber={invoiceNumber}
              dueAt={dueAt}
              notes={notes}
              files={files}
              onSupplierChange={setSupplier}
              onInvoiceNumberChange={setInvoiceNumber}
              onDueAtChange={setDueAt}
              onNotesChange={setNotes}
              onFilesChange={selectFiles}
              onRemoveFile={(index) =>
                setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ) : null}

          {step === "items" ? (
            <ItemsStep
              formId={formId}
              lines={lines}
              inventoryItems={inventoryItems}
              duplicateLineIds={duplicateLineIds}
              onUpdate={updateLine}
              onAdd={() => setLines((current) => [...current, emptyLine()])}
              onRemove={(id) =>
                setLines((current) =>
                  current.length === 1
                    ? current
                    : current.filter((line) => line.id !== id),
                )
              }
            />
          ) : null}

          {step === "review" ? (
            <ReviewStep
              supplier={supplier}
              invoiceNumber={invoiceNumber}
              dueAt={dueAt}
              notes={notes}
              files={files}
              lines={lines}
              inventoryItems={inventoryItems}
              totalQuantity={totalQuantity}
            />
          ) : null}

          {uploadingLabel ? (
            <Alert className="border-primary/20 bg-primary/5">
              <PackagePlus className="h-4 w-4 text-primary" />
              <AlertDescription>{uploadingLabel}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <Button
            type="button"
            variant="ghost"
            className="rounded-2xl"
            disabled={mutation.isPending}
            onClick={() => {
              if (step === "review") setStep("items");
              else if (step === "items") setStep("delivery");
              else onBack?.();
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            {step === "delivery" ? "Voltar" : "Etapa anterior"}
          </Button>

          <Button
            type="submit"
            variant="secondary"
            className="min-w-44 rounded-2xl"
            disabled={mutation.isPending}
          >
            {step === "review" ? (
              <>
                <Send className="h-4 w-4" />
                Enviar aviso
              </>
            ) : (
              <>
                Continuar
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}

function DeliveryStep({
  formId,
  supplier,
  invoiceNumber,
  dueAt,
  notes,
  files,
  onSupplierChange,
  onInvoiceNumberChange,
  onDueAtChange,
  onNotesChange,
  onFilesChange,
  onRemoveFile,
}: {
  formId: string;
  supplier: string;
  invoiceNumber: string;
  dueAt: string;
  notes: string;
  files: File[];
  onSupplierChange: (value: string) => void;
  onInvoiceNumberChange: (value: string) => void;
  onDueAtChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onFilesChange: (files: FileList | null) => void;
  onRemoveFile: (index: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-foreground">Sobre a entrega</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Comece pelas informações que ajudam a equipe a reconhecer o recebimento.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-supplier`}>Fornecedor</Label>
          <Input
            id={`${formId}-supplier`}
            value={supplier}
            onChange={(event) => onSupplierChange(event.target.value)}
            placeholder="Nome do fornecedor"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-invoice`}>NF, pedido ou remessa</Label>
          <Input
            id={`${formId}-invoice`}
            value={invoiceNumber}
            onChange={(event) => onInvoiceNumberChange(event.target.value)}
            placeholder="Opcional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-due`}>Chegada prevista</Label>
          <Input
            id={`${formId}-due`}
            type="datetime-local"
            value={dueAt}
            onChange={(event) => onDueAtChange(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-notes`}>Observações</Label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Transportadora, quantidade de volumes, contato ou cuidado especial."
          rows={3}
        />
      </div>
      <div className="space-y-3">
        <div>
          <Label htmlFor={`${formId}-files`}>Anexos</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Nota fiscal, pedido ou foto da remessa. PDF ou imagem, até 8 arquivos.
          </p>
        </div>
        <label
          htmlFor={`${formId}-files`}
          className="flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-white/45 px-4 text-sm font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-white hover:text-primary"
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          Selecionar arquivos
        </label>
        <Input
          id={`${formId}-files`}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => {
            onFilesChange(event.target.files);
            event.target.value = "";
          }}
        />
        {files.length > 0 ? (
          <div className="divide-y divide-border/70 rounded-2xl border border-border bg-white/55">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => onRemoveFile(index)}
                  aria-label={`Remover ${file.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ItemsStep({
  formId,
  lines,
  inventoryItems,
  duplicateLineIds,
  onUpdate,
  onAdd,
  onRemove,
}: {
  formId: string;
  lines: ReceiptLine[];
  inventoryItems: InventoryItem[];
  duplicateLineIds: Set<string>;
  onUpdate: (id: string, patch: Partial<ReceiptLine>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Itens enviados</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Use o código do cliente. O sistema sinaliza quando o produto já existe e impede linhas duplicadas.
          </p>
        </div>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Adicionar item
        </Button>
      </div>

      <datalist id={`${formId}-catalog`}>
        {inventoryItems.map((item, index) => (
          <option
            key={`${inventoryItemSku(item)}-${index}`}
            value={inventoryItemClientCode(item)}
          >
            {inventoryItemName(item)}
          </option>
        ))}
      </datalist>

      <div className="space-y-4">
        {lines.map((line, index) => {
          const match = findCatalogMatch(
            inventoryItems,
            line.clientCode,
            line.productName,
          );
          const duplicate = duplicateLineIds.has(line.id);
          return (
            <div
              key={line.id}
              className={cn(
                "rounded-[20px] border bg-white/55 p-4",
                duplicate ? "border-destructive/40" : "border-border",
              )}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    Item {index + 1}
                  </span>
                  {match ? (
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                      <PackageCheck className="mr-1 h-3.5 w-3.5" />
                      Já cadastrado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-white">
                      Cadastro a confirmar
                    </Badge>
                  )}
                  {duplicate ? (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive">
                      Produto repetido
                    </Badge>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl"
                  disabled={lines.length === 1}
                  onClick={() => onRemove(line.id)}
                  aria-label={`Excluir item ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(170px,.7fr)_minmax(240px,1.3fr)_140px]">
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-${line.id}-code`}>Cód. cliente</Label>
                  <Input
                    id={`${formId}-${line.id}-code`}
                    list={`${formId}-catalog`}
                    value={line.clientCode}
                    onChange={(event) => onUpdate(line.id, { clientCode: event.target.value })}
                    placeholder="Ex.: C.0659.001.U"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-${line.id}-product`}>Produto</Label>
                  <Input
                    id={`${formId}-${line.id}-product`}
                    value={line.productName}
                    onChange={(event) => onUpdate(line.id, { productName: event.target.value })}
                    placeholder="Descrição do produto"
                    readOnly={Boolean(match)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-${line.id}-quantity`}>Quantidade</Label>
                  <Input
                    id={`${formId}-${line.id}-quantity`}
                    type="number"
                    min="1"
                    step="1"
                    value={line.quantity}
                    onChange={(event) => onUpdate(line.id, { quantity: event.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>

              {!match ? (
                <div className="mt-4 space-y-4 border-t border-border/70 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">
                      Este produto é:
                    </span>
                    <RegistrationButton
                      active={line.registration === "new"}
                      label="Novo"
                      onClick={() => onUpdate(line.id, { registration: "new" })}
                    />
                    <RegistrationButton
                      active={line.registration === "unknown"}
                      label="Não sei informar"
                      onClick={() => onUpdate(line.id, { registration: "unknown" })}
                    />
                  </div>
                  {line.registration === "new" ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <SmallField label="Categoria" value={line.category} onChange={(value) => onUpdate(line.id, { category: value })} />
                      <SmallField label="Marca" value={line.brand} onChange={(value) => onUpdate(line.id, { brand: value })} />
                      <SmallField label="Tamanho" value={line.size} onChange={(value) => onUpdate(line.id, { size: value })} />
                      <SmallField label="Cor" value={line.color} onChange={(value) => onUpdate(line.id, { color: value })} />
                      <SmallField label="Código de barras" value={line.barcode} onChange={(value) => onUpdate(line.id, { barcode: value })} />
                      <SmallField label="Custo unitário" value={line.unitCost} type="number" onChange={(value) => onUpdate(line.id, { unitCost: value })} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewStep({
  supplier,
  invoiceNumber,
  dueAt,
  notes,
  files,
  lines,
  inventoryItems,
  totalQuantity,
}: {
  supplier: string;
  invoiceNumber: string;
  dueAt: string;
  notes: string;
  files: File[];
  lines: ReceiptLine[];
  inventoryItems: InventoryItem[];
  totalQuantity: number;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-foreground">Revise antes de enviar</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A Dutelog receberá uma previsão de conferência, sem alteração automática do estoque.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReviewFact label="Fornecedor" value={supplier} />
        <ReviewFact label="Documento" value={invoiceNumber || "Não informado"} />
        <ReviewFact label="Chegada prevista" value={dueAt ? new Date(dueAt).toLocaleString("pt-BR") : "Não informada"} />
        <ReviewFact label="Total previsto" value={`${formatNumber(totalQuantity)} peça(s)`} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-white/55">
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 border-b border-border/70 px-4 py-3 text-xs font-medium text-muted-foreground">
          <span>Itens</span>
          <span className="text-right">Quantidade</span>
        </div>
        <div className="divide-y divide-border/70">
          {lines.map((line) => {
            const match = findCatalogMatch(inventoryItems, line.clientCode, line.productName);
            return (
              <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{line.productName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {line.clientCode} · {match ? "Já cadastrado" : line.registration === "new" ? "Produto novo" : "Cadastro a confirmar"}
                    {positiveNumber(line.unitCost) > 0 ? ` · ${formatMoney(line.unitCost)} por unidade` : ""}
                  </p>
                </div>
                <p className="text-right text-sm font-semibold text-foreground">
                  {formatNumber(line.quantity)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      {(files.length > 0 || notes) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewFact label="Anexos" value={files.length ? `${files.length} arquivo(s)` : "Nenhum"} />
          <ReviewFact label="Observações" value={notes || "Nenhuma"} />
        </div>
      ) : null}
      <Alert className="border-primary/20 bg-primary/5">
        <AlertCircle className="h-4 w-4 text-primary" />
        <AlertDescription>
          O aviso serve para planejamento. Somente a conferência física realizada pela Dutelog poderá criar ou aumentar saldo.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function RegistrationButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-white text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SmallField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-white/55 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function emptyLine(): ReceiptLine {
  return {
    id: localId("receipt-line"),
    clientCode: "",
    productName: "",
    quantity: "",
    registration: "unknown",
    category: "",
    barcode: "",
    brand: "",
    size: "",
    color: "",
    unitCost: "",
    notes: "",
  };
}

function findCatalogMatch(items: InventoryItem[], code: string, productName: string) {
  const normalizedCode = normalizedIdentity(code);
  const normalizedName = normalizedIdentity(productName);
  if (!normalizedCode && !normalizedName) return undefined;

  return items.find((item) => {
    const clientCode = normalizedIdentity(inventoryItemClientCode(item));
    const skuCode = normalizedIdentity(inventoryItemSku(item));
    const name = normalizedIdentity(inventoryItemName(item));
    return (
      (normalizedCode && (clientCode === normalizedCode || skuCode === normalizedCode)) ||
      (normalizedName && name === normalizedName)
    );
  });
}

function findDuplicateLines(lines: ReceiptLine[]) {
  const identities = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const line of lines) {
    const code = normalizedIdentity(line.clientCode);
    const productName = normalizedIdentity(line.productName);
    const lineIdentities = [
      code ? `code:${code}` : "",
      productName ? `name:${productName}` : "",
    ].filter(Boolean);

    for (const identity of lineIdentities) {
      const previous = identities.get(identity);
      if (previous) {
        duplicates.add(previous);
        duplicates.add(line.id);
      } else {
        identities.set(identity, line.id);
      }
    }
  }
  return duplicates;
}

function toRequestItem(line: ReceiptLine, inventoryItems: InventoryItem[]): CreateClientRequestItem {
  const match = findCatalogMatch(inventoryItems, line.clientCode, line.productName);
  return {
    sku_code: match ? inventoryItemSku(match) : line.clientCode.trim(),
    client_item_code: match ? inventoryItemClientCode(match) : line.clientCode.trim(),
    product_name: match ? inventoryItemName(match) : line.productName.trim(),
    product_registration: match ? "existing" : line.registration,
    location_id: null,
    category: line.category.trim() || null,
    barcode: line.barcode.trim() || null,
    brand: line.brand.trim() || null,
    size: line.size.trim() || null,
    color: line.color.trim() || null,
    unit_cost: positiveNumber(line.unitCost) || null,
    quantity: positiveNumber(line.quantity),
    notes: line.notes.trim() || null,
  };
}

async function uploadReceiptAttachment(file: File, customerCode: string, entityId: string) {
  const target = await apiJson<UploadTarget>("/api/documents/upload-target", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customer_code: customerCode,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      document_type: "aviso_recebimento",
      entity_type: "customer_request_draft",
      entity_id: entityId,
    }),
  });
  const uploadResponse = await fetch(target.upload_url, {
    method: "PUT",
    headers: target.upload_headers,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Falha ao enviar ${file.name}.`);
  }
  return {
    file_name: target.file_name,
    file_url: target.file_url,
    storage_path: target.storage_path,
    content_type: target.content_type,
    size_bytes: target.size_bytes,
  };
}

async function apiJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : text;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return payload as T;
}

function isAcceptedAttachment(file: File) {
  return (
    file.size > 0 &&
    file.size <= 30 * 1024 * 1024 &&
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)
  );
}

function positiveNumber(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizedIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function localId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
