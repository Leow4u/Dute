import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { recordOwner } from "./customer-scope.js";

/**
 * Duas coisas que o portal do cliente lê de client_inventory e que a projeção
 * operacional não gravava:
 * - o estoque mínimo da ficha (skus.estoque_minimo), para "Baixo estoque";
 * - o arquivamento pelo cliente de item zerado, que antes só escondia o
 *   card até recarregar a página.
 * Os campos são próprios (estoque_minimo, client_archived*): as gravações da
 * projeção usam merge e não os apagam.
 */

export type ClientInventoryActor = {
  uid: string;
  role: string;
  customer_code?: string;
  email?: string;
  name?: string;
};

export type SetClientItemArchivedInput = {
  inventory_id: string;
  archived: boolean;
};

export type SetClientItemArchivedResult = {
  ok: true;
  inventory_id: string;
  archived: boolean;
  changed: boolean;
};

// Cliente arquiva o próprio item; administração e coordenação também podem
// (atendendo um pedido da BTG). Operação WMS e financeiro não.
const INTERNAL_ARCHIVERS = ["owner", "admin", "interno"];

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setClientItemArchivedTransaction(
  db: Firestore,
  input: SetClientItemArchivedInput,
  actor: ClientInventoryActor,
): Promise<SetClientItemArchivedResult> {
  const isClient = actor.role === "cliente";
  if (!isClient && !INTERNAL_ARCHIVERS.includes(actor.role)) {
    throw new HttpsError("permission-denied", "Perfil sem permissão para arquivar itens do cliente.");
  }
  const id = String(input.inventory_id ?? "").trim();
  if (!id || id.includes("/")) {
    throw new HttpsError("invalid-argument", "Item inválido.");
  }
  const ref = db.collection("client_inventory").doc(id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Item não encontrado.");
    const item = snapshot.data() ?? {};
    const customerCode = String(item.customer_code ?? "");
    if (isClient && (!actor.customer_code || actor.customer_code !== customerCode)) {
      throw new HttpsError("permission-denied", "Item de outro cliente.");
    }
    if (input.archived && (num(item.qty_on_hand) > 0 || num(item.qty_reserved) > 0)) {
      throw new HttpsError(
        "failed-precondition",
        "Só dá para arquivar item sem saldo e sem reserva.",
      );
    }

    const current = item.client_archived === true;
    if (current === input.archived) {
      return { ok: true, inventory_id: id, archived: input.archived, changed: false };
    }

    const now = new Date().toISOString();
    transaction.update(ref, {
      client_archived: input.archived,
      client_archived_at: input.archived ? now : FieldValue.delete(),
      client_archived_by: input.archived ? actor.uid : FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    });
    const eventRef = db.collection("events").doc();
    const label = String(item.client_item_code ?? item.sku_code ?? id);
    transaction.create(eventRef, {
      id: eventRef.id,
      type: input.archived ? "client_inventory.archived" : "client_inventory.restored",
      title: input.archived ? "Item arquivado pelo cliente" : "Item devolvido à vitrine",
      description: `${label} · ${String(item.product_name ?? "")}`.trim(),
      severity: "info",
      entity_type: "client_inventory",
      entity_id: id,
      customer_code: customerCode,
      payload: {
        sku_code: item.sku_code ?? null,
        client_item_code: item.client_item_code ?? null,
      },
      occurred_at: now,
      source: "functions_client_inventory",
      actor: {
        uid: actor.uid,
        role: actor.role,
        email: actor.email ?? null,
        name: actor.name ?? null,
        customer_code: actor.customer_code ?? null,
      },
      created_at: FieldValue.serverTimestamp(),
    });
    return { ok: true, inventory_id: id, archived: input.archived, changed: true };
  });
}

/**
 * Lê as projeções do SKU. Chamar antes de qualquer escrita da transação
 * (o Firestore exige leituras primeiro).
 */
export async function readClientInventoryForSku(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
  skuCode: string,
) {
  if (!skuCode) return [];
  const snapshot = await transaction.get(
    db
      .collection("client_inventory")
      .where("customer_code", "==", customerCode)
      .where("sku_code", "==", skuCode),
  );
  return snapshot.docs.map((document) => document.ref);
}

/**
 * Projeções do SKU no portal do dono dele: `customer_code` da ficha, a BTG só
 * para registro antigo sem o campo (recordOwner). Mesma regra de leitura
 * antes das escritas.
 */
export async function readClientInventoryForSkuRecord(
  transaction: Transaction,
  db: Firestore,
  sku: Record<string, unknown>,
  documentId: string,
) {
  return readClientInventoryForSku(
    transaction,
    db,
    recordOwner(sku),
    String(sku.cod_btg ?? sku.sku_code ?? documentId),
  );
}

/** Leva o mínimo da ficha para o portal; null apaga. */
export function projectMinimumStock(
  transaction: Transaction,
  refs: DocumentReference[],
  minimum: number | null,
) {
  for (const ref of refs) {
    transaction.update(ref, {
      estoque_minimo: minimum === null ? FieldValue.delete() : minimum,
      updated_at: FieldValue.serverTimestamp(),
    });
  }
}
