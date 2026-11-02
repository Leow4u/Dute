import { createHash } from "node:crypto";

import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { recordOwner } from "./customer-scope.js";
import { conferenceModeOf } from "./inbound-mode.js";
import {
  assertInventoryOperationsEnabled,
  createEvent,
  type OperationalActor,
  type OperationalEventInput,
  type OperationalEventSummary,
} from "./operations.js";
import {
  BOX_COUNTER_DOC,
  BOX_EDITOR_ROLES,
  CreateWarehouseBoxSchema,
  SuggestWarehousePositionSchema,
  WAREHOUSE_BOXES_COLLECTION,
  WAREHOUSE_COUNTERS_COLLECTION,
  asPosition,
  buildOccupancy,
  emptyOccupancy,
  formatBoxCode,
  placementFor,
  requireDimensions,
  suggestPosition,
  type BoxDimensions,
  type SlottingPosition,
} from "./warehouse-boxes.js";
import { WAREHOUSE_POSITIONS_COLLECTION } from "./warehouse-positions.js";

/**
 * A caixa do recebimento (docs/plataforma/recebimento-com-caixas.md, seções
 * 4.3 e 4.9; parte 3 da seção 5).
 *
 * Na chegada por caixa (`conference_mode: per_box`, domain/inbound-mode.ts),
 * a bancada abre a caixa do fornecedor, lança o que tem dentro (as linhas da
 * NF), fecha com as medidas e o peso, pede a prateleira ao motor e confirma o
 * destino, que fica reservado com a caixa em `committing`. A guarda que leva a
 * caixa a `stored` e a entrada no estoque são da parte 4; a etiqueta, da 6.
 *
 * Regras deste módulo:
 * - A chegada manda: cliente, modo e status vêm do documento dela, que é lido
 *   em toda escrita e nunca escrito (a API REST v1 confere a chegada pelo
 *   updateTime dela). Só a chegada por caixa, a conferir ou em conferência,
 *   aceita caixa. A liberação do ambiente não é lida aqui: ela rege só a
 *   criação da chegada.
 * - O motor de posições (domain/warehouse-boxes.ts) é usado como está, com o
 *   encaixe estrito: a tolerância e a sessão da contagem de abertura não
 *   entram, e nada da abertura é chamado.
 * - O conteúdo mora na própria caixa (`lines[]`, até 100), com os contadores
 *   de rascunho (`draft_line_count`, `draft_unit_count`), como na abertura:
 *   `line_count`, `unit_count` e `sku_codes` continuam dizendo o que já está
 *   no estoque e só sobem na guarda (parte 4). A linha da NF guarda quanto já
 *   foi posto em caixas (`boxed_qty`) e em quais (`box_codes`).
 * - Toda escrita confere o congelamento do estoque, tem recibo de
 *   idempotência (operational_operations) e grava evento em `events`, sempre
 *   `info` e fora da caixa de entrada do agente.
 */

const MAX_LINES = 100;
const OPERATIONS_COLLECTION = "operational_operations";
const INBOUND_RECEIPTS_COLLECTION = "inbound_receipts";
const INBOUND_ITEMS_COLLECTION = "inbound_items";
const RECEIVING_AREA = "RECEBIMENTO";
const EVENT_SOURCE = "functions_inbound_boxes";

type Row = Record<string, unknown>;

export type InboundBoxLine = {
  inbound_item_id: string;
  line_number: number;
  sku_code: string;
  client_item_code: string;
  product_name: string;
  size: string | null;
  counted_qty: number;
};

// ------------------------------------------------------------------ entrada

const identity = (missing: string) =>
  z
    .string({ required_error: missing })
    .trim()
    .min(1, missing)
    .max(200, "Identificador inválido.")
    .refine((value) => !value.includes("/"), "Identificador inválido.");
const operationKey = identity("Chave da operação ausente. Atualize a tela e tente de novo.");
const boxCodeField = z.string().trim().toUpperCase().regex(/^CX-\d{6,}$/, "Caixa inválida.");
const positionField = SuggestWarehousePositionSchema.shape.location_id.unwrap();
const receiptFields = {
  /** O cliente ativo da tela; só serve para recusar a chegada de outro cliente. */
  customer_code: z.string().trim().max(160).optional(),
  receipt_id: identity("Informe a chegada."),
};
const mutationFields = {
  ...receiptFields,
  box_code: boxCodeField,
  expected_revision: z.number().int().nonnegative(),
  idempotency_key: operationKey,
};

export const StartInboundBoxSchema = z.object({ ...receiptFields, idempotency_key: operationKey });

export const SaveInboundBoxLineSchema = z.object({
  ...mutationFields,
  inbound_item_id: identity("Informe a linha da NF."),
  /** Quantidade contada desta linha da NF nesta caixa; 0 tira o produto da caixa. */
  counted_qty: z.number().finite().min(0, "Quantidade inválida.").max(1_000_000, "Quantidade inválida."),
});

const closeMeasures = CreateWarehouseBoxSchema.pick({
  length_m: true,
  width_m: true,
  height_m: true,
  allow_tilt: true,
  allow_stacking: true,
}).shape;

export const SetInboundBoxStateSchema = z.discriminatedUnion("action", [
  z.object({
    ...mutationFields,
    action: z.literal("close"),
    ...closeMeasures,
    gross_weight_kg: z.coerce
      .number({ invalid_type_error: "Informe o peso da caixa na balança, em quilos." })
      .positive("Informe o peso da caixa na balança, em quilos.")
      .max(100_000, "Informe o peso da caixa na balança, em quilos."),
  }),
  z.object({ ...mutationFields, action: z.literal("reopen") }),
]);

export const SuggestInboundBoxPositionSchema = z.object({
  ...receiptFields,
  box_code: boxCodeField,
  /** Prévia de uma prateleira da zona, sem escolher outra. */
  location_id: positionField.optional(),
  exclude: z.array(positionField).max(20).optional(),
});

export const RefuseInboundBoxPositionSchema = z.object({
  ...mutationFields,
  position: positionField,
  reason: z.string().trim().min(1, "Informe o motivo da recusa.").max(300, "Motivo da recusa muito longo."),
});

export const ConfirmInboundBoxDestinationSchema = z.object({
  ...mutationFields,
  location_id: positionField,
  orientation: CreateWarehouseBoxSchema.shape.orientation,
  support_box_code: CreateWarehouseBoxSchema.shape.support_box_code,
  suggestion: z
    .object({
      position: positionField.nullable().optional(),
      reason: z.string().trim().max(300).nullable().optional(),
      alternatives: z.array(positionField).max(5).optional(),
      tier: z.number().int().min(1).max(3).optional(),
    })
    .optional(),
});

export const RemoveInboundBoxSchema = z.object(mutationFields);

/** Valida a entrada com a frase do esquema. O ZodError cru viraria INTERNAL na callable. */
function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw ?? {});
  if (result.success) return result.data as z.output<S>;
  const issue = result.error.issues[0];
  const generic = !issue || /^(Required|Expected|Invalid|Number must|String must)/.test(issue.message);
  const field = issue?.path.join(".") || "entrada";
  throw new HttpsError("invalid-argument", generic ? `Campo inválido: ${field}.` : issue.message);
}

// ------------------------------------------------------------------ apoio

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Row)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, length);
}

function centimeters(value: number) {
  return `${Math.round(value * 100)}`;
}

function describeBox(box: BoxDimensions) {
  const size = `${centimeters(box.length_m)} × ${centimeters(box.width_m)} × ${centimeters(box.height_m)} cm`;
  return box.gross_weight_kg != null ? `${size}, ${round(box.gross_weight_kg, 1)} kg` : size;
}

function actorFields(actor: OperationalActor) {
  return clean({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name, customer_code: actor.customer_code });
}

function requireEditor(actor: OperationalActor) {
  if (!(BOX_EDITOR_ROLES as readonly string[]).includes(actor.role)) {
    throw new HttpsError("permission-denied", "Caixas do armazém: somente administração ou operação de armazém.");
  }
}

function revision(box: Row, expected: number) {
  if (Number(box.conference_revision ?? 0) !== expected) {
    throw new HttpsError("aborted", "A caixa mudou em outra tela. Atualize antes de continuar.", {
      code: "CONFERENCE_REVISION_CONFLICT",
    });
  }
}

function linesOf(box: Row): InboundBoxLine[] {
  return Array.isArray(box.lines) ? (box.lines as InboundBoxLine[]) : [];
}

function dimensionsOf(box: Row): BoxDimensions {
  return {
    length_m: Number(box.length_m),
    width_m: Number(box.width_m),
    height_m: Number(box.height_m),
    gross_weight_kg: box.gross_weight_kg == null ? null : Number(box.gross_weight_kg),
  };
}

function refusedPositions(box: Row): string[] {
  const refusals = Array.isArray(box.refusals) ? (box.refusals as Row[]) : [];
  return refusals.map((refusal) => text(refusal.position).toUpperCase()).filter(Boolean);
}

// ------------------------------------------------------------- regras puras

/**
 * O conteúdo da caixa depois de lançar uma linha da NF: substitui no lugar a
 * linha do mesmo item, acrescenta no fim, ou tira com quantidade 0.
 */
export function boxContentWith(lines: InboundBoxLine[], next: InboundBoxLine) {
  const index = lines.findIndex((line) => line.inbound_item_id === next.inbound_item_id);
  const previousQty = index >= 0 ? Number(lines[index]!.counted_qty) || 0 : 0;
  let nextLines: InboundBoxLine[];
  if (next.counted_qty <= 0) {
    if (index < 0) throw new HttpsError("not-found", "Este produto não está nesta caixa.");
    nextLines = lines.filter((_, position) => position !== index);
  } else if (index >= 0) {
    nextLines = lines.map((line, position) => (position === index ? next : line));
  } else {
    if (lines.length >= MAX_LINES) {
      throw new HttpsError("failed-precondition", "Limite de 100 produtos por caixa. Inicie outra caixa.");
    }
    nextLines = [...lines, next];
  }
  return {
    lines: nextLines,
    draft_line_count: nextLines.length,
    draft_unit_count: round(nextLines.reduce((sum, line) => sum + (Number(line.counted_qty) || 0), 0)),
    previous_qty: previousQty,
  };
}

/**
 * A chegada aceita caixa? Só a chegada por caixa, a conferir ou em
 * conferência, do cliente ativo. Nunca lê a liberação: o modo gravado manda.
 * Devolve o cliente da chegada.
 */
export function assertReceiptTakesBoxes(receipt: Row, selectedCustomer?: string): string {
  const owner = recordOwner(receipt);
  const selected = text(selectedCustomer);
  if (selected && selected !== owner) {
    throw new HttpsError("permission-denied", `Chegada de outro cliente. Troque o cliente ativo para ${owner}.`);
  }
  const receiptNumber = text(receipt.receipt_number || receipt.id);
  if (conferenceModeOf(receipt) !== "per_box") {
    throw new HttpsError(
      "failed-precondition",
      `A chegada ${receiptNumber} é conferida por linha: use a conferência da chegada.`,
      { code: "RECEIPT_CONFERRED_PER_LINE" },
    );
  }
  const status = text(receipt.status || "created").toLowerCase();
  if (!["created", "checking"].includes(status)) {
    throw new HttpsError(
      "failed-precondition",
      `A chegada ${receiptNumber} não está em conferência (${status}): as caixas dela não mudam.`,
      { code: "RECEIPT_NOT_OPEN" },
    );
  }
  return owner;
}

// ---------------------------------------------------------------- leituras

function receiptFrom(snapshot: DocumentSnapshot): Row {
  if (!snapshot.exists) throw new HttpsError("not-found", "Chegada não encontrada.");
  return { id: snapshot.id, ...(snapshot.data() ?? {}) };
}

function boxFrom(snapshot: DocumentSnapshot, boxCode: string, receiptId: string, owner: string): Row {
  if (!snapshot.exists) throw new HttpsError("not-found", `Caixa ${boxCode} não encontrada.`);
  const box = snapshot.data() ?? {};
  const origin = (box.origin ?? {}) as Row;
  if (origin.kind !== "receipt" || text(origin.receipt_id) !== receiptId || text(box.customer_code) !== owner) {
    throw new HttpsError("permission-denied", "Caixa de outra chegada.");
  }
  return box;
}

/**
 * Leituras das escritas: sempre pela transação, para a revisão da caixa e o
 * status da chegada valerem até o commit (duas telas na mesma caixa: a
 * segunda refaz a leitura e recebe o conflito de revisão).
 */
async function readReceipt(transaction: Transaction, db: Firestore, receiptId: string) {
  return receiptFrom(await transaction.get(db.collection(INBOUND_RECEIPTS_COLLECTION).doc(receiptId)));
}

async function readBox(transaction: Transaction, db: Firestore, boxCode: string, receiptId: string, owner: string) {
  const ref = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(boxCode);
  return { ref, box: boxFrom(await transaction.get(ref), boxCode, receiptId, owner) };
}

function requireStatus(box: Row, boxCode: string, allowed: "counting" | "reviewed") {
  const status = text(box.status);
  if (status === allowed) return;
  if (status === "committing" || status === "stored") {
    throw new HttpsError(
      "failed-precondition",
      `A caixa ${boxCode} já tem destino confirmado em ${text(box.location_id) || text(box.destination_location_id)}.`,
    );
  }
  if (allowed === "counting") {
    throw new HttpsError("failed-precondition", `Reabra a caixa ${boxCode} antes de alterar o conteúdo.`);
  }
  throw new HttpsError("failed-precondition", `Feche a caixa ${boxCode} (medidas e peso) antes de escolher a prateleira.`);
}

// ----------------------------------------------------- recibo e evento

function operationRef(db: Firestore, action: string, receiptId: string, nonce: string) {
  return db.collection(OPERATIONS_COLLECTION).doc(`op_inbound_box_${digest({ action, receipt_id: receiptId, nonce })}`);
}

async function replayOf(transaction: Transaction, ref: DocumentReference, inputHash: string) {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return undefined;
  if (snapshot.get("input_hash") !== inputHash) {
    throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
  }
  return snapshot.get("result") as Row;
}

function finish(
  transaction: Transaction,
  ref: DocumentReference,
  receipt: { action: string; targetId: string; customerCode: string; inputHash: string },
  actor: OperationalActor,
  result: Row,
) {
  const stored = clean(result);
  transaction.create(ref, {
    id: ref.id,
    kind: `warehouse.inbound_box.${receipt.action}`,
    target_id: receipt.targetId,
    customer_code: receipt.customerCode,
    input_hash: receipt.inputHash,
    status: "completed",
    actor: actorFields(actor),
    result: stored,
    created_at: FieldValue.serverTimestamp(),
    completed_at: FieldValue.serverTimestamp(),
  });
  return stored;
}

function boxEvent(
  transaction: Transaction,
  db: Firestore,
  operationId: string,
  suffix: string,
  input: Omit<OperationalEventInput, "severity" | "inbox" | "source">,
  actor: OperationalActor,
): OperationalEventSummary {
  return createEvent(
    transaction,
    db,
    `evt_${digest({ operationId, suffix })}`,
    { entity_type: "warehouse_box", ...input, severity: "info", inbox: false, source: EVENT_SOURCE },
    actor,
  );
}

// ------------------------------------------------------------------ iniciar

/** Abre a próxima caixa (CX) da chegada, vazia, em conferência. */
export async function startInboundBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(StartInboundBoxSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, "start", input.receipt_id, input.idempotency_key);
  const counterRef = db.collection(WAREHOUSE_COUNTERS_COLLECTION).doc(BOX_COUNTER_DOC);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const counter = await transaction.get(counterRef);
    const sequence = Number(counter.get("last") ?? 0) + 1;
    const code = formatBoxCode(sequence);
    const boxRef = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(code);
    if ((await transaction.get(boxRef)).exists) {
      throw new HttpsError(
        "failed-precondition",
        `O código ${code} já existe: o contador de caixas está atrás. Avise a coordenação.`,
      );
    }

    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const startedAt = new Date().toISOString();
    const record = {
      id: code,
      code,
      customer_code: owner,
      status: "counting",
      // No topo, para a tela listar as caixas da chegada (parte 5).
      receipt_id: input.receipt_id,
      origin: {
        kind: "receipt",
        receipt_id: input.receipt_id,
        receipt_number: receiptNumber,
        invoice_number: text(receipt.invoice_number) || null,
      },
      location_id: "",
      destination_location_id: null,
      length_m: null,
      width_m: null,
      height_m: null,
      gross_weight_kg: null,
      front_m: null,
      depth_m: null,
      placed_height_m: null,
      orientation: null,
      support_box_code: null,
      base_height_m: null,
      allow_tilt: false,
      allow_stacking: false,
      lines: [] as InboundBoxLine[],
      draft_line_count: 0,
      draft_unit_count: 0,
      // O que já está no estoque: só sobe na guarda (parte 4), como na abertura.
      line_count: 0,
      unit_count: 0,
      total_cost: 0,
      sku_codes: [] as string[],
      refusals: [] as Row[],
      suggestion: null,
      refusal: null,
      conference_revision: 0,
      // A contagem de abertura não lança em caixa do recebimento.
      opening_closed: true,
      started_at: startedAt,
      started_by: actorFields(actor),
    };

    transaction.set(counterRef, { last: sequence, prefix: "CX", updated_at: FieldValue.serverTimestamp() }, { merge: true });
    transaction.create(boxRef, {
      ...record,
      created_at: FieldValue.serverTimestamp(),
      created_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    });
    const event = boxEvent(transaction, db, opRef.id, "box_started", {
      type: "warehouse.box_started",
      title: `Caixa ${code} iniciada na chegada ${receiptNumber}`,
      description: "Caixa do fornecedor aberta na bancada do recebimento.",
      entity_id: code,
      customer_code: owner,
      payload: { box_code: code, receipt_id: input.receipt_id, receipt_number: receiptNumber },
    }, actor);
    return finish(transaction, opRef, { action: "start", targetId: code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box: record,
      events: [event],
    });
  });
}

// ------------------------------------------------------------------ lançar

/** Põe (ou tira, com 0) uma linha da NF na caixa em conferência. */
export async function saveInboundBoxLine(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(SaveInboundBoxLineSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, "line", input.receipt_id, input.idempotency_key);
  const itemRef = db.collection(INBOUND_ITEMS_COLLECTION).doc(input.inbound_item_id);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const { ref: boxRef, box } = await readBox(transaction, db, input.box_code, input.receipt_id, owner);
    requireStatus(box, input.box_code, "counting");
    revision(box, input.expected_revision);
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists) throw new HttpsError("not-found", "Linha da chegada não encontrada.");
    const item = itemSnapshot.data() ?? {};
    if (text(item.receipt_id) !== input.receipt_id || recordOwner(item) !== owner) {
      throw new HttpsError("permission-denied", "Linha de outra chegada.");
    }
    const lineNumber = Number(item.line_number) || 0;
    const skuCode = text(item.sku_code);
    if (!skuCode) {
      throw new HttpsError(
        "failed-precondition",
        `Linha ${lineNumber || input.inbound_item_id} está com código a definir. Informe o código da etiqueta antes de pôr na caixa.`,
      );
    }
    const itemLocation = text(item.location_id).toUpperCase();
    if (itemLocation && itemLocation !== RECEIVING_AREA) {
      throw new HttpsError(
        "failed-precondition",
        `A linha ${lineNumber} vai direto para ${itemLocation}: na chegada por caixa, toda linha passa pela área de recebimento.`,
      );
    }

    const next: InboundBoxLine = {
      inbound_item_id: input.inbound_item_id,
      line_number: lineNumber,
      sku_code: skuCode,
      client_item_code: text(item.client_item_code) || skuCode,
      product_name: text(item.product_name) || skuCode,
      size: text(item.size) || null,
      counted_qty: round(input.counted_qty),
    };
    const content = boxContentWith(linesOf(box), next);
    const removing = next.counted_qty <= 0;
    const boxedQty = Math.max(0, round((Number(item.boxed_qty) || 0) - content.previous_qty + next.counted_qty));
    const codes = new Set((Array.isArray(item.box_codes) ? item.box_codes : []).map((code) => text(code)).filter(Boolean));
    if (removing) codes.delete(input.box_code);
    else codes.add(input.box_code);
    const boxCodes = [...codes].sort();
    const nextRevision = input.expected_revision + 1;

    transaction.update(boxRef, {
      lines: content.lines,
      draft_line_count: content.draft_line_count,
      draft_unit_count: content.draft_unit_count,
      conference_revision: nextRevision,
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.update(itemRef, { boxed_qty: boxedQty, box_codes: boxCodes, updated_at: FieldValue.serverTimestamp() });
    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const event = boxEvent(transaction, db, opRef.id, removing ? "box_line_removed" : "box_line_saved", {
      type: removing ? "warehouse.box_line_removed" : "warehouse.box_line_saved",
      title: removing
        ? `Linha ${lineNumber} tirada da caixa ${input.box_code}`
        : `Linha ${lineNumber} na caixa ${input.box_code}: ${next.counted_qty} un.`,
      description: `${next.product_name} · chegada ${receiptNumber}`,
      entity_id: input.box_code,
      customer_code: owner,
      payload: {
        box_code: input.box_code,
        receipt_id: input.receipt_id,
        receipt_number: receiptNumber,
        inbound_item_id: input.inbound_item_id,
        line_number: lineNumber,
        sku_code: skuCode,
        client_item_code: next.client_item_code,
        before_qty: content.previous_qty,
        counted_qty: next.counted_qty,
        boxed_qty: boxedQty,
        expected_qty: Number(item.expected_qty) || 0,
      },
    }, actor);
    return finish(transaction, opRef, { action: "line", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box_code: input.box_code,
      line: removing ? null : next,
      draft_line_count: content.draft_line_count,
      draft_unit_count: content.draft_unit_count,
      conference_revision: nextRevision,
      inbound_item: { id: input.inbound_item_id, boxed_qty: boxedQty, box_codes: boxCodes },
      events: [event],
    });
  });
}

// ------------------------------------------------------- fechar e reabrir

/** Fecha a caixa com medidas e peso (reviewed) ou a reabre para ajuste (counting). */
export async function setInboundBoxState(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(SetInboundBoxStateSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, input.action, input.receipt_id, input.idempotency_key);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const { ref: boxRef, box } = await readBox(transaction, db, input.box_code, input.receipt_id, owner);
    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const nextRevision = input.expected_revision + 1;
    const now = new Date().toISOString();

    if (input.action === "close") {
      requireStatus(box, input.box_code, "counting");
      revision(box, input.expected_revision);
      const lines = linesOf(box);
      if (!lines.length) {
        throw new HttpsError("failed-precondition", "Lance ao menos um produto antes de fechar a caixa.");
      }
      const dimensions = requireDimensions(input);
      const allowTilt = input.allow_tilt === true;
      const allowStacking = input.allow_stacking === true;
      transaction.update(boxRef, {
        status: "reviewed",
        length_m: dimensions.length_m,
        width_m: dimensions.width_m,
        height_m: dimensions.height_m,
        gross_weight_kg: dimensions.gross_weight_kg ?? null,
        allow_tilt: allowTilt,
        allow_stacking: allowStacking,
        closed_at: now,
        closed_by: actorFields(actor),
        conference_revision: nextRevision,
        updated_at: FieldValue.serverTimestamp(),
      });
      const event = boxEvent(transaction, db, opRef.id, "box_closed", {
        type: "warehouse.box_closed",
        title: `Caixa ${input.box_code} fechada · ${describeBox(dimensions)}`,
        description: `${Number(box.draft_line_count ?? lines.length)} produto(s), ${Number(box.draft_unit_count ?? 0)} un. · chegada ${receiptNumber}`,
        entity_id: input.box_code,
        customer_code: owner,
        payload: {
          box_code: input.box_code,
          receipt_id: input.receipt_id,
          receipt_number: receiptNumber,
          dimensions,
          allow_tilt: allowTilt,
          allow_stacking: allowStacking,
          lines,
        },
      }, actor);
      return finish(transaction, opRef, { action: "close", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
        ok: true,
        box_code: input.box_code,
        status: "reviewed",
        dimensions,
        allow_tilt: allowTilt,
        allow_stacking: allowStacking,
        conference_revision: nextRevision,
        events: [event],
      });
    }

    const status = text(box.status);
    if (status !== "reviewed") {
      if (status === "committing" || status === "stored") requireStatus(box, input.box_code, "reviewed");
      throw new HttpsError("failed-precondition", "Só a caixa fechada e sem destino reabre.");
    }
    revision(box, input.expected_revision);
    // As recusas valiam para aquela medição; as medidas ficam para a tela preencher.
    transaction.update(boxRef, {
      status: "counting",
      refusals: [],
      reopened_at: now,
      reopened_by: actorFields(actor),
      conference_revision: nextRevision,
      updated_at: FieldValue.serverTimestamp(),
    });
    const event = boxEvent(transaction, db, opRef.id, "box_reopened", {
      type: "warehouse.box_reopened",
      title: `Caixa ${input.box_code} reaberta para ajuste`,
      description: `Chegada ${receiptNumber}`,
      entity_id: input.box_code,
      customer_code: owner,
      payload: { box_code: input.box_code, receipt_id: input.receipt_id, receipt_number: receiptNumber },
    }, actor);
    return finish(transaction, opRef, { action: "reopen", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box_code: input.box_code,
      status: "counting",
      conference_revision: nextRevision,
      events: [event],
    });
  });
}

// ------------------------------------------------------------------ sugerir

/**
 * Prateleiras, caixas guardadas e reservadas e o que cada prateleira já tem,
 * do cliente. O produto de uma caixa do recebimento com destino confirmado
 * conta como "mesmo produto" na prateleira dela: o saldo ainda está na área
 * de recebimento, mas a caixa já está a caminho de lá.
 */
async function readZone(db: Firestore, customerCode: string) {
  const [positionsSnapshot, boxesSnapshot, balancesSnapshot] = await Promise.all([
    db.collection(WAREHOUSE_POSITIONS_COLLECTION).where("customer_code", "==", customerCode).get(),
    db.collection(WAREHOUSE_BOXES_COLLECTION).where("customer_code", "==", customerCode).where("status", "in", ["stored", "committing"]).get(),
    db.collection("stock_balances").where("customer_code", "==", customerCode).get(),
  ]);
  const boxes = boxesSnapshot.docs.map((document) => document.data());
  const reserved = boxes
    .filter((box) => box.status === "committing" && (box.origin as Row | undefined)?.kind === "receipt")
    .flatMap((box) =>
      linesOf(box).map((line) => ({ location_id: text(box.location_id), sku_code: line.sku_code, qty_on_hand: line.counted_qty })),
    );
  return {
    positions: positionsSnapshot.docs.map((document) => asPosition(document.data())),
    occupancy: buildOccupancy(boxes, [...balancesSnapshot.docs.map((document) => document.data()), ...reserved]),
  };
}

/** A prateleira para a caixa fechada, pelo motor. Só lê. */
export async function suggestInboundBoxPosition(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(SuggestInboundBoxPositionSchema, raw);
  // Só lê: fora de transação, como a sugestão de hoje (suggestWarehousePosition).
  const receipt = receiptFrom(await db.collection(INBOUND_RECEIPTS_COLLECTION).doc(input.receipt_id).get());
  const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
  const box = boxFrom(await db.collection(WAREHOUSE_BOXES_COLLECTION).doc(input.box_code).get(), input.box_code, input.receipt_id, owner);
  requireStatus(box, input.box_code, "reviewed");
  const dimensions = dimensionsOf(box);
  const refused = refusedPositions(box);
  const { positions, occupancy } = await readZone(db, owner);
  const locationCode = input.location_id ?? "";
  let candidates: SlottingPosition[] = positions;
  if (locationCode) {
    const selected = positions.find((position) => position.code === locationCode);
    if (!selected) throw new HttpsError("not-found", "Prateleira não cadastrada na zona deste cliente.");
    if ((selected.status ?? "active") !== "active") {
      throw new HttpsError("failed-precondition", "Escolha uma prateleira ativa da zona do cliente.");
    }
    candidates = [selected];
  }
  const result = suggestPosition(
    {
      ...dimensions,
      allow_tilt: box.allow_tilt === true,
      allow_stacking: box.allow_stacking === true,
      customer_code: owner,
      sku_codes: [...new Set(linesOf(box).map((line) => line.sku_code))],
    },
    candidates,
    occupancy,
    { exclude: [...refused, ...(input.exclude ?? [])] },
  );
  if (locationCode) {
    if (!result.position) {
      throw new HttpsError("failed-precondition", "A caixa não cabe nesta prateleira ou ela foi excluída da escolha. Selecione outra.");
    }
    result.position.reason = "Prateleira selecionada manualmente.";
  }
  return {
    ok: true,
    customer_code: owner,
    box_code: input.box_code,
    box: dimensions,
    zone_positions: positions.length,
    refused,
    ...result,
  };
}

// ------------------------------------------------------------------ recusar

/** "Não cabe aqui" antes de confirmar: a prateleira sai da escolha desta caixa. */
export async function refuseInboundBoxPosition(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(RefuseInboundBoxPositionSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, "refuse", input.receipt_id, input.idempotency_key);
  const positionRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(input.position);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const { ref: boxRef, box } = await readBox(transaction, db, input.box_code, input.receipt_id, owner);
    requireStatus(box, input.box_code, "reviewed");
    revision(box, input.expected_revision);
    const positionSnapshot = await transaction.get(positionRef);
    if (!positionSnapshot.exists) {
      throw new HttpsError("not-found", `Posição ${input.position} não está cadastrada em Estoque › Posições.`);
    }
    if (text(positionSnapshot.get("customer_code")) !== owner) {
      throw new HttpsError("failed-precondition", `A prateleira ${input.position} não é da zona de ${owner}.`);
    }
    if (refusedPositions(box).includes(input.position)) {
      throw new HttpsError("failed-precondition", `A prateleira ${input.position} já foi recusada para esta caixa.`);
    }

    const refusal = { position: input.position, reason: input.reason, refused_at: new Date().toISOString(), refused_by: actorFields(actor) };
    const refusals = [...(Array.isArray(box.refusals) ? (box.refusals as Row[]) : []), refusal];
    const nextRevision = input.expected_revision + 1;
    transaction.update(boxRef, { refusals, conference_revision: nextRevision, updated_at: FieldValue.serverTimestamp() });
    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const event = boxEvent(transaction, db, opRef.id, "position_refused", {
      type: "warehouse.position_refused",
      title: `Posição ${input.position} recusada para a caixa ${input.box_code}`,
      description: `${input.reason}. Recusa desta sugestão para esta caixa; o estado da prateleira não foi alterado.`,
      entity_type: "warehouse_position",
      entity_id: input.position,
      customer_code: owner,
      payload: { box_code: input.box_code, receipt_id: input.receipt_id, receipt_number: receiptNumber, reason: input.reason },
    }, actor);
    return finish(transaction, opRef, { action: "refuse", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box_code: input.box_code,
      refused: refusals.map((item) => text(item.position)),
      conference_revision: nextRevision,
      events: [event],
    });
  });
}

// ------------------------------------------------------ confirmar destino

/** Confirma a prateleira e reserva o espaço: a caixa fica em committing. */
export async function confirmInboundBoxDestination(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(ConfirmInboundBoxDestinationSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, "confirm", input.receipt_id, input.idempotency_key);
  const locationCode = input.location_id;
  const positionRef = db.collection(WAREHOUSE_POSITIONS_COLLECTION).doc(locationCode);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const { ref: boxRef, box } = await readBox(transaction, db, input.box_code, input.receipt_id, owner);
    requireStatus(box, input.box_code, "reviewed");
    revision(box, input.expected_revision);
    if (!linesOf(box).length) {
      throw new HttpsError("failed-precondition", "Lance ao menos um produto antes de fechar a caixa.");
    }
    if (refusedPositions(box).includes(locationCode)) {
      throw new HttpsError("failed-precondition", `A prateleira ${locationCode} foi recusada para esta caixa. Escolha outra.`);
    }
    const [positionSnapshot, boxesSnapshot] = await Promise.all([
      transaction.get(positionRef),
      transaction.get(
        db.collection(WAREHOUSE_BOXES_COLLECTION).where("location_id", "==", locationCode).where("status", "in", ["stored", "committing"]),
      ),
    ]);
    if (!positionSnapshot.exists) {
      throw new HttpsError("not-found", `Posição ${locationCode} não está cadastrada em Estoque › Posições.`);
    }
    const position = asPosition(positionSnapshot.data() ?? {});
    if ((position.status ?? "active") !== "active") {
      throw new HttpsError(
        "failed-precondition",
        `A prateleira ${locationCode} está ${position.status === "blocked" ? "bloqueada" : "em verificação"}; escolha outra.`,
      );
    }
    if (text(position.customer_code) !== owner) {
      throw new HttpsError(
        "failed-precondition",
        `A prateleira ${locationCode} não é da zona de ${owner}. Atribua a rua ao cliente em Estoque › Posições.`,
      );
    }
    const dimensions = dimensionsOf(box);
    const occupancy = buildOccupancy(boxesSnapshot.docs.map((document) => document.data()), []).get(locationCode) ?? emptyOccupancy();
    const placement = placementFor(position, dimensions, occupancy, {
      allow_tilt: box.allow_tilt === true,
      allow_stacking: box.allow_stacking === true,
      orientation: input.orientation,
      support_box_code: input.support_box_code,
    });
    if (!placement) {
      throw new HttpsError(
        "failed-precondition",
        `A caixa de ${describeBox(dimensions)} não cabe na prateleira ${locationCode}: frente livre de ${centimeters(Math.max(0, position.length_m - occupancy.front_used_m))} cm, profundidade ${centimeters(position.depth_m)} cm, altura ${centimeters(position.height_m)} cm${position.max_weight_kg != null ? `, peso máximo ${position.max_weight_kg} kg` : ""}. Peça outra sugestão.`,
      );
    }

    const suggestion = input.suggestion
      ? {
          position: input.suggestion.position ?? null,
          reason: input.suggestion.reason ?? null,
          alternatives: input.suggestion.alternatives ?? [],
          tier: input.suggestion.tier ?? null,
          followed: input.suggestion.position ? input.suggestion.position === locationCode : null,
        }
      : null;
    const refusals = Array.isArray(box.refusals) ? (box.refusals as Row[]) : [];
    const lastRefusal = refusals.length ? refusals[refusals.length - 1]! : null;
    const refusal = lastRefusal ? { position: text(lastRefusal.position), reason: text(lastRefusal.reason) } : null;
    const nextRevision = input.expected_revision + 1;
    const confirmedAt = new Date().toISOString();
    const reservation = {
      status: "committing",
      // A reserva conta pela location_id (buildOccupancy, Mapa); o destino fica explícito.
      location_id: locationCode,
      destination_location_id: locationCode,
      front_m: placement.front_m,
      depth_m: placement.depth_m,
      placed_height_m: placement.height_m,
      orientation: placement.orientation,
      support_box_code: placement.support_box_code ?? null,
      base_height_m: placement.base_height_m ?? 0,
    };

    // Serializa com as outras guardas e reservas desta prateleira.
    transaction.update(positionRef, { occupancy_revision: FieldValue.increment(1) });
    transaction.update(boxRef, {
      ...reservation,
      suggestion,
      refusal,
      "origin.invoice_number": text(receipt.invoice_number) || null,
      destination_confirmed_at: confirmedAt,
      destination_confirmed_by: actorFields(actor),
      conference_revision: nextRevision,
      updated_at: FieldValue.serverTimestamp(),
    });
    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const event = boxEvent(transaction, db, opRef.id, "box_destination_confirmed", {
      type: "warehouse.box_destination_confirmed",
      title: `Destino da caixa ${input.box_code} confirmado em ${locationCode}`,
      description: `${describeBox(dimensions)} · ${
        suggestion?.followed === false
          ? `prateleira diferente da sugerida (${suggestion.position})`
          : suggestion?.position
            ? "na prateleira sugerida pelo sistema"
            : "prateleira escolhida sem sugestão"
      }${refusal ? ` · recusou ${refusal.position}: ${refusal.reason}` : ""} · chegada ${receiptNumber}`,
      entity_id: input.box_code,
      customer_code: owner,
      payload: {
        box_code: input.box_code,
        receipt_id: input.receipt_id,
        receipt_number: receiptNumber,
        location_id: locationCode,
        placement,
        suggestion,
        refusals: refusals.map((item) => ({ position: text(item.position), reason: text(item.reason) })),
        occupancy_before: { front_used_m: occupancy.front_used_m, box_count: occupancy.box_count },
      },
    }, actor);
    return finish(transaction, opRef, { action: "confirm", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box_code: input.box_code,
      ...reservation,
      suggestion,
      refusal,
      conference_revision: nextRevision,
      events: [event],
    });
  });
}

// ------------------------------------------------------------------ remover

/** Desfaz a caixa na bancada, antes do destino: as linhas voltam a faltar caixa. */
export async function removeInboundBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = parse(RemoveInboundBoxSchema, raw);
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, "remove", input.receipt_id, input.idempotency_key);

  return db.runTransaction(async (transaction) => {
    const previous = await replayOf(transaction, opRef, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    const receipt = await readReceipt(transaction, db, input.receipt_id);
    const owner = assertReceiptTakesBoxes(receipt, input.customer_code);
    const { ref: boxRef, box } = await readBox(transaction, db, input.box_code, input.receipt_id, owner);
    const status = text(box.status);
    if (status !== "counting" && status !== "reviewed") requireStatus(box, input.box_code, "counting");
    revision(box, input.expected_revision);
    const lines = linesOf(box);
    const itemRefs = lines.map((line) => db.collection(INBOUND_ITEMS_COLLECTION).doc(line.inbound_item_id));
    const itemSnapshots = await Promise.all(itemRefs.map((ref) => transaction.get(ref)));

    itemSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const item = snapshot.data() ?? {};
      const boxedQty = Math.max(0, round((Number(item.boxed_qty) || 0) - (Number(lines[index]!.counted_qty) || 0)));
      const boxCodes = (Array.isArray(item.box_codes) ? item.box_codes : [])
        .map((code) => text(code))
        .filter((code) => code && code !== input.box_code)
        .sort();
      transaction.update(itemRefs[index]!, { boxed_qty: boxedQty, box_codes: boxCodes, updated_at: FieldValue.serverTimestamp() });
    });
    transaction.delete(boxRef);
    const receiptNumber = text(receipt.receipt_number) || input.receipt_id;
    const event = boxEvent(transaction, db, opRef.id, "box_removed", {
      type: "warehouse.box_removed",
      title: `Caixa ${input.box_code} removida da chegada ${receiptNumber}`,
      description: `${lines.length} produto(s) voltaram para as linhas da NF sem caixa.`,
      entity_id: input.box_code,
      customer_code: owner,
      payload: { box_code: input.box_code, receipt_id: input.receipt_id, receipt_number: receiptNumber, status, lines },
    }, actor);
    return finish(transaction, opRef, { action: "remove", targetId: input.box_code, customerCode: owner, inputHash }, actor, {
      ok: true,
      box_code: input.box_code,
      removed_lines: lines.length,
      events: [event],
    });
  });
}
