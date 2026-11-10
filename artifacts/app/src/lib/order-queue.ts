import { quandoEmTexto } from "./warehouse-ops/entrega";
import type { WarehouseOpsResponse } from "./warehouse-ops/model";
import { groupWarehouseOrders, type OrderGroup } from "./warehouse-ops/orders";

/**
 * A operação tem três passos: a coordenação aprova, o armazém separa, e o
 * pedido é entregue no mesmo dia. As etapas internas do WMS (picking,
 * packing, expedição, em rota) continuam no backend; aqui viram grupos.
 */
export type QueueRequest = {
  id: string;
  status?: string | null;
  created_at?: unknown;
  priority?: string | null;
};

export type OrderQueue<R extends QueueRequest> = {
  approve: R[];
  pick: OrderGroup[];
  deliver: OrderGroup[];
  delivered: OrderGroup[];
};

const AWAITING_DECISION = new Set([
  "open",
  "aberta",
  "aberto",
  "submitted",
  "enviada",
  "enviado",
  "pending",
  "pendente",
  "em-analise",
  "em analise",
]);

export function isAwaitingDecision(status: unknown) {
  const normalized = String(status || "open")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return AWAITING_DECISION.has(normalized);
}

function priorityWeight(priority?: string | null) {
  const normalized = String(priority ?? "").toLowerCase();
  if (["critica", "crítica", "critical", "urgente"].includes(normalized)) return 0;
  if (["alta", "high"].includes(normalized)) return 1;
  return 2;
}

function requestTime(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object") {
    const seconds = Number(
      (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
        (value as { _seconds?: unknown })._seconds,
    );
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildOrderQueue<R extends QueueRequest>({
  requests,
  ops,
}: {
  requests?: R[];
  ops?: WarehouseOpsResponse;
}): OrderQueue<R> {
  const orders = groupWarehouseOrders(ops);
  // Exceções primeiro: são as que travam o armazém.
  const blockedFirst = (left: OrderGroup, right: OrderGroup) =>
    Number(Boolean(right.blockedReason || right.exceptionCount)) -
    Number(Boolean(left.blockedReason || left.exceptionCount));

  return {
    approve: (requests ?? [])
      .filter((request) => isAwaitingDecision(request.status))
      .sort(
        (left, right) =>
          priorityWeight(left.priority) - priorityWeight(right.priority) ||
          requestTime(left.created_at) - requestTime(right.created_at),
      ),
    pick: orders.filter((order) => order.stage === "separar").sort(blockedFirst),
    // "Pronto para envio" e "em rota" são a mesma coisa para quem entrega no
    // mesmo dia: falta confirmar a entrega.
    deliver: orders
      .filter((order) => order.stage === "enviar" || order.stage === "entregar")
      .sort(blockedFirst),
    delivered: orders.filter((order) => order.stage === "entregue"),
  };
}

const PARTES_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * O "Para quando" que o cliente pediu no portal (`due_at` da solicitação), no
 * horário de São Paulo e no formato da linha da entrega: "Qui 05/11 09:00".
 * Sem data válida, "".
 */
export function textoDoParaQuando(dueAt: unknown): string {
  const partes = partesDoParaQuando(dueAt);
  return partes ? quandoEmTexto(partes.data, partes.hora) : "";
}

/** O mesmo "Para quando" com o ano, para o papel que fica guardado: "Seg 16/11/2026 11:36". */
export function textoDoParaQuandoComAno(dueAt: unknown): string {
  const partes = partesDoParaQuando(dueAt);
  if (!partes) return "";
  const [ano, mes, dia] = partes.data.split("-");
  return quandoEmTexto(partes.data, partes.hora).replace(`${dia}/${mes}`, `${dia}/${mes}/${ano}`);
}

/** A data ("2026-11-16") e a hora ("11:36") do prazo em São Paulo; sem data válida, null. */
function partesDoParaQuando(dueAt: unknown): { data: string; hora: string } | null {
  const instante = dueAt instanceof Date ? dueAt.getTime() : requestTime(dueAt);
  if (!instante) return null;
  const partes = Object.fromEntries(
    PARTES_EM_SAO_PAULO.formatToParts(new Date(instante)).map((parte) => [parte.type, parte.value]),
  );
  return { data: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

/** A linha do "Para quando" na fila de Pedidos; sem prazo, nada. */
export function linhaDoParaQuando(dueAt: unknown): string | undefined {
  const texto = textoDoParaQuando(dueAt);
  return texto ? `Para quando ${texto}` : undefined;
}

/**
 * O "Para quando" do pedido em separação ou entrega: o da solicitação que o
 * originou (`customer_request_id` da tarefa), que a tela já lê.
 */
export function paraQuandoDoPedido(
  order: Pick<OrderGroup, "requestId">,
  requests?: ReadonlyArray<{ id: string; due_at?: unknown }>,
): string | undefined {
  if (!order.requestId) return undefined;
  const request = requests?.find((item) => item.id === order.requestId);
  return request ? linhaDoParaQuando(request.due_at) : undefined;
}

/** O grupo vazio diz o dado, sem ensinar o fluxo (sem legenda, parte 4.7c). */
export function ordersGroupEmpty(group: "approve" | "pick" | "deliver") {
  if (group === "approve") return "Nenhum pedido para aprovar.";
  if (group === "pick") return "Nenhum pedido para separar.";
  return "Nenhum pedido para entregar.";
}

/**
 * A linha da ação principal da tela (v3, parte 4.7c): a primeira da fila, na
 * ordem aprovar (para quem decide), separar e entregar. As outras ações da
 * fila são secundárias. "approve:<id>", "pick:<pedido>" ou "deliver:<pedido>".
 */
export function chaveDaPrincipal<R extends QueueRequest>(queue: Pick<OrderQueue<R>, "approve" | "pick" | "deliver">, decider: boolean): string | null {
  if (decider && queue.approve[0]) return `approve:${queue.approve[0].id}`;
  if (queue.pick[0]) return `pick:${queue.pick[0].key}`;
  if (queue.deliver[0]) return `deliver:${queue.deliver[0].key}`;
  return null;
}
