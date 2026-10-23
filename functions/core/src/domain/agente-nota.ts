import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { invoiceContext, READABLE_INVOICE_TYPES, type AgentAttachment } from "./agent-attachments.js";
import type { EscopoDoAgente } from "./agente-escopo.js";
import { texto } from "./agente-ferramentas.js";
import { LIMITE_DA_CONSULTA, type LeitorDoAgente } from "./agente-leitor.js";
import { assertOwnInvoicePath, matchInvoiceItems, sanitizeInvoiceReading } from "./invoice-reading.js";

/**
 * A nota fiscal anexada pelo cliente na conversa (parte 5.5h), como no agente
 * do WMS: o arquivo já está na pasta do cliente no Storage, e a leitura do
 * Gemini entra na mensagem ao modelo como texto (a pessoa não vê). O agente
 * monta o aviso com rascunho_envio, e a nota vai junto no cartão para a pessoa
 * conferir e enviar. A leitura não grava pedido nem estoque.
 *
 * As regras da leitura são cópias literais do WMS (invoice-reading.ts e
 * agent-attachments.ts), travadas em copias-do-wms.test.ts, assim como o
 * esquema da extração abaixo.
 */

/** O maior arquivo lido, o mesmo do WMS (DOCUMENT_VISUAL_OCR_MAX_BYTES). */
export const TAMANHO_MAXIMO_DA_NOTA = 14 * 1024 * 1024;

export const InvoiceExtractionSchema = z.object({
  supplier: z.string().optional(),
  invoice_number: z.string().optional(),
  issue_date: z.string().optional(),
  volumes: z.string().optional(),
  carrier: z.string().optional(),
  items: z
    .array(
      z.object({
        supplier_code: z.string().optional(),
        description: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
});

export type ExtracaoDaNota = { saida: unknown; modelo: string; tokens_entrada?: number; tokens_saida?: number; latencia_ms: number; erro?: string };

/** Como a nota chega ao agente: o arquivo do Storage e a extração do modelo. Os testes passam os dois falsos. */
export type LerNota = {
  baixar: (caminho: string) => Promise<Buffer>;
  extrair: (arquivo: { bytes: Buffer; contentType: string }) => Promise<ExtracaoDaNota>;
};

/** O arquivo do Storage dos documentos, o mesmo bucket do WMS. */
export function baixarDoStorage(projectId: string): LerNota["baixar"] {
  const bucket = process.env.DOCUMENT_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  return async (caminho) => (await getStorage().bucket(bucket).file(caminho).download({ validation: false }))[0];
}

/** Os anexos da mensagem: só do cliente, na Armazenagem, da pasta do próprio cliente. */
export function anexosDaMensagem(escopo: Pick<EscopoDoAgente, "audiencia" | "modulo" | "customerCode">, anexos: readonly AgentAttachment[]): AgentAttachment[] {
  if (!anexos.length) return [];
  if (escopo.audiencia !== "cliente") throw new HttpsError("permission-denied", "Anexar nota no chat é do portal do cliente.");
  if (escopo.modulo !== "wms") throw new HttpsError("failed-precondition", "A nota vai no aviso de envio: anexe na conversa da Armazenagem.");
  for (const anexo of anexos) assertOwnInvoicePath(anexo.storage_path, escopo.customerCode);
  return [...anexos];
}

export type NotaLida = {
  /** O texto que acompanha a mensagem ao modelo; vazio sem nota legível. */
  contexto: string;
  /** O uso da leitura, para o painel de custo; só quando o modelo leu. */
  uso: Record<string, unknown> | null;
};

/**
 * Lê a primeira nota legível dos anexos e casa os itens com o estoque do
 * cliente, pelo leitor. Qualquer falha vira o contexto sem leitura: o agente
 * pede os dados à pessoa, e a conversa segue.
 */
export async function lerNotaAnexada(leitor: LeitorDoAgente, escopo: Pick<EscopoDoAgente, "customerCode">, anexos: readonly AgentAttachment[], lerNota: LerNota | undefined): Promise<NotaLida> {
  const legivel = anexos.find((anexo) => READABLE_INVOICE_TYPES.includes(anexo.content_type.toLowerCase()));
  if (!legivel) return { contexto: "", uso: null };
  if (!lerNota) return { contexto: invoiceContext(legivel.file_name, null), uso: null };
  try {
    const caminho = assertOwnInvoicePath(legivel.storage_path, escopo.customerCode);
    const bytes = await lerNota.baixar(caminho);
    if (bytes.length > TAMANHO_MAXIMO_DA_NOTA) throw new Error("Arquivo grande demais para leitura automática.");
    const extracao = await lerNota.extrair({ bytes, contentType: legivel.content_type.toLowerCase() });
    const leitura = sanitizeInvoiceReading(extracao.saida);
    const estoque = await leitor.doCliente("client_inventory", { limite: LIMITE_DA_CONSULTA });
    const catalogo = estoque.map((item) => ({ client_item_code: texto(item.client_item_code), sku_code: texto(item.sku_code), product_name: texto(item.product_name) }));
    const items = matchInvoiceItems(leitura.items, catalogo);
    return {
      contexto: invoiceContext(legivel.file_name, { ...leitura, items }),
      uso: {
        source: "leitura_nota_chat",
        model: extracao.modelo,
        input_tokens: extracao.tokens_entrada ?? null,
        output_tokens: extracao.tokens_saida ?? null,
        latency_ms: extracao.latencia_ms,
        items_read: items.length,
        error: extracao.erro ?? null,
      },
    };
  } catch (erro) {
    console.warn("[agente] nota anexada não lida", { arquivo: legivel.file_name, erro: erro instanceof Error ? erro.message : String(erro) });
    return { contexto: invoiceContext(legivel.file_name, null), uso: null };
  }
}
