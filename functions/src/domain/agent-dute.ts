import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";

import { isPublishedToCustomer, loadKnowledgeContext, type KnowledgeAudience } from "./agent-knowledge.js";

/**
 * Leituras que o Agent Dute pode fazer durante uma conversa.
 *
 * Cada função recebe o escopo (customer_code e público) do servidor — o
 * modelo só escolhe o que perguntar, nunca de qual cliente. As leituras usam
 * as mesmas projeções que o portal mostra (client_inventory,
 * client_request_status, client_invoices, client_documents), para o agente
 * não contradizer a tela. Nenhuma função escreve: a IA recomenda, não executa.
 */

export type AgentScope = {
  customerCode: string;
  audience: KnowledgeAudience;
};

/** Consultas que o Agent Dute oferece ao modelo (nomes das ferramentas). */
export const AGENT_TOOL_NAMES = [
  // As mesmas projeções do portal: cliente e equipe.
  "resumo_estoque",
  "buscar_itens",
  "listar_pedidos",
  "ver_pedido",
  "movimentacoes",
  "faturas",
  "documentos",
  // Só equipe Dutelog (agent-team.ts e a prévia do faturamento).
  "fila_solicitacoes",
  "recebimentos",
  "tarefas_armazem",
  "enderecos",
  "eventos",
  "previa_faturamento",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const PORTAL_TOOLS: AgentToolName[] = [
  "resumo_estoque",
  "buscar_itens",
  "listar_pedidos",
  "ver_pedido",
  "movimentacoes",
  "faturas",
  "documentos",
];
const FLOOR_TOOLS: AgentToolName[] = ["recebimentos", "tarefas_armazem", "enderecos"];
const COORDINATION_TOOLS: AgentToolName[] = ["fila_solicitacoes", ...FLOOR_TOOLS, "eventos"];

/**
 * Consultas liberadas para o papel, pelo mesmo critério das telas:
 * - cliente: só o que o portal mostra;
 * - WMS: o chão do armazém, sem faturas nem valores;
 * - financeiro: o portal e a prévia do mês (mesmo acesso de getBillingPreview);
 * - coordenação (interno, suporte, admin, owner): a operação inteira; a prévia
 *   do mês só para quem lê faturamento.
 */
export function agentToolsForRole(role: string): AgentToolName[] {
  const allowed = new Set<AgentToolName>();
  const add = (names: AgentToolName[]) => names.forEach((name) => allowed.add(name));
  if (role === "cliente") add(PORTAL_TOOLS);
  else if (role === "wms") add([...PORTAL_TOOLS.filter((name) => name !== "faturas"), ...FLOOR_TOOLS]);
  else if (role === "financeiro") add([...PORTAL_TOOLS, "previa_faturamento"]);
  else if (["owner", "admin", "interno", "suporte"].includes(role)) {
    add([...PORTAL_TOOLS, ...COORDINATION_TOOLS]);
    if (role !== "interno") add(["previa_faturamento"]);
  }
  return AGENT_TOOL_NAMES.filter((name) => allowed.has(name));
}

type Row = Record<string, unknown> & { id: string };

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function normalize(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Firestore devolve Timestamp, {seconds} ou texto ISO. */
export function isoOf(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "object") {
    const record = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof record.toDate === "function") return record.toDate().toISOString();
    const seconds = Number(record.seconds ?? record._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return undefined;
}

function rows(snapshot: QuerySnapshot): Row[] {
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Record<string, unknown>), id: doc.id }));
}

// ---------------------------------------------------------------- estoque

function itemView(item: Row) {
  const onHand = num(item.qty_on_hand);
  const reserved = num(item.qty_reserved);
  const available = item.qty_available !== undefined ? num(item.qty_available) : onHand - reserved;
  const minimum = item.estoque_minimo !== undefined && item.estoque_minimo !== null ? num(item.estoque_minimo) : null;
  return {
    codigo: text(item.client_item_code) || text(item.sku_code),
    nome: text(item.product_name) || text(item.sku_code),
    categoria: text(item.category) || undefined,
    tamanho: text(item.size) || undefined,
    cor: text(item.color) || undefined,
    em_estoque: onHand,
    reservado: reserved,
    disponivel: available,
    minimo: minimum,
    abaixo_do_minimo: minimum !== null && minimum > 0 && available < minimum,
    arquivado: item.client_archived === true,
  };
}

async function inventoryRows(db: Firestore, scope: AgentScope) {
  return rows(
    await db.collection("client_inventory").where("customer_code", "==", scope.customerCode).get(),
  );
}

export async function stockSummary(db: Firestore, scope: AgentScope) {
  const items = (await inventoryRows(db, scope)).map(itemView).filter((item) => !item.arquivado);
  const below = items.filter((item) => item.abaixo_do_minimo);
  return {
    itens: items.length,
    itens_com_saldo: items.filter((item) => item.em_estoque > 0).length,
    itens_zerados: items.filter((item) => item.em_estoque <= 0).length,
    pecas_em_estoque: items.reduce((sum, item) => sum + item.em_estoque, 0),
    pecas_reservadas: items.reduce((sum, item) => sum + item.reservado, 0),
    pecas_disponiveis: items.reduce((sum, item) => sum + Math.max(0, item.disponivel), 0),
    abaixo_do_minimo: below.length,
    itens_abaixo_do_minimo: below.slice(0, 30),
  };
}

export async function searchItems(db: Firestore, scope: AgentScope, query: string, limit = 25) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const items = (await inventoryRows(db, scope)).map(itemView);
  const matches = items.filter((item) => {
    const haystack = normalize([item.codigo, item.nome, item.categoria, item.tamanho, item.cor].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  // Totais de todos os encontrados, não só dos listados: "quanto tenho de
  // polo?" com 127 variações precisa da soma, não de 25 linhas.
  const byProduct = new Map<string, { nome: string; itens: number; em_estoque: number; disponivel: number; abaixo_do_minimo: number }>();
  for (const item of matches) {
    const entry = byProduct.get(item.nome) ?? { nome: item.nome, itens: 0, em_estoque: 0, disponivel: 0, abaixo_do_minimo: 0 };
    entry.itens += 1;
    entry.em_estoque += item.em_estoque;
    entry.disponivel += Math.max(0, item.disponivel);
    if (item.abaixo_do_minimo) entry.abaixo_do_minimo += 1;
    byProduct.set(item.nome, entry);
  }
  return {
    encontrados: matches.length,
    total: {
      pecas_em_estoque: matches.reduce((sum, item) => sum + item.em_estoque, 0),
      pecas_reservadas: matches.reduce((sum, item) => sum + item.reservado, 0),
      pecas_disponiveis: matches.reduce((sum, item) => sum + Math.max(0, item.disponivel), 0),
    },
    por_produto: [...byProduct.values()].sort((left, right) => right.disponivel - left.disponivel).slice(0, 30),
    itens: matches.slice(0, limit),
    observacao: matches.length > limit ? `Listando ${limit} de ${matches.length} itens; os totais e o resumo por produto incluem todos.` : undefined,
  };
}

// ---------------------------------------------------------------- pedidos

export const ORDER_STEPS = ["Enviado", "Aprovado", "Separando", "Saiu", "Entregue"] as const;
const SEPARATING = new Set(["separating", "separated", "checking", "ready_to_dispatch", "picking", "packing"]);

/** Mesma leitura de etapa que o Início do portal (lib/client-home.ts). */
export function requestStage(request: Record<string, unknown>) {
  const status = normalize(request.status);
  const operational = normalize(request.operational_status);
  if (["cancelled", "canceled", "cancelado"].includes(status)) return "Cancelado";
  if (["rejected", "rejeitado", "rejeitada"].includes(status)) return "Recusado";
  if (operational === "delivered" || status === "closed" || status === "delivered") return "Entregue";
  if (operational === "received") return "Recebido";
  if (operational === "dispatched") return "Saiu";
  if (SEPARATING.has(operational)) return "Separando";
  if (status === "approved" || status === "aprovado" || operational === "picking_planned") return "Aprovado";
  return "Enviado";
}

export function requestKind(request: Record<string, unknown>) {
  const type = normalize(request.type);
  if (type.includes("receb") || type.includes("inbound")) return "aviso de entrega";
  if (type.includes("retirada") || type.includes("saida") || type.includes("outbound") || type.includes("pedido")) {
    return "pedido";
  }
  return "solicitação";
}

function requestView(request: Row) {
  const stage = requestStage(request);
  return {
    id: request.id,
    // O número que a pessoa vê no portal (PED-0043, ENV-0012). Use este ao falar do pedido.
    numero: text(request.request_number) || undefined,
    titulo: text(request.title) || requestKind(request),
    tipo: requestKind(request),
    etapa: stage,
    motivo_recusa: stage === "Recusado" ? text(request.decision_reason) || undefined : undefined,
    criado_em: isoOf(request.created_at),
    atualizado_em: isoOf(request.updated_at),
    itens: num(request.item_count) || undefined,
    pecas: num(request.quantity_total) || undefined,
    destino: text(request.destination) || undefined,
    previsto_para: isoOf(request.due_at),
    fornecedor: text(request.supplier) || undefined,
    nota_fiscal: text(request.invoice_number) || undefined,
  };
}

async function recentRequests(db: Firestore, scope: AgentScope, limit = 60) {
  return rows(
    await db
      .collection("client_request_status")
      .where("customer_code", "==", scope.customerCode)
      .orderBy("updated_at", "desc")
      .limit(limit)
      .get(),
  );
}

export type OrderFilter = "andamento" | "concluidos" | "recusados" | "todos";

export async function listOrders(
  db: Firestore,
  scope: AgentScope,
  input: { situacao?: OrderFilter; tipo?: "pedido" | "aviso" | "todos"; limite?: number } = {},
) {
  const limit = Math.min(Math.max(input.limite ?? 15, 1), 40);
  const views = (await recentRequests(db, scope)).map(requestView);
  const filtered = views.filter((view) => {
    if (input.tipo === "pedido" && view.tipo !== "pedido") return false;
    if (input.tipo === "aviso" && view.tipo !== "aviso de entrega") return false;
    const done = view.etapa === "Entregue" || view.etapa === "Recebido";
    if (input.situacao === "andamento") return !done && view.etapa !== "Recusado" && view.etapa !== "Cancelado";
    if (input.situacao === "concluidos") return done;
    if (input.situacao === "recusados") return view.etapa === "Recusado";
    return true;
  });
  return { total: filtered.length, pedidos: filtered.slice(0, limit), etapas: ORDER_STEPS };
}

export async function orderDetails(db: Firestore, scope: AgentScope, reference: string) {
  const wanted = text(reference);
  let request: Row | undefined;
  if (wanted && !wanted.includes("/")) {
    const snapshot = await db.collection("client_request_status").doc(wanted).get();
    if (snapshot.exists && snapshot.data()?.customer_code === scope.customerCode) {
      request = { ...(snapshot.data() as Record<string, unknown>), id: snapshot.id };
    }
  }
  if (!request) {
    const terms = normalize(wanted).split(/\s+/).filter(Boolean);
    request = (await recentRequests(db, scope)).find((row) => {
      const haystack = normalize(
        `${text(row.request_number)} ${text(row.title)} ${text(row.destination)} ${text(row.supplier)} ${text(row.invoice_number)}`,
      );
      return terms.length > 0 && terms.every((term) => haystack.includes(term));
    });
  }
  if (!request) return { encontrado: false };

  const source = await db.collection("customer_requests").doc(request.id).get();
  const sourceData = source.exists && source.data()?.customer_code === scope.customerCode ? source.data() ?? {} : {};
  const items = Array.isArray(sourceData.items) ? (sourceData.items as Array<Record<string, unknown>>) : [];
  return {
    encontrado: true,
    pedido: requestView(request),
    itens: items.slice(0, 60).map((item) => ({
      codigo: text(item.client_item_code) || text(item.sku_code) || text(item.sku),
      nome: text(item.product_name) || text(item.name) || text(item.description),
      quantidade: num(item.quantity ?? item.qty ?? item.quantidade),
    })),
    observacao: items.length > 60 ? `Pedido com ${items.length} itens; mostrando 60.` : undefined,
  };
}

// --------------------------------------------------------- movimentações

/** "YYYY-MM-DD" no horário de São Paulo → instante UTC do início do dia. */
function saoPauloDayStart(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T03:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function movementSummary(
  db: Firestore,
  scope: AgentScope,
  input: { de: string; ate: string; texto?: string },
) {
  const from = saoPauloDayStart(input.de);
  const toDay = saoPauloDayStart(input.ate);
  if (!from || !toDay || toDay < from) {
    return { erro: "Período inválido. Use datas no formato AAAA-MM-DD, com início antes do fim." };
  }
  const to = new Date(toDay.getTime() + 24 * 3_600_000);
  if (to.getTime() - from.getTime() > 186 * 24 * 3_600_000) {
    return { erro: "Período longo demais. Consulte até 6 meses por vez." };
  }
  const snapshot = await db
    .collection("movements")
    .where("data", ">=", from.toISOString())
    .where("data", "<", to.toISOString())
    .orderBy("data", "desc")
    .limit(5000)
    .get();
  const terms = normalize(input.texto).split(/\s+/).filter(Boolean);
  const byItem = new Map<string, { codigo: string; nome: string; entradas: number; saidas: number }>();
  let entradas = 0;
  let saidas = 0;
  for (const movement of rows(snapshot)) {
    if (movement.customer_code !== scope.customerCode) continue;
    const code = text(movement.client_item_code) || text(movement.sku_code) || text(movement.cod_sku);
    const name = text(movement.product_name) || text(movement.produto) || code;
    if (terms.length && !terms.every((term) => normalize(`${code} ${name}`).includes(term))) continue;
    const quantity = Math.abs(num(movement.quantity ?? movement.qtde));
    const incoming = text(movement.tipo_mov) === "ENTRADA" || num(movement.sign ?? movement.sinal) > 0;
    const entry = byItem.get(code) ?? { codigo: code, nome: name, entradas: 0, saidas: 0 };
    if (incoming) {
      entry.entradas += quantity;
      entradas += quantity;
    } else {
      entry.saidas += quantity;
      saidas += quantity;
    }
    byItem.set(code, entry);
  }
  const items = [...byItem.values()].sort((left, right) => right.saidas - left.saidas || right.entradas - left.entradas);
  return {
    periodo: { de: input.de, ate: input.ate },
    pecas_que_entraram: entradas,
    pecas_que_sairam: saidas,
    itens_movimentados: items.length,
    por_item: items.slice(0, 40),
    observacao: items.length > 40 ? `Mostrando os 40 itens com mais saídas de ${items.length}.` : undefined,
  };
}

// ------------------------------------------------------ faturas e documentos

export async function invoices(db: Firestore, scope: AgentScope) {
  const list = rows(
    await db
      .collection("client_invoices")
      .where("customer_code", "==", scope.customerCode)
      .orderBy("competencia", "desc")
      .limit(12)
      .get(),
  );
  return {
    faturas: list.map((invoice) => ({
      competencia: text(invoice.competencia),
      situacao: normalize(invoice.status) === "pago" || normalize(invoice.payment_status) === "paid" ? "paga" : "emitida",
      total: num(invoice.total),
      vencimento: isoOf(invoice.due_at ?? invoice.vencimento),
      emitida_em: isoOf(invoice.emitido_em),
      paga_em: isoOf(invoice.pago_em),
    })),
    observacao: "Mês sem fatura ainda está em andamento ou em fechamento pela Dutelog.",
  };
}

export async function documents(db: Firestore, scope: AgentScope, query?: string) {
  const list = rows(
    await db.collection("client_documents").where("customer_code", "==", scope.customerCode).limit(200).get(),
  ).filter((document) => scope.audience === "internal" || isPublishedToCustomer(document, scope.customerCode));
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = list.filter((document) =>
    terms.every((term) =>
      normalize(`${text(document.title)} ${text(document.file_name)} ${text(document.document_type)}`).includes(term),
    ),
  );
  const knowledge = await loadKnowledgeContext(db, scope.customerCode, scope.audience);
  const excerpts = knowledge.chunks
    .map((chunk) => ({
      documento: chunk.title,
      trecho: chunk.text ?? "",
      relevancia: terms.filter((term) => normalize(chunk.text).includes(term)).length,
    }))
    .filter((chunk) => chunk.trecho && (terms.length === 0 || chunk.relevancia > 0))
    .sort((left, right) => right.relevancia - left.relevancia)
    .slice(0, 6)
    .map(({ documento, trecho }) => ({ documento, trecho }));
  return {
    documentos: matches.slice(0, 20).map((document) => ({
      titulo: text(document.title) || text(document.file_name),
      tipo: text(document.document_type) || undefined,
      data: isoOf(document.created_at ?? document.updated_at),
    })),
    trechos: excerpts,
  };
}

// --------------------------------------------------------------- conversa

export type HistoryMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

/**
 * As últimas mensagens da conversa, da mais antiga para a mais nova. Sem o
 * orderBy o Firestore ordena pelo id (msg_agent_* < msg_user_*) e o agente
 * perdia a memória depois de ~15 trocas.
 */
export async function recentHistory(
  db: Firestore,
  input: { conversationId: string; customerCode: string; userId: string },
  limit = 20,
): Promise<HistoryMessage[]> {
  const snapshot = await db
    .collection("agent_messages")
    .where("conversation_id", "==", input.conversationId)
    .where("customer_code", "==", input.customerCode)
    .where("user_id", "==", input.userId)
    .orderBy("created_at_iso", "desc")
    .limit(limit)
    .get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(data.content ?? ""),
        created_at: String(data.created_at_iso ?? ""),
      };
    })
    // Antes do v2, pergunta e resposta tinham o mesmo horário: no empate a
    // pergunta vem primeiro, senão o histórico terminava numa pergunta já
    // respondida e o modelo respondia de novo.
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      (left.role === right.role ? 0 : left.role === "user" ? -1 : 1),
    );
}
