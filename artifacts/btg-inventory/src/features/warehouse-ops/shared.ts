/** Shared catalog/photo helpers for warehouse-ops features. */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "@/lib/firebase";
import {
  type AnyRecord,
  coerceText,
  fetchJson,
} from "@/lib/warehouse-ops/model";

export type ProductPhoto = {
  fileName: string;
  fileUrl: string;
  storagePath: string;
};

export type ProductPhotoUploadTarget = {
  upload_url: string;
  upload_headers?: Record<string, string>;
  file_url: string;
  storage_path: string;
  file_name?: string;
};

export type ProductLookupItem = {
  id: string;
  skuCode: string;
  clientCode: string;
  productName: string;
  unitCost: number;
  hasSku: boolean;
  source: AnyRecord;
};

export type OperationalException = {
  id: string;
  taskUid: string;
  taskType: string;
  taskId: string;
  reference: string;
  note: string;
  severity: string;
  status: string;
  customerCode: string;
  createdAt?: string;
  resolvedAt?: string;
  resolution?: string;
};

/**
 * Autoriza o caminho via Function e envia o arquivo com o SDK autenticado.
 * Evita PUT com signed URL no browser (CORS / assinatura de headers).
 */
export async function uploadProductPhoto(file: File, clientItemCode: string) {
  if (!firebaseStorage) {
    throw new Error("Firebase Storage não está configurado neste ambiente.");
  }
  if (!file.size) {
    throw new Error("Arquivo de foto vazio.");
  }

  const contentType = file.type || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error("Somente imagens podem ser anexadas ao produto.");
  }

  const target = await fetchJson<ProductPhotoUploadTarget>(
    "/api/products/photo-upload-target",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_code: "BTG Pactual",
        client_item_code: clientItemCode,
        file_name: file.name,
        content_type: contentType,
        size_bytes: file.size,
      }),
    },
  );

  if (!target.storage_path) {
    throw new Error("Servidor não retornou destino de upload da foto.");
  }

  const objectRef = ref(firebaseStorage, target.storage_path);

  // Não enviar firebaseStorageDownloadTokens como customMetadata: a chave é
  // reservada e o Storage de produção rejeita o upload com 400
  // (storage/unknown). O token de download é gerado pelo servidor e obtido
  // via getDownloadURL após o upload.
  let fileUrl: string;
  try {
    await uploadBytes(objectRef, file, { contentType });
    fileUrl = await getDownloadURL(objectRef);
  } catch (error) {
    const storageError = error as {
      status?: number;
      customData?: { serverResponse?: string | null };
    };
    const serverResponse = storageError.customData?.serverResponse;
    const detail = [
      error instanceof Error && error.message
        ? error.message
        : "falha desconhecida no Storage",
      storageError.status ? `HTTP ${storageError.status}` : undefined,
      serverResponse ? `resposta: ${serverResponse.slice(0, 300)}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
    console.error("uploadProductPhoto falhou", {
      status: storageError.status,
      serverResponse,
      storagePath: target.storage_path,
      error,
    });
    throw new Error(`Não foi possível enviar a foto do produto (${detail}).`);
  }

  return {
    fileName: target.file_name || file.name,
    fileUrl,
    storagePath: target.storage_path,
  } satisfies ProductPhoto;
}

export function productLookupFromRecord(
  record: AnyRecord,
  index: number,
): ProductLookupItem {
  const id = coerceText(
    record.id,
    record.product_id,
    record.sku_code,
    record.cod_sku,
    index,
  );
  const unitCost = Number(
    record.unit_cost ?? record.preco_unit ?? record.custo_unit ?? 0,
  );
  const explicitSkuCode = coerceText(
    record.sku_code,
    record.cod_sku,
    record.cod_btg,
    record.sku,
  );
  return {
    id,
    skuCode: explicitSkuCode,
    clientCode: coerceText(
      record.client_item_code,
      record.cod_cliente,
      record.product_code,
      record.codigo_cliente,
    ),
    productName: coerceText(
      record.product_name,
      record.produto,
      record.name,
      record.descricao,
    ),
    unitCost: Number.isFinite(unitCost) ? unitCost : 0,
    hasSku: Boolean(explicitSkuCode),
    source: record,
  };
}
