import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, SearchX, type LucideIcon } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Numberish = number | string | null | undefined;

export type ClientOverview = {
  customer?: {
    name?: string;
    code?: string;
    document?: string;
    role?: string;
  };
  updated_at?: string | null;
  inventory?: InventorySummary;
  stock?: InventorySummary;
  billing?: BillingSummary;
  invoices?: BillingSummary | Invoice[];
  orders?: OrdersSummary;
  recent_orders?: Order[];
  requests?: RequestsSummary | ClientRequest[];
  recent_requests?: ClientRequest[];
  /** Pedidos: o acompanhamento publicado inteiro (client_order_tracking). */
  order_tracking?: Record<string, unknown>[];
  /** Faturas: todas as faturas da conta, não só as 6 do Início. */
  invoice_history?: Record<string, unknown>[];
  /** Pedidos: todas as solicitações, não só as recentes do Início. */
  request_history?: ClientRequest[];
  agent_alerts?: AgentAlert[];
  alerts?: AgentAlert[];
  metrics?: Record<string, Numberish>;
  stock_by_category?: InventoryCategory[];
  wms?: WmsOverviewPayload;
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export type InventorySummary = {
  total_skus?: Numberish;
  total_pieces?: Numberish;
  total_pecas?: Numberish;
  available_pieces?: Numberish;
  reserved_pieces?: Numberish;
  low_stock_count?: Numberish;
  total_value?: Numberish;
  inventory_value?: Numberish;
  custo_total?: Numberish;
  by_category?: InventoryCategory[];
  top_items?: InventoryItem[];
  items?: InventoryItem[];
};

export type InventoryCategory = {
  category?: string;
  categoria?: string;
  label?: string;
  total_pieces?: Numberish;
  total_pecas?: Numberish;
  qty_on_hand?: Numberish;
  value?: Numberish;
  total_value?: Numberish;
  total_cost?: Numberish;
  unit_cost?: Numberish;
  sku_count?: Numberish;
};

export type InventoryItem = {
  id?: string;
  sku_code?: string;
  sku?: string;
  cod_sku?: string;
  client_item_code?: string;
  cod_cliente?: string;
  product_name?: string;
  name?: string;
  produto?: string;
  category?: string;
  categoria?: string;
  qty_available?: Numberish;
  available_pieces?: Numberish;
  qty_reserved?: Numberish;
  reserved_pieces?: Numberish;
  qty_on_hand?: Numberish;
  pieces?: Numberish;
  total_pieces?: Numberish;
  qtde?: Numberish;
  value?: Numberish;
  total_value?: Numberish;
  total_cost?: Numberish;
  unit_cost?: Numberish;
  location_id?: string;
  location?: string;
  localizacao?: string;
  primary_photo_url?: string | null;
  photo_urls?: string[];
};

export type BillingSummary = {
  current_total?: Numberish;
  open_total?: Numberish;
  overdue_total?: Numberish;
  open_count?: Numberish;
  due_soon_count?: Numberish;
  recent?: Invoice[];
  items?: Invoice[];
};

export type Invoice = {
  id?: string;
  competencia?: string;
  month?: string;
  status?: string;
  total?: Numberish;
  due_date?: string | null;
  vencimento?: string | null;
};

export type OrdersSummary = {
  open?: Numberish;
  pending?: Numberish;
  in_progress?: Numberish;
  shipped?: Numberish;
  recent?: Order[];
  items?: Order[];
};

export type Order = {
  id?: string;
  num_pedido?: string;
  order_number?: string;
  number?: string;
  status?: string;
  canal?: string;
  channel?: string;
  sku_code?: string;
  sku?: string;
  cod_sku?: string;
  client_item_code?: string;
  cod_cliente?: string;
  produto?: string;
  product?: string;
  product_name?: string;
  qtd_solic?: Numberish;
  requested_qty?: Numberish;
  quantity?: Numberish;
  qtd_sep?: Numberish;
  picked_qty?: Numberish;
  progress?: Numberish;
  data_solic?: string | null;
  requested_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RequestsSummary = {
  open?: Numberish;
  pending?: Numberish;
  recent?: ClientRequest[];
  items?: ClientRequest[];
};

export type ClientRequestItemObject = {
  sku_code?: string | null;
  sku?: string | null;
  cod_sku?: string | null;
  client_item_code?: string | null;
  cod_cliente?: string | null;
  product_name?: string | null;
  product?: string | null;
  name?: string | null;
  produto?: string | null;
  quantity?: Numberish;
  qty?: Numberish;
  qtd?: Numberish;
  qtde?: Numberish;
  requested_quantity?: Numberish;
  requested_qty?: Numberish;
  picked_quantity?: Numberish;
  picked_qty?: Numberish;
  expected_quantity?: Numberish;
  expected_qty?: Numberish;
  packed_quantity?: Numberish;
  packed_qty?: Numberish;
  status?: string | null;
  location?: string | null;
  localizacao?: string | null;
  location_id?: string | null;
  package_id?: string | null;
  package_label?: string | null;
  tracking_code?: string | null;
};

export type ClientRequestItem = string | ClientRequestItemObject;

export type ClientRequest = {
  id?: string;
  customer_code?: string;
  supplier?: string;
  invoice_number?: string;
  attachment_count?: Numberish;
  /** PED-0043 / ENV-0012: o número que as pessoas leem. */
  request_number?: string;
  protocol?: string;
  protocolo?: string;
  title?: string;
  titulo?: string;
  type?: string;
  tipo?: string;
  priority?: string;
  prioridade?: string;
  description?: string;
  descricao?: string;
  status?: string;
  quantity?: Numberish;
  quantity_total?: Numberish;
  items?: ClientRequestItem[];
  payload?: {
    items?: ClientRequestItem[];
    shipments?: ShipmentRecord[];
    packages?: PackageRecord[];
    volumes?: PackageRecord[];
    delivery_proofs?: DeliveryProof[];
    proofs?: DeliveryProof[];
    documents?: DeliveryProof[];
  } | null;
  order_id?: string | null;
  pedido_id?: string | null;
  order_number?: string | null;
  num_pedido?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  tracking_code?: string | null;
  proof_id?: string | null;
  document_id?: string | null;
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  shipments?: ShipmentRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
  created_at?: string | null;
  updated_at?: string | null;
  requested_by?: {
    name?: string;
    email?: string;
  };
};

export type AgentAlert = {
  id?: string;
  title?: string;
  titulo?: string;
  message?: string;
  description?: string;
  priority?: string;
  severity?: string;
  created_at?: string | null;
};

export type WmsOverviewPayload = {
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export type PackageRecord = {
  id?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  quantity?: Numberish;
  status?: string | null;
  location?: string | null;
  location_id?: string | null;
  package_id?: string | null;
  package_code?: string | null;
  package_label?: string | null;
  package_number?: string | number | null;
  tracking_code?: string | null;
  volume?: string | null;
  volume_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  shipment_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  blocked_reason?: string | null;
};

export type DeliveryProof = {
  id?: string | null;
  proof_id?: string | null;
  document_id?: string | null;
  shipment_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  file_name?: string | null;
  filename?: string | null;
  name?: string | null;
  title?: string | null;
  url?: string | null;
  href?: string | null;
  status?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ShipmentRecord = {
  id?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  status?: string | null;
  destination?: string | null;
  carrier?: string | null;
  tracking_code?: string | null;
  total_units?: Numberish;
  quantity?: Numberish;
  qty?: Numberish;
  due_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  items?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

export const clientOverviewQueryKey = ["client-portal-overview"] as const;

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : text;

    throw new Error(message || `HTTP ${response.status}`);
  }

  return (payload ?? undefined) as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function useClientOverview() {
  return useQuery<ClientOverview, Error>({
    queryKey: clientOverviewQueryKey,
    queryFn: () => fetchJson<ClientOverview>("/api/client/overview"),
    staleTime: 60_000,
  });
}

export type CreateClientRequestItem = {
  sku_code?: string | null;
  client_item_code?: string | null;
  product_name?: string | null;
  product_registration?: "existing" | "new" | "unknown";
  location_id?: string | null;
  category?: string | null;
  barcode?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  unit_cost?: number | null;
  quantity: number;
  notes?: string | null;
};

export type ClientRequestAttachment = {
  file_name: string;
  file_url: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
};

export type CreateClientRequestPayload = {
  type: "retirada" | "recebimento" | "ajuste" | "suporte";
  priority?: string;
  title?: string;
  description?: string;
  destination?: string;
  due_at?: string;
  supplier?: string;
  invoice_number?: string;
  attachments?: ClientRequestAttachment[];
  items: CreateClientRequestItem[];
};

export function createClientRequest(payload: CreateClientRequestPayload) {
  return fetchJson<ClientRequest>("/api/client/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

type ClientDataBoundaryProps = {
  children: (overview: ClientOverview) => ReactNode;
};

export function ClientDataBoundary({ children }: ClientDataBoundaryProps) {
  const overview = useClientOverview();

  if (overview.isLoading) {
    return <ClientModuleLoading />;
  }

  if (overview.isError) {
    return (
      <ClientModuleError
        error={overview.error}
        isRetrying={overview.isFetching}
        onRetry={() => {
          void overview.refetch();
        }}
      />
    );
  }

  return <>{children(overview.data ?? {})}</>;
}

type ClientModuleShellProps = {
  overview: ClientOverview;
  eyebrow?: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
};

export function ClientModuleShell({
  overview,
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
  className,
}: ClientModuleShellProps) {
  const customerName = firstText(overview.customer?.name, "Cliente");
  const customerCode = firstText(overview.customer?.code);
  const headerLabel = firstText(eyebrow, title) ?? "Modulo";

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5",
          className,
        )}
      >
        <header
          aria-label={headerLabel}
          className="shrink-0 flex flex-col gap-4 border-b border-border/60 pb-5 md:flex-row md:items-start md:justify-between"
        >
          <div className="flex min-w-0 gap-4">
            <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-[2rem] md:leading-tight">
                {title}
              </h1>
              {description ? (
                <p className="max-w-3xl text-sm leading-6 text-foreground/70">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-foreground/65 md:max-w-sm md:justify-end md:pt-2 md:text-right">
            <span className="font-medium text-foreground">{customerName}</span>
            {customerCode ? <span>Conta {customerCode}</span> : null}
            <span>Atualizado {formatDate(overview.updated_at)}</span>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          <div className="flex min-h-full flex-col gap-5 pb-1">{children}</div>
        </div>
      </div>
    </main>
  );
}

type ClientModuleLoadingProps = {
  title?: string;
};

export function ClientModuleLoading({
  title = "Carregando portal do cliente",
}: ClientModuleLoadingProps) {
  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f6f8f7] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 overflow-auto overscroll-contain">
        <div className="flex items-center gap-4 border-b border-border/70 pb-5">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="w-full max-w-xl space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-32 rounded-[24px]" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-[24px]" />
        <span className="sr-only">{title}</span>
      </div>
    </main>
  );
}

type ClientModuleErrorProps = {
  error: Error;
  isRetrying: boolean;
  onRetry: () => void;
};

function ClientModuleError({
  error,
  isRetrying,
  onRetry,
}: ClientModuleErrorProps) {
  return (
    <main className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-[#f6f8f7] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-h-full max-w-3xl overflow-auto overscroll-contain">
        <Alert variant="destructive" className="bg-white">
          <AlertCircle className="h-4 w-4" />
        <AlertTitle>Portal indisponível</AlertTitle>
          <AlertDescription className="space-y-4">
            <p>
              {error.message ||
                "Não foi possível carregar os dados do cliente."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying}
            >
              <RefreshCw
                className={cn("h-4 w-4", isRetrying ? "animate-spin" : "")}
              />
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </main>
  );
}

type ModulePanelProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
};

export function ModulePanel({
  title,
  description,
  icon: Icon,
  children,
  className,
}: ModulePanelProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {Icon ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-white/70 text-muted-foreground">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type MetricCardProps = {
  label: string;
  value: ReactNode;
  description?: string;
  icon: LucideIcon;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

const metricToneClass = {
  neutral: "border-border bg-white/72 text-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
} as const;

export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "neutral",
}: MetricCardProps) {
  return (
    <Card className="min-h-[120px]">
      <CardContent className="flex h-full flex-col justify-between gap-3 p-5 md:p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-foreground/70">{label}</p>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-2xl border",
              metricToneClass[tone],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-normal text-foreground">
            {value}
          </div>
          {description ? (
            <p className="text-xs leading-5 text-foreground/65">
              {description}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type EmptyModuleStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
};

export function EmptyModuleState({
  title,
  description,
  icon: Icon = SearchX,
}: EmptyModuleStateProps) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-white/45 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-white/75 text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", statusBadgeClass(status))}
    >
      {normalizeStatus(status)}
    </Badge>
  );
}

export function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^\d,.-]/g, "");
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function optionalNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

export function formatNumber(value: unknown) {
  return numberFormatter.format(toNumber(value));
}

export function formatMoney(value: unknown) {
  return moneyFormatter.format(toNumber(value));
}

export function formatDate(value?: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return dateFormatter.format(date);
}

export function formatPeriod(value?: string | null) {
  const text = firstText(value);
  if (!text) return "Sem competência";
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return text;
  return `${match[2]}/${match[1]}`;
}

export function normalizeStatus(status?: string | null) {
  const text = firstText(status);
  if (!text) return "Pendente";
  return text.replace(/_/g, " ");
}

export function normalizeSlug(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function statusBadgeClass(status?: string | null) {
  const normalized = normalizeSlug(status);

  if (
    [
      "entregue",
      "delivered",
      "resolvido",
      "resolved",
      "aprovado",
      "approved",
      "pago",
      "paid",
      "recebido",
      "received",
      "concluido",
      "completed",
      "closed",
      "emitido",
      "faturado",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    [
      "atras",
      "venc",
      "cancel",
      "reject",
      "rejeit",
      "critico",
      "blocked",
      "bloque",
      "diverg",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (
    [
      "pend",
      "abert",
      "open",
      "submitted",
      "progress",
      "separ",
      "analise",
      "planned",
    ].some((term) => normalized.includes(term))
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-border bg-white/70 text-muted-foreground";
}

export function priorityLabel(priority?: string | null) {
  const normalized = normalizeSlug(priority || "normal");
  if (["critical", "critica", "critico"].includes(normalized)) return "Critica";
  if (["high", "alta", "alto"].includes(normalized)) return "Alta";
  if (["low", "baixa", "baixo"].includes(normalized)) return "Baixa";
  return "Normal";
}

export function priorityTone(priority?: string | null) {
  const normalized = normalizeSlug(priority || "normal");
  if (["critical", "critica", "critico"].includes(normalized)) return "danger";
  if (["high", "alta", "alto"].includes(normalized)) return "warning";
  if (["low", "baixa", "baixo"].includes(normalized)) return "neutral";
  return "info";
}

export function requestTypeLabel(type?: string | null) {
  const normalized = normalizeSlug(type || "retirada");
  const labels: Record<string, string> = {
    retirada: "Retirada",
    recebimento: "Recebimento",
    inventario: "Inventario",
    ajuste: "Ajuste de estoque",
    financeiro: "Financeiro",
    suporte: "Suporte operacional",
  };
  return labels[normalized] ?? normalizeStatus(type);
}

export function getInventory(overview: ClientOverview) {
  return overview.inventory ?? overview.stock ?? {};
}

export function getInventoryCategories(overview: ClientOverview) {
  const inventory = getInventory(overview);
  const categories = asList(inventory.by_category);
  return categories.length > 0
    ? categories
    : asList(overview.stock_by_category);
}

export function getInventoryItems(overview: ClientOverview) {
  const inventory = getInventory(overview);
  const items = asList(inventory.items);
  return items.length > 0 ? items : asList(inventory.top_items);
}

export function getBilling(overview: ClientOverview) {
  if (overview.billing) return overview.billing;
  return Array.isArray(overview.invoices) ? {} : (overview.invoices ?? {});
}

export function getInvoices(overview: ClientOverview) {
  const invoicesPayload = overview.invoices;
  const invoices = Array.isArray(invoicesPayload)
    ? invoicesPayload
    : [
        ...asList(overview.billing?.recent),
        ...asList(overview.billing?.items),
        ...asList(invoicesPayload?.recent),
        ...asList(invoicesPayload?.items),
      ];

  return uniqueBy(invoices, (invoice, index) =>
    firstText(
      invoice.id,
      invoice.competencia,
      invoice.month,
      `invoice-${index}`,
    ),
  );
}

export function getOrders(overview: ClientOverview) {
  return uniqueBy(
    [
      ...asList(overview.recent_orders),
      ...asList(overview.orders?.recent),
      ...asList(overview.orders?.items),
    ],
    (order, index) =>
      firstText(
        order.id,
        order.num_pedido,
        order.order_number,
        order.number,
        `order-${index}`,
      ),
  );
}

export function getRequests(overview: ClientOverview) {
  const requestPayload = overview.requests;
  const requests = Array.isArray(requestPayload)
    ? requestPayload
    : [
        ...asList(overview.recent_requests),
        ...asList(requestPayload?.recent),
        ...asList(requestPayload?.items),
      ];

  return uniqueBy(requests, (request, index) =>
    firstText(
      request.id,
      request.protocol,
      request.protocolo,
      request.order_id,
      request.pedido_id,
      `request-${index}`,
    ),
  );
}

export function getAlerts(overview: ClientOverview) {
  return uniqueBy(
    [...asList(overview.agent_alerts), ...asList(overview.alerts)],
    (alert, index) =>
      firstText(alert.id, alert.title, alert.titulo, `alert-${index}`),
  );
}

export function getShipments(overview: ClientOverview) {
  const requests = getRequests(overview);
  const requestShipments = requests.flatMap((request) => [
    ...asList(request.shipments),
    ...asList(request.payload?.shipments),
  ]);

  return uniqueBy(
    [
      ...asList(overview.shipments),
      ...asList(overview.wms?.shipments),
      ...requestShipments,
    ],
    (shipment, index) =>
      firstText(
        shipment.id,
        shipment.shipment_id,
        shipment.shipping_id,
        shipment.expedition_id,
        shipment.tracking_code,
        `shipment-${index}`,
      ),
  );
}

export function getPackages(overview: ClientOverview) {
  const shipments = getShipments(overview);
  const requests = getRequests(overview);

  return uniqueBy(
    [
      ...asList(overview.packages),
      ...asList(overview.volumes),
      ...asList(overview.wms?.packages),
      ...asList(overview.wms?.volumes),
      ...shipments.flatMap((shipment) => [
        ...asList(shipment.packages),
        ...asList(shipment.volumes),
        ...asList(shipment.items),
      ]),
      ...requests.flatMap((request) => [
        ...asList(request.packages),
        ...asList(request.volumes),
        ...asList(request.payload?.packages),
        ...asList(request.payload?.volumes),
      ]),
    ],
    (item, index) =>
      firstText(
        item.id,
        item.package_id,
        item.package_code,
        item.package_label,
        item.volume_id,
        item.volume,
        `package-${index}`,
      ),
  );
}

export function getDocuments(overview: ClientOverview) {
  const shipments = getShipments(overview);
  const requests = getRequests(overview);

  return uniqueBy(
    [
      ...asList(overview.documents),
      ...asList(overview.proofs),
      ...asList(overview.delivery_proofs),
      ...asList(overview.wms?.documents),
      ...asList(overview.wms?.proofs),
      ...asList(overview.wms?.delivery_proofs),
      ...shipments.flatMap((shipment) => [
        ...asList(shipment.documents),
        ...asList(shipment.proofs),
        ...asList(shipment.delivery_proofs),
      ]),
      ...requests.flatMap((request) => [
        ...asList(request.documents),
        ...asList(request.proofs),
        ...asList(request.delivery_proofs),
        ...asList(request.payload?.documents),
        ...asList(request.payload?.proofs),
        ...asList(request.payload?.delivery_proofs),
      ]),
    ],
    (document, index) =>
      firstText(
        document.id,
        document.document_id,
        document.proof_id,
        document.url,
        document.href,
        `document-${index}`,
      ),
  );
}

export function inventoryItemSku(item: InventoryItem) {
  return (
    firstText(item.sku_code, item.sku, item.cod_sku, item.client_item_code) ??
    "SKU"
  );
}

export function inventoryItemClientCode(item: InventoryItem) {
  return (
    firstText(item.client_item_code, item.cod_cliente) ?? "Sem cod. cliente"
  );
}

export function inventoryItemName(item: InventoryItem) {
  return (
    firstText(item.product_name, item.name, item.produto) ?? "Produto sem nome"
  );
}

export function inventoryItemAvailable(item: InventoryItem) {
  return firstNumber(
    item.qty_available,
    item.available_pieces,
    item.pieces,
    item.total_pieces,
    item.qtde,
  );
}

export function inventoryItemTotal(item: InventoryItem) {
  return firstNumber(
    item.qty_on_hand,
    item.pieces,
    item.total_pieces,
    item.qtde,
    item.qty_available,
  );
}

export function inventoryItemReserved(item: InventoryItem) {
  return firstNumber(item.qty_reserved, item.reserved_pieces);
}

export function inventoryItemValue(item: InventoryItem) {
  return firstNumber(item.total_value, item.total_cost, item.value);
}

export function inventoryTotalValue(
  inventory: InventorySummary,
  items: InventoryItem[] = [],
) {
  const fromSummary = firstNumber(
    inventory.total_value,
    inventory.inventory_value,
    inventory.custo_total,
  );
  if (fromSummary > 0) return fromSummary;
  return items.reduce((sum, item) => sum + inventoryItemValue(item), 0);
}

export function inventoryItemPhoto(item: InventoryItem) {
  const primary = item.primary_photo_url;
  if (typeof primary === "string" && primary.trim()) return primary;
  const first = item.photo_urls?.[0];
  return typeof first === "string" && first.trim() ? first : null;
}

export function categoryLabel(category: InventoryCategory) {
  return (
    firstText(category.label, category.category, category.categoria) ??
    "Sem categoria"
  );
}

export function categoryPieces(category: InventoryCategory) {
  return firstNumber(
    category.total_pieces,
    category.total_pecas,
    category.qty_on_hand,
  );
}

export function categoryValue(category: InventoryCategory) {
  return firstNumber(category.total_value, category.total_cost, category.value);
}

export function orderReference(order: Order) {
  return (
    firstText(order.order_number, order.num_pedido, order.number, order.id) ??
    "Sem pedido"
  );
}

export function orderProduct(order: Order) {
  return (
    firstText(
      order.product_name,
      order.product,
      order.produto,
      order.client_item_code,
      order.cod_cliente,
    ) ?? "Itens do pedido"
  );
}

export function orderDate(order: Order) {
  return firstText(
    order.requested_at,
    order.data_solic,
    order.created_at,
    order.updated_at,
  );
}

export function orderRequestedQuantity(order: Order) {
  return firstNumber(order.requested_qty, order.qtd_solic, order.quantity);
}

export function orderPickedQuantity(order: Order) {
  return firstNumber(order.picked_qty, order.qtd_sep);
}

export function orderProgress(order: Order) {
  const explicit = optionalNumber(order.progress);
  if (explicit !== undefined) return clampPercent(explicit);

  const requested = orderRequestedQuantity(order);
  if (requested <= 0) return 0;
  return clampPercent(
    Math.round((orderPickedQuantity(order) / requested) * 100),
  );
}

export function requestReference(request: ClientRequest) {
  return (
    firstText(request.request_number, request.protocol, request.protocolo, request.id) ??
    "Sem protocolo"
  );
}

export function requestTitle(request: ClientRequest) {
  return (
    firstText(
      request.title,
      request.titulo,
      request.description,
      request.descricao,
      requestTypeLabel(request.type ?? request.tipo),
    ) ?? "Solicitacao"
  );
}

export function requestDate(request: ClientRequest) {
  return firstText(request.updated_at, request.created_at);
}

export function requestItems(request: ClientRequest) {
  const items = asList(request.items);
  return items.length > 0 ? items : asList(request.payload?.items);
}

export function requestQuantityTotal(request: ClientRequest) {
  const explicit = optionalNumber(request.quantity_total, request.quantity);
  if (explicit !== undefined) return explicit;

  return requestItems(request).reduce((sum, item) => {
    if (typeof item === "string") return sum;
    return (
      sum +
      firstNumber(
        item.quantity,
        item.qty,
        item.qtd,
        item.qtde,
        item.requested_quantity,
        item.requested_qty,
      )
    );
  }, 0);
}

export function documentLabel(document: DeliveryProof) {
  return (
    firstText(
      document.title,
      document.file_name,
      document.filename,
      document.name,
      document.document_id,
      document.proof_id,
      document.id,
    ) ?? "Documento"
  );
}

export function documentDate(document: DeliveryProof) {
  return firstText(
    document.signed_at,
    document.updated_at,
    document.created_at,
  );
}

export function documentUrl(document: DeliveryProof) {
  return firstText(document.url, document.href);
}

export function shipmentReference(shipment: ShipmentRecord) {
  return (
    firstText(
      shipment.order_number,
      shipment.tracking_code,
      shipment.shipment_id,
      shipment.shipping_id,
      shipment.expedition_id,
      shipment.id,
    ) ?? "Remessa"
  );
}

export function shipmentDate(shipment: ShipmentRecord) {
  return firstText(
    shipment.delivered_at,
    shipment.dispatched_at,
    shipment.due_at,
    shipment.updated_at,
    shipment.created_at,
  );
}

export function shipmentQuantity(shipment: ShipmentRecord) {
  return firstNumber(shipment.total_units, shipment.quantity, shipment.qty);
}

export function sortByDateDesc<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
) {
  return [...items].sort(
    (left, right) => dateValue(getDate(right)) - dateValue(getDate(left)),
  );
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : 0;
}

function asList<T>(value?: T[] | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueBy<T>(
  items: T[],
  getKey: (item: T, index: number) => string | undefined,
) {
  const seen = new Set<string>();
  const unique: T[] = [];

  items.forEach((item, index) => {
    const key = getKey(item, index) ?? `item-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return unique;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
