/**
 * A ingestão responde rápido e não chama a Meta. Quem entrega a mensagem ao
 * agente é o relay, antes deste POST: uma falha aqui não pode ser o caminho
 * da entrega. O mesmo id da Meta pode chegar de novo; a gravação é idempotente.
 */

import { timingSafeEqual } from "node:crypto";

import { extrairEntradas } from "./extrair.js";
import type { Efeito, Entrada } from "./modelo.js";

export const HEADER_DO_SEGREDO = "x-dute-zap-secret";
export const NOME_DO_SEGREDO = "ZAP_INGEST_SECRET";
export const LIMITE_DO_CORPO = 1024 * 1024;

export type PedidoHttp = {
  method: string;
  contentType: string | undefined;
  headerSecret: string | undefined;
  body: unknown;
  tamanho: number;
};

export type RespostaHttp = { status: number; body: Record<string, unknown> };

export type Dependencias = {
  segredo: string | undefined;
  agora: Date;
  gravar: (entrada: Entrada) => Promise<Efeito>;
};

export async function tratarIngestao(pedido: PedidoHttp, deps: Dependencias): Promise<RespostaHttp> {
  if (pedido.method !== "POST") return { status: 405, body: { ok: false, erro: "metodo" } };
  if (pedido.tamanho > LIMITE_DO_CORPO) return { status: 413, body: { ok: false, erro: "corpo_grande" } };
  if (!ehJson(pedido.contentType)) return { status: 415, body: { ok: false, erro: "content_type" } };
  if (!deps.segredo) return { status: 503, body: { ok: false, erro: "sem_segredo" } };
  if (!segredoConfere(deps.segredo, pedido.headerSecret)) return { status: 401, body: { ok: false, erro: "segredo_recusado" } };

  const extraido = extrairEntradas(pedido.body, deps.agora.getTime());
  if ("erro" in extraido) return { status: 400, body: { ok: false, erro: extraido.erro } };

  let gravados = 0;
  let atualizados = 0;
  let repetidos = 0;
  try {
    for (const entrada of extraido.entradas) {
      const efeito = await deps.gravar(entrada);
      if (efeito === "nova") gravados += 1;
      else if (efeito === "atualizada") atualizados += 1;
      else repetidos += 1;
    }
  } catch (erro) {
    console.error("ingestZap", erro instanceof Error ? erro.message : "falha");
    return { status: 503, body: { ok: false, erro: "indisponivel", gravados, atualizados, repetidos } };
  }
  return { status: 200, body: { ok: true, gravados, atualizados, repetidos, ignorados: extraido.ignorados } };
}

export function segredoConfere(esperado: string, recebido: string | undefined): boolean {
  const a = Buffer.from(esperado.slice(0, 256));
  const informado = (recebido ?? "").trim().slice(0, 256);
  const b = Buffer.from(informado);
  if (a.length === 0 || a.length !== b.length) {
    timingSafeEqual(a.length ? a : Buffer.from("0"), a.length ? a : Buffer.from("0"));
    return false;
  }
  return timingSafeEqual(a, b);
}

function ehJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/json";
}
