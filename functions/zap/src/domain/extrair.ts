/**
 * Dois corpos no mesmo POST (docs/plataforma/zap.md):
 * - o webhook `messages` da Meta, como o relay recebe, com mensagens de
 *   entrada e status;
 * - o registro de saída, que o agente manda depois de enviar, porque a Meta
 *   não ecoa a mensagem que a empresa mandou.
 */

import {
  LIMITE_DO_LOTE,
  instanteDaMensagem,
  limitarNome,
  limitarTexto,
  phoneNumberIdValido,
  soDigitos,
  statusZap,
  tipoSeguro,
  waIdValido,
  type Direcao,
  type Entrada,
  type Origem,
} from "./modelo.js";

export type Extracao = { entradas: Entrada[]; ignorados: number } | { erro: "corpo_invalido" | "lote_grande" };

export function extrairEntradas(corpo: unknown, agoraMs: number): Extracao {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "corpo_invalido" };
  const registro = corpo as Record<string, unknown>;
  if (registro.object === "whatsapp_business_account") return extrairMeta(registro, agoraMs);
  if (registro.direction === "in" || registro.direction === "out") return extrairEnvelope(registro, agoraMs);
  return { erro: "corpo_invalido" };
}

function extrairMeta(corpo: Record<string, unknown>, agoraMs: number): Extracao {
  if (!Array.isArray(corpo.entry)) return { erro: "corpo_invalido" };
  const entradas: Entrada[] = [];
  let ignorados = 0;
  for (const item of corpo.entry) {
    if (!item || typeof item !== "object") continue;
    const changes = (item as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const campo = (change as { field?: unknown }).field;
      const value = (change as { value?: unknown }).value;
      if (campo !== "messages" || !value || typeof value !== "object") continue;
      const extraido = extrairValor(value as Record<string, unknown>, agoraMs);
      entradas.push(...extraido.entradas);
      ignorados += extraido.ignorados;
    }
  }
  if (entradas.length + ignorados > LIMITE_DO_LOTE) return { erro: "lote_grande" };
  return { entradas, ignorados };
}

function extrairValor(value: Record<string, unknown>, agoraMs: number): { entradas: Entrada[]; ignorados: number } {
  const metadata = value.metadata;
  const phone = metadata && typeof metadata === "object" ? soDigitos((metadata as { phone_number_id?: unknown }).phone_number_id) : "";
  const nomes = nomesDosContatos(value.contacts);
  const entradas: Entrada[] = [];
  let ignorados = 0;
  if (!phoneNumberIdValido(phone)) {
    const mensagens = Array.isArray(value.messages) ? value.messages.length : 0;
    const statuses = Array.isArray(value.statuses) ? value.statuses.length : 0;
    return { entradas, ignorados: mensagens + statuses };
  }
  if (Array.isArray(value.messages)) {
    for (const item of value.messages) {
      const entrada = mensagemMeta(item, phone, nomes, agoraMs);
      if (entrada) entradas.push(entrada);
      else ignorados += 1;
    }
  }
  if (Array.isArray(value.statuses)) {
    for (const item of value.statuses) {
      const entrada = statusMeta(item, phone, agoraMs);
      if (entrada) entradas.push(entrada);
      else ignorados += 1;
    }
  }
  return { entradas, ignorados };
}

function nomesDosContatos(contatos: unknown): Map<string, string> {
  const nomes = new Map<string, string>();
  if (!Array.isArray(contatos)) return nomes;
  for (const contato of contatos) {
    if (!contato || typeof contato !== "object") continue;
    const wa = soDigitos((contato as { wa_id?: unknown }).wa_id);
    const perfil = (contato as { profile?: { name?: unknown } }).profile;
    const nome = limitarNome(typeof perfil?.name === "string" ? perfil.name : "");
    if (waIdValido(wa) && nome) nomes.set(wa, nome);
  }
  return nomes;
}

function mensagemMeta(item: unknown, phone: string, nomes: Map<string, string>, agoraMs: number): Entrada | null {
  if (!item || typeof item !== "object") return null;
  const mensagem = item as Record<string, unknown>;
  const wamid = typeof mensagem.id === "string" ? mensagem.id : "";
  const contato = soDigitos(mensagem.from);
  if (!wamid || !waIdValido(contato)) return null;
  const { type, text } = textoETipo(mensagem);
  const nome = nomes.get(contato);
  return {
    wamid,
    phone_number_id: phone,
    contact_wa_id: contato,
    ...(nome ? { contact_name: nome } : {}),
    direction: "in",
    type,
    text,
    occurred_at_ms: instanteDaMensagem(mensagem.timestamp, agoraMs),
    origin: "relay",
    status_only: false,
  };
}

function statusMeta(item: unknown, phone: string, agoraMs: number): Entrada | null {
  if (!item || typeof item !== "object") return null;
  const status = item as Record<string, unknown>;
  const wamid = typeof status.id === "string" ? status.id : "";
  const contato = soDigitos(status.recipient_id);
  const codigo = statusZap(status.status);
  if (!wamid || !waIdValido(contato) || !codigo) return null;
  return {
    wamid,
    phone_number_id: phone,
    contact_wa_id: contato,
    direction: "out",
    type: "unknown",
    text: "",
    occurred_at_ms: instanteDaMensagem(status.timestamp, agoraMs),
    status: codigo,
    origin: "status",
    status_only: true,
  };
}

function extrairEnvelope(corpo: Record<string, unknown>, agoraMs: number): Extracao {
  const direction = corpo.direction === "in" || corpo.direction === "out" ? corpo.direction : null;
  const phone = soDigitos(corpo.phone_number_id);
  const message = corpo.message;
  if (!direction || !phoneNumberIdValido(phone) || !message || typeof message !== "object" || Array.isArray(message)) {
    return { erro: "corpo_invalido" };
  }
  const mensagem = message as Record<string, unknown>;
  const wamid = typeof mensagem.id === "string" ? mensagem.id : "";
  const contato = soDigitos(direction === "in" ? corpo.from : corpo.to);
  if (!wamid || !waIdValido(contato)) return { erro: "corpo_invalido" };
  const nome = limitarNome(typeof corpo.contact_name === "string" ? corpo.contact_name : "");
  const type = tipoSeguro(mensagem.type ?? "text");
  const text = limitarTexto(typeof mensagem.text === "string" ? mensagem.text : "");
  const entrada: Entrada = {
    wamid,
    phone_number_id: phone,
    contact_wa_id: contato,
    ...(nome ? { contact_name: nome } : {}),
    direction,
    type,
    text,
    occurred_at_ms: instanteDaMensagem(mensagem.timestamp, agoraMs),
    origin: origemDoEnvelope(direction),
    status_only: false,
  };
  return { entradas: [entrada], ignorados: 0 };
}

function origemDoEnvelope(direction: Direcao): Origem {
  return direction === "out" ? "agent" : "relay";
}

function textoETipo(mensagem: Record<string, unknown>): { type: string; text: string } {
  const type = tipoSeguro(mensagem.type);
  if (type === "text") {
    const body = (mensagem.text as { body?: unknown } | undefined)?.body;
    return { type, text: typeof body === "string" ? limitarTexto(body) : "" };
  }
  if (type === "button") {
    const texto = (mensagem.button as { text?: unknown } | undefined)?.text;
    return { type, text: typeof texto === "string" ? limitarTexto(texto) : "" };
  }
  if (type === "interactive") {
    const texto = (mensagem.interactive as { body?: { text?: unknown } } | undefined)?.body?.text;
    return { type, text: typeof texto === "string" ? limitarTexto(texto) : "" };
  }
  if (type === "reaction") {
    const emoji = (mensagem.reaction as { emoji?: unknown } | undefined)?.emoji;
    return { type, text: typeof emoji === "string" ? limitarTexto(emoji) : "" };
  }
  const media = mensagem[type];
  if (media && typeof media === "object" && "caption" in media) {
    const caption = (media as { caption?: unknown }).caption;
    if (typeof caption === "string") return { type, text: limitarTexto(caption) };
  }
  return { type, text: "" };
}
