import { createHash } from "node:crypto";

import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { areaDePassagem } from "./areas-de-passagem.js";
import { nomeComTamanho } from "./nome-do-produto.js";
import { AREA_DE_RECEBIMENTO } from "./inbound-box-entry.js";
import {
  assertInventoryOperationsEnabled,
  assertSingleBalance,
  createEvent,
  readRows,
  skuBalancesQuery,
  type OperationalActor,
  type Row as LedgerRow,
} from "./operations.js";

/**
 * A ação "Guardar" no Estoque (docs/plataforma/recebimento-com-caixas.md,
 * decisão 16 e parte 7e): a coordenação abre a guarda de um saldo parado
 * numa área de passagem (RECEBIMENTO ou EXPEDICAO) que não tem guarda. É o
 * que entra pela entrada manual ou pela contagem numa área, pela devolução
 * com o local de uma área, o resto de uma guarda feita a menos e o que já
 * estava parado antes da parte 7. A guarda nasce como a da volta do pedido
 * cancelado: por linha, sem destino, e segue a guarda de hoje.
 *
 * O que dá para guardar é o livre do saldo naquele local menos o que as
 * guardas abertas do SKU já vão tirar dali (as da chegada por linha, as das
 * caixas e as abertas aqui): duas guardas nunca contam as mesmas peças.
 */

export const PUTAWAY_TASKS_COLLECTION = "putaway_tasks";
const OPERATIONS_COLLECTION = "operations";
const EVENT_SOURCE = "functions_wms";
/** A guarda que ainda vai tirar peças da origem. */
const OPEN_PUTAWAY = new Set(["planned", "in_progress"]);

type Row = Record<string, unknown>;

export type SemGuarda = {
  /** O livre do saldo no local: o que está lá menos o reservado. */
  livre: number;
  /** O que as guardas abertas do SKU vão tirar do local. */
  em_guardas_abertas: number;
  /** O que dá para guardar: o livre menos as guardas abertas. */
  sem_guarda: number;
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function quantity(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? round(parsed) : 0;
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

function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw ?? {});
  if (result.success) return result.data as z.output<S>;
  const issue = result.error.issues[0];
  const generic = !issue || /^(Required|Expected|Invalid|Number must|String must)/.test(issue.message);
  const field = issue?.path.join(".") || "entrada";
  throw new HttpsError("invalid-argument", generic ? `Campo inválido: ${field}.` : issue.message);
}

const Codigo = z.string().trim().min(1).max(120);

export const AreaPutawayPreviewSchema = z.object({
  customer_code: Codigo,
  sku_code: Codigo,
  location_id: Codigo,
});

export const OpenAreaPutawaySchema = AreaPutawayPreviewSchema.extend({
  quantity: z.number().positive().max(1_000_000),
  reason: z.string().trim().min(3, "Informe o motivo da guarda.").max(300, "O motivo vai até 300 caracteres."),
  idempotency_key: z.string().trim().min(8).max(160),
});

/** O local tem de ser uma área de passagem: o saldo da prateleira já está guardado. */
export function areaDoLocal(locationId: string) {
  const area = areaDePassagem(locationId);
  if (!area) {
    throw new HttpsError(
      "failed-precondition",
      `O local ${locationId} não é uma área de passagem: o saldo dele já está guardado.`,
      { code: "NOT_A_TRANSIT_AREA" },
    );
  }
  return area;
}

/**
 * O que está sem guarda no local, sem o banco: o livre dos saldos do SKU
 * naquele local menos o que as guardas abertas do SKU vão tirar de lá. A
 * guarda por linha tira a quantidade dela da origem gravada (sem origem, o
 * RECEBIMENTO); a da caixa tira do RECEBIMENTO as linhas dela desse SKU.
 */
export function semGuarda(input: { locationId: string; skuCode: string; saldos: Row[]; guardas: Row[] }): SemGuarda {
  const { livre, em_guardas_abertas, sem_guarda } = contaDaArea(input);
  return { livre, em_guardas_abertas, sem_guarda };
}

/**
 * A conta, com o sem guarda exato ao lado do arredondado: o saldo pode ter
 * resto de ponto flutuante (0,3 − 0,1 = 0,19999…), e a guarda compara a
 * origem sem arredondar. A guarda aberta nunca pede mais do que o exato.
 */
function contaDaArea(input: { locationId: string; skuCode: string; saldos: Row[]; guardas: Row[] }) {
  const livreExato = input.saldos
    .filter((saldo) => text(saldo.location_id) === input.locationId)
    .reduce((sum, saldo) => {
      const livreDoSaldo = Number(saldo.qty_on_hand ?? 0) - Number(saldo.qty_reserved ?? 0);
      return sum + (Number.isFinite(livreDoSaldo) ? Math.max(0, livreDoSaldo) : 0);
    }, 0);
  const livre = round(livreExato);
  let emGuardas = 0;
  for (const guarda of input.guardas) {
    if (!OPEN_PUTAWAY.has(text(guarda.status).toLowerCase())) continue;
    if (text(guarda.box_code)) {
      if (input.locationId !== AREA_DE_RECEBIMENTO) continue;
      const lines = Array.isArray(guarda.lines) ? (guarda.lines as Row[]) : [];
      for (const line of lines) {
        if (text(line.sku_code) === input.skuCode) emGuardas += quantity(line.counted_qty);
      }
      continue;
    }
    if (text(guarda.sku_code || guarda.sku) !== input.skuCode) continue;
    if ((text(guarda.source_location_id) || AREA_DE_RECEBIMENTO) !== input.locationId) continue;
    emGuardas += quantity(guarda.quantity ?? guarda.total_units);
  }
  const em_guardas_abertas = round(emGuardas);
  return {
    livre,
    em_guardas_abertas,
    sem_guarda: Math.max(0, round(livre - em_guardas_abertas)),
    sem_guarda_exato: Math.max(0, livreExato - emGuardas),
  };
}

/** As guardas do SKU no cliente: as por linha, pelo SKU, e as das caixas, pela lista de SKUs. */
async function readPutaways(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string) {
  const tasks = db.collection(PUTAWAY_TASKS_COLLECTION).where("customer_code", "==", customerCode);
  const [porLinha, porCaixa] = await Promise.all([
    readRows(transaction, tasks.where("sku_code", "==", skuCode)),
    readRows(transaction, tasks.where("sku_codes", "array-contains", skuCode)),
  ]);
  const byId = new Map<string, Row>();
  for (const row of [...porLinha, ...porCaixa]) byId.set(row.id, row.data);
  return [...byId.values()];
}

async function readAreaBalance(transaction: Transaction, db: Firestore, customerCode: string, skuCode: string, locationId: string) {
  const saldos = (await readRows(transaction, skuBalancesQuery(db, customerCode, skuCode))) as LedgerRow[];
  const noLocal = saldos.filter((saldo) => text(saldo.data.location_id) === locationId);
  // A guarda acha a origem pelo local exato e recusa mais de um saldo nele.
  const saldo = assertSingleBalance(noLocal, skuCode, locationId)!;
  return { saldos: saldos.map((row) => row.data), saldo: saldo.data };
}

/** O que o diálogo mostra: o livre no local, as guardas abertas e o sem guarda. Só lê. */
export async function previewAreaPutaway(db: Firestore, raw: unknown) {
  const input = parse(AreaPutawayPreviewSchema, raw);
  const area = areaDoLocal(input.location_id);
  return db.runTransaction(async (transaction) => {
    const { saldos, saldo } = await readAreaBalance(transaction, db, input.customer_code, input.sku_code, input.location_id);
    const guardas = await readPutaways(transaction, db, input.customer_code, input.sku_code);
    return {
      customer_code: input.customer_code,
      sku_code: input.sku_code,
      location_id: input.location_id,
      area,
      product_name: text(saldo.product_name) || null,
      client_item_code: text(saldo.client_item_code) || null,
      ...semGuarda({ locationId: input.location_id, skuCode: input.sku_code, saldos, guardas }),
    };
  });
}

/** A guarda aberta pela coordenação para o saldo parado numa área. */
export function areaPutawayTaskId(operationId: string) {
  return `put_area_${digest({ operationId })}`;
}

function operationRef(db: Firestore, customerCode: string, nonce: string): DocumentReference {
  return db.collection(OPERATIONS_COLLECTION).doc(`op_area_putaway_${digest({ customer_code: customerCode, nonce })}`);
}

function actorFields(actor: OperationalActor) {
  return Object.fromEntries(
    Object.entries({ uid: actor.uid, role: actor.role, email: actor.email, name: actor.name }).filter(([, value]) => value !== undefined),
  );
}

export async function openAreaPutaway(db: Firestore, raw: unknown, actor: OperationalActor) {
  const input = parse(OpenAreaPutawaySchema, raw);
  const area = areaDoLocal(input.location_id);
  const asked = round(input.quantity);
  // Três casas, como o resto do estoque: o que arredonda para zero não abre
  // guarda (a guarda sem quantidade não tem teto).
  if (!(asked > 0)) {
    throw new HttpsError("invalid-argument", "Informe a quantidade da guarda.", { code: "AREA_PUTAWAY_ZERO" });
  }
  const inputHash = digest(input, 64);
  const opRef = operationRef(db, input.customer_code, input.idempotency_key);

  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(opRef);
    if (previous.exists) {
      if (previous.get("input_hash") !== inputHash) {
        throw new HttpsError("already-exists", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      return previous.get("result") as Row;
    }
    await assertInventoryOperationsEnabled(transaction, db);
    const { saldos, saldo } = await readAreaBalance(transaction, db, input.customer_code, input.sku_code, input.location_id);
    const guardas = await readPutaways(transaction, db, input.customer_code, input.sku_code);
    const conta = contaDaArea({ locationId: input.location_id, skuCode: input.sku_code, saldos, guardas });
    const productName = text(saldo.product_name) || input.sku_code;
    if (asked > conta.sem_guarda) {
      throw new HttpsError(
        "failed-precondition",
        `No ${input.location_id} há ${conta.sem_guarda} un. de ${productName} sem guarda; a guarda pedida é de ${asked}.`,
        { code: "AREA_PUTAWAY_ABOVE_FREE", ...conta },
      );
    }

    const taskId = areaPutawayTaskId(opRef.id);
    // A guarda pede o pedido sem passar do exato da origem (o resto de ponto
    // flutuante que o arredondado esconde): a guarda compara sem arredondar.
    const quantidadeDaGuarda = Math.min(asked, conta.sem_guarda_exato);
    const clientItemCode = text(saldo.client_item_code) || undefined;
    const reason = input.reason;
    transaction.create(db.collection(PUTAWAY_TASKS_COLLECTION).doc(taskId), clean({
      id: taskId,
      customer_code: input.customer_code,
      sku_code: input.sku_code,
      client_item_code: clientItemCode,
      product_name: text(saldo.product_name) || undefined,
      source_location_id: input.location_id,
      quantity: quantidadeDaGuarda,
      total_units: quantidadeDaGuarda,
      status: "planned",
      priority: "normal",
      title: `Guardar ${nomeComTamanho({ nome: productName, codigo: clientItemCode })}`,
      next_action: `Levar da área ${area} para a prateleira e concluir a guarda.`,
      reason,
      source: "wms_area_putaway",
      created_from_operation_id: opRef.id,
      created_by: actorFields(actor),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }));
    const event = createEvent(
      transaction,
      db,
      `evt_${digest({ operationId: opRef.id, suffix: "area_putaway_opened" })}`,
      {
        type: "warehouse.area_putaway_opened",
        title: `Guarda aberta do ${input.location_id}`,
        description: `${asked} un. de ${productName} (${input.sku_code}) · ${reason}`,
        severity: "info",
        inbox: false,
        entity_type: PUTAWAY_TASKS_COLLECTION,
        entity_id: taskId,
        customer_code: input.customer_code,
        payload: clean({
          sku_code: input.sku_code,
          client_item_code: clientItemCode,
          location_id: input.location_id,
          area,
          quantity: asked,
          reason,
          livre: conta.livre,
          em_guardas_abertas: conta.em_guardas_abertas,
        }),
        source: EVENT_SOURCE,
      },
      actor,
    );
    const result = clean({
      ok: true,
      putaway_task_id: taskId,
      customer_code: input.customer_code,
      sku_code: input.sku_code,
      location_id: input.location_id,
      quantity: asked,
      sem_guarda: Math.max(0, round(conta.sem_guarda - asked)),
      events: [event],
    });
    transaction.create(opRef, {
      id: opRef.id,
      kind: "warehouse.area_putaway.open",
      target_id: taskId,
      customer_code: input.customer_code,
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

/** Tira as chaves sem valor, só no primeiro nível (mantém o serverTimestamp). */
function clean<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
