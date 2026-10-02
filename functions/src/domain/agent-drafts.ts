import type { Firestore } from "firebase-admin/firestore";

import { normalize, type AgentScope } from "./agent-dute.js";

/**
 * Rascunho de ação do Agent Dute (ideia do Hermes Agent, com aprovação
 * humana): o agente confere os itens no estoque publicado do cliente e monta
 * um pedido ou aviso de envio. Nada é gravado aqui: o rascunho volta na
 * resposta, a tela abre o formulário preenchido e quem envia é a pessoa,
 * pelo mesmo botão e com as mesmas validações de sempre.
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
    observacoes: short(input.observacoes, 1000),
    linhas,
    pendencias,
    falta_destino: !destino,
    instrucao:
      "Mostre o resumo. A pessoa confere e envia pelo botão 'Abrir para conferir e enviar' que aparece abaixo da resposta; você não envia nada. Se houver pendências ou faltar destino, pergunte antes.",
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
      "Mostre o resumo. A pessoa confere, anexa a nota se quiser e envia pelo botão 'Abrir para conferir e enviar' que aparece abaixo da resposta; você não envia nada.",
  };
}

export type AgentDraft = Awaited<ReturnType<typeof buildOrderDraft>> | Awaited<ReturnType<typeof buildShipmentDraft>>;

/** O último rascunho montado na resposta (ferramentas rascunho_*), sem a instrução ao modelo. */
export function draftFromToolResponses(messages: Array<{ content?: Array<Record<string, unknown>> }>) {
  let draft: Record<string, unknown> | undefined;
  for (const message of messages) {
    for (const part of message.content ?? []) {
      const response = part.toolResponse as { name?: unknown; output?: unknown } | undefined;
      if (!response || (response.name !== "rascunho_pedido" && response.name !== "rascunho_envio")) continue;
      if (response.output && typeof response.output === "object") {
        const { instrucao: _instrucao, ...rest } = response.output as Record<string, unknown>;
        // Firestore recusa undefined aninhado: o JSON tira esses campos.
        draft = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
      }
    }
  }
  return draft;
}
