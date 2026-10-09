import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  RefreshCw,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { canDecideRequests, humanApiError } from "@/lib/permissions";
import { useItemPhotos } from "@/lib/use-item-photos";
import { cn } from "@/lib/utils";

export type CustomerRequest = {
  id: string;
  customer_code?: string;
  type?: string;
  priority?: string;
  title?: string;
  description?: string;
  status?: string;
  stock_reservation_status?: string | null;
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
  /** Timestamp do Firestore como veio da lista; ver parseRequestDate. */
  created_at?: unknown;
  requested_by?: {
    name?: string;
    email?: string;
  };
  decision_reason?: string | null;
  decided_at?: unknown;
  decided_by?: {
    name?: string;
    email?: string;
  } | null;
};

export type CustomerRequestItem =
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

export type StockBalance = {
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
  reason?: string;
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
    | "status"
    | "created_entities"
    | "order_id"
    | "inbound_id"
    | "pick_task_id"
    | "decision_reason"
  >
>;

type RequestStatus =
  | "open"
  | "submitted"
  | "pending"
  | "approved"
  | "rejected"
  | "closed";


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
  productName?: string;
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

export type BalanceValidation = {
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


function normalizeSlug(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeStatus(status?: string | null): RequestStatus {
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



export function requestTypeLabel(type?: string | null) {
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

export function getQuantityTotal(request: CustomerRequest) {
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



export function getRequestValidationLines(request: CustomerRequest): RequestValidationLine[] {
  const itemLines = getRequestItems(request).map((item, index) => {
    const label = getItemLabel(item);
    const locationId = getItemLocation(item);
    return {
      key: `${label}-${locationId ?? "sem-local"}-${index}`,
      label,
      productName:
        typeof item === "string"
          ? undefined
          : firstNonEmpty(item.product_name, item.product, item.name),
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

/**
 * Um SKU pode ter saldo em mais de uma localização — a reserva de verdade
 * (createCustomerRequestTransaction) soma todas ao alocar. Retornar só a
 * primeira linha encontrada subestima o disponível sempre que o estoque do
 * SKU está fragmentado entre localizações.
 */
function findStockBalancesForLine(
  balances: StockBalance[],
  line: RequestValidationLine,
  customerCode?: string,
) {
  return balances.filter((balance) => {
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

export function buildBalanceValidation(
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

  // createCustomerRequestTransaction já reserva o estoque atomicamente no
  // envio do pedido (qty_reserved/qty_available de stock_balances já saem de
  // lá refletindo essa própria reserva). Comparar "solicitado" contra o
  // saldo ao vivo aqui compara contra um disponível que já teve a reserva
  // deste mesmo pedido descontada — qualquer pedido que reservou uma fatia
  // relevante do saldo de um SKU aparenta "saldo insuficiente" mesmo estando
  // correto. Se o pedido já está reservado, a validação de saldo já
  // aconteceu (com sucesso) no momento da criação; não há o que reconferir
  // aqui além de confirmar que a reserva está de pé.
  if (request.stock_reservation_status === "reserved") {
    return {
      status: "ready",
      title: "Saldo reservado no envio",
      detail:
        "O pedido já reservou o estoque no momento em que foi criado — a validação de saldo já foi feita então.",
      canApprove: true,
      requestedTotal,
      issueCount: 0,
      lines: lines.map((line) => ({
        ...line,
        status: "ready",
        message: "Reservado no envio do pedido.",
      })),
    };
  }

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
    const matches = findStockBalancesForLine(
      balances,
      line,
      request.customer_code,
    );

    if (matches.length === 0) {
      return {
        ...line,
        status: "missing-balance",
        message: "Saldo não encontrado para este SKU.",
      };
    }

    const availableValues = matches
      .map((balance) => getStockBalanceAvailable(balance))
      .filter((value): value is number => value !== undefined);
    if (availableValues.length === 0) {
      return {
        ...line,
        status: "unknown",
        balanceId: getStockBalanceId(matches[0]),
        message: "Saldo encontrado sem quantidade disponível.",
      };
    }

    const available = availableValues.reduce((sum, value) => sum + value, 0);

    if ((line.requested ?? 0) > available) {
      return {
        ...line,
        status: "insufficient",
        available,
        balanceId: getStockBalanceId(matches[0]),
        message: `Disponível: ${formatQuantity(available)}.`,
      };
    }

    return {
      ...line,
      status: "ready",
      available,
      balanceId: getStockBalanceId(matches[0]),
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

// ---------------------------------------------------------------------------
// Triagem: lista à esquerda, solicitação aberta à direita. A tela diz em uma
// frase se dá para aprovar e por quê; os itens com problema vêm primeiro.
// ---------------------------------------------------------------------------

export type RequestTab = "decide" | "approved" | "done";

export function requestTab(status?: string | null): RequestTab {
  const normalized = normalizeStatus(status);
  if (openStatuses.has(normalized)) return "decide";
  if (normalized === "approved") return "approved";
  return "done";
}

/**
 * A lista genérica devolve os campos de data do Firestore como vieram
 * (Timestamp serializado em {seconds, nanoseconds}); new Date() sobre esse
 * objeto dava "Sem data" em toda solicitação.
 */
export function parseRequestDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "object") {
    const record = value as {
      toDate?: () => Date;
      seconds?: unknown;
      _seconds?: unknown;
    };
    if (typeof record.toDate === "function") return record.toDate();
    const seconds = Number(record.seconds ?? record._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return undefined;
}

function formatRequestDate(value: unknown) {
  const date = parseRequestDate(value);
  return date ? dateFormatter.format(date) : undefined;
}

export function formatRequestAge(value: unknown, now = Date.now()) {
  const date = parseRequestDate(value);
  if (!date) return undefined;
  const minutes = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return dateFormatter.format(date).split(" ")[0];
}

export type VerdictTone =
  | "ready"
  | "blocked"
  | "checking"
  | "approved"
  | "rejected"
  | "closed";

export type RequestVerdict = {
  tone: VerdictTone;
  title: string;
  detail: string;
  readyCount?: number;
  totalCount?: number;
};

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${numberFormatter.format(count)} ${count === 1 ? singular : pluralForm}`;
}

export function buildVerdict(
  request: CustomerRequest,
  validation: BalanceValidation,
): RequestVerdict {
  const status = normalizeStatus(request.status);
  if (status === "rejected") {
    return {
      tone: "rejected",
      title: "Recusada",
      detail: request.decision_reason
        ? `Motivo: ${request.decision_reason}`
        : "Recusada sem motivo registrado.",
    };
  }
  if (status === "closed") {
    return { tone: "closed", title: "Encerrada", detail: "Fluxo concluído." };
  }
  if (status === "approved") {
    return {
      tone: "approved",
      title: "Aprovada",
      detail: isOutboundRequest(request)
        ? "Pedido criado e enviado para separação."
        : isInboundRequest(request)
          ? "Recebimento criado; o saldo entra depois da conferência."
          : "Aprovada pela coordenação.",
    };
  }

  if (validation.status === "checking") {
    return {
      tone: "checking",
      title: "Conferindo o saldo",
      detail: "Consultando o estoque antes de liberar a aprovação.",
    };
  }

  if (validation.canApprove) {
    const detail =
      request.stock_reservation_status === "reserved"
        ? "O estoque já foi reservado quando o cliente enviou o pedido."
        : isInboundRequest(request)
          ? "Aprovar cria o recebimento; o saldo entra depois da conferência."
          : validation.status === "ready"
            ? "Todos os itens têm saldo disponível."
            : validation.status === "unknown"
              ? "Não consegui consultar o saldo agora; o sistema confere de novo ao aprovar."
              : validation.detail;
    return { tone: "ready", title: "Pronta para aprovar", detail };
  }

  const lines = validation.lines;
  const totalCount = lines.length;
  if (validation.status === "missing-data") {
    return {
      tone: "blocked",
      title: totalCount
        ? `Ainda não dá para aprovar: ${validation.issueCount} de ${plural(totalCount, "item", "itens")} sem SKU ou quantidade`
        : "Ainda não dá para aprovar: a solicitação não tem itens",
      detail: "Peça ao cliente para corrigir a solicitação ou recuse explicando o motivo.",
      totalCount,
    };
  }

  const readyCount = lines.filter((line) => line.status === "ready").length;
  const missing = lines.filter((line) => line.status === "missing-balance").length;
  const short = lines.filter((line) => line.status === "insufficient").length;
  const reasons = [
    missing ? `${plural(missing, "item", "itens")} sem saldo cadastrado` : null,
    short ? `${plural(short, "item", "itens")} com saldo menor que o pedido` : null,
  ].filter(Boolean);
  return {
    tone: "blocked",
    title: `Ainda não dá para aprovar: ${validation.issueCount} de ${plural(totalCount, "item", "itens")} sem saldo suficiente`,
    detail: [
      reasons.length ? `${capitalize(reasons.join(" e "))}.` : null,
      readyCount === 1
        ? "O outro item tem saldo."
        : readyCount > 1
          ? `Os outros ${numberFormatter.format(readyCount)} itens têm saldo.`
          : null,
      "Confira os códigos com o cliente ou recuse explicando o motivo.",
    ]
      .filter(Boolean)
      .join(" "),
    readyCount,
    totalCount,
  };
}

export function lineSituation(
  line: BalanceValidationLine,
  reserved: boolean,
): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (line.status === "ready") {
    return { label: reserved ? "Reservado" : "OK", tone: "ok" };
  }
  if (line.status === "insufficient") {
    const missing = Math.max(0, (line.requested ?? 0) - (line.available ?? 0));
    return { label: `Faltam ${numberFormatter.format(missing)}`, tone: "warn" };
  }
  if (line.status === "missing-balance") {
    return { label: "Sem saldo cadastrado", tone: "bad" };
  }
  if (line.status === "missing-data") {
    return { label: "Falta SKU ou quantidade", tone: "bad" };
  }
  return { label: "Não conferido", tone: "muted" };
}

function priorityWeight(priority?: string | null) {
  const normalized = normalizeSlug(priority ?? "normal");
  if (["critica", "critical", "urgente"].includes(normalized)) return 0;
  if (["alta", "high"].includes(normalized)) return 1;
  return 2;
}

const TONE_CHIP: Record<"ok" | "warn" | "bad" | "muted" | "info", string> = {
  ok: "bg-success-soft text-success-soft-foreground",
  warn: "bg-warning-soft text-warning-soft-foreground",
  bad: "bg-destructive-soft text-destructive-soft-foreground",
  muted: "bg-muted text-muted-foreground",
  info: "bg-info-soft text-info-soft-foreground",
};

function Chip({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof TONE_CHIP;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CHIP[tone],
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function listChip(request: CustomerRequest, validation: BalanceValidation) {
  const verdict = buildVerdict(request, validation);
  if (verdict.tone === "ready") {
    return <Chip tone="ok" icon={CheckCircle2}>Pronta para aprovar</Chip>;
  }
  if (verdict.tone === "blocked") {
    return (
      <Chip tone="warn" icon={AlertTriangle}>
        {validation.status === "missing-data"
          ? "Dados faltando"
          : `${plural(validation.issueCount, "item", "itens")} sem saldo`}
      </Chip>
    );
  }
  if (verdict.tone === "checking") return <Chip tone="muted">Conferindo saldo</Chip>;
  if (verdict.tone === "approved") return <Chip tone="info">Aprovada</Chip>;
  if (verdict.tone === "rejected") return <Chip tone="bad">Recusada</Chip>;
  return <Chip tone="muted">Encerrada</Chip>;
}

export function requestTitle(request: CustomerRequest) {
  return request.description || request.title || "Solicitação sem descrição";
}

export function requestSummary(request: CustomerRequest) {
  const lines = getRequestValidationLines(request).length;
  const total = getQuantityTotal(request);
  return [
    requestTypeLabel(request.type),
    request.customer_code || "BTG Pactual",
    lines ? plural(lines, "item", "itens") : null,
    total !== undefined ? `${numberFormatter.format(total)} un.` : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const [tab, setTab] = useState<RequestTab>("decide");
  // /solicitacoes?id=<id> abre direto a solicitação (vem da fila de Pedidos).
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("id");
  });
  const [rejecting, setRejecting] = useState<CustomerRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
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
    mutationFn: ({ id, action, expectedStatus, reason }) =>
      fetchJson<TransitionResponse>(
        `/api/customer-requests/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_status: expectedStatus,
            reason,
            idempotency_key: `${id}:${action}:${expectedStatus}`,
          }),
        },
      ),
    onSuccess: (result, variables) => {
      const overlay = {
        ...getTransitionOverlay(result, variables.action),
        ...(variables.reason ? { decision_reason: variables.reason } : {}),
      };
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
      setRejecting(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: stockBalancesQueryKey });
      qc.invalidateQueries({ queryKey: ["warehouse-ops"] });
      qc.invalidateQueries({ queryKey: ["ai-overview"] });
      toast({ title: actionToastTitle(variables.action) });
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

  const tabCounts = useMemo(() => {
    const counts: Record<RequestTab, number> = { decide: 0, approved: 0, done: 0 };
    allRequests.forEach((item) => {
      counts[requestTab(item.status)] += 1;
    });
    return counts;
  }, [allRequests]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const time = (item: CustomerRequest) =>
      parseRequestDate(item.created_at)?.getTime() ?? 0;
    return allRequests
      .filter((item) => requestTab(item.status) === tab)
      .filter((item) => {
        if (!needle) return true;
        return [
          item.id,
          item.customer_code,
          item.type,
          item.title,
          item.description,
          item.requested_by?.email,
          item.requested_by?.name,
          ...getRequestItems(item).map((requestItem) => getItemLabel(requestItem)),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((left, right) =>
        // Para aprovar: urgência primeiro, depois quem espera há mais tempo.
        tab === "decide"
          ? priorityWeight(left.priority) - priorityWeight(right.priority) ||
            time(left) - time(right)
          : time(right) - time(left),
      );
  }, [allRequests, search, tab]);

  const selected =
    visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  const validationFor = (item: CustomerRequest) =>
    balanceValidationById.get(item.id) ??
    buildBalanceValidation(
      item,
      stockBalances.data?.items,
      stockBalances.isLoading,
      Boolean(stockBalances.error),
    );

  const decide = (item: CustomerRequest, action: RequestAction, reason?: string) =>
    transition.mutate({
      id: item.id,
      action,
      expectedStatus: normalizeStatus(item.status),
      reason,
    });

  const tabs: Array<{ value: RequestTab; label: string }> = [
    { value: "decide", label: "Para aprovar" },
    { value: "approved", label: "Aprovadas" },
    { value: "done", label: "Encerradas" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Solicitações</h1>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => requests.refetch()}
            disabled={requests.isFetching}
          >
            <RefreshCw className={cn("size-4", requests.isFetching && "animate-spin")} />
            <span className="sr-only">Atualizar</span>
          </Button>
        </div>
        <div className="grid grid-cols-3 rounded-xl bg-muted p-1 lg:flex" role="tablist">
          {tabs.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => {
                setTab(option.value);
                setSelectedId(null);
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
                tab === option.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground",
              )}
            >
              {option.label}
              {option.value === "decide" && tabCounts.decide > 0 ? (
                <span className="rounded-full bg-destructive-soft px-1.5 text-xs font-semibold text-destructive-soft-foreground">
                  {tabCounts.decide}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título, SKU ou cliente"
              className="pl-9"
            />
          </div>
          {requests.isLoading ? (
            <p className="px-1 py-6 text-sm text-muted-foreground">
              Carregando solicitações...
            </p>
          ) : requests.error ? (
            <p className="px-1 py-6 text-sm text-destructive">
              Não consegui carregar a fila.
            </p>
          ) : visible.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              {tab === "decide" && !search ? (
                <>
                  <CheckCircle2 className="size-4 text-success-soft-foreground" />
                  Nenhuma solicitação esperando decisão.
                </>
              ) : (
                "Nenhuma solicitação encontrada."
              )}
            </div>
          ) : (
            visible.map((item) => {
              const active = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "rounded-2xl border bg-card px-4 py-3.5 text-left transition-[border-color,box-shadow]",
                    active
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <p className="line-clamp-2 text-sm font-semibold text-foreground">
                    {requestTitle(item)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-foreground/60">
                    {requestSummary(item)}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    {listChip(item, validationFor(item))}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRequestAge(item.created_at) ?? ""}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </section>

        {selected ? (
          <RequestDetail
            key={selected.id}
            request={selected}
            validation={validationFor(selected)}
            canDecide={requestDecider}
            pendingAction={
              transition.isPending && transition.variables?.id === selected.id
                ? transition.variables.action
                : undefined
            }
            busy={transition.isPending}
            onApprove={() => decide(selected, "approve")}
            onReject={() => {
              setRejectReason("");
              setRejecting(selected);
            }}
            onClose={() => decide(selected, "close")}
          />
        ) : null}
      </div>

      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar solicitação</DialogTitle>
            <DialogDescription>
              O motivo fica registrado na solicitação e aparece para o cliente.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Ex.: 20 itens sem saldo no estoque. Confirme os códigos e envie de novo."
            rows={4}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejecting(null)}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectReason.trim().length < 3 || transition.isPending}
              onClick={() =>
                rejecting && decide(rejecting, "reject", rejectReason.trim())
              }
            >
              {transition.isPending ? "Recusando..." : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const VERDICT_STYLE: Record<
  VerdictTone,
  { box: string; icon: string; Icon: LucideIcon }
> = {
  ready: { box: "border-success-soft-border bg-success-soft/70", icon: "bg-success-soft-border/50 text-success-soft-foreground", Icon: CheckCircle2 },
  blocked: { box: "border-warning-soft-border bg-warning-soft/70", icon: "bg-warning-soft-border/50 text-warning-soft-foreground", Icon: AlertTriangle },
  checking: { box: "border-border bg-muted/40", icon: "bg-muted text-muted-foreground", Icon: RefreshCw },
  approved: { box: "border-info-soft-border bg-info-soft/70", icon: "bg-info-soft-border/50 text-info-soft-foreground", Icon: CheckCircle2 },
  rejected: { box: "border-destructive-soft-border bg-destructive-soft/70", icon: "bg-destructive-soft-border/50 text-destructive-soft-foreground", Icon: XCircle },
  closed: { box: "border-border bg-muted/40", icon: "bg-muted text-muted-foreground", Icon: Archive },
};

function RequestDetail({
  request,
  validation,
  canDecide,
  pendingAction,
  busy,
  onApprove,
  onReject,
  onClose,
}: {
  request: CustomerRequest;
  validation: BalanceValidation;
  canDecide: boolean;
  pendingAction?: RequestAction;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const verdict = buildVerdict(request, validation);
  const style = VERDICT_STYLE[verdict.tone];
  // Mesma foto do Estoque, para quem aprova ver o que está sendo pedido.
  const photoFor = useItemPhotos();
  const status = normalizeStatus(request.status);
  const reserved = request.stock_reservation_status === "reserved";
  // Pedido já decidido não é revalidado contra o saldo de agora: a reserva
  // foi consumida ou liberada, e o "sem saldo" que aparecia confundia.
  const lines: BalanceValidationLine[] =
    status !== "approved" && openStatuses.has(status) && validation.lines.length
      ? validation.lines
      : getRequestValidationLines(request).map((line) => ({
          ...line,
          status: "unknown" as const,
          message: "",
        }));
  const checked =
    openStatuses.has(status) &&
    validation.lines.length > 0 &&
    validation.status !== "not-required";
  const problemLines = checked
    ? lines.filter((line) => line.status !== "ready")
    : [];
  const [onlyProblems, setOnlyProblems] = useState(true);
  const showProblems = onlyProblems && problemLines.length > 0;
  const shownLines = showProblems ? problemLines : lines;
  const total = getQuantityTotal(request);
  const sentAt = formatRequestDate(request.created_at);
  const decidedAt = formatRequestDate(request.decided_at);
  const decidedBy = request.decided_by?.name || request.decided_by?.email;
  const entities = getOperationalEntities(request);
  const approveLabel = isOutboundRequest(request)
    ? "Aprovar e separar"
    : isInboundRequest(request)
      ? "Aprovar e criar recebimento"
      : "Aprovar";

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-0 lg:max-h-[calc(100dvh-190px)]">
      <header className="border-b border-border/70 px-5 py-5 md:px-6">
        <div className="mb-2 flex flex-wrap gap-2">
          <Chip tone="muted">{requestTypeLabel(request.type)}</Chip>
          <Chip tone={priorityWeight(request.priority) < 2 ? "warn" : "muted"}>
            Prioridade {priorityLabel(request.priority)}
          </Chip>
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          {requestTitle(request)}
        </h2>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground/60">
          <div>
            Cliente <span className="font-semibold text-foreground">{request.customer_code || "BTG Pactual"}</span>
          </div>
          <div>
            Pedido por{" "}
            <span className="font-semibold text-foreground">
              {request.requested_by?.name || request.requested_by?.email || "Portal do cliente"}
            </span>
          </div>
          {sentAt ? (
            <div>
              Enviado <span className="font-semibold text-foreground">{sentAt}</span>
            </div>
          ) : null}
          <div>
            <span className="font-semibold text-foreground">{plural(lines.length, "item", "itens")}</span>
            {total !== undefined ? (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{numberFormatter.format(total)}</span> un.
              </>
            ) : null}
          </div>
        </dl>
      </header>

      <div className={cn("mx-5 mt-4 flex gap-3 rounded-2xl border p-4 md:mx-6", style.box)}>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", style.icon)}>
          <style.Icon className={cn("size-4", verdict.tone === "checking" && "animate-spin")} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{verdict.title}</p>
          <p className="mt-0.5 text-sm text-foreground/70">{verdict.detail}</p>
          {(status === "approved" || status === "rejected" || status === "closed") &&
          (decidedBy || decidedAt) ? (
            <p className="mt-1 text-xs text-foreground/55">
              {[decidedBy ? `Por ${decidedBy}` : null, decidedAt].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {verdict.tone === "blocked" && verdict.totalCount && verdict.readyCount !== undefined ? (
            <div className="mt-2.5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-warning-soft-border/50">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.round((verdict.readyCount / verdict.totalCount) * 100)}%` }}
              />
            </div>
          ) : null}
          {status === "approved" && (entities.order_id || entities.inbound_id) ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href={entities.order_id ? "/pedidos" : "/wms/receber"}>
                {entities.order_id ? "Ver em Pedidos" : "Ver no Recebimento"}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 md:px-6">
        <div className="mb-2 flex items-center gap-2">
          {problemLines.length > 0 ? (
            <>
              <FilterPill active={showProblems} onClick={() => setOnlyProblems(true)}>
                Com problema ({problemLines.length})
              </FilterPill>
              <FilterPill active={!showProblems} onClick={() => setOnlyProblems(false)}>
                Todos ({lines.length})
              </FilterPill>
            </>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Itens ({lines.length})
            </p>
          )}
        </div>
        <div className="max-h-[420px] min-h-[160px] overflow-auto lg:max-h-none lg:min-h-0 lg:flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="py-2 pr-3 font-semibold">Item</th>
                <th className="py-2 pr-3 text-right font-semibold">Pedido</th>
                {checked ? (
                  <>
                    <th className="py-2 pr-3 text-right font-semibold">Disponível</th>
                    <th className="py-2 font-semibold">Situação</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shownLines.map((line) => {
                const situation = lineSituation(line, reserved);
                return (
                  <tr key={line.key} className="border-b border-border/40">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-3">
                        {photoFor(line.skuCode, line.clientItemCode) ? (
                          <img
                            src={photoFor(line.skuCode, line.clientItemCode)}
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded-lg bg-muted object-cover"
                          />
                        ) : (
                          <span className="size-10 shrink-0 rounded-lg border border-dashed border-border" />
                        )}
                        <div className="min-w-0">
                          <div className="font-mono text-sm text-foreground/85">{line.label}</div>
                          {line.productName && line.productName !== line.label ? (
                            <div className="text-xs text-foreground/55">{line.productName}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {formatQuantity(line.requested)}
                    </td>
                    {checked ? (
                      <>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-foreground/70">
                          {reserved || line.available === undefined
                            ? "—"
                            : numberFormatter.format(line.available)}
                        </td>
                        <td className="py-2.5">
                          <Chip tone={situation.tone}>{situation.label}</Chip>
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {canDecide && (openStatuses.has(status) || status === "approved") ? (
        <footer className="mt-4 flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <p className="text-sm text-foreground/60">
            {status === "approved"
              ? "Encerre quando o pedido estiver entregue ou o recebimento concluído."
              : validation.canApprove
                ? isOutboundRequest(request)
                  ? "Aprovar cria o pedido e manda para separação."
                  : "Confira os itens antes de aprovar."
                : "Aprovar libera quando todos os itens tiverem saldo."}
          </p>
          <div className="flex shrink-0 gap-2">
            {status === "approved" ? (
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                <Archive className="size-4" />
                {pendingAction === "close" ? "Encerrando..." : "Encerrar"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={onReject}
                >
                  <XCircle className="size-4" />
                  Recusar com motivo
                </Button>
                <Button
                  type="button"
                  disabled={busy || !validation.canApprove}
                  onClick={onApprove}
                >
                  <CheckCircle2 className="size-4" />
                  {pendingAction === "approve" ? "Aprovando..." : approveLabel}
                </Button>
              </>
            )}
          </div>
        </footer>
      ) : !canDecide && openStatuses.has(status) ? (
        <footer className="mt-4 border-t border-border/70 px-5 py-4 text-sm text-muted-foreground md:px-6">
          A decisão é da coordenação.
        </footer>
      ) : (
        <div className="h-5" />
      )}
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground/65 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
