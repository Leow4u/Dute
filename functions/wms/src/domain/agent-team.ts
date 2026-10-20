import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";

import { isoOf, normalize, requestKind, type AgentScope } from "./agent-dute.js";

/**
 * Consultas do Agent Dute só para a equipe Dutelog: fila de solicitações,
 * recebimentos, tarefas do armazém, endereços e eventos. Leem as coleções
 * operacionais (não as projeções do portal) e nunca escrevem. Quem pode usar
 * cada uma decide agentToolsForRole (agent-dute.ts), no servidor.
 */

type Row = Record<string, unknown> & { id: string };

const DAY = 86_400_000;

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rows(snapshot: QuerySnapshot): Row[] {
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Record<string, unknown>), id: doc.id }));
}

function daysSince(value: unknown, now: Date) {
  const iso = isoOf(value);
  return iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : undefined;
}

function matches(query: string | undefined, ...values: unknown[]) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = values.map(normalize).join(" ");
  return words.every((word) => haystack.includes(word));
}

// ------------------------------------------------------- fila de solicitações

/** Solicitações do cliente esperando a Dutelog aprovar, das mais antigas para as mais novas. */
export async function pendingRequests(db: Firestore, scope: AgentScope, now = new Date()) {
  const all = rows(
    await db
      .collection("customer_requests")
      .where("customer_code", "==", scope.customerCode)
      .orderBy("created_at", "desc")
      .limit(150)
      .get(),
  );
  const open = all
    .filter((request) => ["open", "pending", "submitted"].includes(normalize(request.status)))
    .map((request) => {
      const by = (request.requested_by ?? {}) as Record<string, unknown>;
      return {
        numero: text(request.request_number) || undefined,
        tipo: requestKind(request),
        titulo: text(request.title) || undefined,
        pedido_por: text(by.name) || text(request.requested_by_name) || undefined,
        criado_em: isoOf(request.created_at),
        dias_esperando: daysSince(request.created_at, now),
        prioridade: text(request.priority) || undefined,
        itens: num(request.item_count) || (Array.isArray(request.items) ? request.items.length : undefined),
        pecas: num(request.quantity_total) || undefined,
        destino: text(request.destination) || undefined,
        fornecedor: text(request.supplier) || undefined,
      };
    })
    .sort((left, right) => (right.dias_esperando ?? 0) - (left.dias_esperando ?? 0));
  return {
    aguardando_aprovacao: open.length,
    solicitacoes: open.slice(0, 40),
  };
}

// -------------------------------------------------------------- recebimentos

const RECEIPT_DONE = new Set(["received", "closed", "cancelled", "canceled", "completed"]);

export async function receipts(
  db: Firestore,
  scope: AgentScope,
  input: { situacao?: "abertos" | "todos"; texto?: string } = {},
) {
  const all = rows(
    await db
      .collection("inbound_receipts")
      .where("customer_code", "==", scope.customerCode)
      .orderBy("created_at", "desc")
      .limit(80)
      .get(),
  );
  const situacao = input.situacao ?? "abertos";
  const list = all
    .filter((receipt) => situacao === "todos" || !RECEIPT_DONE.has(normalize(receipt.status)))
    .filter((receipt) => matches(input.texto, receipt.receipt_number, receipt.supplier, receipt.invoice_number, receipt.reference))
    .map((receipt) => ({
      numero: text(receipt.receipt_number) || undefined,
      situacao: normalize(receipt.status) === "checking" ? "em conferência" : RECEIPT_DONE.has(normalize(receipt.status)) ? "concluído" : "aguardando chegada",
      fornecedor: text(receipt.supplier) || undefined,
      nota_fiscal: text(receipt.invoice_number) || undefined,
      previsto_para: isoOf(receipt.expected_at),
      itens: num(receipt.item_count) || undefined,
      pecas_previstas: num(receipt.qty_expected) || undefined,
      pecas_recebidas: num(receipt.qty_received),
      criado_em: isoOf(receipt.created_at),
    }));
  return { encontrados: list.length, recebimentos: list.slice(0, 40) };
}

// ------------------------------------------------------------ tarefas do WMS

const TASK_DONE = new Set(["completed", "done", "cancelled", "canceled", "closed"]);

const TASK_STATUS: Record<string, string> = {
  planned: "a fazer",
  assigned: "atribuída",
  in_progress: "em andamento",
  picking: "separando",
  picked: "separada",
  blocked: "bloqueada",
};

export async function warehouseTasks(db: Firestore, scope: AgentScope, now = new Date()) {
  const [picks, putaways] = await Promise.all(
    ["pick_tasks", "putaway_tasks"].map(async (name) =>
      rows(
        await db
          .collection(name)
          .where("customer_code", "==", scope.customerCode)
          .orderBy("updated_at", "desc")
          .limit(150)
          .get(),
      ),
    ),
  );
  const view = (task: Row, kind: "separação" | "guarda") => ({
    tipo: kind,
    pedido: kind === "separação" ? text(task.order_number) || undefined : undefined,
    recebimento: kind === "guarda" ? text(task.receipt_number) || undefined : undefined,
    item: kind === "guarda" ? text(task.product_name) || text(task.client_item_code) || undefined : undefined,
    endereco_destino: kind === "guarda" ? text(task.destination_location_id) || undefined : undefined,
    situacao: TASK_STATUS[normalize(task.status)] ?? (text(task.status) || "a fazer"),
    prioridade: text(task.priority) || undefined,
    pecas: num(task.total_units) || num(task.quantity) || undefined,
    pecas_feitas: kind === "separação" ? num(task.picked_units) : undefined,
    aberta_ha_dias: daysSince(task.created_at, now),
  });
  const open = [
    ...picks.filter((task) => !TASK_DONE.has(normalize(task.status))).map((task) => view(task, "separação")),
    ...putaways.filter((task) => !TASK_DONE.has(normalize(task.status))).map((task) => view(task, "guarda")),
  ].sort((left, right) => (right.aberta_ha_dias ?? 0) - (left.aberta_ha_dias ?? 0));
  return {
    separacao_abertas: open.filter((task) => task.tipo === "separação").length,
    guarda_abertas: open.filter((task) => task.tipo === "guarda").length,
    tarefas: open.slice(0, 40),
  };
}

// ----------------------------------------------------------------- endereços

/** Onde está cada item: saldo por endereço (stock_balances). Sem custo. */
export async function itemLocations(db: Firestore, scope: AgentScope, query: string) {
  const all = rows(
    await db.collection("stock_balances").where("customer_code", "==", scope.customerCode).limit(5000).get(),
  );
  const found = all
    .filter((balance) => num(balance.qty_on_hand) > 0 || num(balance.qty_reserved) > 0)
    .filter((balance) => matches(query, balance.client_item_code, balance.sku_code, balance.product_name, balance.location_id))
    .map((balance) => ({
      codigo: text(balance.client_item_code) || text(balance.sku_code),
      item: text(balance.product_name) || text(balance.sku_code),
      endereco: text(balance.location_id),
      em_estoque: num(balance.qty_on_hand),
      reservado: num(balance.qty_reserved),
      disponivel: balance.qty_available !== undefined ? num(balance.qty_available) : num(balance.qty_on_hand) - num(balance.qty_reserved),
    }))
    .sort((left, right) => left.codigo.localeCompare(right.codigo) || left.endereco.localeCompare(right.endereco));
  return {
    encontrados: found.length,
    enderecos: found.slice(0, 40),
    observacao: found.length > 40 ? `Listando 40 de ${found.length}; refine pelo código.` : undefined,
  };
}

// ------------------------------------------------------------------- eventos

/** Quem fez o quê: os eventos auditáveis mais recentes, filtrados por referência. */
export async function recentEvents(
  db: Firestore,
  scope: AgentScope,
  input: { referencia?: string; limite?: number } = {},
) {
  const all = rows(
    await db
      .collection("events")
      .where("customer_code", "==", scope.customerCode)
      .orderBy("occurred_at", "desc")
      .limit(300)
      .get(),
  );
  const limit = Math.min(Math.max(input.limite ?? 15, 1), 40);
  const found = all
    .filter((event) =>
      matches(
        input.referencia,
        event.title,
        event.description,
        event.entity_id,
        JSON.stringify(event.payload ?? {}),
      ),
    )
    .map((event) => {
      const actor = (event.actor ?? {}) as Record<string, unknown>;
      return {
        quando: isoOf(event.occurred_at) ?? isoOf(event.created_at),
        o_que: text(event.title) || text(event.type),
        detalhe: text(event.description) || undefined,
        quem: text(actor.name) || text(actor.email) || undefined,
        papel: text(actor.role) || undefined,
      };
    });
  return { encontrados: found.length, eventos: found.slice(0, limit) };
}
