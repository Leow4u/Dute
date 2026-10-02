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
  hora?: string;
  observacoes?: string;
  linhas: OrderDraftLine[];
  pendencias: DraftPending[];
};

export type ShipmentDraftLine = {
  sku_code?: string;
  codigo?: string;
  nome?: string;
  quantidade: number;
  situacao: "no_estoque" | "novo" | "codigo_a_definir";
};

/** Nota anexada no chat, já no Storage do cliente. */
export type DraftAttachment = { file_name: string; file_url: string; storage_path: string; content_type: string; size_bytes: number };

export type ShipmentDraft = {
  tipo: "envio";
  fornecedor?: string;
  nota_fiscal?: string;
  chegada?: string;
  observacoes?: string;
  linhas: ShipmentDraftLine[];
  anexos?: DraftAttachment[];
};

/** Rotina proposta pelo agente (sugerir_rotina): a pessoa confirma no cartão. */
export type RoutineDraft = { tipo: "rotina"; value: Record<string, unknown> };

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
export function parseRoutineDraft(value: unknown): RoutineDraft | null {
  if (!value || typeof value !== "object" || (value as AnyRecord).tipo !== "rotina") return null;
  return { tipo: "rotina", value: value as AnyRecord };
}

export function parseDraft(value: unknown): AgentDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as AnyRecord;
  if (raw.tipo === "pedido") {
    return {
      tipo: "pedido",
      nome: optional(raw.nome),
      destino: optional(raw.destino),
      prazo: optional(raw.prazo),
      hora: optional(raw.hora),
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
          sku_code: optional(line.sku_code),
          codigo: optional(line.codigo),
          nome: optional(line.nome),
          quantidade: quantity(line.quantidade),
          situacao:
            line.situacao === "no_estoque" || line.situacao === "novo" ? (line.situacao as "no_estoque" | "novo") : ("codigo_a_definir" as const),
        }))
        .filter((line) => line.quantidade > 0 && (line.codigo || line.nome)),
      anexos: list(raw.anexos)
        .map((file) => ({
          file_name: text(file.file_name),
          file_url: text(file.file_url),
          storage_path: text(file.storage_path),
          content_type: text(file.content_type),
          size_bytes: quantity(file.size_bytes),
        }))
        .filter((file) => file.storage_path && file.file_url && file.file_name),
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

/** "2026-10-04" (+ "11:00") → valor do campo datetime-local do pedido (sem hora, meio-dia). */
export function dueAtFromDraft(prazo: string | undefined, hora?: string) {
  if (!prazo || !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return "";
  return `${prazo}T${hora && /^\d{2}:\d{2}$/.test(hora) ? hora : "12:00"}`;
}

// ------------------------------------------------ pedido enviado pelo cartão

/** Pedido que já saiu do cartão (gravado na mensagem pelo servidor). */
export type DraftSent = { request_id: string; request_number: string; sent_at: string };

export function parseDraftSent(value: unknown): DraftSent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as AnyRecord;
  const requestId = text(raw.request_id);
  return requestId ? { request_id: requestId, request_number: text(raw.request_number), sent_at: text(raw.sent_at) } : null;
}

export type OrderFormLine = { sku_code: string; codigo: string; nome: string; detalhe?: string; quantidade: number; disponivel: number };

/** O que a pessoa confere e ajusta no cartão antes de enviar. */
export type OrderForm = {
  linhas: OrderFormLine[];
  destino: string;
  dia: string;
  hora: string;
  nome: string;
  observacoes: string;
};

export function orderFormFromDraft(draft: OrderDraft): OrderForm {
  return {
    linhas: draft.linhas.map((line) => ({ ...line })),
    destino: draft.destino ?? "",
    dia: draft.prazo ?? "",
    hora: draft.prazo ? (draft.hora ?? "") : "",
    nome: draft.nome ?? "",
    observacoes: draft.observacoes ?? "",
  };
}

/** Saldo de agora no lugar do saldo de quando o agente montou (quando a tela já tem o estoque). */
export function withLiveAvailability(form: OrderForm, availableBySku: Map<string, number> | null): OrderForm {
  if (!availableBySku) return form;
  return {
    ...form,
    linhas: form.linhas.map((line) =>
      availableBySku.has(line.sku_code) ? { ...line, disponivel: Math.max(0, availableBySku.get(line.sku_code) ?? 0) } : line,
    ),
  };
}

/** O que impede o envio, em palavras de quem está enviando; null quando está pronto. */
export function orderFormProblem(form: OrderForm, today: string) {
  if (!form.linhas.length) return "Coloque ao menos um item.";
  const over = form.linhas.find((line) => line.quantidade > line.disponivel);
  if (over) return `${over.codigo || over.nome}: só ${over.disponivel} disponíveis.`;
  if (form.linhas.some((line) => line.quantidade <= 0)) return "Toda linha precisa de quantidade.";
  if (!form.destino.trim()) return "Diga onde entregar.";
  if (form.dia && form.dia < today) return "A data já passou.";
  return null;
}

/**
 * Pedido para a mesma criação do Estoque. Sem hora, vale até as 18h do dia.
 * O servidor separa as quantidades pelas posições do armazém.
 */
export function orderPayloadFromForm(form: OrderForm, messageId: string) {
  const destino = form.destino.trim();
  const dueAt = form.dia ? new Date(`${form.dia}T${form.hora || "18:00"}:00-03:00`) : null;
  return {
    type: "retirada" as const,
    priority: "normal",
    title: form.nome.trim() || undefined,
    description: [`Pedido montado com o Agent Dute para ${destino}`, form.observacoes.trim()].filter(Boolean).join(" | "),
    destination: destino,
    due_at: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : undefined,
    items: form.linhas.map((line) => ({
      sku_code: line.sku_code,
      client_item_code: line.codigo || undefined,
      product_name: line.nome || undefined,
      quantity: line.quantidade,
    })),
    agent_message_id: messageId,
  };
}

/** Rascunho com o que a pessoa já ajustou, para continuar na tela Estoque. */
export function draftFromOrderForm(form: OrderForm): OrderDraft {
  return {
    tipo: "pedido",
    nome: form.nome.trim() || undefined,
    destino: form.destino.trim() || undefined,
    prazo: form.dia || undefined,
    hora: form.hora || undefined,
    observacoes: form.observacoes.trim() || undefined,
    linhas: form.linhas.map((line) => ({ ...line })),
    pendencias: [],
  };
}

// ------------------------------------------- aviso de envio enviado pelo cartão

export type ShipmentFormLine = { sku_code?: string; codigo: string; nome: string; quantidade: number; situacao: ShipmentDraftLine["situacao"] };

export type ShipmentForm = {
  fornecedor: string;
  nota_fiscal: string;
  chegada: string;
  observacoes: string;
  linhas: ShipmentFormLine[];
  anexos: DraftAttachment[];
};

export function shipmentFormFromDraft(draft: ShipmentDraft): ShipmentForm {
  return {
    fornecedor: draft.fornecedor ?? "",
    nota_fiscal: draft.nota_fiscal ?? "",
    chegada: draft.chegada ?? "",
    observacoes: draft.observacoes ?? "",
    linhas: draft.linhas.map((line) => ({ sku_code: line.sku_code, codigo: line.codigo ?? "", nome: line.nome ?? "", quantidade: line.quantidade, situacao: line.situacao })),
    anexos: [...(draft.anexos ?? [])],
  };
}

/** O que impede o envio do aviso; null quando está pronto. Mesmas regras da tela Envios. */
export function shipmentFormProblem(form: ShipmentForm, today: string) {
  if (!form.fornecedor.trim()) return "Diga quem vai entregar (fornecedor).";
  if (!form.linhas.length) return "Coloque ao menos um item.";
  for (const [index, line] of form.linhas.entries()) {
    if (!line.codigo.trim() && !line.nome.trim()) return `Item ${index + 1}: informe o código ou o nome.`;
    if (line.situacao === "novo" && !line.nome.trim()) return `Item ${index + 1}: produto novo, informe o nome.`;
    if (line.quantidade <= 0) return `Item ${index + 1}: informe quantas peças vêm.`;
  }
  if (form.chegada && form.chegada < today) return "A data de chegada já passou.";
  return null;
}

/**
 * Aviso para a mesma criação da tela Envios: item do estoque vai com o SKU,
 * produto novo com o código informado e item sem código fica "código a
 * definir" (a Dutelog lê a etiqueta na conferência).
 */
export function shipmentPayloadFromForm(form: ShipmentForm, messageId: string) {
  const fornecedor = form.fornecedor.trim();
  return {
    type: "recebimento" as const,
    priority: "normal",
    title: `Envio de ${fornecedor}`,
    description: form.observacoes.trim() || "Envio de fornecedor avisado pelo cliente com o Agent Dute.",
    destination: "Recebimento Dutelog",
    // Só o dia: meio-dia em São Paulo, para não virar o dia anterior.
    due_at: form.chegada ? new Date(`${form.chegada}T12:00:00-03:00`).toISOString() : undefined,
    supplier: fornecedor,
    invoice_number: form.nota_fiscal.trim() || undefined,
    attachments: form.anexos,
    items: form.linhas.map((line) => {
      const code = line.codigo.trim();
      const name = line.nome.trim();
      if (line.situacao === "no_estoque" && line.sku_code) {
        return { sku_code: line.sku_code, client_item_code: code || undefined, product_name: name || undefined, product_registration: "existing" as const, location_id: null, quantity: line.quantidade };
      }
      if (code) {
        return { sku_code: code, client_item_code: code, product_name: name || undefined, product_registration: "new" as const, location_id: null, quantity: line.quantidade };
      }
      return { product_name: name, product_registration: "unknown" as const, location_id: null, quantity: line.quantidade };
    }),
    agent_message_id: messageId,
  };
}
