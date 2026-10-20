import { createHash, randomUUID } from "node:crypto";
import {
  commitRequestNumber,
  portalRequestItems,
  requestNumberPrefix,
  reserveRequestNumber,
} from "./request-numbers.js";

import { receivedSummary } from "./client-shipments.js";
import {
  LEGACY_CUSTOMER_CODE,
  assertCatalogOwnedBy,
  openingInventoryBlocksOutbound,
  openingUsesGlobalControl,
} from "./customer-scope.js";
import {
  assertBarcodeAvailable,
  normalizeBarcode,
  openSkuAllocator,
  type SkuAllocator,
} from "./catalog-codes.js";
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

const collections = {
  events: "events",
  agentInbox: "ai_agent_inbox",
  operations: "operational_operations",
  customerRequests: "customer_requests",
  stockBalances: "stock_balances",
  orders: "orders",
  orderItems: "order_items",
  stockReservations: "stock_reservations",
  pickTasks: "pick_tasks",
  pickLines: "pick_lines",
  putawayTasks: "putaway_tasks",
  inboundReceipts: "inbound_receipts",
  inboundItems: "inbound_items",
  returns: "returns",
  returnItems: "return_items",
  packTasks: "pack_tasks",
  packages: "packages",
  packageItems: "package_items",
  shipments: "shipments",
  shipmentItems: "shipment_items",
  movements: "movements",
  cycleCounts: "cycle_counts",
  openingInventorySessions: "opening_inventory_sessions",
  openingInventoryLines: "opening_inventory_lines",
  clientInventory: "client_inventory",
  products: "products",
  skus: "skus",
  clientOrderTracking: "client_order_tracking",
  clientRequestStatus: "client_request_status",
  systemControls: "system_controls",
  opsAggregates: "ops_aggregates",
} as const;

export type OperationalActor = {
  uid: string;
  email?: string;
  role: string;
  customer_code?: string;
  name?: string;
};

export type OperationalRequestItem = {
  line_number?: number;
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  product_registration?: "existing" | "new" | string;
  location_id?: string;
  condition?: string;
  category?: string;
  barcode?: string;
  brand?: string;
  size?: string;
  color?: string;
  photo_urls?: string[];
  photo_storage_paths?: string[];
  unit_cost?: number;
  quantity: number;
  notes?: string;
};

export type CreateOperationalRequestInput = {
  type: string;
  priority: string;
  title?: string;
  description?: string;
  destination?: string;
  due_at?: string;
  supplier?: string;
  invoice_number?: string;
  attachments?: Array<{
    file_name: string;
    file_url: string;
    storage_path: string;
    content_type: string;
    size_bytes: number;
  }>;
  customer_code: string;
  idempotency_key: string;
  items: OperationalRequestItem[];
};

export type CreateInboundReceiptInput = {
  customer_code: string;
  supplier?: string;
  invoice_number?: string;
  reference?: string;
  notes?: string;
  priority?: string;
  received_at?: string;
  idempotency_key: string;
  items: OperationalRequestItem[];
};

export type UpdateInboundReceiptConferenceInput = {
  receipt_id: string;
  expected_status?: string;
  idempotency_key: string;
  lines: Array<{
    inbound_item_id: string;
    received_qty: number;
    location_id?: string;
    unit_cost?: number;
    notes?: string;
    /** Código lido na etiqueta, para linha avisada com "código a definir". */
    client_item_code?: string;
  }>;
};

export type CreateReturnReceiptInput = {
  customer_code: string;
  source?: string;
  reference?: string;
  notes?: string;
  received_at?: string;
  idempotency_key: string;
  items: OperationalRequestItem[];
};

export type SetReturnDispositionInput = {
  return_item_id: string;
  disposition: "available" | "damaged" | "quarantine" | "discard";
  location_id?: string;
  unit_cost?: number;
  notes?: string;
  expected_status?: string;
  occurred_at?: string;
  idempotency_key: string;
};

export type DecideOperationalRequestInput = {
  request_id: string;
  action: "approve" | "reject" | "close" | "cancel";
  reason?: string;
  expected_status: string;
  idempotency_key?: string;
};

export type AdvanceOperationalTaskInput = {
  task_uid: string;
  note?: string;
  expected_status?: string;
  idempotency_key?: string;
  operation?: {
    picking_lines?: Array<{
      pick_line_id: string;
      qty_picked: number;
      status?: string;
      notes?: string;
    }>;
    packing_lines?: Array<{
      order_item_id: string;
      qty_packed: number;
      status?: string;
      notes?: string;
    }>;
    package_count?: number;
    volume_label?: string;
    seal_code?: string;
    package_notes?: string;
    carrier?: string;
    driver_name?: string;
    vehicle_plate?: string;
    proof_reference?: string;
    delivery_notes?: string;
    source_location_id?: string;
    destination_location_id?: string;
    location_id?: string;
    quantity?: number;
  };
};

export type CreateInventoryMovementInput = {
  type: "ENTRADA" | "SAIDA";
  quantity: number;
  customer_code: string;
  sku_code: string;
  client_item_code?: string;
  product_name?: string;
  location_id: string;
  unit_cost?: number;
  reason: string;
  reference?: string;
  occurred_at?: string;
  idempotency_key: string;
};

export type RecordCycleCountInput = {
  mode?: "cycle" | "opening";
  session_id?: string;
  customer_code: string;
  /** Produto novo na abertura vem sem SKU: ele é gerado na transação. */
  sku_code?: string;
  client_item_code?: string;
  product_name?: string;
  product_registration?: "existing" | "new" | string;
  category?: string;
  genero?: string;
  grupo?: string;
  barcode?: string;
  brand?: string;
  size?: string;
  color?: string;
  photo_urls?: string[];
  photo_storage_paths?: string[];
  location_id: string;
  counted_qty: number;
  unit_cost?: number;
  reason: string;
  reference?: string;
  /** Caixa (unidade de manuseio) onde o produto foi lançado; só na abertura. */
  box_code?: string;
  occurred_at?: string;
  idempotency_key: string;
};

export type CreateOpeningInventorySessionInput = {
  customer_code: string;
  reference?: string;
  notes?: string;
  idempotency_key: string;
};

export type CompleteOpeningInventorySessionInput = {
  customer_code: string;
  session_id: string;
  notes?: string;
  idempotency_key: string;
};

export type RemoveOpeningInventoryLineInput = {
  customer_code: string;
  session_id: string;
  opening_line_id: string;
  idempotency_key: string;
};

export type OperationalEventInput = {
  type: string;
  title: string;
  description?: string;
  severity?: "info" | "attention" | "critical";
  entity_type?: string;
  entity_id?: string | number;
  customer_code?: string;
  customer_name?: string;
  payload?: Record<string, unknown>;
  occurred_at?: string;
  dedupe_key?: string;
  source?: string;
  /** false: grava o evento sem abrir item na caixa do agente. */
  inbox?: boolean;
};

export type OperationalEventSummary = {
  id: string;
  type: string;
  severity: "info" | "attention" | "critical";
  entity_type?: string;
  entity_id?: string | number;
  customer_code?: string;
};

type Row = {
  id: string;
  ref: DocumentReference<DocumentData>;
  data: Record<string, unknown>;
};

type BalanceState = {
  row: Row;
  skuCode: string;
  locationId: string;
  qtyOnHand: number;
  qtyReserved: number;
};

type StockAllocation = {
  item: OperationalRequestItem;
  clientLineNumber: number;
  row: Row;
  reservationRow?: Row;
  locationId: string;
  quantity: number;
};

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, compactValue(item)]),
    );
  }
  return value;
}

function safeDocId(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function digest(value: unknown, length = 32) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, length);
}

function actorPayload(actor: OperationalActor) {
  return compact({
    uid: actor.uid,
    email: actor.email,
    name: actor.name,
    role: actor.role,
    customer_code: actor.customer_code,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedIdentity(value: unknown) {
  return text(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringList(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
}

function requiredPositive(value: unknown, label: string) {
  const parsed = number(value);
  if (parsed <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${label} deve ser maior que zero.`,
    );
  }
  return parsed;
}

function requestType(type: unknown) {
  const normalized = text(type).toLowerCase();
  return {
    outbound: normalized.includes("retirada") || normalized.includes("ajuste"),
    inbound: normalized.includes("receb"),
  };
}

function itemSummary(items: OperationalRequestItem[], fallback: string) {
  if (!items.length) return fallback;
  const summary = items
    .slice(0, 3)
    .map(
      (item) =>
        `${item.quantity}x ${item.product_name ?? item.sku_code ?? "item"}`,
    )
    .join(", ");
  return items.length > 3
    ? `${summary} +${items.length - 3} item(ns)`
    : summary;
}

function eventSummary(
  id: string,
  input: OperationalEventInput,
): OperationalEventSummary {
  return compact({
    id,
    type: input.type,
    severity: input.severity ?? "info",
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    customer_code: input.customer_code,
  }) as OperationalEventSummary;
}

function eventSummaryFromData(id: string, data: Record<string, unknown>) {
  return eventSummary(id, {
    type: text(data.type),
    title: text(data.title),
    severity:
      data.severity === "attention" || data.severity === "critical"
        ? data.severity
        : "info",
    entity_type: text(data.entity_type) || undefined,
    entity_id:
      typeof data.entity_id === "number" || typeof data.entity_id === "string"
        ? data.entity_id
        : undefined,
    customer_code: text(data.customer_code) || undefined,
  });
}

export function createEvent(
  transaction: Transaction,
  db: Firestore,
  id: string,
  input: OperationalEventInput,
  actor: OperationalActor,
) {
  const severity = input.severity ?? "info";
  const payload = compact({
    id,
    type: input.type,
    title: input.title,
    description: input.description ?? "",
    severity,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    customer_code: input.customer_code,
    customer_name: input.customer_name,
    payload: compactValue(input.payload ?? {}),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    source: input.source ?? "functions",
    dedupe_hash: input.dedupe_key ? digest(input, 64) : undefined,
    actor: actorPayload(actor),
    created_at: FieldValue.serverTimestamp(),
  });
  transaction.create(db.collection(collections.events).doc(id), payload);

  if (
    input.inbox !== false &&
    (severity === "attention" || severity === "critical")
  ) {
    const inboxId = `inbox_${safeDocId(id)}`;
    transaction.create(
      db.collection(collections.agentInbox).doc(inboxId),
      compact({
        id: inboxId,
        event_id: id,
        status: "open",
        severity,
        title: input.title,
        description: input.description,
        customer_code: input.customer_code,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        source: "functions_event",
        actor: actorPayload(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
  }

  return eventSummary(id, input);
}

function operationEventId(operationId: string, suffix: string) {
  return `evt_${digest({ operationId, suffix })}`;
}

function movementId(operationId: string, suffix: string) {
  return `mov_${digest({ operationId, suffix })}`;
}

function operationResult<T>(
  snapshot: DocumentData,
  inputHash: string,
): T | undefined {
  if (!snapshot.exists) return undefined;
  const data = asRecord(snapshot.data());
  if (data.input_hash !== inputHash) {
    throw new HttpsError(
      "already-exists",
      "A chave de idempotência já foi usada com outro conteúdo.",
    );
  }
  if (!data.result || typeof data.result !== "object") {
    throw new HttpsError(
      "failed-precondition",
      "A operação idempotente existe, mas não possui resultado válido.",
    );
  }
  return data.result as T;
}

function createOperationReceipt(
  transaction: Transaction,
  ref: DocumentReference<DocumentData>,
  inputHash: string,
  kind: string,
  targetId: string,
  actor: OperationalActor,
  result: Record<string, unknown>,
) {
  transaction.create(ref, {
    id: ref.id,
    kind,
    target_id: targetId,
    input_hash: inputHash,
    status: "completed",
    actor: actorPayload(actor),
    result: compactValue(result),
    created_at: FieldValue.serverTimestamp(),
    completed_at: FieldValue.serverTimestamp(),
  });
}

async function readRows(
  transaction: Transaction,
  query: Query<DocumentData>,
): Promise<Row[]> {
  const snapshot = await transaction.get(query);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data(),
  }));
}

async function assertInventoryOperationsEnabled(
  transaction: Transaction,
  db: Firestore,
) {
  const snapshot = await transaction.get(
    db.collection(collections.systemControls).doc("inventory"),
  );
  if (!snapshot.exists) return {};

  const control = snapshot.data() ?? {};
  if (
    control.movements_frozen === true ||
    control.reconciliation_status === "running"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Movimentações de estoque estão temporariamente bloqueadas para reconciliação.",
      {
        code: "INVENTORY_RECONCILIATION_IN_PROGRESS",
        reconciliation_id: control.reconciliation_id ?? null,
      },
    );
  }
  return control;
}

function exactBalanceQuery(
  db: Firestore,
  customerCode: string,
  skuCode: string,
  locationId: string,
) {
  return db
    .collection(collections.stockBalances)
    .where("customer_code", "==", customerCode)
    .where("sku_code", "==", skuCode)
    .where("location_id", "==", locationId)
    .limit(2);
}

function skuBalancesQuery(
  db: Firestore,
  customerCode: string,
  skuCode: string,
) {
  return db
    .collection(collections.stockBalances)
    .where("customer_code", "==", customerCode)
    .where("sku_code", "==", skuCode);
}

function assertSingleBalance(rows: Row[], skuCode: string, locationId: string) {
  if (rows.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      `Saldo não encontrado para SKU ${skuCode} no local ${locationId}.`,
    );
  }
  if (rows.length > 1) {
    throw new HttpsError(
      "failed-precondition",
      `Mais de um saldo existe para SKU ${skuCode} no local ${locationId}.`,
    );
  }
  return rows[0];
}

function balanceKey(customerCode: string, skuCode: string, locationId: string) {
  return `${customerCode}\u0000${skuCode}\u0000${locationId}`;
}

const CLIENT_SCOPED_SKUS = new Set(["BTG-1043"]);

function clientScopedInventoryId(
  customerCode: string,
  skuCode: string,
  clientItemCode?: string,
) {
  const scope =
    clientItemCode && CLIENT_SCOPED_SKUS.has(skuCode)
      ? `__${clientItemCode}`
      : "";
  return safeDocId(`cinv_${customerCode}__${skuCode}${scope}`);
}

/**
 * A projeção client_inventory de um SKU escopado (CLIENT_SCOPED_SKUS) é
 * mantida por variante de cod_cliente. Somas agregadas destinadas a um doc
 * escopado devem considerar apenas os saldos daquela variante — nunca as
 * variantes irmãs que compartilham o mesmo SKU.
 */
function variantScopedBalanceRows(
  rows: Row[],
  skuCode: string,
  clientItemCode?: string,
) {
  if (!clientItemCode || !CLIENT_SCOPED_SKUS.has(skuCode)) return rows;
  const variantKey = normalizedIdentity(clientItemCode);
  return rows.filter(
    (row) => normalizedIdentity(row.data.client_item_code) === variantKey,
  );
}

function clientTimelineEntry(
  status: string,
  label: string,
  actor: OperationalActor,
  occurredAt = new Date().toISOString(),
) {
  return {
    status,
    label,
    occurred_at: occurredAt,
    actor_name: actor.name ?? actor.email ?? "Dutelog",
  };
}

function updateClientInventory(
  transaction: Transaction,
  db: Firestore,
  input: {
    customerCode: string;
    skuCode: string;
    clientItemCode?: string;
    productName?: string;
    category?: string;
    barcode?: string;
    brand?: string;
    size?: string;
    color?: string;
    photoUrls?: string[];
    unitCost?: number;
    onHandDelta?: number;
    reservedDelta?: number;
  },
) {
  const onHandDelta = number(input.onHandDelta);
  const reservedDelta = number(input.reservedDelta);
  const unitCost = number(input.unitCost);
  const ref = db
    .collection(collections.clientInventory)
    .doc(
      clientScopedInventoryId(
        input.customerCode,
        input.skuCode,
        input.clientItemCode,
      ),
    );
  transaction.set(
    ref,
    compact({
      id: ref.id,
      customer_code: input.customerCode,
      sku_code: input.skuCode,
      client_item_code: input.clientItemCode,
      product_name: input.productName ?? input.skuCode,
      category: input.category,
      barcode: input.barcode,
      brand: input.brand,
      size: input.size,
      color: input.color,
      photo_urls: input.photoUrls?.length ? input.photoUrls : undefined,
      primary_photo_url: input.photoUrls?.[0],
      unit_cost: unitCost || undefined,
      qty_on_hand: onHandDelta ? FieldValue.increment(onHandDelta) : undefined,
      qty_reserved: reservedDelta
        ? FieldValue.increment(reservedDelta)
        : undefined,
      qty_available:
        onHandDelta || reservedDelta
          ? FieldValue.increment(onHandDelta - reservedDelta)
          : undefined,
      total_cost:
        onHandDelta && unitCost
          ? FieldValue.increment(onHandDelta * unitCost)
          : undefined,
      status: "active",
      source: "operational_projection",
      published_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }),
    { merge: true },
  );
}

function setClientInventorySnapshot(
  transaction: Transaction,
  db: Firestore,
  input: {
    customerCode: string;
    skuCode: string;
    clientItemCode?: string;
    productName?: string;
    category?: string;
    barcode?: string;
    brand?: string;
    size?: string;
    color?: string;
    photoUrls?: string[];
    unitCost?: number;
    qtyOnHand: number;
    qtyReserved: number;
  },
) {
  const ref = db
    .collection(collections.clientInventory)
    .doc(
      clientScopedInventoryId(
        input.customerCode,
        input.skuCode,
        input.clientItemCode,
      ),
    );
  const unitCost = number(input.unitCost);
  transaction.set(
    ref,
    compact({
      id: ref.id,
      customer_code: input.customerCode,
      sku_code: input.skuCode,
      client_item_code: input.clientItemCode,
      product_name: input.productName ?? input.skuCode,
      category: input.category,
      barcode: input.barcode,
      brand: input.brand,
      size: input.size,
      color: input.color,
      photo_urls: input.photoUrls?.length ? input.photoUrls : undefined,
      primary_photo_url: input.photoUrls?.[0],
      unit_cost: unitCost,
      qty_on_hand: input.qtyOnHand,
      qty_reserved: input.qtyReserved,
      qty_available: input.qtyOnHand - input.qtyReserved,
      total_cost: input.qtyOnHand * unitCost,
      status: input.qtyOnHand > 0 ? "active" : "empty",
      source: "operational_projection",
      published_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }),
    { merge: true },
  );
}

type CatalogAggregateTarget = {
  productRef?: DocumentReference<DocumentData>;
  skuRef?: DocumentReference<DocumentData>;
};

/**
 * Localiza os documentos de catálogo (products/skus) cujos agregados de
 * estoque (estoque_atual, estoque_disponivel, estoque_reservado, estoque_btg,
 * custo_total) devem acompanhar o ledger. Precisa rodar na fase de leitura da
 * transação (antes de qualquer write). Docs inexistentes são ignorados — os
 * agregados só são mantidos para itens já cadastrados.
 */
async function resolveCatalogAggregateTargets(
  transaction: Transaction,
  db: Firestore,
  skuCode: string,
  clientItemCode?: string,
): Promise<CatalogAggregateTarget> {
  const normalizedSku = normalizedIdentity(skuCode);
  if (!normalizedSku) return {};
  const rawSku = text(skuCode);
  const skuDirectRef = db.collection(collections.skus).doc(safeDocId(normalizedSku));
  const clientKey = normalizedIdentity(clientItemCode ?? "");
  const rawClient = text(clientItemCode ?? "");
  const productDirectRef = clientKey
    ? db.collection(collections.products).doc(safeDocId(clientKey))
    : undefined;
  // Mesmas consultas de identidade usadas por mutateManagedEntity em
  // index.ts: docs importados (tools/import_btg_firestore.py) têm ids
  // stable_id() e só carregam cod_btg/sku_code/cod_cliente crus, sem os
  // campos *_key normalizados.
  const skuQueries = [
    db.collection(collections.skus).where("sku_code_key", "==", normalizedSku),
    db.collection(collections.skus).where("cod_btg", "==", rawSku),
    db.collection(collections.skus).where("sku_code", "==", rawSku),
  ];
  const productQueries = clientKey
    ? [
        db
          .collection(collections.products)
          .where("cod_cliente_key", "==", clientKey),
        db.collection(collections.products).where("cod_cliente", "==", rawClient),
      ]
    : [];
  const [skuSnapshot, productSnapshot, skuRowSets, productRowSets] =
    await Promise.all([
      transaction.get(skuDirectRef),
      productDirectRef
        ? transaction.get(productDirectRef)
        : Promise.resolve(undefined),
      Promise.all(
        skuQueries.map((query) => readRows(transaction, query.limit(2))),
      ),
      Promise.all(
        productQueries.map((query) => readRows(transaction, query.limit(2))),
      ),
    ]);
  const skuRowRef = skuRowSets.find((rows) => rows.length > 0)?.[0]?.ref;
  const productRowRef = productRowSets.find((rows) => rows.length > 0)?.[0]?.ref;
  return {
    skuRef: skuSnapshot.exists ? skuDirectRef : skuRowRef,
    productRef: productSnapshot?.exists ? productDirectRef : productRowRef,
  };
}

/**
 * Aplica deltas de estoque nos agregados de catálogo dentro da mesma
 * transação que mutou o ledger, mantendo skus.estoque_atual/estoque_reservado/
 * estoque_disponivel/custo_total e products.estoque_btg/custo_total coerentes
 * com stock_balances.
 */
function applyCatalogStockAggregates(
  transaction: Transaction,
  target: CatalogAggregateTarget,
  delta: { onHand?: number; reserved?: number; cost?: number },
) {
  const onHand = number(delta.onHand);
  const reserved = number(delta.reserved);
  const cost = number(delta.cost);
  if (!onHand && !reserved && !cost) return;
  if (target.skuRef) {
    transaction.update(
      target.skuRef,
      compact({
        estoque_atual: onHand ? FieldValue.increment(onHand) : undefined,
        estoque_reservado: reserved ? FieldValue.increment(reserved) : undefined,
        estoque_disponivel:
          onHand - reserved
            ? FieldValue.increment(onHand - reserved)
            : undefined,
        custo_total: cost ? FieldValue.increment(cost) : undefined,
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
  }
  if (target.productRef) {
    transaction.update(
      target.productRef,
      compact({
        estoque_btg: onHand ? FieldValue.increment(onHand) : undefined,
        custo_total: cost ? FieldValue.increment(cost) : undefined,
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
  }

  // Keep the dashboard rollup in sync with ledger deltas (Admin SDK path).
  const aggregateDb = target.skuRef?.firestore ?? target.productRef?.firestore;
  if (aggregateDb && (onHand || cost)) {
    transaction.set(
      aggregateDb.collection(collections.opsAggregates).doc("dashboard"),
      compact({
        id: "dashboard",
        total_pecas: onHand ? FieldValue.increment(onHand) : undefined,
        custo_total: cost ? FieldValue.increment(cost) : undefined,
        updated_at: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );
  }
}

function updateClientTracking(
  transaction: Transaction,
  db: Firestore,
  orderId: string,
  data: Record<string, unknown>,
) {
  transaction.set(
    db.collection(collections.clientOrderTracking).doc(orderId),
    compact({
      id: orderId,
      ...data,
      published_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }),
    { merge: true },
  );
}

function createMovement(
  transaction: Transaction,
  db: Firestore,
  id: string,
  input: {
    type: "ENTRADA" | "SAIDA";
    quantity: number;
    customerCode: string;
    skuCode: string;
    clientItemCode?: string;
    productName?: string;
    locationId: string;
    beforeQty: number;
    afterQty: number;
    source: string;
    occurredAt: string;
    entity: Record<string, unknown>;
  },
  actor: OperationalActor,
) {
  const sign = input.type === "ENTRADA" ? 1 : -1;
  transaction.create(
    db.collection(collections.movements).doc(id),
    compact({
      id,
      data: input.occurredAt,
      occurred_at: input.occurredAt,
      type:
        input.type === "ENTRADA" ? "inventory.received" : "inventory.shipped",
      tipo_mov: input.type,
      sign,
      sinal: sign,
      quantity: input.quantity,
      qtde: input.quantity,
      customer_code: input.customerCode,
      cod_cliente: input.customerCode,
      sku_code: input.skuCode,
      cod_sku: input.skuCode,
      client_item_code: input.clientItemCode,
      product_name: input.productName,
      produto: input.productName ?? input.skuCode,
      location_id: input.locationId,
      qty_before: input.beforeQty,
      estoque_anterior: input.beforeQty,
      qty_after: input.afterQty,
      estoque_resultante: input.afterQty,
      saldo_delta: sign * input.quantity,
      source: input.source,
      actor: actorPayload(actor),
      ...input.entity,
      created_at: FieldValue.serverTimestamp(),
    }),
  );
}

export async function createInventoryMovementTransaction(
  db: Firestore,
  input: CreateInventoryMovementInput,
  actor: OperationalActor,
) {
  if (input.type !== "ENTRADA" && input.type !== "SAIDA") {
    throw new HttpsError(
      "invalid-argument",
      "Tipo de movimentação inválido. Use ENTRADA ou SAIDA.",
    );
  }
  const quantity = requiredPositive(input.quantity, "Quantidade");
  const customerCode = text(input.customer_code);
  const skuCode = normalizedIdentity(input.sku_code);
  const locationId = text(input.location_id);
  const reason = text(input.reason);
  if (!customerCode || !skuCode || !locationId || !reason) {
    throw new HttpsError(
      "invalid-argument",
      "Cliente, SKU, local e motivo são obrigatórios.",
    );
  }

  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const operationId = `op_inventory_${digest({
    customer: customerCode,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    const balanceRows = await readRows(
      transaction,
      exactBalanceQuery(db, customerCode, skuCode, locationId),
    );
    if (balanceRows.length > 1) {
      throw new HttpsError(
        "failed-precondition",
        `Mais de um saldo existe para SKU ${skuCode} no local ${locationId}.`,
      );
    }

    const balanceRow = balanceRows[0];
    const beforeOnHand = number(balanceRow?.data.qty_on_hand);
    const beforeReserved = number(balanceRow?.data.qty_reserved);
    const available = beforeOnHand - beforeReserved;
    if (input.type === "SAIDA" && available < quantity) {
      throw new HttpsError(
        "failed-precondition",
        `Saldo disponível insuficiente para ${skuCode}: ${available}.`,
      );
    }

    const catalogTargets = await resolveCatalogAggregateTargets(
      transaction,
      db,
      skuCode,
      text(input.client_item_code) ||
        text(balanceRow?.data.client_item_code) ||
        undefined,
    );

    const delta = input.type === "ENTRADA" ? quantity : -quantity;
    const afterOnHand = beforeOnHand + delta;
    const balanceId =
      balanceRow?.id ??
      safeDocId(`bal_${customerCode}__${skuCode}__${locationId}`);
    const balancePayload = compact({
      id: balanceId,
      customer_code: customerCode,
      sku_code: skuCode,
      client_item_code:
        text(input.client_item_code) ||
        text(balanceRow?.data.client_item_code) ||
        undefined,
      product_name:
        text(input.product_name) ||
        text(balanceRow?.data.product_name) ||
        skuCode,
      location_id: locationId,
      unit_cost: number(input.unit_cost || balanceRow?.data.unit_cost),
      qty_on_hand: afterOnHand,
      qty_reserved: beforeReserved,
      qty_available: afterOnHand - beforeReserved,
      status: afterOnHand > 0 ? "available" : "empty",
      source: "functions_inventory_movement",
      updated_at: FieldValue.serverTimestamp(),
    });

    if (balanceRow) {
      transaction.update(balanceRow.ref, balancePayload);
    } else {
      if (input.type !== "ENTRADA") {
        throw new HttpsError(
          "failed-precondition",
          `Saldo não encontrado para SKU ${skuCode} no local ${locationId}.`,
        );
      }
      transaction.create(
        db.collection(collections.stockBalances).doc(balanceId),
        {
          ...balancePayload,
          id: balanceId,
          created_at: FieldValue.serverTimestamp(),
        },
      );
    }

    const ledgerId = movementId(operationId, "manual");
    createMovement(
      transaction,
      db,
      ledgerId,
      {
        type: input.type,
        quantity,
        customerCode,
        skuCode,
        clientItemCode: text(input.client_item_code) || undefined,
        productName: text(input.product_name) || undefined,
        locationId,
        beforeQty: beforeOnHand,
        afterQty: afterOnHand,
        source: "functions_manual_inventory",
        occurredAt,
        entity: {
          reason,
          reference: text(input.reference) || undefined,
          operational_operation_id: operationId,
        },
      },
      actor,
    );

    updateClientInventory(transaction, db, {
      customerCode,
      skuCode,
      clientItemCode: text(input.client_item_code) || undefined,
      productName: text(input.product_name) || undefined,
      unitCost: number(input.unit_cost || balanceRow?.data.unit_cost),
      onHandDelta: delta,
    });
    applyCatalogStockAggregates(transaction, catalogTargets, {
      onHand: delta,
      cost: delta * number(input.unit_cost || balanceRow?.data.unit_cost),
    });

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "inventory_moved"),
      {
        type:
          input.type === "ENTRADA" ? "inventory.received" : "inventory.shipped",
        title:
          input.type === "ENTRADA"
            ? "Entrada manual de estoque"
            : "Saída manual de estoque",
        description: `${quantity} unidade(s) de ${skuCode}. ${reason}`,
        severity: "attention",
        entity_type: "movimentacao",
        entity_id: ledgerId,
        customer_code: customerCode,
        payload: {
          movement_id: ledgerId,
          sku_code: skuCode,
          location_id: locationId,
          quantity,
          before_qty: beforeOnHand,
          after_qty: afterOnHand,
          reason,
          reference: text(input.reference) || undefined,
        },
      },
      actor,
    );

    const result = compact({
      ok: true,
      id: ledgerId,
      movement_id: ledgerId,
      stock_balance_id: balanceId,
      qty_before: beforeOnHand,
      qty_after: afterOnHand,
      events: [event],
    });
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inventory.movement",
      ledgerId,
      actor,
      result,
    );
    return result;
  });
}

export function openingInventorySessionDocumentId(customerCode: string) {
  return safeDocId(`opening_${customerCode}`);
}

export async function createOpeningInventorySessionTransaction(
  db: Firestore,
  input: CreateOpeningInventorySessionInput,
  actor: OperationalActor,
) {
  const customerCode = text(input.customer_code);
  if (!customerCode) {
    throw new HttpsError("invalid-argument", "Cliente é obrigatório.");
  }

  const sessionId = openingInventorySessionDocumentId(customerCode);
  const operationId = `op_opening_inventory_start_${digest({
    customer: customerCode,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const sessionRef = db
    .collection(collections.openingInventorySessions)
    .doc(sessionId);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(sessionRef),
    ]);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    if (sessionSnapshot.exists) {
      const session = asRecord(sessionSnapshot.data());
      if (text(session.status) === "completed") {
        throw new HttpsError(
          "failed-precondition",
          "O inventário de abertura deste cliente já foi concluído.",
        );
      }
      const result = {
        ok: true,
        id: sessionId,
        session_id: sessionId,
        status: "open",
        line_count: number(session.line_count),
        unit_count: number(session.unit_count),
        total_cost: number(session.total_cost),
        resumed: true,
        events: [],
      };
      createOperationReceipt(
        transaction,
        operationRef,
        inputHash,
        "inventory.opening.start",
        sessionId,
        actor,
        result,
      );
      return result;
    }

    const occurredAt = new Date().toISOString();
    transaction.create(
      sessionRef,
      compact({
        id: sessionId,
        customer_code: customerCode,
        status: "open",
        reference: text(input.reference) || undefined,
        notes: text(input.notes) || undefined,
        line_count: 0,
        unit_count: 0,
        total_cost: 0,
        source: "functions_opening_inventory",
        actor: actorPayload(actor),
        started_at: occurredAt,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    // system_controls/inventory é a abertura do cliente legado (a BTG):
    // a contagem de outro cliente trava só os pedidos dele, pela sessão.
    if (openingUsesGlobalControl(customerCode)) {
      transaction.set(
        db.collection(collections.systemControls).doc("inventory"),
        {
          stock_initialized: false,
          opening_inventory_required: true,
          opening_inventory_session_id: sessionId,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "opening_inventory_started"),
      {
        type: "inventory.opening_started",
        title: "Inventário de abertura iniciado",
        description: `Contagem inicial de ${customerCode} aberta pela operação.`,
        severity: "info",
        entity_type: "opening_inventory_session",
        entity_id: sessionId,
        customer_code: customerCode,
        payload: {
          reference: text(input.reference) || undefined,
        },
      },
      actor,
    );
    const result = {
      ok: true,
      id: sessionId,
      session_id: sessionId,
      status: "open",
      line_count: 0,
      unit_count: 0,
      total_cost: 0,
      resumed: false,
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inventory.opening.start",
      sessionId,
      actor,
      result,
    );
    return result;
  });
}

export async function completeOpeningInventorySessionTransaction(
  db: Firestore,
  input: CompleteOpeningInventorySessionInput,
  actor: OperationalActor,
) {
  const customerCode = text(input.customer_code);
  const sessionId = safeDocId(input.session_id);
  if (!customerCode || !sessionId) {
    throw new HttpsError(
      "invalid-argument",
      "Cliente e sessão de inventário são obrigatórios.",
    );
  }
  if (sessionId !== openingInventorySessionDocumentId(customerCode)) {
    throw new HttpsError(
      "permission-denied",
      "A sessão não pertence ao cliente informado.",
    );
  }

  const operationId = `op_opening_inventory_complete_${digest({
    customer: customerCode,
    session: sessionId,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const sessionRef = db
    .collection(collections.openingInventorySessions)
    .doc(sessionId);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(sessionRef),
    ]);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);

    if (!sessionSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Inventário de abertura não iniciado.",
      );
    }
    const session = asRecord(sessionSnapshot.data());
    const status = text(session.status);
    if (status === "completed") {
      throw new HttpsError(
        "failed-precondition",
        "O inventário de abertura já foi concluído.",
      );
    }
    if (number(session.line_count) < 1) {
      throw new HttpsError(
        "failed-precondition",
        "Registre ao menos um produto antes de concluir o inventário de abertura.",
      );
    }

    // A leitura participa da mesma transação da conclusão. A criação de caixa
    // também atualiza a sessão, impedindo uma caixa nova entre a checagem e o commit.
    const pendingBoxes = await transaction.get(
      db.collection("warehouse_boxes")
        .where("customer_code", "==", customerCode)
        .where("origin.session_id", "==", sessionId),
    );
    const pendingBox = pendingBoxes.docs.find((box) =>
      ["counting", "reviewed", "committing"].includes(text(box.get("status"))),
    );
    if (pendingBox) {
      throw new HttpsError(
        "failed-precondition",
        `Finalize a conferência e a guarda da caixa ${pendingBox.id} antes de concluir o inventário. Caixas vazias podem ser removidas.`,
      );
    }
    const occurredAt = new Date().toISOString();
    transaction.update(
      sessionRef,
      compact({
        status: "completed",
        completion_notes: text(input.notes) || undefined,
        completed_by: actorPayload(actor),
        completed_at: occurredAt,
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    if (openingUsesGlobalControl(customerCode)) {
      transaction.set(
        db.collection(collections.systemControls).doc("inventory"),
        {
          stock_initialized: true,
          opening_inventory_required: false,
          opening_inventory_session_id: sessionId,
          opening_inventory_completed_at: occurredAt,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "opening_inventory_completed"),
      {
        type: "inventory.opening_completed",
        title: "Inventário de abertura concluído",
        description: `${number(session.line_count)} produto(s) e ${number(
          session.unit_count,
        )} unidade(s) publicados no estoque.`,
        severity: "info",
        entity_type: "opening_inventory_session",
        entity_id: sessionId,
        customer_code: customerCode,
        payload: {
          line_count: number(session.line_count),
          unit_count: number(session.unit_count),
          total_cost: number(session.total_cost),
        },
      },
      actor,
    );
    const result = {
      ok: true,
      id: sessionId,
      session_id: sessionId,
      status: "completed",
      line_count: number(session.line_count),
      unit_count: number(session.unit_count),
      total_cost: number(session.total_cost),
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inventory.opening.complete",
      sessionId,
      actor,
      result,
    );
    return result;
  });
}

export async function recordCycleCountTransaction(
  db: Firestore,
  input: RecordCycleCountInput,
  actor: OperationalActor,
  internal?: { conference_commit_id: string },
) {
  const mode = input.mode === "opening" ? "opening" : "cycle";
  const customerCode = text(input.customer_code);
  // Produto novo na abertura: o SKU é gerado na sigla do cliente dentro da
  // transação (domain/catalog-codes.ts); o que vier digitado é ignorado.
  const generatesSku =
    mode === "opening" && text(input.product_registration) === "new";
  const requestedSku = generatesSku ? "" : normalizedIdentity(input.sku_code);
  const locationId = text(input.location_id);
  const reason = text(input.reason);
  const countedQty = number(input.counted_qty);
  const boxCode = mode === "opening" ? text(input.box_code).toUpperCase() : "";
  if (boxCode && !/^[A-Z0-9-]{1,20}$/.test(boxCode)) {
    throw new HttpsError("invalid-argument", "Código de caixa inválido.");
  }
  if (!customerCode || (!requestedSku && !generatesSku) || !locationId || !reason) {
    throw new HttpsError(
      "invalid-argument",
      "Cliente, SKU, local e motivo da contagem são obrigatórios.",
    );
  }
  if (countedQty < 0) {
    throw new HttpsError(
      "invalid-argument",
      "A contagem física não pode ser negativa.",
    );
  }

  const sessionId =
    mode === "opening" ? safeDocId(text(input.session_id)) : undefined;
  if (
    mode === "opening" &&
    (!sessionId || sessionId !== openingInventorySessionDocumentId(customerCode))
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Inicie o inventário de abertura deste cliente antes de registrar a contagem.",
    );
  }

  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const operationId = `op_${mode === "opening" ? "opening_inventory" : "cycle_count"}_${digest({
    customer: customerCode,
    // Produto novo ainda não tem SKU: o código do cliente distingue a operação.
    sku: requestedSku || `novo:${normalizedIdentity(input.client_item_code)}`,
    location: locationId,
    session: sessionId,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    // Leituras do SKU gerado (sigla, contador, código livre) e da
    // duplicidade por código de barras, antes de qualquer escrita. Recontar
    // como novo um cadastro arquivado do mesmo cliente reativa o SKU dele:
    // o histórico continua no mesmo código, sem gerar outro.
    let skuAllocator: SkuAllocator | undefined;
    let skuCode = requestedSku;
    if (generatesSku) {
      const clientKey = normalizedIdentity(input.client_item_code);
      const sameClientCode = clientKey
        ? await readRows(
            transaction,
            db.collection(collections.skus).where("cod_cliente_key", "==", clientKey),
          )
        : [];
      const archivedOwn =
        sameClientCode.length > 0 &&
        sameClientCode.every(
          (row) =>
            (row.data.archived === true || text(row.data.status) === "archived") &&
            (text(row.data.customer_code) || LEGACY_CUSTOMER_CODE) === customerCode,
        );
      const reactivated = archivedOwn
        ? normalizedIdentity(
            sameClientCode[0]!.data.cod_btg ||
              sameClientCode[0]!.data.sku_code ||
              sameClientCode[0]!.data.cod_sku,
          )
        : "";
      if (reactivated) {
        skuCode = reactivated;
      } else {
        skuAllocator = await openSkuAllocator(transaction, db, customerCode);
        skuCode = await skuAllocator.next();
      }
    }

    let openingSessionRef: DocumentReference<DocumentData> | undefined;
    let openingLineRef: DocumentReference<DocumentData> | undefined;
    let boxRef: DocumentReference<DocumentData> | undefined;
    let productRows: Row[] = [];
    let skuRows: Row[] = [];
    let productCodeSnapshot: DocumentSnapshot<DocumentData> | undefined;
    let skuCodeSnapshot: DocumentSnapshot<DocumentData> | undefined;
    if (mode === "opening" && sessionId) {
      openingSessionRef = db
        .collection(collections.openingInventorySessions)
        .doc(sessionId);
      openingLineRef = db
        .collection(collections.openingInventoryLines)
        .doc(
          safeDocId(
            `line_${digest(
              boxCode
                ? { sessionId, customerCode, skuCode, locationId, boxCode }
                : { sessionId, customerCode, skuCode, locationId },
              48,
            )}`,
          ),
        );
      const lookupClientCode = normalizedIdentity(input.client_item_code || skuCode);
      const [
        sessionSnapshot,
        lineSnapshot,
        foundProducts,
        foundSkus,
        productSnapshot,
        skuSnapshot,
      ] =
        await Promise.all([
          transaction.get(openingSessionRef),
          transaction.get(openingLineRef),
          readRows(
            transaction,
            db
              .collection(collections.products)
              .where("cod_cliente_key", "==", lookupClientCode),
          ),
          readRows(
            transaction,
            db
              .collection(collections.skus)
              .where("cod_cliente_key", "==", lookupClientCode),
          ),
          transaction.get(
            db.collection(collections.products).doc(safeDocId(lookupClientCode)),
          ),
          transaction.get(db.collection(collections.skus).doc(safeDocId(skuCode))),
        ]);
      // Caixa: precisa existir, ser do cliente e estar guardada nesta posição.
      boxRef = boxCode ? db.collection("warehouse_boxes").doc(boxCode) : undefined;
      const boxSnapshot = boxRef ? await transaction.get(boxRef) : undefined;
      if (boxRef) {
        const boxData = boxSnapshot?.exists ? boxSnapshot.data() ?? {} : undefined;
        if (!boxData) {
          throw new HttpsError(
            "not-found",
            `Caixa ${boxCode} não encontrada. Crie a caixa antes de lançar o produto.`,
          );
        }
        if (text(boxData.customer_code) !== customerCode) {
          throw new HttpsError("permission-denied", "A caixa pertence a outro cliente.");
        }
        const conferenceCommit =
          text(boxData.status) === "committing" &&
          Boolean(internal?.conference_commit_id) &&
          internal?.conference_commit_id === text(boxData.conference_commit_id);
        if (!conferenceCommit && (text(boxData.status) !== "stored" || boxData.opening_closed === true)) {
          throw new HttpsError("failed-precondition", `A caixa ${boxCode} está fechada ou ainda em conferência. Reabra a caixa antes de lançar.`);
        }
        if (conferenceCommit && text(asRecord(boxData.origin).session_id) !== sessionId) {
          throw new HttpsError("permission-denied", "A caixa pertence a outra sessão de inventário.");
        }
        if (text(boxData.location_id).toUpperCase() !== locationId.toUpperCase()) {
          throw new HttpsError(
            "failed-precondition",
            `A caixa ${boxCode} está em ${text(boxData.location_id)}, não em ${locationId}.`,
          );
        }
      }
      if (!sessionSnapshot.exists || text(sessionSnapshot.data()?.status) !== "open") {
        throw new HttpsError(
          "failed-precondition",
          "O inventário de abertura não está ativo.",
        );
      }
      if (text(sessionSnapshot.data()?.customer_code) !== customerCode) {
        throw new HttpsError(
          "permission-denied",
          "A sessão de inventário pertence a outro cliente.",
        );
      }
      if (lineSnapshot.exists) {
        throw new HttpsError(
          "already-exists",
          `O SKU ${skuCode} no local ${locationId} já foi contado neste inventário de abertura.`,
        );
      }
      productRows = foundProducts;
      skuRows = foundSkus;
      productCodeSnapshot = productSnapshot;
      skuCodeSnapshot = skuSnapshot;
    }

    const balanceRows = await readRows(
      transaction,
      exactBalanceQuery(db, customerCode, skuCode, locationId),
    );
    if (balanceRows.length > 1) {
      throw new HttpsError(
        "failed-precondition",
        `Mais de um saldo existe para SKU ${skuCode} no local ${locationId}.`,
      );
    }
    if (!balanceRows.length && mode !== "opening") {
      throw new HttpsError(
        "not-found",
        `Saldo não encontrado para SKU ${skuCode} no local ${locationId}. Cadastre o recebimento antes do inventário cíclico.`,
      );
    }

    const balanceRow =
      balanceRows[0] ??
      ({
        id: `bal_${digest({ customerCode, skuCode, locationId }, 48)}`,
        ref: db
          .collection(collections.stockBalances)
          .doc(`bal_${digest({ customerCode, skuCode, locationId }, 48)}`),
        data: {},
      } satisfies Row);
    const beforeOnHand = number(balanceRow.data.qty_on_hand);
    const beforeReserved = number(balanceRow.data.qty_reserved);
    // Com caixa, o mesmo SKU pode entrar mais de uma vez na mesma posição
    // (uma caixa por vez): a linha soma ao saldo que a própria abertura criou.
    const additive =
      Boolean(boxCode) &&
      beforeReserved === 0 &&
      (beforeOnHand === 0 ||
        text(balanceRow.data.opening_inventory_session_id) === sessionId);
    if (
      mode === "opening" &&
      !additive &&
      (beforeOnHand !== 0 || beforeReserved !== 0)
    ) {
      throw new HttpsError(
        "failed-precondition",
        `O SKU ${skuCode} no local ${locationId} já possui saldo. Use inventário cíclico para corrigir uma posição existente.`,
      );
    }
    const nextOnHand = additive ? beforeOnHand + countedQty : countedQty;
    if (nextOnHand < beforeReserved) {
      throw new HttpsError(
        "failed-precondition",
        `A contagem física (${countedQty}) é menor que a reserva ativa (${beforeReserved}). Resolva as reservas antes de ajustar o saldo.`,
      );
    }

    // Leituras adicionais (obrigatoriamente antes de qualquer write):
    // sem divergência, a projeção do cliente precisa dos saldos de TODAS as
    // localizações do SKU; com ajuste em modo cíclico, os agregados de
    // catálogo precisam ser localizados.
    const projectedDelta = nextOnHand - beforeOnHand;
    let cycleCatalogTargets: CatalogAggregateTarget = {};
    let aggregateBalanceRows: Row[] = [];
    if (projectedDelta === 0) {
      aggregateBalanceRows = await readRows(
        transaction,
        skuBalancesQuery(db, customerCode, skuCode),
      );
    } else if (mode === "cycle") {
      cycleCatalogTargets = await resolveCatalogAggregateTargets(
        transaction,
        db,
        skuCode,
        normalizedIdentity(input.client_item_code) ||
          normalizedIdentity(balanceRow.data.client_item_code) ||
          undefined,
      );
    }

    const requestedClientItemCode = normalizedIdentity(
      input.client_item_code || skuCode,
    );
    const wantsNewProduct = text(input.product_registration) === "new";
    if (mode === "opening") {
      // Um código de catálogo tem dono: a contagem de um cliente não
      // reaproveita o cadastro de outro (domain/customer-scope.ts).
      assertCatalogOwnedBy(
        customerCode,
        [
          ...productRows.map((row) => row.data),
          ...skuRows.map((row) => row.data),
          productCodeSnapshot?.exists ? productCodeSnapshot.data() : undefined,
        ],
        `O código ${requestedClientItemCode}`,
      );
      assertCatalogOwnedBy(
        customerCode,
        [skuCodeSnapshot?.exists ? skuCodeSnapshot.data() : undefined],
        `O SKU ${skuCode}`,
      );
      const existingSkuCodes = new Set(
        skuRows
          .map((row) =>
            text(row.data.cod_btg || row.data.sku_code || row.data.cod_sku),
          )
          .filter(Boolean),
      );
      const catalogExists =
        productRows.length > 0 ||
        skuRows.length > 0 ||
        Boolean(productCodeSnapshot?.exists) ||
        Boolean(skuCodeSnapshot?.exists);
      // Cadastro ARQUIVADO não conta como duplicidade: a exclusão pelo
      // Catálogo só arquiva o cartão, e a busca do formulário esconde
      // arquivados — sem isto o operador ficava num beco sem saída
      // ("não encontrado" na busca + "já existe" no envio). Recontar um
      // arquivado é reativação legítima: o catalogPayload já grava
      // archived: false / status: active.
      const rowIsArchived = (row: { data: Record<string, unknown> }) =>
        row.data.archived === true || text(row.data.status) === "archived";
      const snapshotIsArchived = (
        snapshot: typeof productCodeSnapshot,
      ) => {
        if (!snapshot?.exists) return false;
        const data = snapshot.data() ?? {};
        return data.archived === true || text(data.status) === "archived";
      };
      const catalogActiveExists =
        productRows.some((row) => !rowIsArchived(row)) ||
        skuRows.some((row) => !rowIsArchived(row)) ||
        (Boolean(productCodeSnapshot?.exists) &&
          !snapshotIsArchived(productCodeSnapshot)) ||
        (Boolean(skuCodeSnapshot?.exists) &&
          !snapshotIsArchived(skuCodeSnapshot));
      if (productRows.length > 1 || skuRows.length > 1) {
        throw new HttpsError(
          "failed-precondition",
          `O Cod. cliente ${requestedClientItemCode} possui cadastro duplicado. Corrija o catálogo antes de contar o item.`,
        );
      }
      // SKU gerado nunca está entre os existentes: para produto novo, o
      // código do cliente repetido cai no "já existe" logo abaixo.
      if (!generatesSku && existingSkuCodes.size > 0 && !existingSkuCodes.has(skuCode)) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${requestedClientItemCode} já está vinculado ao SKU ${[
            ...existingSkuCodes,
          ].join(", ")}. Use o cadastro existente.`,
        );
      }
      if (skuCodeSnapshot?.exists) {
        const skuData = skuCodeSnapshot.data() ?? {};
        const mappedClientCode = text(
          skuData.cod_cliente || skuData.client_item_code,
        );
        if (mappedClientCode && mappedClientCode !== requestedClientItemCode) {
          throw new HttpsError(
            "failed-precondition",
            `SKU ${skuCode} já está vinculado ao Cod. cliente ${mappedClientCode}.`,
          );
        }
      }
      if (wantsNewProduct && catalogActiveExists) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${requestedClientItemCode} ou SKU ${skuCode} já existe. Use o cadastro encontrado para evitar duplicidade.`,
        );
      }
      if (!wantsNewProduct && !catalogExists) {
        throw new HttpsError(
          "failed-precondition",
          `Produto não encontrado. Marque ${requestedClientItemCode} como novo produto e complete o cadastro.`,
        );
      }
      if (
        !wantsNewProduct &&
        (productRows.length === 0 && !productCodeSnapshot?.exists ||
          (skuRows.length === 0 && !skuCodeSnapshot?.exists))
      ) {
        throw new HttpsError(
          "failed-precondition",
          `O cadastro de ${requestedClientItemCode} está incompleto. Corrija produto e SKU antes de lançar saldo.`,
        );
      }
      if (wantsNewProduct) {
        if (
          !text(input.product_name) ||
          !text(input.category) ||
          !text(input.genero) ||
          !text(input.grupo)
        ) {
          throw new HttpsError(
            "invalid-argument",
            "Produto novo exige descrição, categoria, gênero e grupo.",
          );
        }
        if (number(input.unit_cost) <= 0) {
          throw new HttpsError(
            "invalid-argument",
            "Produto novo exige custo unitário maior que zero.",
          );
        }
        if (!stringList(input.photo_urls).length) {
          throw new HttpsError(
            "invalid-argument",
            "Produto novo exige ao menos uma foto.",
          );
        }
        // Depois das checagens de código: o código de barras de outro produto
        // ativo do mesmo cliente é o mesmo produto (domain/catalog-codes.ts).
        await assertBarcodeAvailable(transaction, db, customerCode, input.barcode, LEGACY_CUSTOMER_CODE);
      }
      if (!text(input.genero) || !text(input.grupo)) {
        throw new HttpsError(
          "invalid-argument",
          "Inventário de abertura exige gênero e grupo do produto.",
        );
      }
    }

    const delta = nextOnHand - beforeOnHand;
    const movementType = delta >= 0 ? "ENTRADA" : "SAIDA";
    const adjustmentQty = Math.abs(delta);
    const catalogProduct =
      productRows[0]?.data ?? productCodeSnapshot?.data() ?? {};
    const catalogSku = skuRows[0]?.data ?? skuCodeSnapshot?.data() ?? {};
    const unitCost = number(
      input.unit_cost ||
        balanceRow.data.unit_cost ||
        catalogSku.preco_unit ||
        catalogSku.unit_cost ||
        catalogProduct.preco_unit ||
        catalogProduct.unit_cost,
    );
    if (mode === "opening" && unitCost <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "Todo produto do inventário de abertura precisa de custo unitário maior que zero.",
      );
    }
    const clientItemCode =
      normalizedIdentity(input.client_item_code) ||
      normalizedIdentity(balanceRow.data.client_item_code) ||
      normalizedIdentity(catalogSku.cod_cliente) ||
      normalizedIdentity(catalogProduct.cod_cliente) ||
      undefined;
    const productName =
      text(input.product_name) ||
      text(balanceRow.data.product_name) ||
      text(catalogSku.produto || catalogSku.product_name) ||
      text(catalogProduct.produto || catalogProduct.product_name) ||
      skuCode;
    const category =
      text(input.category) ||
      text(balanceRow.data.category) ||
      text(catalogSku.category || catalogSku.categoria) ||
      text(catalogProduct.category || catalogProduct.categoria) ||
      undefined;
    const genero =
      text(input.genero) ||
      text(balanceRow.data.genero) ||
      text(catalogSku.genero || catalogProduct.genero) ||
      undefined;
    const grupo =
      text(input.grupo) ||
      text(balanceRow.data.grupo) ||
      text(catalogSku.grupo || catalogProduct.grupo) ||
      undefined;
    const barcode =
      text(input.barcode) ||
      text(balanceRow.data.barcode) ||
      text(catalogSku.barcode || catalogProduct.barcode) ||
      undefined;
    const brand =
      text(input.brand) ||
      text(balanceRow.data.brand) ||
      text(catalogSku.brand || catalogSku.marca || catalogProduct.brand || catalogProduct.marca) ||
      undefined;
    const size =
      text(input.size) ||
      text(balanceRow.data.size) ||
      text(catalogSku.size || catalogSku.tamanho || catalogProduct.size || catalogProduct.tamanho) ||
      undefined;
    const color =
      text(input.color) ||
      text(balanceRow.data.color) ||
      text(catalogSku.color || catalogSku.cor || catalogProduct.color || catalogProduct.cor) ||
      undefined;
    const photoUrls =
      stringList(input.photo_urls).length > 0
        ? stringList(input.photo_urls)
        : stringList(
            balanceRow.data.photo_urls ||
              catalogSku.photo_urls ||
              catalogProduct.photo_urls,
          );
    const photoStoragePaths = stringList(input.photo_storage_paths);
    const source =
      mode === "opening" ? "functions_opening_inventory" : "functions_cycle_count";
    const cycleCountId = `${mode === "opening" ? "oic" : "cc"}_${digest({
      operationId,
      customerCode,
      skuCode,
      locationId,
    })}`;
    const movementIdValue =
      adjustmentQty > 0 ? movementId(operationId, "cycle_count") : undefined;

    // Primeira escrita: o contador do SKU gerado.
    skuAllocator?.commit();

    if (mode === "opening" && openingSessionRef && openingLineRef) {
      const catalogPayload = compact({
        customer_code: customerCode,
        cod_cliente: clientItemCode,
        cod_cliente_key: normalizedIdentity(clientItemCode),
        produto: productName,
        category,
        categoria: category,
        genero,
        grupo,
        barcode,
        barcode_key: normalizeBarcode(barcode) || undefined,
        brand,
        marca: brand,
        size,
        tamanho: size,
        color,
        cor: color,
        photo_urls: photoUrls.length ? photoUrls : undefined,
        primary_photo_url: photoUrls[0],
        photo_storage_paths: photoStoragePaths.length
          ? photoStoragePaths
          : undefined,
        preco_unit: unitCost,
        unit_cost: unitCost,
        status: "active",
        archived: false,
        source,
        opening_inventory_session_id: sessionId,
        updated_by: actorPayload(actor),
        updated_at: FieldValue.serverTimestamp(),
      });
      if (wantsNewProduct) {
        const productId = safeDocId(clientItemCode || skuCode);
        const skuId = safeDocId(skuCode);
        // set (sem merge) em vez de create: a guarda catalogActiveExists já
        // barrou duplicidade ATIVA — se o doc existe aqui, está arquivado, e
        // recontar como novo é reativação com reset limpo (sem herdar
        // agregados velhos do cadastro arquivado).
        transaction.set(db.collection(collections.products).doc(productId), {
          id: clientItemCode || skuCode,
          ...catalogPayload,
          estoque_btg: countedQty,
          num_skus: 1,
          custo_total: countedQty * unitCost,
          created_by: actorPayload(actor),
          created_at: FieldValue.serverTimestamp(),
        });
        transaction.set(db.collection(collections.skus).doc(skuId), {
          id: skuCode,
          ...catalogPayload,
          cod_btg: skuCode,
          sku_code: skuCode,
          sku_code_key: normalizedIdentity(skuCode),
          estoque_atual: countedQty,
          estoque_reservado: 0,
          estoque_disponivel: countedQty,
          custo_total: countedQty * unitCost,
          created_by: actorPayload(actor),
          created_at: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(
          productRows[0]?.ref ??
            db
              .collection(collections.products)
              .doc(safeDocId(requestedClientItemCode)),
          {
            ...catalogPayload,
            estoque_btg: FieldValue.increment(countedQty),
            custo_total: FieldValue.increment(countedQty * unitCost),
          },
          { merge: true },
        );
        const existingSkuRef =
          skuRows[0]?.ref ??
          db.collection(collections.skus).doc(safeDocId(skuCode));
        transaction.set(
          existingSkuRef,
          compact({
            ...catalogPayload,
            cod_btg: skuCode,
            sku_code: skuCode,
            sku_code_key: normalizedIdentity(skuCode),
            estoque_atual: FieldValue.increment(countedQty),
            estoque_disponivel: FieldValue.increment(countedQty),
            custo_total: FieldValue.increment(countedQty * unitCost),
          }),
          { merge: true },
        );
      }

      transaction.create(
        openingLineRef,
        compact({
          id: openingLineRef.id,
          session_id: sessionId,
          customer_code: customerCode,
          sku_code: skuCode,
          client_item_code: clientItemCode,
          product_name: productName,
          product_registration: wantsNewProduct ? "new" : "existing",
          category,
          genero,
          grupo,
          barcode,
          brand,
          size,
          color,
          photo_urls: photoUrls.length ? photoUrls : undefined,
          photo_storage_paths: photoStoragePaths.length
            ? photoStoragePaths
            : undefined,
          location_id: locationId,
          box_code: boxCode || undefined,
          counted_qty: countedQty,
          unit_cost: unitCost,
          total_cost: countedQty * unitCost,
          cycle_count_id: cycleCountId,
          movement_id: movementIdValue,
          status: "counted",
          actor: actorPayload(actor),
          occurred_at: occurredAt,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
      transaction.update(openingSessionRef, {
        line_count: FieldValue.increment(1),
        unit_count: FieldValue.increment(countedQty),
        total_cost: FieldValue.increment(countedQty * unitCost),
        last_counted_at: occurredAt,
        updated_at: FieldValue.serverTimestamp(),
      });
      if (boxRef) {
        transaction.update(boxRef, {
          line_count: FieldValue.increment(1),
          unit_count: FieldValue.increment(countedQty),
          total_cost: FieldValue.increment(countedQty * unitCost),
          sku_codes: FieldValue.arrayUnion(skuCode),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
    }

    transaction.set(
      balanceRow.ref,
      compact({
        id: balanceRow.id,
        customer_code: customerCode,
        sku_code: skuCode,
        client_item_code: clientItemCode,
        product_name: productName,
        location_id: locationId,
        category,
        barcode,
        brand,
        size,
        color,
        photo_urls: photoUrls.length ? photoUrls : undefined,
        primary_photo_url: photoUrls[0],
        qty_on_hand: nextOnHand,
        qty_reserved: beforeReserved,
        qty_available: nextOnHand - beforeReserved,
        unit_cost: unitCost,
        status: nextOnHand > 0 ? "available" : "empty",
        source,
        opening_inventory_session_id: sessionId,
        last_cycle_count_id: cycleCountId,
        last_cycle_count_at: occurredAt,
        created_at:
          mode === "opening" && !Object.keys(balanceRow.data).length
            ? FieldValue.serverTimestamp()
            : undefined,
        updated_at: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );

    transaction.create(
      db.collection(collections.cycleCounts).doc(cycleCountId),
      compact({
        id: cycleCountId,
        customer_code: customerCode,
        sku_code: skuCode,
        client_item_code: clientItemCode,
        product_name: productName,
        category,
        barcode,
        brand,
        size,
        color,
        photo_urls: photoUrls.length ? photoUrls : undefined,
        photo_storage_paths: photoStoragePaths.length
          ? photoStoragePaths
          : undefined,
        location_id: locationId,
        box_code: boxCode || undefined,
        mode,
        opening_inventory_session_id: sessionId,
        counted_qty: countedQty,
        qty_before: beforeOnHand,
        qty_reserved: beforeReserved,
        qty_available_after: nextOnHand - beforeReserved,
        adjustment_qty: adjustmentQty,
        adjustment_delta: delta,
        adjustment_type: delta === 0 ? "SEM_DIVERGENCIA" : movementType,
        unit_cost: unitCost || undefined,
        reason,
        reference: text(input.reference) || undefined,
        movement_id: movementIdValue,
        status: "completed",
        source,
        actor: actorPayload(actor),
        occurred_at: occurredAt,
        created_at: FieldValue.serverTimestamp(),
      }),
    );

    if (adjustmentQty > 0 && movementIdValue) {
      createMovement(
        transaction,
        db,
        movementIdValue,
        {
          type: movementType,
          quantity: adjustmentQty,
          customerCode,
          skuCode,
          clientItemCode,
            productName,
            locationId,
            beforeQty: beforeOnHand,
            afterQty: nextOnHand,
            source,
            occurredAt,
            entity: {
              reason,
              reference: text(input.reference) || undefined,
              box_code: boxCode || undefined,
              cycle_count_id: cycleCountId,
              opening_inventory_session_id: sessionId,
              operational_operation_id: operationId,
            },
        },
        actor,
      );

      updateClientInventory(transaction, db, {
        customerCode,
        skuCode,
        clientItemCode,
        productName,
        category,
        barcode,
        brand,
        size,
        color,
        photoUrls,
        unitCost,
        onHandDelta: delta,
      });
      if (mode === "cycle") {
        applyCatalogStockAggregates(transaction, cycleCatalogTargets, {
          onHand: delta,
          cost: delta * unitCost,
        });
      }
    } else {
      // Sem divergência nada mudou no ledger; a projeção do cliente é
      // por SKU (todas as localizações), então o snapshot precisa somar os
      // saldos agregados — nunca os números de uma única localização.
      const projectionRows = variantScopedBalanceRows(
        aggregateBalanceRows,
        skuCode,
        clientItemCode,
      );
      const aggregateOnHand = projectionRows.reduce(
        (total, row) => total + number(row.data.qty_on_hand),
        0,
      );
      const aggregateReserved = projectionRows.reduce(
        (total, row) => total + number(row.data.qty_reserved),
        0,
      );
      setClientInventorySnapshot(transaction, db, {
        customerCode,
        skuCode,
        clientItemCode,
        productName,
        category,
        barcode,
        brand,
        size,
        color,
        photoUrls,
        unitCost,
        qtyOnHand: aggregateOnHand,
        qtyReserved: aggregateReserved,
      });
    }

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "inventory_adjusted"),
      {
        type:
          mode === "opening"
            ? "inventory.opening_counted"
            : "inventory.adjusted",
        title:
          mode === "opening"
            ? "Produto contado no inventário de abertura"
            : delta === 0
            ? "Inventário cíclico sem divergência"
            : "Inventário cíclico ajustado",
        description:
          mode === "opening"
            ? `${productName} publicado com ${countedQty} unidade(s) no local ${locationId}${boxCode ? ` (caixa ${boxCode})` : ""}.`
            : delta === 0
            ? `${skuCode} conferido no local ${locationId} sem diferença.`
            : `${skuCode} ajustado em ${delta > 0 ? "+" : ""}${delta} unidade(s) no local ${locationId}.`,
        severity:
          mode === "opening" || delta === 0 ? "info" : "attention",
        entity_type:
          mode === "opening" ? "opening_inventory_line" : "cycle_count",
        entity_id: cycleCountId,
        customer_code: customerCode,
        payload: {
          cycle_count_id: cycleCountId,
          movement_id: movementIdValue,
          sku_code: skuCode,
          client_item_code: clientItemCode,
          product_name: productName,
          mode,
          opening_inventory_session_id: sessionId,
          location_id: locationId,
          box_code: boxCode || undefined,
          counted_qty: countedQty,
          qty_before: beforeOnHand,
          qty_reserved: beforeReserved,
          adjustment_delta: delta,
          adjustment_qty: adjustmentQty,
          reason,
          reference: text(input.reference) || undefined,
        },
      },
      actor,
    );

    const result = compact({
      ok: true,
      id: cycleCountId,
      cycle_count_id: cycleCountId,
      movement_id: movementIdValue,
      stock_balance_id: balanceRow.id,
      qty_before: beforeOnHand,
      qty_counted: countedQty,
      qty_reserved: beforeReserved,
      qty_available: nextOnHand - beforeReserved,
      adjustment_delta: delta,
      adjustment_qty: adjustmentQty,
      adjustment_type: delta === 0 ? "SEM_DIVERGENCIA" : movementType,
      mode,
      sku_code: skuCode,
      client_item_code: clientItemCode,
      sku_generated: generatesSku || undefined,
      box_code: boxCode || undefined,
      opening_inventory_session_id: sessionId,
      events: [event],
    });
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      mode === "opening" ? "inventory.opening_count" : "inventory.cycle_count",
      cycleCountId,
      actor,
      result,
    );
    return result;
  });
}

export type MoveOpeningInventoryLineInput = {
  customer_code: string;
  session_id: string;
  opening_line_id: string;
  target_box_code: string;
  reason: string;
  idempotency_key: string;
};

/**
 * Corrige a caixa de uma linha inteira, sem recadastrar o produto.
 * Não junta linhas do mesmo SKU: a caixa de destino precisa não ter esse SKU.
 * A operação preserva catálogo, fotos, custo e totais da sessão/cliente.
 */
export async function moveOpeningInventoryLineTransaction(
  db: Firestore,
  input: MoveOpeningInventoryLineInput,
  actor: OperationalActor,
) {
  if (!["owner", "admin", "interno", "wms"].includes(actor.role)) {
    throw new HttpsError("permission-denied", "Correção permitida somente à operação de armazém.");
  }
  const customerCode = text(input.customer_code);
  const sessionId = safeDocId(text(input.session_id));
  const openingLineId = safeDocId(text(input.opening_line_id));
  const targetBoxCode = text(input.target_box_code).toUpperCase();
  const reason = text(input.reason);
  if (!customerCode || !sessionId || !openingLineId || !/^CX-\d+$/.test(targetBoxCode) || !text(input.idempotency_key) || reason.length < 3 || reason.length > 300) {
    throw new HttpsError("invalid-argument", "Informe cliente, sessão, linha, caixa de destino e motivo da correção.");
  }
  if (sessionId !== openingInventorySessionDocumentId(customerCode)) {
    throw new HttpsError("permission-denied", "A sessão não pertence ao cliente informado.");
  }
  const operationId = `op_opening_inventory_move_${digest({
    customer: customerCode, session: sessionId, line: openingLineId, nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const sessionRef = db.collection(collections.openingInventorySessions).doc(sessionId);
  const lineRef = db.collection(collections.openingInventoryLines).doc(openingLineId);
  const targetBoxRef = db.collection("warehouse_boxes").doc(targetBoxCode);

  return db.runTransaction(async (transaction) => {
    const [receipt, sessionSnapshot, lineSnapshot, targetBoxSnapshot] = await Promise.all([
      transaction.get(operationRef), transaction.get(sessionRef),
      transaction.get(lineRef), transaction.get(targetBoxRef),
    ]);
    const previous = operationResult<Record<string, unknown>>(receipt, inputHash);
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);
    if (!sessionSnapshot.exists || text(sessionSnapshot.get("status")) !== "open") {
      throw new HttpsError("failed-precondition", "A caixa só pode ser corrigida enquanto o inventário de abertura estiver ativo.");
    }
    if (text(sessionSnapshot.get("customer_code")) !== customerCode) {
      throw new HttpsError("permission-denied", "A sessão pertence a outro cliente.");
    }
    if (!lineSnapshot.exists) throw new HttpsError("not-found", "Linha do inventário não encontrada.");
    const line = lineSnapshot.data() ?? {};
    if (text(line.customer_code) !== customerCode || text(line.session_id) !== sessionId) {
      throw new HttpsError("permission-denied", "A linha não pertence à sessão informada.");
    }
    const sourceBoxCode = text(line.box_code).toUpperCase();
    const sourceLocation = text(line.location_id);
    const skuCode = normalizedIdentity(line.sku_code);
    const quantity = number(line.counted_qty);
    if (!/^CX-\d+$/.test(sourceBoxCode) || !sourceLocation || !skuCode || quantity <= 0 || text(line.status) !== "counted") {
      throw new HttpsError("failed-precondition", "A linha não possui caixa e contagem válidas para transferência.");
    }
    if (sourceBoxCode === targetBoxCode) {
      throw new HttpsError("invalid-argument", "Escolha uma caixa diferente da atual.");
    }
    const sourceBoxRef = db.collection("warehouse_boxes").doc(sourceBoxCode);
    const [sourceBoxSnapshot, sessionLines, balances] = await Promise.all([
      transaction.get(sourceBoxRef),
      readRows(transaction, db.collection(collections.openingInventoryLines).where("session_id", "==", sessionId)),
      readRows(transaction, skuBalancesQuery(db, customerCode, skuCode)),
    ]);
    for (const boxSnapshot of [sourceBoxSnapshot, targetBoxSnapshot]) {
      if (!boxSnapshot.exists) throw new HttpsError("not-found", "Caixa de origem ou destino não encontrada.");
      const box = boxSnapshot.data() ?? {};
      if (text(box.customer_code) !== customerCode || text(asRecord(box.origin).session_id) !== sessionId) {
        throw new HttpsError("permission-denied", "As duas caixas precisam pertencer ao mesmo cliente e inventário.");
      }
      if (text(box.status) !== "stored") {
        throw new HttpsError("failed-precondition", "As duas caixas precisam estar guardadas.");
      }
    }
    if (text(sourceBoxSnapshot.get("location_id")) !== sourceLocation) {
      throw new HttpsError("failed-precondition", "A posição da linha não corresponde à caixa de origem.");
    }
    const targetLocation = text(targetBoxSnapshot.get("location_id"));
    if (!targetLocation) throw new HttpsError("failed-precondition", "A caixa de destino não tem posição.");
    const targetLineId = safeDocId(`line_${digest({
      sessionId, customerCode, skuCode, locationId: targetLocation, boxCode: targetBoxCode,
    }, 48)}`);
    const targetLineRef = db.collection(collections.openingInventoryLines).doc(targetLineId);
    const targetLineSnapshot = await transaction.get(targetLineRef);
    const activeLines = sessionLines.filter((row) => text(row.data.status || "counted") === "counted");
    if (targetLineSnapshot.exists || activeLines.some((row) =>
      text(row.data.box_code).toUpperCase() === targetBoxCode && normalizedIdentity(row.data.sku_code) === skuCode)) {
      throw new HttpsError("already-exists", "A caixa de destino já contém este SKU. Escolha outra caixa; juntar contagens não está disponível nesta correção.");
    }
    const sourceBalance = assertSingleBalance(balances.filter((row) => text(row.data.location_id) === sourceLocation), skuCode, sourceLocation);
    const sourceOnHand = number(sourceBalance.data.qty_on_hand);
    if (number(sourceBalance.data.qty_reserved) !== 0 || sourceOnHand < quantity ||
      text(sourceBalance.data.opening_inventory_session_id) !== sessionId) {
      throw new HttpsError("failed-precondition", "O saldo de origem recebeu reserva ou não comporta esta linha. Revise as movimentações antes de corrigir.");
    }
    const changesPosition = targetLocation !== sourceLocation;
    const targetBalances = changesPosition ? balances.filter((row) => text(row.data.location_id) === targetLocation) : [];
    if (targetBalances.length > 1) {
      throw new HttpsError("failed-precondition", "Há mais de um saldo para o SKU na posição de destino.");
    }
    const targetBalance = targetBalances[0];
    if (targetBalance && (number(targetBalance.data.qty_reserved) !== 0 ||
      text(targetBalance.data.opening_inventory_session_id) !== sessionId)) {
      throw new HttpsError("failed-precondition", "O saldo de destino não pertence a esta abertura ou possui reserva.");
    }

    // Todas as leituras terminam antes de atualizar saldo, linhas ou caixas.
    if (changesPosition) {
      const remaining = sourceOnHand - quantity;
      if (remaining > 0) {
        transaction.update(sourceBalance.ref, {
          qty_on_hand: remaining, qty_available: remaining,
          updated_at: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.delete(sourceBalance.ref);
      }
      const targetBefore = number(targetBalance?.data.qty_on_hand);
      const targetBalanceId = `bal_${digest({ customerCode, skuCode, locationId: targetLocation }, 48)}`;
      const targetBalanceRef = targetBalance?.ref ?? db.collection(collections.stockBalances).doc(targetBalanceId);
      transaction.set(targetBalanceRef, {
        ...(targetBalance?.data ?? sourceBalance.data),
        id: targetBalanceRef.id, location_id: targetLocation,
        qty_on_hand: targetBefore + quantity, qty_available: targetBefore + quantity, qty_reserved: 0,
        opening_inventory_session_id: sessionId, status: "available",
        updated_at: FieldValue.serverTimestamp(),
      });
      const now = new Date().toISOString();
      const transfer = {
        type: "inventory.relocated", billable: false,
        unit_cost: number(line.unit_cost), total_cost: number(line.total_cost),
        original_movement_id: text(line.movement_id), cycle_count_id: text(line.cycle_count_id),
        reason, opening_inventory_session_id: sessionId,
        opening_inventory_line_id: targetLineId, previous_opening_line_id: openingLineId,
        operational_operation_id: operationId,
        source_box_code: sourceBoxCode, target_box_code: targetBoxCode,
        from_location_id: sourceLocation, to_location_id: targetLocation,
      };
      const common = {
        quantity, customerCode, skuCode,
        clientItemCode: text(line.client_item_code), productName: text(line.product_name),
        source: "functions_opening_inventory_transfer", occurredAt: now, entity: transfer,
      };
      createMovement(transaction, db, movementId(operationId, "transfer_out"), {
        ...common, type: "SAIDA", locationId: sourceLocation, beforeQty: sourceOnHand, afterQty: remaining,
      }, actor);
      createMovement(transaction, db, movementId(operationId, "transfer_in"), {
        ...common, type: "ENTRADA", locationId: targetLocation, beforeQty: targetBefore, afterQty: targetBefore + quantity,
      }, actor);
    }
    transaction.create(targetLineRef, {
      ...line, id: targetLineId, box_code: targetBoxCode, location_id: targetLocation,
      previous_opening_line_id: openingLineId, correction_reason: reason,
      corrected_by: actorPayload(actor), corrected_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    transaction.delete(lineRef);
    // Recalcular pelas linhas também retira da caixa os SKUs que saíram.
    for (const [boxRef, boxCode] of [[sourceBoxRef, sourceBoxCode], [targetBoxRef, targetBoxCode]] as const) {
      const rows = activeLines.filter((row) => row.id !== openingLineId && text(row.data.box_code).toUpperCase() === boxCode).map((row) => row.data);
      if (boxCode === targetBoxCode) rows.push(line);
      transaction.update(boxRef, {
        line_count: rows.length,
        unit_count: rows.reduce((sum, row) => sum + number(row.counted_qty), 0),
        total_cost: rows.reduce((sum, row) => sum + number(row.counted_qty) * number(row.unit_cost), 0),
        sku_codes: [...new Set(rows.map((row) => normalizedIdentity(row.sku_code)).filter(Boolean))],
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(sessionRef, { updated_at: FieldValue.serverTimestamp() });
    const event = createEvent(transaction, db, operationEventId(operationId, "opening_inventory_line_moved"), {
      type: "inventory.opening_line_moved", title: "Caixa do inventário corrigida",
      description: `${quantity} unidade(s) de ${skuCode}: ${sourceBoxCode} → ${targetBoxCode}. ${reason}`,
      severity: "attention", entity_type: "opening_inventory_line", entity_id: targetLineId,
      customer_code: customerCode,
      payload: {
        sku_code: skuCode, quantity,
        source_line_id: openingLineId, target_line_id: targetLineId,
        source_box_code: sourceBoxCode, target_box_code: targetBoxCode,
        source_location_id: sourceLocation, target_location_id: targetLocation,
        reason,
      },
    }, actor);
    const result = {
      ok: true, opening_line_id: targetLineId, previous_opening_line_id: openingLineId,
      source_box_code: sourceBoxCode, target_box_code: targetBoxCode,
      source_location_id: sourceLocation, target_location_id: targetLocation,
      sku_code: skuCode, quantity_moved: quantity, events: [event],
    };
    createOperationReceipt(transaction, operationRef, inputHash, "inventory.opening_line.move", targetLineId, actor, result);
    return result;
  });
}

export async function removeOpeningInventoryLineTransaction(
  db: Firestore,
  input: RemoveOpeningInventoryLineInput,
  actor: OperationalActor,
) {
  const customerCode = text(input.customer_code);
  const sessionId = safeDocId(input.session_id);
  const openingLineId = safeDocId(input.opening_line_id);
  if (!customerCode || !sessionId || !openingLineId) {
    throw new HttpsError(
      "invalid-argument",
      "Cliente, sessão e linha do inventário são obrigatórios.",
    );
  }
  if (sessionId !== openingInventorySessionDocumentId(customerCode)) {
    throw new HttpsError(
      "permission-denied",
      "A sessão não pertence ao cliente informado.",
    );
  }

  const operationId = `op_opening_inventory_remove_${digest({
    customer: customerCode,
    session: sessionId,
    line: openingLineId,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const sessionRef = db
    .collection(collections.openingInventorySessions)
    .doc(sessionId);
  const lineRef = db
    .collection(collections.openingInventoryLines)
    .doc(openingLineId);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, sessionSnapshot, lineSnapshot] =
      await Promise.all([
        transaction.get(operationRef),
        transaction.get(sessionRef),
        transaction.get(lineRef),
      ]);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;
    await assertInventoryOperationsEnabled(transaction, db);

    if (!sessionSnapshot.exists || text(sessionSnapshot.data()?.status) !== "open") {
      throw new HttpsError(
        "failed-precondition",
        "A linha só pode ser corrigida enquanto o inventário de abertura estiver ativo.",
      );
    }
    if (!lineSnapshot.exists) {
      throw new HttpsError("not-found", "Linha do inventário não encontrada.");
    }

    const line = lineSnapshot.data() ?? {};
    if (
      text(line.session_id) !== sessionId ||
      text(line.customer_code) !== customerCode
    ) {
      throw new HttpsError(
        "permission-denied",
        "A linha não pertence à sessão informada.",
      );
    }

    const skuCode = normalizedIdentity(line.sku_code);
    const clientItemCode = normalizedIdentity(line.client_item_code || skuCode);
    const locationId = text(line.location_id);
    const countedQty = number(line.counted_qty);
    const unitCost = number(line.unit_cost);
    const cycleCountId = safeDocId(text(line.cycle_count_id));
    const originalMovementId = safeDocId(text(line.movement_id));
    const boxCode = text(line.box_code).toUpperCase();
    const boxRef = boxCode ? db.collection("warehouse_boxes").doc(boxCode) : undefined;
    if (!skuCode || !clientItemCode || !locationId || !cycleCountId) {
      throw new HttpsError(
        "failed-precondition",
        "A linha não possui identidade operacional suficiente para ser corrigida.",
      );
    }

    const productRef = db
      .collection(collections.products)
      .doc(safeDocId(clientItemCode));
    const skuRef = db.collection(collections.skus).doc(safeDocId(skuCode));
    const projectionRef = db
      .collection(collections.clientInventory)
      .doc(clientScopedInventoryId(customerCode, skuCode, clientItemCode));
    const cycleCountRef = db
      .collection(collections.cycleCounts)
      .doc(cycleCountId);
    const allOpeningLinesQuery = db
      .collection(collections.openingInventoryLines)
      .where("session_id", "==", sessionId);
    const [balanceRows, productSnapshot, skuSnapshot, projectionSnapshot, cycleSnapshot, openingLines] =
      await Promise.all([
        readRows(transaction, skuBalancesQuery(db, customerCode, skuCode)),
        transaction.get(productRef),
        transaction.get(skuRef),
        transaction.get(projectionRef),
        transaction.get(cycleCountRef),
        readRows(transaction, allOpeningLinesQuery),
      ]);
    const boxSnapshot = boxRef ? await transaction.get(boxRef) : undefined;
    if (boxSnapshot?.get("status") === "committing") {
      throw new HttpsError("failed-precondition", "Retome e finalize a guarda da caixa antes de remover um lançamento confirmado.");
    }

    const targetBalances = balanceRows.filter(
      (row) => text(row.data.location_id) === locationId,
    );
    const balance = assertSingleBalance(targetBalances, skuCode, locationId);
    const balanceOnHand = number(balance.data.qty_on_hand);
    const balanceReserved = number(balance.data.qty_reserved);
    // Linha de caixa soma ao saldo da posição (várias caixas do mesmo SKU):
    // a correção subtrai a quantidade da linha em vez de zerar o saldo.
    const consistent = boxCode
      ? balanceReserved === 0 && balanceOnHand >= countedQty
      : balanceOnHand === countedQty &&
        balanceReserved === 0 &&
        text(balance.data.last_cycle_count_id) === cycleCountId;
    if (!consistent) {
      throw new HttpsError(
        "failed-precondition",
        "Este saldo já recebeu outra movimentação ou reserva. Faça um inventário cíclico em vez de remover a linha de abertura.",
      );
    }

    const otherActiveLines = openingLines.filter(
      (row) =>
        row.id !== openingLineId &&
        normalizedIdentity(row.data.sku_code) === skuCode &&
        text(row.data.status || "counted") === "counted",
    );
    const aggregateOnHand = balanceRows.reduce(
      (total, row) => total + number(row.data.qty_on_hand),
      0,
    );
    const aggregateReserved = balanceRows.reduce(
      (total, row) => total + number(row.data.qty_reserved),
      0,
    );
    const nextOnHand = aggregateOnHand - countedQty;
    if (nextOnHand < 0 || aggregateReserved > nextOnHand) {
      throw new HttpsError(
        "failed-precondition",
        "A correção deixaria o saldo inconsistente. Revise as movimentações antes de continuar.",
      );
    }

    const remainingAtLocation = balanceOnHand - countedQty;
    if (remainingAtLocation > 0) {
      transaction.update(balance.ref, {
        qty_on_hand: remainingAtLocation,
        qty_available: remainingAtLocation - balanceReserved,
        status: "available",
        updated_at: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.delete(balance.ref);
    }
    if (boxRef && boxSnapshot?.exists) {
      transaction.update(boxRef, {
        line_count: FieldValue.increment(-1),
        unit_count: FieldValue.increment(-countedQty),
        total_cost: FieldValue.increment(-(countedQty * unitCost)),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    transaction.delete(lineRef);
    if (cycleSnapshot.exists) {
      transaction.update(cycleCountRef, {
        status: "reversed",
        reversed_by: actorPayload(actor),
        reversed_at: FieldValue.serverTimestamp(),
        reversal_operation_id: operationId,
      });
    }

    if (countedQty > 0) {
      createMovement(
        transaction,
        db,
        movementId(operationId, "opening_inventory_reversal"),
        {
          type: "SAIDA",
          quantity: countedQty,
          customerCode,
          skuCode,
          clientItemCode,
          productName: text(line.product_name) || skuCode,
          locationId,
          beforeQty: balanceOnHand,
          afterQty: remainingAtLocation,
          source: "functions_opening_inventory_reversal",
          occurredAt: new Date().toISOString(),
          entity: {
            reason: "Correção de linha do inventário de abertura",
            opening_inventory_session_id: sessionId,
            opening_inventory_line_id: openingLineId,
            reversed_cycle_count_id: cycleCountId,
            reversed_movement_id: originalMovementId || undefined,
            operational_operation_id: operationId,
          },
        },
        actor,
      );
    }

    const product = productSnapshot.data() ?? {};
    const sku = skuSnapshot.data() ?? {};
    const removeOpeningCatalog =
      nextOnHand === 0 &&
      otherActiveLines.length === 0 &&
      (text(product.opening_inventory_session_id) === sessionId ||
        text(sku.opening_inventory_session_id) === sessionId);
    if (removeOpeningCatalog) {
      if (productSnapshot.exists) transaction.delete(productRef);
      if (skuSnapshot.exists) transaction.delete(skuRef);
    } else {
      if (productSnapshot.exists) {
        transaction.update(productRef, {
          estoque_btg: Math.max(0, number(product.estoque_btg) - countedQty),
          custo_total: Math.max(
            0,
            number(product.custo_total) - countedQty * unitCost,
          ),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (skuSnapshot.exists) {
        transaction.update(skuRef, {
          estoque_atual: nextOnHand,
          estoque_reservado: aggregateReserved,
          estoque_disponivel: nextOnHand - aggregateReserved,
          custo_total: Math.max(
            0,
            number(sku.custo_total) - countedQty * unitCost,
          ),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
    }

    if (nextOnHand === 0 && aggregateReserved === 0) {
      if (projectionSnapshot.exists) transaction.delete(projectionRef);
    } else {
      setClientInventorySnapshot(transaction, db, {
        customerCode,
        skuCode,
        clientItemCode,
        productName: text(line.product_name) || skuCode,
        category: text(line.category) || undefined,
        barcode: text(line.barcode) || undefined,
        brand: text(line.brand) || undefined,
        size: text(line.size) || undefined,
        color: text(line.color) || undefined,
        photoUrls: stringList(line.photo_urls),
        unitCost,
        qtyOnHand: nextOnHand,
        qtyReserved: aggregateReserved,
      });
    }

    transaction.update(sessionRef, {
      line_count: FieldValue.increment(-1),
      unit_count: FieldValue.increment(-countedQty),
      total_cost: FieldValue.increment(-(countedQty * unitCost)),
      updated_at: FieldValue.serverTimestamp(),
    });
    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "opening_inventory_line_removed"),
      {
        type: "inventory.opening_line_removed",
        title: "Linha removida do inventário de abertura",
        description: `${text(line.product_name) || skuCode}: ${countedQty} unidade(s) retiradas para correção e novo lançamento.`,
        severity: "attention",
        entity_type: "opening_inventory_line",
        entity_id: openingLineId,
        customer_code: customerCode,
        payload: {
          sku_code: skuCode,
          client_item_code: clientItemCode,
          location_id: locationId,
          box_code: boxCode || undefined,
          counted_qty: countedQty,
          reversed_cycle_count_id: cycleCountId,
          reversed_movement_id: originalMovementId || undefined,
        },
      },
      actor,
    );
    const result = {
      ok: true,
      id: openingLineId,
      opening_line_id: openingLineId,
      status: "removed",
      sku_code: skuCode,
      client_item_code: clientItemCode,
      quantity_removed: countedQty,
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inventory.opening_line.remove",
      openingLineId,
      actor,
      result,
    );
    return result;
  });
}

export async function createReturnReceiptTransaction(
  db: Firestore,
  input: CreateReturnReceiptInput,
  actor: OperationalActor,
) {
  const customerCode = text(input.customer_code);
  if (!customerCode) {
    throw new HttpsError("invalid-argument", "Cliente é obrigatório.");
  }
  if (!input.items.length) {
    throw new HttpsError(
      "invalid-argument",
      "Devolução precisa de ao menos uma linha.",
    );
  }

  const normalizedItems = input.items.map((item, index) => {
    const clientItemCode = normalizedIdentity(
      item.client_item_code || item.sku_code,
    );
    const skuCode = normalizedIdentity(item.sku_code || item.client_item_code);
    const productName = text(item.product_name || clientItemCode || skuCode);
    const quantity = requiredPositive(
      item.quantity,
      `Quantidade da linha ${index + 1}`,
    );
    if (!skuCode || !clientItemCode || !productName) {
      throw new HttpsError(
        "invalid-argument",
        `Linha ${index + 1} precisa de Cod. cliente, SKU e descrição do produto.`,
      );
    }
    return {
      ...item,
      line_number: number(item.line_number) || index + 1,
      sku_code: skuCode,
      client_item_code: clientItemCode,
      product_name: productName,
      condition: text(item.condition) || "return_received",
      unit_cost: number(item.unit_cost),
      quantity,
      notes: text(item.notes) || undefined,
    };
  });

  const clientCodeSeen = new Map<string, number>();
  for (const item of normalizedItems) {
    const key = normalizedIdentity(item.client_item_code);
    const previousLine = clientCodeSeen.get(key);
    if (previousLine) {
      throw new HttpsError(
        "invalid-argument",
        `Cod. cliente ${item.client_item_code} repetido nas linhas ${previousLine} e ${item.line_number}. Some a quantidade em uma única linha.`,
      );
    }
    clientCodeSeen.set(key, item.line_number);
  }

  const occurredAt = input.received_at ?? new Date().toISOString();
  const operationId = `op_return_create_${digest({
    customer: customerCode,
    nonce: input.idempotency_key,
  })}`;
  const returnId = `ret_${digest({ customer: customerCode, nonce: input.idempotency_key })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const returnRef = db.collection(collections.returns).doc(returnId);
  const quantityTotal = normalizedItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    for (const item of normalizedItems) {
      const clientCode = text(item.client_item_code);
      const declaredSku = text(item.sku_code);
      const [skuRows, productRows, skuCodeSnapshot] = await Promise.all([
        readRows(
          transaction,
          db.collection(collections.skus).where("cod_cliente", "==", clientCode),
        ),
        readRows(
          transaction,
          db
            .collection(collections.products)
            .where("cod_cliente", "==", clientCode),
        ),
        transaction.get(db.collection(collections.skus).doc(safeDocId(declaredSku))),
      ]);
      assertCatalogOwnedBy(
        customerCode,
        [...productRows.map((row) => row.data), ...skuRows.map((row) => row.data)],
        `O código ${clientCode}`,
      );
      assertCatalogOwnedBy(
        customerCode,
        [skuCodeSnapshot.exists ? skuCodeSnapshot.data() : undefined],
        `O SKU ${declaredSku}`,
      );
      const existingSkuCodes = new Set(
        skuRows
          .map((row) => text(row.data.cod_btg || row.data.sku_code || row.data.cod_sku))
          .filter(Boolean),
      );
      if (!skuRows.length && !productRows.length && !skuCodeSnapshot.exists) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${clientCode} não existe no cadastro. Cadastre o produto pelo Recebimento antes de registrar devolução.`,
        );
      }
      if (existingSkuCodes.size > 0 && !existingSkuCodes.has(declaredSku)) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${clientCode} já existe com SKU ${[...existingSkuCodes].join(", ")}. Use o SKU cadastrado para evitar duplicidade.`,
        );
      }
      if (skuCodeSnapshot.exists) {
        const skuData = skuCodeSnapshot.data() ?? {};
        const skuClientCode = text(skuData.cod_cliente || skuData.client_item_code);
        if (skuClientCode && skuClientCode !== clientCode) {
          throw new HttpsError(
            "failed-precondition",
            `SKU ${declaredSku} pertence ao Cod. cliente ${skuClientCode}. Revise antes de registrar a devolução.`,
          );
        }
      }
    }

    transaction.create(
      returnRef,
      compact({
        id: returnId,
        customer_code: customerCode,
        source: text(input.source) || "cliente",
        reference: text(input.reference) || undefined,
        notes: text(input.notes) || undefined,
        status: "received",
        item_count: normalizedItems.length,
        qty_total: quantityTotal,
        qty_pending_disposition: quantityTotal,
        received_at: occurredAt,
        created_by: actorPayload(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );

    const returnItemIds = normalizedItems.map((item, index) => {
      const lineNumber = index + 1;
      const itemId = `reti_${safeDocId(returnId)}_${String(lineNumber).padStart(2, "0")}`;
      transaction.create(
        db.collection(collections.returnItems).doc(itemId),
        compact({
          id: itemId,
          return_id: returnId,
          customer_code: customerCode,
          line_number: lineNumber,
          sku_code: item.sku_code,
          client_item_code: item.client_item_code,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_cost: item.unit_cost || undefined,
          condition: item.condition,
          notes: item.notes,
          status: "pending_disposition",
          disposition: "pending",
          source: "wms_return",
          received_at: occurredAt,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
      return itemId;
    });

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "return_received"),
      {
        type: "return.received",
        title: "Devolução recebida para triagem",
        description:
          text(input.notes) ||
          `${normalizedItems.length} linha(s), ${quantityTotal} unidade(s) aguardando disposição física.`,
        severity: "attention",
        entity_type: "return",
        entity_id: returnId,
        customer_code: customerCode,
        payload: {
          return_id: returnId,
          reference: text(input.reference) || undefined,
          source: text(input.source) || "cliente",
          item_count: normalizedItems.length,
          qty_total: quantityTotal,
          items: normalizedItems.map((item) => ({
            sku_code: item.sku_code,
            client_item_code: item.client_item_code,
            product_name: item.product_name,
            quantity: item.quantity,
          })),
        },
      },
      actor,
    );

    const result = {
      ok: true,
      id: returnId,
      return_id: returnId,
      return_item_ids: returnItemIds,
      status: "received",
      item_count: normalizedItems.length,
      qty_total: quantityTotal,
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "return.create",
      returnId,
      actor,
      result,
    );
    return result;
  });
}

export async function setReturnDispositionTransaction(
  db: Firestore,
  input: SetReturnDispositionInput,
  actor: OperationalActor,
) {
  const returnItemId = text(input.return_item_id);
  const disposition = text(input.disposition) as SetReturnDispositionInput["disposition"];
  if (
    !returnItemId ||
    !["available", "damaged", "quarantine", "discard"].includes(disposition)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Item de devolução e disposição válida são obrigatórios.",
    );
  }
  const locationId = text(input.location_id);
  if (disposition === "available" && !locationId) {
    throw new HttpsError(
      "invalid-argument",
      "Informe o endereço físico para devolver o item ao estoque disponível.",
    );
  }
  if (disposition !== "available" && !text(input.notes)) {
    throw new HttpsError(
      "invalid-argument",
      "Informe a nota da triagem para avaria, quarentena ou descarte.",
    );
  }

  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const operationId = `op_return_disposition_${digest({
    returnItemId,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const returnItemRef = db.collection(collections.returnItems).doc(returnItemId);

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    const returnItemSnapshot = await transaction.get(returnItemRef);
    if (!returnItemSnapshot.exists) {
      throw new HttpsError("not-found", "Item de devolução não encontrado.");
    }
    const item = returnItemSnapshot.data() ?? {};
    const status = text(item.status);
    if (status === "disposition_set" || text(item.disposition) !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Este item de devolução já possui disposição registrada.",
      );
    }
    if (input.expected_status && status !== input.expected_status) {
      throw new HttpsError(
        "failed-precondition",
        `Item está em ${status || "status aberto"}, esperado ${input.expected_status}. Atualize a tela antes de continuar.`,
      );
    }

    const returnId = text(item.return_id);
    const returnRef = db.collection(collections.returns).doc(returnId);
    const returnSnapshot = await transaction.get(returnRef);
    if (!returnSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Cabeçalho da devolução não encontrado.");
    }
    const rawPendingDisposition = number(
      returnSnapshot.data()?.qty_pending_disposition,
    );

    const customerCode = text(item.customer_code);
    const skuCode = text(item.sku_code);
    const clientItemCode = text(item.client_item_code) || undefined;
    const productName = text(item.product_name) || skuCode;
    const quantity = requiredPositive(item.quantity, "Quantidade devolvida");
    const currentPendingDisposition =
      rawPendingDisposition > 0 ? rawPendingDisposition : quantity;
    const unitCost = number(input.unit_cost || item.unit_cost);
    let movementIdValue: string | undefined;
    let stockBalanceId: string | undefined;
    let beforeOnHand = 0;
    let afterOnHand = 0;

    if (disposition === "available") {
      const balanceRows = await readRows(
        transaction,
        exactBalanceQuery(db, customerCode, skuCode, locationId),
      );
      if (balanceRows.length > 1) {
        throw new HttpsError(
          "failed-precondition",
          `Mais de um saldo existe para SKU ${skuCode} no local ${locationId}.`,
        );
      }
      const balanceRow = balanceRows[0];
      const returnCatalogTargets = await resolveCatalogAggregateTargets(
        transaction,
        db,
        skuCode,
        clientItemCode,
      );
      beforeOnHand = number(balanceRow?.data.qty_on_hand);
      const beforeReserved = number(balanceRow?.data.qty_reserved);
      afterOnHand = beforeOnHand + quantity;
      stockBalanceId =
        balanceRow?.id ?? safeDocId(`bal_${customerCode}__${skuCode}__${locationId}`);
      const balancePayload = compact({
        id: stockBalanceId,
        customer_code: customerCode,
        sku_code: skuCode,
        client_item_code: clientItemCode,
        product_name: productName,
        location_id: locationId,
        unit_cost: unitCost || number(balanceRow?.data.unit_cost) || undefined,
        qty_on_hand: afterOnHand,
        qty_reserved: beforeReserved,
        qty_available: afterOnHand - beforeReserved,
        status: "available",
        source: "functions_return_disposition",
        updated_at: FieldValue.serverTimestamp(),
      });
      if (balanceRow) {
        transaction.update(balanceRow.ref, balancePayload);
      } else {
        transaction.create(db.collection(collections.stockBalances).doc(stockBalanceId), {
          ...balancePayload,
          created_at: FieldValue.serverTimestamp(),
        });
      }

      movementIdValue = movementId(operationId, "return_available");
      createMovement(
        transaction,
        db,
        movementIdValue,
        {
          type: "ENTRADA",
          quantity,
          customerCode,
          skuCode,
          clientItemCode,
          productName,
          locationId,
          beforeQty: beforeOnHand,
          afterQty: afterOnHand,
          source: "functions_return_disposition",
          occurredAt,
          entity: {
            return_id: returnId,
            return_item_id: returnItemId,
            disposition,
            operational_operation_id: operationId,
          },
        },
        actor,
      );
      updateClientInventory(transaction, db, {
        customerCode,
        skuCode,
        clientItemCode,
        productName,
        unitCost,
        onHandDelta: quantity,
      });
      applyCatalogStockAggregates(transaction, returnCatalogTargets, {
        onHand: quantity,
        cost: quantity * unitCost,
      });
    }

    transaction.update(returnItemRef, compact({
      disposition,
      status: "disposition_set",
      location_id: disposition === "available" ? locationId : undefined,
      unit_cost: unitCost || undefined,
      movement_id: movementIdValue,
      stock_balance_id: stockBalanceId,
      disposition_notes: text(input.notes) || undefined,
      disposition_by: actorPayload(actor),
      disposition_at: occurredAt,
      updated_at: FieldValue.serverTimestamp(),
    }));
    const nextPendingDisposition = Math.max(
      0,
      currentPendingDisposition - quantity,
    );
    transaction.update(returnRef, compact({
      status: nextPendingDisposition === 0 ? "completed" : "in_disposition",
      last_disposition: disposition,
      last_disposition_at: occurredAt,
      qty_pending_disposition: nextPendingDisposition,
      completed_at:
        nextPendingDisposition === 0 ? FieldValue.serverTimestamp() : undefined,
      updated_at: FieldValue.serverTimestamp(),
    }));

    const dispositionLabel =
      disposition === "available"
        ? "voltou para disponível"
        : disposition === "damaged"
          ? "avaria"
          : disposition === "quarantine"
            ? "quarentena"
            : "descarte";
    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "return_disposition"),
      {
        type: "return.disposition_set",
        title: "Disposição de devolução registrada",
        description: `${productName} (${quantity} un.) ${dispositionLabel}.`,
        severity: disposition === "available" ? "info" : "attention",
        entity_type: "return_item",
        entity_id: returnItemId,
        customer_code: customerCode,
        payload: {
          return_id: returnId,
          return_item_id: returnItemId,
          return_status:
            nextPendingDisposition === 0 ? "completed" : "in_disposition",
          disposition,
          sku_code: skuCode,
          client_item_code: clientItemCode,
          product_name: productName,
          quantity,
          location_id: locationId || undefined,
          movement_id: movementIdValue,
          stock_balance_id: stockBalanceId,
          qty_before: disposition === "available" ? beforeOnHand : undefined,
          qty_after: disposition === "available" ? afterOnHand : undefined,
          qty_pending_disposition: nextPendingDisposition,
          notes: text(input.notes) || undefined,
        },
      },
      actor,
    );

    const result = {
      ok: true,
      id: returnItemId,
      return_item_id: returnItemId,
      return_id: returnId,
      disposition,
      movement_id: movementIdValue,
      stock_balance_id: stockBalanceId,
      qty_before: disposition === "available" ? beforeOnHand : undefined,
      qty_after: disposition === "available" ? afterOnHand : undefined,
      return_status:
        nextPendingDisposition === 0 ? "completed" : "in_disposition",
      qty_pending_disposition: nextPendingDisposition,
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "return.disposition",
      returnItemId,
      actor,
      result,
    );
    return result;
  });
}

export async function emitImmutableEvent(
  db: Firestore,
  input: OperationalEventInput,
  actor: OperationalActor,
) {
  const id = input.dedupe_key
    ? safeDocId(input.dedupe_key)
    : `evt_${digest({ nonce: randomUUID() })}`;
  const ref = db.collection(collections.events).doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const data = snapshot.data() ?? {};
      if (
        input.dedupe_key &&
        data.dedupe_hash &&
        data.dedupe_hash !== digest(input, 64)
      ) {
        throw new HttpsError(
          "already-exists",
          "A chave de deduplicação do evento já foi usada com outro conteúdo.",
        );
      }
      return eventSummaryFromData(id, data);
    }
    return createEvent(transaction, db, id, input, actor);
  });
}

export async function createCustomerRequestTransaction(
  db: Firestore,
  input: CreateOperationalRequestInput,
  actor: OperationalActor,
) {
  const nonce = input.idempotency_key;
  const requestId = `creq_${digest({ customer: input.customer_code, nonce })}`;
  const operationId = `op_request_${digest({ customer: input.customer_code, nonce })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const requestRef = db.collection(collections.customerRequests).doc(requestId);
  const total = input.items.reduce(
    (sum, item) => sum + number(item.quantity),
    0,
  );
  const description = input.description ?? "";
  const kind = requestType(input.type);
  const eventId = operationEventId(operationId, "request_created");

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    const numberPrefix = requestNumberPrefix(input.type);
    const requestNumber = await reserveRequestNumber(transaction, db, input.customer_code, numberPrefix);

    const reservedBalances = new Map<
      string,
      { row: Row; quantity: number; qtyOnHand: number; qtyReserved: number }
    >();
    const allocations: StockAllocation[] = [];
    const balanceRowsBySku = new Map<string, Row[]>();
    const requestCatalogTargets = new Map<string, CatalogAggregateTarget>();

    if (kind.outbound) {
      const inventoryControl = await assertInventoryOperationsEnabled(
        transaction,
        db,
      );
      // Cada cliente segue a própria abertura (domain/customer-scope.ts).
      const requestCustomer = text(input.customer_code);
      const openingSession = openingUsesGlobalControl(requestCustomer)
        ? undefined
        : (
            await transaction.get(
              db
                .collection(collections.openingInventorySessions)
                .doc(openingInventorySessionDocumentId(requestCustomer)),
            )
          ).data();
      if (
        openingInventoryBlocksOutbound({
          customerCode: requestCustomer,
          control: inventoryControl,
          session: openingSession,
        })
      ) {
        throw new HttpsError(
          "failed-precondition",
          "O estoque ainda está em inventário de abertura. Pedidos serão liberados após a conferência final da Dutelog.",
          { code: "OPENING_INVENTORY_REQUIRED" },
        );
      }

      if (!input.items.length) {
        throw new HttpsError(
          "invalid-argument",
          "Pedido do estoque precisa de ao menos um item.",
        );
      }

      const uniqueSkus = [
        ...new Set(input.items.map((item) => text(item.sku_code))),
      ];
      if (uniqueSkus.some((skuCode) => !skuCode)) {
        throw new HttpsError(
          "invalid-argument",
          "Cada item do pedido deve informar sku_code.",
        );
      }

      for (const skuCode of uniqueSkus) {
        const rows = await readRows(
          transaction,
          skuBalancesQuery(db, input.customer_code, skuCode),
        );
        const locationIds = rows.map((row) => text(row.data.location_id));
        if (locationIds.some((locationId) => !locationId)) {
          throw new HttpsError(
            "failed-precondition",
            `Há saldo interno do SKU ${skuCode} sem localização física.`,
          );
        }
        if (new Set(locationIds).size !== locationIds.length) {
          throw new HttpsError(
            "failed-precondition",
            `Há saldos físicos duplicados para o SKU ${skuCode}.`,
          );
        }
        balanceRowsBySku.set(
          skuCode,
          rows.sort((left, right) =>
            text(left.data.location_id).localeCompare(
              text(right.data.location_id),
            ),
          ),
        );
      }

      for (const skuCode of uniqueSkus) {
        const sourceItem = input.items.find(
          (item) => text(item.sku_code) === skuCode,
        );
        const sourceRow = balanceRowsBySku.get(skuCode)?.[0];
        requestCatalogTargets.set(
          skuCode,
          await resolveCatalogAggregateTargets(
            transaction,
            db,
            skuCode,
            text(sourceItem?.client_item_code) ||
              text(sourceRow?.data.client_item_code) ||
              undefined,
          ),
        );
      }

      input.items.forEach((item, itemIndex) => {
        const skuCode = text(item.sku_code);
        const requestedLocation = text(item.location_id);
        const candidateRows = (balanceRowsBySku.get(skuCode) ?? []).filter(
          (row) =>
            !requestedLocation ||
            text(row.data.location_id) === requestedLocation,
        );
        let remaining = number(item.quantity);
        let availableTotal = 0;

        for (const row of candidateRows) {
          const locationId = text(row.data.location_id);
          const key = balanceKey(input.customer_code, skuCode, locationId);
          const existing = reservedBalances.get(key);
          const qtyOnHand = existing?.qtyOnHand ?? number(row.data.qty_on_hand);
          const qtyReserved =
            existing?.qtyReserved ?? number(row.data.qty_reserved);
          const alreadyAllocated = existing?.quantity ?? 0;
          const available = qtyOnHand - qtyReserved - alreadyAllocated;
          if (qtyOnHand < 0 || qtyReserved < 0 || qtyReserved > qtyOnHand) {
            throw new HttpsError(
              "failed-precondition",
              `Saldo interno inconsistente para o SKU ${skuCode}.`,
            );
          }
          availableTotal += Math.max(0, available);
          if (remaining <= 0 || available <= 0) continue;
          const allocated = Math.min(remaining, available);
          reservedBalances.set(key, {
            row,
            quantity: alreadyAllocated + allocated,
            qtyOnHand,
            qtyReserved,
          });
          allocations.push({
            item,
            clientLineNumber: number(item.line_number) || itemIndex + 1,
            row,
            locationId,
            quantity: allocated,
          });
          remaining -= allocated;
        }

        if (remaining > 0) {
          throw new HttpsError(
            "failed-precondition",
            `Saldo insuficiente para o SKU ${skuCode}. Disponível: ${availableTotal}; solicitado: ${item.quantity}.`,
          );
        }
      });
    }

    const event = eventSummary(eventId, {
      type: "portal.request_created",
      title: kind.outbound
        ? "Pedido criado no portal com estoque reservado"
        : "Solicitação criada no portal",
      description:
        description || itemSummary(input.items, input.title ?? input.type),
      severity: kind.outbound
        ? "attention"
        :
        input.priority === "alta" || input.priority === "urgente"
          ? "attention"
          : "info",
      entity_type: "solicitacao_cliente",
      entity_id: requestId,
      customer_code: input.customer_code,
    });
    const result = {
      id: requestId,
      request_number: requestNumber.number,
      status: "open",
      item_count: input.items.length,
      quantity_total: total,
      reserved_quantity: kind.outbound ? total : 0,
      events: [event],
    };

    if (kind.outbound) {
      for (const balance of reservedBalances.values()) {
        const nextReserved = balance.qtyReserved + balance.quantity;
        transaction.update(balance.row.ref, {
          qty_reserved: nextReserved,
          qty_available: balance.qtyOnHand - nextReserved,
          updated_at: FieldValue.serverTimestamp(),
        });
      }

      const reservedBySku = new Map<
        string,
        OperationalRequestItem & { quantity: number }
      >();
      for (const item of input.items) {
        const skuCode = text(item.sku_code);
        const current = reservedBySku.get(skuCode);
        reservedBySku.set(skuCode, {
          ...(current ?? item),
          quantity: number(current?.quantity) + number(item.quantity),
        });
      }
      for (const [skuCode, item] of reservedBySku) {
        const skuRows = variantScopedBalanceRows(
          balanceRowsBySku.get(skuCode) ?? [],
          skuCode,
          text(item.client_item_code) || undefined,
        );
        const qtyOnHand = skuRows.reduce(
          (sum, row) => sum + number(row.data.qty_on_hand),
          0,
        );
        const qtyReserved =
          skuRows.reduce((sum, row) => sum + number(row.data.qty_reserved), 0) +
          item.quantity;
        const source = skuRows[0]?.data ?? {};
        setClientInventorySnapshot(transaction, db, {
          customerCode: input.customer_code,
          skuCode,
          clientItemCode:
            item.client_item_code ?? text(source.client_item_code) ?? undefined,
          productName:
            item.product_name ?? text(source.product_name) ?? undefined,
          category: text(source.category) || undefined,
          unitCost: number(item.unit_cost) || number(source.unit_cost),
          qtyOnHand,
          qtyReserved,
        });
        applyCatalogStockAggregates(
          transaction,
          requestCatalogTargets.get(skuCode) ?? {},
          { reserved: item.quantity },
        );
      }

      allocations.forEach((allocation, index) => {
        const item = allocation.item;
        const reservationId = `res_${safeDocId(requestId)}_${String(index + 1).padStart(2, "0")}`;
        transaction.create(
          db.collection(collections.stockReservations).doc(reservationId),
          compact({
            id: reservationId,
            customer_code: input.customer_code,
            customer_request_id: requestId,
            line_number: index + 1,
            client_line_number: allocation.clientLineNumber,
            sku_code: item.sku_code,
            client_item_code: item.client_item_code,
            product_name: item.product_name ?? item.sku_code,
            unit_cost: item.unit_cost,
            location_id: allocation.locationId,
            requested_qty: allocation.quantity,
            allocated_qty: allocation.quantity,
            reserved_qty: allocation.quantity,
            status: "reserved",
            source: "customer_request",
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          }),
        );
      });
    }

    commitRequestNumber(transaction, requestNumber, input.customer_code, numberPrefix);
    transaction.create(
      requestRef,
      compact({
        id: requestId,
        request_number: requestNumber.number,
        customer_code: input.customer_code,
        type: input.type,
        priority: input.priority,
        title: input.title ?? input.type,
        description,
        destination: input.destination,
        due_at: input.due_at,
        supplier: input.supplier,
        invoice_number: input.invoice_number,
        attachments: input.attachments,
        attachment_count: input.attachments?.length,
        items: input.items.map((item, index) =>
          compact({ ...item, line_number: item.line_number ?? index + 1 }),
        ),
        item_count: input.items.length,
        quantity_total: total,
        status: "open",
        stock_reservation_status: kind.outbound ? "reserved" : undefined,
        reserved_quantity_total: kind.outbound ? total : undefined,
        requested_by: actorPayload(actor),
        source: "firebase_functions",
        idempotency_hash: digest(input.idempotency_key),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    transaction.create(
      db.collection(collections.clientRequestStatus).doc(requestId),
      compact({
        id: requestId,
        request_number: requestNumber.number,
        customer_code: input.customer_code,
        type: input.type,
        priority: input.priority,
        title: input.title ?? input.type,
        description,
        destination: input.destination,
        due_at: input.due_at,
        supplier: input.supplier,
        invoice_number: input.invoice_number,
        attachments: input.attachments,
        attachment_count: input.attachments?.length,
        items: portalRequestItems(input.items),
        item_count: input.items.length,
        quantity_total: total,
        status: "open",
        operational_status: kind.outbound
          ? "reserved_awaiting_review"
          : "awaiting_review",
        reserved_quantity_total: kind.outbound ? total : undefined,
        requested_by_name: actor.name ?? actor.email,
        published_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );
    createEvent(
      transaction,
      db,
      eventId,
      {
        type: event.type,
        title: "Solicitação criada no portal",
        description:
          description || itemSummary(input.items, input.title ?? input.type),
        severity: event.severity,
        entity_type: event.entity_type,
        entity_id: requestId,
        customer_code: input.customer_code,
        payload: {
          item_count: input.items.length,
          quantity_total: total,
          reserved_quantity_total: kind.outbound ? total : undefined,
          request_type: input.type,
          supplier: input.supplier,
          invoice_number: input.invoice_number,
          attachment_count: input.attachments?.length ?? 0,
        },
      },
      actor,
    );
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "customer_request.create",
      requestId,
      actor,
      result,
    );
    return result;
  });
}

export async function createInboundReceiptTransaction(
  db: Firestore,
  input: CreateInboundReceiptInput,
  actor: OperationalActor,
) {
  if (!input.items.length) {
    throw new HttpsError(
      "invalid-argument",
      "Recebimento precisa de ao menos uma linha.",
    );
  }

  const normalizedItems = input.items.map((item, index) => {
    // Linha de produto novo: o SKU é gerado na sigla do cliente dentro da
    // transação (domain/catalog-codes.ts); o que vier digitado é ignorado.
    const isNew = text(item.product_registration) === "new";
    const clientItemCode = normalizedIdentity(
      item.client_item_code || (isNew ? "" : item.sku_code),
    );
    const skuCode = isNew
      ? ""
      : normalizedIdentity(item.sku_code || item.client_item_code);
    const productName = text(item.product_name || clientItemCode || skuCode);
    const quantity = requiredPositive(
      item.quantity,
      `Quantidade da linha ${index + 1}`,
    );
    if ((!skuCode && !isNew) || !productName) {
      throw new HttpsError(
        "invalid-argument",
        `Linha ${index + 1} precisa de código do cliente ou SKU e descrição do produto.`,
      );
    }
    return {
      ...item,
      line_number: number(item.line_number) || index + 1,
      sku_code: skuCode,
      client_item_code: clientItemCode || skuCode,
      product_name: productName,
      product_registration: text(item.product_registration),
      category: text(item.category) || undefined,
      barcode: text(item.barcode) || undefined,
      brand: text(item.brand) || undefined,
      size: text(item.size) || undefined,
      color: text(item.color) || undefined,
      photo_urls: stringList(item.photo_urls),
      photo_storage_paths: stringList(item.photo_storage_paths),
      location_id: text(item.location_id) || "RECEBIMENTO",
      unit_cost: number(item.unit_cost),
      quantity,
      notes: text(item.notes) || undefined,
    };
  });

  const clientCodeSeen = new Map<string, number>();
  const skuCodeSeen = new Map<string, number>();
  for (const item of normalizedItems) {
    const key = normalizedIdentity(item.client_item_code);
    if (!key) continue;
    const previousLine = clientCodeSeen.get(key);
    if (previousLine) {
      throw new HttpsError(
        "invalid-argument",
        `Cod. cliente ${item.client_item_code} repetido nas linhas ${previousLine} e ${item.line_number}. Use uma única linha para o mesmo produto.`,
      );
    }
    clientCodeSeen.set(key, item.line_number);

    const skuKey = normalizedIdentity(item.sku_code);
    if (!skuKey) continue;
    const previousSkuLine = skuCodeSeen.get(skuKey);
    if (previousSkuLine) {
      throw new HttpsError(
        "invalid-argument",
        `SKU ${item.sku_code} repetido nas linhas ${previousSkuLine} e ${item.line_number}. Use uma única linha para o mesmo produto.`,
      );
    }
    skuCodeSeen.set(skuKey, item.line_number);
  }

  // Dois produtos novos com o mesmo código de barras na mesma chegada são um só.
  const barcodeSeen = new Map<string, number>();
  for (const item of normalizedItems) {
    if (item.product_registration !== "new") continue;
    const barcodeKey = normalizeBarcode(item.barcode);
    if (!barcodeKey) continue;
    const previousLine = barcodeSeen.get(barcodeKey);
    if (previousLine) {
      throw new HttpsError(
        "invalid-argument",
        `Código de barras ${barcodeKey} repetido nas linhas ${previousLine} e ${item.line_number}. Use uma única linha para o mesmo produto.`,
      );
    }
    barcodeSeen.set(barcodeKey, item.line_number);
  }

  const nonce = input.idempotency_key;
  const receiptId = `inb_avulso_${digest({
    customer: input.customer_code,
    nonce,
  })}`;
  const operationId = `op_inbound_create_${digest({
    customer: input.customer_code,
    nonce,
  })}`;
  const inputHash = digest(input, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const receiptRef = db.collection(collections.inboundReceipts).doc(receiptId);
  const receiptNumber = `AVL-${receiptId.slice(-8).toUpperCase()}`;
  const quantityTotal = normalizedItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const occurredAt = input.received_at || new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    // SKU gerado para cada linha nova, na ordem das linhas, e duplicidade por
    // código de barras dentro do cliente. Tudo leitura, antes das escritas.
    const customerCode = text(input.customer_code);
    const skuAllocator: SkuAllocator | undefined = normalizedItems.some(
      (item) => item.product_registration === "new",
    )
      ? await openSkuAllocator(transaction, db, customerCode)
      : undefined;
    const items: typeof normalizedItems = [];
    for (const item of normalizedItems) {
      if (item.product_registration !== "new" || !skuAllocator) {
        items.push(item);
        continue;
      }
      const generated = await skuAllocator.next();
      items.push({
        ...item,
        sku_code: generated,
        client_item_code: item.client_item_code || generated,
        product_name: item.product_name || generated,
      });
    }

    const catalogChecks = await Promise.all(
      items.map(async (item) => {
        const clientCode = normalizedIdentity(item.client_item_code);
        const declaredSku = normalizedIdentity(item.sku_code);
        const productRef = db
          .collection(collections.products)
          .doc(safeDocId(clientCode));
        const skuRef = db
          .collection(collections.skus)
          .doc(safeDocId(declaredSku));
        const [skuRows, productRows, productCodeSnapshot, skuCodeSnapshot] =
          await Promise.all([
            readRows(
              transaction,
            db
              .collection(collections.skus)
                .where("cod_cliente_key", "==", clientCode),
            ),
            readRows(
              transaction,
            db
              .collection(collections.products)
                .where("cod_cliente_key", "==", clientCode),
            ),
            transaction.get(productRef),
            transaction.get(skuRef),
          ]);
        return {
          item,
          clientCode,
          declaredSku,
          productRef,
          skuRef,
          skuRows,
          productRows,
          productCodeSnapshot,
          skuCodeSnapshot,
          wantsNewProduct: text(item.product_registration) === "new",
        };
      }),
    );

    for (const check of catalogChecks) {
      const {
        item,
        clientCode,
        declaredSku,
        skuRows,
        productRows,
        productCodeSnapshot,
        skuCodeSnapshot,
        wantsNewProduct,
      } = check;
      // Um código de catálogo tem dono: o recebimento de um cliente não
      // reaproveita o cadastro de outro (domain/customer-scope.ts).
      assertCatalogOwnedBy(
        text(input.customer_code),
        [
          ...productRows.map((row) => row.data),
          ...skuRows.map((row) => row.data),
          productCodeSnapshot.exists ? productCodeSnapshot.data() : undefined,
        ],
        `O código ${clientCode}`,
      );
      assertCatalogOwnedBy(
        text(input.customer_code),
        [skuCodeSnapshot.exists ? skuCodeSnapshot.data() : undefined],
        `O SKU ${declaredSku}`,
      );
      const existingSkuCodes = new Set(
        [
          ...skuRows.map((row) =>
            normalizedIdentity(
              row.data.cod_btg || row.data.sku_code || row.data.cod_sku,
            ),
          ),
          normalizedIdentity(
            skuCodeSnapshot.data()?.cod_btg ||
              skuCodeSnapshot.data()?.sku_code ||
              skuCodeSnapshot.data()?.cod_sku,
          ),
        ].filter(Boolean),
      );

      if (wantsNewProduct) {
        if (!text(item.category)) {
          throw new HttpsError(
            "invalid-argument",
            `Linha ${item.line_number}: produto novo exige categoria.`,
          );
        }
        if (number(item.unit_cost) <= 0) {
          throw new HttpsError(
            "invalid-argument",
            `Linha ${item.line_number}: produto novo exige custo unitário maior que zero.`,
          );
        }
        if (!stringList(item.photo_urls).length) {
          throw new HttpsError(
            "invalid-argument",
            `Linha ${item.line_number}: produto novo exige ao menos uma foto.`,
          );
        }
      }

      if (existingSkuCodes.size > 0 && !existingSkuCodes.has(declaredSku)) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${clientCode} já existe no cadastro com SKU ${[
            ...existingSkuCodes,
          ].join(", ")}. Use o cadastro existente para evitar SKU duplicado.`,
        );
      }

      if (skuCodeSnapshot.exists) {
        const skuData = skuCodeSnapshot.data() ?? {};
        const skuClientCode = text(skuData.cod_cliente || skuData.client_item_code);
        if (skuClientCode && skuClientCode !== clientCode) {
          throw new HttpsError(
            "failed-precondition",
            `SKU ${declaredSku} já está vinculado ao Cod. cliente ${skuClientCode}. Revise o cadastro antes de receber este item.`,
          );
        }
      }

      if (
        wantsNewProduct &&
        (productRows.length > 0 ||
          skuRows.length > 0 ||
          productCodeSnapshot.exists ||
          skuCodeSnapshot.exists)
      ) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${clientCode} já existe no cadastro. Use o produto existente para evitar SKU duplicado.`,
        );
      }

      if (
        !wantsNewProduct &&
        productRows.length === 0 &&
        skuRows.length === 0 &&
        !productCodeSnapshot.exists &&
        !skuCodeSnapshot.exists
      ) {
        throw new HttpsError(
          "failed-precondition",
          `Cod. cliente ${clientCode} não existe no cadastro. Marque a linha como novo produto antes de criar a conferência.`,
        );
      }

      if (
        (productRows.length > 0 || productCodeSnapshot.exists) &&
        existingSkuCodes.size === 0
      ) {
        const productName = text(
          productRows[0]?.data.produto ||
            productRows[0]?.data.product_name ||
            productRows[0]?.data.name ||
            productCodeSnapshot.data()?.produto ||
            productCodeSnapshot.data()?.product_name ||
            productCodeSnapshot.data()?.name,
        );
        const sameName =
          !productName ||
          normalizedIdentity(productName) === normalizedIdentity(item.product_name);
        if (!sameName) {
          throw new HttpsError(
            "failed-precondition",
            `Cod. cliente ${clientCode} já existe no cadastro de produto como ${productName}. Revise antes de criar novo SKU.`,
          );
        }
      }

    }

    // Depois das checagens de código: código de barras de outro produto ativo
    // do mesmo cliente é o mesmo produto (domain/catalog-codes.ts).
    for (const item of items) {
      if (item.product_registration !== "new") continue;
      await assertBarcodeAvailable(transaction, db, customerCode, item.barcode, LEGACY_CUSTOMER_CODE);
    }

    // Primeira escrita: o contador dos SKUs gerados.
    skuAllocator?.commit();

    for (const check of catalogChecks) {
      const {
        item,
        clientCode,
        declaredSku,
        productRef,
        skuRef,
        productRows,
        skuRows,
        productCodeSnapshot,
        skuCodeSnapshot,
        wantsNewProduct,
      } = check;
      if (
        wantsNewProduct &&
        productRows.length === 0 &&
        skuRows.length === 0 &&
        !productCodeSnapshot.exists &&
        !skuCodeSnapshot.exists
      ) {
        const baseCatalogPayload = compact({
          customer_code: input.customer_code,
          cod_cliente: clientCode,
          cod_cliente_key: normalizedIdentity(clientCode),
          produto: item.product_name,
          category: item.category,
          categoria: item.category,
          barcode: item.barcode,
          barcode_key: normalizeBarcode(item.barcode) || undefined,
          brand: item.brand,
          marca: item.brand,
          size: item.size,
          tamanho: item.size,
          color: item.color,
          cor: item.color,
          photo_urls: item.photo_urls?.length ? item.photo_urls : undefined,
          primary_photo_url: item.photo_urls?.[0],
          photo_storage_paths: item.photo_storage_paths?.length
            ? item.photo_storage_paths
            : undefined,
          preco_unit: item.unit_cost,
          unit_cost: item.unit_cost,
          status: "active",
          archived: false,
          source: "wms_unplanned_receipt",
          source_receipt_id: receiptId,
          created_by: actorPayload(actor),
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        transaction.create(productRef, {
          id: clientCode,
          ...baseCatalogPayload,
          estoque_btg: 0,
          num_skus: 1,
          custo_total: 0,
        });
        transaction.create(skuRef, {
          id: declaredSku,
          ...baseCatalogPayload,
          cod_btg: declaredSku,
          sku_code: declaredSku,
          sku_code_key: normalizedIdentity(declaredSku),
          estoque_atual: 0,
          estoque_reservado: 0,
          estoque_disponivel: 0,
        });
      }
    }

    transaction.create(
      receiptRef,
      compact({
        id: receiptId,
        customer_code: input.customer_code,
        receipt_number: receiptNumber,
        status: "created",
        priority: input.priority || "normal",
        supplier: input.supplier,
        invoice_number: input.invoice_number,
        reference: input.reference || input.invoice_number,
        notes: input.notes,
        item_count: items.length,
        qty_expected: quantityTotal,
        qty_received: 0,
        source: "wms_unplanned_receipt",
        received_at: occurredAt,
        created_by: actorPayload(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
    );

    items.forEach((item, index) => {
      const lineNumber = index + 1;
      const itemId = `inbi_${safeDocId(receiptId)}_${String(lineNumber).padStart(2, "0")}`;
      transaction.create(
        db.collection(collections.inboundItems).doc(itemId),
        compact({
          id: itemId,
          customer_code: input.customer_code,
          receipt_id: receiptId,
          receipt_number: receiptNumber,
          line_number: lineNumber,
          sku_code: item.sku_code,
          client_item_code: item.client_item_code,
          product_name: item.product_name,
          category: item.category,
          barcode: item.barcode,
          brand: item.brand,
          size: item.size,
          color: item.color,
          photo_urls: item.photo_urls?.length ? item.photo_urls : undefined,
          photo_storage_paths: item.photo_storage_paths?.length
            ? item.photo_storage_paths
            : undefined,
          location_id: item.location_id,
          unit_cost: item.unit_cost,
          product_registration: item.product_registration,
          expected_qty: item.quantity,
          received_qty: 0,
          status: "expected",
          notes: item.notes,
          source: "wms_unplanned_receipt",
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
    });

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "inbound_created"),
      {
        type: "inbound.created",
        title: "Recebimento avulso registrado no WMS",
        description:
          input.notes ||
          `${items.length} linha(s), ${quantityTotal} unidade(s) aguardando conferência.`,
        severity: "attention",
        entity_type: "recebimento",
        entity_id: receiptId,
        customer_code: input.customer_code,
        payload: {
          receipt_number: receiptNumber,
          supplier: input.supplier,
          invoice_number: input.invoice_number,
          quantity_total: quantityTotal,
          source: "wms_unplanned_receipt",
        },
      },
      actor,
    );

    const result = {
      ok: true,
      id: receiptId,
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      status: "created",
      item_count: items.length,
      quantity_total: quantityTotal,
      // Códigos de cada linha, com o SKU gerado das linhas novas.
      items: items.map((item) => ({
        line_number: item.line_number,
        sku_code: item.sku_code,
        client_item_code: item.client_item_code,
        product_registration: item.product_registration || undefined,
      })),
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inbound_receipt.create",
      receiptId,
      actor,
      result,
    );
    return result;
  });
}

export async function updateInboundReceiptConferenceTransaction(
  db: Firestore,
  input: UpdateInboundReceiptConferenceInput,
  actor: OperationalActor,
) {
  const receiptId = safeDocId(input.receipt_id);
  if (!input.lines.length) {
    throw new HttpsError(
      "invalid-argument",
      "Informe ao menos uma linha conferida.",
    );
  }
  const operationId = `op_inbound_conference_${digest({
    receiptId,
    nonce: input.idempotency_key,
  })}`;
  const inputHash = digest({ ...input, receipt_id: receiptId }, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const receiptRef = db.collection(collections.inboundReceipts).doc(receiptId);

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    const receiptSnapshot = await transaction.get(receiptRef);
    if (!receiptSnapshot.exists) {
      throw new HttpsError("not-found", "Recebimento não encontrado.");
    }
    const receipt = asRecord(receiptSnapshot.data());
    const currentStatus = text(receipt.status || "created").toLowerCase();
    if (input.expected_status && currentStatus !== input.expected_status) {
      throw new HttpsError(
        "failed-precondition",
        `Status divergente: esperado ${input.expected_status}, encontrado ${currentStatus}.`,
      );
    }
    if (!["created", "checking"].includes(currentStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `Recebimento em ${currentStatus} não aceita nova conferência.`,
      );
    }

    const rows = await readRows(
      transaction,
      db.collection(collections.inboundItems).where("receipt_id", "==", receiptId),
    );
    if (!rows.length) {
      throw new HttpsError(
        "failed-precondition",
        "Recebimento não possui linhas para conferir.",
      );
    }
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    // Linha avisada pelo cliente sem código: o conferente informa o código
    // da etiqueta. Existente no cadastro liga ao SKU; senão vira produto novo.
    // Todas as leituras antes de qualquer escrita da transação.
    const codeAssignments = new Map<
      string,
      {
        sku_code: string;
        client_item_code: string;
        product_name: string;
        product_registration: "existing" | "new";
      }
    >();
    // Produto novo achado na conferência: SKU gerado na sigla do cliente
    // (domain/catalog-codes.ts), aberto só quando a primeira linha nova aparece.
    const receiptCustomer = text(receipt.customer_code) || LEGACY_CUSTOMER_CODE;
    let skuAllocator: SkuAllocator | undefined;
    for (const line of input.lines) {
      const row = rowsById.get(safeDocId(line.inbound_item_id));
      if (!row || text(row.data.sku_code)) continue;
      const lineLabel = number(row.data.line_number) || row.id;
      const clientCode = normalizedIdentity(line.client_item_code);
      if (!clientCode) {
        throw new HttpsError(
          "invalid-argument",
          `Linha ${lineLabel} está com código a definir. Informe o código da etiqueta.`,
        );
      }
      const [skuRows, productSnapshot] = await Promise.all([
        readRows(
          transaction,
          db.collection(collections.skus).where("cod_cliente_key", "==", clientCode),
        ),
        transaction.get(db.collection(collections.products).doc(safeDocId(clientCode))),
      ]);
      const skuCodes = [
        ...new Set(
          skuRows
            .map((sku) => normalizedIdentity(sku.data.cod_btg || sku.data.sku_code || sku.data.cod_sku))
            .filter(Boolean),
        ),
      ];
      if (skuCodes.length > 1) {
        throw new HttpsError(
          "failed-precondition",
          `Código ${clientCode} está ligado a mais de um SKU (${skuCodes.join(", ")}). Revise o cadastro antes de conferir.`,
        );
      }
      // Um código de catálogo tem dono: o envio de um cliente não liga a
      // linha ao cadastro de outro (domain/customer-scope.ts).
      assertCatalogOwnedBy(
        receiptCustomer,
        [
          ...skuRows.map((sku) => sku.data),
          productSnapshot.exists ? productSnapshot.data() : undefined,
        ],
        `O código ${clientCode}`,
      );
      const product = productSnapshot.data() ?? {};
      const catalogName = text(
        skuRows[0]?.data.produto ||
          skuRows[0]?.data.product_name ||
          product.produto ||
          product.product_name,
      );
      const exists = skuCodes.length > 0 || productSnapshot.exists;
      let skuCode = skuCodes[0] || clientCode;
      if (!exists) {
        skuAllocator ??= await openSkuAllocator(transaction, db, receiptCustomer);
        skuCode = await skuAllocator.next();
      }
      codeAssignments.set(row.id, {
        sku_code: skuCode,
        client_item_code: clientCode,
        product_name: catalogName || text(row.data.product_name) || clientCode,
        product_registration: exists ? "existing" : "new",
      });
    }

    // Primeira escrita: o contador dos SKUs gerados.
    skuAllocator?.commit();

    let receivedTotal = 0;
    let expectedTotal = 0;
    let differenceTotal = 0;
    let divergenceCount = 0;

    for (const line of input.lines) {
      const row = rowsById.get(safeDocId(line.inbound_item_id));
      if (!row) {
        throw new HttpsError(
          "not-found",
          `Linha ${line.inbound_item_id} não pertence ao recebimento.`,
        );
      }
      const receivedQty = number(line.received_qty);
      if (receivedQty < 0) {
        throw new HttpsError(
          "invalid-argument",
          "Quantidade conferida não pode ser negativa.",
        );
      }
      const expectedQty = number(row.data.expected_qty);
      const differenceQty = receivedQty - expectedQty;
      const conferenceStatus =
        differenceQty === 0 ? "ok" : differenceQty < 0 ? "short" : "over";
      expectedTotal += expectedQty;
      receivedTotal += receivedQty;
      differenceTotal += differenceQty;
      if (differenceQty !== 0) divergenceCount += 1;
      transaction.update(
        row.ref,
        compact({
          expected_qty: expectedQty,
          received_qty: receivedQty,
          difference_qty: differenceQty,
          conference_status: conferenceStatus,
          location_id: text(line.location_id) || row.data.location_id,
          unit_cost:
            line.unit_cost === undefined
              ? row.data.unit_cost
              : number(line.unit_cost),
          status:
            differenceQty === 0
              ? "checked"
              : "divergence",
          conference_notes: text(line.notes) || undefined,
          ...(codeAssignments.get(row.id) ?? {}),
          ...(codeAssignments.has(row.id)
            ? { code_assigned_by: actorPayload(actor), code_assigned_at: FieldValue.serverTimestamp() }
            : {}),
          checked_by: actorPayload(actor),
          checked_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
    }

    transaction.update(receiptRef, {
      status: "checking",
      qty_expected: expectedTotal || number(receipt.qty_expected),
      qty_received: receivedTotal,
      qty_difference: differenceTotal,
      divergence_count: divergenceCount,
      conference_status: divergenceCount ? "divergent" : "ok",
      checked_by: actorPayload(actor),
      checked_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "conference_saved"),
      {
        type: "inbound.conference_saved",
        title: "Conferência de recebimento salva",
        description: `${input.lines.length} linha(s) conferida(s), ${receivedTotal} unidade(s) contada(s), ${divergenceCount} divergência(s).`,
        severity: "attention",
        entity_type: "recebimento",
        entity_id: receiptId,
        customer_code: text(receipt.customer_code) || undefined,
        payload: {
          receipt_number: receipt.receipt_number,
          line_count: input.lines.length,
          expected_qty: expectedTotal || number(receipt.qty_expected),
          received_qty: receivedTotal,
          difference_qty: differenceTotal,
          divergence_count: divergenceCount,
        },
      },
      actor,
    );

    const events = [event];
    if (codeAssignments.size) {
      events.push(
        createEvent(
          transaction,
          db,
          operationEventId(operationId, "item_codes_assigned"),
          {
            type: "inbound.item_codes_assigned",
            title: "Código definido na conferência",
            description: `${codeAssignments.size} linha(s) avisada(s) sem código receberam o código da etiqueta.`,
            severity: "attention",
            entity_type: "recebimento",
            entity_id: receiptId,
            customer_code: text(receipt.customer_code) || undefined,
            payload: {
              receipt_number: receipt.receipt_number,
              lines: [...codeAssignments].map(([inboundItemId, assigned]) => ({
                inbound_item_id: inboundItemId,
                ...assigned,
              })),
            },
          },
          actor,
        ),
      );
    }

    const result = {
      ok: true,
      id: receiptId,
      receipt_id: receiptId,
      status: "checking",
      checked_lines: input.lines.length,
      expected_quantity: expectedTotal || number(receipt.qty_expected),
      received_quantity: receivedTotal,
      difference_quantity: differenceTotal,
      divergence_count: divergenceCount,
      codes_assigned: codeAssignments.size,
      events,
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "inbound_receipt.conference",
      receiptId,
      actor,
      result,
    );
    return result;
  });
}

function normalizeStoredItems(request: Record<string, unknown>) {
  const raw = Array.isArray(request.items) ? request.items : [];
  return raw.map((value, index): OperationalRequestItem => {
    const item = asRecord(value);
    return {
      line_number: number(item.line_number) || index + 1,
      sku_code: text(item.sku_code) || undefined,
      client_item_code: text(item.client_item_code) || undefined,
      product_name: text(item.product_name) || undefined,
      product_registration: text(item.product_registration) || undefined,
      location_id: text(item.location_id) || undefined,
      condition: text(item.condition) || undefined,
      category: text(item.category) || undefined,
      barcode: text(item.barcode) || undefined,
      brand: text(item.brand) || undefined,
      size: text(item.size) || undefined,
      color: text(item.color) || undefined,
      photo_urls: stringList(item.photo_urls),
      photo_storage_paths: stringList(item.photo_storage_paths),
      unit_cost: number(item.unit_cost),
      quantity: requiredPositive(
        item.quantity,
        `Quantidade da linha ${index + 1}`,
      ),
      notes: text(item.notes) || undefined,
    };
  });
}

/**
 * Eventos gravados por uma decisão da triagem. Continuam no ledger de
 * auditoria, mas não viram aviso na caixa do agente: quem decidiu já agiu, e
 * o que a decisão cria (pedido, reserva, picking) aparece nas filas do WMS.
 */
function createDecisionEvent(
  transaction: Transaction,
  db: Firestore,
  id: string,
  input: OperationalEventInput,
  actor: OperationalActor,
) {
  return createEvent(transaction, db, id, { ...input, inbox: false }, actor);
}

export async function decideCustomerRequestTransaction(
  db: Firestore,
  input: DecideOperationalRequestInput,
  actor: OperationalActor,
) {
  const requestId = safeDocId(input.request_id);
  const expectedStatus = text(input.expected_status).toLowerCase();
  if (!expectedStatus) {
    throw new HttpsError(
      "invalid-argument",
      "expected_status é obrigatório para decidir a solicitação.",
    );
  }
  const operationNonce =
    input.idempotency_key ?? `${input.action}:${expectedStatus}`;
  const operationId = `op_decision_${digest({ requestId, operationNonce })}`;
  const inputHash = digest(
    { ...input, request_id: requestId, expected_status: expectedStatus },
    64,
  );
  const operationRef = db.collection(collections.operations).doc(operationId);
  const requestRef = db.collection(collections.customerRequests).doc(requestId);
  const occurredAt = new Date().toISOString();
  const nextStatus =
    input.action === "approve"
      ? "approved"
      : input.action === "reject"
        ? "rejected"
        : input.action === "cancel"
          ? "cancelled"
          : "closed";
  // Recusar (Dutelog) e cancelar (o próprio cliente) desfazem a reserva igual.
  const releasesRequest = input.action === "reject" || input.action === "cancel";

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) {
      throw new HttpsError("not-found", "Solicitação não encontrada.");
    }
    const request = asRecord(requestSnapshot.data());
    const currentStatus = text(request.status || "open").toLowerCase();
    if (currentStatus !== expectedStatus) {
      throw new HttpsError(
        "failed-precondition",
        `Status divergente: esperado ${expectedStatus}, encontrado ${currentStatus}.`,
      );
    }
    const decisionableStatuses = new Set(["open", "submitted", "pending"]);
    if (
      (input.action === "approve" || releasesRequest) &&
      !decisionableStatuses.has(currentStatus)
    ) {
      throw new HttpsError(
        "failed-precondition",
        input.action === "cancel"
          ? "A Dutelog já confirmou esta solicitação. Para mudar, fale com a equipe."
          : `Solicitação em ${currentStatus} não pode ser ${input.action === "approve" ? "aprovada" : "rejeitada"}.`,
      );
    }
    if (input.action === "cancel") {
      // Só o cliente dono cancela, e só antes da confirmação da Dutelog.
      if (actor.role !== "cliente" || text(actor.customer_code) !== text(request.customer_code)) {
        throw new HttpsError("permission-denied", "Só o cliente que fez a solicitação pode cancelá-la.");
      }
    }
    if (input.action === "close" && currentStatus !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        `Solicitação em ${currentStatus} não pode ser encerrada.`,
      );
    }

    const customerCode = text(request.customer_code) || "BTG Pactual";
    const items = normalizeStoredItems(request);
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    const kind = requestType(request.type);
    const description = text(request.description || request.title || requestId);
    const created: Record<string, unknown> = {};
    const reservedBalances = new Map<
      string,
      { row: Row; quantity: number; qtyOnHand: number; qtyReserved: number }
    >();
    const allocations: StockAllocation[] = [];
    const balanceRowsBySku = new Map<string, Row[]>();
    const decisionCatalogTargets = new Map<string, CatalogAggregateTarget>();
    let preReservedRows: Row[] = [];
    let releaseReservationRows: Row[] = [];
    const releaseBalancesBySku = new Map<string, Row[]>();
    let inboundSkuAllocator: SkuAllocator | undefined;

    if (input.action === "approve" && kind.outbound) {
      preReservedRows = await readRows(
        transaction,
        db
          .collection(collections.stockReservations)
          .where("customer_request_id", "==", requestId)
          .where("status", "==", "reserved"),
      );

      if (!items.length) {
        throw new HttpsError(
          "invalid-argument",
          "Solicitação de retirada precisa de ao menos um item.",
        );
      }
      const uniqueSkus = [...new Set(items.map((item) => text(item.sku_code)))];
      if (uniqueSkus.some((skuCode) => !skuCode)) {
        throw new HttpsError(
          "invalid-argument",
          "Cada item de retirada deve informar sku_code.",
        );
      }

      const skusToLoad = preReservedRows.length
        ? [
            ...new Set(
              preReservedRows
                .map((row) => text(row.data.sku_code))
                .filter(Boolean),
            ),
          ]
        : uniqueSkus;
      for (const skuCode of skusToLoad) {
        const rows = await readRows(
          transaction,
          skuBalancesQuery(db, customerCode, skuCode),
        );
        const locationIds = rows.map((row) => text(row.data.location_id));
        if (locationIds.some((locationId) => !locationId)) {
          throw new HttpsError(
            "failed-precondition",
            `Há saldo interno do SKU ${skuCode} sem localização física.`,
          );
        }
        if (new Set(locationIds).size !== locationIds.length) {
          throw new HttpsError(
            "failed-precondition",
            `Há saldos físicos duplicados para o SKU ${skuCode}.`,
          );
        }
        balanceRowsBySku.set(
          skuCode,
          rows.sort((left, right) =>
            text(left.data.location_id).localeCompare(
              text(right.data.location_id),
            ),
          ),
        );
      }

      if (!preReservedRows.length) {
        for (const skuCode of skusToLoad) {
          const sourceItem = items.find(
            (item) => text(item.sku_code) === skuCode,
          );
          const sourceRow = balanceRowsBySku.get(skuCode)?.[0];
          decisionCatalogTargets.set(
            skuCode,
            await resolveCatalogAggregateTargets(
              transaction,
              db,
              skuCode,
              text(sourceItem?.client_item_code) ||
                text(sourceRow?.data.client_item_code) ||
                undefined,
            ),
          );
        }
      }

      if (preReservedRows.length) {
        let reservedTotal = 0;
        preReservedRows.forEach((reservation, index) => {
          const skuCode = text(reservation.data.sku_code);
          const locationId = text(reservation.data.location_id);
          const quantity = number(
            reservation.data.reserved_qty ??
              reservation.data.allocated_qty ??
              reservation.data.requested_qty,
          );
          if (!skuCode || !locationId || quantity <= 0) {
            throw new HttpsError(
              "failed-precondition",
              `Reserva ${reservation.id} não possui SKU, localização e quantidade válidos.`,
            );
          }
          const balanceRow = (balanceRowsBySku.get(skuCode) ?? []).find(
            (row) => text(row.data.location_id) === locationId,
          );
          if (!balanceRow) {
            throw new HttpsError(
              "failed-precondition",
              `Saldo físico da reserva ${reservation.id} não foi encontrado.`,
            );
          }
          reservedTotal += quantity;
          allocations.push({
            item: {
              line_number:
                number(reservation.data.client_line_number) || index + 1,
              sku_code: skuCode,
              client_item_code:
                text(reservation.data.client_item_code) || undefined,
              product_name: text(reservation.data.product_name) || skuCode,
              location_id: locationId,
              unit_cost: number(reservation.data.unit_cost),
              quantity,
              notes: text(reservation.data.notes) || undefined,
            },
            clientLineNumber:
              number(reservation.data.client_line_number) || index + 1,
            row: balanceRow,
            reservationRow: reservation,
            locationId,
            quantity,
          });
        });

        if (reservedTotal < total) {
          throw new HttpsError(
            "failed-precondition",
            `Reserva insuficiente para a solicitação. Reservado: ${reservedTotal}; solicitado: ${total}.`,
          );
        }
      } else {
        items.forEach((item, itemIndex) => {
          const skuCode = text(item.sku_code);
          const requestedLocation = text(item.location_id);
          const candidateRows = (balanceRowsBySku.get(skuCode) ?? []).filter(
            (row) =>
              !requestedLocation ||
              text(row.data.location_id) === requestedLocation,
          );
          let remaining = item.quantity;
          let availableTotal = 0;

          for (const row of candidateRows) {
            const locationId = text(row.data.location_id);
            const key = balanceKey(customerCode, skuCode, locationId);
            const existing = reservedBalances.get(key);
            const qtyOnHand =
              existing?.qtyOnHand ?? number(row.data.qty_on_hand);
            const qtyReserved =
              existing?.qtyReserved ?? number(row.data.qty_reserved);
            const alreadyAllocated = existing?.quantity ?? 0;
            const available = qtyOnHand - qtyReserved - alreadyAllocated;
            if (qtyOnHand < 0 || qtyReserved < 0 || qtyReserved > qtyOnHand) {
              throw new HttpsError(
                "failed-precondition",
                `Saldo interno inconsistente para o SKU ${skuCode}.`,
              );
            }
            availableTotal += Math.max(0, available);
            if (remaining <= 0 || available <= 0) continue;
            const allocated = Math.min(remaining, available);
            reservedBalances.set(key, {
              row,
              quantity: alreadyAllocated + allocated,
              qtyOnHand,
              qtyReserved,
            });
            allocations.push({
              item,
              clientLineNumber: number(item.line_number) || itemIndex + 1,
              row,
              locationId,
              quantity: allocated,
            });
            remaining -= allocated;
          }

          if (remaining > 0) {
            throw new HttpsError(
              "failed-precondition",
              `Saldo insuficiente para o SKU ${skuCode}. Disponível: ${availableTotal}; solicitado: ${item.quantity}.`,
            );
          }
        });
      }
    }

    if (input.action === "approve" && kind.inbound) {
      // Sem código só vale como "código a definir" (o conferente informa o
      // código da etiqueta), e mesmo assim com o nome do produto.
      const invalid = items.some((item) =>
        text(item.sku_code)
          ? false
          : text(item.product_registration) !== "unknown" || !text(item.product_name),
      );
      if (!items.length || invalid) {
        throw new HttpsError(
          "invalid-argument",
          "Solicitação de recebimento precisa de itens com código ou, sem código, com o nome do produto.",
        );
      }
      // Produto novo avisado no portal: o código digitado é o do cliente, não
      // o SKU. Código já cadastrado para o cliente liga ao SKU dele; senão o
      // SKU é gerado na sigla do cliente (domain/catalog-codes.ts).
      for (const item of items) {
        if (text(item.product_registration) !== "new") continue;
        const clientCode = normalizedIdentity(item.client_item_code || item.sku_code);
        const [skuRows, productSnapshot] = await Promise.all([
          readRows(
            transaction,
            db.collection(collections.skus).where("cod_cliente_key", "==", clientCode),
          ),
          transaction.get(db.collection(collections.products).doc(safeDocId(clientCode))),
        ]);
        assertCatalogOwnedBy(
          customerCode,
          [
            ...skuRows.map((row) => row.data),
            productSnapshot.exists ? productSnapshot.data() : undefined,
          ],
          `O código ${clientCode}`,
        );
        const skuCodes = [
          ...new Set(
            skuRows
              .map((row) => normalizedIdentity(row.data.cod_btg || row.data.sku_code || row.data.cod_sku))
              .filter(Boolean),
          ),
        ];
        if (skuCodes.length > 1) {
          throw new HttpsError(
            "failed-precondition",
            `Código ${clientCode} está ligado a mais de um SKU (${skuCodes.join(", ")}). Revise o cadastro antes de confirmar o envio.`,
          );
        }
        item.client_item_code = clientCode;
        if (skuCodes.length || productSnapshot.exists) {
          item.sku_code = skuCodes[0] || clientCode;
          item.product_registration = "existing";
          continue;
        }
        inboundSkuAllocator ??= await openSkuAllocator(transaction, db, customerCode);
        item.sku_code = await inboundSkuAllocator.next();
      }
    }

    if (releasesRequest && kind.outbound) {
      releaseReservationRows = await readRows(
        transaction,
        db
          .collection(collections.stockReservations)
          .where("customer_request_id", "==", requestId)
          .where("status", "==", "reserved"),
      );
      const releaseSkus = [
        ...new Set(
          releaseReservationRows
            .map((row) => text(row.data.sku_code))
            .filter(Boolean),
        ),
      ];
      for (const skuCode of releaseSkus) {
        const rows = await readRows(
          transaction,
          skuBalancesQuery(db, customerCode, skuCode),
        );
        releaseBalancesBySku.set(skuCode, rows);
        const sourceRow = releaseReservationRows.find(
          (row) => text(row.data.sku_code) === skuCode,
        );
        decisionCatalogTargets.set(
          skuCode,
          await resolveCatalogAggregateTargets(
            transaction,
            db,
            skuCode,
            text(sourceRow?.data.client_item_code) || undefined,
          ),
        );
      }
    }

    // Avisos da caixa do agente abertos por esta solicitação (ex.: a criação
    // no portal). A decisão humana responde a eles; ficam resolvidos junto.
    const openInboxRows = await readRows(
      transaction,
      db
        .collection(collections.agentInbox)
        .where("entity_id", "==", requestId)
        .where("status", "==", "open"),
    );

    // Primeira escrita: o contador dos SKUs gerados para o envio.
    inboundSkuAllocator?.commit();

    const events: OperationalEventSummary[] = [];
    if (input.action === "approve" && kind.outbound) {
      const orderId = `ord_${requestId}`;
      const orderNumber = text(request.request_number) || `SOL-${requestId.slice(-8).toUpperCase()}`;
      const pickTaskId = `pick_${safeDocId(orderId)}`;
      const summary = itemSummary(items, description);

      for (const balance of reservedBalances.values()) {
        const nextReserved = balance.qtyReserved + balance.quantity;
        transaction.update(balance.row.ref, {
          qty_reserved: nextReserved,
          qty_available: balance.qtyOnHand - nextReserved,
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      const reservedBySku = new Map<
        string,
        OperationalRequestItem & { quantity: number }
      >();
      for (const item of items) {
        const skuCode = text(item.sku_code);
        const current = reservedBySku.get(skuCode);
        reservedBySku.set(skuCode, {
          ...(current ?? item),
          quantity: number(current?.quantity) + item.quantity,
        });
      }
      for (const [skuCode, item] of reservedBySku) {
        const skuRows = variantScopedBalanceRows(
          balanceRowsBySku.get(skuCode) ?? [],
          skuCode,
          text(item.client_item_code) || undefined,
        );
        const qtyOnHand = skuRows.reduce(
          (sum, row) => sum + number(row.data.qty_on_hand),
          0,
        );
        const qtyReserved =
          skuRows.reduce((sum, row) => sum + number(row.data.qty_reserved), 0) +
          (preReservedRows.length ? 0 : item.quantity);
        const source = skuRows[0]?.data ?? {};
        setClientInventorySnapshot(transaction, db, {
          customerCode,
          skuCode,
          clientItemCode:
            item.client_item_code ?? text(source.client_item_code) ?? undefined,
          productName:
            item.product_name ?? text(source.product_name) ?? undefined,
          category: text(source.category) || undefined,
          unitCost: number(item.unit_cost) || number(source.unit_cost),
          qtyOnHand,
          qtyReserved,
        });
        if (!preReservedRows.length) {
          applyCatalogStockAggregates(
            transaction,
            decisionCatalogTargets.get(skuCode) ?? {},
            { reserved: item.quantity },
          );
        }
      }

      transaction.create(db.collection(collections.orders).doc(orderId), {
        id: orderId,
        customer_code: customerCode,
        cod_cliente: customerCode,
        num_pedido: orderNumber,
        order_number: orderNumber,
        canal: "Portal do cliente",
        produto: summary,
        qtd_solic: total,
        qtd_sep: 0,
        status: "PENDENTE",
        item_count: items.length,
        customer_request_id: requestId,
        destination: request.destination ?? null,
        source: "customer_request",
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection(collections.pickTasks).doc(pickTaskId), {
        id: pickTaskId,
        customer_code: customerCode,
        order_id: orderId,
        order_number: orderNumber,
        status: "planned",
        priority: request.priority ?? "normal",
        total_lines: allocations.length,
        total_units: total,
        picked_units: 0,
        source: "customer_request",
        customer_request_id: requestId,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });

      allocations.forEach((allocation, index) => {
        const item = allocation.item;
        const lineNumber = index + 1;
        const lineId = `${safeDocId(orderId)}_${String(lineNumber).padStart(2, "0")}`;
        const common = compact({
          customer_code: customerCode,
          order_id: orderId,
          order_number: orderNumber,
          line_number: lineNumber,
          sku_code: item.sku_code,
          client_item_code: item.client_item_code,
          product_name: item.product_name ?? item.sku_code,
          unit_cost: item.unit_cost,
          location_id: allocation.locationId,
          client_line_number: allocation.clientLineNumber,
          requested_qty: allocation.quantity,
          allocated_qty: allocation.quantity,
          picked_qty: 0,
          status: "open",
          source: "customer_request",
          customer_request_id: requestId,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        transaction.create(
          db.collection(collections.orderItems).doc(`oit_${lineId}`),
          { id: `oit_${lineId}`, ...common },
        );
        if (allocation.reservationRow) {
          transaction.update(allocation.reservationRow.ref, {
            ...common,
            reserved_qty: allocation.quantity,
            status: "reserved",
            updated_at: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.create(
            db.collection(collections.stockReservations).doc(`res_${lineId}`),
            {
              id: `res_${lineId}`,
              ...common,
              reserved_qty: allocation.quantity,
              status: "reserved",
            },
          );
        }
        transaction.create(
          db.collection(collections.pickLines).doc(`pli_${lineId}`),
          compact({
            id: `pli_${lineId}`,
            customer_code: customerCode,
            pick_task_id: pickTaskId,
            order_id: orderId,
            order_number: orderNumber,
            line_number: lineNumber,
            sku_code: item.sku_code,
            client_item_code: item.client_item_code,
            product_name: item.product_name ?? item.sku_code,
            location_id: allocation.locationId,
            client_line_number: allocation.clientLineNumber,
            qty_to_pick: allocation.quantity,
            qty_picked: 0,
            status: "open",
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          }),
        );
      });
      Object.assign(created, {
        order_id: orderId,
        order_number: orderNumber,
        pick_task_id: pickTaskId,
        item_count: items.length,
        quantity_total: total,
        allocation_count: allocations.length,
      });
      updateClientTracking(transaction, db, orderId, {
        customer_code: customerCode,
        order_number: orderNumber,
        status: "pending",
        status_label: "Pedido recebido",
        destination: request.destination ?? null,
        item_count: items.length,
        quantity_total: total,
        requested_at: occurredAt,
        customer_request_id: requestId,
        timeline: [
          clientTimelineEntry("pending", "Pedido recebido", actor, occurredAt),
        ],
        created_at: FieldValue.serverTimestamp(),
      });

      const eventInputs: Array<[string, OperationalEventInput]> = [
        [
          "order_created",
          {
            type: "order.created",
            title: "Pedido criado a partir do portal",
            description,
            severity: "attention",
            entity_type: "pedido",
            entity_id: orderId,
            customer_code: customerCode,
            payload: {
              customer_request_id: requestId,
              pick_task_id: pickTaskId,
            },
          },
        ],
        [
          "stock_reserved",
          {
            type: "stock.reserved",
            title: "Estoque reservado para pedido",
            description: summary,
            severity: "attention",
            entity_type: "reserva_estoque",
            entity_id: orderId,
            customer_code: customerCode,
            payload: { customer_request_id: requestId, quantity_total: total },
          },
        ],
        [
          "picking_created",
          {
            type: "picking.created",
            title: "Picking criado a partir do portal",
            description: summary,
            severity: "attention",
            entity_type: "tarefa_picking",
            entity_id: pickTaskId,
            customer_code: customerCode,
            payload: { customer_request_id: requestId, order_id: orderId },
          },
        ],
      ];
      for (const [suffix, eventInput] of eventInputs) {
        events.push(
          createDecisionEvent(
            transaction,
            db,
            operationEventId(operationId, suffix),
            eventInput,
            actor,
          ),
        );
      }
    }

    if (input.action === "approve" && kind.inbound) {
      const inboundId = `inb_${requestId}`;
      const receiptNumber = text(request.request_number) || `SOL-${requestId.slice(-8).toUpperCase()}`;
      transaction.create(
        db.collection(collections.inboundReceipts).doc(inboundId),
        compact({
          id: inboundId,
          customer_code: customerCode,
          receipt_number: receiptNumber,
          status: "created",
          priority: request.priority ?? "normal",
          supplier: request.supplier,
          invoice_number: request.invoice_number,
          reference: request.invoice_number ?? request.title,
          notes: request.description,
          expected_at: request.due_at,
          attachments: request.attachments,
          attachment_count: request.attachment_count,
          item_count: items.length,
          qty_expected: total,
          qty_received: 0,
          customer_request_id: requestId,
          source: "customer_request",
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }),
      );
      items.forEach((item, index) => {
        const lineNumber = index + 1;
        const itemId = `inbi_${safeDocId(inboundId)}_${String(lineNumber).padStart(2, "0")}`;
        transaction.create(
          db.collection(collections.inboundItems).doc(itemId),
          compact({
            id: itemId,
            customer_code: customerCode,
            receipt_id: inboundId,
            receipt_number: receiptNumber,
            line_number: lineNumber,
            sku_code: item.sku_code,
            client_item_code: item.client_item_code,
            product_name: item.product_name ?? item.sku_code,
            product_registration: item.product_registration,
            category: item.category,
            barcode: item.barcode,
            brand: item.brand,
            size: item.size,
            color: item.color,
            photo_urls: item.photo_urls?.length ? item.photo_urls : undefined,
            photo_storage_paths: item.photo_storage_paths?.length
              ? item.photo_storage_paths
              : undefined,
            location_id: item.location_id,
            unit_cost: item.unit_cost,
            notes: item.notes,
            expected_qty: item.quantity,
            received_qty: 0,
            status: "expected",
            source: "customer_request",
            customer_request_id: requestId,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          }),
        );
      });
      Object.assign(created, {
        inbound_id: inboundId,
        receipt_number: receiptNumber,
        item_count: items.length,
        quantity_total: total,
      });
      events.push(
        createDecisionEvent(
          transaction,
          db,
          operationEventId(operationId, "inbound_created"),
          {
            type: "inbound.created",
            title: "Recebimento criado a partir do portal",
            description,
            severity: "attention",
            entity_type: "recebimento",
            entity_id: inboundId,
            customer_code: customerCode,
            payload: {
              customer_request_id: requestId,
              quantity_total: total,
              supplier: request.supplier,
              invoice_number: request.invoice_number,
              attachment_count: number(request.attachment_count),
            },
          },
          actor,
        ),
      );
    }

    let releasedQtyTotal = 0;
    if (
      releasesRequest &&
      kind.outbound &&
      releaseReservationRows.length
    ) {
      const releaseByBalance = new Map<string, { row: Row; quantity: number }>();
      const releasedBySku = new Map<
        string,
        {
          quantity: number;
          clientItemCode?: string;
          productName?: string;
          unitCost?: number;
        }
      >();
      for (const reservation of releaseReservationRows) {
        const skuCode = text(reservation.data.sku_code);
        const locationId = text(reservation.data.location_id);
        const quantity = number(
          reservation.data.reserved_qty ??
            reservation.data.allocated_qty ??
            reservation.data.requested_qty,
        );
        if (!skuCode || !locationId || quantity <= 0) {
          throw new HttpsError(
            "failed-precondition",
            `Reserva ${reservation.id} não possui SKU, localização e quantidade válidos para liberação.`,
          );
        }
        const balanceRow = (releaseBalancesBySku.get(skuCode) ?? []).find(
          (row) => text(row.data.location_id) === locationId,
        );
        if (!balanceRow) {
          throw new HttpsError(
            "failed-precondition",
            `Saldo físico da reserva ${reservation.id} não foi encontrado para liberação.`,
          );
        }
        const key = balanceKey(customerCode, skuCode, locationId);
        const entry = releaseByBalance.get(key) ?? {
          row: balanceRow,
          quantity: 0,
        };
        entry.quantity += quantity;
        releaseByBalance.set(key, entry);
        const skuEntry = releasedBySku.get(skuCode) ?? {
          quantity: 0,
          clientItemCode: text(reservation.data.client_item_code) || undefined,
          productName: text(reservation.data.product_name) || undefined,
          unitCost: number(reservation.data.unit_cost) || undefined,
        };
        skuEntry.quantity += quantity;
        releasedBySku.set(skuCode, skuEntry);
        releasedQtyTotal += quantity;
        transaction.update(reservation.ref, {
          status: "released",
          released_qty: quantity,
          release_reason: input.action === "cancel" ? "customer_request_cancelled" : "customer_request_rejected",
          released_by: actorPayload(actor),
          released_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const entry of releaseByBalance.values()) {
        const qtyOnHand = number(entry.row.data.qty_on_hand);
        const qtyReserved = number(entry.row.data.qty_reserved);
        const nextReserved = qtyReserved - entry.quantity;
        if (nextReserved < 0) {
          throw new HttpsError(
            "failed-precondition",
            `Reserva registrada (${qtyReserved}) é menor que a liberação (${entry.quantity}) no saldo ${entry.row.id}. Faça uma reconciliação antes de rejeitar.`,
          );
        }
        transaction.update(entry.row.ref, {
          qty_reserved: nextReserved,
          qty_available: qtyOnHand - nextReserved,
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const [skuCode, released] of releasedBySku) {
        const skuRows = variantScopedBalanceRows(
          releaseBalancesBySku.get(skuCode) ?? [],
          skuCode,
          released.clientItemCode,
        );
        const qtyOnHand = skuRows.reduce(
          (sum, row) => sum + number(row.data.qty_on_hand),
          0,
        );
        const qtyReservedAfter = Math.max(
          0,
          skuRows.reduce(
            (sum, row) => sum + number(row.data.qty_reserved),
            0,
          ) - released.quantity,
        );
        const source = skuRows[0]?.data ?? {};
        setClientInventorySnapshot(transaction, db, {
          customerCode,
          skuCode,
          clientItemCode:
            released.clientItemCode ??
            (text(source.client_item_code) || undefined),
          productName:
            released.productName ?? (text(source.product_name) || undefined),
          category: text(source.category) || undefined,
          unitCost: released.unitCost || number(source.unit_cost),
          qtyOnHand,
          qtyReserved: qtyReservedAfter,
        });
        applyCatalogStockAggregates(
          transaction,
          decisionCatalogTargets.get(skuCode) ?? {},
          { reserved: -released.quantity },
        );
      }
      events.push(
        createDecisionEvent(
          transaction,
          db,
          operationEventId(operationId, "stock_released"),
          {
            type: "stock.reservation_released",
            title: "Reserva de estoque liberada",
            description: `${releasedQtyTotal} unidade(s) liberada(s) após rejeição da solicitação.`,
            severity: "info",
            entity_type: "reserva_estoque",
            entity_id: requestId,
            customer_code: customerCode,
            payload: {
              customer_request_id: requestId,
              released_qty_total: releasedQtyTotal,
              reservation_count: releaseReservationRows.length,
            },
          },
          actor,
        ),
      );
    }

    const decisionEventInput: OperationalEventInput = {
      type: `customer_request.${nextStatus}`,
      title:
        input.action === "approve"
          ? "Solicitação aprovada"
          : input.action === "reject"
            ? "Solicitação rejeitada"
            : input.action === "cancel"
              ? "Solicitação cancelada pelo cliente"
              : "Solicitação encerrada",
      description,
      severity: input.action === "approve" ? "attention" : "info",
      entity_type: "solicitacao_cliente",
      entity_id: requestId,
      customer_code: customerCode,
      payload: { action: input.action, reason: input.reason, ...created },
    };
    events.unshift(
      // Cancelamento pelo cliente vai para a caixa da equipe: quem estava
      // para separar precisa saber. Decisão da própria Dutelog, não.
      input.action === "cancel"
        ? createEvent(transaction, db, operationEventId(operationId, "request_decision"), decisionEventInput, actor)
        : createDecisionEvent(
            transaction,
            db,
            operationEventId(operationId, "request_decision"),
            decisionEventInput,
            actor,
          ),
    );

    transaction.update(
      requestRef,
      compact({
        status: nextStatus,
        decision_reason: input.reason,
        decided_by: actorPayload(actor),
        decided_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        created_entities: Object.keys(created).length ? created : undefined,
        stock_reservation_status:
          releasedQtyTotal > 0 ? "released" : undefined,
        released_quantity_total: releasedQtyTotal || undefined,
        operational_status: created.pick_task_id
          ? "picking_planned"
          : created.inbound_id
            ? "receiving_created"
            : undefined,
      }),
    );
    transaction.set(
      db.collection(collections.clientRequestStatus).doc(requestId),
      compact({
        customer_code: customerCode,
        status: nextStatus,
        operational_status: created.pick_task_id
          ? "picking_planned"
          : created.inbound_id
            ? "receiving_created"
            : nextStatus,
        decision_reason: input.reason,
        published_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );
    for (const row of openInboxRows) {
      transaction.update(row.ref, {
        status: "resolved",
        resolution: `customer_request.${nextStatus}`,
        resolved_by: actorPayload(actor),
        resolved_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    const result = {
      ok: true,
      id: requestId,
      status: nextStatus,
      ...created,
      events,
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      `customer_request.${input.action}`,
      requestId,
      actor,
      result,
    );
    return result;
  });
}

const taskCollections: Record<string, string> = {
  receiving: collections.inboundReceipts,
  putaway: collections.putawayTasks,
  picking: collections.pickTasks,
  packing: collections.packTasks,
  shipping: collections.shipments,
};

const taskFlows: Record<string, string[]> = {
  receiving: ["created", "checking", "received"],
  putaway: ["planned", "in_progress", "completed"],
  picking: ["planned", "in_progress", "completed"],
  packing: ["ready", "in_progress", "completed"],
  shipping: ["ready_to_dispatch", "dispatched", "delivered"],
};

function nextStatus(type: string, currentStatus: string) {
  const flow = taskFlows[type];
  const index = flow?.indexOf(currentStatus);
  if (!flow || index == null || index < 0) {
    throw new HttpsError(
      "failed-precondition",
      `Status ${currentStatus || "vazio"} não pertence ao fluxo ${type}.`,
    );
  }
  if (index === flow.length - 1) {
    throw new HttpsError("already-exists", "Tarefa operacional já finalizada.");
  }
  return flow[index + 1];
}

function taskParts(taskUid: string) {
  const [type, ...idParts] = taskUid.split(":");
  const id = idParts.join(":");
  if (!type || !id || !taskCollections[type]) {
    throw new HttpsError("invalid-argument", "Tarefa operacional inválida.");
  }
  return { type, id: safeDocId(id), collection: taskCollections[type] };
}

function completionEvent(type: string, status: string) {
  const mapping: Record<string, Record<string, string>> = {
    receiving: { checking: "inbound.checking", received: "inbound.checked" },
    putaway: { in_progress: "putaway.started", completed: "putaway.completed" },
    picking: { in_progress: "picking.started", completed: "picking.completed" },
    packing: { in_progress: "packing.started", completed: "packing.completed" },
    shipping: {
      dispatched: "shipment.dispatched",
      delivered: "shipment.delivered",
    },
  };
  return mapping[type]?.[status] ?? `${type}.advanced`;
}

export async function advanceWarehouseTaskTransaction(
  db: Firestore,
  input: AdvanceOperationalTaskInput,
  actor: OperationalActor,
) {
  const { type, id, collection } = taskParts(input.task_uid);
  const expectedStatus = text(input.expected_status).toLowerCase() || undefined;
  if (!input.idempotency_key && !expectedStatus) {
    throw new HttpsError(
      "invalid-argument",
      "Informe idempotency_key ou expected_status para avançar a tarefa.",
    );
  }
  const operationNonce = input.idempotency_key ?? expectedStatus;
  const operationId = `op_advance_${digest({ task: input.task_uid, operationNonce })}`;
  const inputHash = digest(
    { ...input, task_uid: input.task_uid, expected_status: expectedStatus },
    64,
  );
  const operationRef = db.collection(collections.operations).doc(operationId);
  const taskRef = db.collection(collection).doc(id);
  const occurredAt = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    await assertInventoryOperationsEnabled(transaction, db);

    const taskSnapshot = await transaction.get(taskRef);
    if (!taskSnapshot.exists) {
      throw new HttpsError("not-found", "Tarefa operacional não encontrada.");
    }
    const task = asRecord(taskSnapshot.data());
    const currentStatus = text(task.status).toLowerCase();
    if (expectedStatus && currentStatus !== expectedStatus) {
      throw new HttpsError(
        "failed-precondition",
        `Status divergente: esperado ${expectedStatus}, encontrado ${currentStatus}.`,
      );
    }
    const targetStatus = nextStatus(type, currentStatus);
    const customerCode = text(task.customer_code) || "BTG Pactual";
    const orderId = text(task.order_id);
    const requestId = text(task.customer_request_id);
    const operation = input.operation ?? {};

    let inboundItems: Row[] = [];
    let pickLines: Row[] = [];
    let pickingConfirmationsById = new Map<
      string,
      { qty_picked?: number; status?: string; notes?: string }
    >();
    let packingConfirmationsById = new Map<
      string,
      { qty_packed?: number; status?: string; notes?: string }
    >();
    let orderItems: Row[] = [];
    let reservations: Row[] = [];
    let shipmentItems: Row[] = [];
    let packages: Row[] = [];
    let orderRow: Row | undefined;
    let requestRow: Row | undefined;
    const balanceStates = new Map<string, BalanceState>();
    const taskCatalogTargets = new Map<string, CatalogAggregateTarget>();

    if (requestId) {
      const snapshot = await transaction.get(
        db.collection(collections.customerRequests).doc(requestId),
      );
      if (snapshot.exists) {
        requestRow = {
          id: snapshot.id,
          ref: snapshot.ref,
          data: snapshot.data() ?? {},
        };
      }
    }
    if (orderId) {
      const snapshot = await transaction.get(
        db.collection(collections.orders).doc(orderId),
      );
      if (snapshot.exists) {
        orderRow = {
          id: snapshot.id,
          ref: snapshot.ref,
          data: snapshot.data() ?? {},
        };
      }
    }

    if (type === "receiving" && targetStatus === "received") {
      inboundItems = await readRows(
        transaction,
        db.collection(collections.inboundItems).where("receipt_id", "==", id),
      );
      if (!inboundItems.length) {
        throw new HttpsError(
          "failed-precondition",
          "Recebimento não possui linhas para confirmar.",
        );
      }
      const keys = new Map<string, { skuCode: string; locationId: string }>();
      for (const row of inboundItems) {
        const skuCode = text(row.data.sku_code);
        const locationId =
          text(
            row.data.location_id || task.location_id || task.receiving_location,
          ) || "RECEBIMENTO";
        if (!skuCode) {
          throw new HttpsError(
            "failed-precondition",
            `Linha ${number(row.data.line_number) || row.id} está com código a definir. Informe o código da etiqueta na conferência antes de concluir.`,
          );
        }
        keys.set(balanceKey(customerCode, skuCode, locationId), {
          skuCode,
          locationId,
        });
      }
      const uncheckedRows = inboundItems.filter((row) => {
        const status = text(row.data.status);
        return (
          status !== "checked" &&
          status !== "divergence" &&
          !row.data.checked_at
        );
      });
      if (uncheckedRows.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          `Salve a conferência física de ${uncheckedRows.length} linha(s) antes de concluir a entrada.`,
        );
      }
      const divergentRows = inboundItems.filter((row) => {
        const differenceQty =
          row.data.difference_qty === undefined
            ? number(row.data.received_qty) - number(row.data.expected_qty)
            : number(row.data.difference_qty);
        return (
          differenceQty !== 0 ||
          text(row.data.status) === "divergence" ||
          text(row.data.conference_status) === "short" ||
          text(row.data.conference_status) === "over"
        );
      });
      if (divergentRows.length > 0 && !text(input.note)) {
        throw new HttpsError(
          "failed-precondition",
          `Recebimento possui ${divergentRows.length} linha(s) com divergência. Informe a justificativa operacional antes de concluir.`,
        );
      }
      for (const [key, value] of keys) {
        const rows = await readRows(
          transaction,
          exactBalanceQuery(db, customerCode, value.skuCode, value.locationId),
        );
        if (rows.length > 1)
          assertSingleBalance(rows, value.skuCode, value.locationId);
        const row = rows[0] ?? {
          id: `bal_${digest({ customerCode, ...value })}`,
          ref: db
            .collection(collections.stockBalances)
            .doc(`bal_${digest({ customerCode, ...value })}`),
          data: {},
        };
        const qtyOnHand = number(row.data.qty_on_hand);
        const qtyReserved = number(row.data.qty_reserved);
        if (qtyOnHand < 0 || qtyReserved < 0 || qtyReserved > qtyOnHand) {
          throw new HttpsError(
            "failed-precondition",
            `Saldo inconsistente para SKU ${value.skuCode} no local ${value.locationId}.`,
          );
        }
        balanceStates.set(key, {
          row,
          skuCode: value.skuCode,
          locationId: value.locationId,
          qtyOnHand,
          qtyReserved,
        });
      }
      const receivingCatalogSkus = new Map<string, string | undefined>();
      for (const row of inboundItems) {
        const skuCode = text(row.data.sku_code);
        if (!receivingCatalogSkus.has(skuCode)) {
          receivingCatalogSkus.set(
            skuCode,
            text(row.data.client_item_code) || undefined,
          );
        }
      }
      for (const [skuCode, clientItemCode] of receivingCatalogSkus) {
        taskCatalogTargets.set(
          skuCode,
          await resolveCatalogAggregateTargets(
            transaction,
            db,
            skuCode,
            clientItemCode,
          ),
        );
      }
    }

    if (type === "picking" && targetStatus === "completed") {
      if (!orderId || !orderRow) {
        throw new HttpsError(
          "failed-precondition",
          "Picking sem pedido válido.",
        );
      }
      pickLines = await readRows(
        transaction,
        db.collection(collections.pickLines).where("pick_task_id", "==", id),
      );
      orderItems = await readRows(
        transaction,
        db.collection(collections.orderItems).where("order_id", "==", orderId),
      );
      reservations = await readRows(
        transaction,
        db
          .collection(collections.stockReservations)
          .where("order_id", "==", orderId),
      );
      if (!pickLines.length || !orderItems.length || !reservations.length) {
        throw new HttpsError(
          "failed-precondition",
          "Picking não possui linhas e reservas consistentes.",
        );
      }
      const pickingConfirmations = Array.isArray(operation.picking_lines)
        ? operation.picking_lines
        : [];
      if (!pickingConfirmations.length) {
        throw new HttpsError(
          "failed-precondition",
          "Informe a conferência física das linhas antes de concluir o picking.",
        );
      }
      pickingConfirmationsById = new Map(
        pickingConfirmations.map((line) => [text(line.pick_line_id), line]),
      );
      for (const row of pickLines) {
        const confirmation = pickingConfirmationsById.get(row.id);
        if (!confirmation) {
          throw new HttpsError(
            "failed-precondition",
            `Linha ${row.id} não foi conferida fisicamente.`,
          );
        }
        const expectedQty = requiredPositive(
          row.data.qty_to_pick,
          `Quantidade de ${row.id}`,
        );
        const pickedQty = requiredPositive(
          confirmation.qty_picked,
          `Quantidade física de ${row.id}`,
        );
        const confirmationStatus = text(confirmation.status || "confirmed");
        if (!["confirmed", "ok", "picked", "completed"].includes(confirmationStatus)) {
          throw new HttpsError(
            "failed-precondition",
            `Linha ${row.id} não está OK para concluir o picking.`,
          );
        }
        if (pickedQty !== expectedQty) {
          throw new HttpsError(
            "failed-precondition",
            `Linha ${row.id} tem ${pickedQty} unidade(s) físicas, mas esperava ${expectedQty}. Registre exceção antes de concluir.`,
          );
        }
      }
    }

    if (type === "packing" && targetStatus === "completed") {
      if (!orderId || !orderRow) {
        throw new HttpsError(
          "failed-precondition",
          "Packing sem pedido válido.",
        );
      }
      orderItems = await readRows(
        transaction,
        db.collection(collections.orderItems).where("order_id", "==", orderId),
      );
      if (!orderItems.length) {
        throw new HttpsError(
          "failed-precondition",
          "Packing não possui itens separados.",
        );
      }
      const notPicked = orderItems.filter(
        (row) =>
          text(row.data.status) !== "picked" &&
          number(row.data.picked_qty) <= 0,
      );
      if (notPicked.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          `Packing possui ${notPicked.length} item(ns) ainda não separados fisicamente.`,
        );
      }
      if (!text(operation.seal_code || task.seal_code)) {
        throw new HttpsError(
          "failed-precondition",
          "Informe o lacre do volume antes de fechar o packing.",
        );
      }
      const packingConfirmations = Array.isArray(operation.packing_lines)
        ? operation.packing_lines
        : [];
      if (!packingConfirmations.length) {
        throw new HttpsError(
          "failed-precondition",
          "Informe a conferência física das linhas antes de fechar o packing.",
        );
      }
      packingConfirmationsById = new Map(
        packingConfirmations.map((line) => [text(line.order_item_id), line]),
      );
      for (const row of orderItems) {
        const confirmation = packingConfirmationsById.get(row.id);
        if (!confirmation) {
          throw new HttpsError(
            "failed-precondition",
            `Item ${row.id} não foi conferido fisicamente no packing.`,
          );
        }
        const expectedQty = requiredPositive(
          row.data.picked_qty || row.data.allocated_qty,
          `Quantidade separada de ${row.id}`,
        );
        const packedQty = requiredPositive(
          confirmation.qty_packed,
          `Quantidade embalada de ${row.id}`,
        );
        const confirmationStatus = text(confirmation.status || "confirmed");
        if (!["confirmed", "ok", "packed", "completed"].includes(confirmationStatus)) {
          throw new HttpsError(
            "failed-precondition",
            `Item ${row.id} não está OK para concluir o packing.`,
          );
        }
        if (packedQty !== expectedQty) {
          throw new HttpsError(
            "failed-precondition",
            `Item ${row.id} tem ${packedQty} unidade(s) embaladas, mas esperava ${expectedQty}. Registre exceção antes de concluir.`,
          );
        }
      }
    }

    if (
      type === "shipping" &&
      (targetStatus === "dispatched" || targetStatus === "delivered")
    ) {
      if (!orderId || !orderRow) {
        throw new HttpsError(
          "failed-precondition",
          "Expedição sem pedido válido.",
        );
      }
      shipmentItems = await readRows(
        transaction,
        db.collection(collections.shipmentItems).where("shipment_id", "==", id),
      );
      packages = await readRows(
        transaction,
        db.collection(collections.packages).where("order_id", "==", orderId),
      );
      if (!shipmentItems.length || !packages.length) {
        throw new HttpsError(
          "failed-precondition",
          "Expedição precisa de itens e volumes gerados pelo packing.",
        );
      }
      const shippedUnits = shipmentItems.reduce(
        (sum, row) =>
          sum + number(row.data.qty_shipped || row.data.qty_packed),
        0,
      );
      const packageUnits = packages.reduce(
        (sum, row) => sum + number(row.data.packed_units),
        0,
      );
      const expectedUnits = number(task.total_units);
      if (expectedUnits > 0 && shippedUnits !== expectedUnits) {
        throw new HttpsError(
          "failed-precondition",
          `Expedição possui ${shippedUnits} unidade(s), mas esperava ${expectedUnits}.`,
        );
      }
      if (expectedUnits > 0 && packageUnits !== expectedUnits) {
        throw new HttpsError(
          "failed-precondition",
          `Volumes possuem ${packageUnits} unidade(s), mas a expedição esperava ${expectedUnits}.`,
        );
      }
      if (targetStatus === "dispatched" && !text(operation.carrier || task.carrier)) {
        throw new HttpsError(
          "failed-precondition",
          "Informe o responsável pela coleta antes de confirmar a saída.",
        );
      }
      if (
        targetStatus === "dispatched" &&
        !text(operation.driver_name || task.driver_name)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Informe o motorista antes de confirmar a saída.",
        );
      }
      if (
        targetStatus === "dispatched" &&
        !text(operation.vehicle_plate || task.vehicle_plate)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Informe a placa ou identificação do veículo antes de confirmar a saída.",
        );
      }
      if (
        targetStatus === "delivered" &&
        !text(operation.proof_reference || task.proof_reference)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Informe o comprovante de entrega antes de encerrar o pedido.",
        );
      }
      if (
        targetStatus === "delivered" &&
        !text(operation.delivery_notes || task.delivery_notes)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Informe a observação de entrega antes de encerrar o pedido.",
        );
      }
    }

    if (type === "shipping" && targetStatus === "delivered") {
      reservations = await readRows(
        transaction,
        db
          .collection(collections.stockReservations)
          .where("order_id", "==", orderId),
      );
      if (!reservations.length) {
        throw new HttpsError(
          "failed-precondition",
          "Expedição não possui reservas para consumir.",
        );
      }
      const keys = new Map<string, { skuCode: string; locationId: string }>();
      for (const reservation of reservations) {
        if (text(reservation.data.status) === "consumed") {
          throw new HttpsError(
            "failed-precondition",
            `Reserva ${reservation.id} já foi consumida fora desta operação.`,
          );
        }
        const skuCode = text(reservation.data.sku_code);
        const locationId = text(reservation.data.location_id);
        if (!skuCode || !locationId) {
          throw new HttpsError(
            "failed-precondition",
            `Reserva ${reservation.id} não possui SKU e localização.`,
          );
        }
        keys.set(balanceKey(customerCode, skuCode, locationId), {
          skuCode,
          locationId,
        });
      }
      for (const [key, value] of keys) {
        const row = assertSingleBalance(
          await readRows(
            transaction,
            exactBalanceQuery(
              db,
              customerCode,
              value.skuCode,
              value.locationId,
            ),
          ),
          value.skuCode,
          value.locationId,
        );
        balanceStates.set(key, {
          row,
          skuCode: value.skuCode,
          locationId: value.locationId,
          qtyOnHand: number(row.data.qty_on_hand),
          qtyReserved: number(row.data.qty_reserved),
        });
      }
      const consumedCatalogSkus = new Map<string, string | undefined>();
      for (const reservation of reservations) {
        const skuCode = text(reservation.data.sku_code);
        const locationId = text(reservation.data.location_id);
        const balanceState = balanceStates.get(
          balanceKey(customerCode, skuCode, locationId),
        );
        const clientItemCode =
          text(reservation.data.client_item_code) ||
          text(balanceState?.row.data.client_item_code) ||
          undefined;
        if (!consumedCatalogSkus.get(skuCode)) {
          consumedCatalogSkus.set(skuCode, clientItemCode);
        }
      }
      for (const [skuCode, clientItemCode] of consumedCatalogSkus) {
        taskCatalogTargets.set(
          skuCode,
          await resolveCatalogAggregateTargets(
            transaction,
            db,
            skuCode,
            clientItemCode,
          ),
        );
      }
    }

    const taskUpdate: Record<string, unknown> = {
      status: targetStatus,
      operation_note: input.note,
      advanced_by: actorPayload(actor),
      advanced_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      last_operation_id: operationId,
    };
    const created: Record<string, unknown> = {};
    const effects: Record<string, unknown> = {};
    const events: OperationalEventSummary[] = [];

    if (type === "putaway" && targetStatus === "completed") {
      const skuCode = text(task.sku_code || task.sku);
      const sourceLocationId =
        text(operation.source_location_id || task.source_location_id) ||
        "RECEBIMENTO";
      const destinationLocationId = text(
        operation.destination_location_id ||
          operation.location_id ||
          task.destination_location_id ||
          task.location_id,
      );
      const quantity = requiredPositive(
        operation.quantity || task.quantity || task.total_units,
        "Quantidade da guarda",
      );
      if (!skuCode) {
        throw new HttpsError(
          "failed-precondition",
          "Putaway sem SKU definido para movimentar.",
        );
      }
      if (!destinationLocationId) {
        throw new HttpsError(
          "failed-precondition",
          "Informe o endereço final antes de concluir o putaway.",
        );
      }
      if (sourceLocationId === destinationLocationId) {
        throw new HttpsError(
          "failed-precondition",
          "Endereço de origem e destino não podem ser iguais.",
        );
      }

      const sourceBalance = assertSingleBalance(
        await readRows(
          transaction,
          exactBalanceQuery(db, customerCode, skuCode, sourceLocationId),
        ),
        skuCode,
        sourceLocationId,
      );
      const destinationRows = await readRows(
        transaction,
        exactBalanceQuery(db, customerCode, skuCode, destinationLocationId),
      );
      if (destinationRows.length > 1) {
        assertSingleBalance(destinationRows, skuCode, destinationLocationId);
      }
      const destinationBalance =
        destinationRows[0] ?? {
          id: `bal_${digest({
            customerCode,
            skuCode,
            locationId: destinationLocationId,
          })}`,
          ref: db
            .collection(collections.stockBalances)
            .doc(
              `bal_${digest({
                customerCode,
                skuCode,
                locationId: destinationLocationId,
              })}`,
            ),
          data: {},
        };
      const sourceOnHand = number(sourceBalance.data.qty_on_hand);
      const sourceReserved = number(sourceBalance.data.qty_reserved);
      const sourceAvailable = sourceOnHand - sourceReserved;
      if (sourceAvailable < quantity) {
        throw new HttpsError(
          "failed-precondition",
          `Origem ${sourceLocationId} possui ${sourceAvailable} unidade(s) disponíveis para putaway, mas a tarefa exige ${quantity}.`,
        );
      }
      const destinationOnHand = number(destinationBalance.data.qty_on_hand);
      const destinationReserved = number(destinationBalance.data.qty_reserved);
      const sourceAfter = sourceOnHand - quantity;
      const destinationAfter = destinationOnHand + quantity;
      const clientItemCode =
        text(task.client_item_code || sourceBalance.data.client_item_code) ||
        undefined;
      const productName =
        text(task.product_name || sourceBalance.data.product_name) || skuCode;
      const unitCost = number(task.unit_cost || sourceBalance.data.unit_cost);

      transaction.update(sourceBalance.ref, {
        qty_on_hand: sourceAfter,
        qty_available: sourceAfter - sourceReserved,
        status: sourceAfter > 0 ? "available" : "empty",
        updated_at: FieldValue.serverTimestamp(),
      });
      const destinationPayload = compact({
        customer_code: customerCode,
        sku_code: skuCode,
        client_item_code: clientItemCode,
        product_name: productName,
        location_id: destinationLocationId,
        unit_cost: unitCost || undefined,
        qty_on_hand: destinationAfter,
        qty_reserved: destinationReserved,
        qty_available: destinationAfter - destinationReserved,
        status: "available",
        source: "wms_putaway",
        updated_at: FieldValue.serverTimestamp(),
      });
      if (Object.keys(destinationBalance.data).length) {
        transaction.update(destinationBalance.ref, destinationPayload);
      } else {
        transaction.create(
          destinationBalance.ref,
          compact({
            id: destinationBalance.id,
            ...destinationPayload,
            created_at: FieldValue.serverTimestamp(),
          }),
        );
      }
      createMovement(
        transaction,
        db,
        movementId(operationId, "putaway_out"),
        {
          type: "SAIDA",
          quantity,
          customerCode,
          skuCode,
          clientItemCode,
          productName,
          locationId: sourceLocationId,
          beforeQty: sourceOnHand,
          afterQty: sourceAfter,
          source: "wms_putaway",
          occurredAt,
          entity: {
            putaway_task_id: id,
            origem: sourceLocationId,
            destino: destinationLocationId,
            movement_kind: "putaway_transfer_out",
          },
        },
        actor,
      );
      createMovement(
        transaction,
        db,
        movementId(operationId, "putaway_in"),
        {
          type: "ENTRADA",
          quantity,
          customerCode,
          skuCode,
          clientItemCode,
          productName,
          locationId: destinationLocationId,
          beforeQty: destinationOnHand,
          afterQty: destinationAfter,
          source: "wms_putaway",
          occurredAt,
          entity: {
            putaway_task_id: id,
            origem: sourceLocationId,
            destino: destinationLocationId,
            movement_kind: "putaway_transfer_in",
          },
        },
        actor,
      );
      Object.assign(taskUpdate, {
        source_location_id: sourceLocationId,
        destination_location_id: destinationLocationId,
        location_id: destinationLocationId,
        quantity,
        total_units: quantity,
        putaway_completed_at: FieldValue.serverTimestamp(),
      });
      effects.putaway_qty = quantity;
      effects.source_location_id = sourceLocationId;
      effects.destination_location_id = destinationLocationId;
    }

    if (type === "receiving" && targetStatus === "received") {
      let receivedQty = 0;
      let putawayTasksCreated = 0;
      const receivedBySku = new Map<
        string,
        {
          quantity: number;
          clientItemCode?: string;
          productName?: string;
          category?: string;
          barcode?: string;
          brand?: string;
          size?: string;
          color?: string;
          photoUrls?: string[];
          productRegistration?: string;
          unitCost?: number;
        }
      >();
      for (const row of inboundItems) {
        const expectedQty = requiredPositive(
          row.data.expected_qty,
          `Quantidade de ${row.id}`,
        );
        const rowStatus = text(row.data.status);
        const wasConferenced =
          rowStatus === "checked" ||
          rowStatus === "divergence" ||
          Boolean(row.data.checked_at);
        const quantity = wasConferenced
          ? number(row.data.received_qty)
          : expectedQty;
        const skuCode = text(row.data.sku_code);
        const locationId =
          text(
            row.data.location_id || task.location_id || task.receiving_location,
          ) || "RECEBIMENTO";
        const state = balanceStates.get(
          balanceKey(customerCode, skuCode, locationId),
        );
        if (!state) {
          throw new HttpsError(
            "internal",
            "Estado de saldo ausente no recebimento.",
          );
        }
        const beforeQty = state.qtyOnHand;
        state.qtyOnHand += quantity;
        receivedQty += quantity;
        const projected = receivedBySku.get(skuCode) ?? {
          quantity: 0,
          clientItemCode: text(row.data.client_item_code) || undefined,
          productName: text(row.data.product_name) || undefined,
          category: text(row.data.category) || undefined,
          barcode: text(row.data.barcode) || undefined,
          brand: text(row.data.brand) || undefined,
          size: text(row.data.size) || undefined,
          color: text(row.data.color) || undefined,
          photoUrls: stringList(row.data.photo_urls),
          productRegistration: text(row.data.product_registration) || undefined,
          unitCost: number(row.data.unit_cost),
        };
        projected.quantity += quantity;
        receivedBySku.set(skuCode, projected);
        transaction.update(row.ref, {
          received_qty: quantity,
          location_id: locationId,
          status: "received",
          received_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        if (quantity <= 0) {
          continue;
        }
        if (locationId.toUpperCase() === "RECEBIMENTO") {
          const putawayTaskId = `put_${digest({
            receiptId: id,
            inboundItemId: row.id,
            skuCode,
            locationId,
          })}`;
          transaction.set(
            db.collection(collections.putawayTasks).doc(putawayTaskId),
            compact({
              id: putawayTaskId,
              customer_code: customerCode,
              receipt_id: id,
              receipt_number: task.receipt_number,
              inbound_item_id: row.id,
              sku_code: skuCode,
              client_item_code: text(row.data.client_item_code) || undefined,
              product_name: text(row.data.product_name) || undefined,
              source_location_id: locationId,
              location_id: text(row.data.destination_location_id) || undefined,
              destination_location_id:
                text(row.data.destination_location_id) || undefined,
              quantity,
              total_units: quantity,
              status: "planned",
              priority: "normal",
              title: `Guardar ${text(row.data.product_name) || skuCode}`,
              next_action: "Informar endereco final e concluir guarda.",
              source: "wms_receiving",
              created_from_operation_id: operationId,
              created_at: FieldValue.serverTimestamp(),
              updated_at: FieldValue.serverTimestamp(),
            }),
            { merge: true },
          );
          putawayTasksCreated += 1;
        }
        createMovement(
          transaction,
          db,
          movementId(operationId, row.id),
          {
            type: "ENTRADA",
            quantity,
            customerCode,
            skuCode,
            clientItemCode: text(row.data.client_item_code) || undefined,
            productName: text(row.data.product_name) || undefined,
            locationId,
            beforeQty,
            afterQty: state.qtyOnHand,
            source: "wms_receiving",
            occurredAt,
            entity: {
              receipt_id: id,
              receipt_number: task.receipt_number,
              inbound_item_id: row.id,
              destino: locationId,
            },
          },
          actor,
        );
      }
      for (const state of balanceStates.values()) {
        const sourceItem = inboundItems.find(
          (row) =>
            text(row.data.sku_code) === state.skuCode &&
            (text(
              row.data.location_id ||
                task.location_id ||
                task.receiving_location,
            ) || "RECEBIMENTO") === state.locationId,
        );
        const balancePayload = compact({
          customer_code: customerCode,
          sku_code: state.skuCode,
          client_item_code:
            state.row.data.client_item_code ??
            sourceItem?.data.client_item_code,
          product_name:
            state.row.data.product_name ?? sourceItem?.data.product_name,
          category: state.row.data.category ?? sourceItem?.data.category,
          barcode: state.row.data.barcode ?? sourceItem?.data.barcode,
          brand: state.row.data.brand ?? sourceItem?.data.brand,
          size: state.row.data.size ?? sourceItem?.data.size,
          color: state.row.data.color ?? sourceItem?.data.color,
          photo_urls:
            state.row.data.photo_urls ?? sourceItem?.data.photo_urls,
          primary_photo_url:
            state.row.data.primary_photo_url ??
            stringList(sourceItem?.data.photo_urls)[0],
          location_id: state.locationId,
          qty_on_hand: state.qtyOnHand,
          qty_reserved: state.qtyReserved,
          qty_available: state.qtyOnHand - state.qtyReserved,
          status: state.qtyOnHand > 0 ? "available" : "empty",
          source: "wms_receiving",
          updated_at: FieldValue.serverTimestamp(),
        });
        if (Object.keys(state.row.data).length) {
          transaction.update(state.row.ref, balancePayload);
        } else {
          transaction.create(
            state.row.ref,
            compact({
              id: state.row.id,
              ...balancePayload,
              unit_cost: number(sourceItem?.data.unit_cost),
              created_at: FieldValue.serverTimestamp(),
            }),
          );
        }
      }
      for (const [skuCode, projected] of receivedBySku) {
        updateClientInventory(transaction, db, {
          customerCode,
          skuCode,
          clientItemCode: projected.clientItemCode,
          productName: projected.productName,
          category: projected.category,
          barcode: projected.barcode,
          brand: projected.brand,
          size: projected.size,
          color: projected.color,
          photoUrls: projected.photoUrls,
          unitCost: projected.unitCost,
          onHandDelta: projected.quantity,
        });
        if (
          projected.productRegistration === "new" &&
          projected.clientItemCode
        ) {
          // Ids e identidades normalizados: precisam bater com os docs
          // criados por createInboundReceiptTransaction e ser encontráveis
          // por resolveCatalogAggregateTargets nas baixas futuras.
          const normalizedClientCode = normalizedIdentity(
            projected.clientItemCode,
          );
          const normalizedSkuCode = normalizedIdentity(skuCode);
          transaction.set(
            db
              .collection(collections.products)
              .doc(safeDocId(normalizedClientCode)),
            {
              id: normalizedClientCode,
              customer_code: customerCode,
              cod_cliente: normalizedClientCode,
              cod_cliente_key: normalizedClientCode,
              estoque_btg: FieldValue.increment(projected.quantity),
              custo_total: FieldValue.increment(
                projected.quantity * number(projected.unitCost),
              ),
              updated_at: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          transaction.set(
            db.collection(collections.skus).doc(safeDocId(normalizedSkuCode)),
            {
              id: normalizedSkuCode,
              customer_code: customerCode,
              cod_btg: normalizedSkuCode,
              sku_code: normalizedSkuCode,
              sku_code_key: normalizedSkuCode,
              cod_cliente: normalizedClientCode,
              cod_cliente_key: normalizedClientCode,
              estoque_atual: FieldValue.increment(projected.quantity),
              estoque_disponivel: FieldValue.increment(projected.quantity),
              custo_total: FieldValue.increment(
                projected.quantity * number(projected.unitCost),
              ),
              updated_at: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } else {
          applyCatalogStockAggregates(
            transaction,
            taskCatalogTargets.get(skuCode) ?? {},
            {
              onHand: projected.quantity,
              cost: projected.quantity * number(projected.unitCost),
            },
          );
        }
      }
      Object.assign(taskUpdate, {
        qty_received: receivedQty,
        received_at: FieldValue.serverTimestamp(),
      });
      effects.received_lines = inboundItems.length;
      effects.received_qty = receivedQty;
      effects.putaway_tasks_created = putawayTasksCreated || undefined;
      events.push(
        createEvent(
          transaction,
          db,
          operationEventId(operationId, "inventory_received"),
          {
            type: "inventory.received",
            title: "Estoque recebido e contabilizado",
            description: `${receivedQty} unidade(s) recebida(s) em ${id}.`,
            severity: "info",
            entity_type: "recebimento",
            entity_id: id,
            customer_code: customerCode,
            payload: {
              received_qty: receivedQty,
              movement_count: inboundItems.length,
            },
          },
          actor,
        ),
      );
      if (requestRow) {
        transaction.update(requestRow.ref, {
          operational_status: "received",
          fulfillment_updated_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        // O portal mostra quanto chegou de verdade ("118 de 120 peças").
        const summary = receivedSummary(inboundItems.map((row) => row.data));
        transaction.set(
          db.collection(collections.clientRequestStatus).doc(requestRow.id),
          {
            customer_code: customerCode,
            operational_status: "received",
            status: "closed",
            ...summary,
            received_at: new Date().toISOString(),
            published_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    if (type === "picking" && targetStatus === "completed") {
      const pickedUnits = pickLines.reduce(
        (sum, row) =>
          sum +
          requiredPositive(row.data.qty_to_pick, `Quantidade de ${row.id}`),
        0,
      );
      const reservedUnits = reservations.reduce(
        (sum, row) =>
          sum +
          requiredPositive(
            row.data.reserved_qty || row.data.requested_qty,
            `Quantidade da reserva ${row.id}`,
          ),
        0,
      );
      if (pickedUnits !== reservedUnits) {
        throw new HttpsError(
          "failed-precondition",
          `Picking (${pickedUnits}) diverge das reservas (${reservedUnits}).`,
        );
      }
      for (const row of pickLines) {
        const confirmation = pickingConfirmationsById.get(row.id);
        const pickedQty = number(confirmation?.qty_picked || row.data.qty_to_pick);
        transaction.update(
          row.ref,
          compact({
            qty_picked: pickedQty,
            status: "completed",
            physical_status: "confirmed",
            physical_notes: text(confirmation?.notes) || undefined,
            picked_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          }),
        );
      }
      for (const row of orderItems) {
        transaction.update(row.ref, {
          picked_qty: number(row.data.allocated_qty || row.data.requested_qty),
          status: "picked",
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const row of reservations) {
        if (text(row.data.status) !== "reserved") {
          throw new HttpsError(
            "failed-precondition",
            `Reserva ${row.id} não está disponível para picking.`,
          );
        }
        transaction.update(row.ref, {
          status: "picked",
          picked_qty: number(row.data.reserved_qty || row.data.requested_qty),
          picked_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      const packTaskId = `pack_${safeDocId(orderId)}`;
      transaction.create(db.collection(collections.packTasks).doc(packTaskId), {
        id: packTaskId,
        customer_code: customerCode,
        order_id: orderId,
        order_number: task.order_number ?? orderRow?.data.order_number ?? null,
        status: "ready",
        picked_units: pickedUnits,
        packed_units: 0,
        package_count: 0,
        source: "picking_completed",
        customer_request_id: requestId || null,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      if (orderRow) {
        transaction.update(orderRow.ref, {
          status: "SEPARACAO",
          qtd_sep: pickedUnits,
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (requestRow) {
        transaction.update(requestRow.ref, {
          operational_status: "packing_ready",
          fulfillment_updated_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      taskUpdate.picked_units = pickedUnits;
      taskUpdate.physical_line_count = pickLines.length;
      taskUpdate.picking_confirmed_at = FieldValue.serverTimestamp();
      created.pack_task_id = packTaskId;
      effects.picked_lines = pickLines.length;
      effects.physical_lines_confirmed = pickLines.length;
      effects.picked_units = pickedUnits;
      events.push(
        createEvent(
          transaction,
          db,
          operationEventId(operationId, "packing_created"),
          {
            type: "packing.created",
            title: "Packing criado após picking",
            description: `${text(task.order_number || orderId)} pronto para conferência.`,
            severity: "attention",
            entity_type: "tarefa_packing",
            entity_id: packTaskId,
            customer_code: customerCode,
            payload: {
              pick_task_id: id,
              order_id: orderId,
              picked_units: pickedUnits,
            },
          },
          actor,
        ),
      );
    }

    if (type === "packing" && targetStatus === "completed") {
      const packedUnits = orderItems.reduce(
        (sum, row) =>
          sum + number(row.data.picked_qty || row.data.allocated_qty),
        0,
      );
      if (packedUnits <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "Packing não possui quantidade separada.",
        );
      }
      const packageId = `pkg_${safeDocId(id)}_001`;
      const shipmentId = `ship_${safeDocId(orderId)}`;
      const orderNumber =
        task.order_number ?? orderRow?.data.order_number ?? null;
      const destination =
        task.destination ?? orderRow?.data.destination ?? "Destino a confirmar";
      const packageCount = Math.max(1, number(operation.package_count) || 1);
      const volumeLabel = text(operation.volume_label) || "Volume 1";
      const sealCode = text(operation.seal_code || task.seal_code);
      const packageNotes = text(operation.package_notes);
      transaction.create(db.collection(collections.packages).doc(packageId), {
        id: packageId,
        customer_code: customerCode,
        pack_task_id: id,
        order_id: orderId,
        order_number: orderNumber,
        status: "packed",
        volume_number: 1,
        volume_label: volumeLabel,
        seal_code: sealCode,
        package_notes: packageNotes || null,
        packed_units: packedUnits,
        package_count: packageCount,
        closed_by: actorPayload(actor),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection(collections.shipments).doc(shipmentId), {
        id: shipmentId,
        customer_code: customerCode,
        order_id: orderId,
        order_number: orderNumber,
        status: "ready_to_dispatch",
        destination,
        total_units: packedUnits,
        package_count: packageCount,
        volume_label: volumeLabel,
        seal_code: sealCode,
        source: "packing_completed",
        customer_request_id: requestId || null,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      orderItems.forEach((row, index) => {
        const quantity = number(row.data.picked_qty || row.data.allocated_qty);
        if (quantity <= 0) return;
        const confirmation = packingConfirmationsById.get(row.id);
        const packedQty = number(confirmation?.qty_packed || quantity);
        const line = String(number(row.data.line_number) || index + 1).padStart(
          2,
          "0",
        );
        const common = compact({
          customer_code: customerCode,
          order_id: orderId,
          order_number: orderNumber,
          line_number: number(row.data.line_number) || index + 1,
          sku_code: row.data.sku_code,
          client_item_code: row.data.client_item_code,
          product_name: row.data.product_name,
          location_id: row.data.location_id,
          qty_packed: packedQty,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        const packageItemId = `pki_${safeDocId(packageId)}_${line}`;
        const shipmentItemId = `shi_${safeDocId(shipmentId)}_${line}`;
        transaction.update(row.ref, compact({
          status: "packed",
          packed_qty: packedQty,
          packing_physical_status: "confirmed",
          packing_physical_notes: text(confirmation?.notes) || undefined,
          packed_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        }));
        transaction.create(
          db.collection(collections.packageItems).doc(packageItemId),
          {
            id: packageItemId,
            package_id: packageId,
            shipment_id: shipmentId,
            status: "packed",
            ...common,
          },
        );
        transaction.create(
          db.collection(collections.shipmentItems).doc(shipmentItemId),
          {
            id: shipmentItemId,
            package_id: packageId,
            shipment_id: shipmentId,
            status: "ready_to_dispatch",
            qty_shipped: packedQty,
            ...common,
          },
        );
      });
      Object.assign(taskUpdate, {
        packed_units: packedUnits,
        package_count: packageCount,
        volume_label: volumeLabel,
        seal_code: sealCode,
        package_notes: packageNotes || undefined,
        physical_line_count: orderItems.length,
        packing_confirmed_at: FieldValue.serverTimestamp(),
        completed_at: FieldValue.serverTimestamp(),
      });
      if (orderRow) {
        transaction.update(orderRow.ref, {
          status: "EM_EXPEDICAO",
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (requestRow) {
        transaction.update(requestRow.ref, {
          operational_status: "ready_to_dispatch",
          fulfillment_updated_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      Object.assign(created, {
        package_id: packageId,
        shipment_id: shipmentId,
      });
      effects.packed_units = packedUnits;
      effects.physical_lines_confirmed = orderItems.length;
      events.push(
        createEvent(
          transaction,
          db,
          operationEventId(operationId, "shipment_created"),
          {
            type: "shipment.created",
            title: "Expedição criada após packing",
            description: `${text(orderNumber || orderId)} pronto para despacho.`,
            severity: "attention",
            entity_type: "expedicao",
            entity_id: shipmentId,
            customer_code: customerCode,
            payload: {
              pack_task_id: id,
              package_id: packageId,
              packed_units: packedUnits,
              package_count: packageCount,
              seal_code: sealCode,
            },
          },
          actor,
        ),
      );
    }

    if (type === "shipping" && targetStatus === "dispatched") {
      const carrier = text(operation.carrier || task.carrier);
      const driverName = text(operation.driver_name || task.driver_name);
      const vehiclePlate = text(operation.vehicle_plate || task.vehicle_plate);
      Object.assign(taskUpdate, {
        carrier,
        driver_name: driverName || undefined,
        vehicle_plate: vehiclePlate || undefined,
        dispatched_at: FieldValue.serverTimestamp(),
      });
      for (const row of shipmentItems) {
        transaction.update(row.ref, {
          status: "dispatched",
          carrier,
          driver_name: driverName || undefined,
          vehicle_plate: vehiclePlate || undefined,
          dispatched_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const row of packages) {
        transaction.update(row.ref, {
          status: "dispatched",
          carrier,
          driver_name: driverName || undefined,
          vehicle_plate: vehiclePlate || undefined,
          dispatched_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (orderRow) {
        transaction.update(orderRow.ref, {
          status: "EXPEDIDO",
          data_exped: occurredAt,
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (requestRow) {
        transaction.update(requestRow.ref, {
          operational_status: "dispatched",
          fulfillment_updated_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
    }

    if (type === "shipping" && targetStatus === "delivered") {
      const proofReference = text(operation.proof_reference || task.proof_reference);
      const deliveryNotes = text(operation.delivery_notes || task.delivery_notes);
      const reservationTotal = reservations.reduce(
        (sum, row) =>
          sum +
          requiredPositive(
            row.data.reserved_qty || row.data.requested_qty,
            `Quantidade da reserva ${row.id}`,
          ),
        0,
      );
      const shipmentTotal = number(task.total_units);
      if (shipmentTotal > 0 && reservationTotal !== shipmentTotal) {
        throw new HttpsError(
          "failed-precondition",
          `Expedição (${shipmentTotal}) diverge das reservas (${reservationTotal}).`,
        );
      }
      let consumedQty = 0;
      const consumedBySku = new Map<
        string,
        {
          quantity: number;
          clientItemCode?: string;
          productName?: string;
          unitCost?: number;
        }
      >();
      for (const row of reservations) {
        if (text(row.data.status) !== "picked") {
          throw new HttpsError(
            "failed-precondition",
            `Reserva ${row.id} não está pronta para consumo.`,
          );
        }
        const quantity = requiredPositive(
          row.data.reserved_qty || row.data.requested_qty,
          `Quantidade da reserva ${row.id}`,
        );
        const skuCode = text(row.data.sku_code);
        const locationId = text(row.data.location_id);
        const state = balanceStates.get(
          balanceKey(customerCode, skuCode, locationId),
        );
        if (!state)
          throw new HttpsError(
            "internal",
            "Estado de saldo ausente na expedição.",
          );
        if (state.qtyReserved < quantity || state.qtyOnHand < quantity) {
          throw new HttpsError(
            "failed-precondition",
            `Saldo ou reserva insuficiente para SKU ${skuCode} no local ${locationId}.`,
          );
        }
        const beforeQty = state.qtyOnHand;
        state.qtyOnHand -= quantity;
        state.qtyReserved -= quantity;
        consumedQty += quantity;
        const projected = consumedBySku.get(skuCode) ?? {
          quantity: 0,
          clientItemCode: text(row.data.client_item_code) || undefined,
          productName: text(row.data.product_name) || undefined,
          unitCost: number(row.data.unit_cost),
        };
        projected.quantity += quantity;
        consumedBySku.set(skuCode, projected);
        transaction.update(row.ref, {
          status: "consumed",
          consumed_qty: quantity,
          consumed_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        createMovement(
          transaction,
          db,
          movementId(operationId, row.id),
          {
            type: "SAIDA",
            quantity,
            customerCode,
            skuCode,
            clientItemCode: text(row.data.client_item_code) || undefined,
            productName: text(row.data.product_name) || undefined,
            locationId,
            beforeQty,
            afterQty: state.qtyOnHand,
            source: "wms_shipping",
            occurredAt,
            entity: {
              order_id: orderId,
              order_number: task.order_number ?? orderRow?.data.order_number,
              shipment_id: id,
              stock_reservation_id: row.id,
              origem: locationId,
              destino: task.destination,
            },
          },
          actor,
        );
      }
      for (const state of balanceStates.values()) {
        transaction.update(state.row.ref, {
          qty_on_hand: state.qtyOnHand,
          qty_reserved: state.qtyReserved,
          qty_available: state.qtyOnHand - state.qtyReserved,
          status: state.qtyOnHand > 0 ? "available" : "empty",
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const [skuCode, projected] of consumedBySku) {
        updateClientInventory(transaction, db, {
          customerCode,
          skuCode,
          clientItemCode: projected.clientItemCode,
          productName: projected.productName,
          unitCost: projected.unitCost,
          onHandDelta: -projected.quantity,
          reservedDelta: -projected.quantity,
        });
        applyCatalogStockAggregates(
          transaction,
          taskCatalogTargets.get(skuCode) ?? {},
          {
            onHand: -projected.quantity,
            reserved: -projected.quantity,
            cost: -projected.quantity * number(projected.unitCost),
          },
        );
      }
      for (const row of shipmentItems) {
        transaction.update(row.ref, {
          status: "delivered",
          qty_delivered: number(row.data.qty_shipped || row.data.qty_packed),
          proof_reference: proofReference,
          delivery_notes: deliveryNotes || undefined,
          delivered_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const row of packages) {
        transaction.update(row.ref, {
          status: "delivered",
          proof_reference: proofReference,
          delivered_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (orderRow) {
        transaction.update(orderRow.ref, {
          status: "ENTREGUE",
          delivered_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      if (requestRow) {
        transaction.update(requestRow.ref, {
          operational_status: "delivered",
          fulfillment_status: "completed",
          fulfillment_updated_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        transaction.set(
          db.collection(collections.clientRequestStatus).doc(requestRow.id),
          {
            customer_code: customerCode,
            operational_status: "delivered",
            status: "closed",
            published_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      Object.assign(taskUpdate, { delivered_at: FieldValue.serverTimestamp() });
      Object.assign(taskUpdate, {
        proof_reference: proofReference,
        delivery_notes: deliveryNotes || undefined,
      });
      effects.stock_consumed = consumedQty;
      effects.movement_count = reservations.length;
      effects.proof_reference = proofReference;
      events.push(
        createEvent(
          transaction,
          db,
          operationEventId(operationId, "inventory_shipped"),
          {
            type: "inventory.shipped",
            title: "Estoque expedido e contabilizado",
            description: `${consumedQty} unidade(s) baixada(s) na entrega ${id}.`,
            severity: "info",
            entity_type: "expedicao",
            entity_id: id,
            customer_code: customerCode,
            payload: {
              stock_consumed: consumedQty,
              movement_count: reservations.length,
            },
          },
          actor,
        ),
      );
    }

    if (orderId) {
      const trackingByStep: Record<string, { status: string; label: string }> =
        {
          "picking:in_progress": {
            status: "separating",
            label: "Em separação",
          },
          "picking:completed": {
            status: "separated",
            label: "Separação concluída",
          },
          "packing:in_progress": {
            status: "checking",
            label: "Em conferência",
          },
          "packing:completed": {
            status: "ready_to_dispatch",
            label: "Pronto para expedição",
          },
          "shipping:dispatched": {
            status: "dispatched",
            label: "Saiu para entrega",
          },
          "shipping:delivered": {
            status: "delivered",
            label: "Entregue",
          },
        };
      const tracking = trackingByStep[`${type}:${targetStatus}`];
      if (tracking) {
        const trackingPayload = compact({
          customer_code: customerCode,
          order_number: task.order_number ?? orderRow?.data.order_number,
          status: tracking.status,
          status_label: tracking.label,
          destination: task.destination ?? orderRow?.data.destination,
          package_count:
            type === "packing" && targetStatus === "completed"
              ? taskUpdate.package_count
              : task.package_count,
          seal_code:
            type === "packing" && targetStatus === "completed"
              ? taskUpdate.seal_code
              : task.seal_code,
          carrier:
            type === "shipping" && targetStatus === "dispatched"
              ? taskUpdate.carrier
              : task.carrier,
          driver_name:
            type === "shipping" && targetStatus === "dispatched"
              ? taskUpdate.driver_name
              : task.driver_name,
          vehicle_plate:
            type === "shipping" && targetStatus === "dispatched"
              ? taskUpdate.vehicle_plate
              : task.vehicle_plate,
          proof_reference:
            type === "shipping" && targetStatus === "delivered"
              ? taskUpdate.proof_reference
              : task.proof_reference,
          delivery_notes:
            type === "shipping" && targetStatus === "delivered"
              ? taskUpdate.delivery_notes
              : task.delivery_notes,
          timeline: FieldValue.arrayUnion(
            clientTimelineEntry(
              tracking.status,
              tracking.label,
              actor,
              occurredAt,
            ),
          ),
          dispatched_at:
            tracking.status === "dispatched" ? occurredAt : undefined,
          delivered_at:
            tracking.status === "delivered" ? occurredAt : undefined,
        });
        updateClientTracking(transaction, db, orderId, {
          ...trackingPayload,
        });
        if (requestRow) {
          transaction.set(
            db.collection(collections.clientRequestStatus).doc(requestRow.id),
            {
              customer_code: customerCode,
              operational_status: tracking.status,
              published_at: FieldValue.serverTimestamp(),
              updated_at: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
    }

    transaction.update(taskRef, compact(taskUpdate));
    events.unshift(
      createEvent(
        transaction,
        db,
        operationEventId(operationId, "task_advanced"),
        {
          type: completionEvent(type, targetStatus),
          title: "Tarefa operacional avançada",
          description: `${type} ${id} avançou de ${currentStatus} para ${targetStatus}.`,
          severity:
            targetStatus === "completed" ||
            targetStatus === "received" ||
            targetStatus === "delivered"
              ? "info"
              : "attention",
          entity_type: collection,
          entity_id: id,
          customer_code: customerCode,
          payload: {
            task_uid: input.task_uid,
            before_status: currentStatus,
            after_status: targetStatus,
            ...effects,
            ...created,
          },
        },
        actor,
      ),
    );
    const result = {
      ok: true,
      task_uid: input.task_uid,
      status: targetStatus,
      ...created,
      effects,
      events,
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      `${type}.advance`,
      id,
      actor,
      result,
    );
    return result;
  });
}

export type AddCatalogPhotosInput = {
  sku_code: string;
  client_item_code?: string;
  customer_code?: string;
  photo_urls: string[];
  photo_storage_paths?: string[];
  idempotency_key: string;
};

/**
 * Acrescenta fotos a um item já cadastrado. É a única edição de cadastro
 * aberta ao armazém: não toca nome, custo nem saldo, só a foto, e grava o
 * mesmo conjunto em sku, produto, saldos e na projeção do portal para que
 * todos vejam a mesma imagem.
 */
export async function addCatalogPhotosTransaction(
  db: Firestore,
  input: AddCatalogPhotosInput,
  actor: OperationalActor,
) {
  const skuCode = text(input.sku_code);
  const clientItemCode = text(input.client_item_code) || undefined;
  const customerCode = text(input.customer_code) || "BTG Pactual";
  const newPhotos = stringList(input.photo_urls);
  const newPaths = stringList(input.photo_storage_paths);
  if (!skuCode) {
    throw new HttpsError("invalid-argument", "Informe o SKU do item.");
  }
  if (!newPhotos.length) {
    throw new HttpsError("invalid-argument", "Envie ao menos uma foto.");
  }
  if (newPhotos.some((url) => !/^https:\/\//.test(url))) {
    throw new HttpsError("invalid-argument", "Foto com endereço inválido.");
  }
  const inputHash = digest(
    { skuCode, clientItemCode, customerCode, newPhotos, newPaths },
    64,
  );
  const operationId = `op_photos_${digest({
    skuCode,
    nonce: input.idempotency_key,
  })}`;
  const operationRef = db.collection(collections.operations).doc(operationId);
  const clientInventoryRef = db
    .collection(collections.clientInventory)
    .doc(clientScopedInventoryId(customerCode, skuCode, clientItemCode));

  return db.runTransaction(async (transaction) => {
    const previous = operationResult<Record<string, unknown>>(
      await transaction.get(operationRef),
      inputHash,
    );
    if (previous) return previous;

    const targets = await resolveCatalogAggregateTargets(
      transaction,
      db,
      skuCode,
      clientItemCode,
    );
    if (!targets.skuRef && !targets.productRef) {
      throw new HttpsError("not-found", `Item ${skuCode} não encontrado.`);
    }
    const [skuSnapshot, productSnapshot, balanceRows, clientSnapshot] =
      await Promise.all([
        targets.skuRef ? transaction.get(targets.skuRef) : undefined,
        targets.productRef ? transaction.get(targets.productRef) : undefined,
        readRows(transaction, skuBalancesQuery(db, customerCode, skuCode)),
        transaction.get(clientInventoryRef),
      ]);

    const current = asRecord(skuSnapshot?.data() ?? productSnapshot?.data());
    const existingPhotos = stringList(
      current.photo_urls ?? asRecord(productSnapshot?.data()).photo_urls,
    );
    const photoUrls = [...new Set([...existingPhotos, ...newPhotos])].slice(0, 8);
    const photoPaths = [
      ...new Set([...stringList(current.photo_storage_paths), ...newPaths]),
    ].slice(0, 8);
    const added = photoUrls.length - existingPhotos.length;
    const photoFields = compact({
      photo_urls: photoUrls,
      primary_photo_url: text(current.primary_photo_url) || photoUrls[0],
      photo_storage_paths: photoPaths.length ? photoPaths : undefined,
      updated_at: FieldValue.serverTimestamp(),
    });

    if (targets.skuRef) transaction.update(targets.skuRef, photoFields);
    if (targets.productRef) transaction.update(targets.productRef, photoFields);
    for (const row of balanceRows) {
      transaction.update(row.ref, {
        photo_urls: photoUrls,
        primary_photo_url: photoFields.primary_photo_url,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    if (clientSnapshot.exists) {
      transaction.update(clientInventoryRef, {
        photo_urls: photoUrls,
        primary_photo_url: photoFields.primary_photo_url,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    const event = createEvent(
      transaction,
      db,
      operationEventId(operationId, "photos_added"),
      {
        type: "catalog.photos_added",
        title: added === 1 ? "Foto adicionada ao item" : "Fotos adicionadas ao item",
        description: `${added} foto(s) em ${skuCode}.`,
        severity: "info",
        entity_type: "sku",
        entity_id: skuCode,
        customer_code: customerCode,
        payload: { added, total: photoUrls.length, client_item_code: clientItemCode },
      },
      actor,
    );
    const result = {
      ok: true,
      sku_code: skuCode,
      photo_urls: photoUrls,
      added,
      events: [event],
    };
    createOperationReceipt(
      transaction,
      operationRef,
      inputHash,
      "catalog.photos_added",
      skuCode,
      actor,
      result,
    );
    return result;
  });
}
