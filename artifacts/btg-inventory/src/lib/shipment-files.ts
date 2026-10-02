import { fileToBase64 } from "@/lib/file-base64";
import type { ClientRequestAttachment } from "@/pages/client/shared";

/**
 * Nota e anexos de envio (tela Envios e chat do Agent Dute): PDF ou imagem,
 * até 8 MB. O arquivo sobe pelo backend, que grava no Storage na pasta do
 * cliente.
 */

export const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export function isAcceptedAttachment(file: File) {
  return (
    file.size > 0 &&
    file.size <= 8 * 1024 * 1024 &&
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)
  );
}

export async function uploadAttachment(file: File, entityId: string): Promise<ClientRequestAttachment> {
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
