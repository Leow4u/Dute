/**
 * Estado de uma mensagem e da conversa, sem Firestore. A gravação
 * (gravacao.ts) só traduz isto para o documento. O id da Meta é a
 * identidade: repetir o mesmo POST não cria outra mensagem.
 */

import { camposDaLinha } from "./linhas.js";

export const LIMITE_DO_TEXTO = 4000;
export const LIMITE_DA_PREVIA = 160;
export const LIMITE_DO_NOME = 120;
export const LIMITE_DO_LOTE = 50;

const STATUS = ["failed", "sent", "delivered", "read", "played"] as const;
export type StatusZap = (typeof STATUS)[number];

const RANK: Record<StatusZap, number> = {
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  played: 5,
};

export type Direcao = "in" | "out";
export type Origem = "relay" | "agent" | "status";

export type Entrada = {
  wamid: string;
  phone_number_id: string;
  contact_wa_id: string;
  contact_name?: string;
  direction: Direcao;
  type: string;
  text: string;
  occurred_at_ms: number;
  status?: StatusZap;
  origin: Origem;
  status_only: boolean;
};

export type Mensagem = {
  wamid: string;
  conversation_id: string;
  phone_number_id: string;
  contact_wa_id: string;
  contact_name?: string;
  direction: Direcao;
  type: string;
  text: string;
  occurred_at_ms: number;
  status?: StatusZap;
  origin: Origem;
  agent: string;
  received_at_ms: number;
};

export type Conversa = {
  id: string;
  phone_number_id: string;
  contact_wa_id: string;
  contact_name?: string;
  agent: string;
  agent_name: string;
  area: string;
  line_phone: string;
  last_message_at_ms: number;
  last_preview: string;
  last_direction: Direcao;
  last_type: string;
  updated_at_ms: number;
};

export type Efeito = "nova" | "repetida" | "atualizada";

export const ROTULO_DO_TIPO: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  interactive: "Mensagem",
  unknown: "Mensagem",
};

const MIN_MS = Date.parse("2020-01-01T00:00:00Z");
const FOLGA_MS = 5 * 60_000;

export function statusZap(valor: unknown): StatusZap | undefined {
  return typeof valor === "string" && (STATUS as readonly string[]).includes(valor) ? (valor as StatusZap) : undefined;
}

/** O status só anda para a frente. `failed` substitui `sent`, e não uma entrega já confirmada. */
export function statusMelhor(atual: StatusZap | undefined, novo: StatusZap): StatusZap {
  if (!atual) return novo;
  if (novo === "failed") return RANK[atual] > RANK.sent ? atual : "failed";
  if (atual === "failed") return novo;
  return RANK[novo] > RANK[atual] ? novo : atual;
}

export function soDigitos(valor: unknown): string {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(Math.trunc(valor)).replace(/\D/g, "");
  if (typeof valor !== "string") return "";
  return valor.replace(/\D/g, "");
}

export function phoneNumberIdValido(valor: string): boolean {
  return /^\d{8,22}$/.test(valor);
}

export function waIdValido(valor: string): boolean {
  return /^\d{8,15}$/.test(valor);
}

export function idDaConversa(phoneNumberId: string, contactWaId: string): string {
  return `${phoneNumberId}_${contactWaId}`;
}

export function idDeConversaValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{8,22}_\d{8,15}$/.test(valor);
}

/**
 * O id da Meta vira o id do documento. Barra não cabe num id do Firestore:
 * aí o id guardado é o escapado, e o campo `wamid` continua o original.
 */
export function idDeDocumento(wamid: string): string | null {
  const limpo = wamid.trim();
  if (!limpo || limpo.length > 500) return null;
  if (limpo === "." || limpo === "..") return null;
  if (/^__.*__$/.test(limpo)) return null;
  if (/[\u0000-\u001f]/.test(limpo)) return null;
  const docId = limpo.includes("/") ? encodeURIComponent(limpo) : limpo;
  if (docId.length > 700 || docId.includes("/")) return null;
  return docId;
}

export function limitarTexto(valor: string): string {
  return valor.replace(/\u0000/g, "").trim().slice(0, LIMITE_DO_TEXTO);
}

export function limitarNome(valor: string): string | undefined {
  const nome = valor.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, LIMITE_DO_NOME);
  return nome || undefined;
}

/** Segundos da Meta, ou milissegundos se o número já for grande. Fora da faixa, o relógio do servidor. */
export function instanteDaMensagem(timestamp: unknown, agoraMs: number): number {
  const numero = typeof timestamp === "number" ? timestamp : typeof timestamp === "string" ? Number(timestamp) : Number.NaN;
  if (!Number.isFinite(numero) || numero <= 0) return agoraMs;
  const ms = numero > 10_000_000_000 ? numero : numero * 1000;
  if (ms < MIN_MS || ms > agoraMs + FOLGA_MS) return agoraMs;
  return Math.trunc(ms);
}

export function tipoSeguro(valor: unknown): string {
  if (typeof valor !== "string") return "unknown";
  const tipo = valor.toLowerCase();
  return /^[a-z0-9_]{1,32}$/.test(tipo) ? tipo : "unknown";
}

export function previa(tipo: string, texto: string): string {
  const umaLinha = texto.replace(/\s+/g, " ").trim();
  if (umaLinha) return umaLinha.slice(0, LIMITE_DA_PREVIA);
  return ROTULO_DO_TIPO[tipo] ?? "Mensagem";
}

export function aplicar(mensagem: Mensagem | null, conversa: Conversa | null, entrada: Entrada, agoraMs: number): { mensagem: Mensagem; conversa: Conversa; efeito: Efeito } {
  const proxima = fundirMensagem(mensagem, entrada, agoraMs);
  const conversaProxima = fundirConversa(conversa, proxima, agoraMs);
  if (!mensagem) return { mensagem: proxima, conversa: conversaProxima, efeito: "nova" };
  if (!igualMensagem(mensagem, proxima) || !conversa || !igualConversa(conversa, conversaProxima)) {
    return { mensagem: proxima, conversa: conversaProxima, efeito: "atualizada" };
  }
  return { mensagem, conversa, efeito: "repetida" };
}

function fundirMensagem(atual: Mensagem | null, entrada: Entrada, agoraMs: number): Mensagem {
  if (!atual) {
    const soStatus = entrada.status_only;
    return {
      wamid: entrada.wamid,
      conversation_id: idDaConversa(entrada.phone_number_id, entrada.contact_wa_id),
      phone_number_id: entrada.phone_number_id,
      contact_wa_id: entrada.contact_wa_id,
      ...(entrada.contact_name ? { contact_name: entrada.contact_name } : {}),
      direction: soStatus ? "out" : entrada.direction,
      type: soStatus ? "unknown" : entrada.type,
      text: soStatus ? "" : entrada.text,
      occurred_at_ms: entrada.occurred_at_ms,
      ...(entrada.status ? { status: entrada.status } : {}),
      origin: soStatus ? "status" : entrada.origin,
      agent: camposDaLinha(entrada.phone_number_id).agent,
      received_at_ms: agoraMs,
    };
  }
  const next: Mensagem = { ...atual };
  if (atual.type === "unknown" && !entrada.status_only) {
    next.direction = entrada.direction;
    next.type = entrada.type;
    next.text = entrada.text;
    next.origin = entrada.origin;
    next.occurred_at_ms = entrada.occurred_at_ms;
  } else if (!atual.text && entrada.text && !entrada.status_only) {
    next.text = entrada.text;
  }
  if (!atual.contact_name && entrada.contact_name) next.contact_name = entrada.contact_name;
  if (entrada.status) next.status = statusMelhor(atual.status, entrada.status);
  return next;
}

function fundirConversa(atual: Conversa | null, mensagem: Mensagem, agoraMs: number): Conversa {
  const linha = camposDaLinha(mensagem.phone_number_id);
  const base: Conversa = atual ?? {
    id: mensagem.conversation_id,
    phone_number_id: mensagem.phone_number_id,
    contact_wa_id: mensagem.contact_wa_id,
    ...(mensagem.contact_name ? { contact_name: mensagem.contact_name } : {}),
    agent: linha.agent,
    agent_name: linha.agent_name,
    area: linha.area,
    line_phone: linha.line_phone,
    last_message_at_ms: 0,
    last_preview: "",
    last_direction: mensagem.direction,
    last_type: mensagem.type,
    updated_at_ms: agoraMs,
  };
  const next: Conversa = { ...base, updated_at_ms: agoraMs };
  if (!next.contact_name && mensagem.contact_name) next.contact_name = mensagem.contact_name;
  if (mensagem.occurred_at_ms >= next.last_message_at_ms) {
    next.last_message_at_ms = mensagem.occurred_at_ms;
    next.last_preview = previa(mensagem.type, mensagem.text);
    next.last_direction = mensagem.direction;
    next.last_type = mensagem.type;
  }
  return next;
}

function igualMensagem(a: Mensagem, b: Mensagem): boolean {
  return a.direction === b.direction && a.type === b.type && a.text === b.text && a.status === b.status && a.contact_name === b.contact_name && a.occurred_at_ms === b.occurred_at_ms && a.origin === b.origin;
}

function igualConversa(a: Conversa, b: Conversa): boolean {
  return a.contact_name === b.contact_name && a.last_message_at_ms === b.last_message_at_ms && a.last_preview === b.last_preview && a.last_direction === b.last_direction && a.last_type === b.last_type;
}
