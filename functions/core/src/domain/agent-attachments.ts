import { z } from "genkit";

/**
 * Nota fiscal anexada no chat do Agent Dute (portal do cliente). O arquivo
 * sobe pelo mesmo caminho do Envios (pasta do cliente no Storage) e é lido
 * pela mesma leitura de nota. A leitura entra no contexto do agente como
 * texto; o agente monta o aviso com rascunho_envio e a nota vai junto no
 * rascunho, para a pessoa conferir e enviar pelo cartão.
 */

export const AgentAttachmentSchema = z.object({
  file_name: z.string().trim().min(1).max(240),
  file_url: z.string().url(),
  storage_path: z.string().trim().min(1).max(900),
  content_type: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().positive().max(30 * 1024 * 1024),
});

export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;

export const READABLE_INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

type ReadItem = {
  supplier_code: string;
  description: string;
  quantity: number;
  unit: string;
  match: { client_item_code: string; product_name: string } | null;
};

type Reading = { supplier: string; invoice_number: string; issue_date: string; notes: string; items: ReadItem[] };

const MAX_ITEMS_IN_CONTEXT = 60;

/** Texto que acompanha a mensagem para o modelo (a pessoa não vê). */
export function invoiceContext(fileName: string, reading: Reading | null) {
  if (!reading) {
    return `[A pessoa anexou o arquivo "${fileName}", mas não consegui ler a nota. Peça fornecedor, número da NF, itens e quantidades.]`;
  }
  const lines = reading.items.slice(0, MAX_ITEMS_IN_CONTEXT).map((item) => {
    const where = item.match ? `no estoque como ${item.match.client_item_code} (${item.match.product_name})` : "não encontrado no estoque";
    return `- código do fornecedor ${item.supplier_code || "sem código"} | ${item.description || "sem descrição"} | ${item.quantity} ${item.unit || "UN"} | ${where}`;
  });
  const extra = reading.items.length > MAX_ITEMS_IN_CONTEXT ? `\n(e mais ${reading.items.length - MAX_ITEMS_IN_CONTEXT} itens)` : "";
  return [
    `[Nota fiscal anexada pela pessoa: "${fileName}". Leitura automática da nota:`,
    `Fornecedor: ${reading.supplier || "não identificado"}`,
    `NF: ${reading.invoice_number || "não identificada"}`,
    reading.issue_date ? `Emissão: ${reading.issue_date}` : "",
    reading.notes ? `Observações da nota: ${reading.notes}` : "",
    lines.length ? `Itens:\n${lines.join("\n")}${extra}` : "Itens: nenhum item legível.",
    "Se a pessoa quer avisar este envio, monte com rascunho_envio usando estes dados: item encontrado no estoque vai com o código do estoque; item não encontrado vai só com o nome (código a definir). A nota já vai anexada ao aviso.]",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Anexos para o rascunho de envio: os desta mensagem ou os da última mensagem que trouxe anexo. */
export function attachmentsForDraft(current: AgentAttachment[] | undefined, history: Array<{ role: string; attachments?: AgentAttachment[] }>) {
  if (current?.length) return current;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role === "user" && message.attachments?.length) return message.attachments;
  }
  return [];
}
