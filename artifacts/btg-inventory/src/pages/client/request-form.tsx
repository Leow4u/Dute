import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  type LucideIcon,
  PackagePlus,
  Send,
  Truck,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  formatNumber,
  getInventoryItems,
  inventoryItemAvailable,
  inventoryItemName,
  inventoryItemReserved,
  inventoryItemSku,
  type ClientOverview,
  type CreateClientRequestPayload,
  type InventoryItem,
  ModulePanel,
} from "./shared";

type RequestMode = "retirada" | "recebimento";

type ClientOperationalRequestFormProps = {
  overview: ClientOverview;
  defaultMode?: RequestMode;
  allowModeSwitch?: boolean;
  onBack?: () => void;
  onCreated?: () => void;
};

export function ClientOperationalRequestForm({
  overview,
  defaultMode = "retirada",
  allowModeSwitch = true,
  onBack,
  onCreated,
}: ClientOperationalRequestFormProps) {
  const [mode, setMode] = useState<RequestMode>(defaultMode);
  const [skuInput, setSkuInput] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [destination, setDestination] = useState("");
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const listId = useId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const inventoryItems = useMemo(
    () =>
      getInventoryItems(overview)
        .filter((item) => inventoryItemSku(item) !== "SKU")
        .sort((left, right) =>
          inventoryItemSku(left).localeCompare(
            inventoryItemSku(right),
            "pt-BR",
          ),
        ),
    [overview],
  );

  const selectedItem = useMemo(
    () => findInventoryItem(inventoryItems, skuInput),
    [inventoryItems, skuInput],
  );
  const selectedAvailable = selectedItem
    ? inventoryItemAvailable(selectedItem)
    : 0;
  const selectedReserved = selectedItem
    ? inventoryItemReserved(selectedItem)
    : 0;
  const numericQuantity = Number(quantity);
  const isWithdrawal = mode === "retirada";

  const mutation = useMutation({
    mutationFn: createClientRequest,
    onSuccess: () => {
      toast({
        title: isWithdrawal
          ? "Pedido enviado para a Dutelog"
          : "Aviso de recebimento enviado",
        description: isWithdrawal
          ? "Nossa equipe recebera a demanda para separar, conferir e expedir."
          : "Nossa equipe recebera a previsao para conferir e alimentar o estoque.",
      });
      resetForm(mode);
      onCreated?.();
      void queryClient.invalidateQueries({ queryKey: clientOverviewQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-ops"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Nao foi possivel abrir o fluxo",
        description:
          error instanceof Error
            ? error.message
            : "Revise os dados e tente novamente.",
        variant: "destructive",
      });
    },
  });

  function resetForm(nextMode = defaultMode) {
    setMode(nextMode);
    setSkuInput("");
    setProductName("");
    setQuantity("");
    setDestination("");
    setSupplier("");
    setInvoiceNumber("");
    setDueAt("");
    setPriority("normal");
    setNotes("");
  }

  function handleModeChange(nextMode: RequestMode) {
    setMode(nextMode);
    setSkuInput("");
    setProductName("");
    setQuantity("");
    setDestination("");
    setSupplier("");
    setInvoiceNumber("");
    setDueAt("");
    setPriority("normal");
    setNotes("");
  }

  function handleSkuChange(value: string) {
    setSkuInput(value);
    const item = findInventoryItem(inventoryItems, value);
    if (item) setProductName(inventoryItemName(item));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      toast({
        title: "Informe a quantidade",
        description: "A quantidade precisa ser maior que zero.",
        variant: "destructive",
      });
      return;
    }

    if (isWithdrawal && !selectedItem) {
      toast({
        title: "Escolha um SKU em estoque",
        description: "Pedidos de entrega precisam usar um SKU real disponivel.",
        variant: "destructive",
      });
      return;
    }

    if (isWithdrawal && numericQuantity > selectedAvailable) {
      toast({
        title: "Saldo insuficiente",
        description: `Disponivel agora: ${formatNumber(selectedAvailable)} unidade(s).`,
        variant: "destructive",
      });
      return;
    }

    if (isWithdrawal && !destination.trim()) {
      toast({
        title: "Informe a unidade de entrega",
        description: "A equipe precisa saber para onde enviar o pedido.",
        variant: "destructive",
      });
      return;
    }

    if (
      !isWithdrawal &&
      !selectedItem &&
      !productName.trim() &&
      !skuInput.trim()
    ) {
      toast({
        title: "Informe o item recebido",
        description:
          "Use um SKU existente ou descreva o produto enviado pelo fornecedor.",
        variant: "destructive",
      });
      return;
    }

    const description = isWithdrawal
      ? [`Pedido de entrega para ${destination.trim()}`, notes.trim()]
      : [
          supplier.trim() ? `Fornecedor: ${supplier.trim()}` : "",
          invoiceNumber.trim() ? `NF/remessa: ${invoiceNumber.trim()}` : "",
          notes.trim(),
        ];

    const payload: CreateClientRequestPayload = {
      type: mode,
      priority,
      title: isWithdrawal
        ? "Pedido de entrega para unidade"
        : "Aviso de chegada de fornecedor",
      description: description.filter(Boolean).join(" | "),
      destination: isWithdrawal ? destination.trim() : "Recebimento Dutelog",
      due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
      items: [
        {
          sku_code: selectedItem
            ? inventoryItemSku(selectedItem)
            : cleanSkuInput(skuInput),
          client_item_code: firstText(selectedItem?.client_item_code) ?? null,
          product_name:
            productName.trim() ||
            (selectedItem ? inventoryItemName(selectedItem) : null),
          location_id: null,
          quantity: numericQuantity,
          notes: notes.trim() || null,
        },
      ],
    };

    mutation.mutate(payload);
  }

  return (
    <ModulePanel
      title={
        isWithdrawal ? "Novo pedido de entrega" : "Avisar chegada de fornecedor"
      }
      description={
        isWithdrawal
          ? "Solicite a separacao do estoque real para entrega em uma unidade."
          : "Registre uma previsao de recebimento para conferencia e entrada no estoque."
      }
      icon={isWithdrawal ? Truck : PackagePlus}
    >
      <form className="space-y-5" onSubmit={submit}>
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full px-3 text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para tipos
          </Button>
        ) : null}

        {allowModeSwitch ? (
          <div className="grid gap-2 rounded-[24px] border border-border bg-white/55 p-2 sm:grid-cols-2">
            <ModeButton
              active={isWithdrawal}
              icon={Truck}
              title="Pedir do estoque"
              description="Separar, conferir e enviar"
              onClick={() => handleModeChange("retirada")}
            />
            <ModeButton
              active={!isWithdrawal}
              icon={PackagePlus}
              title="Avisar recebimento"
              description="Fornecedor envia para a Dutelog"
              onClick={() => handleModeChange("recebimento")}
            />
          </div>
        ) : null}

        {isWithdrawal && inventoryItems.length === 0 ? (
          <Alert variant="destructive" className="bg-white">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              O estoque real ainda nao carregou para esta conta. Atualize a tela
              antes de abrir um pedido de entrega.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-2">
            <Label htmlFor={`${listId}-sku`}>
              {isWithdrawal ? "SKU em estoque" : "SKU ou produto previsto"}
            </Label>
            <Input
              id={`${listId}-sku`}
              list={`${listId}-items`}
              value={skuInput}
              onChange={(event) => handleSkuChange(event.target.value)}
              placeholder={
                isWithdrawal
                  ? "Selecione um SKU real disponivel"
                  : "Selecione um SKU existente ou informe o item"
              }
              autoComplete="off"
            />
            <datalist id={`${listId}-items`}>
              {inventoryItems.slice(0, 1000).map((item, index) => (
                <option
                  key={`${inventoryItemKey(item, index)}-option`}
                  value={inventoryItemKey(item, index)}
                >
                  {`${inventoryItemName(item)} | disp. ${formatNumber(
                    inventoryItemAvailable(item),
                  )}`}
                </option>
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${listId}-quantity`}>Quantidade</Label>
            <Input
              id={`${listId}-quantity`}
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${listId}-product`}>Produto</Label>
            <Input
              id={`${listId}-product`}
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder="Nome do produto"
              readOnly={isWithdrawal && Boolean(selectedItem)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${listId}-priority`}>Prioridade</Label>
            <select
              id={`${listId}-priority`}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
        </div>

        {selectedItem ? (
          <div className="grid gap-3 rounded-[24px] border border-border bg-white/55 p-4 text-sm sm:grid-cols-2">
            <StockFact
              label="Disponivel"
              value={formatNumber(selectedAvailable)}
            />
            <StockFact
              label="Reservado"
              value={formatNumber(selectedReserved)}
            />
          </div>
        ) : null}

        {isWithdrawal ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${listId}-destination`}>
                Unidade de entrega
              </Label>
              <Input
                id={`${listId}-destination`}
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="Ex.: agencia, predio ou centro de custo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${listId}-due`}>Prazo desejado</Label>
              <Input
                id={`${listId}-due`}
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`${listId}-supplier`}>Fornecedor</Label>
              <Input
                id={`${listId}-supplier`}
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="Nome do fornecedor"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${listId}-invoice`}>NF ou remessa</Label>
              <Input
                id={`${listId}-invoice`}
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                placeholder="Documento de referencia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${listId}-arrival`}>Chegada prevista</Label>
              <Input
                id={`${listId}-arrival`}
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={`${listId}-notes`}>Observacoes para a operacao</Label>
          <Textarea
            id={`${listId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={
              isWithdrawal
                ? "Detalhe contato, janela de entrega, restricoes ou instrucoes."
                : "Informe volumes, transportadora, doca, divergencias esperadas ou cuidados."
            }
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {isWithdrawal
              ? "Ao enviar, a Dutelog recebe a demanda para aprovar, reservar saldo, separar, conferir e expedir."
              : "Ao enviar, a Dutelog recebe a previsao para criar o recebimento, conferir fisicamente e atualizar o saldo real."}
          </p>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="min-w-44"
            variant="secondary"
          >
            {mutation.isPending ? (
              <ArrowRightLeft className="h-4 w-4 animate-pulse" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Enviar
          </Button>
        </div>
      </form>
    </ModulePanel>
  );
}

type ModeButtonProps = {
  active: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
};

function ModeButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[20px] border px-4 py-3 text-left transition",
        active
          ? "border-primary/20 bg-white text-foreground shadow-[0_8px_24px_rgba(15,23,42,.04)]"
          : "border-transparent text-muted-foreground hover:bg-white/70",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
          active
            ? "border-primary/20 bg-primary/10 text-primary"
            : "border-border bg-white/65 text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-5">{description}</span>
      </span>
    </button>
  );
}

function StockFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium text-foreground">
        {value ?? "-"}
      </p>
    </div>
  );
}

function findInventoryItem(items: InventoryItem[], input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  return items.find((item, index) => {
    const key = inventoryItemKey(item, index).toLowerCase();
    const sku = inventoryItemSku(item).toLowerCase();
    const clientCode = String(item.client_item_code ?? "").toLowerCase();
    return (
      key === normalized || sku === normalized || clientCode === normalized
    );
  });
}

function inventoryItemKey(item: InventoryItem, index: number) {
  const sku = inventoryItemSku(item);
  const name = inventoryItemName(item);
  return `${sku} | ${name} | ${index + 1}`;
}

function cleanSkuInput(value: string) {
  const text = value.trim();
  return text ? text.split("|")[0]?.trim() || null : null;
}
