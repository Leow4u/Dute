import {
  canAccessModule,
  getRouteProfileRoles,
  type ProfileRole,
} from "./modules";
import type { WarehouseOpsResponse } from "./warehouse-ops/model";
import { groupWarehouseOrders, queueTasks } from "./warehouse-ops/orders";

/**
 * O Início responde "o que precisa de mim agora?". Cada item diz o que está
 * parado e leva direto à tela que resolve; nenhuma ação acontece aqui.
 */

export type HomeInboxTone = "critical" | "attention" | "info" | "agent";

export type HomeInboxItem = {
  id: string;
  tone: HomeInboxTone;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
};

export type HomeRequest = {
  id: string;
  status?: string | null;
  title?: string | null;
  type?: string | null;
  customer_code?: string | null;
};

export type HomeSummary = {
  toPick: number;
  toShip: number;
  inTransit: number;
  openReceipts: number;
};

export type HomeInbox = {
  items: HomeInboxItem[];
  summary: HomeSummary;
};

const TERMINAL_RECEIPT_STATUSES = new Set(["received", "completed", "closed"]);
const MAX_BLOCKED_ORDERS = 3;

function normalizeSlug(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Mesma leitura de status da tela de triagem: sem status = aberta.
export function isAwaitingTriage(status: unknown) {
  const normalized = normalizeSlug(status || "open");
  return ![
    "approved",
    "aprovada",
    "aprovado",
    "rejected",
    "rejeitada",
    "rejeitado",
    "closed",
    "encerrada",
    "encerrado",
    "concluida",
    "concluido",
  ].includes(normalized);
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function listPreview(values: Array<string | null | undefined>, max = 2) {
  const clean = values.filter((value): value is string => Boolean(value));
  if (!clean.length) return "";
  const shown = clean.slice(0, max).join(" · ");
  return clean.length > max ? `${shown} e mais ${clean.length - max}` : shown;
}

export function buildHomeInbox({
  role,
  ops,
  requests,
}: {
  role: ProfileRole | null | undefined;
  ops?: WarehouseOpsResponse;
  requests?: HomeRequest[];
}): HomeInbox {
  const orders = groupWarehouseOrders(ops).filter(
    (order) => order.stage !== "entregue",
  );
  const blocked = orders.filter(
    (order) => order.blockedReason || order.exceptionCount > 0,
  );
  const blockedKeys = new Set(blocked.map((order) => order.key));
  const toPick = orders.filter(
    (order) => order.stage === "separar" && !blockedKeys.has(order.key),
  );
  const toShip = orders.filter(
    (order) => order.stage === "enviar" && !blockedKeys.has(order.key),
  );
  const openReceipts = queueTasks(ops, "receiving").filter(
    (task) =>
      task.can_advance !== false &&
      !TERMINAL_RECEIPT_STATUSES.has(String(task.status ?? "")),
  );
  const triage = (requests ?? []).filter((request) =>
    isAwaitingTriage(request.status),
  );
  const agentAlerts = ops?.alerts ?? [];
  const agentCount = Number(ops?.metrics?.agent_alerts ?? agentAlerts.length);

  const items: HomeInboxItem[] = [];

  for (const order of blocked.slice(0, MAX_BLOCKED_ORDERS)) {
    items.push({
      id: `blocked:${order.key}`,
      tone: "critical",
      title: `Pedido ${order.orderNumber} com exceção`,
      detail:
        order.blockedReason ??
        plural(order.exceptionCount, "exceção aberta", "exceções abertas"),
      href: "/wms/pedidos",
      actionLabel: "Resolver",
    });
  }

  if (triage.length) {
    items.push({
      id: "triage",
      tone: "attention",
      title: `${plural(triage.length, "solicitação", "solicitações")} para aprovar`,
      detail:
        listPreview(triage.map((request) => request.title ?? request.type)) ||
        "Enviadas pelos clientes",
      href: "/solicitacoes",
      actionLabel: "Aprovar",
    });
  }

  if (toPick.length) {
    items.push({
      id: "to-pick",
      tone: "attention",
      title: `${plural(toPick.length, "pedido", "pedidos")} para separar`,
      detail: listPreview(toPick.map((order) => order.orderNumber), 3),
      href: "/wms/pedidos",
      actionLabel: "Separar",
    });
  }

  if (toShip.length) {
    items.push({
      id: "to-ship",
      tone: "info",
      title: `${plural(toShip.length, "pedido pronto", "pedidos prontos")} para envio`,
      detail: listPreview(toShip.map((order) => order.orderNumber), 3),
      href: "/wms/pedidos",
      actionLabel: "Enviar",
    });
  }

  if (openReceipts.length) {
    items.push({
      id: "receipts",
      tone: "info",
      title: `${plural(openReceipts.length, "recebimento", "recebimentos")} para conferir`,
      detail: listPreview(openReceipts.map((task) => task.title), 3),
      href: "/wms/receber",
      actionLabel: "Conferir",
    });
  }

  if (agentCount > 0) {
    items.push({
      id: "agent",
      tone: "agent",
      title:
        agentCount === 1
          ? "Agent Dute tem 1 sugestão"
          : `Agent Dute tem ${agentCount} sugestões`,
      detail: `${agentAlerts[0]?.title ?? "Recomendações"} · você decide`,
      href: "/agente",
      actionLabel: "Revisar",
    });
  }

  return {
    // Só aparece o que o papel consegue abrir: o botão nunca leva a uma
    // tela que devolveria a pessoa para o início.
    items: items.filter((item) =>
      canAccessModule(role, getRouteProfileRoles(item.href)),
    ),
    summary: {
      toPick: orders.filter((order) => order.stage === "separar").length,
      toShip: orders.filter((order) => order.stage === "enviar").length,
      inTransit: orders.filter((order) => order.stage === "entregar").length,
      openReceipts: openReceipts.length,
    },
  };
}
