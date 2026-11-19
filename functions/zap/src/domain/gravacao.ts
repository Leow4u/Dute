import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ZAP_CONVERSATIONS_COLLECTION, ZAP_MESSAGES_COLLECTION } from "./colecoes.js";
import { aplicar, idDaConversa, idDeDocumento, statusZap, type Conversa, type Direcao, type Efeito, type Entrada, type Mensagem, type Origem } from "./modelo.js";

/**
 * Uma transação por mensagem: o documento é o id da Meta. Repetir o POST
 * relê e não grava de novo quando nada mudou. Status que chega antes do
 * texto cria um rascunho; a mensagem completa preenche o mesmo documento.
 */

export async function gravarEntrada(db: Firestore, entrada: Entrada, agora = new Date()): Promise<Efeito> {
  const docId = idDeDocumento(entrada.wamid);
  if (!docId) throw new Error("Id de mensagem inválido.");
  const refMensagem = db.collection(ZAP_MESSAGES_COLLECTION).doc(docId);
  return db.runTransaction(async (transaction) => {
    const snapMensagem = await transaction.get(refMensagem);
    const atual = snapMensagem.exists ? mensagemDoDocumento(entrada.wamid, snapMensagem.data() ?? {}) : null;
    const conversaId = atual?.conversation_id ?? idDaConversa(entrada.phone_number_id, entrada.contact_wa_id);
    const refConversa = db.collection(ZAP_CONVERSATIONS_COLLECTION).doc(conversaId);
    const snapConversa = await transaction.get(refConversa);
    const conversa = snapConversa.exists ? conversaDoDocumento(snapConversa.id, snapConversa.data() ?? {}) : null;
    const resultado = aplicar(atual, conversa, entrada, agora.getTime());
    if (resultado.efeito === "repetida") return "repetida";
    transaction.set(refMensagem, documentoDaMensagem(resultado.mensagem));
    transaction.set(refConversa, documentoDaConversa(resultado.conversa));
    return resultado.efeito;
  });
}

export function documentoDaMensagem(mensagem: Mensagem): Record<string, unknown> {
  return {
    wamid: mensagem.wamid,
    conversation_id: mensagem.conversation_id,
    phone_number_id: mensagem.phone_number_id,
    contact_wa_id: mensagem.contact_wa_id,
    ...(mensagem.contact_name ? { contact_name: mensagem.contact_name } : {}),
    direction: mensagem.direction,
    type: mensagem.type,
    text: mensagem.text,
    occurred_at: Timestamp.fromMillis(mensagem.occurred_at_ms),
    ...(mensagem.status ? { status: mensagem.status } : {}),
    origin: mensagem.origin,
    agent: mensagem.agent,
    received_at: Timestamp.fromMillis(mensagem.received_at_ms),
  };
}

export function documentoDaConversa(conversa: Conversa): Record<string, unknown> {
  return {
    phone_number_id: conversa.phone_number_id,
    contact_wa_id: conversa.contact_wa_id,
    ...(conversa.contact_name ? { contact_name: conversa.contact_name } : {}),
    agent: conversa.agent,
    agent_name: conversa.agent_name,
    area: conversa.area,
    line_phone: conversa.line_phone,
    last_message_at: Timestamp.fromMillis(conversa.last_message_at_ms),
    last_preview: conversa.last_preview,
    last_direction: conversa.last_direction,
    last_type: conversa.last_type,
    updated_at: Timestamp.fromMillis(conversa.updated_at_ms),
  };
}

function mensagemDoDocumento(wamid: string, data: Record<string, unknown>): Mensagem | null {
  const conversationId = texto(data.conversation_id);
  const phone = texto(data.phone_number_id);
  const contato = texto(data.contact_wa_id);
  const direction = direcao(data.direction);
  const occurred = millis(data.occurred_at);
  const received = millis(data.received_at);
  if (!conversationId || !phone || !contato || !direction || occurred === null || received === null) return null;
  const nome = texto(data.contact_name);
  const status = statusZap(data.status);
  return {
    wamid: texto(data.wamid) || wamid,
    conversation_id: conversationId,
    phone_number_id: phone,
    contact_wa_id: contato,
    ...(nome ? { contact_name: nome } : {}),
    direction,
    type: texto(data.type) || "unknown",
    text: typeof data.text === "string" ? data.text : "",
    occurred_at_ms: occurred,
    ...(status ? { status } : {}),
    origin: origem(data.origin),
    agent: texto(data.agent) || "desconhecido",
    received_at_ms: received,
  };
}

function conversaDoDocumento(id: string, data: Record<string, unknown>): Conversa | null {
  const phone = texto(data.phone_number_id);
  const contato = texto(data.contact_wa_id);
  const direction = direcao(data.last_direction);
  const last = millis(data.last_message_at);
  if (!phone || !contato || !direction || last === null) return null;
  const nome = texto(data.contact_name);
  return {
    id,
    phone_number_id: phone,
    contact_wa_id: contato,
    ...(nome ? { contact_name: nome } : {}),
    agent: texto(data.agent) || "desconhecido",
    agent_name: texto(data.agent_name) || "Linha",
    area: texto(data.area) || "",
    line_phone: texto(data.line_phone) || "",
    last_message_at_ms: last,
    last_preview: typeof data.last_preview === "string" ? data.last_preview : "",
    last_direction: direction,
    last_type: texto(data.last_type) || "unknown",
    updated_at_ms: millis(data.updated_at) ?? last,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function direcao(valor: unknown): Direcao | null {
  return valor === "in" || valor === "out" ? valor : null;
}

function origem(valor: unknown): Origem {
  return valor === "relay" || valor === "agent" || valor === "status" ? valor : "relay";
}

function millis(valor: unknown): number | null {
  if (valor instanceof Timestamp) return valor.toMillis();
  if (valor && typeof valor === "object" && "toMillis" in valor && typeof valor.toMillis === "function") {
    const ms = valor.toMillis();
    return typeof ms === "number" ? ms : null;
  }
  return null;
}
