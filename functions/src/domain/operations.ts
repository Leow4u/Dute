import { createHash, randomUUID } from "node:crypto";

import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
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
  inboundReceipts: "inbound_receipts",
  inboundItems: "inbound_items",
  packTasks: "pack_tasks",
  packages: "packages",
  packageItems: "package_items",
  shipments: "shipments",
  shipmentItems: "shipment_items",
  movements: "movements",
  clientInventory: "client_inventory",
  clientOrderTracking: "client_order_tracking",
  clientRequestStatus: "client_request_status",
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
  location_id?: string;
  condition?: string;
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
  customer_code: string;
  idempotency_key: string;
  items: OperationalRequestItem[];
};

export type DecideOperationalRequestInput = {
  request_id: string;
  action: "approve" | "reject" | "close";
  reason?: string;
  expected_status: string;
  idempotency_key?: string;
};

export type AdvanceOperationalTaskInput = {
  task_uid: string;
  note?: string;
  expected_status?: string;
  idempotency_key?: string;
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

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiredPositive(value: unknown, label: string) {
  const parsed = number(value);
  if (parsed <= 0) {
    throw new HttpsError("invalid-argument", `${label} deve ser maior que zero.`);
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
    .map((item) => `${item.quantity}x ${item.product_name ?? item.sku_code ?? "item"}`)
    .join(", ");
  return items.length > 3 ? `${summary} +${items.length - 3} item(ns)` : summary;
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

function createEvent(
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

  if (severity === "attention" || severity === "critical") {
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

function operationResult<T>(snapshot: DocumentData, inputHash: string): T | undefined {
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
    result,
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

function clientInventoryId(customerCode: string, skuCode: string) {
  return safeDocId(`cinv_${customerCode}__${skuCode}`);
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
    .doc(clientInventoryId(input.customerCode, input.skuCode));
  transaction.set(
    ref,
    compact({
      id: ref.id,
      customer_code: input.customerCode,
      sku_code: input.skuCode,
      client_item_code: input.clientItemCode,
      product_name: input.productName ?? input.skuCode,
      category: input.category,
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
    unitCost?: number;
    qtyOnHand: number;
    qtyReserved: number;
  },
) {
  const ref = db
    .collection(collections.clientInventory)
    .doc(clientInventoryId(input.customerCode, input.skuCode));
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
      type: input.type === "ENTRADA" ? "inventory.received" : "inventory.shipped",
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
  const total = input.items.reduce((sum, item) => sum + number(item.quantity), 0);
  const description = input.description ?? "";
  const eventId = operationEventId(operationId, "request_created");

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

    const event = eventSummary(eventId, {
      type: "portal.request_created",
      title: "Solicitação criada no portal",
      description: description || itemSummary(input.items, input.title ?? input.type),
      severity:
        input.priority === "alta" || input.priority === "urgente"
          ? "attention"
          : "info",
      entity_type: "solicitacao_cliente",
      entity_id: requestId,
      customer_code: input.customer_code,
    });
    const result = {
      id: requestId,
      status: "open",
      item_count: input.items.length,
      quantity_total: total,
      events: [event],
    };

    transaction.create(
      requestRef,
      compact({
        id: requestId,
        customer_code: input.customer_code,
        type: input.type,
        priority: input.priority,
        title: input.title ?? input.type,
        description,
        destination: input.destination,
        due_at: input.due_at,
        items: input.items.map((item, index) =>
          compact({ ...item, line_number: item.line_number ?? index + 1 }),
        ),
        item_count: input.items.length,
        quantity_total: total,
        status: "open",
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
        customer_code: input.customer_code,
        type: input.type,
        priority: input.priority,
        title: input.title ?? input.type,
        description,
        destination: input.destination,
        due_at: input.due_at,
        item_count: input.items.length,
        quantity_total: total,
        status: "open",
        operational_status: "awaiting_review",
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
        description: description || itemSummary(input.items, input.title ?? input.type),
        severity: event.severity,
        entity_type: event.entity_type,
        entity_id: requestId,
        customer_code: input.customer_code,
        payload: {
          item_count: input.items.length,
          quantity_total: total,
          request_type: input.type,
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

function normalizeStoredItems(request: Record<string, unknown>) {
  const raw = Array.isArray(request.items) ? request.items : [];
  return raw.map((value, index): OperationalRequestItem => {
    const item = asRecord(value);
    return {
      line_number: number(item.line_number) || index + 1,
      sku_code: text(item.sku_code) || undefined,
      client_item_code: text(item.client_item_code) || undefined,
      product_name: text(item.product_name) || undefined,
      location_id: text(item.location_id) || undefined,
      condition: text(item.condition) || undefined,
      unit_cost: number(item.unit_cost),
      quantity: requiredPositive(item.quantity, `Quantidade da linha ${index + 1}`),
      notes: text(item.notes) || undefined,
    };
  });
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
  const operationNonce = input.idempotency_key ?? `${input.action}:${expectedStatus}`;
  const operationId = `op_decision_${digest({ requestId, operationNonce })}`;
  const inputHash = digest({ ...input, request_id: requestId, expected_status: expectedStatus }, 64);
  const operationRef = db.collection(collections.operations).doc(operationId);
  const requestRef = db.collection(collections.customerRequests).doc(requestId);
  const occurredAt = new Date().toISOString();
  const nextStatus =
    input.action === "approve"
      ? "approved"
      : input.action === "reject"
        ? "rejected"
        : "closed";

  return db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    const previous = operationResult<Record<string, unknown>>(
      operationSnapshot,
      inputHash,
    );
    if (previous) return previous;

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
      (input.action === "approve" || input.action === "reject") &&
      !decisionableStatuses.has(currentStatus)
    ) {
      throw new HttpsError(
        "failed-precondition",
        `Solicitação em ${currentStatus} não pode ser ${input.action === "approve" ? "aprovada" : "rejeitada"}.`,
      );
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

    if (input.action === "approve" && kind.outbound) {
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
      for (const skuCode of uniqueSkus) {
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
            text(left.data.location_id).localeCompare(text(right.data.location_id)),
          ),
        );
      }

      items.forEach((item, itemIndex) => {
        const skuCode = text(item.sku_code);
        const requestedLocation = text(item.location_id);
        const candidateRows = (balanceRowsBySku.get(skuCode) ?? []).filter(
          (row) =>
            !requestedLocation || text(row.data.location_id) === requestedLocation,
        );
        let remaining = item.quantity;
        let availableTotal = 0;

        for (const row of candidateRows) {
          const locationId = text(row.data.location_id);
          const key = balanceKey(customerCode, skuCode, locationId);
          const existing = reservedBalances.get(key);
          const qtyOnHand = existing?.qtyOnHand ?? number(row.data.qty_on_hand);
          const qtyReserved = existing?.qtyReserved ?? number(row.data.qty_reserved);
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

    if (input.action === "approve" && kind.inbound) {
      if (!items.length || items.some((item) => !text(item.sku_code))) {
        throw new HttpsError(
          "invalid-argument",
          "Solicitação de recebimento precisa de itens com sku_code.",
        );
      }
    }

    const events: OperationalEventSummary[] = [];
    if (input.action === "approve" && kind.outbound) {
      const orderId = `ord_${requestId}`;
      const orderNumber = `SOL-${requestId.slice(-8).toUpperCase()}`;
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
      const reservedBySku = new Map<string, OperationalRequestItem & { quantity: number }>();
      for (const item of items) {
        const skuCode = text(item.sku_code);
        const current = reservedBySku.get(skuCode);
        reservedBySku.set(skuCode, {
          ...(current ?? item),
          quantity: number(current?.quantity) + item.quantity,
        });
      }
      for (const [skuCode, item] of reservedBySku) {
        const skuRows = balanceRowsBySku.get(skuCode) ?? [];
        const qtyOnHand = skuRows.reduce(
          (sum, row) => sum + number(row.data.qty_on_hand),
          0,
        );
        const qtyReserved =
          skuRows.reduce(
            (sum, row) => sum + number(row.data.qty_reserved),
            0,
          ) + item.quantity;
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
        transaction.create(
          db.collection(collections.stockReservations).doc(`res_${lineId}`),
          {
            id: `res_${lineId}`,
            ...common,
            reserved_qty: allocation.quantity,
            status: "reserved",
          },
        );
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
            payload: { customer_request_id: requestId, pick_task_id: pickTaskId },
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
          createEvent(
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
      const receiptNumber = `SOL-${requestId.slice(-8).toUpperCase()}`;
      transaction.create(db.collection(collections.inboundReceipts).doc(inboundId), {
        id: inboundId,
        customer_code: customerCode,
        receipt_number: receiptNumber,
        status: "created",
        item_count: items.length,
        qty_expected: total,
        qty_received: 0,
        customer_request_id: requestId,
        source: "customer_request",
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
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
            location_id: item.location_id,
            unit_cost: item.unit_cost,
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
        createEvent(
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
            payload: { customer_request_id: requestId, quantity_total: total },
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
            : "Solicitação encerrada",
      description,
      severity: input.action === "approve" ? "attention" : "info",
      entity_type: "solicitacao_cliente",
      entity_id: requestId,
      customer_code: customerCode,
      payload: { action: input.action, reason: input.reason, ...created },
    };
    events.unshift(
      createEvent(
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
        operational_status:
          created.pick_task_id
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
        operational_status:
          created.pick_task_id
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
  picking: collections.pickTasks,
  packing: collections.packTasks,
  shipping: collections.shipments,
};

const taskFlows: Record<string, string[]> = {
  receiving: ["created", "checking", "received"],
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
    picking: { in_progress: "picking.started", completed: "picking.completed" },
    packing: { in_progress: "packing.started", completed: "packing.completed" },
    shipping: { dispatched: "shipment.dispatched", delivered: "shipment.delivered" },
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

    let inboundItems: Row[] = [];
    let pickLines: Row[] = [];
    let orderItems: Row[] = [];
    let reservations: Row[] = [];
    let shipmentItems: Row[] = [];
    let packages: Row[] = [];
    let orderRow: Row | undefined;
    let requestRow: Row | undefined;
    const balanceStates = new Map<string, BalanceState>();

    if (requestId) {
      const snapshot = await transaction.get(
        db.collection(collections.customerRequests).doc(requestId),
      );
      if (snapshot.exists) {
        requestRow = { id: snapshot.id, ref: snapshot.ref, data: snapshot.data() ?? {} };
      }
    }
    if (orderId) {
      const snapshot = await transaction.get(db.collection(collections.orders).doc(orderId));
      if (snapshot.exists) {
        orderRow = { id: snapshot.id, ref: snapshot.ref, data: snapshot.data() ?? {} };
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
          text(row.data.location_id || task.location_id || task.receiving_location) ||
          "RECEBIMENTO";
        if (!skuCode) {
          throw new HttpsError(
            "failed-precondition",
            `Linha ${row.id} não possui sku_code.`,
          );
        }
        keys.set(balanceKey(customerCode, skuCode, locationId), { skuCode, locationId });
      }
      for (const [key, value] of keys) {
        const rows = await readRows(
          transaction,
          exactBalanceQuery(db, customerCode, value.skuCode, value.locationId),
        );
        if (rows.length > 1) assertSingleBalance(rows, value.skuCode, value.locationId);
        const row =
          rows[0] ?? {
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
    }

    if (type === "picking" && targetStatus === "completed") {
      if (!orderId || !orderRow) {
        throw new HttpsError("failed-precondition", "Picking sem pedido válido.");
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
        db.collection(collections.stockReservations).where("order_id", "==", orderId),
      );
      if (!pickLines.length || !orderItems.length || !reservations.length) {
        throw new HttpsError(
          "failed-precondition",
          "Picking não possui linhas e reservas consistentes.",
        );
      }
    }

    if (type === "packing" && targetStatus === "completed") {
      if (!orderId || !orderRow) {
        throw new HttpsError("failed-precondition", "Packing sem pedido válido.");
      }
      orderItems = await readRows(
        transaction,
        db.collection(collections.orderItems).where("order_id", "==", orderId),
      );
      if (!orderItems.length) {
        throw new HttpsError("failed-precondition", "Packing não possui itens separados.");
      }
    }

    if (
      type === "shipping" &&
      (targetStatus === "dispatched" || targetStatus === "delivered")
    ) {
      if (!orderId || !orderRow) {
        throw new HttpsError("failed-precondition", "Expedição sem pedido válido.");
      }
      shipmentItems = await readRows(
        transaction,
        db.collection(collections.shipmentItems).where("shipment_id", "==", id),
      );
      packages = await readRows(
        transaction,
        db.collection(collections.packages).where("order_id", "==", orderId),
      );
    }

    if (type === "shipping" && targetStatus === "delivered") {
      reservations = await readRows(
        transaction,
        db.collection(collections.stockReservations).where("order_id", "==", orderId),
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
        keys.set(balanceKey(customerCode, skuCode, locationId), { skuCode, locationId });
      }
      for (const [key, value] of keys) {
        const row = assertSingleBalance(
          await readRows(
            transaction,
            exactBalanceQuery(db, customerCode, value.skuCode, value.locationId),
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

    if (type === "receiving" && targetStatus === "received") {
      let receivedQty = 0;
      const receivedBySku = new Map<
        string,
        {
          quantity: number;
          clientItemCode?: string;
          productName?: string;
          unitCost?: number;
        }
      >();
      for (const row of inboundItems) {
        const expectedQty = requiredPositive(row.data.expected_qty, `Quantidade de ${row.id}`);
        const recordedQty = number(row.data.received_qty);
        const quantity = recordedQty > 0 ? recordedQty : expectedQty;
        const skuCode = text(row.data.sku_code);
        const locationId =
          text(row.data.location_id || task.location_id || task.receiving_location) ||
          "RECEBIMENTO";
        const state = balanceStates.get(balanceKey(customerCode, skuCode, locationId));
        if (!state) {
          throw new HttpsError("internal", "Estado de saldo ausente no recebimento.");
        }
        const beforeQty = state.qtyOnHand;
        state.qtyOnHand += quantity;
        receivedQty += quantity;
        const projected = receivedBySku.get(skuCode) ?? {
          quantity: 0,
          clientItemCode: text(row.data.client_item_code) || undefined,
          productName: text(row.data.product_name) || undefined,
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
            (text(row.data.location_id || task.location_id || task.receiving_location) ||
              "RECEBIMENTO") === state.locationId,
        );
        const balancePayload = compact({
          customer_code: customerCode,
          sku_code: state.skuCode,
          client_item_code:
            state.row.data.client_item_code ?? sourceItem?.data.client_item_code,
          product_name: state.row.data.product_name ?? sourceItem?.data.product_name,
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
          unitCost: projected.unitCost,
          onHandDelta: projected.quantity,
        });
      }
      Object.assign(taskUpdate, {
        qty_received: receivedQty,
        received_at: FieldValue.serverTimestamp(),
      });
      effects.received_lines = inboundItems.length;
      effects.received_qty = receivedQty;
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
            payload: { received_qty: receivedQty, movement_count: inboundItems.length },
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
        transaction.set(
          db.collection(collections.clientRequestStatus).doc(requestRow.id),
          {
            customer_code: customerCode,
            operational_status: "received",
            status: "closed",
            published_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    if (type === "picking" && targetStatus === "completed") {
      const pickedUnits = pickLines.reduce(
        (sum, row) => sum + requiredPositive(row.data.qty_to_pick, `Quantidade de ${row.id}`),
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
        transaction.update(row.ref, {
          qty_picked: number(row.data.qty_to_pick),
          status: "completed",
          picked_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
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
      created.pack_task_id = packTaskId;
      effects.picked_lines = pickLines.length;
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
            payload: { pick_task_id: id, order_id: orderId, picked_units: pickedUnits },
          },
          actor,
        ),
      );
    }

    if (type === "packing" && targetStatus === "completed") {
      const packedUnits = orderItems.reduce(
        (sum, row) => sum + number(row.data.picked_qty || row.data.allocated_qty),
        0,
      );
      if (packedUnits <= 0) {
        throw new HttpsError("failed-precondition", "Packing não possui quantidade separada.");
      }
      const packageId = `pkg_${safeDocId(id)}_001`;
      const shipmentId = `ship_${safeDocId(orderId)}`;
      const orderNumber = task.order_number ?? orderRow?.data.order_number ?? null;
      const destination = task.destination ?? orderRow?.data.destination ?? "Destino a confirmar";
      transaction.create(db.collection(collections.packages).doc(packageId), {
        id: packageId,
        customer_code: customerCode,
        pack_task_id: id,
        order_id: orderId,
        order_number: orderNumber,
        status: "packed",
        volume_number: 1,
        packed_units: packedUnits,
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
        package_count: 1,
        source: "packing_completed",
        customer_request_id: requestId || null,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      orderItems.forEach((row, index) => {
        const quantity = number(row.data.picked_qty || row.data.allocated_qty);
        if (quantity <= 0) return;
        const line = String(number(row.data.line_number) || index + 1).padStart(2, "0");
        const common = compact({
          customer_code: customerCode,
          order_id: orderId,
          order_number: orderNumber,
          line_number: number(row.data.line_number) || index + 1,
          sku_code: row.data.sku_code,
          client_item_code: row.data.client_item_code,
          product_name: row.data.product_name,
          location_id: row.data.location_id,
          qty_packed: quantity,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        const packageItemId = `pki_${safeDocId(packageId)}_${line}`;
        const shipmentItemId = `shi_${safeDocId(shipmentId)}_${line}`;
        transaction.update(row.ref, {
          status: "packed",
          packed_qty: quantity,
          packed_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        transaction.create(db.collection(collections.packageItems).doc(packageItemId), {
          id: packageItemId,
          package_id: packageId,
          shipment_id: shipmentId,
          status: "packed",
          ...common,
        });
        transaction.create(db.collection(collections.shipmentItems).doc(shipmentItemId), {
          id: shipmentItemId,
          package_id: packageId,
          shipment_id: shipmentId,
          status: "ready_to_dispatch",
          qty_shipped: quantity,
          ...common,
        });
      });
      Object.assign(taskUpdate, {
        packed_units: packedUnits,
        package_count: 1,
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
      Object.assign(created, { package_id: packageId, shipment_id: shipmentId });
      effects.packed_units = packedUnits;
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
            payload: { pack_task_id: id, package_id: packageId, packed_units: packedUnits },
          },
          actor,
        ),
      );
    }

    if (type === "shipping" && targetStatus === "dispatched") {
      Object.assign(taskUpdate, { dispatched_at: FieldValue.serverTimestamp() });
      for (const row of shipmentItems) {
        transaction.update(row.ref, {
          status: "dispatched",
          dispatched_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const row of packages) {
        transaction.update(row.ref, {
          status: "dispatched",
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
        const state = balanceStates.get(balanceKey(customerCode, skuCode, locationId));
        if (!state) throw new HttpsError("internal", "Estado de saldo ausente na expedição.");
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
      }
      for (const row of shipmentItems) {
        transaction.update(row.ref, {
          status: "delivered",
          qty_delivered: number(row.data.qty_shipped || row.data.qty_packed),
          delivered_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      }
      for (const row of packages) {
        transaction.update(row.ref, {
          status: "delivered",
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
      effects.stock_consumed = consumedQty;
      effects.movement_count = reservations.length;
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
            payload: { stock_consumed: consumedQty, movement_count: reservations.length },
          },
          actor,
        ),
      );
    }

    if (orderId) {
      const trackingByStep: Record<
        string,
        { status: string; label: string }
      > = {
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
        updateClientTracking(transaction, db, orderId, {
          customer_code: customerCode,
          order_number: task.order_number ?? orderRow?.data.order_number,
          status: tracking.status,
          status_label: tracking.label,
          destination: task.destination ?? orderRow?.data.destination,
          timeline: FieldValue.arrayUnion(
            clientTimelineEntry(tracking.status, tracking.label, actor, occurredAt),
          ),
          dispatched_at:
            tracking.status === "dispatched" ? occurredAt : undefined,
          delivered_at:
            tracking.status === "delivered" ? occurredAt : undefined,
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
