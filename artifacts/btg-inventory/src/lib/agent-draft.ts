/**
 * Rascunho de ação do Agent Dute: o agente monta um pedido ou aviso de envio
 * (functions/src/domain/agent-drafts.ts) e a resposta traz o rascunho. O
 * cartão na conversa guarda o rascunho nesta aba e abre a tela própria já
 * preenchida; quem envia é a pessoa, com as validações de sempre.
 */

type AnyRecord = Record<string, unknown>;

export type OrderDraftLine = { sku_code: string; codigo: string; nome: string; detalhe?: string; quantidade: number; disponivel: number };
export type DraftPending = { item: string; motivo: string; opcoes?: Array<{ codigo: string; nome: string; detalhe?: string; disponivel: number }> };

export type OrderDraft = {
  tipo: "pedido";
  nome?: string;
  destino?: string;
  prazo?: string;
  observacoes?: string;
  linhas: OrderDraftLine[];
  pendencias: DraftPending[];
};

export type ShipmentDraftLine = { codigo?: string; nome?: string; quantidade: number; situacao: "no_estoque" | "novo" | "codigo_a_definir" };

export type ShipmentDraft = {
  tipo: "envio";
  fornecedor?: string;
  nota_fiscal?: string;
  chegada?: string;
  observacoes?: string;
  linhas: ShipmentDraftLine[];
};

export type AgentDraft = OrderDraft | ShipmentDraft;

const STORAGE_KEY = "dute.agent-draft";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function optional(value: unknown) {
  return text(value) || undefined;
}

function quantity(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function list(value: unknown) {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as AnyRecord[]) : [];
}

/** Lê o rascunho que veio na mensagem (ou do armazenamento), descartando o que não tiver forma de rascunho. */
export function parseDraft(value: unknown): AgentDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as AnyRecord;
  if (raw.tipo === "pedido") {
    return {
      tipo: "pedido",
      nome: optional(raw.nome),
      destino: optional(raw.destino),
      prazo: optional(raw.prazo),
      observacoes: optional(raw.observacoes),
      linhas: list(raw.linhas)
        .map((line) => ({
          sku_code: text(line.sku_code),
          codigo: text(line.codigo),
          nome: text(line.nome),
          detalhe: optional(line.detalhe),
          quantidade: quantity(line.quantidade),
          disponivel: quantity(line.disponivel),
        }))
        .filter((line) => line.sku_code && line.quantidade > 0),
      pendencias: list(raw.pendencias).map((item) => ({
        item: text(item.item),
        motivo: text(item.motivo),
        opcoes: list(item.opcoes).map((option) => ({
          codigo: text(option.codigo),
          nome: text(option.nome),
          detalhe: optional(option.detalhe),
          disponivel: quantity(option.disponivel),
        })),
      })),
    };
  }
  if (raw.tipo === "envio") {
    return {
      tipo: "envio",
      fornecedor: optional(raw.fornecedor),
      nota_fiscal: optional(raw.nota_fiscal),
      chegada: optional(raw.chegada),
      observacoes: optional(raw.observacoes),
      linhas: list(raw.linhas)
        .map((line) => ({
          codigo: optional(line.codigo),
          nome: optional(line.nome),
          quantidade: quantity(line.quantidade),
          situacao:
            line.situacao === "no_estoque" || line.situacao === "novo" ? (line.situacao as "no_estoque" | "novo") : ("codigo_a_definir" as const),
        }))
        .filter((line) => line.quantidade > 0 && (line.codigo || line.nome)),
    };
  }
  return null;
}

export function draftHref(draft: AgentDraft) {
  return draft.tipo === "pedido" ? "/portal/estoque?rascunho=1" : "/portal/recebimentos?rascunho=1";
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): DraftStorage | undefined {
  return typeof window === "undefined" ? undefined : window.sessionStorage;
}

export function saveDraft(draft: AgentDraft, storage = tabStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Sem storage (aba privada): a tela abre vazia, como antes.
  }
}

/** Lê e apaga o rascunho guardado, se for do tipo esperado. */
export function takeDraft<T extends AgentDraft["tipo"]>(tipo: T, storage = tabStorage()): Extract<AgentDraft, { tipo: T }> | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = parseDraft(JSON.parse(raw));
    if (draft?.tipo !== tipo) return null;
    storage?.removeItem(STORAGE_KEY);
    return draft as Extract<AgentDraft, { tipo: T }>;
  } catch {
    return null;
  }
}

/** Carrinho do Estoque a partir do rascunho: o primeiro produto do mesmo SKU recebe a quantidade. */
export function cartFromDraft(products: Array<{ key: string; sku: string; available: number }>, draft: OrderDraft) {
  const cart: Record<string, number> = {};
  const missing: string[] = [];
  for (const line of draft.linhas) {
    const product = products.find((item) => item.sku === line.sku_code && item.available > 0);
    if (!product) {
      missing.push(line.codigo || line.nome);
      continue;
    }
    cart[product.key] = Math.min((cart[product.key] ?? 0) + line.quantidade, product.available);
  }
  return { cart, missing };
}

/** "2026-10-04" → valor do campo datetime-local do pedido (meio-dia). */
export function dueAtFromDraft(prazo: string | undefined) {
  return prazo && /^\d{4}-\d{2}-\d{2}$/.test(prazo) ? `${prazo}T12:00` : "";
}
