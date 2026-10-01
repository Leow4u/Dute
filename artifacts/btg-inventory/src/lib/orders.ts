/**
 * Pedidos do portal: o que a BTG pediu do estoque e onde está cada entrega.
 * Junta a solicitação (client_request_status: número, itens, status) com o
 * acompanhamento publicado pela operação (client_order_tracking: etapas,
 * transportadora, entrega).
 */

import { parseDate, sortByCreatedDesc } from "./client-home";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function slug(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const integer = new Intl.NumberFormat("pt-BR");
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export const ORDER_STEPS = ["Pedido feito", "Em separação", "Saiu para entrega", "Entregue"] as const;

export type OrderStage = "placed" | "confirmed" | "picking" | "dispatched" | "delivered" | "rejected" | "cancelled";

export function isOrderRequest(request: AnyRecord) {
  const type = slug(request.type);
  return type.includes("retirada") || type.includes("ajuste") || type.includes("pedido");
}

const PICKING = new Set(["separating", "separated", "checking", "ready_to_dispatch", "picking_planned", "packing_ready"]);

export function orderStage(request: AnyRecord, tracking?: AnyRecord): OrderStage {
  const status = slug(request.status);
  if (status === "cancelled") return "cancelled";
  if (status === "rejected" || status === "rejeitado") return "rejected";
  const progress = slug(tracking?.status) || slug(request.operational_status);
  if (progress === "delivered" || status === "closed") return "delivered";
  if (progress === "dispatched") return "dispatched";
  if (PICKING.has(progress)) return "picking";
  if (status === "approved" || progress === "pending") return "confirmed";
  return "placed";
}

export function orderStepIndex(stage: OrderStage) {
  if (stage === "delivered") return 3;
  if (stage === "dispatched") return 2;
  if (stage === "picking") return 1;
  return 0;
}

/** Número que as pessoas leem; pedido antigo sem número mostra um curto. */
export function orderNumber(request: AnyRecord, tracking?: AnyRecord) {
  const number = text(request.request_number) || text(tracking?.order_number);
  if (number && !/^creq_|^ord_/i.test(number)) return number;
  const id = text(request.id) || text(tracking?.id);
  return id ? `#${id.replace(/^(ord_)?creq_/i, "").slice(-6).toUpperCase()}` : "Pedido";
}

/** "Pedido do estoque com 75 item(ns)" era título automático: não diz nada. */
export function orderTitle(request: AnyRecord) {
  const title = text(request.title);
  if (!title || /^pedido do estoque/i.test(title) || ["retirada", "ajuste"].includes(slug(title))) return "Pedido do estoque";
  return title;
}

export type OrderItem = { code: string; name: string; quantity: number; codePending: boolean };

export function orderItems(request: AnyRecord): OrderItem[] {
  return (Array.isArray(request.items) ? request.items : []).map((value) => {
    const item = (value && typeof value === "object" ? value : {}) as AnyRecord;
    return {
      code: text(item.client_item_code) || text(item.sku_code),
      name: text(item.product_name) || "Item",
      quantity: num(item.quantity),
      codePending: item.code_pending === true,
    };
  });
}

export type OrderEvent = { label: string; at: string; date: Date };

/** Linha do tempo, mais recente primeiro. */
export function orderTimeline(request: AnyRecord, tracking?: AnyRecord): OrderEvent[] {
  const events: Array<{ label: string; date: Date | undefined }> = [
    { label: "Pedido feito no portal", date: parseDate(request.created_at) },
  ];
  const timeline = Array.isArray(tracking?.timeline) ? (tracking!.timeline as AnyRecord[]) : [];
  for (const entry of timeline) {
    const label = text(entry.label);
    events.push({ label: label === "Pedido recebido" ? "Pedido confirmado pela Dutelog" : label, date: parseDate(entry.occurred_at) });
  }
  const stage = orderStage(request, tracking);
  if (stage === "cancelled") events.push({ label: "Cancelado por você", date: parseDate(request.updated_at) });
  if (stage === "rejected") {
    const reason = text(request.decision_reason);
    events.push({ label: `Recusado pela Dutelog${reason ? `: ${reason}` : ""}`, date: parseDate(request.updated_at) });
  }
  return events
    .filter((event): event is { label: string; date: Date } => Boolean(event.label && event.date))
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .map((event) => ({ label: event.label, date: event.date, at: dateTime.format(event.date) }));
}

function stepDate(tracking: AnyRecord | undefined, statuses: string[]) {
  const timeline = Array.isArray(tracking?.timeline) ? (tracking!.timeline as AnyRecord[]) : [];
  const found = timeline.find((entry) => statuses.includes(slug(entry.status)));
  const date = parseDate(found?.occurred_at);
  return date ? dateTime.format(date) : "";
}

export type OrderView = {
  id: string;
  number: string;
  title: string;
  stage: OrderStage;
  stepDates: string[];
  summary: string;
  destination: string;
  due: string;
  detail: string;
  delivery: string;
  canCancel: boolean;
  items: OrderItem[];
  timeline: OrderEvent[];
};

export function orderView(request: AnyRecord, tracking?: AnyRecord): OrderView {
  const stage = orderStage(request, tracking);
  const items = orderItems(request);
  const count = num(request.item_count) || num(tracking?.item_count) || items.length;
  const pieces = num(request.quantity_total) || num(tracking?.quantity_total);
  const created = parseDate(request.created_at);
  const updated = parseDate(request.updated_at);
  const by = text(request.requested_by_name).split(/\s+/)[0];
  const timeline = orderTimeline(request, tracking);
  const latest = timeline[0];
  const carrier = text(tracking?.carrier);
  const plate = text(tracking?.vehicle_plate);
  const delivery = [carrier, plate ? `placa ${plate}` : "", text(tracking?.proof_reference) ? `comprovante ${text(tracking?.proof_reference)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const detail =
    stage === "cancelled"
      ? `cancelado por você${updated ? ` em ${shortDate.format(updated)}` : ""}`
      : stage === "rejected"
        ? `recusado${updated ? ` em ${shortDate.format(updated)}` : ""}${text(request.decision_reason) ? `: ${text(request.decision_reason)}` : ""}`
        : stage === "placed"
          ? `pedido${by ? ` por ${by}` : ""}${created ? ` em ${shortDate.format(created)}` : ""} · aguardando a Dutelog confirmar`
          : latest
            ? `${latest.label.charAt(0).toLowerCase()}${latest.label.slice(1)} · ${latest.at}`
            : "";
  const due = parseDate(request.due_at);
  return {
    id: text(request.id),
    number: orderNumber(request, tracking),
    title: orderTitle(request),
    stage,
    stepDates: [
      created ? dateTime.format(created) : "",
      stepDate(tracking, ["separating", "separated", "checking", "ready_to_dispatch"]),
      stepDate(tracking, ["dispatched"]),
      stepDate(tracking, ["delivered"]),
    ],
    summary: [count ? `${integer.format(count)} ${count === 1 ? "item" : "itens"}` : "", pieces ? `${integer.format(pieces)} peças` : ""]
      .filter(Boolean)
      .join(" · "),
    destination: text(request.destination) || text(tracking?.destination),
    due: due ? weekday.format(due).replace(".", "") : "",
    detail,
    delivery,
    canCancel: slug(request.status) === "open",
    items,
    timeline,
  };
}

/** Em andamento (mais recentes primeiro) e o histórico (entregues, recusados, cancelados). */
export function splitOrders(requests: AnyRecord[], trackings: AnyRecord[]) {
  const trackingByRequest = new Map<string, AnyRecord>();
  for (const tracking of trackings) {
    const requestId = text(tracking.customer_request_id) || text(tracking.id).replace(/^ord_/, "");
    if (requestId) trackingByRequest.set(requestId, tracking);
  }
  const views = sortByCreatedDesc(requests.filter(isOrderRequest)).map((request) =>
    orderView(request, trackingByRequest.get(text(request.id))),
  );
  const done = (view: OrderView) => view.stage === "delivered" || view.stage === "rejected" || view.stage === "cancelled";
  return { active: views.filter((view) => !done(view)), history: views.filter(done) };
}
