import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Box,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  DollarSign,
  FileCheck2,
  Link2,
  MapPin,
  Package,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Route,
  Send,
  Sparkles,
  Truck,
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ClientOverview = {
  customer?: {
    name?: string;
    code?: string;
    document?: string;
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
  agent_alerts?: AgentAlert[];
  alerts?: AgentAlert[];
  wms?: WmsOverviewPayload;
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

type InventorySummary = {
  total_skus?: number | string;
  total_pieces?: number | string;
  total_pecas?: number | string;
  available_pieces?: number | string;
  reserved_pieces?: number | string;
  low_stock_count?: number | string;
  total_value?: number | string;
  inventory_value?: number | string;
  custo_total?: number | string;
  by_category?: InventoryCategory[];
  top_items?: InventoryItem[];
  items?: InventoryItem[];
};

type InventoryCategory = {
  category?: string;
  categoria?: string;
  label?: string;
  total_pieces?: number | string;
  total_pecas?: number | string;
  value?: number | string;
  total_value?: number | string;
};

type InventoryItem = {
  id?: string;
  sku_code?: string;
  sku?: string;
  cod_sku?: string;
  client_item_code?: string;
  product_name?: string;
  name?: string;
  produto?: string;
  category?: string;
  categoria?: string;
  qty_available?: number | string;
  available_pieces?: number | string;
  pieces?: number | string;
  total_pieces?: number | string;
  qtde?: number | string;
  value?: number | string;
  total_value?: number | string;
  location_id?: string;
  location?: string;
  localizacao?: string;
};

type BillingSummary = {
  current_total?: number | string;
  open_total?: number | string;
  overdue_total?: number | string;
  open_count?: number | string;
  due_soon_count?: number | string;
  recent?: Invoice[];
  items?: Invoice[];
};

type Invoice = {
  id?: string;
  competencia?: string;
  month?: string;
  status?: string;
  total?: number | string;
  due_date?: string | null;
  vencimento?: string | null;
};

type OrdersSummary = {
  open?: number | string;
  pending?: number | string;
  in_progress?: number | string;
  shipped?: number | string;
  recent?: Order[];
  items?: Order[];
};

type Order = {
  id?: string;
  num_pedido?: string;
  order_number?: string;
  number?: string;
  status?: string;
  canal?: string;
  channel?: string;
  cod_sku?: string;
  produto?: string;
  product?: string;
  product_name?: string;
  qtd_solic?: number | string;
  requested_qty?: number | string;
  quantity?: number | string;
  qtd_sep?: number | string;
  picked_qty?: number | string;
  data_solic?: string | null;
  requested_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RequestsSummary = {
  open?: number | string;
  pending?: number | string;
  recent?: ClientRequest[];
  items?: ClientRequest[];
};

type RequestItemPayload = {
  sku_code: string;
  product_name: string;
  quantity: number;
  location_id?: string;
};

type CreatedEntities = {
  order_id?: string | null;
  pedido_id?: string | null;
  order_number?: string | null;
  num_pedido?: string | null;
  inbound_id?: string | null;
  receiving_id?: string | null;
  receipt_id?: string | null;
  receipt_number?: string | null;
  pick_task_id?: string | null;
  picking_id?: string | null;
  picking_task_id?: string | null;
  pack_task_id?: string | null;
  packing_id?: string | null;
  packing_task_id?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  tracking_code?: string | null;
  delivery_proof_id?: string | null;
  proof_id?: string | null;
  document_id?: string | null;
  package_id?: string | null;
  volume_id?: string | null;
  volume?: string | null;
};

type OperationalLinkSource = CreatedEntities & {
  created_entities?: CreatedEntities | null;
  operational_links?: CreatedEntities | null;
  operational?: CreatedEntities | null;
  links?: CreatedEntities | null;
  payload?: (CreatedEntities & { created_entities?: CreatedEntities | null }) | null;
};

type ClientRequestItemObject = Partial<RequestItemPayload> &
  OperationalLinkSource & {
    sku?: string | null;
    cod_sku?: string | null;
    product?: string | null;
    name?: string | null;
    produto?: string | null;
    qty?: number | string | null;
    qtd?: number | string | null;
    qtde?: number | string | null;
    requested_quantity?: number | string | null;
    requested_qty?: number | string | null;
    picked_quantity?: number | string | null;
    picked_qty?: number | string | null;
    received_quantity?: number | string | null;
    received_qty?: number | string | null;
    expected_quantity?: number | string | null;
    expected_qty?: number | string | null;
    packed_quantity?: number | string | null;
    packed_qty?: number | string | null;
    qty_packed?: number | string | null;
    unit?: string | null;
    unidade?: string | null;
    location?: string | null;
    localizacao?: string | null;
    status?: string | null;
    package_id?: string | null;
    package_label?: string | null;
    package_code?: string | null;
    package_number?: string | number | null;
    volume?: string | null;
    volume_id?: string | null;
    tracking_code?: string | null;
  };

type ClientRequestItem = string | ClientRequestItemObject;

type ClientRequest = {
  id?: string;
  customer_code?: string;
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
  quantity?: number | string | null;
  quantity_total?: number | string | null;
  items?: ClientRequestItem[];
  created_entities?: CreatedEntities | null;
  operational_links?: CreatedEntities | null;
  operational?: CreatedEntities | null;
  links?: CreatedEntities | null;
  payload?: (CreatedEntities & {
    created_entities?: CreatedEntities | null;
    items?: ClientRequestItem[];
    shipments?: ShipmentRecord[];
    packages?: PackageRecord[];
    volumes?: PackageRecord[];
    delivery_proofs?: DeliveryProof[];
    proofs?: DeliveryProof[];
    documents?: DeliveryProof[];
  }) | null;
  order_id?: string | null;
  pedido_id?: string | null;
  order_number?: string | null;
  num_pedido?: string | null;
  inbound_id?: string | null;
  receiving_id?: string | null;
  receipt_id?: string | null;
  receipt_number?: string | null;
  pick_task_id?: string | null;
  picking_id?: string | null;
  picking_task_id?: string | null;
  pack_task_id?: string | null;
  packing_id?: string | null;
  packing_task_id?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  tracking_code?: string | null;
  delivery_proof_id?: string | null;
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

type AgentAlert = {
  id?: string;
  title?: string;
  titulo?: string;
  message?: string;
  description?: string;
  priority?: string;
  severity?: string;
  created_at?: string | null;
};

type RequestPayload = {
  type: string;
  priority: string;
  description: string;
  items: RequestItemPayload[];
};

type RequestFormState = {
  type: string;
  priority: string;
  itemKey: string;
  quantity: string;
  description: string;
};

type StockItemOption = {
  key: string;
  skuCode: string;
  productName: string;
  quantityAvailable: number;
  category?: string;
  locationId?: string;
};

type OperationalLinks = {
  orderId?: string;
  inboundId?: string;
  pickTaskId?: string;
  packTaskId?: string;
  shipmentId?: string;
  trackingCode?: string;
  proofId?: string;
};

type NormalizedRequestItem = RequestItemPayload & {
  unit?: string;
  status?: string;
  requestedQuantity?: number;
  pickedQuantity?: number;
  receivedQuantity?: number;
  expectedQuantity?: number;
  packedQuantity?: number;
  packageLabel?: string;
  trackingCode?: string;
  operationalLinks: OperationalLinks;
};

type RequestHistoryRow = {
  id: string;
  reference: string;
  title: string;
  description: string;
  type?: string;
  status: string;
  priority?: string;
  date?: string | null;
  updatedAt?: string | null;
  requestedBy?: string;
  customerCode?: string;
  items: NormalizedRequestItem[];
  quantityTotal: number;
  operationalLinks: OperationalLinks;
  packages: PackageRecord[];
  shipments: ShipmentRecord[];
  proofs: DeliveryProof[];
  wmsSnapshot?: RequestWmsSnapshot;
};

type ActivityRow = {
  id: string;
  kind: "Pedido" | "Solicitação";
  reference: string;
  title: string;
  status: string;
  detail: string;
  date?: string | null;
  priority?: string;
  items?: NormalizedRequestItem[];
  operationalLinks?: OperationalLinks;
};

type QueueKey = "receiving" | "putaway" | "picking" | "packing" | "expedition";

type WmsStepKey =
  | "request"
  | "reservation"
  | "picking"
  | "packing"
  | "expedition"
  | "proof";

type WmsStepState = "complete" | "active" | "pending" | "blocked";

type WarehouseTaskTimelineEvent = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  actor?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  at?: string | null;
};

type WarehouseTaskItem = {
  id?: string | null;
  sku?: string | null;
  sku_code?: string | null;
  name?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  expected_quantity?: number | string | null;
  expected_qty?: number | string | null;
  picked_quantity?: number | string | null;
  picked_qty?: number | string | null;
  packed_quantity?: number | string | null;
  packed_qty?: number | string | null;
  qty_packed?: number | string | null;
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
};

type WarehouseTask = {
  id?: string | null;
  title?: string | null;
  reference?: string | null;
  sku?: string | null;
  customer?: string | null;
  location?: string | null;
  quantity?: number | string | null;
  priority?: string | null;
  status?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  delivered_at?: string | null;
  next_action?: string | null;
  notes?: string | null;
  progress?: number | string | null;
  blocked_reason?: string | null;
  exception_count?: number | string | null;
  items?: WarehouseTaskItem[];
  timeline?: WarehouseTaskTimelineEvent[];
  customer_request_id?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  shipment_id?: string | null;
  shipping_id?: string | null;
  expedition_id?: string | null;
  tracking_code?: string | null;
  carrier?: string | null;
  destination?: string | null;
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

type OpsQueue = {
  key?: string | null;
  name?: string | null;
  tasks?: WarehouseTask[];
  items?: WarehouseTask[];
};

type WarehouseOpsResponse = {
  queues?: Record<string, OpsQueue> | OpsQueue[];
  lanes?: Array<{
    id?: string | null;
    title?: string | null;
    items?: WarehouseTask[];
  }>;
  alerts?: AgentAlert[];
  agent_summary?: string | null;
  updated_at?: string | null;
  generated_at?: string | null;
};

type WmsOverviewPayload = {
  queues?: WarehouseOpsResponse["queues"];
  lanes?: WarehouseOpsResponse["lanes"];
  shipments?: ShipmentRecord[];
  packages?: PackageRecord[];
  volumes?: PackageRecord[];
  delivery_proofs?: DeliveryProof[];
  proofs?: DeliveryProof[];
  documents?: DeliveryProof[];
};

type PackageRecord = WarehouseTaskItem & {
  order_id?: string | null;
  order_number?: string | null;
  customer_request_id?: string | null;
  shipment_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  blocked_reason?: string | null;
};

type DeliveryProof = {
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

type ShipmentRecord = {
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
  total_units?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
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

type WmsTaskMatch = {
  queue: QueueKey;
  label: string;
  task: WarehouseTask;
};

type WmsStep = {
  key: WmsStepKey;
  label: string;
  description: string;
  state: WmsStepState;
  detail: string;
  date?: string | null;
  icon: LucideIcon;
};

type VolumeSummary = {
  id: string;
  label: string;
  title: string;
  code?: string;
  status?: string;
  location?: string;
  trackingCode?: string;
  expectedQuantity?: number;
  pickedQuantity?: number;
  packedQuantity?: number;
  delta?: number;
  hasDivergence: boolean;
};

type ShipmentSummary = {
  id: string;
  label: string;
  status?: string;
  trackingCode?: string;
  carrier?: string;
  destination?: string;
  quantity?: number;
  createdAt?: string | null;
  dueAt?: string | null;
  deliveredAt?: string | null;
};

type ProofSummary = {
  id: string;
  label: string;
  status?: string;
  signedAt?: string | null;
  url?: string;
};

type WmsTimelineEntry = {
  id: string;
  label: string;
  status?: string;
  date?: string | null;
  detail?: string;
  queue?: QueueKey;
};

type AiClientMessage = {
  title: string;
  body: string;
  tone: "info" | "success" | "attention" | "blocked";
};

type RequestWmsSnapshot = {
  tasks: WmsTaskMatch[];
  steps: WmsStep[];
  timeline: WmsTimelineEntry[];
  volumes: VolumeSummary[];
  shipments: ShipmentSummary[];
  proofs: ProofSummary[];
  aiMessage: AiClientMessage;
  activeStep?: WmsStep;
  completedSteps: number;
  totalSteps: number;
  hasDetailedWms: boolean;
  hasPhysicalEvidence: boolean;
};

const overviewQueryKey = ["client-portal-overview"];
const wmsQueryKey = ["client-portal-wms"];

const defaultRequestForm: RequestFormState = {
  type: "retirada",
  priority: "normal",
  itemKey: "",
  quantity: "1",
  description: "",
};

const requestTypes = [
  { value: "retirada", label: "Retirada" },
  { value: "recebimento", label: "Recebimento" },
  { value: "inventario", label: "Inventário" },
  { value: "ajuste", label: "Ajuste de estoque" },
  { value: "financeiro", label: "Financeiro" },
  { value: "suporte", label: "Suporte operacional" },
] as const;

const requestPriorities = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
] as const;

const queueLabels: Record<QueueKey, string> = {
  receiving: "Recebimento",
  putaway: "Endereçamento",
  picking: "Picking",
  packing: "Packing",
  expedition: "Expedição",
};

const queueAliases: Record<string, QueueKey> = {
  inbound: "receiving",
  entrada: "receiving",
  recebimento: "receiving",
  receiving: "receiving",
  putaway: "putaway",
  armazenagem: "putaway",
  enderecamento: "putaway",
  picking: "picking",
  separacao: "picking",
  packing: "packing",
  conferencia: "packing",
  embalagem: "packing",
  expedition: "expedition",
  expedicao: "expedition",
  shipping: "expedition",
};

const terminalWmsStatuses = new Set([
  "completed",
  "concluido",
  "concluida",
  "delivered",
  "entregue",
  "received",
  "recebido",
  "recebida",
  "closed",
  "encerrado",
  "encerrada",
  "resolved",
  "resolvido",
  "resolvida",
  "paid",
  "pago",
]);

const blockedWmsStatuses = new Set([
  "blocked",
  "bloqueado",
  "bloqueada",
  "divergence",
  "divergencia",
  "exception",
  "exception_found",
  "shortage",
  "missing",
  "damaged",
  "avaria",
  "rejected",
  "rejeitado",
  "rejeitada",
  "cancelled",
  "canceled",
  "cancelado",
  "cancelada",
]);

const wmsStepMeta: Array<{
  key: WmsStepKey;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    key: "request",
    label: "Solicitação",
    description: "Pedido recebido no portal",
    icon: ClipboardList,
  },
  {
    key: "reservation",
    label: "Pedido WMS",
    description: "Reserva criada para a retirada",
    icon: ClipboardCheck,
  },
  {
    key: "picking",
    label: "Separação",
    description: "Itens localizados e separados",
    icon: PackageOpen,
  },
  {
    key: "packing",
    label: "Volumes",
    description: "Conferência e embalagem",
    icon: PackageCheck,
  },
  {
    key: "expedition",
    label: "Expedição",
    description: "Coleta, romaneio ou entrega",
    icon: Truck,
  },
  {
    key: "proof",
    label: "Comprovante",
    description: "Assinatura, foto ou PDF",
    icon: FileCheck2,
  },
];

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return dateFormatter.format(date);
}

function formatMoney(value: unknown) {
  return moneyFormatter.format(toNumber(value));
}

function formatNumber(value: unknown) {
  return numberFormatter.format(toNumber(value));
}

function optionalNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = toNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function normalizeSlug(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeStatus(status?: string) {
  if (!status) return "Pendente";
  return status.replace(/_/g, " ");
}

function statusBadgeClass(status?: string) {
  const normalized = (status ?? "").toLowerCase();

  if (
    normalized.includes("entreg") ||
    normalized.includes("resol") ||
    normalized.includes("aprov") ||
    normalized.includes("approved") ||
    normalized.includes("pago") ||
    normalized.includes("receiv") ||
    normalized.includes("received") ||
    normalized.includes("conclu") ||
    normalized.includes("closed") ||
    normalized.includes("completed") ||
    normalized.includes("fatur")
  ) {
    return "border-primary/20 bg-primary/10 text-primary";
  }

  if (
    normalized.includes("atras") ||
    normalized.includes("venc") ||
    normalized.includes("cancel") ||
    normalized.includes("reject") ||
    normalized.includes("rejeit") ||
    normalized.includes("crítico") ||
    normalized.includes("critico")
  ) {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  if (
    normalized.includes("pend") ||
    normalized.includes("abert") ||
    normalized.includes("open") ||
    normalized.includes("submitted") ||
    normalized.includes("progress") ||
    normalized.includes("separa") ||
    normalized.includes("anális") ||
    normalized.includes("analis")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-border bg-white/70 text-muted-foreground";
}

function priorityLabel(priority?: string) {
  const normalized = (priority ?? "normal").toLowerCase();
  if (normalized === "critical" || normalized === "critica") return "Crítica";
  if (normalized === "high" || normalized === "alta") return "Alta";
  if (normalized === "low" || normalized === "baixa") return "Baixa";
  return "Normal";
}

function priorityBadgeClass(priority?: string) {
  const normalized = (priority ?? "normal").toLowerCase();
  if (normalized === "critical" || normalized === "critica") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (normalized === "high" || normalized === "alta") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

function requestTypeLabel(type?: string) {
  const normalized = (type ?? "retirada").toLowerCase();
  return (
    requestTypes.find((item) => item.value === normalized)?.label ??
    normalizeStatus(type)
  );
}

function requestStatusLabel(status?: string) {
  const normalized = normalizeSlug(status || "open");

  if (["approved", "aprovada", "aprovado"].includes(normalized)) {
    return "Aprovada";
  }
  if (["rejected", "rejeitada", "rejeitado"].includes(normalized)) {
    return "Rejeitada";
  }
  if (
    ["closed", "encerrada", "encerrado", "concluida", "concluido"].includes(
      normalized,
    )
  ) {
    return "Encerrada";
  }
  if (
    ["in-progress", "em-execucao", "execucao", "separacao", "picking"].includes(
      normalized,
    )
  ) {
    return "Em operação";
  }
  if (["pending", "pendente", "em-analise", "analise"].includes(normalized)) {
    return "Em análise";
  }
  if (["submitted", "enviada", "enviado"].includes(normalized)) {
    return "Enviada";
  }
  return "Aberta";
}

function requestStatusBadgeClass(status?: string) {
  const normalized = normalizeSlug(status || "open");

  if (
    ["approved", "aprovada", "aprovado", "closed", "concluida", "concluido"].includes(
      normalized,
    )
  ) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (["rejected", "rejeitada", "rejeitado"].includes(normalized)) {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (
    ["in-progress", "em-execucao", "execucao", "separacao", "picking"].includes(
      normalized,
    )
  ) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function hasOperationalLinks(links?: OperationalLinks) {
  return Boolean(
    links?.orderId ||
      links?.inboundId ||
      links?.pickTaskId ||
      links?.packTaskId ||
      links?.shipmentId ||
      links?.trackingCode ||
      links?.proofId,
  );
}

function requestStatusHint(request: RequestHistoryRow) {
  const normalized = normalizeSlug(request.status || "open");

  if (["approved", "aprovada", "aprovado"].includes(normalized)) {
    return hasOperationalLinks(request.operationalLinks)
      ? "Aprovada e vinculada à operação"
      : "Aprovada, sem vínculo operacional informado";
  }
  if (["rejected", "rejeitada", "rejeitado"].includes(normalized)) {
    return "Sem execução operacional";
  }
  if (
    ["closed", "encerrada", "encerrado", "concluida", "concluido"].includes(
      normalized,
    )
  ) {
    return "Fluxo encerrado para o cliente";
  }
  if (
    ["in-progress", "em-execucao", "execucao", "separacao", "picking"].includes(
      normalized,
    )
  ) {
    return "Operação WMS em andamento";
  }
  if (["pending", "pendente", "em-analise", "analise"].includes(normalized)) {
    return "Em triagem pela operação";
  }
  if (["submitted", "enviada", "enviado"].includes(normalized)) {
    return "Recebida e aguardando triagem";
  }
  return "Aberta para análise operacional";
}

function formatQuantity(value: unknown, unit?: string) {
  return `${formatNumber(value)} ${unit || "peça(s)"}`;
}

function mergeOperationalLinks(...links: OperationalLinks[]) {
  return links.reduce<OperationalLinks>(
    (merged, link) => ({
      orderId: merged.orderId ?? link.orderId,
      inboundId: merged.inboundId ?? link.inboundId,
      pickTaskId: merged.pickTaskId ?? link.pickTaskId,
      packTaskId: merged.packTaskId ?? link.packTaskId,
      shipmentId: merged.shipmentId ?? link.shipmentId,
      trackingCode: merged.trackingCode ?? link.trackingCode,
      proofId: merged.proofId ?? link.proofId,
    }),
    {},
  );
}

function getOperationalLinks(source?: OperationalLinkSource | null) {
  const payload = source?.payload ?? {};
  const created = source?.created_entities ?? payload.created_entities ?? {};
  const operational =
    source?.operational_links ?? source?.operational ?? source?.links ?? {};

  return {
    orderId: firstText(
      source?.order_id,
      source?.pedido_id,
      source?.order_number,
      source?.num_pedido,
      created.order_id,
      created.pedido_id,
      created.order_number,
      created.num_pedido,
      operational.order_id,
      operational.pedido_id,
      operational.order_number,
      operational.num_pedido,
      payload.order_id,
      payload.pedido_id,
      payload.order_number,
      payload.num_pedido,
    ),
    inboundId: firstText(
      source?.inbound_id,
      source?.receiving_id,
      source?.receipt_id,
      source?.receipt_number,
      created.inbound_id,
      created.receiving_id,
      created.receipt_id,
      created.receipt_number,
      operational.inbound_id,
      operational.receiving_id,
      operational.receipt_id,
      operational.receipt_number,
      payload.inbound_id,
      payload.receiving_id,
      payload.receipt_id,
      payload.receipt_number,
    ),
    pickTaskId: firstText(
      source?.pick_task_id,
      source?.picking_id,
      source?.picking_task_id,
      created.pick_task_id,
      created.picking_id,
      created.picking_task_id,
      operational.pick_task_id,
      operational.picking_id,
      operational.picking_task_id,
      payload.pick_task_id,
      payload.picking_id,
      payload.picking_task_id,
    ),
    packTaskId: firstText(
      source?.pack_task_id,
      source?.packing_id,
      source?.packing_task_id,
      created.pack_task_id,
      created.packing_id,
      created.packing_task_id,
      operational.pack_task_id,
      operational.packing_id,
      operational.packing_task_id,
      payload.pack_task_id,
      payload.packing_id,
      payload.packing_task_id,
    ),
    shipmentId: firstText(
      source?.shipment_id,
      source?.shipping_id,
      source?.expedition_id,
      created.shipment_id,
      created.shipping_id,
      created.expedition_id,
      operational.shipment_id,
      operational.shipping_id,
      operational.expedition_id,
      payload.shipment_id,
      payload.shipping_id,
      payload.expedition_id,
    ),
    trackingCode: firstText(
      source?.tracking_code,
      created.tracking_code,
      operational.tracking_code,
      payload.tracking_code,
    ),
    proofId: firstText(
      source?.delivery_proof_id,
      source?.proof_id,
      source?.document_id,
      created.delivery_proof_id,
      created.proof_id,
      created.document_id,
      operational.delivery_proof_id,
      operational.proof_id,
      operational.document_id,
      payload.delivery_proof_id,
      payload.proof_id,
      payload.document_id,
    ),
  };
}

function getInventoryItemSku(item: InventoryItem) {
  return String(
    item.sku_code ?? item.sku ?? item.cod_sku ?? item.client_item_code ?? "",
  ).trim();
}

function getInventoryItemName(item: InventoryItem) {
  return String(
    item.product_name ?? item.name ?? item.produto ?? "Produto sem nome",
  ).trim();
}

function getInventoryItemLocation(item: InventoryItem) {
  const location = item.location_id ?? item.location ?? item.localizacao;
  return location ? String(location).trim() : undefined;
}

function getInventoryItemQuantity(item: InventoryItem) {
  return firstNumber(
    item.qty_available,
    item.available_pieces,
    item.pieces,
    item.total_pieces,
    item.qtde,
  );
}

function normalizeStockItems(items?: InventoryItem[]) {
  return (items ?? []).flatMap<StockItemOption>((item, index) => {
    const skuCode = getInventoryItemSku(item);
    if (!skuCode) return [];

    const locationId = getInventoryItemLocation(item);
    const fallbackKey = item.id ?? index;

    return [
      {
        key: `${skuCode}:${locationId ?? fallbackKey}`,
        skuCode,
        productName: getInventoryItemName(item),
        quantityAvailable: getInventoryItemQuantity(item),
        category: item.category ?? item.categoria,
        locationId,
      },
    ];
  });
}

function normalizeRequestItems(items?: ClientRequestItem[]) {
  if (!Array.isArray(items)) return [];

  return items.flatMap<NormalizedRequestItem>((item) => {
    if (typeof item === "string") {
      const productName = item.trim();
      if (!productName) return [];

      return [
        {
          sku_code: "-",
          product_name: productName,
          quantity: 0,
          operationalLinks: {},
        },
      ];
    }

    const skuCode = firstText(item.sku_code, item.sku, item.cod_sku) ?? "";
    const rawProductName =
      item.product_name ?? item.product ?? item.name ?? item.produto;
    const productName = String(rawProductName ?? "Produto sem nome").trim();
    const quantity = firstNumber(
      item.quantity,
      item.qty,
      item.requested_quantity,
      item.requested_qty,
      item.qtd,
      item.qtde,
    );
    const location = item.location_id ?? item.location ?? item.localizacao;
    const locationId = location ? String(location).trim() : undefined;
    const unit = firstText(item.unit, item.unidade);
    const requestedQuantity = optionalNumber(
      item.requested_quantity,
      item.requested_qty,
      item.quantity,
      item.qty,
      item.qtd,
      item.qtde,
    );
    const pickedQuantity = optionalNumber(item.picked_quantity, item.picked_qty);
    const receivedQuantity = optionalNumber(
      item.received_quantity,
      item.received_qty,
    );
    const expectedQuantity = optionalNumber(
      item.expected_quantity,
      item.expected_qty,
      item.requested_quantity,
      item.requested_qty,
      item.quantity,
      item.qty,
    );
    const packedQuantity = optionalNumber(
      item.packed_quantity,
      item.packed_qty,
      item.qty_packed,
    );
    const packageLabel = firstText(
      item.package_label,
      item.package_code,
      item.volume,
      item.volume_id,
      item.package_id,
      item.package_number,
    );
    const trackingCode = firstText(item.tracking_code);

    if (!skuCode && !rawProductName) return [];

    return [
      {
        sku_code: skuCode || "-",
        product_name: productName,
        quantity,
        ...(unit ? { unit } : {}),
        ...(locationId ? { location_id: locationId } : {}),
        ...(item.status ? { status: String(item.status) } : {}),
        ...(requestedQuantity !== undefined ? { requestedQuantity } : {}),
        ...(pickedQuantity !== undefined ? { pickedQuantity } : {}),
        ...(receivedQuantity !== undefined ? { receivedQuantity } : {}),
        ...(expectedQuantity !== undefined ? { expectedQuantity } : {}),
        ...(packedQuantity !== undefined ? { packedQuantity } : {}),
        ...(packageLabel ? { packageLabel } : {}),
        ...(trackingCode ? { trackingCode } : {}),
        operationalLinks: getOperationalLinks(item),
      },
    ];
  });
}

function formatRequestItemSummary(items?: NormalizedRequestItem[]) {
  if (!items?.length) return undefined;

  const [first, ...rest] = items;
  const summary = `${first.sku_code} · ${formatQuantity(
    first.quantity,
    first.unit,
  )}`;

  return rest.length ? `${summary} +${rest.length} item(ns)` : summary;
}

function buildRequestDescription({
  type,
  item,
  observation,
}: {
  type: string;
  item: RequestItemPayload;
  observation: string;
}) {
  const base = `${requestTypeLabel(type)} de ${formatNumber(
    item.quantity,
  )} peça(s) do SKU ${item.sku_code} (${item.product_name}).`;

  return observation ? `${base} Observação: ${observation}` : base;
}

function getRequestList(requests?: RequestsSummary | ClientRequest[]) {
  if (Array.isArray(requests)) return requests;
  return requests?.recent ?? requests?.items ?? [];
}

function getRequestItems(request: ClientRequest) {
  if (Array.isArray(request.items)) return request.items;
  if (Array.isArray(request.payload?.items)) return request.payload.items;
  return [];
}

function getRequestQuantityTotal(
  request: ClientRequest,
  items: NormalizedRequestItem[],
) {
  const explicit = optionalNumber(request.quantity_total, request.quantity);
  if (explicit !== undefined && explicit > 0) return explicit;

  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function buildRequestHistoryRow(
  request: ClientRequest,
  index: number,
): RequestHistoryRow {
  const items = normalizeRequestItems(getRequestItems(request));
  const itemLinks = mergeOperationalLinks(
    ...items.map((item) => item.operationalLinks),
  );
  const operationalLinks = mergeOperationalLinks(
    getOperationalLinks(request),
    itemLinks,
  );
  const type = firstText(request.type, request.tipo);
  const description = firstText(request.description, request.descricao) ?? "";
  const title =
    firstText(request.title, request.titulo) ||
    description ||
    `${requestTypeLabel(type)} do cliente`;
  const reference =
    firstText(request.protocol, request.protocolo, request.id) ??
    `Solicitação ${index + 1}`;

  return {
    id: firstText(request.id, reference) ?? `request-${index}`,
    reference,
    title,
    description,
    type,
    status: firstText(request.status) ?? "open",
    priority: firstText(request.priority, request.prioridade),
    date: request.created_at,
    updatedAt: request.updated_at,
    requestedBy: firstText(
      request.requested_by?.name,
      request.requested_by?.email,
      "Portal do cliente",
    ),
    customerCode: firstText(request.customer_code),
    items,
    quantityTotal: getRequestQuantityTotal(request, items),
    operationalLinks,
    packages: getRequestPackageRecords(request),
    shipments: getRequestShipmentRecords(request),
    proofs: getRequestProofRecords(request),
  };
}

function getInvoiceList(invoices?: BillingSummary | Invoice[]) {
  if (Array.isArray(invoices)) return invoices;
  return invoices?.recent ?? invoices?.items ?? [];
}

function isRequestHistoryRow(
  request: ClientRequest | RequestHistoryRow,
): request is RequestHistoryRow {
  return "operationalLinks" in request && "quantityTotal" in request;
}

function toQueueKey(value?: string | null) {
  return queueAliases[normalizeSlug(value)];
}

function normalizeWmsStatus(value?: string | null) {
  return normalizeSlug(value).replace(/-/g, "_");
}

function wmsStatusLabel(status?: string | null) {
  const normalized = normalizeWmsStatus(status);

  if (normalized === "ready_to_dispatch") return "Pronta para expedição";
  if (normalized === "in_progress") return "Em execução";
  if (normalized === "completed") return "Concluída";
  if (normalized === "delivered") return "Entregue";
  if (normalized === "received") return "Recebida";
  if (normalized === "checking") return "Em conferência";
  if (normalized === "planned") return "Planejada";
  if (normalized === "ready") return "Pronta";
  if (normalized === "dispatched") return "Despachada";
  if (normalized === "packed") return "Embalada";
  if (normalized === "reserved") return "Reservada";
  if (normalized === "divergence") return "Divergente";

  return normalizeStatus(status || "Sem status");
}

function isTerminalWmsStatus(status?: string | null) {
  const normalized = normalizeWmsStatus(status);
  return (
    terminalWmsStatuses.has(normalized) ||
    terminalWmsStatuses.has(normalizeSlug(status))
  );
}

function isBlockedWmsStatus(status?: string | null) {
  const normalized = normalizeWmsStatus(status);
  return (
    blockedWmsStatuses.has(normalized) ||
    blockedWmsStatuses.has(normalizeSlug(status))
  );
}

function isTaskBlocked(task?: WarehouseTask | null) {
  if (!task) return false;
  return (
    Boolean(task.blocked_reason) ||
    isBlockedWmsStatus(task.status) ||
    firstNumber(task.exception_count) > 0
  );
}

function taskDate(task?: WarehouseTask | null) {
  return (
    task?.delivered_at ??
    task?.completed_at ??
    task?.updated_at ??
    task?.due_at ??
    task?.created_at ??
    null
  );
}

function taskTitle(task: WarehouseTask) {
  return firstText(task.title, task.reference, task.order_number, task.id) ?? "-";
}

function timelineDate(event: WarehouseTaskTimelineEvent) {
  return (
    event.occurred_at ??
    event.updated_at ??
    event.created_at ??
    event.at ??
    null
  );
}

function referenceMatches(left?: string | null, right?: string | null) {
  const leftSlug = normalizeSlug(left);
  const rightSlug = normalizeSlug(right);

  if (!leftSlug || !rightSlug) return false;
  if (leftSlug === rightSlug) return true;

  const shortest = Math.min(leftSlug.length, rightSlug.length);
  if (shortest < 6) return false;

  return leftSlug.includes(rightSlug) || rightSlug.includes(leftSlug);
}

function dedupeBy<T>(items: T[], getKey: (item: T, index: number) => string) {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = getKey(item, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectOpsTaskMatches(
  ...sources: Array<WarehouseOpsResponse | WmsOverviewPayload | undefined>
) {
  const matches: WmsTaskMatch[] = [];

  sources.forEach((source) => {
    const queues = source?.queues;

    if (Array.isArray(queues)) {
      queues.forEach((queue) => {
        const queueKey = toQueueKey(queue.key ?? queue.name);
        if (!queueKey) return;

        (queue.tasks ?? queue.items ?? []).forEach((task) => {
          matches.push({ queue: queueKey, label: queueLabels[queueKey], task });
        });
      });
    } else if (queues) {
      Object.entries(queues).forEach(([rawKey, queue]) => {
        const queueKey = toQueueKey(rawKey) ?? toQueueKey(queue?.key ?? queue?.name);
        if (!queueKey || !queue) return;

        (queue.tasks ?? queue.items ?? []).forEach((task) => {
          matches.push({ queue: queueKey, label: queueLabels[queueKey], task });
        });
      });
    }

    source?.lanes?.forEach((lane) => {
      const queueKey = toQueueKey(lane.id ?? lane.title);
      if (!queueKey) return;

      (lane.items ?? []).forEach((task) => {
        matches.push({ queue: queueKey, label: queueLabels[queueKey], task });
      });
    });
  });

  return dedupeBy(matches, (match, index) =>
    [
      match.queue,
      match.task.id,
      match.task.reference,
      match.task.customer_request_id,
      index,
    ]
      .filter(Boolean)
      .join(":"),
  );
}

function requestReferenceTokens(request: RequestHistoryRow) {
  return [
    request.id,
    request.reference,
    request.title,
    request.operationalLinks.orderId,
    request.operationalLinks.inboundId,
    request.operationalLinks.pickTaskId,
    request.operationalLinks.packTaskId,
    request.operationalLinks.shipmentId,
    request.operationalLinks.trackingCode,
    request.operationalLinks.proofId,
    ...request.items.flatMap((item) => [
      item.operationalLinks.orderId,
      item.operationalLinks.inboundId,
      item.operationalLinks.pickTaskId,
      item.operationalLinks.packTaskId,
      item.operationalLinks.shipmentId,
      item.operationalLinks.trackingCode,
      item.operationalLinks.proofId,
      item.packageLabel,
      item.trackingCode,
    ]),
  ].filter(Boolean) as string[];
}

function taskReferenceTokens(task: WarehouseTask) {
  return [
    task.id,
    task.reference,
    task.title,
    task.customer_request_id,
    task.order_id,
    task.order_number,
    task.shipment_id,
    task.shipping_id,
    task.expedition_id,
    task.tracking_code,
    task.sku,
    ...(task.items ?? []).flatMap((item) => [
      item.package_id,
      item.package_label,
      item.package_code,
      item.volume,
      item.volume_id,
      item.tracking_code,
      item.sku,
      item.sku_code,
    ]),
  ].filter(Boolean) as string[];
}

function taskMatchesRequest(match: WmsTaskMatch, request: RequestHistoryRow) {
  const requestTokens = requestReferenceTokens(request);
  const taskTokens = taskReferenceTokens(match.task);

  return requestTokens.some((requestToken) =>
    taskTokens.some((taskToken) => referenceMatches(requestToken, taskToken)),
  );
}

function recordMatchesRequest(
  record: {
    id?: string | null;
    order_id?: string | null;
    order_number?: string | null;
    customer_request_id?: string | null;
    shipment_id?: string | null;
    tracking_code?: string | null;
  },
  request: RequestHistoryRow,
) {
  const requestTokens = requestReferenceTokens(request);
  const recordTokens = [
    record.id,
    record.order_id,
    record.order_number,
    record.customer_request_id,
    record.shipment_id,
    record.tracking_code,
  ].filter(Boolean) as string[];

  return requestTokens.some((requestToken) =>
    recordTokens.some((recordToken) => referenceMatches(requestToken, recordToken)),
  );
}

function packageLabel(record: WarehouseTaskItem, index: number) {
  const explicitLabel = firstText(
    record.package_label,
    record.package_code,
    record.volume,
    record.volume_id,
    record.package_id,
    record.package_number,
    record.tracking_code,
  );

  if (!explicitLabel) return `Volume ${index + 1}`;
  return normalizeSlug(explicitLabel).startsWith("volume")
    ? explicitLabel
    : `Volume ${explicitLabel}`;
}

function buildVolumeFromItem(
  item: WarehouseTaskItem,
  index: number,
  fallback: {
    queue?: QueueKey;
    task?: WarehouseTask;
  } = {},
): VolumeSummary {
  const expectedQuantity = optionalNumber(
    item.expected_quantity,
    item.expected_qty,
    item.picked_quantity,
    item.picked_qty,
    item.quantity,
    item.packed_quantity,
    item.packed_qty,
    item.qty_packed,
  );
  const pickedQuantity = optionalNumber(
    item.picked_quantity,
    item.picked_qty,
    item.quantity,
  );
  const packedQuantity = optionalNumber(
    item.packed_quantity,
    item.packed_qty,
    item.qty_packed,
    item.quantity,
  );
  const delta =
    expectedQuantity !== undefined && packedQuantity !== undefined
      ? packedQuantity - expectedQuantity
      : undefined;
  const hasDivergence =
    (delta !== undefined && delta !== 0) ||
    isBlockedWmsStatus(item.status) ||
    isTaskBlocked(fallback.task);
  const title =
    firstText(item.product_name, item.name, item.description, item.sku, item.sku_code) ??
    `${fallback.queue ? queueLabels[fallback.queue] : "Volume"} ${index + 1}`;
  const label = packageLabel(item, index);

  return {
    id:
      firstText(
        item.id,
        item.package_id,
        item.package_label,
        item.volume_id,
        item.tracking_code,
        `${fallback.task?.id ?? fallback.queue ?? "volume"}:${index}`,
      ) ?? `volume-${index}`,
    label,
    title,
    code: firstText(item.sku_code, item.sku),
    status: firstText(item.status, fallback.task?.status),
    location: firstText(item.location, item.location_id, fallback.task?.location),
    trackingCode: firstText(item.tracking_code, fallback.task?.tracking_code),
    expectedQuantity,
    pickedQuantity,
    packedQuantity,
    delta,
    hasDivergence,
  };
}

function getRequestPackageRecords(
  request: ClientRequest | RequestHistoryRow,
): PackageRecord[] {
  if (!isRequestHistoryRow(request)) {
    return [
      ...(request.packages ?? []),
      ...(request.volumes ?? []),
      ...(request.payload?.packages ?? []),
      ...(request.payload?.volumes ?? []),
    ];
  }

  if (request.packages.length) return request.packages;

  return request.items.flatMap<PackageRecord>((item, index) => {
    if (!item.packageLabel && !item.trackingCode && item.packedQuantity === undefined) {
      return [];
    }

    return [
      {
        id: `${request.id}:item-volume:${index}`,
        package_label: item.packageLabel,
        tracking_code: item.trackingCode,
        sku_code: item.sku_code,
        product_name: item.product_name,
        quantity: item.quantity,
        expected_quantity: item.expectedQuantity ?? item.requestedQuantity,
        picked_quantity: item.pickedQuantity,
        packed_quantity: item.packedQuantity,
        status: item.status,
        location: item.location_id,
      },
    ];
  });
}

function getOverviewPackageRecords(data?: ClientOverview) {
  return [
    ...(data?.packages ?? []),
    ...(data?.volumes ?? []),
    ...(data?.wms?.packages ?? []),
    ...(data?.wms?.volumes ?? []),
  ];
}

function shipmentId(record: ShipmentRecord) {
  return firstText(
    record.id,
    record.shipment_id,
    record.shipping_id,
    record.expedition_id,
    record.tracking_code,
  );
}

function shipmentToSummary(record: ShipmentRecord, index: number): ShipmentSummary {
  const id = shipmentId(record) ?? `shipment-${index}`;

  return {
    id,
    label: firstText(record.order_number, record.shipment_id, record.id, id) ?? id,
    status: firstText(record.status),
    trackingCode: firstText(record.tracking_code),
    carrier: firstText(record.carrier),
    destination: firstText(record.destination),
    quantity: optionalNumber(record.total_units, record.quantity, record.qty),
    createdAt: record.created_at ?? record.updated_at ?? null,
    dueAt: record.due_at ?? null,
    deliveredAt: record.delivered_at ?? null,
  };
}

function taskToShipmentSummary(task: WarehouseTask, index: number): ShipmentSummary {
  const id =
    firstText(
      task.shipment_id,
      task.shipping_id,
      task.expedition_id,
      task.reference,
      task.id,
    ) ?? `shipment-task-${index}`;

  return {
    id,
    label: firstText(task.title, task.reference, id) ?? id,
    status: firstText(task.status),
    trackingCode: firstText(task.tracking_code, task.sku),
    carrier: firstText(task.carrier),
    destination: firstText(task.destination, task.location),
    quantity: optionalNumber(task.quantity),
    createdAt: task.created_at ?? task.updated_at ?? null,
    dueAt: task.due_at ?? null,
    deliveredAt: task.delivered_at ?? null,
  };
}

function getRequestShipmentRecords(
  request: ClientRequest | RequestHistoryRow,
): ShipmentRecord[] {
  if (isRequestHistoryRow(request)) return request.shipments;

  return [
    ...(request.shipments ?? []),
    ...(request.payload?.shipments ?? []),
  ];
}

function getOverviewShipmentRecords(data?: ClientOverview) {
  return [...(data?.shipments ?? []), ...(data?.wms?.shipments ?? [])];
}

function proofId(record: DeliveryProof) {
  return firstText(
    record.id,
    record.proof_id,
    record.document_id,
    record.file_name,
    record.filename,
    record.name,
  );
}

function proofToSummary(record: DeliveryProof, index: number): ProofSummary {
  const id = proofId(record) ?? `proof-${index}`;

  return {
    id,
    label:
      firstText(record.title, record.file_name, record.filename, record.name, id) ??
      id,
    status: firstText(record.status),
    signedAt: record.signed_at ?? record.created_at ?? record.updated_at ?? null,
    url: firstText(record.url, record.href),
  };
}

function getRequestProofRecords(
  request: ClientRequest | RequestHistoryRow,
): DeliveryProof[] {
  if (isRequestHistoryRow(request)) return request.proofs;

  return [
    ...(request.delivery_proofs ?? []),
    ...(request.proofs ?? []),
    ...(request.documents ?? []),
    ...(request.payload?.delivery_proofs ?? []),
    ...(request.payload?.proofs ?? []),
    ...(request.payload?.documents ?? []),
  ];
}

function getOverviewProofRecords(data?: ClientOverview) {
  return [
    ...(data?.delivery_proofs ?? []),
    ...(data?.proofs ?? []),
    ...(data?.documents ?? []),
    ...(data?.wms?.delivery_proofs ?? []),
    ...(data?.wms?.proofs ?? []),
    ...(data?.wms?.documents ?? []),
  ];
}

function buildVolumeSummaries(
  request: RequestHistoryRow,
  taskMatches: WmsTaskMatch[],
  data?: ClientOverview,
) {
  const taskVolumes = taskMatches.flatMap((match) => {
    if (!["packing", "expedition"].includes(match.queue)) return [];

    return (match.task.items ?? []).map((item, index) =>
      buildVolumeFromItem(item, index, {
        queue: match.queue,
        task: match.task,
      }),
    );
  });

  const requestVolumes = getRequestPackageRecords(request).map((record, index) =>
    buildVolumeFromItem(record, index),
  );
  const overviewVolumes = getOverviewPackageRecords(data)
    .filter((record) => recordMatchesRequest(record, request))
    .map((record, index) => buildVolumeFromItem(record, index));

  return dedupeBy(
    [...taskVolumes, ...requestVolumes, ...overviewVolumes],
    (volume) => `${volume.id}:${volume.label}:${volume.code ?? ""}`,
  );
}

function buildShipmentSummaries(
  request: RequestHistoryRow,
  taskMatches: WmsTaskMatch[],
  data?: ClientOverview,
) {
  const taskShipments = taskMatches
    .filter((match) => match.queue === "expedition")
    .map((match, index) => taskToShipmentSummary(match.task, index));
  const requestShipments = getRequestShipmentRecords(request)
    .map((record, index) => shipmentToSummary(record, index));
  const overviewShipments = getOverviewShipmentRecords(data)
    .filter((record) => recordMatchesRequest(record, request))
    .map((record, index) => shipmentToSummary(record, index));
  const linkShipment: ShipmentSummary[] =
    request.operationalLinks.shipmentId || request.operationalLinks.trackingCode
      ? [
          {
            id:
              request.operationalLinks.shipmentId ??
              request.operationalLinks.trackingCode ??
              "shipment-link",
            label:
              request.operationalLinks.shipmentId ??
              request.operationalLinks.trackingCode ??
              "Expedição",
            trackingCode: request.operationalLinks.trackingCode,
          },
        ]
      : [];

  return dedupeBy(
    [...taskShipments, ...requestShipments, ...overviewShipments, ...linkShipment],
    (shipment) => shipment.id,
  );
}

function buildProofSummaries(
  request: RequestHistoryRow,
  taskMatches: WmsTaskMatch[],
  data?: ClientOverview,
) {
  const taskProofs = taskMatches.flatMap((match) => [
    ...(match.task.delivery_proofs ?? []),
    ...(match.task.proofs ?? []),
    ...(match.task.documents ?? []),
  ]);
  const requestProofs = getRequestProofRecords(request);
  const overviewProofs = getOverviewProofRecords(data).filter((record) =>
    recordMatchesRequest(record, request),
  );
  const linkProof: ProofSummary[] = request.operationalLinks.proofId
    ? [
        {
          id: request.operationalLinks.proofId,
          label: request.operationalLinks.proofId,
        },
      ]
    : [];

  return dedupeBy(
    [...taskProofs, ...requestProofs, ...overviewProofs]
      .map((record, index) => proofToSummary(record, index))
      .concat(linkProof),
    (proof) => proof.id,
  );
}

function getFirstTaskByQueue(matches: WmsTaskMatch[], queue: QueueKey) {
  return matches.find((match) => match.queue === queue)?.task;
}

function allRequestItemsPicked(request: RequestHistoryRow) {
  if (!request.items.length) return false;

  return request.items.every((item) => {
    if (item.pickedQuantity === undefined) return false;
    const expected = item.expectedQuantity ?? item.requestedQuantity ?? item.quantity;
    return item.pickedQuantity >= expected;
  });
}

function buildStep(
  key: WmsStepKey,
  state: WmsStepState,
  detail: string,
  date?: string | null,
): WmsStep {
  const meta = wmsStepMeta.find((item) => item.key === key) ?? wmsStepMeta[0];

  return {
    ...meta,
    state,
    detail,
    date,
  };
}

function requestIsRejected(request: RequestHistoryRow) {
  const status = normalizeSlug(request.status);
  return ["rejected", "rejeitada", "rejeitado", "cancelled", "cancelado"].includes(
    status,
  );
}

function requestIsClosed(request: RequestHistoryRow) {
  return [
    "closed",
    "encerrada",
    "encerrado",
    "concluida",
    "concluido",
    "completed",
  ].includes(normalizeSlug(request.status));
}

function buildWmsTimeline(
  request: RequestHistoryRow,
  taskMatches: WmsTaskMatch[],
  shipments: ShipmentSummary[],
  proofs: ProofSummary[],
) {
  const entries: WmsTimelineEntry[] = [
    {
      id: `${request.id}:created`,
      label: "Solicitação recebida",
      status: requestStatusLabel(request.status),
      date: request.date,
      detail: request.reference,
    },
  ];

  if (request.updatedAt && request.updatedAt !== request.date) {
    entries.push({
      id: `${request.id}:updated`,
      label: "Atualização do portal",
      status: requestStatusLabel(request.status),
      date: request.updatedAt,
      detail: requestStatusHint(request),
    });
  }

  taskMatches.forEach((match, taskIndex) => {
    const { task } = match;
    const events = task.timeline ?? [];

    if (!events.length) {
      entries.push({
        id: `${match.queue}:${task.id ?? taskIndex}:fallback`,
        label: `${match.label} ${isTerminalWmsStatus(task.status) ? "concluído" : "em andamento"}`,
        status: task.status ?? undefined,
        date: taskDate(task),
        detail: task.next_action ?? task.notes ?? taskTitle(task),
        queue: match.queue,
      });
      return;
    }

    events.forEach((event: WarehouseTaskTimelineEvent, eventIndex: number) => {
      entries.push({
        id:
          firstText(
            event.id,
            `${match.queue}:${task.id ?? taskIndex}:event:${eventIndex}`,
          ) ?? `${match.queue}:${taskIndex}:${eventIndex}`,
        label:
          firstText(event.title, `${match.label} atualizado`) ??
          `${match.label} atualizado`,
        status: event.status ?? task.status ?? undefined,
        date: timelineDate(event),
        detail: firstText(event.description, event.actor, taskTitle(task)),
        queue: match.queue,
      });
    });
  });

  shipments.forEach((shipment) => {
    if (!shipment.deliveredAt) return;

    entries.push({
      id: `${shipment.id}:delivered`,
      label: "Entrega concluída",
      status: shipment.status,
      date: shipment.deliveredAt,
      detail: shipment.destination ?? shipment.trackingCode ?? shipment.label,
      queue: "expedition",
    });
  });

  proofs.forEach((proof) => {
    entries.push({
      id: `${proof.id}:proof`,
      label: "Comprovante registrado",
      status: proof.status,
      date: proof.signedAt,
      detail: proof.label,
      queue: "expedition",
    });
  });

  return dedupeBy(entries, (entry) => entry.id).sort((left, right) => {
    const leftTime = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

function buildAiClientMessage({
  request,
  steps,
  volumes,
  shipments,
  proofs,
  hasDetailedWms,
}: {
  request: RequestHistoryRow;
  steps: WmsStep[];
  volumes: VolumeSummary[];
  shipments: ShipmentSummary[];
  proofs: ProofSummary[];
  hasDetailedWms: boolean;
}): AiClientMessage {
  const blockedStep = steps.find((step) => step.state === "blocked");
  const activeStep = steps.find((step) => step.state === "active");
  const completedSteps = steps.filter((step) => step.state === "complete").length;
  const deliveredWithoutProof =
    steps.find((step) => step.key === "proof")?.state === "active";
  const divergentVolumes = volumes.filter((volume) => volume.hasDivergence);

  if (blockedStep) {
    return {
      title: "IA: atenção operacional",
      body:
        divergentVolumes.length > 0
          ? `${blockedStep.label} tem divergência em ${formatNumber(
              divergentVolumes.length,
            )} volume(s). A operação precisa resolver a diferença antes de liberar a retirada.`
          : `${blockedStep.label} está segurando o fluxo. A próxima atualização deve explicar a pendência ou liberar a etapa.`,
      tone: "blocked",
    };
  }

  if (deliveredWithoutProof) {
    return {
      title: "IA: entrega concluída",
      body:
        "A expedição indica entrega concluída. Falta o comprovante aparecer no portal para fechar a rastreabilidade do cliente.",
      tone: "attention",
    };
  }

  if (activeStep) {
    return {
      title: "IA: próxima leitura",
      body: `${request.reference} está em ${activeStep.label.toLowerCase()}. ${activeStep.detail}`,
      tone: "info",
    };
  }

  if (completedSteps === steps.length || proofs.length > 0) {
    return {
      title: "IA: fluxo fechado",
      body:
        "Todas as etapas físicas visíveis para esta retirada estão concluídas no portal.",
      tone: "success",
    };
  }

  if (!hasDetailedWms && !hasOperationalLinks(request.operationalLinks)) {
    return {
      title: "IA: aguardando vínculo WMS",
      body:
        "A solicitação está registrada, mas ainda não há pedido físico, picking ou expedição vinculados ao payload recebido.",
      tone: "attention",
    };
  }

  if (shipments.length > 0) {
    return {
      title: "IA: expedição localizada",
      body:
        "Já existe expedição vinculada. Acompanhe tracking, destino e comprovante para concluir a rastreabilidade.",
      tone: "info",
    };
  }

  return {
    title: "IA: solicitação em acompanhamento",
    body:
      "O portal recebeu os dados operacionais disponíveis e vai atualizar esta linha conforme novas etapas físicas forem vinculadas.",
    tone: "info",
  };
}

function buildRequestWmsSnapshot(
  request: RequestHistoryRow,
  allTaskMatches: WmsTaskMatch[],
  data?: ClientOverview,
): RequestWmsSnapshot {
  const taskMatches = allTaskMatches.filter((match) =>
    taskMatchesRequest(match, request),
  );
  const pickingTask = getFirstTaskByQueue(taskMatches, "picking");
  const packingTask = getFirstTaskByQueue(taskMatches, "packing");
  const expeditionTask = getFirstTaskByQueue(taskMatches, "expedition");
  const volumes = buildVolumeSummaries(request, taskMatches, data);
  const shipments = buildShipmentSummaries(request, taskMatches, data);
  const proofs = buildProofSummaries(request, taskMatches, data);
  const hasOrder = Boolean(
    request.operationalLinks.orderId ||
      request.operationalLinks.inboundId ||
      taskMatches.length ||
      ["approved", "aprovada", "aprovado"].includes(normalizeSlug(request.status)) ||
      requestIsClosed(request),
  );
  const hasPicking = Boolean(
    request.operationalLinks.pickTaskId ||
      pickingTask ||
      request.items.some((item) => item.pickedQuantity !== undefined),
  );
  const hasPacking = Boolean(
    request.operationalLinks.packTaskId || packingTask || volumes.length,
  );
  const hasShipment = Boolean(
    request.operationalLinks.shipmentId ||
      request.operationalLinks.trackingCode ||
      expeditionTask ||
      shipments.length,
  );
  const hasProof = Boolean(request.operationalLinks.proofId || proofs.length);
  const delivered = Boolean(
    proofs.length ||
      shipments.some(
        (shipment) =>
          Boolean(shipment.deliveredAt) ||
          normalizeSlug(shipment.status).includes("delivered") ||
          normalizeSlug(shipment.status).includes("entreg"),
      ) ||
      isTerminalWmsStatus(expeditionTask?.status),
  );
  const hasVolumeDivergence = volumes.some((volume) => volume.hasDivergence);
  const rejected = requestIsRejected(request);

  const steps: WmsStep[] = [
    buildStep(
      "request",
      rejected ? "blocked" : "complete",
      rejected
        ? "Solicitação rejeitada ou cancelada"
        : "Protocolo recebido pelo atendimento operacional",
      request.date,
    ),
    buildStep(
      "reservation",
      rejected
        ? "blocked"
        : hasOrder
          ? "complete"
          : ["pending", "pendente", "em-analise", "analise"].includes(
                normalizeSlug(request.status),
              )
            ? "active"
            : "pending",
      hasOrder
        ? request.operationalLinks.orderId
          ? `Pedido ${request.operationalLinks.orderId} vinculado`
          : "Demanda aprovada para execução física"
        : "Aguardando criação do pedido/reserva no WMS",
      request.updatedAt ?? request.date,
    ),
    buildStep(
      "picking",
      isTaskBlocked(pickingTask)
        ? "blocked"
        : hasPacking || hasShipment || hasProof || allRequestItemsPicked(request)
          ? "complete"
          : hasPicking
            ? "active"
            : "pending",
      hasPicking
        ? pickingTask?.next_action ??
            `${formatNumber(
              request.items.reduce(
                (sum, item) => sum + (item.pickedQuantity ?? 0),
                0,
              ),
            )} peça(s) separada(s) até agora`
        : "Separação ainda não iniciada no payload",
      taskDate(pickingTask),
    ),
    buildStep(
      "packing",
      isTaskBlocked(packingTask) || hasVolumeDivergence
        ? "blocked"
        : hasShipment || hasProof || isTerminalWmsStatus(packingTask?.status)
          ? "complete"
          : hasPacking
            ? "active"
            : "pending",
      volumes.length
        ? `${formatNumber(volumes.length)} volume(s) visível(is)${
            hasVolumeDivergence ? " com divergência" : ""
          }`
        : "Volumes ainda não informados",
      taskDate(packingTask),
    ),
    buildStep(
      "expedition",
      isTaskBlocked(expeditionTask)
        ? "blocked"
        : delivered || hasProof
          ? "complete"
          : hasShipment
            ? "active"
            : "pending",
      shipments.length
        ? shipments
            .map((shipment) =>
              [
                shipment.trackingCode,
                shipment.destination,
                shipment.status ? wmsStatusLabel(shipment.status) : undefined,
              ]
                .filter(Boolean)
                .join(" · "),
            )
            .join(" | ")
        : "Expedição ainda não vinculada",
      taskDate(expeditionTask) ?? shipments[0]?.createdAt,
    ),
    buildStep(
      "proof",
      hasProof ? "complete" : delivered ? "active" : "pending",
      hasProof
        ? `${formatNumber(proofs.length)} comprovante(s) registrado(s)`
        : delivered
          ? "Entrega concluída; aguardando comprovante no portal"
          : "Comprovante aparece após a entrega",
      proofs[0]?.signedAt ?? shipments.find((shipment) => shipment.deliveredAt)?.deliveredAt,
    ),
  ];
  const timeline = buildWmsTimeline(request, taskMatches, shipments, proofs);
  const completedSteps = steps.filter((step) => step.state === "complete").length;
  const activeStep =
    steps.find((step) => step.state === "blocked") ??
    steps.find((step) => step.state === "active") ??
    [...steps].reverse().find((step) => step.state === "complete");
  const hasDetailedWms = Boolean(
    taskMatches.length ||
      volumes.length ||
      shipments.length ||
      proofs.length ||
      hasOperationalLinks(request.operationalLinks),
  );

  return {
    tasks: taskMatches,
    steps,
    timeline,
    volumes,
    shipments,
    proofs,
    aiMessage: buildAiClientMessage({
      request,
      steps,
      volumes,
      shipments,
      proofs,
      hasDetailedWms,
    }),
    activeStep,
    completedSteps,
    totalSteps: steps.length,
    hasDetailedWms,
    hasPhysicalEvidence: Boolean(volumes.length || shipments.length || proofs.length),
  };
}

function isWithdrawalRequest(request: RequestHistoryRow) {
  const type = normalizeSlug(request.type);
  const title = normalizeSlug(request.title);
  return type.includes("retirada") || title.includes("retirada");
}

function isOpenWmsSnapshot(snapshot?: RequestWmsSnapshot) {
  if (!snapshot) return false;
  return snapshot.steps.some((step) => ["active", "blocked"].includes(step.state));
}

function stepStateClass(state: WmsStepState) {
  if (state === "complete") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (state === "active") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (state === "blocked") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  return "border-border bg-white/65 text-muted-foreground";
}

function aiToneClass(tone: AiClientMessage["tone"]) {
  if (tone === "success") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (tone === "blocked") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (tone === "attention") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function formatUnitValue(value?: number) {
  return value !== undefined ? `${formatNumber(value)} un.` : "em aberto";
}

function formatDeltaValue(value?: number) {
  if (value === undefined) return "sem leitura";
  if (value === 0) return "sem diverg.";

  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatNumber(Math.abs(value))} un.`;
}

function MetricCard({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="mt-3 truncate text-2xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-border bg-white/70">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function PortalLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full rounded-[16px]" />
        <Skeleton className="h-4 w-96 max-w-full rounded-[12px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-36 rounded-[24px]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[560px] rounded-[24px]" />
        <Skeleton className="h-[560px] rounded-[24px]" />
      </div>
    </div>
  );
}

function EmptyInline({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty className="border-0 py-8 md:py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle2 />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function OperationalLinkBadges({
  links,
  emptyLabel = "Sem vínculo operacional informado",
}: {
  links?: OperationalLinks;
  emptyLabel?: string;
}) {
  const linkItems: Array<{
    label: string;
    value?: string;
    icon: LucideIcon;
  }> = [
    { label: "Pedido", value: links?.orderId, icon: ClipboardList },
    { label: "Recebimento", value: links?.inboundId, icon: PackageCheck },
    { label: "Picking", value: links?.pickTaskId, icon: Link2 },
    { label: "Packing", value: links?.packTaskId, icon: PackageOpen },
    { label: "Expedição", value: links?.shipmentId, icon: Truck },
    { label: "Tracking", value: links?.trackingCode, icon: Route },
    { label: "Comprovante", value: links?.proofId, icon: FileCheck2 },
  ].filter((item) => Boolean(item.value));

  if (!linkItems.length) {
    return (
      <div className="rounded-[16px] border border-border bg-white/55 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {linkItems.map(({ label, value, icon: Icon }) => (
        <Badge
          key={`${label}-${value}`}
          variant="outline"
          className="max-w-full justify-start gap-1.5 border-primary/20 bg-primary/10 text-primary"
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="shrink-0">{label}</span>
          <span className="min-w-0 truncate font-mono">{value}</span>
        </Badge>
      ))}
    </div>
  );
}

function AiClientMessagePanel({ message }: { message: AiClientMessage }) {
  return (
    <div className={cn("rounded-[18px] border px-4 py-3", aiToneClass(message.tone))}>
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{message.title}</div>
          <p className="mt-1 text-sm leading-6 opacity-85">{message.body}</p>
        </div>
      </div>
    </div>
  );
}

function stepStateLabel(state: WmsStepState) {
  if (state === "complete") return "Concluído";
  if (state === "active") return "Em andamento";
  if (state === "blocked") return "Atenção";
  return "Próximo";
}

function WmsStepper({ snapshot }: { snapshot: RequestWmsSnapshot }) {
  return (
    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      {snapshot.steps.map((step, index) => {
        const Icon = step.icon;

        return (
          <div
            key={step.key}
            className={cn(
              "min-w-0 rounded-[18px] border bg-white/58 p-3",
              step.state === "active" && "border-amber-200 bg-amber-50/70",
              step.state === "blocked" &&
                "border-destructive/20 bg-destructive/5",
              step.state === "complete" && "border-primary/20 bg-primary/5",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-[14px] border",
                  stepStateClass(step.state),
                )}
              >
                <Icon className="size-4" />
              </div>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[10px]", stepStateClass(step.state))}
              >
                {stepStateLabel(step.state)}
              </Badge>
            </div>
            <div className="mt-3 text-[11px] font-medium uppercase text-muted-foreground">
              Etapa {index + 1}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {step.label}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {step.detail || step.description}
            </p>
            {step.date ? (
              <div className="mt-2 text-[11px] text-muted-foreground">
                {formatDate(step.date)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function WmsTimeline({ timeline }: { timeline: WmsTimelineEntry[] }) {
  if (!timeline.length) {
    return (
      <div className="rounded-[18px] border border-border bg-white/55 p-4 text-sm text-muted-foreground">
        Linha do tempo ainda não informada pelo WMS.
      </div>
    );
  }

  return (
    <div className="relative pl-5">
      <div className="absolute bottom-3 left-[7px] top-3 w-px bg-border" />
      <div className="flex flex-col gap-3">
        {timeline.slice(-7).map((event) => (
          <div key={event.id} className="relative">
            <CircleDot className="absolute -left-5 top-1 size-3.5 bg-background text-primary" />
            <div className="rounded-[16px] border border-border bg-white/60 px-3 py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {event.label}
                  </div>
                  {event.detail ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {event.detail}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(event.date)}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {event.queue ? (
                  <Badge
                    variant="outline"
                    className="border-border bg-white/70 text-muted-foreground"
                  >
                    {queueLabels[event.queue]}
                  </Badge>
                ) : null}
                {event.status ? (
                  <Badge
                    variant="outline"
                    className={statusBadgeClass(event.status)}
                  >
                    {wmsStatusLabel(event.status)}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FulfillmentEvidence({
  snapshot,
  showEmpty = false,
}: {
  snapshot: RequestWmsSnapshot;
  showEmpty?: boolean;
}) {
  if (!snapshot.hasPhysicalEvidence && !showEmpty) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-[18px] border border-border bg-white/58 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <PackageCheck className="size-3.5" />
          <span>Volumes</span>
        </div>
        {snapshot.volumes.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.volumes.slice(0, 4).map((volume) => (
              <div
                key={volume.id}
                className={cn(
                  "rounded-[14px] border border-border bg-white/70 px-3 py-2",
                  volume.hasDivergence && "border-amber-200 bg-amber-50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {volume.label}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {volume.title}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      volume.hasDivergence
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : statusBadgeClass(volume.status)
                    }
                  >
                    {volume.hasDivergence
                      ? "Divergente"
                      : wmsStatusLabel(volume.status)}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                  <span>Esp. {formatUnitValue(volume.expectedQuantity)}</span>
                  <span>Emb. {formatUnitValue(volume.packedQuantity)}</span>
                  <span>{formatDeltaValue(volume.delta)}</span>
                </div>
                {volume.trackingCode ? (
                  <div className="mt-2 truncate font-mono text-[11px] text-primary">
                    {volume.trackingCode}
                  </div>
                ) : null}
              </div>
            ))}
            {snapshot.volumes.length > 4 ? (
              <div className="text-xs text-muted-foreground">
                + {formatNumber(snapshot.volumes.length - 4)} volume(s)
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Nenhum volume físico informado ainda.
          </p>
        )}
      </div>

      <div className="rounded-[18px] border border-border bg-white/58 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Truck className="size-3.5" />
          <span>Expedição</span>
        </div>
        {snapshot.shipments.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.shipments.slice(0, 3).map((shipment) => (
              <div
                key={shipment.id}
                className="rounded-[14px] border border-border bg-white/70 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {shipment.label}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {shipment.destination ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3" />
                          <span className="truncate">{shipment.destination}</span>
                        </span>
                      ) : null}
                      {shipment.quantity !== undefined ? (
                        <span>{formatUnitValue(shipment.quantity)}</span>
                      ) : null}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={statusBadgeClass(shipment.status)}
                  >
                    {wmsStatusLabel(shipment.status)}
                  </Badge>
                </div>
                {shipment.trackingCode ? (
                  <div className="mt-2 truncate font-mono text-xs text-primary">
                    {shipment.trackingCode}
                  </div>
                ) : null}
                <div className="mt-2 text-xs text-muted-foreground">
                  {shipment.deliveredAt
                    ? `Entregue ${formatDate(shipment.deliveredAt)}`
                    : shipment.dueAt
                      ? `Previsto ${formatDate(shipment.dueAt)}`
                      : formatDate(shipment.createdAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Expedição ainda não vinculada à solicitação.
          </p>
        )}
      </div>

      <div className="rounded-[18px] border border-border bg-white/58 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FileCheck2 className="size-3.5" />
          <span>Comprovante</span>
        </div>
        {snapshot.proofs.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.proofs.slice(0, 3).map((proof) => (
              <div
                key={proof.id}
                className="rounded-[14px] border border-border bg-white/70 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {proof.label}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDate(proof.signedAt)}
                    </div>
                  </div>
                  {proof.url ? (
                    <a
                      href={proof.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      Abrir
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Comprovante aparecerá quando for anexado à entrega.
          </p>
        )}
      </div>
    </div>
  );
}

function RequestWmsPanel({
  snapshot,
  showEmptyEvidence = false,
}: {
  snapshot: RequestWmsSnapshot;
  showEmptyEvidence?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AiClientMessagePanel message={snapshot.aiMessage} />
      <WmsStepper snapshot={snapshot} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <FulfillmentEvidence
          snapshot={snapshot}
          showEmpty={showEmptyEvidence}
        />
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock3 className="size-3.5" />
            <span>Linha do tempo</span>
          </div>
          <WmsTimeline timeline={snapshot.timeline} />
        </div>
      </div>
    </div>
  );
}

function FeaturedWithdrawalCard({
  request,
  isSyncing,
}: {
  request?: RequestHistoryRow;
  isSyncing: boolean;
}) {
  if (!request?.wmsSnapshot) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-base">Acompanhamento WMS físico</CardTitle>
          <CardDescription>
            Retiradas, volumes, expedição e comprovantes vinculados ao cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <EmptyInline
            title="Sem retirada para acompanhar"
            description="Quando houver uma retirada recente, a linha física completa aparecerá aqui."
          />
        </CardContent>
      </Card>
    );
  }

  const snapshot = request.wmsSnapshot;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="border-b border-border/60 bg-primary/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-white text-primary">
                {request.reference}
              </Badge>
              <Badge
                variant="outline"
                className={stepStateClass(snapshot.activeStep?.state ?? "pending")}
              >
                {snapshot.activeStep?.label ?? "WMS"}
              </Badge>
              {isSyncing ? (
                <Badge
                  variant="outline"
                  className="border-border bg-white/70 text-muted-foreground"
                >
                  Sincronizando
                </Badge>
              ) : null}
            </div>
            <CardTitle className="mt-3 text-base">
              Acompanhamento WMS físico
            </CardTitle>
            <CardDescription className="mt-1">
              {request.title}
            </CardDescription>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-[300px]">
            <div className="rounded-[16px] border border-primary/20 bg-white/70 px-3 py-2">
              <div className="text-lg font-semibold text-foreground">
                {snapshot.completedSteps}/{snapshot.totalSteps}
              </div>
              <div className="text-xs text-muted-foreground">etapas</div>
            </div>
            <div className="rounded-[16px] border border-primary/20 bg-white/70 px-3 py-2">
              <div className="text-lg font-semibold text-foreground">
                {formatNumber(snapshot.volumes.length)}
              </div>
              <div className="text-xs text-muted-foreground">volumes</div>
            </div>
            <div className="rounded-[16px] border border-primary/20 bg-white/70 px-3 py-2">
              <div className="text-lg font-semibold text-foreground">
                {formatNumber(snapshot.proofs.length)}
              </div>
              <div className="text-xs text-muted-foreground">comprov.</div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        <RequestWmsPanel snapshot={snapshot} showEmptyEvidence />
      </CardContent>
    </Card>
  );
}

function RequestItemDetails({ items }: { items: NormalizedRequestItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-[18px] border border-border bg-white/55 p-4 text-sm text-muted-foreground">
        Itens ainda não informados no payload.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div
          key={`${item.sku_code}-${item.product_name}-${index}`}
          className="rounded-[18px] border border-border bg-white/58 px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,.03)] backdrop-blur-[24px]"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-primary">
                  {item.sku_code}
                </span>
                {item.status ? (
                  <Badge
                    variant="outline"
                    className={statusBadgeClass(item.status)}
                  >
                    {normalizeStatus(item.status)}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-foreground">
                {item.product_name}
              </div>
              {item.location_id ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Local {item.location_id}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 text-left sm:text-right">
              <div className="text-sm font-semibold text-foreground">
                {formatQuantity(item.quantity, item.unit)}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                {item.pickedQuantity !== undefined ? (
                  <span>Separado {formatQuantity(item.pickedQuantity, item.unit)}</span>
                ) : null}
                {item.receivedQuantity !== undefined ? (
                  <span>
                    Recebido {formatQuantity(item.receivedQuantity, item.unit)}
                  </span>
                ) : null}
                {item.packedQuantity !== undefined ? (
                  <span>
                    Embalado {formatQuantity(item.packedQuantity, item.unit)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {item.packageLabel || item.trackingCode ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {item.packageLabel ? (
                <span className="rounded-full border border-border bg-white/70 px-2 py-1">
                  {item.packageLabel}
                </span>
              ) : null}
              {item.trackingCode ? (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 font-mono text-primary">
                  {item.trackingCode}
                </span>
              ) : null}
            </div>
          ) : null}

          {hasOperationalLinks(item.operationalLinks) ? (
            <div className="mt-3">
              <OperationalLinkBadges links={item.operationalLinks} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RequestHistoryCard({ request }: { request: RequestHistoryRow }) {
  return (
    <div className="soft-panel rounded-[22px] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-border bg-white/70">
              {requestTypeLabel(request.type)}
            </Badge>
            <Badge
              variant="outline"
              className={requestStatusBadgeClass(request.status)}
            >
              {requestStatusLabel(request.status)}
            </Badge>
            {request.priority ? (
              <Badge
                variant="outline"
                className={priorityBadgeClass(request.priority)}
              >
                {priorityLabel(request.priority)}
              </Badge>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono text-primary">{request.reference}</span>
            <span>{formatDate(request.updatedAt ?? request.date)}</span>
            <span>{request.requestedBy}</span>
          </div>

          <h3 className="mt-2 line-clamp-2 text-base font-semibold text-foreground">
            {request.title}
          </h3>
          {request.description ? (
            <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">
              {request.description}
            </p>
          ) : null}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:min-w-56">
          <div className="rounded-[18px] border border-border bg-white/58 p-3">
            <div className="text-xs text-muted-foreground">Itens</div>
            <div className="mt-1 text-lg font-semibold">
              {formatNumber(request.items.length)}
            </div>
          </div>
          <div className="rounded-[18px] border border-border bg-white/58 p-3">
            <div className="text-xs text-muted-foreground">Qtde total</div>
            <div className="mt-1 text-lg font-semibold">
              {formatNumber(request.quantityTotal)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Package className="size-3.5" />
            <span>Detalhe por item</span>
          </div>
          <RequestItemDetails items={request.items} />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-[18px] border border-border bg-white/58 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock3 className="size-3.5" />
              <span>Estado atual</span>
            </div>
            <Badge
              variant="outline"
              className={requestStatusBadgeClass(request.status)}
            >
              {requestStatusLabel(request.status)}
            </Badge>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {requestStatusHint(request)}
            </p>
          </div>

          <div className="rounded-[18px] border border-border bg-white/58 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Link2 className="size-3.5" />
              <span>Vínculo operacional</span>
            </div>
            <OperationalLinkBadges links={request.operationalLinks} />
          </div>
        </div>
      </div>

      {request.wmsSnapshot ? (
        <div className="mt-4 rounded-[20px] border border-primary/15 bg-primary/5 p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <Route className="size-3.5" />
                <span>Acompanhamento físico WMS</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Retirada do pedido ao comprovante, com sinais IA e evidência física.
              </p>
            </div>
            <Badge
              variant="outline"
              className={stepStateClass(
                request.wmsSnapshot.activeStep?.state ?? "pending",
              )}
            >
              {request.wmsSnapshot.activeStep?.label ?? "WMS"}
            </Badge>
          </div>
          <RequestWmsPanel
            snapshot={request.wmsSnapshot}
            showEmptyEvidence={request.wmsSnapshot.hasDetailedWms}
          />
        </div>
      ) : null}
    </div>
  );
}

function RequestHistoryList({ requests }: { requests: RequestHistoryRow[] }) {
  if (!requests.length) {
    return (
      <EmptyInline
        title="Sem solicitações recentes"
        description="Quando o cliente enviar demandas, o histórico aparecerá com itens, estado e vínculo operacional."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {requests.slice(0, 8).map((request) => (
        <RequestHistoryCard key={request.id} request={request} />
      ))}
    </div>
  );
}

export default function ClientPortal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [requestForm, setRequestForm] =
    useState<RequestFormState>(defaultRequestForm);

  const overview = useQuery({
    queryKey: overviewQueryKey,
    queryFn: () => fetchJson<ClientOverview>("/api/client/overview"),
    refetchInterval: 30000,
  });

  const wmsOverview = useQuery({
    queryKey: wmsQueryKey,
    enabled: Boolean(overview.data),
    queryFn: async () => {
      try {
        return await fetchJson<WarehouseOpsResponse>("/api/warehouse/ops");
      } catch {
        return undefined;
      }
    },
    refetchInterval: 30000,
  });

  const createRequest = useMutation({
    mutationFn: (payload: RequestPayload) =>
      fetchJson<ClientRequest>("/api/client/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      const protocol = result?.protocol ?? result?.protocolo;

      setRequestForm(defaultRequestForm);
      queryClient.invalidateQueries({ queryKey: overviewQueryKey });
      toast({
        title: "Solicitação enviada",
        description: protocol
          ? `Protocolo ${protocol} registrado.`
          : "Nossa operação recebeu o pedido.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao enviar solicitação",
        description:
          error instanceof Error
            ? error.message
            : "Tente novamente em instantes.",
        variant: "destructive",
      });
    },
  });

  const derived = useMemo(() => {
    const data = overview.data;
    const inventory = data?.inventory ?? data?.stock ?? {};
    const billing =
      data?.billing ??
      (Array.isArray(data?.invoices) ? undefined : data?.invoices) ??
      {};
    const orders = data?.orders ?? {};
    const requests = Array.isArray(data?.requests)
      ? {}
      : (data?.requests ?? {});
    const invoices = getInvoiceList(data?.invoices);
    const recentOrders =
      orders.recent ?? orders.items ?? data?.recent_orders ?? [];
    const recentRequests =
      getRequestList(data?.requests).length > 0
        ? getRequestList(data?.requests)
        : (data?.recent_requests ?? []);
    const alerts = data?.agent_alerts ?? data?.alerts ?? [];
    const stockItems = normalizeStockItems(
      inventory.top_items ?? inventory.items,
    );
    const wmsTaskMatches = collectOpsTaskMatches(data?.wms, wmsOverview.data);
    const requestHistory = recentRequests
      .map((request, index) => buildRequestHistoryRow(request, index))
      .sort((left, right) => {
        const leftDate = left.updatedAt ?? left.date;
        const rightDate = right.updatedAt ?? right.date;
        const leftTime = leftDate ? new Date(leftDate).getTime() : 0;
        const rightTime = rightDate ? new Date(rightDate).getTime() : 0;
        return rightTime - leftTime;
      })
      .map((request) => ({
        ...request,
        wmsSnapshot: buildRequestWmsSnapshot(request, wmsTaskMatches, data),
      }));
    const withdrawalRows = requestHistory.filter(isWithdrawalRequest);
    const featuredWithdrawal =
      withdrawalRows.find((request) => isOpenWmsSnapshot(request.wmsSnapshot)) ??
      withdrawalRows[0] ??
      requestHistory[0];

    const activityRows: ActivityRow[] = [
      ...recentOrders.map((order, index) => ({
        id: order.id ?? `order-${index}`,
        kind: "Pedido" as const,
        reference: order.num_pedido ?? order.order_number ?? order.number ?? "-",
        title:
          order.produto ??
          order.product_name ??
          order.product ??
          "Pedido operacional",
        status: order.status ?? "Pendente",
        detail:
          order.canal ??
          order.channel ??
          `${formatNumber(
            order.qtd_sep ?? order.picked_qty ?? 0,
          )} / ${formatNumber(
            order.qtd_solic ?? order.requested_qty ?? order.quantity,
          )} peça(s)`,
        date:
          order.updated_at ??
          order.created_at ??
          order.requested_at ??
          order.data_solic,
      })),
      ...recentRequests.map((request, index) => {
        const requestItems = normalizeRequestItems(getRequestItems(request));

        return {
          id: request.id ?? `request-${index}`,
          kind: "Solicitação" as const,
          reference: request.protocol ?? request.protocolo ?? "-",
          title:
            request.title ??
            request.titulo ??
            request.description ??
            request.descricao ??
            "Solicitação do cliente",
          status: request.status ?? "Aberta",
          detail:
            formatRequestItemSummary(requestItems) ??
            request.type ??
            request.tipo ??
            "Operação",
          date: request.updated_at ?? request.created_at,
          priority: request.priority ?? request.prioridade,
          items: requestItems,
          operationalLinks: getOperationalLinks(request),
        };
      }),
    ].sort((left, right) => {
      const leftDate = left.date ? new Date(left.date).getTime() : 0;
      const rightDate = right.date ? new Date(right.date).getTime() : 0;
      return rightDate - leftDate;
    });

    const openRequests = firstNumber(requests.open, requests.pending);
    const openOrders = firstNumber(
      orders.open,
      orders.pending,
      orders.in_progress,
      recentOrders.length,
    );

    return {
      data,
      inventory,
      billing,
      invoices,
      recentOrders,
      recentRequests,
      requestHistory,
      featuredWithdrawal,
      alerts,
      stockItems,
      activityRows,
      totalPieces: firstNumber(inventory.total_pieces, inventory.total_pecas),
      totalSkus: firstNumber(inventory.total_skus),
      availablePieces: firstNumber(inventory.available_pieces),
      reservedPieces: firstNumber(inventory.reserved_pieces),
      lowStockCount: firstNumber(inventory.low_stock_count),
      inventoryValue: firstNumber(
        inventory.total_value,
        inventory.inventory_value,
        inventory.custo_total,
      ),
      openInvoiceTotal: firstNumber(billing.open_total),
      overdueInvoiceTotal: firstNumber(billing.overdue_total),
      openInvoiceCount: firstNumber(billing.open_count),
      currentInvoiceTotal: firstNumber(billing.current_total),
      openWork: openOrders + openRequests,
    };
  }, [overview.data, wmsOverview.data]);

  const selectedStockItem =
    derived.stockItems.find((item) => item.key === requestForm.itemKey) ?? null;
  const requestedQuantity = toNumber(requestForm.quantity, Number.NaN);
  const hasValidQuantity =
    Number.isFinite(requestedQuantity) && requestedQuantity > 0;
  const quantityExceedsAvailable = Boolean(
    selectedStockItem &&
      hasValidQuantity &&
      selectedStockItem.quantityAvailable > 0 &&
      requestedQuantity > selectedStockItem.quantityAvailable,
  );
  const previewItem =
    selectedStockItem && hasValidQuantity
      ? {
          sku_code: selectedStockItem.skuCode,
          product_name: selectedStockItem.productName,
          quantity: requestedQuantity,
          ...(selectedStockItem.locationId
            ? { location_id: selectedStockItem.locationId }
            : {}),
        }
      : null;
  const canSubmit = Boolean(selectedStockItem && hasValidQuantity);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedStockItem) {
      toast({
        title: "Escolha um item",
        description: "Selecione um SKU retornado pelo estoque do cliente.",
        variant: "destructive",
      });
      return;
    }

    if (!hasValidQuantity || !previewItem) {
      toast({
        title: "Informe a quantidade",
        description: "A quantidade precisa ser maior que zero.",
        variant: "destructive",
      });
      return;
    }

    const observation = requestForm.description.trim();

    createRequest.mutate({
      type: requestForm.type,
      priority: requestForm.priority,
      description: buildRequestDescription({
        type: requestForm.type,
        item: previewItem,
        observation,
      }),
      items: [previewItem],
    });
  }

  if (overview.isLoading) return <PortalLoading />;

  if (overview.error || !overview.data) {
    return (
      <Alert variant="destructive" className="rounded-[20px]">
        <AlertTriangle className="size-4" />
        <AlertTitle>Portal indisponível</AlertTitle>
        <AlertDescription>
          Não consegui carregar o resumo do cliente BTG agora. Atualize a página
          ou tente novamente em instantes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                Portal operacional BTG
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Estoque, faturas e WMS físico com retirada, volumes, expedição
                e comprovantes quando informados.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/20 bg-primary/10 text-primary"
          >
            {derived.data?.customer?.code ?? "BTG"}
          </Badge>
          <Badge
            variant="outline"
            className="border-border bg-white/70 text-muted-foreground"
          >
            Atualizado {formatDate(derived.data?.updated_at)}
          </Badge>
          <Button
            type="button"
            variant="outline"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(overview.isFetching && "animate-spin")}
            />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Peças em estoque"
          value={formatNumber(derived.totalPieces)}
          caption={`${formatNumber(derived.totalSkus)} SKU(s), ${formatNumber(
            derived.availablePieces,
          )} disponível(is)`}
          icon={Package}
        />
        <MetricCard
          title="Valor monitorado"
          value={formatMoney(derived.inventoryValue)}
          caption={`${formatNumber(derived.reservedPieces)} peça(s) reservada(s)`}
          icon={DollarSign}
        />
        <MetricCard
          title="Faturas abertas"
          value={formatMoney(derived.openInvoiceTotal)}
          caption={`${formatNumber(derived.openInvoiceCount)} fatura(s), ${formatMoney(
            derived.overdueInvoiceTotal,
          )} vencido(s)`}
          icon={Activity}
        />
        <MetricCard
          title="Pedidos e solicitações"
          value={formatNumber(derived.openWork)}
          caption="Pendências operacionais abertas para o cliente"
          icon={Box}
        />
      </div>

      <FeaturedWithdrawalCard
        request={derived.featuredWithdrawal}
        isSyncing={wmsOverview.isFetching}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">Resumo de estoque</CardTitle>
                <CardDescription>
                  Principais saldos, categorias e pontos que merecem atenção.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">
                    Disponível
                  </div>
                  <div className="mt-2 text-xl font-semibold">
                    {formatNumber(derived.availablePieces)}
                  </div>
                </div>
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">Reservado</div>
                  <div className="mt-2 text-xl font-semibold">
                    {formatNumber(derived.reservedPieces)}
                  </div>
                </div>
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">
                    Baixo estoque
                  </div>
                  <div className="mt-2 text-xl font-semibold">
                    {formatNumber(derived.lowStockCount)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-3 text-sm font-medium text-foreground">
                    Categorias
                  </div>
                  {derived.inventory.by_category?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Categoria</TableHead>
                          <TableHead className="text-right">Peças</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {derived.inventory.by_category
                          .slice(0, 6)
                          .map((item, index) => (
                            <TableRow
                              key={`${item.category ?? item.categoria ?? index}`}
                            >
                              <TableCell className="max-w-[180px] truncate font-medium">
                                {item.category ??
                                  item.categoria ??
                                  item.label ??
                                  "Sem categoria"}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatNumber(
                                  item.total_pieces ?? item.total_pecas,
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatMoney(item.total_value ?? item.value)}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyInline
                      title="Sem categorias"
                      description="O endpoint ainda não retornou saldo por categoria."
                    />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="mb-3 text-sm font-medium text-foreground">
                    Itens em destaque
                  </div>
                  {(derived.inventory.top_items ?? derived.inventory.items)
                    ?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Peças</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(
                          derived.inventory.top_items ??
                          derived.inventory.items ??
                          []
                        )
                          .slice(0, 6)
                          .map((item, index) => (
                            <TableRow
                              key={`${item.id ?? getInventoryItemSku(item) ?? index}`}
                            >
                              <TableCell className="font-mono text-xs">
                                {getInventoryItemSku(item) || "-"}
                              </TableCell>
                              <TableCell className="max-w-[220px] truncate font-medium">
                                {getInventoryItemName(item)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatNumber(getInventoryItemQuantity(item))}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyInline
                      title="Sem itens"
                      description="A lista de SKUs em destaque aparecerá após a integração."
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base">
                    Histórico de solicitações
                  </CardTitle>
                  <CardDescription>
                    Item, status físico, timeline de retirada, volumes,
                    expedição e comprovantes quando informados.
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className="w-fit border-border bg-white/70 text-muted-foreground"
                >
                  {formatNumber(derived.requestHistory.length)} registro(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <RequestHistoryList requests={derived.requestHistory} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">Faturas</CardTitle>
                <CardDescription>
                  Prévia financeira e últimas competências retornadas pela API.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">
                    Mês corrente
                  </div>
                  <div className="mt-2 text-lg font-semibold">
                    {formatMoney(derived.currentInvoiceTotal)}
                  </div>
                </div>
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">Em aberto</div>
                  <div className="mt-2 text-lg font-semibold">
                    {formatMoney(derived.openInvoiceTotal)}
                  </div>
                </div>
                <div className="soft-panel rounded-[20px] p-4">
                  <div className="text-xs text-muted-foreground">Vencendo</div>
                  <div className="mt-2 text-lg font-semibold">
                    {formatNumber(derived.billing.due_soon_count)}
                  </div>
                </div>
              </div>

              {derived.invoices.length ? (
                <div className="mt-5">
                  <Table className="min-w-[620px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Competência</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {derived.invoices.slice(0, 5).map((invoice, index) => (
                        <TableRow
                          key={`${invoice.id ?? invoice.competencia ?? index}`}
                        >
                          <TableCell className="font-medium">
                            {invoice.competencia ?? invoice.month ?? "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={statusBadgeClass(invoice.status)}
                            >
                              {normalizeStatus(invoice.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(invoice.due_date ?? invoice.vencimento)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatMoney(invoice.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">Nova solicitação</CardTitle>
                  <CardDescription>
                    Envie uma demanda por item/SKU para a operação.
                  </CardDescription>
                </div>
                <Send className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="request-type">Tipo</FieldLabel>
                    <Select
                      value={requestForm.type}
                      onValueChange={(value) =>
                        setRequestForm((current) => ({
                          ...current,
                          type: value,
                        }))
                      }
                    >
                      <SelectTrigger id="request-type">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {requestTypes.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="request-priority">
                      Prioridade
                    </FieldLabel>
                    <Select
                      value={requestForm.priority}
                      onValueChange={(value) =>
                        setRequestForm((current) => ({
                          ...current,
                          priority: value,
                        }))
                      }
                    >
                      <SelectTrigger id="request-priority">
                        <SelectValue placeholder="Selecione a prioridade" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {requestPriorities.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field data-disabled={!derived.stockItems.length}>
                    <FieldLabel htmlFor="request-item">Item/SKU</FieldLabel>
                    <Select
                      value={requestForm.itemKey}
                      disabled={!derived.stockItems.length}
                      onValueChange={(value) =>
                        setRequestForm((current) => ({
                          ...current,
                          itemKey: value,
                        }))
                      }
                    >
                      <SelectTrigger id="request-item">
                        <SelectValue placeholder="Selecione um item do estoque" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {derived.stockItems.slice(0, 20).map((item) => (
                            <SelectItem key={item.key} value={item.key}>
                              {item.skuCode} · {item.productName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {derived.stockItems.length
                        ? "Lista baseada nos SKUs em estoque do cliente."
                        : "O estoque ainda não retornou itens para solicitação."}
                    </FieldDescription>
                  </Field>

                  <Field
                    data-invalid={
                      requestForm.quantity.length > 0 && !hasValidQuantity
                    }
                  >
                    <FieldLabel htmlFor="request-quantity">
                      Quantidade
                    </FieldLabel>
                    <Input
                      id="request-quantity"
                      type="number"
                      min="1"
                      step="1"
                      value={requestForm.quantity}
                      onChange={(event) =>
                        setRequestForm((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                      aria-invalid={
                        requestForm.quantity.length > 0 && !hasValidQuantity
                      }
                    />
                    <FieldDescription>
                      {selectedStockItem
                        ? `${formatNumber(
                            selectedStockItem.quantityAvailable,
                          )} peça(s) disponível(is) neste item.`
                        : "Escolha um SKU para ver o saldo disponível."}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="request-description">
                      Observação
                    </FieldLabel>
                    <Textarea
                      id="request-description"
                      value={requestForm.description}
                      onChange={(event) =>
                        setRequestForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Ex.: separar para retirada amanhã cedo, doca 2, NF será enviada até 16h..."
                      rows={5}
                    />
                    <FieldDescription>
                      Prazo, doca, nota fiscal, contato ou instrução para
                      expedição e faturamento.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <div className="soft-panel rounded-[20px] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <ClipboardList className="size-3.5" />
                        <span>Prévia da solicitação</span>
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-foreground">
                        {previewItem
                          ? `${requestTypeLabel(requestForm.type)} · ${
                              previewItem.sku_code
                            }`
                          : "Escolha item e quantidade"}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={priorityBadgeClass(requestForm.priority)}
                    >
                      {priorityLabel(requestForm.priority)}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Produto</span>
                      <span className="max-w-[220px] truncate text-right font-medium">
                        {previewItem?.product_name ?? "-"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Quantidade</span>
                      <span className="font-medium">
                        {previewItem
                          ? `${formatNumber(previewItem.quantity)} peça(s)`
                          : "-"}
                      </span>
                    </div>
                    {previewItem?.location_id ? (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">Local</span>
                        <span className="max-w-[180px] truncate text-right font-medium">
                          {previewItem.location_id}
                        </span>
                      </div>
                    ) : null}
                    {quantityExceedsAvailable ? (
                      <Alert
                        variant="destructive"
                        className="mt-2 rounded-[16px]"
                      >
                        <AlertTriangle className="size-4" />
                        <AlertDescription>
                          Quantidade acima do saldo disponível retornado pelo
                          estoque.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createRequest.isPending || !canSubmit}
                >
                  {createRequest.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  {createRequest.isPending
                    ? "Enviando..."
                    : "Enviar solicitação"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">Alertas do agente</CardTitle>
                  <CardDescription>
                    Sinais automáticos para ação ou acompanhamento.
                  </CardDescription>
                </div>
                <Bell className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {derived.alerts.length ? (
                <div className="flex flex-col gap-3">
                  {derived.alerts.slice(0, 5).map((alert, index) => {
                    const priority = alert.priority ?? alert.severity;
                    return (
                      <div
                        key={`${alert.id ?? alert.title ?? index}`}
                        className="soft-panel rounded-[20px] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {alert.title ??
                                alert.titulo ??
                                "Alerta operacional"}
                            </div>
                            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                              {alert.message ??
                                alert.description ??
                                "O agente sinalizou um ponto para acompanhamento."}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={priorityBadgeClass(priority)}
                          >
                            {priorityLabel(priority)}
                          </Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock3 className="size-3.5" />
                          <span>{formatDate(alert.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyInline
                  title="Sem alertas abertos"
                  description="O agente não encontrou pendências críticas agora."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
