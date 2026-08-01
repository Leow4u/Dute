import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  Inbox,
  Link2,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { canDecideRequests, humanApiError } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type CustomerRequest = {
  id: string;
  customer_code?: string;
  type?: string;
  priority?: string;
  title?: string;
  description?: string;
  status?: string;
  quantity?: number | string | null;
  qty?: number | string | null;
  qtd_solic?: number | string | null;
  expected_qty?: number | string | null;
  total_units?: number | string | null;
  quantity_total?: number | string | null;
  item_count?: number | string | null;
  sku_code?: string | null;
  cod_sku?: string | null;
  client_item_code?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  location_id?: string | null;
  location?: string | null;
  items?: CustomerRequestItem[];
  created_entities?: CreatedEntities | null;
  order_id?: string | null;
  inbound_id?: string | null;
  pick_task_id?: string | null;
  created_at?: string | null;
  requested_by?: {
    name?: string;
    email?: string;
  };
};

type CustomerRequestItem =
  | string
  | {
      id?: string | number | null;
      sku?: string | null;
      sku_code?: string | null;
      cod_sku?: string | null;
      client_item_code?: string | null;
      cod_cliente?: string | null;
      product_code?: string | null;
      product_name?: string | null;
      product?: string | null;
      name?: string | null;
      description?: string | null;
      quantity?: number | string | null;
      qty?: number | string | null;
      requested_qty?: number | string | null;
      requested_quantity?: number | string | null;
      expected_qty?: number | string | null;
      qty_expected?: number | string | null;
      qtd?: number | string | null;
      location_id?: string | null;
      location?: string | null;
      endereco?: string | null;
      unit?: string | null;
      unidade?: string | null;
    };

type CreatedEntities = {
  order_id?: string | null;
  inbound_id?: string | null;
  pick_task_id?: string | null;
};

type ListResponse = {
  items: CustomerRequest[];
  total: number;
};

type StockBalance = {
  id?: string | number | null;
  _docId?: string | null;
  customer_code?: string | null;
  sku_code?: string | null;
  cod_sku?: string | null;
  client_item_code?: string | null;
  cod_cliente?: string | null;
  product_name?: string | null;
  location_id?: string | null;
  location?: string | null;
  qty_available?: number | string | null;
  available_pieces?: number | string | null;
  qty_on_hand?: number | string | null;
  qty_reserved?: number | string | null;
  status?: string | null;
};

type StockBalanceResponse = {
  items: StockBalance[];
  total: number;
};

type RequestAction = "approve" | "reject" | "close";

type TransitionVariables = {
  id: string;
  action: RequestAction;
  expectedStatus: string;
};

type TransitionResponse = {
  ok?: boolean;
  id?: string;
  status?: string;
  created_entities?: CreatedEntities | null;
  order_id?: string | null;
  inbound_id?: string | null;
  pick_task_id?: string | null;
};

type TransitionOverlay = Partial<
  Pick<
    CustomerRequest,
    "status" | "created_entities" | "order_id" | "inbound_id" | "pick_task_id"
  >
>;

type RequestStatus =
  | "open"
  | "submitted"
  | "pending"
  | "approved"
  | "rejected"
  | "closed";

type RequestTypeFilter = "all" | string;
type RequestStatusFilter = "all" | RequestStatus;

type ValidationLineStatus =
  | "ready"
  | "insufficient"
  | "missing-balance"
  | "missing-data"
  | "unknown";

type BalanceValidationStatus =
  | "not-required"
  | "checking"
  | "ready"
  | "insufficient"
  | "missing-balance"
  | "missing-data"
  | "unknown";

type RequestValidationLine = {
  key: string;
  label: string;
  skuCode?: string;
  clientItemCode?: string;
  locationId?: string;
  requested?: number;
};

type BalanceValidationLine = RequestValidationLine & {
  status: ValidationLineStatus;
  available?: number;
  balanceId?: string;
  message: string;
};

type BalanceValidation = {
  status: BalanceValidationStatus;
  title: string;
  detail: string;
  canApprove: boolean;
  requestedTotal?: number;
  availableTotal?: number;
  issueCount: number;
  lines: BalanceValidationLine[];
};

const queryKey = ["customer-requests"];
const stockBalancesQueryKey = ["stock-balances", "customer-requests"];
const openStatuses = new Set<RequestStatus>(["open", "submitted", "pending"]);

const statusFilterOptions: Array<{
  value: RequestStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Todos os status" },
  { value: "open", label: "Aberta" },
  { value: "submitted", label: "Enviada" },
  { value: "pending", label: "Pendente" },
  { value: "approved", label: "Aprovada" },
  { value: "rejected", label: "Rejeitada" },
  { value: "closed", label: "Encerrada" },
];

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return dateFormatter.format(date);
}

function normalizeSlug(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeStatus(status?: string | null): RequestStatus {
  const normalized = normalizeSlug(status || "open");
  if (["approved", "aprovada", "aprovado"].includes(normalized)) {
    return "approved";
  }
  if (["rejected", "rejeitada", "rejeitado"].includes(normalized)) {
    return "rejected";
  }
  if (
    ["closed", "encerrada", "encerrado", "concluida", "concluido"].includes(
      normalized,
    )
  ) {
    return "closed";
  }
  if (["submitted", "enviada", "enviado"].includes(normalized)) {
    return "submitted";
  }
  if (["pending", "pendente", "em-analise"].includes(normalized)) {
    return "pending";
  }
  return "open";
}

function statusLabel(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (normalized === "approved") return "Aprovada";
  if (normalized === "rejected") return "Rejeitada";
  if (normalized === "closed") return "Encerrada";
  if (normalized === "pending") return "Pendente";
  if (normalized === "submitted") return "Enviada";
  return "Aberta";
}

function statusClass(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (normalized === "approved") return "border-primary/20 bg-primary/10 text-primary";
  if (normalized === "rejected") return "border-destructive/20 bg-destructive/10 text-destructive";
  if (normalized === "closed") return "border-border bg-white/70 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function requestTypeLabel(type?: string | null) {
  const normalized = normalizeSlug(type || "solicitacao");
  if (normalized === "retirada") return "Retirada";
  if (normalized === "recebimento") return "Recebimento";
  if (normalized === "inventario") return "Inventário";
  if (normalized === "ajuste" || normalized === "ajuste-de-estoque") {
    return "Ajuste de estoque";
  }
  if (normalized === "financeiro") return "Financeiro";
  if (normalized === "suporte" || normalized === "suporte-operacional") {
    return "Suporte operacional";
  }
  return type || "Solicitação";
}

function isOutboundRequest(request: CustomerRequest) {
  const normalized = normalizeSlug(request.type);
  return (
    normalized.includes("retirada") ||
    normalized.includes("saida") ||
    normalized.includes("outbound") ||
    normalized.includes("ajuste")
  );
}

function isInboundRequest(request: CustomerRequest) {
  const normalized = normalizeSlug(request.type);
  return normalized.includes("receb") || normalized.includes("inbound");
}

function statusDescription(request: CustomerRequest) {
  const normalized = normalizeStatus(request.status);
  if (normalized === "approved") {
    return hasOperationalLinks(request)
      ? "Operação WMS vinculada"
      : "Aprovada sem vínculo informado";
  }
  if (normalized === "rejected") return "Sem execução operacional";
  if (normalized === "closed") return "Fluxo encerrado";
  if (normalized === "submitted") return "Aguardando triagem";
  if (normalized === "pending") return "Decisão pendente";
  return "Aberta para decisão";
}

function priorityClass(priority?: string | null) {
  const normalized = normalizeSlug(priority ?? "normal");
  if (["critica", "critical", "urgente"].includes(normalized)) {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (["alta", "high"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-border bg-white/70 text-muted-foreground";
}

function priorityLabel(priority?: string | null) {
  const normalized = normalizeSlug(priority ?? "normal");
  if (["critica", "critical"].includes(normalized)) return "crítica";
  if (normalized === "urgente") return "urgente";
  if (["alta", "high"].includes(normalized)) return "alta";
  if (["baixa", "low"].includes(normalized)) return "baixa";
  return priority || "normal";
}

function statusFromAction(action: RequestAction) {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return "closed";
}

function actionToastTitle(action: RequestAction) {
  if (action === "approve") return "Solicitação aprovada";
  if (action === "reject") return "Solicitação rejeitada";
  return "Solicitação encerrada";
}

function actionHint(status?: string | null) {
  const normalized = normalizeStatus(status);
  if (openStatuses.has(normalized)) return "Aberta para aprovar ou rejeitar";
  if (normalized === "approved") return "Aprovada para execução";
  if (normalized === "rejected") return "Rejeitada";
  return "Encerrada";
}

function coerceNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const raw = value.trim();
  if (!raw) return undefined;

  const normalized =
    raw.includes(",") && raw.includes(".")
      ? raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "")
      : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatQuantity(value?: number) {
  if (value === undefined) return "Sem qtde";
  return numberFormatter.format(value);
}

function getRequestItems(request: CustomerRequest) {
  return Array.isArray(request.items) ? request.items : [];
}

function getItemLabel(item: CustomerRequestItem) {
  if (typeof item === "string") return item;
  return String(
    item.sku_code ||
      item.sku ||
      item.cod_sku ||
      item.client_item_code ||
      item.cod_cliente ||
      item.product_name ||
      item.product ||
      item.name ||
      item.description ||
      item.id ||
      "Item sem identificação",
  );
}

function getItemQuantity(item: CustomerRequestItem) {
  if (typeof item === "string") return undefined;
  return coerceNumber(
    item.quantity ??
      item.qty ??
      item.requested_qty ??
      item.requested_quantity ??
      item.expected_qty ??
      item.qty_expected ??
      item.qtd,
  );
}

function getItemUnit(item: CustomerRequestItem) {
  if (typeof item === "string") return undefined;
  return item.unit || item.unidade || undefined;
}

function getItemSkuCode(item: CustomerRequestItem) {
  if (typeof item === "string") return undefined;
  return firstNonEmpty(item.sku_code, item.sku, item.cod_sku);
}

function getItemClientCode(item: CustomerRequestItem) {
  if (typeof item === "string") return undefined;
  return firstNonEmpty(item.client_item_code, item.cod_cliente, item.product_code);
}

function getItemLocation(item: CustomerRequestItem) {
  if (typeof item === "string") return undefined;
  return firstNonEmpty(item.location_id, item.location, item.endereco);
}

function getExplicitQuantityTotal(request: CustomerRequest) {
  return coerceNumber(request.quantity_total);
}

function getQuantityTotal(request: CustomerRequest) {
  const explicitTotal = getExplicitQuantityTotal(request);
  if (explicitTotal !== undefined) return explicitTotal;

  const itemTotal = getRequestItems(request).reduce((sum, item) => {
    return sum + (getItemQuantity(item) ?? 0);
  }, 0);
  if (itemTotal > 0) return itemTotal;

  return coerceNumber(request.quantity);
}

function firstNonEmpty(...values: unknown[]) {
  const found = values.find((value) => {
    if (value === null || value === undefined) return false;
    return String(value).trim().length > 0;
  });
  return found === undefined ? undefined : String(found);
}

function isMissingPayloadValue(value: unknown) {
  return value === null || value === undefined || String(value).trim().length === 0;
}

function getDataWarnings(request: CustomerRequest) {
  const warnings: string[] = [];
  const explicitTotal = getExplicitQuantityTotal(request);

  if (isMissingPayloadValue(request.quantity_total)) {
    warnings.push("quantity_total ausente");
  } else if (explicitTotal === undefined) {
    warnings.push("quantity_total inválido");
  }

  const items = getRequestItems(request);
  if (!Array.isArray(request.items) || items.length === 0) {
    warnings.push("items ausente");
  } else if (items.some((item) => getItemQuantity(item) === undefined)) {
    warnings.push("item sem quantidade");
  }

  return warnings;
}

function getRequestValidationLines(request: CustomerRequest): RequestValidationLine[] {
  const itemLines = getRequestItems(request).map((item, index) => {
    const label = getItemLabel(item);
    const locationId = getItemLocation(item);
    return {
      key: `${label}-${locationId ?? "sem-local"}-${index}`,
      label,
      skuCode: getItemSkuCode(item),
      clientItemCode: getItemClientCode(item),
      locationId,
      requested: getItemQuantity(item),
    };
  });

  if (itemLines.length > 0) return itemLines;

  const skuCode = firstNonEmpty(request.sku_code, request.cod_sku);
  const clientItemCode = firstNonEmpty(
    request.client_item_code,
    request.product_code,
  );
  const locationId = firstNonEmpty(request.location_id, request.location);
  const requested = coerceNumber(
    request.quantity ??
      request.qty ??
      request.qtd_solic ??
      request.expected_qty ??
      request.total_units,
  );

  if (!skuCode && !clientItemCode && requested === undefined) return [];

  return [
    {
      key: `${skuCode ?? clientItemCode ?? request.id}-${locationId ?? "sem-local"}`,
      label:
        firstNonEmpty(request.product_name, skuCode, clientItemCode) ??
        "Item sem identificação",
      skuCode,
      clientItemCode,
      locationId,
      requested,
    },
  ];
}

function getStockBalanceId(balance: StockBalance) {
  return firstNonEmpty(balance._docId, balance.id);
}

function getStockBalanceSku(balance: StockBalance) {
  return firstNonEmpty(balance.sku_code, balance.cod_sku);
}

function getStockBalanceClientCode(balance: StockBalance) {
  return firstNonEmpty(balance.client_item_code, balance.cod_cliente);
}

function getStockBalanceLocation(balance: StockBalance) {
  return firstNonEmpty(balance.location_id, balance.location);
}

function getStockBalanceAvailable(balance: StockBalance) {
  const direct = coerceNumber(balance.qty_available ?? balance.available_pieces);
  if (direct !== undefined) return direct;

  const onHand = coerceNumber(balance.qty_on_hand);
  if (onHand === undefined) return undefined;

  const reserved = coerceNumber(balance.qty_reserved) ?? 0;
  return Math.max(0, onHand - reserved);
}

function findStockBalanceForLine(
  balances: StockBalance[],
  line: RequestValidationLine,
  customerCode?: string,
) {
  return balances.find((balance) => {
    const balanceCustomer = firstNonEmpty(balance.customer_code);
    const sameCustomer =
      !customerCode || !balanceCustomer || balanceCustomer === customerCode;
    const sameSku =
      line.skuCode && getStockBalanceSku(balance) === line.skuCode;
    const sameClientItem =
      line.clientItemCode &&
      getStockBalanceClientCode(balance) === line.clientItemCode;
    const sameLocation =
      !line.locationId || getStockBalanceLocation(balance) === line.locationId;

    return sameCustomer && sameLocation && Boolean(sameSku || sameClientItem);
  });
}

function pluralizeItem(count: number) {
  return count === 1 ? "item" : "itens";
}

function buildMissingDataLine(line: RequestValidationLine): BalanceValidationLine {
  const missingParts = [
    !line.skuCode && !line.clientItemCode ? "SKU" : null,
    line.requested === undefined || line.requested <= 0 ? "quantidade" : null,
  ].filter(Boolean);

  return {
    ...line,
    status: "missing-data",
    message: `Falta ${missingParts.join(" e ")} para validar.`,
  };
}

function buildBalanceValidation(
  request: CustomerRequest,
  balances: StockBalance[] | undefined,
  isChecking: boolean,
  hasBalanceError: boolean,
): BalanceValidation {
  if (!isOutboundRequest(request)) {
    return {
      status: "not-required",
      title: isInboundRequest(request) ? "Entrada sem reserva" : "Sem reserva",
      detail: isInboundRequest(request)
        ? "A aprovação cria recebimento; o saldo entra após conferência."
        : "Este tipo não consome saldo automaticamente.",
      canApprove: true,
      issueCount: 0,
      lines: [],
    };
  }

  const lines = getRequestValidationLines(request);
  const requestedTotal = lines.reduce(
    (sum, line) => sum + (line.requested ?? 0),
    0,
  );

  if (lines.length === 0) {
    return {
      status: "missing-data",
      title: "Dados faltando",
      detail: "Informe items com SKU e quantidade antes de aprovar.",
      canApprove: false,
      requestedTotal,
      issueCount: 1,
      lines: [],
    };
  }

  const linesWithMissingData = lines.filter(
    (line) =>
      (!line.skuCode && !line.clientItemCode) ||
      line.requested === undefined ||
      line.requested <= 0,
  );

  if (linesWithMissingData.length > 0) {
    return {
      status: "missing-data",
      title: "Dados faltando",
      detail: `${numberFormatter.format(linesWithMissingData.length)} ${pluralizeItem(
        linesWithMissingData.length,
      )} sem SKU ou quantidade.`,
      canApprove: false,
      requestedTotal,
      issueCount: linesWithMissingData.length,
      lines: lines.map((line) =>
        linesWithMissingData.includes(line)
          ? buildMissingDataLine(line)
          : {
              ...line,
              status: "unknown",
              message: "Aguardando correção dos demais itens.",
            },
      ),
    };
  }

  if (isChecking && !balances) {
    return {
      status: "checking",
      title: "Validando saldo",
      detail: "Consultando saldos disponíveis antes da aprovação.",
      canApprove: false,
      requestedTotal,
      issueCount: 0,
      lines: [],
    };
  }

  if (hasBalanceError || !balances) {
    return {
      status: "unknown",
      title: "Saldo não consultado",
      detail: "A API ainda validará o saldo no envio.",
      canApprove: true,
      requestedTotal,
      issueCount: 0,
      lines: lines.map((line) => ({
        ...line,
        status: "unknown",
        message: "Consulta de saldo indisponível.",
      })),
    };
  }

  const validationLines = lines.map<BalanceValidationLine>((line) => {
    const balance = findStockBalanceForLine(
      balances,
      line,
      request.customer_code,
    );

    if (!balance) {
      return {
        ...line,
        status: "missing-balance",
        message: "Saldo não encontrado para este SKU.",
      };
    }

    const available = getStockBalanceAvailable(balance);
    if (available === undefined) {
      return {
        ...line,
        status: "unknown",
        balanceId: getStockBalanceId(balance),
        message: "Saldo encontrado sem quantidade disponível.",
      };
    }

    if ((line.requested ?? 0) > available) {
      return {
        ...line,
        status: "insufficient",
        available,
        balanceId: getStockBalanceId(balance),
        message: `Disponível: ${formatQuantity(available)}.`,
      };
    }

    return {
      ...line,
      status: "ready",
      available,
      balanceId: getStockBalanceId(balance),
      message: `Disponível: ${formatQuantity(available)}.`,
    };
  });

  const issueLines = validationLines.filter((line) => line.status !== "ready");
  const availableTotal = validationLines.reduce(
    (sum, line) => sum + (line.available ?? 0),
    0,
  );

  if (issueLines.some((line) => line.status === "insufficient")) {
    return {
      status: "insufficient",
      title: "Saldo insuficiente",
      detail: `${numberFormatter.format(issueLines.length)} ${pluralizeItem(
        issueLines.length,
      )} acima do disponível.`,
      canApprove: false,
      requestedTotal,
      availableTotal,
      issueCount: issueLines.length,
      lines: validationLines,
    };
  }

  if (issueLines.some((line) => line.status === "missing-balance")) {
    return {
      status: "missing-balance",
      title: "Saldo não encontrado",
      detail: `${numberFormatter.format(issueLines.length)} ${pluralizeItem(
        issueLines.length,
      )} sem saldo cadastrado.`,
      canApprove: false,
      requestedTotal,
      availableTotal,
      issueCount: issueLines.length,
      lines: validationLines,
    };
  }

  if (issueLines.length > 0) {
    return {
      status: "unknown",
      title: "Saldo incompleto",
      detail: "Há saldo encontrado sem quantidade disponível.",
      canApprove: false,
      requestedTotal,
      availableTotal,
      issueCount: issueLines.length,
      lines: validationLines,
    };
  }

  return {
    status: "ready",
    title: "Saldo validado",
    detail: "Disponível para reservar ao aprovar.",
    canApprove: true,
    requestedTotal,
    availableTotal,
    issueCount: 0,
    lines: validationLines,
  };
}

function getOperationalEntities(
  source: Pick<
    CustomerRequest,
    "created_entities" | "order_id" | "inbound_id" | "pick_task_id"
  >,
): CreatedEntities {
  return {
    order_id: firstNonEmpty(source.order_id, source.created_entities?.order_id),
    inbound_id: firstNonEmpty(source.inbound_id, source.created_entities?.inbound_id),
    pick_task_id: firstNonEmpty(
      source.pick_task_id,
      source.created_entities?.pick_task_id,
    ),
  };
}

function hasOperationalLinks(request: CustomerRequest) {
  const entities = getOperationalEntities(request);
  return Boolean(entities.order_id || entities.inbound_id || entities.pick_task_id);
}

function getTransitionOverlay(
  result: TransitionResponse,
  action: RequestAction,
): TransitionOverlay {
  const entities = getOperationalEntities({
    created_entities: result.created_entities,
    order_id: result.order_id,
    inbound_id: result.inbound_id,
    pick_task_id: result.pick_task_id,
  });

  const createdEntities = Object.fromEntries(
    Object.entries(entities).filter(([, value]) => Boolean(value)),
  ) as CreatedEntities;

  return {
    status: result.status || statusFromAction(action),
    ...createdEntities,
    ...(Object.keys(createdEntities).length > 0
      ? { created_entities: createdEntities }
      : {}),
  };
}

function mergeTransitionOverlay(
  request: CustomerRequest,
  overlay?: TransitionOverlay,
) {
  if (!overlay) return request;

  return {
    ...request,
    ...overlay,
    created_entities: {
      ...(request.created_entities ?? {}),
      ...(overlay.created_entities ?? {}),
    },
  };
}

export default function CustomerRequests() {
  // requireOperationsCoordinator no servidor: aprovar/rejeitar é do
  // coordenador (interno) e da administração. O operador vê a fila, mas não
  // vê botões que o backend recusaria.
  const { user } = useAppUser();
  const requestDecider = canDecideRequests(user?.publicMetadata.role);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RequestTypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<RequestStatusFilter>("all");
  const [localTransitions, setLocalTransitions] = useState<
    Record<string, TransitionOverlay>
  >({});

  const requests = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<ListResponse>("/api/customer-requests?limit=200"),
    refetchInterval: 120_000,
  });

  const stockBalances = useQuery({
    queryKey: stockBalancesQueryKey,
    queryFn: () =>
      fetchJson<StockBalanceResponse>("/api/stock-balances?limit=500"),
    refetchInterval: 120_000,
    retry: 1,
  });

  const transition = useMutation<
    TransitionResponse,
    Error,
    TransitionVariables
  >({
    mutationFn: ({ id, action, expectedStatus }) =>
      fetchJson<TransitionResponse>(
        `/api/customer-requests/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_status: expectedStatus,
            idempotency_key: `${id}:${action}:${expectedStatus}`,
          }),
        },
      ),
    onSuccess: (result, variables) => {
      const overlay = getTransitionOverlay(result, variables.action);
      setLocalTransitions((current) => {
        const previous = current[variables.id];
        return {
          ...current,
          [variables.id]: {
            ...previous,
            ...overlay,
            order_id: overlay.order_id ?? previous?.order_id,
            inbound_id: overlay.inbound_id ?? previous?.inbound_id,
            pick_task_id: overlay.pick_task_id ?? previous?.pick_task_id,
            created_entities: {
              ...(previous?.created_entities ?? {}),
              ...(overlay.created_entities ?? {}),
            },
          },
        };
      });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: stockBalancesQueryKey });
      qc.invalidateQueries({ queryKey: ["warehouse-ops"] });
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      const entities = getOperationalEntities({
        created_entities: overlay.created_entities,
        order_id: overlay.order_id,
        inbound_id: overlay.inbound_id,
        pick_task_id: overlay.pick_task_id,
      });
      const linkedEntities = [
        entities.order_id ? `Pedido ${entities.order_id}` : null,
        entities.inbound_id ? `Recebimento ${entities.inbound_id}` : null,
        entities.pick_task_id ? `Picking ${entities.pick_task_id}` : null,
      ].filter(Boolean);

      toast({
        title: actionToastTitle(variables.action),
        description:
          linkedEntities.length > 0 ? linkedEntities.join(" · ") : undefined,
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao atualizar solicitação",
        description: humanApiError(error, "Tente novamente em instantes."),
        variant: "destructive",
      });
    },
  });

  const allRequests = useMemo(() => {
    return (requests.data?.items ?? []).map((item) =>
      mergeTransitionOverlay(item, localTransitions[item.id]),
    );
  }, [localTransitions, requests.data?.items]);

  const balanceValidationById = useMemo(() => {
    const result = new Map<string, BalanceValidation>();
    const balances = stockBalances.data?.items;
    const isChecking =
      stockBalances.isLoading || (stockBalances.isFetching && !balances);
    const hasBalanceError = Boolean(stockBalances.error);

    allRequests.forEach((item) => {
      result.set(
        item.id,
        buildBalanceValidation(item, balances, isChecking, hasBalanceError),
      );
    });

    return result;
  }, [
    allRequests,
    stockBalances.data?.items,
    stockBalances.error,
    stockBalances.isFetching,
    stockBalances.isLoading,
  ]);

  const typeFilterOptions = useMemo(() => {
    const byType = new Map<string, string>();

    allRequests.forEach((item) => {
      const value = normalizeSlug(item.type || "solicitacao");
      if (!byType.has(value)) byType.set(value, requestTypeLabel(item.type));
    });

    return [
      { value: "all", label: "Todos os tipos" },
      ...[...byType.entries()]
        .sort(([, a], [, b]) => a.localeCompare(b, "pt-BR"))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [allRequests]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRequests.filter((item) => {
      const matchesType =
        typeFilter === "all" ||
        normalizeSlug(item.type || "solicitacao") === typeFilter;
      const matchesStatus =
        statusFilter === "all" || normalizeStatus(item.status) === statusFilter;

      if (!matchesType || !matchesStatus) return false;
      if (!needle) return true;

      const entities = getOperationalEntities(item);
      const searchableValues = [
        item.id,
        item.customer_code,
        item.type,
        item.priority,
        item.title,
        item.description,
        item.status,
        item.requested_by?.email,
        getQuantityTotal(item),
        entities.order_id,
        entities.inbound_id,
        entities.pick_task_id,
        ...getRequestItems(item).map((requestItem) => getItemLabel(requestItem)),
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return searchableValues.some((value) => value.includes(needle));
    });
  }, [allRequests, search, statusFilter, typeFilter]);

  const operationalImpact = useMemo(() => {
    const activeRequests = allRequests.filter((item) =>
      openStatuses.has(normalizeStatus(item.status)),
    );
    const activeValidations = activeRequests.map((item) =>
      balanceValidationById.get(item.id),
    );
    const stockReadyCount = activeValidations.filter(
      (validation) => validation?.status === "ready",
    ).length;
    const stockBlockedCount = activeValidations.filter((validation) =>
      ["insufficient", "missing-balance", "missing-data"].includes(
        validation?.status ?? "",
      ),
    ).length;
    const inboundCount = activeRequests.filter(isInboundRequest).length;
    const dataWarningCount = activeRequests.filter(
      (item) => getDataWarnings(item).length > 0,
    ).length;
    const unitsToReserve = activeRequests.reduce((sum, item) => {
      const validation = balanceValidationById.get(item.id);
      if (validation?.status !== "ready") return sum;
      return sum + (validation.requestedTotal ?? getQuantityTotal(item) ?? 0);
    }, 0);

    return {
      stockReadyCount,
      stockBlockedCount,
      inboundCount,
      dataWarningCount,
      unitsToReserve,
    };
  }, [allRequests, balanceValidationById]);

  const openCount = allRequests.filter((item) =>
    openStatuses.has(normalizeStatus(item.status)),
  ).length;
  const approvedCount = allRequests.filter(
    (item) => normalizeStatus(item.status) === "approved",
  ).length;
  const rejectedCount = allRequests.filter(
    (item) => normalizeStatus(item.status) === "rejected",
  ).length;
  const closedCount = allRequests.filter(
    (item) => normalizeStatus(item.status) === "closed",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-border bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <Inbox className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              Solicitações do cliente
            </h1>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => requests.refetch()}
          disabled={requests.isFetching}
        >
          <RefreshCw className={cn("h-4 w-4", requests.isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Regra da auditoria de UX: só indicadores que mudam a decisão de
          triagem. Aprovadas/rejeitadas/encerradas são histórico — estão na
          fila com o filtro de status; saldo validado e recebimentos são
          consequência da aprovação, não insumo dela. */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Abertas" value={openCount} icon={Clock3} />
        <OperationalImpactCard
          title="Bloqueios de aprovação"
          value={operationalImpact.stockBlockedCount}
          icon={AlertTriangle}
          tone="danger"
        />
        <OperationalImpactCard
          title="Dados pendentes"
          value={operationalImpact.dataWarningCount}
          icon={FileWarning}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Fila de triagem</CardTitle>
            <div className="grid w-full gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px] lg:max-w-3xl">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar solicitação..."
                  className="pl-9"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger aria-label="Filtrar por tipo">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  {typeFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as RequestStatusFilter)
                }
              >
                <SelectTrigger aria-label="Filtrar por status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1500px]">
              <TableHeader>
                <TableRow className="bg-white/45">
                  <TableHead className="px-4">Solicitação</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Qtde total</TableHead>
                  <TableHead>Pré-aprovação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vínculos</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      Carregando solicitações...
                    </TableCell>
                  </TableRow>
                ) : requests.error ? (
                  <TableRow>
                    <TableCell colSpan={9} className="px-4 py-10 text-center text-destructive">
                      <AlertTriangle className="mr-2 inline h-4 w-4" />
                      Não consegui carregar a fila.
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      Nenhuma solicitação encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((item) => {
                    const activeAction =
                      transition.isPending && transition.variables?.id === item.id
                        ? transition.variables.action
                        : undefined;
                    const balanceValidation =
                      balanceValidationById.get(item.id) ??
                      buildBalanceValidation(
                        item,
                        stockBalances.data?.items,
                        stockBalances.isLoading,
                        Boolean(stockBalances.error),
                      );

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="px-4">
                          <div className="max-w-[340px]">
                            <div className="font-mono text-xs text-primary">
                              {item.id}
                            </div>
                            <div className="mt-1 line-clamp-2 font-medium">
                              {item.description || item.title || "Solicitação sem descrição"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.requested_by?.email || "Portal do cliente"}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge variant="outline" className="capitalize">
                                {requestTypeLabel(item.type)}
                              </Badge>
                              <Badge variant="outline" className={priorityClass(item.priority)}>
                                {priorityLabel(item.priority)}
                              </Badge>
                            </div>
                            <DataQualityWarnings request={item} />
                          </div>
                        </TableCell>
                        <TableCell>{item.customer_code || "BTG Pactual"}</TableCell>
                        <TableCell>
                          <RequestItemsPreview request={item} />
                        </TableCell>
                        <TableCell>
                          <QuantityTotal request={item} />
                        </TableCell>
                        <TableCell>
                          <BalanceValidationPanel validation={balanceValidation} />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline" className={statusClass(item.status)}>
                              {statusLabel(item.status)}
                            </Badge>
                            <div className="max-w-[190px] text-xs leading-5 text-muted-foreground">
                              {statusDescription(item)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <OperationalLinks request={item} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(item.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {requestDecider ? (
                            <RequestActions
                              request={item}
                              activeAction={activeAction}
                              isMutating={transition.isPending}
                              balanceValidation={balanceValidation}
                              onAction={(action) =>
                                transition.mutate({
                                  id: item.id,
                                  action,
                                  expectedStatus: normalizeStatus(item.status),
                                })
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Decisão da coordenação
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function validationClass(status: BalanceValidationStatus) {
  if (status === "ready") return "border-primary/20 bg-primary/10 text-primary";
  if (status === "not-required") {
    return "border-border bg-white/70 text-muted-foreground";
  }
  if (status === "checking" || status === "unknown") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-destructive/20 bg-destructive/10 text-destructive";
}

function validationLineClass(status: ValidationLineStatus) {
  if (status === "ready") return "border-primary/20 bg-primary/10";
  if (status === "unknown") return "border-amber-200 bg-amber-50";
  return "border-destructive/20 bg-destructive/10";
}

function validationIcon(status: BalanceValidationStatus): LucideIcon {
  if (status === "ready") return ShieldCheck;
  if (status === "not-required") return CheckCircle2;
  if (status === "checking") return RefreshCw;
  return AlertTriangle;
}

function impactToneClass(tone: "success" | "warning" | "danger" | "info") {
  if (tone === "success") return "border-primary/20 bg-primary/10 text-primary";
  if (tone === "danger") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function DataQualityWarnings({ request }: { request: CustomerRequest }) {
  const warnings = getDataWarnings(request);
  if (warnings.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {warnings.map((warning) => (
        <Badge
          key={warning}
          variant="outline"
          className="gap-1.5 border-amber-200 bg-amber-50 text-amber-800"
        >
          <AlertTriangle className="size-3.5" />
          {warning}
        </Badge>
      ))}
    </div>
  );
}

function BalanceValidationPanel({
  validation,
}: {
  validation: BalanceValidation;
}) {
  const Icon = validationIcon(validation.status);
  const visibleLines = validation.lines.slice(0, 2);
  const hiddenCount = validation.lines.length - visibleLines.length;

  return (
    <div className="max-w-[280px] space-y-2">
      <Badge
        variant="outline"
        className={cn("max-w-full gap-1.5", validationClass(validation.status))}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            validation.status === "checking" && "animate-spin",
          )}
        />
        <span className="truncate">{validation.title}</span>
      </Badge>
      <div className="text-xs leading-5 text-muted-foreground">
        {validation.detail}
      </div>
      {validation.requestedTotal !== undefined ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Solicitado: {formatQuantity(validation.requestedTotal)}</span>
          {validation.availableTotal !== undefined ? (
            <span>Disponível: {formatQuantity(validation.availableTotal)}</span>
          ) : null}
        </div>
      ) : null}
      {visibleLines.length > 0 ? (
        <div className="space-y-1.5">
          {visibleLines.map((line) => (
            <div
              key={line.key}
              className={cn(
                "rounded-[14px] border px-2.5 py-1.5 text-xs",
                validationLineClass(line.status),
              )}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {line.skuCode ?? line.clientItemCode ?? line.label}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatQuantity(line.requested)}
                </span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                {line.message}
              </div>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <div className="text-xs text-muted-foreground">
              +{numberFormatter.format(hiddenCount)}{" "}
              {hiddenCount === 1 ? "linha" : "linhas"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OperationalImpactCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  icon: LucideIcon;
  tone: "success" | "warning" | "danger" | "info";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-foreground/70">
            {title}
          </CardTitle>
          <div className="mt-3 truncate text-2xl font-semibold text-foreground">
            {numberFormatter.format(value)}
          </div>
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[16px] border",
            impactToneClass(tone),
          )}
        >
          <Icon className="size-4" />
        </div>
      </CardHeader>
    </Card>
  );
}

function RequestItemsPreview({ request }: { request: CustomerRequest }) {
  const items = getRequestItems(request);

  if (items.length === 0) {
    return (
      <div className="flex max-w-[280px] items-center gap-2 rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <Boxes className="size-3.5 shrink-0" />
        <span>items não informado</span>
      </div>
    );
  }

  const visibleItems = items.slice(0, 3);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="flex max-w-[320px] flex-col gap-1.5">
      {visibleItems.map((item, index) => {
        const unit = getItemUnit(item);
        const quantity = getItemQuantity(item);
        return (
          <div
            key={`${getItemLabel(item)}-${index}`}
            className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] border border-border bg-white/55 px-3 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate font-medium text-foreground">
              {getItemLabel(item)}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {quantity === undefined
                ? "Qtd. aberta"
                : `${formatQuantity(quantity)}${unit ? ` ${unit}` : ""}`}
            </span>
          </div>
        );
      })}
      {hiddenCount > 0 ? (
        <div className="text-xs text-muted-foreground">
          +{numberFormatter.format(hiddenCount)}{" "}
          {hiddenCount === 1 ? "item" : "itens"}
        </div>
      ) : null}
    </div>
  );
}

function QuantityTotal({ request }: { request: CustomerRequest }) {
  const explicitTotal = getExplicitQuantityTotal(request);
  const total = getQuantityTotal(request);
  const itemCount = getRequestItems(request).length;
  const missingTotal = explicitTotal === undefined;

  return (
    <div className="whitespace-nowrap">
      <div className="font-semibold text-foreground">{formatQuantity(total)}</div>
      {missingTotal ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="size-3.5" />
          <span>quantity_total ausente</span>
        </div>
      ) : null}
      <div className="mt-1 text-xs text-muted-foreground">
        {itemCount === 0
          ? "sem linhas"
          : itemCount === 1
            ? "1 linha"
            : `${numberFormatter.format(itemCount)} linhas`}
      </div>
    </div>
  );
}

function OperationalLinks({ request }: { request: CustomerRequest }) {
  const entities = getOperationalEntities(request);
  const links: Array<{ label: string; value?: string | null; icon: LucideIcon }> = [
    { label: "Pedido", value: entities.order_id, icon: ClipboardList },
    { label: "Recebimento", value: entities.inbound_id, icon: PackageCheck },
    { label: "Picking", value: entities.pick_task_id, icon: Link2 },
  ].filter((link) => Boolean(link.value));

  if (links.length === 0) {
    return (
      <div className="max-w-[220px] text-xs leading-5 text-muted-foreground">
        {normalizeStatus(request.status) === "approved"
          ? "Aprovada sem vínculo"
          : "Sem vínculo operacional"}
      </div>
    );
  }

  return (
    <div className="flex max-w-[260px] flex-col gap-1.5">
      {links.map(({ label, value, icon: Icon }) => (
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

function RequestActions({
  request,
  activeAction,
  isMutating,
  balanceValidation,
  onAction,
}: {
  request: CustomerRequest;
  activeAction?: RequestAction;
  isMutating: boolean;
  balanceValidation: BalanceValidation;
  onAction: (action: RequestAction) => void;
}) {
  const status = normalizeStatus(request.status);
  const canDecide = openStatuses.has(status);
  const canClose = status === "approved";
  const canApprove = canDecide && balanceValidation.canApprove;
  const actionMessage =
    canDecide && !balanceValidation.canApprove
      ? balanceValidation.detail
      : canDecide && isOutboundRequest(request)
        ? balanceValidation.detail
        : actionHint(request.status);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canApprove || isMutating}
          onClick={() => onAction("approve")}
        >
          {activeAction === "approve" ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <CheckCircle2 />
          )}
          {activeAction === "approve" ? "Aprovando" : "Aprovar"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!canDecide || isMutating}
          onClick={() => onAction("reject")}
        >
          {activeAction === "reject" ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <XCircle />
          )}
          {activeAction === "reject" ? "Rejeitando" : "Rejeitar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canClose || isMutating}
          onClick={() => onAction("close")}
        >
          {activeAction === "close" ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <Archive />
          )}
          {activeAction === "close" ? "Encerrando" : "Encerrar"}
        </Button>
      </div>
      <div className="max-w-[240px] text-right text-xs leading-5 text-muted-foreground">
        {actionMessage}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="mt-3 text-2xl font-semibold">
            {numberFormatter.format(value)}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-border bg-white/70">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
    </Card>
  );
}
