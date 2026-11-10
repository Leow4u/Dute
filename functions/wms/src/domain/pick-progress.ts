import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import {
  advanceWarehouseTaskTransaction,
  assertInventoryOperationsEnabled,
  createEvent,
  type OperationalActor,
} from "./operations.js";

/**
 * Separar com o progresso salvo (docs/plataforma/separacao-com-caixas.md,
 * seção 4.2, parte 2a; decisão 9 de 10/11/2026). O pedido da BTG leva dias
 * para separar: cada linha separada fica gravada na hora, a pessoa para e
 * continua depois, e outra pessoa pode continuar.
 *
 * - `setPickLineSeparated` marca ou desmarca uma linha como separada. A
 *   primeira linha começa a separação (a tarefa vai a `in_progress` pela
 *   porta de sempre, `advanceWarehouseTaskTransaction`, com o evento e o
 *   "Em separação" do portal).
 * - `completeOrderSeparation` conclui a separação e a embalagem numa chamada:
 *   as mesmas transições que a tela encadeava (separação concluída, embalagem
 *   iniciada e fechada com o lacre), na mesma ordem e pela mesma porta.
 *
 * O progresso é só o registro de quem separou o quê: mora na linha
 * (`separated_qty`, `separated_at`, `separated_by`), sem tocar a reserva, o
 * saldo nem o `qty_picked`, que continuam mudando só na conclusão. A linha
 * com progresso é o que a contagem cíclica consulta para não contar a
 * prateleira de onde o item já saiu (operations.ts, recordCycleCount).
 */

export const PICK_TASKS_COLLECTION = "pick_tasks";
export const PICK_LINES_COLLECTION = "pick_lines";
const PACK_TASKS_COLLECTION = "pack_tasks";
const ORDER_ITEMS_COLLECTION = "order_items";
const OPERATIONS_COLLECTION = "operational_operations";
const EVENT_SOURCE = "functions_wms";

type Row = Record<string, unknown>;

const id = z.string().trim().min(1).max(300);
const idempotencyKey = z.string().trim().min(8).max(200);

export const SetPickLineSeparatedSchema = z
  .object({
    pick_task_id: id,
    pick_line_id: id,
    /** true separa a linha; false desfaz. */
    separated: z.boolean(),
    idempotency_key: idempotencyKey,
  })
  .strict();

export const CompleteOrderSeparationSchema = z
  .object({
    pick_task_id: id,
    seal_code: z.string().trim().min(1).max(60),
    /**
     * Separar a menos (pergunta 59): só a coordenação informa menos que o
     * pedido numa linha, com o motivo. A regra é a de sempre (short-pick.ts),
     * conferida na conclusão da separação.
     */
    short_lines: z
      .array(
        z
          .object({
            pick_line_id: id,
            qty_picked: z.number().nonnegative(),
            shortage_reason: z.string().trim().min(1).max(40),
            shortage_detail: z.string().trim().max(300).optional(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    idempotency_key: idempotencyKey,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Entrada inválida para a separação.", { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }
  return parsed.data;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Row)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
}

/** Tira as chaves sem valor, só no primeiro nível (mantém o serverTimestamp). */
function clean<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function actorFields(actor: OperationalActor) {
  return clean({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name });
}

/** A linha da separação com o que o progresso precisa. */
export type LinhaDoProgresso = {
  id: string;
  /** O nome do produto, ou o SKU, para a mensagem. */
  produto: string;
  /** O que o pedido pede na linha. */
  pedido: number;
  /** O que já foi separado e gravado; null sem progresso. */
  separado: number | null;
};

export type LinhaAMenos = {
  pick_line_id: string;
  qty_picked: number;
  shortage_reason: string;
  shortage_detail?: string;
};

/** A linha como a conclusão da separação a recebe (operations.ts, `picking_lines`). */
export type LinhaConferida = {
  pick_line_id: string;
  qty_picked: number;
  status: "confirmed";
  shortage_reason?: string;
  shortage_detail?: string;
};

/** "10 de 116 itens · 665 de 3.335 un.": o que a bancada e a fila mostram. */
export function progressoDaSeparacao(linhas: readonly LinhaDoProgresso[]) {
  const separadas = linhas.filter((linha) => linha.separado !== null);
  return {
    lines: linhas.length,
    separated_lines: separadas.length,
    units: linhas.reduce((soma, linha) => soma + linha.pedido, 0),
    separated_units: separadas.reduce((soma, linha) => soma + (linha.separado ?? 0), 0),
  };
}

/**
 * As linhas para concluir a separação: cada uma com o separado gravado, ou
 * com o que a coordenação informou a menos. A linha que ninguém tratou barra
 * a conclusão. Quem pode separar a menos, e com que motivo, é a regra de
 * sempre, conferida adiante (conferirSeparacao).
 */
export function linhasParaConcluir(linhas: readonly LinhaDoProgresso[], aMenos: readonly LinhaAMenos[] = []): LinhaConferida[] {
  const porLinha = new Map(aMenos.map((linha) => [linha.pick_line_id, linha]));
  const conhecidas = new Set(linhas.map((linha) => linha.id));
  const estranha = aMenos.find((linha) => !conhecidas.has(linha.pick_line_id));
  if (estranha) {
    throw new HttpsError("invalid-argument", `A linha ${estranha.pick_line_id} não é deste pedido.`);
  }
  const semTratar = linhas.filter((linha) => linha.separado === null && !porLinha.has(linha.id));
  if (semTratar.length) {
    throw new HttpsError(
      "failed-precondition",
      semTratar.length === 1 ? `Falta separar 1 item: ${semTratar[0]!.produto}.` : `Faltam ${semTratar.length} itens por separar.`,
      { code: "SEPARATION_PENDING_LINES", pending: semTratar.length },
    );
  }
  return linhas.map((linha) => {
    const informado = porLinha.get(linha.id);
    if (!informado) return { pick_line_id: linha.id, qty_picked: linha.separado ?? 0, status: "confirmed" as const };
    return clean({
      pick_line_id: linha.id,
      qty_picked: informado.qty_picked,
      status: "confirmed" as const,
      shortage_reason: informado.shortage_reason,
      shortage_detail: informado.shortage_detail,
    });
  });
}

function linhaDoProgresso(lineId: string, data: Row): LinhaDoProgresso {
  return {
    id: lineId,
    produto: text(data.product_name) || text(data.sku_code) || lineId,
    pedido: quantity(data.qty_to_pick),
    separado: data.separated_at ? quantity(data.separated_qty) : null,
  };
}

/** A tarefa cancelada ou concluída não aceita mais progresso. */
function assertSeparating(status: string) {
  if (status === "cancelled") throw new HttpsError("failed-precondition", "Pedido cancelado.");
  if (status === "completed") throw new HttpsError("failed-precondition", "A separação deste pedido já foi concluída.");
  if (status !== "in_progress") throw new HttpsError("failed-precondition", "A separação ainda não começou. Atualize e tente de novo.");
}

/** A outra pessoa começou a separação no mesmo instante: a tarefa já saiu de planned. */
function jaComecou(error: unknown): boolean {
  return error instanceof HttpsError && error.code === "failed-precondition" && /^Status divergente/.test(error.message);
}

/**
 * Separar (ou desfazer) uma linha do pedido. Idempotente pela chave e pelo
 * estado: separar a linha já separada, ou desfazer a que não está, não muda
 * nada e não grava evento.
 */
export async function setPickLineSeparated(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = parse(SetPickLineSeparatedSchema, raw);
  const taskRef = db.collection(PICK_TASKS_COLLECTION).doc(input.pick_task_id);
  const lineRef = db.collection(PICK_LINES_COLLECTION).doc(input.pick_line_id);
  const opRef = db.collection(OPERATIONS_COLLECTION).doc(`op_pick_line_${digest({ task: input.pick_task_id, line: input.pick_line_id, nonce: input.idempotency_key })}`);
  const inputHash = digest(input, 64);

  // A primeira linha separada começa a separação, pela porta de sempre.
  if (input.separated && !(await opRef.get()).exists) {
    const before = await taskRef.get();
    if (!before.exists) throw new HttpsError("not-found", "Separação não encontrada.");
    if (text(before.get("status")).toLowerCase() === "planned") {
      try {
        await advanceWarehouseTaskTransaction(
          db,
          { task_uid: `picking:${input.pick_task_id}`, expected_status: "planned", idempotency_key: `${input.idempotency_key}:start` },
          actor,
        );
      } catch (error) {
        if (!jaComecou(error)) throw error;
      }
    }
  }

  const occurredAt = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Row;
    }
    await assertInventoryOperationsEnabled(transaction, db);
    const [taskSnapshot, lineSnapshot] = await Promise.all([transaction.get(taskRef), transaction.get(lineRef)]);
    if (!taskSnapshot.exists) throw new HttpsError("not-found", "Separação não encontrada.");
    const task = taskSnapshot.data() ?? {};
    assertSeparating(text(task.status).toLowerCase());
    const line = lineSnapshot.data() ?? {};
    if (!lineSnapshot.exists || text(line.pick_task_id) !== input.pick_task_id) {
      throw new HttpsError("not-found", "Linha da separação não encontrada.");
    }
    if (text(line.status) !== "open") {
      throw new HttpsError("failed-precondition", "A linha já foi concluída.");
    }
    const pedido = quantity(line.qty_to_pick);
    if (!(pedido > 0)) throw new HttpsError("failed-precondition", "Linha da separação sem quantidade.");
    const estava = Boolean(line.separated_at);
    const changed = estava !== input.separated;
    const customerCode = text(task.customer_code) || text(line.customer_code);

    const events: unknown[] = [];
    if (changed) {
      transaction.update(
        lineRef,
        input.separated
          ? { separated_qty: pedido, separated_at: occurredAt, separated_by: actorFields(actor), updated_at: FieldValue.serverTimestamp() }
          : { separated_qty: FieldValue.delete(), separated_at: FieldValue.delete(), separated_by: FieldValue.delete(), updated_at: FieldValue.serverTimestamp() },
      );
      // "em separação desde 10/11": a primeira linha separada data o começo.
      if (input.separated && !task.separation_started_at) {
        transaction.update(taskRef, { separation_started_at: occurredAt, separation_started_by: actorFields(actor), updated_at: FieldValue.serverTimestamp() });
      }
      const produto = text(line.product_name) || text(line.sku_code) || input.pick_line_id;
      const pedidoNumero = text(task.order_number) || text(line.order_number);
      events.push(
        createEvent(
          transaction,
          db,
          `evt_${digest({ operationId: opRef.id, suffix: input.separated ? "line_separated" : "line_unseparated" })}`,
          {
            type: input.separated ? "picking.line_separated" : "picking.line_unseparated",
            title: input.separated ? `Linha separada do pedido ${pedidoNumero}` : `Separação da linha desfeita no pedido ${pedidoNumero}`,
            description: `${pedido} un. de ${produto} · ${text(line.location_id) || "sem endereço"}`,
            severity: "info",
            // Um pedido tem mais de cem linhas: o evento fica na trilha, fora da caixa de avisos.
            inbox: false,
            entity_type: PICK_TASKS_COLLECTION,
            entity_id: input.pick_task_id,
            customer_code: customerCode,
            occurred_at: occurredAt,
            payload: clean({
              order_id: text(task.order_id) || text(line.order_id) || undefined,
              order_number: pedidoNumero || undefined,
              pick_line_id: input.pick_line_id,
              line_number: quantity(line.line_number) || undefined,
              sku_code: text(line.sku_code) || undefined,
              client_item_code: text(line.client_item_code) || undefined,
              location_id: text(line.location_id) || undefined,
              quantity: pedido,
            }),
            source: EVENT_SOURCE,
          },
          actor,
        ),
      );
    }

    const result = clean({
      ok: true,
      pick_task_id: input.pick_task_id,
      pick_line_id: input.pick_line_id,
      separated: input.separated,
      changed,
      separated_qty: input.separated ? pedido : 0,
      separated_at: input.separated ? (changed ? occurredAt : text(line.separated_at)) : undefined,
      events,
    });
    transaction.create(opRef, {
      id: opRef.id,
      kind: input.separated ? "picking.line.separate" : "picking.line.unseparate",
      target_id: input.pick_line_id,
      customer_code: customerCode,
      input_hash: inputHash,
      status: "completed",
      actor: actorFields(actor),
      result,
      created_at: FieldValue.serverTimestamp(),
      completed_at: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

/**
 * Concluir a separação: a separação e a embalagem numa chamada. Cada passo é
 * a transição de sempre, com a chave derivada da chave da chamada; se um passo
 * falha, repetir a chamada continua de onde parou (o passo já feito é pulado
 * pelo status).
 */
export async function completeOrderSeparation(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = parse(CompleteOrderSeparationSchema, raw);
  const taskRef = db.collection(PICK_TASKS_COLLECTION).doc(input.pick_task_id);
  const taskSnapshot = await taskRef.get();
  if (!taskSnapshot.exists) throw new HttpsError("not-found", "Separação não encontrada.");
  const task = taskSnapshot.data() ?? {};
  const orderId = text(task.order_id);
  const status = text(task.status).toLowerCase();
  if (status === "cancelled") throw new HttpsError("failed-precondition", "Pedido cancelado.");
  if (status === "planned") throw new HttpsError("failed-precondition", "A separação ainda não começou.");
  if (!orderId) throw new HttpsError("failed-precondition", "Separação sem pedido válido.");
  const step = (name: string) => `${input.idempotency_key}:${name}`;

  if (status === "in_progress") {
    const lines = await db.collection(PICK_LINES_COLLECTION).where("pick_task_id", "==", input.pick_task_id).get();
    const conferidas = linhasParaConcluir(
      lines.docs.map((doc) => linhaDoProgresso(doc.id, doc.data())),
      input.short_lines ?? [],
    );
    await advanceWarehouseTaskTransaction(
      db,
      { task_uid: `picking:${input.pick_task_id}`, expected_status: "in_progress", idempotency_key: step("picking"), operation: { picking_lines: conferidas } },
      actor,
    );
  }

  // A embalagem nasce quando a separação termina.
  const packs = await db.collection(PACK_TASKS_COLLECTION).where("order_id", "==", orderId).get();
  const pack = packs.docs.find((doc) => text(doc.get("status")).toLowerCase() !== "cancelled");
  if (!pack) throw new HttpsError("failed-precondition", "A embalagem do pedido não foi criada. Atualize e tente de novo.");
  const packUid = `packing:${pack.id}`;
  let packStatus = text(pack.get("status")).toLowerCase();
  if (packStatus === "ready") {
    try {
      await advanceWarehouseTaskTransaction(db, { task_uid: packUid, expected_status: "ready", idempotency_key: step("packing-start") }, actor);
    } catch (error) {
      if (!jaComecou(error)) throw error;
    }
    packStatus = "in_progress";
  }
  let shipmentId = text(pack.get("shipment_id")) || undefined;
  if (packStatus === "in_progress") {
    // O item que a separação a menos zerou não se embala.
    const items = await db.collection(ORDER_ITEMS_COLLECTION).where("order_id", "==", orderId).get();
    const packingLines = items.docs
      .map((doc) => ({ order_item_id: doc.id, qty_packed: quantity(doc.get("picked_qty")), status: "confirmed" }))
      .filter((line) => line.qty_packed > 0);
    const packed = (await advanceWarehouseTaskTransaction(
      db,
      {
        task_uid: packUid,
        expected_status: "in_progress",
        idempotency_key: step("packing"),
        operation: { packing_lines: packingLines, package_count: 1, volume_label: "VOL-1", seal_code: input.seal_code },
      },
      actor,
    )) as Row;
    shipmentId = text(packed.shipment_id) || shipmentId;
  }

  return clean({
    ok: true,
    pick_task_id: input.pick_task_id,
    order_id: orderId,
    pack_task_id: pack.id,
    shipment_id: shipmentId,
    seal_code: input.seal_code,
  });
}
