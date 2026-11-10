import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { BOX_STATUS_STORED } from "./box-balance.js";
import { createEvent, type OperationalActor } from "./operations.js";
import { WAREHOUSE_BOXES_COLLECTION } from "./warehouse-boxes.js";

/**
 * Etiquetas para trocar (docs/plataforma/separacao-com-caixas.md, seção 4.3,
 * parte 3d; decisão 3 de 10/11/2026). A caixa de onde a separação tirou
 * peça fica com a etiqueta velha: ela entra em "Etiquetas para trocar" até a
 * impressão da etiqueta com o saldo ser registrada.
 *
 * `recordBoxBalanceLabelPrint` é o registro do clique em "Imprimir", como o
 * da caixa do recebimento (inbound-boxes.ts, recordInboundBoxLabelPrint): a
 * caixa guarda para qual saldo a etiqueta saiu (`balance_label_printed_for`,
 * o `balance_at` daquele momento). Quando o saldo muda de novo, a etiqueta
 * impressa deixa de valer e a caixa volta à lista. Não é escrita de saldo:
 * não confere o congelamento do estoque.
 */

const OPERATIONS_COLLECTION = "operational_operations";
const EVENT_SOURCE = "functions_wms";

/** Quantas caixas uma impressão registra: a folha de etiquetas de um pedido grande. */
export const CAIXAS_POR_IMPRESSAO = 100;

export const RecordBoxBalanceLabelPrintSchema = z
  .object({
    box_codes: z.array(z.string().trim().min(1).max(40)).min(1).max(CAIXAS_POR_IMPRESSAO),
    idempotency_key: z.string().trim().min(8).max(200),
  })
  .strict();

type Row = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function clean<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** A caixa aberta: guardada, com saída registrada e ainda com saldo. */
export function caixaAberta(box: Row): boolean {
  return text(box.status) === BOX_STATUS_STORED && quantity(box.taken_units) > 0;
}

/** A etiqueta que está na caixa não é a do saldo de agora. */
export function etiquetaParaTrocar(box: Row): boolean {
  return caixaAberta(box) && text(box.balance_label_printed_for) !== text(box.balance_at);
}

/**
 * Registra a impressão da etiqueta com o saldo das caixas abertas. A caixa
 * que não está aberta (intacta, vazia ou ainda sem prateleira) não registra:
 * a lista de quem imprime pode estar atrás do que outra pessoa acabou de
 * separar, e a etiqueta dela não muda.
 */
export async function recordBoxBalanceLabelPrint(db: Firestore, raw: unknown, actor: OperationalActor) {
  const parsed = RecordBoxBalanceLabelPrintSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Entrada inválida para registrar a etiqueta.", { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }
  const codes = [...new Set(parsed.data.box_codes.map((code) => code.toUpperCase()))].sort();
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_box_relabel_${digest({ codes, nonce: parsed.data.idempotency_key })}`);
  const inputHash = digest({ box_codes: codes, idempotency_key: parsed.data.idempotency_key }, 64);
  const occurredAt = new Date().toISOString();
  const by = clean({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name });

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Row;
    }
    const snapshots = await Promise.all(codes.map((code) => transaction.get(db.collection(WAREHOUSE_BOXES_COLLECTION).doc(code))));
    const printed: string[] = [];
    const skipped: string[] = [];
    const events: unknown[] = [];
    snapshots.forEach((snapshot, index) => {
      const code = codes[index]!;
      if (!snapshot.exists) throw new HttpsError("not-found", `Caixa ${code} não encontrada.`);
      const box = snapshot.data() ?? {};
      if (!caixaAberta(box)) {
        skipped.push(code);
        return;
      }
      const count = quantity(box.balance_label_print_count) + 1;
      const balanceAt = text(box.balance_at);
      const balance = Math.max(0, quantity(box.unit_count) - quantity(box.taken_units));
      const location = text(box.location_id);
      transaction.update(snapshot.ref, {
        balance_label_printed_at: occurredAt,
        balance_label_printed_for: balanceAt,
        balance_label_printed_by: by,
        balance_label_print_count: count,
        updated_at: FieldValue.serverTimestamp(),
      });
      printed.push(code);
      events.push(
        createEvent(
          transaction,
          db,
          `evt_${digest({ operationId: opRef.id, suffix: "box_balance_label_printed", box: code })}`,
          {
            type: "warehouse.box_balance_label_printed",
            title: `Etiqueta da caixa ${code} trocada · ${location || "sem posição"}`,
            description: `Etiqueta com o saldo de ${balance} un.${count > 1 ? ` · impressão ${count}` : ""}`,
            severity: "info",
            // Um pedido grande abre dezenas de caixas: o evento fica na trilha, fora da caixa de avisos.
            inbox: false,
            entity_type: WAREHOUSE_BOXES_COLLECTION,
            entity_id: code,
            customer_code: text(box.customer_code),
            occurred_at: occurredAt,
            payload: clean({ box_code: code, location_id: location || undefined, balance_units: balance, balance_at: balanceAt || undefined, print_count: count }),
            source: EVENT_SOURCE,
          },
          actor,
        ),
      );
    });

    const result = { ok: true, printed, skipped, printed_at: occurredAt, events };
    transaction.create(opRef, {
      id: opRef.id,
      kind: "warehouse.box.balance_label_print",
      target_id: codes[0],
      customer_code: text(snapshots[0]?.get("customer_code")),
      input_hash: inputHash,
      status: "completed",
      actor: by,
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}
