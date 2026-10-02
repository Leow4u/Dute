import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { normalize, type AgentScope } from "./agent-dute.js";

/**
 * Rascunho de ação do Agent Dute (ideia do Hermes Agent, com aprovação
 * humana): o agente confere os itens no estoque publicado do cliente e monta
 * um pedido ou aviso de envio. Nada é gravado aqui: o rascunho volta na
 * resposta. O pedido vira um cartão na conversa, que a pessoa confere e envia
 * (sendOrderDraft, com as validações de sempre); o aviso de envio abre a tela
 * Envios preenchida.
 */

const MAX_LINES = 40;

type Row = Record<string, unknown> & { id: string };

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDay(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function isoTime(value: string | undefined) {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
}

function short(value: string | undefined, max: number) {
  const clean = text(value);
  return clean ? clean.slice(0, max) : undefined;
}

async function inventory(db: Firestore, scope: AgentScope) {
  const snapshot = await db.collection("client_inventory").where("customer_code", "==", scope.customerCode).limit(5000).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Record<string, unknown>), id: doc.id }) as Row)
    .filter((item) => item.client_archived !== true && text(item.sku_code));
}

function available(item: Row) {
  return item.qty_available !== undefined ? num(item.qty_available) : num(item.qty_on_hand) - num(item.qty_reserved);
}

function codeOf(item: Row) {
  return text(item.client_item_code) || text(item.sku_code);
}

function detailOf(item: Row) {
  return [text(item.size), text(item.color)].filter(Boolean).join(" · ") || undefined;
}

type Resolution =
  | { kind: "found"; item: Row }
  | { kind: "ambiguous"; options: Row[] }
  | { kind: "missing" };

/** Código exato primeiro; senão, as palavras no nome, código, tamanho e cor. */
function resolve(items: Row[], reference: string): Resolution {
  const wanted = normalize(reference);
  if (!wanted) return { kind: "missing" };
  const exact = items.filter((item) => normalize(item.client_item_code) === wanted || normalize(item.sku_code) === wanted);
  if (exact.length) return { kind: "found", item: exact[0]! };
  const words = wanted.split(/\s+/).filter(Boolean);
  const matches = items.filter((item) => {
    const haystack = normalize([item.product_name, item.client_item_code, item.sku_code, item.size, item.color, item.category].map(text).join(" "));
    return words.every((word) => haystack.includes(word));
  });
  const withStock = matches.filter((item) => available(item) > 0);
  const pool = withStock.length ? withStock : matches;
  if (pool.length === 1) return { kind: "found", item: pool[0]! };
  if (pool.length > 1) return { kind: "ambiguous", options: pool.slice(0, 6) };
  return { kind: "missing" };
}

export type OrderDraftInput = {
  itens: Array<{ item: string; quantidade: number }>;
  destino?: string;
  prazo?: string;
  hora?: string;
  nome?: string;
  observacoes?: string;
};

export async function buildOrderDraft(db: Firestore, scope: AgentScope, input: OrderDraftInput) {
  const items = await inventory(db, scope);
  const linhas: Array<{ sku_code: string; codigo: string; nome: string; detalhe?: string; quantidade: number; disponivel: number }> = [];
  const pendencias: Array<{ item: string; motivo: string; opcoes?: Array<{ codigo: string; nome: string; detalhe?: string; disponivel: number }> }> = [];

  for (const requested of input.itens.slice(0, MAX_LINES)) {
    const quantity = Math.floor(num(requested.quantidade));
    const reference = text(requested.item);
    if (quantity <= 0) {
      pendencias.push({ item: reference, motivo: "quantidade não informada" });
      continue;
    }
    const found = resolve(items, reference);
    if (found.kind === "missing") {
      pendencias.push({ item: reference, motivo: "não encontrei no estoque" });
      continue;
    }
    if (found.kind === "ambiguous") {
      pendencias.push({
        item: reference,
        motivo: "mais de um item combina; diga qual",
        opcoes: found.options.map((item) => ({ codigo: codeOf(item), nome: text(item.product_name) || codeOf(item), detalhe: detailOf(item), disponivel: Math.max(0, available(item)) })),
      });
      continue;
    }
    const free = Math.max(0, available(found.item));
    if (free <= 0) {
      pendencias.push({ item: reference, motivo: "sem saldo disponível" });
      continue;
    }
    if (quantity > free) {
      pendencias.push({ item: reference, motivo: `só ${free} disponíveis; o rascunho leva ${free}` });
    }
    linhas.push({
      sku_code: text(found.item.sku_code),
      codigo: codeOf(found.item),
      nome: text(found.item.product_name) || codeOf(found.item),
      detalhe: detailOf(found.item),
      quantidade: Math.min(quantity, free),
      disponivel: free,
    });
  }

  const destino = short(input.destino, 200);
  return {
    tipo: "pedido" as const,
    nome: short(input.nome, 120),
    destino,
    prazo: isoDay(input.prazo),
    hora: isoDay(input.prazo) ? isoTime(input.hora) : undefined,
    observacoes: short(input.observacoes, 1000),
    linhas,
    pendencias,
    falta_destino: !destino,
    instrucao:
      "Mostre um resumo curto. Abaixo da resposta aparece um cartão com o pedido: a pessoa confere, ajusta quantidades, destino e data e envia pelo botão 'Enviar pedido' do cartão; você não envia nada e nunca diga que enviou. Se houver pendências, pergunte; se faltar destino ou data, pergunte ou diga que dá para preencher no cartão.",
  };
}

export type ShipmentDraftInput = {
  fornecedor?: string;
  nota_fiscal?: string;
  chegada?: string;
  observacoes?: string;
  itens: Array<{ codigo?: string; nome?: string; quantidade: number }>;
};

export async function buildShipmentDraft(db: Firestore, scope: AgentScope, input: ShipmentDraftInput) {
  const items = await inventory(db, scope);
  const byCode = new Map<string, Row>();
  for (const item of items) {
    for (const code of [item.client_item_code, item.sku_code]) {
      const key = normalize(code);
      if (key && !byCode.has(key)) byCode.set(key, item);
    }
  }
  const linhas = input.itens.slice(0, MAX_LINES).flatMap((requested) => {
    const quantity = Math.floor(num(requested.quantidade));
    if (quantity <= 0) return [];
    const code = text(requested.codigo);
    const known = code ? byCode.get(normalize(code)) : undefined;
    const name = text(requested.nome) || (known ? text(known.product_name) : "");
    if (!code && !name) return [];
    return [
      {
        sku_code: known ? text(known.sku_code) || undefined : undefined,
        codigo: known ? codeOf(known) : code || undefined,
        nome: name.slice(0, 200) || undefined,
        quantidade: quantity,
        // Produto já no estoque, novo (código desconhecido) ou com código a definir.
        situacao: known ? ("no_estoque" as const) : code ? ("novo" as const) : ("codigo_a_definir" as const),
      },
    ];
  });
  return {
    tipo: "envio" as const,
    fornecedor: short(input.fornecedor, 160),
    nota_fiscal: short(input.nota_fiscal, 60),
    chegada: isoDay(input.chegada),
    observacoes: short(input.observacoes, 1000),
    linhas,
    instrucao:
      "Mostre um resumo curto. Abaixo da resposta aparece um cartão com o aviso (e a nota, se foi anexada no chat): a pessoa confere, ajusta e envia pelo botão 'Enviar aviso' do cartão; você não envia nada e nunca diga que enviou. Se faltar fornecedor ou data de chegada, pergunte ou diga que dá para preencher no cartão.",
  };
}

export type AgentDraft = Awaited<ReturnType<typeof buildOrderDraft>> | Awaited<ReturnType<typeof buildShipmentDraft>>;

/** O último rascunho montado na resposta (ferramentas rascunho_*), sem a instrução ao modelo. */
export function draftFromToolResponses(messages: Array<{ content?: Array<Record<string, unknown>> }>) {
  let draft: Record<string, unknown> | undefined;
  for (const message of messages) {
    for (const part of message.content ?? []) {
      const response = part.toolResponse as { name?: unknown; output?: unknown } | undefined;
      if (!response || !["rascunho_pedido", "rascunho_envio", "sugerir_rotina"].includes(String(response.name))) continue;
      if (response.output && typeof response.output === "object") {
        const { instrucao: _instrucao, ...rest } = response.output as Record<string, unknown>;
        // Firestore recusa undefined aninhado: o JSON tira esses campos.
        draft = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
      }
    }
  }
  return draft;
}

export type DraftSent = { request_id: string; request_number: string; sent_at: string };

/**
 * Envio do pedido ou do aviso de envio que o Agent Dute montou, pelo botão do
 * cartão na conversa. Quem envia é a pessoa (com o login dela, pela mesma
 * criação do Estoque e do Envios); aqui só se confere que o rascunho é dela,
 * do tipo certo e ainda não foi enviado, e a chave de idempotência vem da
 * mensagem: a mesma mensagem nunca vira dois pedidos. Depois de criado, a
 * mensagem guarda o número para o cartão mostrar "Enviado" em qualquer aparelho.
 */
export async function sendAgentDraft<T extends Record<string, unknown>>(
  db: Firestore,
  input: { messageId: string; uid: string; customerCode: string; tipo: "pedido" | "envio" | "rotina" },
  create: (idempotencyKey: string) => Promise<T>,
) {
  const ref = db.collection("agent_messages").doc(input.messageId);
  const message = (await ref.get()).data();
  if (!message || message.user_id !== input.uid || message.customer_code !== input.customerCode || message.role !== "assistant") {
    throw new HttpsError("permission-denied", "Este rascunho não é desta conversa.");
  }
  const label = { pedido: ["um pedido", "Este pedido já foi enviado"], envio: ["um aviso", "Este aviso já foi enviado"], rotina: ["uma rotina", "Esta rotina já foi criada"] }[input.tipo];
  if ((message.draft as { tipo?: unknown } | undefined)?.tipo !== input.tipo) {
    throw new HttpsError("failed-precondition", `Esta mensagem não tem ${label[0]} para enviar.`);
  }
  const sent = message.draft_sent as DraftSent | undefined;
  if (sent?.request_id) {
    throw new HttpsError("failed-precondition", `${label[1]} (${sent.request_number || sent.request_id}).`);
  }
  const result = await create(`agent_draft_${input.messageId}`);
  const draftSent: DraftSent = {
    request_id: text(result.id),
    request_number: text(result.request_number),
    sent_at: new Date().toISOString(),
  };
  await ref.update({ draft_sent: draftSent });
  return result;
}
