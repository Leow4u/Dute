import type { StockItem } from "./stock-items";

/**
 * Relatórios: cada um vira linhas prontas para a prévia e para a planilha.
 * As fontes são as mesmas das telas (Estoque usa buildStockItems; o ledger
 * `movements` é o histórico de estoque; `customer_requests` são os pedidos e
 * avisos de chegada). A planilha é CSV no formato do Excel em português:
 * BOM UTF-8, ponto e vírgula e vírgula decimal.
 */

type AnyRecord = Record<string, unknown>;

export type ReportCell = string | number | null;
export type ReportColumn = { key: string; label: string; kind?: "number" | "money" | "date" | "day" };
export type ReportRow = Record<string, ReportCell>;
export type ReportSummary = { label: string; value: string; tone?: "in" | "out" }[];
export type ReportResult = { columns: ReportColumn[]; rows: ReportRow[]; summary: ReportSummary };

/** Go-live: o estoque foi zerado e recarregado nesta data. */
export const GO_LIVE = "2026-07-30T03:00:00.000Z";

const integer = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DAY = 86_400_000;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function locationsLabel(item: StockItem) {
  return item.locations.map((location) => location.id).join(", ");
}

function itemValue(item: StockItem) {
  return item.unitCost !== undefined ? round2(item.unitCost * item.onHand) : null;
}

// ---------------------------------------------------------------- períodos

/** Mês (AAAA-MM) em horário de Brasília (UTC-3, sem horário de verão). */
export function monthRange(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1, 3));
  const to = new Date(Date.UTC(year, month, 1, 3));
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Dias corridos AAAA-MM-DD (inclusive) em horário de Brasília. */
export function dayRange(fromDay: string, toDay: string) {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  return {
    from: new Date(Date.UTC(fy, fm - 1, fd, 3)).toISOString(),
    to: new Date(Date.UTC(ty, tm - 1, td + 1, 3)).toISOString(),
  };
}

export function competenciaOf(date: Date) {
  const local = new Date(date.getTime() - 3 * 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousCompetencia(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- estoque

export function positionReport(items: StockItem[]): ReportResult {
  const withStock = items
    .filter((item) => item.onHand > 0)
    .sort((a, b) => (itemValue(b) ?? 0) - (itemValue(a) ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  const total = withStock.reduce((sum, item) => sum + (itemValue(item) ?? 0), 0);
  return {
    columns: [
      { key: "code", label: "SKU" },
      { key: "sku", label: "SKU" },
      { key: "name", label: "Item" },
      { key: "locations", label: "Endereços" },
      { key: "onHand", label: "Quantidade", kind: "number" },
      { key: "reserved", label: "Reservado", kind: "number" },
      { key: "available", label: "Disponível", kind: "number" },
      { key: "unitCost", label: "Custo unit.", kind: "money" },
      { key: "value", label: "Valor total", kind: "money" },
    ],
    rows: withStock.map((item) => ({
      code: item.clientCode ?? "",
      sku: item.skuCode,
      name: item.name,
      locations: locationsLabel(item),
      onHand: item.onHand,
      reserved: item.reserved,
      available: item.available,
      unitCost: item.unitCost ?? null,
      value: itemValue(item),
    })),
    summary: [
      { label: "Itens com saldo", value: integer.format(withStock.length) },
      { label: "Unidades", value: integer.format(withStock.reduce((sum, item) => sum + item.onHand, 0)) },
      { label: "Valor em estoque", value: money.format(round2(total)) },
    ],
  };
}

export function belowMinimumReport(items: StockItem[]): ReportResult {
  const below = items
    .filter((item) => item.minimum !== undefined && item.onHand <= item.minimum)
    .map((item) => ({ item, missing: (item.minimum ?? 0) - item.onHand }))
    .sort((a, b) => b.missing - a.missing || a.item.name.localeCompare(b.item.name, "pt-BR"));
  return {
    columns: [
      { key: "code", label: "SKU" },
      { key: "name", label: "Item" },
      { key: "locations", label: "Endereços" },
      { key: "onHand", label: "Saldo", kind: "number" },
      { key: "minimum", label: "Mínimo", kind: "number" },
      { key: "missing", label: "Falta para o mínimo", kind: "number" },
    ],
    rows: below.map(({ item, missing }) => ({
      code: item.clientCode ?? item.skuCode,
      name: item.name,
      locations: locationsLabel(item),
      onHand: item.onHand,
      minimum: item.minimum ?? null,
      missing,
    })),
    summary: [
      { label: "Itens para repor", value: integer.format(below.length) },
      { label: "Zerados", value: integer.format(below.filter(({ item }) => item.onHand <= 0).length) },
      { label: "Itens com mínimo cadastrado", value: integer.format(items.filter((item) => item.minimum !== undefined).length) },
    ],
  };
}

function movementSku(movement: AnyRecord) {
  return text(movement.sku_code) || text(movement.cod_sku);
}

function movementDate(movement: AnyRecord) {
  return text(movement.occurred_at) || text(movement.data);
}

/**
 * Itens com saldo sem entrada nem saída há `days` dias. Sem movimento desde
 * o go-live, conta a partir dele (o saldo veio do inventário de abertura).
 */
export function idleReport(
  items: StockItem[],
  movements: AnyRecord[],
  days: number,
  now: Date,
): ReportResult {
  // O ledger grava o SKU interno e o código do cliente; vale qualquer um.
  const last = new Map<string, string>();
  for (const movement of movements) {
    const date = movementDate(movement);
    if (!date) continue;
    for (const key of [movementSku(movement), text(movement.client_item_code)]) {
      if (key && date > (last.get(key) ?? "")) last.set(key, date);
    }
  }
  const idle = items
    .filter((item) => item.onHand > 0)
    .map((item) => {
      const lastMove =
        last.get(item.skuCode) ?? (item.clientCode ? last.get(item.clientCode) : undefined) ?? GO_LIVE;
      const idleDays = Math.floor((now.getTime() - new Date(lastMove).getTime()) / DAY);
      return { item, lastMove, idleDays };
    })
    .filter(({ idleDays }) => idleDays >= days)
    .sort((a, b) => (itemValue(b.item) ?? 0) - (itemValue(a.item) ?? 0) || b.idleDays - a.idleDays);
  const value = idle.reduce((sum, { item }) => sum + (itemValue(item) ?? 0), 0);
  return {
    columns: [
      { key: "code", label: "SKU" },
      { key: "name", label: "Item" },
      { key: "locations", label: "Endereços" },
      { key: "onHand", label: "Saldo", kind: "number" },
      { key: "value", label: "Valor", kind: "money" },
      { key: "lastMove", label: "Último movimento", kind: "day" },
      { key: "idleDays", label: "Parado há (dias)", kind: "number" },
    ],
    rows: idle.map(({ item, lastMove, idleDays }) => ({
      code: item.clientCode ?? item.skuCode,
      name: item.name,
      locations: locationsLabel(item),
      onHand: item.onHand,
      value: itemValue(item),
      lastMove,
      idleDays,
    })),
    summary: [
      { label: "Itens parados", value: integer.format(idle.length) },
      { label: "Unidades", value: integer.format(idle.reduce((sum, { item }) => sum + item.onHand, 0)) },
      { label: "Valor parado", value: money.format(round2(value)) },
    ],
  };
}

// ---------------------------------------------------------------- operação

export type MovementKind = "Entrada" | "Saída" | "Ajuste" | "Transferência";

/** O que gerou a movimentação, pelo vínculo que o backend grava nela. */
export function classifyMovement(movement: AnyRecord): { kind: MovementKind; origin: string } {
  const inbound = text(movement.tipo_mov).toUpperCase() === "ENTRADA" || num(movement.sign ?? movement.sinal) > 0;
  if (movement.putaway_task_id) {
    return { kind: "Transferência", origin: `Guarda ${text(movement.origem)} → ${text(movement.destino)}`.trim() };
  }
  if (movement.receipt_id) {
    return { kind: "Entrada", origin: `Recebimento ${text(movement.receipt_number) || text(movement.receipt_id)}` };
  }
  if (movement.order_id) {
    return { kind: "Saída", origin: `Pedido ${text(movement.order_number) || text(movement.order_id)}` };
  }
  if (movement.return_id) {
    return { kind: inbound ? "Entrada" : "Saída", origin: "Devolução" };
  }
  if (movement.opening_inventory_session_id || movement.cycle_count_id) {
    return {
      kind: "Ajuste",
      origin: movement.cycle_count_id ? "Contagem" : "Inventário de abertura",
    };
  }
  const reason = text(movement.reason);
  if (movement.operational_operation_id || reason) {
    return { kind: "Ajuste", origin: reason ? `Ajuste: ${reason}` : "Ajuste manual" };
  }
  return { kind: inbound ? "Entrada" : "Saída", origin: text(movement.source) };
}

function actorName(value: unknown) {
  if (value && typeof value === "object") {
    const actor = value as AnyRecord;
    return text(actor.name) || text(actor.email);
  }
  return text(value);
}

export function movementsReport(movements: AnyRecord[]): ReportResult {
  const rows = movements
    .map((movement) => {
      const { kind, origin } = classifyMovement(movement);
      const quantity = Math.abs(num(movement.quantity ?? movement.qtde));
      const inbound = text(movement.tipo_mov).toUpperCase() === "ENTRADA" || num(movement.sign ?? movement.sinal) > 0;
      return {
        date: movementDate(movement),
        kind,
        code: text(movement.client_item_code) || text(movement.cod_cliente_item),
        sku: movementSku(movement),
        name: text(movement.product_name) || text(movement.produto),
        location: text(movement.location_id),
        quantity: inbound ? quantity : -quantity,
        before: movement.qty_before ?? movement.estoque_anterior ?? null,
        after: movement.qty_after ?? movement.estoque_resultante ?? null,
        origin,
        who: actorName(movement.actor) || text(movement.responsavel),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const sum = (kind: MovementKind) =>
    rows.filter((row) => row.kind === kind).reduce((total, row) => total + Math.abs(row.quantity), 0);
  return {
    columns: [
      { key: "date", label: "Data", kind: "date" },
      { key: "kind", label: "Tipo" },
      { key: "code", label: "SKU" },
      { key: "sku", label: "SKU" },
      { key: "name", label: "Item" },
      { key: "location", label: "Endereço" },
      { key: "quantity", label: "Qtd.", kind: "number" },
      { key: "before", label: "Saldo antes", kind: "number" },
      { key: "after", label: "Saldo depois", kind: "number" },
      { key: "origin", label: "Origem" },
      { key: "who", label: "Quem" },
    ],
    rows: rows.map((row) => ({
      ...row,
      before: row.before === null ? null : num(row.before),
      after: row.after === null ? null : num(row.after),
    })),
    summary: [
      { label: "Entradas", value: `+${integer.format(sum("Entrada"))} un.`, tone: "in" },
      { label: "Saídas", value: `−${integer.format(sum("Saída"))} un.`, tone: "out" },
      { label: "Ajustes", value: integer.format(rows.filter((row) => row.kind === "Ajuste").length) },
    ],
  };
}

export type RequestHelpers = {
  date: (value: unknown) => Date | undefined;
  type: (type?: string | null) => string;
  status: (status?: string | null) => string;
  lines: (request: AnyRecord) => number;
  units: (request: AnyRecord) => number | undefined;
};

const REQUEST_STATUS: Record<string, string> = {
  open: "Aguardando decisão",
  submitted: "Aguardando decisão",
  pending: "Aguardando decisão",
  approved: "Aprovado",
  rejected: "Recusado",
  closed: "Concluído",
};

export function requestsReport(requests: AnyRecord[], helpers: RequestHelpers): ReportResult {
  const rows = requests
    .map((request) => {
      const created = helpers.date(request.created_at);
      const decided = helpers.date(request.decided_at);
      const status = helpers.status(text(request.status));
      const by = request.requested_by as AnyRecord | undefined;
      return {
        id: text(request.id),
        type: helpers.type(text(request.type)),
        created: created ? created.toISOString() : "",
        requestedBy: actorName(by),
        lines: helpers.lines(request),
        units: helpers.units(request) ?? null,
        status: REQUEST_STATUS[status] ?? status,
        decidedBy: actorName(request.decided_by),
        decided: decided ? decided.toISOString() : "",
        reason: text(request.decision_reason),
        description: text(request.description) || text(request.title),
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
  const count = (label: string) => rows.filter((row) => row.status === label).length;
  return {
    columns: [
      { key: "created", label: "Solicitado em", kind: "date" },
      { key: "type", label: "Tipo" },
      { key: "description", label: "Descrição" },
      { key: "requestedBy", label: "Por" },
      { key: "lines", label: "Itens", kind: "number" },
      { key: "units", label: "Qtd.", kind: "number" },
      { key: "status", label: "Situação" },
      { key: "decidedBy", label: "Decidido por" },
      { key: "decided", label: "Decidido em", kind: "date" },
      { key: "reason", label: "Motivo" },
      { key: "id", label: "ID" },
    ],
    rows,
    summary: [
      { label: "No período", value: integer.format(rows.length) },
      { label: "Aprovados ou concluídos", value: integer.format(count("Aprovado") + count("Concluído")) },
      { label: "Recusados", value: integer.format(count("Recusado")) },
    ],
  };
}

// ---------------------------------------------------------------- planilha

const decimal = new Intl.NumberFormat("pt-BR", { useGrouping: false, maximumFractionDigits: 4 });
const moneyCell = new Intl.NumberFormat("pt-BR", {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Data/hora de Brasília, como o Excel em português reconhece. */
export function formatDateCell(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = new Date(date.getTime() - 3 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export function formatCell(value: ReportCell, kind?: ReportColumn["kind"]) {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "date") return formatDateCell(String(value));
  if (kind === "day") return formatDateCell(String(value)).slice(0, 10);
  if (typeof value === "number") return kind === "money" ? moneyCell.format(value) : decimal.format(value);
  return String(value);
}

function csvField(value: string) {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toExcelCsv(report: Pick<ReportResult, "columns" | "rows">) {
  const lines = [
    report.columns.map((column) => csvField(column.label)).join(";"),
    ...report.rows.map((row) =>
      report.columns.map((column) => csvField(formatCell(row[column.key] ?? null, column.kind))).join(";"),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
