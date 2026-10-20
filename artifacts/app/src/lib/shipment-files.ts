import { ATTACHMENT_MAX_BYTES, ACCEPTED_TYPES, SOURCE_MAX_BYTES } from "@/lib/attachment-compact";
import { fileToBase64 } from "@/lib/file-base64";
import type { ClientRequestAttachment } from "@/pages/client/shared";

export { ATTACHMENT_MAX_BYTES, AttachmentRejected, prepareAttachment } from "@/lib/attachment-compact";

/**
 * Nota e anexos de envio (tela Envios e chat do Agent Dute): PDF ou imagem,
 * até 15 MB depois de reduzido no navegador (ver attachment-compact.ts). O
 * arquivo sobe pelo backend, que grava no Storage na pasta do cliente.
 */

export const ATTACHMENT_ACCEPT = ACCEPTED_TYPES.join(",");

/** Texto do aviso quando algum arquivo fica de fora. */
export const ATTACHMENT_LIMIT_HINT = "até 15 MB";

/**
 * Filtro rápido na escolha do arquivo: só o tipo e um teto generoso. O
 * tamanho final é decidido por prepareAttachment, que reduz scans grandes.
 */
export function isAcceptedAttachment(file: File) {
  return file.size > 0 && file.size <= SOURCE_MAX_BYTES && (ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

export async function uploadAttachment(file: File, entityId: string): Promise<ClientRequestAttachment> {
  if (file.size > ATTACHMENT_MAX_BYTES) throw new Error("Arquivo grande demais. Use até 15 MB.");
  const response = await fetch("/api/client/shipments/attachments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file_name: file.name,
      content_type: file.type,
      data_base64: await fileToBase64(file),
      entity_id: entityId,
    }),
  });
  const payload = (await response.json().catch(() => null)) as (ClientRequestAttachment & { message?: string }) | null;
  if (!response.ok || !payload?.storage_path) throw new Error(payload?.message || `Falha ao enviar ${file.name}.`);
  return {
    file_name: payload.file_name,
    file_url: payload.file_url,
    storage_path: payload.storage_path,
    content_type: payload.content_type,
    size_bytes: payload.size_bytes,
  };
}
