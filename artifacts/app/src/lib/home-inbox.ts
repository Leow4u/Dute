import type { OrcamentoParaAprovarNoInicio } from "./comercial/aprovar";
import type { PendenciasDoInicio } from "./comercial/autorizacoes";
import { dataBr } from "./comercial/clientes";
import { quandoEmDias, type AlertaDoInicio } from "./comercial/contratos";
import { ROTA_APROVAR, ROTA_AUTORIZACOES, abreComercial, aprovaOrcamento, hrefDoContrato } from "./comercial/navegacao";
import { COMERCIAL_LIBERADO } from "./liberacao";
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

/**
 * Alertas de contrato do Comercial (parte 14) só para quem abre o Comercial:
 * owner, admin e comercial, onde a liberação está ligada. É também o
 * `enabled` da consulta no Início: para os outros, nada é lido.
 */
export function veContratosNoInicio(
  role: ProfileRole | null | undefined,
  comercialLiberado: boolean = COMERCIAL_LIBERADO,
): boolean {
  return abreComercial(role, comercialLiberado);
}

/**
 * Orçamentos para aprovar (parte 12a) só para o owner, que é quem aprova,
 * onde a liberação do Comercial está ligada. É também o `enabled` da
 * consulta no Início: para os outros, nada é lido.
 */
export function veAprovacoesNoInicio(
  role: ProfileRole | null | undefined,
  comercialLiberado: boolean = COMERCIAL_LIBERADO,
): boolean {
  return aprovaOrcamento(role, comercialLiberado);
}

/** Um item por alerta (renovação, fim da vigência, reajuste), levando à ficha do contrato. */
function contractItems(alertas: readonly AlertaDoInicio[]): HomeInboxItem[] {
  return alertas.flatMap((alerta) => {
    const href = hrefDoContrato(alerta.contratoId);
    if (!href) return [];
    return [
      {
        id: `contrato:${alerta.contratoId}:${alerta.tipo}`,
        tone: alerta.tom === "critico" ? "critical" : "attention",
        title: `${alerta.titulo} · ${alerta.cliente}`,
        detail: `${alerta.contrato} · ${alerta.quando}`,
        href,
        actionLabel: "Abrir contrato",
      } satisfies HomeInboxItem,
    ];
  });
}

/**
 * Autorizações de faturamento do Comercial (parte 15b) só para quem abre o
 * Comercial: owner, admin e comercial, onde a liberação está ligada. O
 * financeiro registra pela callable, mas a tela e o Início dele são da Fase
 * 7. É também o `enabled` da consulta: para os outros, nada é lido.
 */
export function veAutorizacoesNoInicio(
  role: ProfileRole | null | undefined,
  comercialLiberado: boolean = COMERCIAL_LIBERADO,
): boolean {
  return abreComercial(role, comercialLiberado);
}

/**
 * O prazo de perda de cada demanda (o mais próximo primeiro) e um item com
 * os executados esperando a autorização há mais de 30 dias, levando à tela de
 * Autorizações.
 */
function authorizationItems(pendencias: PendenciasDoInicio): HomeInboxItem[] {
  const items: HomeInboxItem[] = pendencias.prazos.map((prazo) => ({
    id: `autorizacoes:prazo:${prazo.numero}`,
    tone: prazo.critico ? "critical" : "attention",
    title: prazo.vencido
      ? `Prazo de faturamento vencido em ${dataBr(prazo.limite)} · ${prazo.cliente}`
      : `Faturar até ${dataBr(prazo.limite)} · ${prazo.cliente}`,
    detail: `${prazo.rotulo} · ${quandoEmDias(prazo.restantes)}`,
    href: ROTA_AUTORIZACOES,
    actionLabel: "Abrir autorizações",
  }));
  const esperando = pendencias.esperandoMaisDe30;
  if (esperando.length) {
    items.push({
      id: "autorizacoes:mais-de-30",
      tone: "attention",
      title: `${plural(esperando.length, "executado", "executados")} esperando autorização há mais de 30 dias`,
      detail: listPreview(esperando.map((item) => item.rotulo), 3),
      href: ROTA_AUTORIZACOES,
      actionLabel: "Abrir autorizações",
    });
  }
  return items;
}

export function buildHomeInbox({
  role,
  ops,
  requests,
  contratos,
  paraAprovar,
  autorizacoes,
  comercialLiberado = COMERCIAL_LIBERADO,
}: {
  role: ProfileRole | null | undefined;
  ops?: WarehouseOpsResponse;
  requests?: HomeRequest[];
  /** Alertas dos contratos (lib/comercial/contratos.ts, alertasParaOInicio). */
  contratos?: readonly AlertaDoInicio[];
  /** Orçamentos em "Para aprovar" (lib/comercial/inicio.ts, lerOrcamentosParaAprovar). */
  paraAprovar?: readonly OrcamentoParaAprovarNoInicio[];
  /** Pendências das autorizações (lib/comercial/autorizacoes.ts, autorizacoesParaOInicio). */
  autorizacoes?: PendenciasDoInicio;
  comercialLiberado?: boolean;
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
  // Entrega no mesmo dia: "pronto para envio" e "em rota" são um passo só.
  const toShip = orders.filter(
    (order) =>
      (order.stage === "enviar" || order.stage === "entregar") &&
      !blockedKeys.has(order.key),
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
      href: "/pedidos",
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

  if (paraAprovar?.length && veAprovacoesNoInicio(role, comercialLiberado)) {
    items.push({
      id: "comercial:aprovar",
      tone: "attention",
      title: `${plural(paraAprovar.length, "orçamento", "orçamentos")} para aprovar`,
      detail: listPreview(paraAprovar.map((orcamento) => [orcamento.numero, orcamento.cliente].filter(Boolean).join(" · "))),
      href: ROTA_APROVAR,
      actionLabel: "Aprovar",
    });
  }

  if (contratos?.length && veContratosNoInicio(role, comercialLiberado)) {
    items.push(...contractItems(contratos));
  }

  if (autorizacoes && veAutorizacoesNoInicio(role, comercialLiberado)) {
    items.push(...authorizationItems(autorizacoes));
  }

  if (toPick.length) {
    items.push({
      id: "to-pick",
      tone: "attention",
      title: `${plural(toPick.length, "pedido", "pedidos")} para separar`,
      detail: listPreview(toPick.map((order) => order.orderNumber), 3),
      href: "/pedidos",
      actionLabel: "Separar",
    });
  }

  if (toShip.length) {
    items.push({
      id: "to-ship",
      tone: "info",
      title: `${plural(toShip.length, "pedido", "pedidos")} para entregar`,
      detail: listPreview(toShip.map((order) => order.orderNumber), 3),
      href: "/pedidos",
      actionLabel: "Entregar",
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
      // A caixa do agente guarda avisos de eventos (ex.: solicitação criada),
      // não só recomendações — o texto diz o que é.
      title: `${plural(agentCount, "aviso", "avisos")} para revisar`,
      detail:
        agentCount > 1 && agentAlerts[0]?.title
          ? `${agentAlerts[0].title} e mais ${agentCount - 1}`
          : (agentAlerts[0]?.title ?? "Caixa do Agent Dute"),
      href: "/agente/painel",
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
