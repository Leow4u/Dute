import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";
import { CycleCountSchema } from "./cycle-count-input.js";
import { assertBarcodeAvailable, normalizeBarcode, readCustomerSkuPrefix } from "./catalog-codes.js";
import { assertCatalogOwnedBy, LEGACY_CUSTOMER_CODE } from "./customer-scope.js";
import { openingInventorySessionDocumentId, recordCycleCountTransaction, type OperationalActor, type RecordCycleCountInput } from "./operations.js";
import {
  BOX_COUNTER_DOC, BOX_EDITOR_ROLES, WAREHOUSE_BOXES_COLLECTION, WAREHOUSE_COUNTERS_COLLECTION,
  CreateWarehouseBoxSchema, asPosition, buildOccupancy, emptyOccupancy, formatBoxCode,
  placementFor, requireDimensions,
} from "./warehouse-boxes.js";

// Rascunhos não são estoque. A reserva da prateleira começa em committing;
// cada lançamento usa um payload congelado e uma chave estável, e pode ser retomado.
export const OPENING_CONFERENCE_LINES = "opening_inventory_draft_lines";
const MAX_LINES = 100;
type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => str(value).toUpperCase();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const identity = z.string().trim().min(1).max(160).refine((value) => !value.includes("/"), "Identificador inválido.");
const baseFields = { customer_code: z.string().trim().min(1), session_id: identity, box_code: z.string().trim().regex(/^CX-\d{6,}$/) };
const mutationFields = { ...baseFields, expected_revision: z.number().int().nonnegative(), idempotency_key: identity };
export const CreateOpeningConferenceBoxSchema = z.object({
  customer_code: baseFields.customer_code, session_id: identity, idempotency_key: identity,
});
export const GetOpeningConferenceBoxSchema = z.object(baseFields);
export const SaveOpeningConferenceLineSchema = CycleCountSchema.omit({
  mode: true, location_id: true, occurred_at: true,
}).extend({
  ...mutationFields, line_id: identity.optional(), counted_qty: z.number().finite().positive(),
  unit_cost: z.number().finite().positive(),
  genero: z.string().trim().min(1).max(80), grupo: z.string().trim().min(1).max(120),
  client_item_code: z.string().trim().max(120).optional(),
  product_name: z.string().trim().max(500).optional(), category: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(500).optional(), reason: z.string().trim().min(3).max(500),
  product_registration: z.enum(["existing", "new"]),
});
export const RemoveOpeningConferenceLineSchema = z.object({ ...mutationFields, line_id: identity });
export const SetOpeningConferenceBoxStateSchema = z.object({ ...mutationFields, action: z.enum(["review", "reopen", "release"]) });
export const StoreOpeningConferenceBoxSchema = CreateWarehouseBoxSchema.extend(mutationFields);

type Scope = z.infer<typeof GetOpeningConferenceBoxSchema>;
type DraftInput = z.infer<typeof SaveOpeningConferenceLineSchema>;
function actorData(actor: OperationalActor) { return clean(actor); }
function requireEditor(actor: OperationalActor) {
  if (!(BOX_EDITOR_ROLES as readonly string[]).includes(actor.role)) throw new HttpsError("permission-denied", "Conferência: somente administração ou operação de armazém.");
}
function revision(box: Row, expected: number) {
  if (Number(box.conference_revision ?? 0) !== expected) throw new HttpsError("aborted", "A caixa mudou em outra tela. Atualize antes de continuar.");
}
async function readSession(tx: Transaction, db: Firestore, scope: { customer_code: string; session_id: string }, requireOpen = true) {
  if (scope.session_id !== openingInventorySessionDocumentId(scope.customer_code)) throw new HttpsError("permission-denied", "Sessão de outro cliente.");
  const [session, control] = await Promise.all([
    tx.get(db.collection("opening_inventory_sessions").doc(scope.session_id)),
    tx.get(db.collection("system_controls").doc("inventory")),
  ]);
  if (!session.exists || (requireOpen && session.get("status") !== "open") || session.get("customer_code") !== scope.customer_code) throw new HttpsError("failed-precondition", "O inventário de abertura não está ativo para este cliente.");
  if (requireOpen && (control.get("movements_frozen") === true || control.get("reconciliation_status") === "running")) throw new HttpsError("failed-precondition", "Movimentações de estoque estão bloqueadas para reconciliação.");
}
async function readBox(tx: Transaction, db: Firestore, scope: Scope, requireOpen = true) {
  await readSession(tx, db, scope, requireOpen);
  const ref = db.collection(WAREHOUSE_BOXES_COLLECTION).doc(scope.box_code);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", "Caixa não encontrada.");
  const box = snap.data()!;
  if (box.customer_code !== scope.customer_code || (box.origin as Row | undefined)?.session_id !== scope.session_id) throw new HttpsError("permission-denied", "Caixa de outro cliente ou sessão.");
  return { ref, box };
}
function lineQuery(db: Firestore, code: string) { return db.collection(OPENING_CONFERENCE_LINES).where("box_code", "==", code); }
function event(tx: Transaction, db: Firestore, type: string, scope: Scope, actor: OperationalActor, payload: Row) {
  const ref = db.collection("events").doc();
  tx.create(ref, { id: ref.id, type, title: `Conferência da caixa ${scope.box_code}`, entity_type: "warehouse_box", entity_id: scope.box_code,
    customer_code: scope.customer_code, payload: clean(payload), actor: actorData(actor), severity: "info",
    occurred_at: new Date().toISOString(), created_at: FieldValue.serverTimestamp(), source: "functions_opening_conference" });
}
function receipt(db: Firestore, action: string, input: { customer_code: string; idempotency_key: string }) {
  return db.collection("operational_operations").doc(`op_conference_${hash({ action, customer: input.customer_code, nonce: input.idempotency_key })}`);
}
async function replay(tx: Transaction, ref: DocumentReference, input: unknown): Promise<Row | undefined> {
  const snap = await tx.get(ref);
  if (!snap.exists) return undefined;
  if (snap.get("input_hash") !== hash(input)) throw new HttpsError("already-exists", "Chave de idempotência já usada com outro conteúdo.");
  return snap.get("result") as Row;
}
function finish(tx: Transaction, ref: DocumentReference, input: unknown, result: Row, actor: OperationalActor) {
  tx.create(ref, { id: ref.id, kind: "inventory.opening.conference", input_hash: hash(input), result: clean(result), status: "completed", actor: actorData(actor), created_at: FieldValue.serverTimestamp() });
}
function draftBody(input: DraftInput): Row {
  const { expected_revision: _revision, idempotency_key: _key, line_id: _line, ...rest } = input;
  return clean({ ...rest, sku_code: upper(input.sku_code), client_item_code: upper(input.client_item_code), barcode: normalizeBarcode(input.barcode) });
}
function keys(line: Row): string[] {
  return [str(line.sku_code) && `sku:${upper(line.sku_code)}`, str(line.client_item_code) && `client:${upper(line.client_item_code)}`,
    str(line.barcode) && `barcode:${normalizeBarcode(line.barcode)}`].filter((key): key is string => Boolean(key));
}
function assertDistinct(candidate: Row, rows: Row[], except?: string) {
  const identities = new Set(keys(candidate));
  if (rows.some((line) => line.id !== except && keys(line).some((key) => identities.has(key)))) throw new HttpsError("already-exists", "Este produto já está nesta caixa. Edite a linha existente para ajustar a quantidade.");
}
function totals(lines: Row[]) {
  return {
    draft_line_count: lines.length,
    draft_unit_count: lines.reduce((sum, line) => sum + Number(line.counted_qty), 0),
    draft_total_cost: Math.round(lines.reduce((sum, line) => sum + Number(line.counted_qty) * Number(line.unit_cost), 0) * 100) / 100,
  };
}
function editable(box: Row, line?: Row) {
  if (box.status === "counting") return;
  if (box.status === "committing" && line && ["pending", "failed"].includes(str(line.status))) return;
  throw new HttpsError("failed-precondition", "Reabra a conferência antes de editar. Linhas em publicação ou já confirmadas não podem ser alteradas.");
}

/** Mesmas identidades do catálogo usadas pela gravação; não aloca SKU nem cria saldo. */
async function validateCatalog(tx: Transaction, db: Firestore, customer: string, line: Row) {
  const sku = upper(line.sku_code);
  const code = upper(line.client_item_code || sku);
  const isNew = line.product_registration === "new";
  if (!code || code.includes("/") || (!isNew && !sku)) throw new HttpsError("invalid-argument", "Informe o código do cliente e selecione o produto.");
  const [products, skus, productDoc, skuDoc] = await Promise.all([
    tx.get(db.collection("products").where("cod_cliente_key", "==", code)),
    tx.get(db.collection("skus").where("cod_cliente_key", "==", code)),
    tx.get(db.collection("products").doc(code.replace(/[^a-zA-Z0-9_.-]/g, "_"))),
    sku ? tx.get(db.collection("skus").doc(sku)) : Promise.resolve(undefined),
  ]);
  const productRows = products.docs.map((doc) => doc.data());
  const skuRows = skus.docs.map((doc) => doc.data());
  const records = [...productRows, ...skuRows, ...(productDoc.exists ? [productDoc.data()!] : []), ...(skuDoc?.exists ? [skuDoc.data()!] : [])];
  assertCatalogOwnedBy(customer, records, `O código ${code}`);
  if (products.size > 1 || skus.size > 1) throw new HttpsError("failed-precondition", "Código do cliente com cadastro duplicado. Corrija o catálogo.");
  const active = records.some((row) => row.archived !== true && row.status !== "archived");
  if (isNew) {
    if (!str(line.product_name) || !str(line.category) || !Array.isArray(line.photo_urls) || !line.photo_urls.length) throw new HttpsError("invalid-argument", "Produto novo exige descrição, categoria e ao menos uma foto.");
    if (active) throw new HttpsError("failed-precondition", `O código ${code} já existe. Selecione o cadastro encontrado.`);
    await readCustomerSkuPrefix(tx, db, customer);
    await assertBarcodeAvailable(tx, db, customer, line.barcode, LEGACY_CUSTOMER_CODE);
  } else {
    if ((!products.size && !productDoc.exists) || (!skus.size && !skuDoc?.exists)) throw new HttpsError("failed-precondition", "Cadastro incompleto ou produto não encontrado. Selecione o produto novamente.");
    const linked = skuRows.map((row) => str(row.cod_btg || row.sku_code || row.cod_sku)).filter(Boolean);
    if (linked.length && !linked.includes(sku)) throw new HttpsError("failed-precondition", "Código do cliente pertence a outro SKU.");
    const skuClient = str(skuDoc?.get("cod_cliente") || skuDoc?.get("client_item_code"));
    if (skuClient && skuClient !== code) throw new HttpsError("failed-precondition", "SKU pertence a outro código do cliente.");
  }
  return sku || str(skuRows[0]?.cod_btg || skuRows[0]?.sku_code || skuRows[0]?.cod_sku);
}

export async function createOpeningConferenceBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = CreateOpeningConferenceBoxSchema.parse(raw);
  const op = receipt(db, "create", input);
  return db.runTransaction(async (tx) => {
    const previous = await replay(tx, op, input);
    if (previous) return previous;
    await readSession(tx, db, input);
    const counterRef = db.collection(WAREHOUSE_COUNTERS_COLLECTION).doc(BOX_COUNTER_DOC);
    const counter = await tx.get(counterRef);
    const sequence = Number(counter.get("last") ?? 0) + 1;
    const code = formatBoxCode(sequence);
    const record = { id: code, code, customer_code: input.customer_code, status: "counting", location_id: "",
      length_m: null, width_m: null, height_m: null, front_m: null, depth_m: null, gross_weight_kg: null,
      line_count: 0, unit_count: 0, total_cost: 0, ...totals([]), conference_revision: 0, opening_closed: false,
      sku_codes: [], origin: { kind: "opening_inventory", session_id: input.session_id } };
    tx.update(db.collection("opening_inventory_sessions").doc(input.session_id), { updated_at: FieldValue.serverTimestamp() });
    tx.set(counterRef, { last: sequence, prefix: "CX", updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(db.collection(WAREHOUSE_BOXES_COLLECTION).doc(code), { ...record, created_at: FieldValue.serverTimestamp(), created_by: actor.uid, updated_at: FieldValue.serverTimestamp() });
    event(tx, db, "inventory.opening_box_started", { ...input, box_code: code }, actor, { box: record });
    const result = { ok: true, box: record };
    finish(tx, op, input, result, actor);
    return result;
  });
}

export async function getOpeningConferenceBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = GetOpeningConferenceBoxSchema.parse(raw);
  return db.runTransaction(async (tx) => {
    const { box } = await readBox(tx, db, input, false);
    const lines = await tx.get(lineQuery(db, input.box_code));
    return { ok: true, box, lines: lines.docs.map((doc) => ({ ...doc.data(), id: doc.id })).sort((a, b) => str(a.id).localeCompare(str(b.id))) };
  });
}

export async function saveOpeningConferenceLine(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = SaveOpeningConferenceLineSchema.parse(raw);
  const op = receipt(db, "save_line", input);
  const id = input.line_id ?? `draft_${hash({ box: input.box_code, nonce: input.idempotency_key }).slice(0, 40)}`;
  const body = draftBody(input);
  return db.runTransaction(async (tx) => {
    const previous = await replay(tx, op, input);
    if (previous) return previous;
    const { ref, box } = await readBox(tx, db, input);
    revision(box, input.expected_revision);
    const snapshot = await tx.get(lineQuery(db, input.box_code));
    const rows: Row[] = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const before = rows.find((line) => line.id === id);
    if (input.line_id && !before) throw new HttpsError("not-found", "Linha da conferência não encontrada.");
    editable(box, before);
    if (!before && rows.length >= MAX_LINES) throw new HttpsError("failed-precondition", "Limite de 100 produtos por caixa. Inicie outra caixa.");
    await validateCatalog(tx, db, input.customer_code, body);
    assertDistinct(body, rows, id);
    const line = { ...body, id, status: "pending", version: Number(before?.version ?? 0) + 1, error: null };
    const nextRows = [...rows.filter((row) => row.id !== id), line];
    const nextRevision = input.expected_revision + 1;
    tx.set(db.collection(OPENING_CONFERENCE_LINES).doc(id), { ...line, updated_by: actorData(actor), updated_at: FieldValue.serverTimestamp() });
    tx.update(ref, { ...totals(nextRows), conference_revision: nextRevision, updated_at: FieldValue.serverTimestamp() });
    event(tx, db, "inventory.opening_draft_saved", input, actor, { before: before ?? null, after: line });
    const result = { ok: true, line, conference_revision: nextRevision };
    finish(tx, op, input, result, actor);
    return result;
  });
}

export async function removeOpeningConferenceLine(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = RemoveOpeningConferenceLineSchema.parse(raw);
  const op = receipt(db, "remove_line", input);
  return db.runTransaction(async (tx) => {
    const previous = await replay(tx, op, input);
    if (previous) return previous;
    const { ref, box } = await readBox(tx, db, input);
    revision(box, input.expected_revision);
    const snapshot = await tx.get(lineQuery(db, input.box_code));
    const rows: Row[] = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const line = rows.find((row) => row.id === input.line_id);
    if (!line) throw new HttpsError("not-found", "Linha da conferência não encontrada.");
    editable(box, line);
    const nextRows = rows.filter((row) => row.id !== input.line_id);
    if (box.status === "committing" && !nextRows.length) throw new HttpsError("failed-precondition", "A caixa em guarda precisa manter ao menos um produto.");
    tx.delete(db.collection(OPENING_CONFERENCE_LINES).doc(input.line_id));
    tx.update(ref, { ...totals(nextRows), conference_revision: input.expected_revision + 1, updated_at: FieldValue.serverTimestamp() });
    event(tx, db, "inventory.opening_draft_removed", input, actor, { line });
    const result = { ok: true, conference_revision: input.expected_revision + 1 };
    finish(tx, op, input, result, actor);
    return result;
  });
}

export async function setOpeningConferenceBoxState(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = SetOpeningConferenceBoxStateSchema.parse(raw);
  const op = receipt(db, input.action, input);
  return db.runTransaction(async (tx) => {
    const previous = await replay(tx, op, input);
    if (previous) return previous;
    const { ref, box } = await readBox(tx, db, input);
    revision(box, input.expected_revision);
    if (input.action === "release") {
      if (box.status !== "committing") throw new HttpsError("failed-precondition", "A caixa não tem reserva pendente.");
      const lines = await tx.get(lineQuery(db, input.box_code));
      if (lines.docs.some((line) => !["pending", "failed"].includes(str(line.get("status")))) || Number(box.line_count ?? 0) > 0) {
        throw new HttpsError("failed-precondition", "Já há lançamentos confirmados ou em processamento. Retome a guarda.");
      }
      const positionRef = db.collection("warehouse_positions").doc(str(box.location_id));
      const position = await tx.get(positionRef);
      const updates = { status: "counting", opening_closed: false, location_id: "", front_m: null, depth_m: null,
        placed_height_m: null, conference_commit_id: null, conference_store_input: null,
        conference_revision: input.expected_revision + 1 };
      if (position.exists) tx.update(positionRef, { occupancy_revision: FieldValue.increment(1) });
      tx.update(ref, { ...updates, updated_at: FieldValue.serverTimestamp() });
      event(tx, db, "inventory.opening_box_storage_released", input, actor, { previous_location: box.location_id });
      const result = { ok: true, box: { ...box, ...updates } };
      finish(tx, op, input, result, actor);
      return result;
    }
    if (!["counting", "reviewed", "stored"].includes(str(box.status))) throw new HttpsError("failed-precondition", "Retome a guarda desta caixa antes de alterar seu estado.");
    const rows = await tx.get(lineQuery(db, input.box_code));
    if (input.action === "review" && box.status !== "stored") {
      if (rows.empty) throw new HttpsError("failed-precondition", "Conte ao menos um produto antes de finalizar a caixa.");
      for (const row of rows.docs) await validateCatalog(tx, db, input.customer_code, row.data());
    }
    const status = box.status === "stored" ? "stored" : input.action === "review" ? "reviewed" : "counting";
    const updates = { status, opening_closed: input.action === "review", conference_revision: input.expected_revision + 1 };
    tx.update(ref, { ...updates, updated_at: FieldValue.serverTimestamp(), reviewed_by: input.action === "review" ? actorData(actor) : null });
    event(tx, db, input.action === "review" ? "inventory.opening_box_reviewed" : "inventory.opening_box_reopened", input, actor, { before: box.status, ...updates });
    const result = { ok: true, box: { ...box, ...updates } };
    finish(tx, op, input, result, actor);
    return result;
  });
}

async function validatePositionBalances(tx: Transaction, db: Firestore, input: Scope, location: string, skus: string[]) {
  for (const sku of new Set(skus.filter(Boolean))) {
    const rows = await tx.get(db.collection("stock_balances").where("customer_code", "==", input.customer_code).where("sku_code", "==", sku).where("location_id", "==", location).limit(2));
    if (rows.size > 1) throw new HttpsError("failed-precondition", `Saldo duplicado de ${sku} em ${location}.`);
    const row = rows.docs[0]?.data();
    if (row && (Number(row.qty_reserved ?? 0) > 0 || (Number(row.qty_on_hand ?? 0) > 0 && row.opening_inventory_session_id !== input.session_id))) {
      throw new HttpsError("failed-precondition", `A posição ${location} tem saldo recebido ou reservado de ${sku}. Escolha outra posição para a abertura.`);
    }
  }
}

export async function storeOpeningConferenceBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const input = StoreOpeningConferenceBoxSchema.parse(raw);
  const op = receipt(db, "store", input);
  await db.runTransaction(async (tx) => {
    if (await replay(tx, op, input)) return;
    const { ref, box } = await readBox(tx, db, input);
    revision(box, input.expected_revision);
    if (box.status !== "reviewed") throw new HttpsError("failed-precondition", "Revise e finalize a conferência antes de guardar a caixa.");
    const location = upper(input.location_id);
    const dimensions = requireDimensions(input);
    const [positionSnapshot, occupied, drafts, refused] = await Promise.all([
      tx.get(db.collection("warehouse_positions").doc(location)),
      tx.get(db.collection(WAREHOUSE_BOXES_COLLECTION).where("location_id", "==", location).where("status", "in", ["stored", "committing"])),
      tx.get(lineQuery(db, input.box_code)),
      input.refusal ? tx.get(db.collection("warehouse_positions").doc(upper(input.refusal.position))) : Promise.resolve(undefined),
    ]);
    if (!positionSnapshot.exists) throw new HttpsError("not-found", "Posição não cadastrada.");
    const position = asPosition(positionSnapshot.data()!);
    if (position.customer_code !== input.customer_code || position.status !== "active") throw new HttpsError("failed-precondition", "Escolha uma posição ativa da zona do cliente.");
    if (input.refusal && (upper(input.refusal.position) === location || !refused?.exists || refused.get("customer_code") !== input.customer_code)) throw new HttpsError("failed-precondition", "Posição recusada inválida ou de outro cliente.");
    const occupancy = buildOccupancy(occupied.docs.map((doc) => doc.data()), []).get(location) ?? emptyOccupancy();
    const placement = placementFor(position, dimensions, occupancy, { allow_tilt: input.allow_tilt, orientation: input.orientation });
    if (!placement) throw new HttpsError("failed-precondition", "A caixa não cabe mais nesta posição. Peça outra sugestão.");
    if (drafts.empty || drafts.size > MAX_LINES) throw new HttpsError("failed-precondition", "A caixa precisa ter entre 1 e 100 produtos conferidos.");
    const skus: string[] = [];
    for (const draft of drafts.docs) skus.push(await validateCatalog(tx, db, input.customer_code, draft.data()));
    await validatePositionBalances(tx, db, input, location, skus);
    const commitId = op.id;
    const updates = {
      status: "committing", location_id: location, ...dimensions,
      front_m: placement.front_m, depth_m: placement.depth_m, placed_height_m: placement.height_m,
      orientation: placement.orientation, allow_tilt: input.allow_tilt ?? false,
      opening_closed: true, conference_commit_id: commitId,
      conference_revision: input.expected_revision + 1,
      conference_store_input: clean(input), conference_commit_started_at: new Date().toISOString(),
      suggestion: input.suggestion ? clean({ ...input.suggestion, followed: upper(input.suggestion.position) === location }) : null,
      refusal: input.refusal ? clean(input.refusal) : null,
    };
    tx.update(db.collection("warehouse_positions").doc(location), { occupancy_revision: FieldValue.increment(1) });
    tx.update(ref, { ...updates, updated_at: FieldValue.serverTimestamp() });
    event(tx, db, "inventory.opening_box_storage_started", input, actor, { location_id: location, placement, line_count: drafts.size });
    if (input.refusal) event(tx, db, "warehouse.position_refused", input, actor, { position: input.refusal.position, reason: input.refusal.reason, stored_at: location });
    finish(tx, op, input, { ok: true, box: { ...box, ...updates } }, actor);
  });
  return resumeOpeningConferenceBox(db, input, actor);
}

function isDefinitive(error: unknown): error is HttpsError {
  return error instanceof HttpsError && ["invalid-argument", "failed-precondition", "not-found", "already-exists", "permission-denied"].includes(error.code);
}

/** Reexecutar usa o input salvo, nunca a hora nem o formulário atuais. */
export async function resumeOpeningConferenceBox(db: Firestore, raw: unknown, actor: OperationalActor) {
  requireEditor(actor);
  const scope = GetOpeningConferenceBoxSchema.parse(raw);
  const initial = await getOpeningConferenceBox(db, scope, actor);
  if (initial.box.status === "stored" && initial.box.conference_commit_id) return { ok: true, box: initial.box };
  if (initial.box.status !== "committing") throw new HttpsError("failed-precondition", "A caixa não tem guarda pendente para retomar.");

  for (const listed of initial.lines) {
    const lineRef = db.collection(OPENING_CONFERENCE_LINES).doc(listed.id);
    const prepared = await db.runTransaction(async (tx) => {
      const { box } = await readBox(tx, db, scope);
      const snapshot = await tx.get(lineRef);
      if (!snapshot.exists || snapshot.get("status") === "committed") return null;
      if (box.status !== "committing") throw new HttpsError("failed-precondition", "O estado da caixa mudou. Atualize a tela.");
      const line = snapshot.data()!;
      if (line.box_code !== scope.box_code || line.customer_code !== scope.customer_code || line.session_id !== scope.session_id) throw new HttpsError("permission-denied", "Linha de outra caixa ou cliente.");
      if (line.status === "processing") return { input: line.prepared_input as RecordCycleCountInput, commitId: str(box.conference_commit_id), version: Number(line.version) };
      // A versão muda apenas com edição humana de uma linha ainda não publicada.
      const input: RecordCycleCountInput = clean({
        mode: "opening", session_id: scope.session_id, customer_code: scope.customer_code, box_code: scope.box_code,
        sku_code: str(line.sku_code), client_item_code: str(line.client_item_code), product_name: str(line.product_name),
        product_registration: str(line.product_registration), category: str(line.category), genero: str(line.genero), grupo: str(line.grupo),
        barcode: str(line.barcode), brand: str(line.brand), size: str(line.size), color: str(line.color),
        photo_urls: Array.isArray(line.photo_urls) ? line.photo_urls as string[] : [],
        photo_storage_paths: Array.isArray(line.photo_storage_paths) ? line.photo_storage_paths as string[] : [],
        location_id: str(box.location_id), counted_qty: Number(line.counted_qty), unit_cost: Number(line.unit_cost),
        reason: str(line.reason), reference: str(line.reference),
        occurred_at: str(box.conference_commit_started_at),
        idempotency_key: `conference-${scope.box_code}-${listed.id}-v${Number(line.version)}`,
      });
      tx.update(lineRef, { status: "processing", prepared_input: input, error: null, updated_at: FieldValue.serverTimestamp() });
      return { input, commitId: str(box.conference_commit_id), version: Number(line.version) };
    });
    if (!prepared) continue;
    try {
      const result = await recordCycleCountTransaction(db, prepared.input, actor, { conference_commit_id: prepared.commitId });
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(lineRef);
        if (snapshot.get("status") === "committed") return;
        if (snapshot.get("version") !== prepared.version || snapshot.get("status") !== "processing") throw new HttpsError("aborted", "A linha mudou durante a guarda.");
        tx.update(lineRef, { status: "committed", result: clean(result), error: null, committed_at: FieldValue.serverTimestamp() });
      });
    } catch (error) {
      // Falha transitória/timeout deixa processing: só o replay pode dizer se a
      // transação confirmou. Falha de validação não confirmou: liberar edição.
      if (isDefinitive(error)) {
        await db.runTransaction(async (tx) => {
          const snapshot = await tx.get(lineRef);
          if (snapshot.get("version") === prepared.version && snapshot.get("status") === "processing") {
            tx.update(lineRef, { status: "failed", error: error.message, updated_at: FieldValue.serverTimestamp() });
            event(tx, db, "inventory.opening_box_storage_failed", scope, actor, { line_id: listed.id, error: error.message });
          }
        });
      }
      throw error;
    }
  }

  return db.runTransaction(async (tx) => {
    const { ref, box } = await readBox(tx, db, scope);
    if (box.status === "stored" && box.conference_commit_id) return { ok: true, box };
    const lines = await tx.get(lineQuery(db, scope.box_code));
    if (!lines.size || lines.docs.some((line) => line.get("status") !== "committed")) throw new HttpsError("failed-precondition", "Ainda há produtos pendentes. Corrija a linha indicada e retome a guarda.");
    const updates = { status: "stored", opening_closed: true, stored_at: new Date().toISOString(), stored_by: actorData(actor) };
    tx.update(ref, { ...updates, updated_at: FieldValue.serverTimestamp() });
    event(tx, db, "warehouse.box_stored", scope, actor, { box: { ...box, ...updates }, conference: true });
    return { ok: true, box: { ...box, ...updates } };
  });
}
