import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { firebaseAuth, firestore } from "./firebase";
import { callFunctionsApi, shouldUseFunctionsApi } from "./functions-api";
import {
  DEFAULT_CUSTOMER,
  buildDerivedCustomerAccounts,
  buildDerivedInboundReceipts,
  buildDerivedLocations,
  buildDerivedOrderItems,
  buildDerivedPackTasks,
  buildDerivedPickTasks,
  buildDerivedStockBalances,
  buildOperationalFoundationSnapshot,
} from "./operational-foundation";

type AnyRecord = Record<string, any>;
type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const collectionNames = {
  products: "products",
  skus: "skus",
  movements: "movements",
  orders: "orders",
  customers: "customers",
  customerAccounts: "customer_accounts",
  customerRequests: "customer_requests",
  locations: "locations",
  stockBalances: "stock_balances",
  clientInventory: "client_inventory",
  clientOrderTracking: "client_order_tracking",
  clientRequestStatus: "client_request_status",
  clientInvoices: "client_invoices",
  clientDocuments: "client_documents",
  inboundReceipts: "inbound_receipts",
  inboundItems: "inbound_items",
  putawayTasks: "putaway_tasks",
  qualityExceptions: "quality_exceptions",
  orderItems: "order_items",
  stockReservations: "stock_reservations",
  pickTasks: "pick_tasks",
  pickLines: "pick_lines",
  packTasks: "pack_tasks",
  packages: "packages",
  packageItems: "package_items",
  shipments: "shipments",
  shipmentItems: "shipment_items",
  deliveryProofs: "delivery_proofs",
  documents: "documents",
  documentLinks: "document_links",
  priceList: "billing_price_list",
  periods: "billing_periods",
  manual: "billing_manual",
  users: "users",
  events: "events",
  agentInbox: "ai_agent_inbox",
  agentMemory: "ai_agent_memory",
  agentKnowledge: "ai_agent_knowledge",
  agentKnowledgeChunks: "ai_agent_knowledge_chunks",
  agentKnowledgeFiles: "ai_agent_knowledge_files",
  agentKnowledgeFileChunks: "ai_agent_knowledge_file_chunks",
  agentConversations: "agent_conversations",
  agentMessages: "agent_messages",
};

type EventSeverity = "info" | "attention" | "critical";
type EventInput = {
  type: string;
  title: string;
  description?: string;
  severity?: EventSeverity;
  entity_type?: string;
  entity_id?: string | number;
  customer_code?: string;
  customer_name?: string;
  payload?: AnyRecord;
  occurred_at?: string;
  dedupe_key?: string;
  source?: string;
};

type EntityMeta = {
  entity_type: string;
  entity_id: string | number;
  title: string;
  description?: string;
  customer_code?: string;
  customer_name?: string;
  payload?: AnyRecord;
  severity?: EventSeverity;
};

const OPEN_ORDER_STATUSES = new Set([
  "PENDENTE",
  "SEPARACAO",
  "ABERTO",
  "PENDING",
  "SEPARATING",
  "SEPARATED",
  "CHECKING",
  "READY_TO_DISPATCH",
  "DISPATCHED",
]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readBody(init?: RequestInit): Promise<AnyRecord> {
  if (!init?.body) return {};
  if (typeof init.body === "string") return JSON.parse(init.body);
  return JSON.parse(await new Response(init.body).text());
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: number }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  return "";
}

function normalizeDoc(snapshot: any): AnyRecord {
  const data = snapshot.data() as AnyRecord;
  const numericId = Number(snapshot.id);
  return {
    ...data,
    id: data.id ?? (Number.isFinite(numericId) ? numericId : snapshot.id),
    _docId: snapshot.id,
  };
}

function newDocId(prefix: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${suffix}`;
}

function safeDocId(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

function currentActor() {
  const user = firebaseAuth?.currentUser;
  return {
    uid: user?.uid ?? null,
    name: user?.displayName || user?.email || "Sistema",
    email: user?.email ?? null,
  };
}

function compactPayload(payload: AnyRecord = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function positiveNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizeRequestItems(data: AnyRecord, fallbackDescription = "") {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const fallbackQuantity = positiveNumber(
    data.quantity ?? data.qty ?? data.qtd_solic ?? data.expected_qty ?? data.total_units,
  );
  const fallbackItems =
    rawItems.length || (!fallbackQuantity && !data.sku_code && !data.cod_sku)
      ? []
      : [data];

  return [...rawItems, ...fallbackItems]
    .map((item: AnyRecord, index) => {
      const quantity = positiveNumber(
        item.quantity ??
          item.qty ??
          item.requested_qty ??
          item.expected_qty ??
          item.qty_expected ??
          fallbackQuantity,
      );
      const skuCode = optionalString(item.sku_code ?? item.cod_sku ?? item.cod_btg);
      const clientItemCode = optionalString(
        item.client_item_code ?? item.cod_cliente ?? item.product_code,
      );
      const productName = optionalString(
        item.product_name ?? item.produto ?? item.name ?? fallbackDescription,
      );
      return {
        line_number: Number(item.line_number ?? index + 1),
        sku_code: skuCode,
        client_item_code: clientItemCode,
        product_name: productName,
        location_id: optionalString(item.location_id ?? item.location ?? item.endereco),
        condition: optionalString(item.condition ?? item.estado),
        unit_cost: Number(item.unit_cost ?? item.preco_unit ?? item.custo_unit ?? 0),
        quantity,
        notes: optionalString(item.notes ?? item.observacao),
      };
    })
    .filter((item) => item.quantity > 0 || item.sku_code || item.product_name);
}

function itemQuantityTotal(items: AnyRecord[]) {
  return items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
}

function requestItemSummary(items: AnyRecord[], fallback: string) {
  if (!items.length) return fallback;
  const summary = items
    .slice(0, 3)
    .map((item) =>
      `${Number(item.quantity ?? 0) || "-"}x ${item.product_name || item.sku_code || "item"}`.trim(),
    )
    .join(", ");
  return items.length > 3 ? `${summary} +${items.length - 3} item(ns)` : summary;
}

function findBalanceForRequestItem(
  balances: AnyRecord[],
  item: AnyRecord,
  customerCode: string,
) {
  return balances.find((balance) => {
    const sameCustomer =
      String(balance.customer_code ?? DEFAULT_CUSTOMER.code) === customerCode;
    const sameSku =
      item.sku_code && String(balance.sku_code ?? balance.cod_sku ?? "") === item.sku_code;
    const sameClientItem =
      item.client_item_code &&
      String(balance.client_item_code ?? balance.cod_cliente ?? "") === item.client_item_code;
    const sameLocation =
      !item.location_id || String(balance.location_id ?? "") === item.location_id;
    return sameCustomer && sameLocation && (sameSku || sameClientItem);
  });
}

function stockBalanceKey(row: AnyRecord) {
  return [
    String(row.customer_code ?? row.cod_cliente ?? DEFAULT_CUSTOMER.code),
    String(row.sku_code ?? row.cod_sku ?? row.cod_btg ?? row.client_item_code ?? "sku"),
    String(row.location_id ?? row.location ?? "RECEBIMENTO"),
  ]
    .map(safeDocId)
    .join("__");
}

function stockBalanceDocId(customerCode: string, item: AnyRecord) {
  return `bal_${stockBalanceKey({
    customer_code: customerCode,
    sku_code: item.sku_code,
    client_item_code: item.client_item_code,
    location_id: item.location_id,
  })}`;
}

function buildMovementPayload({
  type,
  sign,
  quantity,
  item,
  customerCode,
  productName,
  beforeQty,
  afterQty,
  source,
  entity,
}: {
  type: string;
  sign: 1 | -1;
  quantity: number;
  item: AnyRecord;
  customerCode: string;
  productName?: string;
  beforeQty: number;
  afterQty: number;
  source: string;
  entity: AnyRecord;
}) {
  const id = newDocId("mov");
  const now = new Date().toISOString();
  return compactPayload({
    id,
    data: now,
    tipo_mov: type,
    sinal: sign,
    cod_sku: item.sku_code ?? item.cod_sku ?? item.cod_btg,
    cod_cliente: customerCode,
    produto: productName ?? item.product_name ?? item.produto ?? item.sku_code,
    qtde: quantity,
    location_id: item.location_id ?? item.location,
    estoque_anterior: beforeQty,
    estoque_resultante: afterQty,
    saldo_delta: sign * quantity,
    source,
    ...entity,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

function warehouseTaskCollection(type: string) {
  const collectionByType: Record<string, string> = {
    receiving: collectionNames.inboundReceipts,
    putaway: collectionNames.putawayTasks,
    picking: collectionNames.pickTasks,
    packing: collectionNames.packTasks,
    shipping: collectionNames.shipments,
  };
  return collectionByType[type];
}

function isTerminalWarehouseTask(type: string, status: unknown) {
  const normalized = String(status ?? "").toLowerCase();
  const terminalByType: Record<string, string[]> = {
    receiving: ["received"],
    putaway: ["completed"],
    picking: ["completed"],
    packing: ["completed"],
    shipping: ["delivered"],
  };
  return (terminalByType[type] ?? ["completed"]).includes(normalized);
}

function groupByField(rows: AnyRecord[], field: string) {
  const groups = new Map<string, AnyRecord[]>();
  for (const row of rows) {
    const key = String(row[field] ?? "");
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function collectionLabel(name: string) {
  if (name === collectionNames.customers) return "cliente";
  if (name === collectionNames.customerAccounts) return "conta_cliente";
  if (name === collectionNames.customerRequests) return "solicitacao_cliente";
  if (name === collectionNames.products) return "produto";
  if (name === collectionNames.skus) return "sku";
  if (name === collectionNames.locations) return "localizacao";
  if (name === collectionNames.stockBalances) return "saldo_estoque";
  if (name === collectionNames.movements) return "movimentacao";
  if (name === collectionNames.inboundReceipts) return "recebimento";
  if (name === collectionNames.inboundItems) return "item_recebimento";
  if (name === collectionNames.putawayTasks) return "tarefa_putaway";
  if (name === collectionNames.qualityExceptions) return "excecao_qualidade";
  if (name === collectionNames.orders) return "pedido";
  if (name === collectionNames.orderItems) return "item_pedido";
  if (name === collectionNames.stockReservations) return "reserva_estoque";
  if (name === collectionNames.pickTasks) return "tarefa_picking";
  if (name === collectionNames.pickLines) return "linha_picking";
  if (name === collectionNames.packTasks) return "tarefa_packing";
  if (name === collectionNames.packages) return "volume";
  if (name === collectionNames.packageItems) return "item_volume";
  if (name === collectionNames.shipments) return "expedicao";
  if (name === collectionNames.shipmentItems) return "item_expedicao";
  if (name === collectionNames.deliveryProofs) return "comprovante_entrega";
  if (name === collectionNames.documents) return "documento";
  if (name === collectionNames.documentLinks) return "vinculo_documento";
  if (name === collectionNames.priceList) return "preco";
  if (name === collectionNames.periods) return "fatura";
  if (name === collectionNames.users) return "usuario";
  return name;
}

function entityMetaForWrite(
  name: string,
  action: "created" | "updated" | "deleted",
  data: AnyRecord,
  id: string | number,
  before?: AnyRecord,
): EntityMeta {
  const entityType = collectionLabel(name);
  const common = {
    entity_type: entityType,
    entity_id: id,
    customer_code: String(
      data.customer_code ?? before?.customer_code ?? data.cod_cliente ?? before?.cod_cliente ?? "",
    ).trim(),
    payload: compactPayload({
      before_status: before?.status,
      after_status: data.status,
      changed_fields:
        action === "updated" ? Object.keys(data).filter((key) => key !== "updated_at") : undefined,
    }),
  };

  if (name === collectionNames.products) {
    return {
      ...common,
      title:
        action === "created"
          ? "Produto criado"
          : action === "deleted"
            ? "Produto removido"
            : "Produto atualizado",
      description: String(data.produto ?? before?.produto ?? data.cod_cliente ?? id),
    };
  }

  if (name === collectionNames.skus) {
    return {
      ...common,
      title:
        action === "created"
          ? "SKU criado"
          : action === "deleted"
            ? "SKU removido"
            : "SKU atualizado",
      description: `${data.cod_btg ?? before?.cod_btg ?? id} - ${data.produto ?? before?.produto ?? ""}`.trim(),
    };
  }

  if (name === collectionNames.orders) {
    const statusChanged = before?.status && data.status && before.status !== data.status;
    const status = String(data.status ?? before?.status ?? "").toUpperCase();
    return {
      ...common,
      title: statusChanged ? "Status de pedido atualizado" : "Pedido atualizado",
      description: `${data.num_pedido ?? before?.num_pedido ?? id}${status ? ` - ${status}` : ""}`,
      severity: OPEN_ORDER_STATUSES.has(status) ? "attention" : "info",
      payload: compactPayload({
        ...common.payload,
        qtd_solic: data.qtd_solic ?? before?.qtd_solic,
        qtd_sep: data.qtd_sep ?? before?.qtd_sep,
        produto: data.produto ?? before?.produto,
      }),
    };
  }

  if (name === collectionNames.priceList) {
    return {
      ...common,
      title:
        action === "created"
          ? "Item de preço criado"
          : action === "deleted"
            ? "Item de preço removido"
            : "Item de preço atualizado",
      description: String(data.item ?? before?.item ?? id),
    };
  }

  if (name === collectionNames.users) {
    return {
      ...common,
      title: action === "updated" ? "Perfil de acesso atualizado" : "Usuário atualizado",
      description: String(data.email ?? before?.email ?? id),
      severity: "attention",
      payload: compactPayload({
        role: data.role ?? before?.role,
        nome: data.nome ?? before?.nome,
      }),
    };
  }

  return {
    ...common,
    title: `${entityType} ${action}`,
    description: String(id),
  };
}

function agentInsightForEvent(event: AnyRecord) {
  const type = String(event.type ?? "");
  const severity = String(event.severity ?? "info") as EventSeverity;
  if (severity === "info" && !type.startsWith("order.")) return null;

  const priority =
    severity === "critical" ? "critical" : severity === "attention" ? "high" : "normal";

  return {
    id: `insight_${event.id}`,
    event_id: event.id,
    title:
      severity === "critical"
        ? "Intervenção necessária"
        : type.startsWith("order.")
          ? "Pedido precisa de acompanhamento"
          : "Atenção operacional",
    message: event.description || event.title,
    priority,
    status: "open",
    entity_type: event.entity_type ?? null,
    entity_id: event.entity_id ?? null,
    customer_code: event.customer_code ?? null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
}

async function updateAgentMemory(event: AnyRecord) {
  if (!firestore) return;
  const db = firestore;

  const memories = [
    event.entity_type && event.entity_id
      ? {
          id: `${event.entity_type}_${event.entity_id}`,
          scope_type: event.entity_type,
          scope_id: String(event.entity_id),
          title: event.description || event.title,
        }
      : null,
    event.customer_code
      ? {
          id: `cliente_${event.customer_code}`,
          scope_type: "cliente",
          scope_id: String(event.customer_code),
          title: event.customer_name || event.customer_code,
        }
      : null,
  ].filter(Boolean) as Array<{
    id: string;
    scope_type: string;
    scope_id: string;
    title: string;
  }>;

  await Promise.all(
    memories.map((memory) =>
      setDoc(
        doc(db, collectionNames.agentMemory, safeDocId(memory.id)),
        {
          ...memory,
          last_event_id: event.id,
          last_event_type: event.type,
          last_event_title: event.title,
          last_event_at: event.occurred_at,
          last_payload: compactPayload(event.payload ?? {}),
          event_count: increment(1),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  );
}

async function emitEvent(input: EventInput) {
  if (!firestore) return null;

  const id = input.dedupe_key
    ? safeDocId(input.dedupe_key)
    : newDocId("evt");
  const event = {
    id,
    type: input.type,
    title: input.title,
    description: input.description ?? "",
    severity: input.severity ?? "info",
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id != null ? String(input.entity_id) : null,
    customer_code: input.customer_code || null,
    customer_name: input.customer_name || null,
    payload: compactPayload(input.payload ?? {}),
    source: input.source ?? "app",
    actor: currentActor(),
    occurred_at: input.occurred_at || new Date().toISOString(),
    created_at: serverTimestamp(),
  };

  await setDoc(doc(firestore, collectionNames.events, id), event, {
    merge: Boolean(input.dedupe_key),
  });

  const insight = agentInsightForEvent(event);
  if (insight) {
    await setDoc(doc(firestore, collectionNames.agentInbox, insight.id), insight, {
      merge: true,
    }).catch(() => undefined);
  }
  await updateAgentMemory(event).catch(() => undefined);
  return event;
}

async function readAll(name: string): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const snapshot = await getDocs(collection(firestore, name));
  return snapshot.docs.map(normalizeDoc);
}

async function readWhereEqual(
  name: string,
  field: string,
  value: string | number | boolean,
): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const snapshot = await getDocs(
    query(collection(firestore, name), where(field, "==", value)),
  );
  return snapshot.docs.map(normalizeDoc);
}

async function findDocRef(name: string, id: string | number) {
  if (!firestore) throw new Error("Firestore não configurado.");

  const direct = doc(firestore, name, String(id));
  const directSnapshot = await getDoc(direct);
  if (directSnapshot.exists()) return direct;

  const byId = await getDocs(
    query(collection(firestore, name), where("id", "==", Number(id))),
  );
  if (!byId.empty) return byId.docs[0].ref;

  throw new Error(`Registro não encontrado: ${name}/${id}`);
}

function includes(value: unknown, needle: string): boolean {
  return String(value ?? "").toLowerCase().includes(needle.toLowerCase());
}

function filterAndPage(
  rows: AnyRecord[],
  params: URLSearchParams,
  filters: string[],
  searchFields: string[],
): { items: AnyRecord[]; total: number } {
  let result = [...rows];

  for (const field of filters) {
    const value = params.get(field);
    if (value) result = result.filter((row) => includes(row[field], value));
  }

  const search = params.get("search");
  if (search) {
    result = result.filter((row) =>
      searchFields.some((field) => includes(row[field], search)),
    );
  }

  const from = params.get("date_from");
  const to = params.get("date_to");
  if (from) result = result.filter((row) => toIso(row.data ?? row.data_solic) >= from);
  if (to) result = result.filter((row) => toIso(row.data ?? row.data_solic) <= to);

  const total = result.length;
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? total);
  return { items: result.slice(offset, offset + limit), total };
}

async function createItem(
  name: string,
  data: AnyRecord,
  options: { silent?: boolean } = {},
) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const id = data.id ?? Date.now();
  const payload: AnyRecord = {
    ...data,
    id,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
  await setDoc(doc(firestore, name, String(id)), payload);
  if (!options.silent) {
    const meta = entityMetaForWrite(name, "created", payload, id);
    await emitEvent({
      type: `${meta.entity_type}.created`,
      title: meta.title,
      description: meta.description,
      severity: meta.severity,
      entity_type: meta.entity_type,
      entity_id: meta.entity_id,
      customer_code: meta.customer_code,
      customer_name: meta.customer_name,
      payload: meta.payload,
    });
  }
  return { ...payload, created_at: undefined, updated_at: undefined };
}

async function updateItem(name: string, id: string | number, data: AnyRecord) {
  const ref = await findDocRef(name, id);
  const beforeSnapshot = await getDoc(ref);
  const before = beforeSnapshot.exists() ? (beforeSnapshot.data() as AnyRecord) : {};
  await updateDoc(ref, { ...data, updated_at: serverTimestamp() });
  const snapshot = await getDoc(ref);
  const updated = normalizeDoc(snapshot);
  const meta = entityMetaForWrite(name, "updated", updated, id, before);
  await emitEvent({
    type:
      name === collectionNames.orders && before.status !== updated.status
        ? "order.status_changed"
        : `${meta.entity_type}.updated`,
    title: meta.title,
    description: meta.description,
    severity: meta.severity,
    entity_type: meta.entity_type,
    entity_id: meta.entity_id,
    customer_code: meta.customer_code,
    customer_name: meta.customer_name,
    payload: meta.payload,
  });
  return updated;
}

async function deleteItem(name: string, id: string | number) {
  const ref = await findDocRef(name, id);
  const beforeSnapshot = await getDoc(ref);
  const before = beforeSnapshot.exists() ? normalizeDoc(beforeSnapshot) : { id };
  await deleteDoc(ref);
  const meta = entityMetaForWrite(name, "deleted", before, id, before);
  await emitEvent({
    type: `${meta.entity_type}.deleted`,
    title: meta.title,
    description: meta.description,
    severity: "attention",
    entity_type: meta.entity_type,
    entity_id: meta.entity_id,
    customer_code: meta.customer_code,
    customer_name: meta.customer_name,
    payload: meta.payload,
  });
}

function movementSign(tipo: unknown, fallback: unknown): 1 | -1 {
  const normalized = String(tipo ?? "").toUpperCase();
  if (["ENTRADA", "DEVOLUCAO", "AJUSTE_ENTRADA"].includes(normalized)) return 1;
  if (["SAIDA", "EXPEDICAO", "AJUSTE_SAIDA"].includes(normalized)) return -1;
  return Number(fallback ?? 0) >= 0 ? 1 : -1;
}

async function findSkuByCode(codSku: string) {
  if (!firestore) throw new Error("Firestore não configurado.");

  const direct = await getDoc(doc(firestore, collectionNames.skus, codSku));
  if (direct.exists()) return direct;

  const byBtg = await getDocs(
    query(collection(firestore, collectionNames.skus), where("cod_btg", "==", codSku)),
  );
  if (!byBtg.empty) return byBtg.docs[0];

  const byId = await getDocs(
    query(collection(firestore, collectionNames.skus), where("id", "==", Number(codSku))),
  );
  if (!byId.empty) return byId.docs[0];

  return null;
}

async function syncProductAggregate(
  batch: ReturnType<typeof writeBatch>,
  skuData: AnyRecord,
  updatedSkuDocId: string,
  updatedStock: number,
) {
  if (!firestore) throw new Error("Firestore não configurado.");

  const codCliente = String(skuData.cod_cliente ?? "").trim();
  if (!codCliente) return;

  const skuSnapshot = await getDocs(
    query(collection(firestore, collectionNames.skus), where("cod_cliente", "==", codCliente)),
  );

  let estoqueBtg = 0;
  let numSkus = 0;
  for (const skuDoc of skuSnapshot.docs) {
    const data = skuDoc.data() as AnyRecord;
    const estoque =
      skuDoc.id === updatedSkuDocId
        ? updatedStock
        : Number(data.estoque_atual ?? 0);
    estoqueBtg += estoque;
    numSkus += 1;
  }

  const productSnapshot = await getDocs(
    query(collection(firestore, collectionNames.products), where("cod_cliente", "==", codCliente)),
  );

  const existingProduct = productSnapshot.docs[0];
  const productData = existingProduct?.data() as AnyRecord | undefined;
  const precoUnit = Number(productData?.preco_unit ?? skuData.preco_unit ?? 0);
  const aggregate = {
    cod_cliente: codCliente,
    produto: productData?.produto ?? skuData.produto ?? "",
    genero: productData?.genero ?? skuData.genero ?? "",
    categoria: productData?.categoria ?? skuData.categoria ?? "",
    grupo: productData?.grupo ?? skuData.grupo ?? "",
    cor: productData?.cor ?? skuData.cor ?? "",
    tamanho: productData?.tamanho ?? skuData.tamanho ?? "",
    preco_unit: precoUnit,
    estoque_btg: estoqueBtg,
    num_skus: numSkus,
    custo_total: estoqueBtg * precoUnit,
    updated_at: serverTimestamp(),
  };

  if (existingProduct) {
    batch.update(existingProduct.ref, aggregate);
    return;
  }

  const productId = Date.now();
  batch.set(doc(firestore, collectionNames.products, String(productId)), {
    ...aggregate,
    id: productId,
    created_at: serverTimestamp(),
  });
}

async function createMovement(data: AnyRecord) {
  if (!firestore) throw new Error("Firestore não configurado.");

  const codSku = String(data.cod_sku ?? "").trim();
  if (!codSku) throw new RouteError("Informe o código do SKU.", 400);

  const skuSnapshot = await findSkuByCode(codSku);
  if (!skuSnapshot?.exists()) {
    throw new RouteError(`SKU não encontrado: ${codSku}`, 404);
  }

  const skuData = skuSnapshot.data() as AnyRecord;
  const quantity = Number(data.qtde ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RouteError("A quantidade da movimentação deve ser maior que zero.", 400);
  }

  const sign = movementSign(data.tipo_mov, data.sinal);
  const previousStock = Number(skuData.estoque_atual ?? 0);
  const nextStock = previousStock + sign * quantity;
  if (nextStock < 0) {
    throw new RouteError(
      `Estoque insuficiente para ${codSku}. Disponível: ${previousStock}, solicitado: ${quantity}.`,
      409,
    );
  }

  const reserved = Number(skuData.estoque_reservado ?? 0);
  const movementId = Date.now();
  const now = new Date().toISOString();
  const payload: AnyRecord = {
    ...data,
    id: movementId,
    data: toIso(data.data) || now,
    cod_sku: skuData.cod_btg ?? codSku,
    cod_cliente: skuData.cod_cliente ?? data.cod_cliente ?? "",
    produto: skuData.produto ?? data.produto ?? "",
    qtde: quantity,
    sinal: sign,
    estoque_tipo: data.estoque_tipo ?? skuData.estoque_tipo ?? "",
    estoque_anterior: previousStock,
    estoque_resultante: nextStock,
    saldo_delta: sign * quantity,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, collectionNames.movements, String(movementId)), payload);
  batch.update(skuSnapshot.ref, {
    estoque_atual: nextStock,
    estoque_disponivel: Math.max(0, nextStock - reserved),
    ultimo_movimento_em: payload.data,
    updated_at: serverTimestamp(),
  });
  const [stockBalance] = buildDerivedStockBalances([
    {
      ...skuData,
      cod_btg: payload.cod_sku,
      cod_cliente: payload.cod_cliente,
      produto: payload.produto,
      estoque_atual: nextStock,
      estoque_reservado: reserved,
    },
  ]);
  if (stockBalance) {
    batch.set(
      doc(firestore, collectionNames.stockBalances, safeDocId(String(stockBalance.id))),
      { ...stockBalance, updated_at: serverTimestamp() },
      { merge: true },
    );
  }
  await syncProductAggregate(batch, skuData, skuSnapshot.id, nextStock);
  await batch.commit();

  const movementType = String(payload.tipo_mov ?? "").toUpperCase();
  const eventType = movementType.includes("AJUSTE")
    ? "inventory.adjusted"
    : sign > 0
      ? "inventory.received"
      : "inventory.shipped";
  await emitEvent({
    type: eventType,
    title:
      eventType === "inventory.received"
        ? "Produto recebido no estoque"
        : eventType === "inventory.shipped"
          ? "Produto saiu do estoque"
          : "Estoque ajustado",
    description: `${quantity.toLocaleString("pt-BR")} un. de ${payload.produto || payload.cod_sku}`,
    severity: nextStock === 0 ? "attention" : "info",
    entity_type: "movimentacao",
    entity_id: movementId,
    customer_code: String(payload.cod_cliente ?? ""),
    payload: compactPayload({
      cod_sku: payload.cod_sku,
      tipo_mov: payload.tipo_mov,
      doc_nf: payload.doc_nf,
      origem: payload.origem,
      destino: payload.destino,
      previous_stock: previousStock,
      next_stock: nextStock,
      quantity,
    }),
    occurred_at: payload.data,
  });

  return {
    ...payload,
    created_at: undefined,
    updated_at: undefined,
  };
}

function categoryStats(products: AnyRecord[]) {
  const byCategory = new Map<string, { categoria: string; total_pecas: number; custo_total: number }>();
  for (const product of products) {
    const categoria = product.categoria || "Sem categoria";
    const current =
      byCategory.get(categoria) ?? { categoria, total_pecas: 0, custo_total: 0 };
    current.total_pecas += Number(product.estoque_btg ?? 0);
    current.custo_total += Number(product.custo_total ?? 0);
    byCategory.set(categoria, current);
  }
  return [...byCategory.values()];
}

async function getDashboard() {
  const [products, skus, movements, orders] = await Promise.all([
    readAll(collectionNames.products),
    readAll(collectionNames.skus),
    readAll(collectionNames.movements),
    readAll(collectionNames.orders),
  ]);

  const orderStatus = new Map<string, number>();
  for (const order of orders) {
    const status = order.status || "SEM_STATUS";
    orderStatus.set(status, (orderStatus.get(status) ?? 0) + 1);
  }

  return {
    total_produtos: products.length,
    total_skus: skus.length,
    total_pecas: skus.reduce((sum, sku) => sum + Number(sku.estoque_atual ?? 0), 0),
    custo_total: products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0),
    ad_valorem: products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0) * 0.005,
    recent_movements: movements
      .sort((a, b) => toIso(b.data).localeCompare(toIso(a.data)))
      .slice(0, 10),
    by_category: categoryStats(products),
    order_status_counts: [...orderStatus.entries()].map(([status, count]) => ({
      status,
      count,
    })),
  };
}

async function getWarehouseMap() {
  const skus = await readAll(collectionNames.skus);
  const ruas = new Map<string, AnyRecord>();

  for (const sku of skus) {
    const rua = sku.rua || "Sem rua";
    const prateleira = sku.prateleira || "Sem prateleira";
    const caixa = sku.caixa || "Sem caixa";

    if (!ruas.has(rua)) {
      ruas.set(rua, { rua, total_pecas: 0, total_skus: 0, total_caixas: 0, prateleiras: [] });
    }

    const ruaData = ruas.get(rua)!;
    ruaData.total_pecas += Number(sku.estoque_atual ?? 0);
    ruaData.total_skus += 1;

    let shelf = ruaData.prateleiras.find((item: AnyRecord) => item.prateleira === prateleira);
    if (!shelf) {
      shelf = { prateleira, caixas: [] };
      ruaData.prateleiras.push(shelf);
    }

    let box = shelf.caixas.find((item: AnyRecord) => item.caixa === caixa);
    if (!box) {
      box = { caixa, skus: [] };
      shelf.caixas.push(box);
      ruaData.total_caixas += 1;
    }
    box.skus.push(sku);
  }

  return [...ruas.values()];
}

async function getCurrentProfile() {
  const user = firebaseAuth?.currentUser;
  if (!user || !firestore) {
    throw new RouteError("Faça login para continuar.", 401);
  }

  const snapshot = await getDoc(doc(firestore, collectionNames.users, user.uid));
  if (!snapshot.exists()) {
    throw new RouteError("Usuário sem perfil ativo.", 403);
  }

  const profile = snapshot.data() as AnyRecord;
  const role = String(profile.role ?? "");
  if (!["owner", "admin", "interno", "wms", "financeiro", "suporte", "cliente"].includes(role)) {
    throw new RouteError("Perfil sem papel válido.", 403);
  }

  return {
    uid: user.uid,
    email: user.email,
    name: profile.nome ?? user.displayName ?? user.email ?? "Usuário",
    role,
    customer_code:
      profile.customer_code ??
      (profile.role === "cliente" ? DEFAULT_CUSTOMER.code : "Dutelog"),
  };
}

function matchesCustomer(row: AnyRecord, customerCode: string) {
  const rowCustomer = String(row.customer_code ?? "").trim();
  if (!rowCustomer) return customerCode === DEFAULT_CUSTOMER.code;
  return rowCustomer === customerCode;
}

function progressForOrder(order: AnyRecord) {
  const requested = Number(order.qtd_solic ?? order.requested_qty ?? 0);
  const picked = Number(order.qtd_sep ?? order.picked_qty ?? 0);
  return requested > 0 ? Math.min(100, Math.round((picked / requested) * 100)) : 0;
}

async function getClientOverview() {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const isClient = profile.role === "cliente";
  const [
    products,
    skus,
    savedBalances,
    ordersByCustomer,
    legacyOrders,
    requests,
    periods,
    inbox,
    documents,
  ] = (await Promise.all(
    isClient
      ? [
          Promise.resolve([]),
          Promise.resolve([]),
          readWhereEqual(collectionNames.clientInventory, "customer_code", customerCode),
          readWhereEqual(collectionNames.clientOrderTracking, "customer_code", customerCode),
          Promise.resolve([]),
          readWhereEqual(collectionNames.clientRequestStatus, "customer_code", customerCode),
          readWhereEqual(collectionNames.clientInvoices, "customer_code", customerCode).catch(() => []),
          Promise.resolve([]),
          readWhereEqual(collectionNames.clientDocuments, "customer_code", customerCode).catch(() => []),
        ]
      : [
          readAll(collectionNames.products),
          readAll(collectionNames.skus),
          readAll(collectionNames.stockBalances),
          readAll(collectionNames.orders),
          Promise.resolve([]),
          readAll(collectionNames.customerRequests),
          readAll(collectionNames.periods),
          readAll(collectionNames.agentInbox),
          readAll(collectionNames.documents),
        ],
  )) as AnyRecord[][];
  const orders = [
    ...ordersByCustomer,
    ...legacyOrders.filter(
      (legacyOrder) =>
        !ordersByCustomer.some(
          (order) => String(order.id) === String(legacyOrder.id),
        ),
    ),
  ];

  const balancesSource: AnyRecord[] = savedBalances.length
    ? savedBalances
    : buildDerivedStockBalances(skus);
  const balances: AnyRecord[] = balancesSource.filter((item) =>
    matchesCustomer(item, customerCode),
  );
  const customerOrders = orders.filter((order) => {
    if (order.customer_code) return matchesCustomer(order, customerCode);
    return String(order.cod_cliente ?? DEFAULT_CUSTOMER.code) === customerCode;
  });
  const customerRequests = requests.filter((request) =>
    matchesCustomer(request, customerCode),
  );
  const customerAlerts = inbox.filter((item) =>
    matchesCustomer(item, customerCode),
  );
  const customerDocuments = documents.filter((item) =>
    matchesCustomer(item, customerCode),
  );

  const totalPieces = balances.reduce<number>(
    (sum, item) => sum + Number(item.qty_on_hand ?? item.estoque_atual ?? 0),
    0,
  );
  const inventoryValueFromBalances = balances.reduce<number>(
    (sum, item) => sum + Number(item.total_cost ?? 0),
    0,
  );
  const inventoryValue =
    inventoryValueFromBalances ||
    products.reduce<number>(
      (sum, product) => sum + Number(product.custo_total ?? 0),
      0,
    );
  const byCategory = new Map<string, AnyRecord>();
  for (const balance of balances) {
    const category = String(balance.category ?? "Sem categoria");
    const current = byCategory.get(category) ?? {
      category,
      qty_on_hand: 0,
      total_cost: 0,
      sku_count: 0,
    };
    current.qty_on_hand += Number(balance.qty_on_hand ?? 0);
    current.total_cost += Number(balance.total_cost ?? 0);
    current.sku_count += 1;
    byCategory.set(category, current);
  }
  const stockByCategory = [...byCategory.values()].sort(
    (a, b) => Number(b.qty_on_hand) - Number(a.qty_on_hand),
  );
  const stockItems = [...balances]
    .sort((a, b) => Number(b.total_cost ?? 0) - Number(a.total_cost ?? 0))
    .map((item) => ({
      id: item.id,
      sku: item.sku_code,
      sku_code: item.sku_code,
      cod_sku: item.sku_code,
      client_item_code: item.client_item_code,
      name: item.product_name,
      product_name: item.product_name,
      produto: item.product_name,
      category: item.category,
      categoria: item.category,
      pieces: Number(item.qty_on_hand ?? 0),
      qty_on_hand: Number(item.qty_on_hand ?? 0),
      qty_available: Number(item.qty_available ?? item.qty_on_hand ?? 0),
      qty_reserved: Number(item.qty_reserved ?? 0),
      total_value: Number(item.total_cost ?? 0),
      total_cost: Number(item.total_cost ?? 0),
      unit_cost: Number(item.unit_cost ?? 0),
    }));
  const topItems = stockItems.slice(0, 8);

  const openOrders = customerOrders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  );
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentInvoice = periods.find((period) => period.competencia === currentPeriod);
  const openInvoices = periods.filter((period) =>
    ["aberto", "emitido"].includes(String(period.status ?? "").toLowerCase()),
  );
  const recentOrders = sortByDateDesc(customerOrders, "data_solic")
    .slice(0, 8)
    .map((order) => ({
      id: order.id,
      order_number: order.num_pedido ?? order.order_number ?? order.id,
      num_pedido: order.num_pedido ?? order.order_number ?? order.id,
      status: order.status ?? "PENDENTE",
      product_name: order.produto ?? order.product_name ?? "",
      produto: order.produto ?? order.product_name ?? "",
      requested_qty: Number(
        order.qtd_solic ?? order.requested_qty ?? order.quantity_total ?? 0,
      ),
      qtd_solic: Number(
        order.qtd_solic ?? order.requested_qty ?? order.quantity_total ?? 0,
      ),
      picked_qty: Number(order.qtd_sep ?? order.picked_qty ?? 0),
      qtd_sep: Number(order.qtd_sep ?? order.picked_qty ?? 0),
      progress: progressForOrder(order),
      canal: order.canal ?? order.channel ?? "",
      requested_at: toIso(order.requested_at ?? order.data_solic ?? order.created_at),
      data_solic: toIso(order.requested_at ?? order.data_solic ?? order.created_at),
      status_label: order.status_label,
      destination: order.destination,
      timeline: Array.isArray(order.timeline) ? order.timeline : [],
    }));
  const recentRequests = sortByDateDesc(customerRequests, "created_at").slice(0, 8);
  const invoiceItems = sortByDateDesc(periods, "competencia").slice(0, 6);
  const alertItems = sortByDateDesc(customerAlerts, "created_at").slice(0, 6);

  return {
    updated_at: new Date().toISOString(),
    customer: {
      code: customerCode,
      name: customerCode,
      role: profile.role,
    },
    inventory: {
      total_skus: balances.length || skus.length,
      total_pieces: totalPieces,
      available_pieces: balances.reduce<number>(
        (sum, item) => sum + Number(item.qty_available ?? item.qty_on_hand ?? 0),
        0,
      ),
      reserved_pieces: balances.reduce<number>(
        (sum, item) => sum + Number(item.qty_reserved ?? 0),
        0,
      ),
      low_stock_count: balances.filter(
        (item) => Number(item.qty_available ?? item.qty_on_hand ?? 0) <= 0,
      ).length,
      inventory_value: inventoryValue,
      total_value: inventoryValue,
      by_category: stockByCategory.map((item) => ({
        category: item.category,
        total_pieces: item.qty_on_hand,
        total_value: item.total_cost,
        sku_count: item.sku_count,
      })),
      items: stockItems,
      top_items: topItems,
    },
    billing: {
      current_total: Number(currentInvoice?.total ?? 0),
      open_total: openInvoices.reduce(
        (sum, period) => sum + Number(period.total ?? 0),
        0,
      ),
      overdue_total: 0,
      open_count: openInvoices.length,
      due_soon_count: 0,
      recent: invoiceItems,
    },
    orders: {
      open: openOrders.length,
      pending: customerOrders.filter(
        (order) => String(order.status ?? "").toUpperCase() === "PENDENTE",
      ).length,
      in_progress: customerOrders.filter(
        (order) => String(order.status ?? "").toUpperCase() === "SEPARACAO",
      ).length,
      shipped: customerOrders.filter((order) =>
        ["FATURADO", "ENTREGUE"].includes(String(order.status ?? "").toUpperCase()),
      ).length,
      recent: recentOrders,
    },
    requests: {
      open: customerRequests.filter((request) => request.status !== "closed").length,
      pending: customerRequests.filter((request) =>
        ["open", "pending", "submitted"].includes(String(request.status ?? "").toLowerCase()),
      ).length,
      recent: recentRequests,
    },
    metrics: {
      total_products:
        products.length ||
        new Set(balances.map((item) => item.client_item_code).filter(Boolean)).size,
      total_skus: balances.length || skus.length,
      total_pieces: totalPieces,
      inventory_value: inventoryValue,
      open_orders: openOrders.length,
      open_requests: customerRequests.filter((request) => request.status !== "closed").length,
      open_alerts: customerAlerts.filter((item) => item.status !== "resolved").length,
      documents: customerDocuments.length,
      current_invoice_total: Number(currentInvoice?.total ?? 0),
    },
    stock_by_category: stockByCategory,
    recent_orders: recentOrders,
    recent_requests: recentRequests,
    invoices: invoiceItems,
    agent_alerts: alertItems,
    alerts: alertItems,
  };
}

function defaultAgentConversationId(profile: Awaited<ReturnType<typeof getCurrentProfile>>) {
  return safeDocId(`chat_${profile.customer_code}_${profile.uid}`);
}

function localAgentDuteReply(message: string, overview: Awaited<ReturnType<typeof getClientOverview>>) {
  const metrics = overview.metrics ?? {};
  const openRequests = Number(metrics.open_requests ?? overview.requests?.open ?? 0);
  const openOrders = Number(metrics.open_orders ?? overview.orders?.open ?? 0);
  const openAlerts = Number(metrics.open_alerts ?? 0);
  const totalPieces = Number(metrics.total_pieces ?? overview.inventory?.total_pieces ?? 0);
  const totalSkus = Number(metrics.total_skus ?? overview.inventory?.total_skus ?? 0);

  return [
    "Estou consultando os dados reais disponíveis no Dute-BTG para este cliente.",
    "",
    `Resumo atual de ${overview.customer?.code ?? DEFAULT_CUSTOMER.code}:`,
    `- ${totalSkus.toLocaleString("pt-BR")} SKU(s) com saldo registrado.`,
    `- ${totalPieces.toLocaleString("pt-BR")} peça(s) totais no estoque consolidado.`,
    `- ${openRequests.toLocaleString("pt-BR")} solicitação(ões) aberta(s).`,
    `- ${openOrders.toLocaleString("pt-BR")} pedido(s) aberto(s).`,
    `- ${openAlerts.toLocaleString("pt-BR")} alerta(s) ativo(s).`,
    "",
    "Ainda não vou inventar informação fora dessas fontes. Para aprofundar, me envie o SKU, pedido, fatura, documento ou solicitação específica.",
    "",
    `Pergunta recebida: ${message}`,
  ].join("\n");
}

async function getAgentDuteChat(conversationId?: string) {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const id = conversationId ? safeDocId(conversationId) : defaultAgentConversationId(profile);
  const messages = (await readWhereEqual(collectionNames.agentMessages, "customer_code", customerCode))
    .filter((message) => String(message.conversation_id) === id)
    .sort((left, right) =>
      String(left.created_at_iso ?? "").localeCompare(String(right.created_at_iso ?? "")),
    )
    .map((message) => ({
      id: String(message.id ?? message._docId),
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
      created_at: String(message.created_at_iso ?? toIso(message.created_at)),
      source: String(message.source ?? ""),
    }));

  return {
    conversation: {
      id,
      customer_code: customerCode,
      status: "active",
    },
    messages,
  };
}

async function chatWithAgentDute(data: AnyRecord) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const message = String(data.message ?? "").trim();
  if (!message) throw new RouteError("Digite uma mensagem para o Agent Dute.", 400);

  const conversationId = data.conversation_id
    ? safeDocId(String(data.conversation_id))
    : defaultAgentConversationId(profile);
  const now = new Date().toISOString();
  const overview = await getClientOverview();
  const reply = localAgentDuteReply(message, overview);
  const userMessageId = newDocId("msg_user");
  const assistantMessageId = newDocId("msg_agent");
  const existing = await getAgentDuteChat(conversationId);

  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, collectionNames.agentConversations, conversationId),
    compactPayload({
      id: conversationId,
      customer_code: customerCode,
      user_id: profile.uid,
      user_email: profile.email,
      user_name: profile.name,
      title: message.slice(0, 90),
      status: "active",
      last_message_at: now,
      updated_at: serverTimestamp(),
      created_at: existing.messages.length ? undefined : serverTimestamp(),
    }),
    { merge: true },
  );
  batch.set(doc(firestore, collectionNames.agentMessages, userMessageId), {
    id: userMessageId,
    conversation_id: conversationId,
    customer_code: customerCode,
    user_id: profile.uid,
    role: "user",
    content: message,
    created_at_iso: now,
    created_at: serverTimestamp(),
    source: "portal_cliente",
  });
  batch.set(doc(firestore, collectionNames.agentMessages, assistantMessageId), {
    id: assistantMessageId,
    conversation_id: conversationId,
    customer_code: customerCode,
    user_id: profile.uid,
    role: "assistant",
    content: reply,
    created_at_iso: now,
    created_at: serverTimestamp(),
    source: "local_operational_context",
  });
  await batch.commit();

  await emitEvent({
    type: "customer.message_sent",
    title: "Mensagem enviada ao Agent Dute",
    description: message.slice(0, 180),
    severity: "info",
    entity_type: "agent_conversation",
    entity_id: conversationId,
    customer_code: customerCode,
    payload: {
      conversation_id: conversationId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      assistant_source: "local_operational_context",
    },
  });

  return {
    conversation: {
      id: conversationId,
      customer_code: customerCode,
      status: "active",
      last_message_at: now,
    },
    messages: [
      {
        id: userMessageId,
        role: "user",
        content: message,
        created_at: now,
        source: "portal_cliente",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: reply,
        created_at: now,
        source: "local_operational_context",
      },
    ],
  };
}

async function createCustomerRequest(data: AnyRecord) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const id = newDocId("creq");
  const description = String(data.description ?? "").trim();
  const items = normalizeRequestItems(data, description).map((item) =>
    compactPayload(item),
  );
  const requestType = String(data.type ?? "solicitacao").toLowerCase();
  const isOperationalWithdrawal =
    requestType.includes("retirada") || requestType.includes("ajuste");

  if (!description && !items.length) {
    throw new RouteError("Descreva a solicitação ou escolha um item.", 400);
  }

  if (
    isOperationalWithdrawal &&
    (!items.length || items.some((item) => !item.sku_code || Number(item.quantity ?? 0) <= 0))
  ) {
    throw new RouteError("Escolha um SKU e uma quantidade maior que zero.", 400);
  }

  const request = compactPayload({
    id,
    customer_code: customerCode,
    type: String(data.type ?? "solicitacao"),
    priority: String(data.priority ?? "normal"),
    title: String(data.title ?? data.type ?? "Solicitação do cliente"),
    description,
    destination: optionalString(data.destination ?? data.destino),
    due_at: optionalString(data.due_at ?? data.deadline),
    items,
    item_count: items.length,
    quantity_total: itemQuantityTotal(items),
    status: "open",
    requested_by: {
      uid: profile.uid ?? null,
      name: profile.name ?? "Sistema",
      email: profile.email ?? null,
    },
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });

  await setDoc(doc(firestore, collectionNames.customerRequests, id), request);
  await emitEvent({
    type: "portal.request_created",
    title: "Solicitação criada no portal",
    description: request.description || requestItemSummary(items, request.title),
    severity: request.priority === "alta" || request.priority === "urgente" ? "attention" : "info",
    entity_type: "solicitacao_cliente",
    entity_id: id,
    customer_code: customerCode,
    payload: compactPayload({
      type: request.type,
      priority: request.priority,
      item_count: items.length,
      quantity_total: request.quantity_total,
      first_sku: items[0]?.sku_code,
      requested_by: profile.email,
    }),
  });

  return { ...request, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

async function transitionCustomerRequest(id: string, action: "approve" | "reject" | "close") {
  if (!firestore) throw new Error("Firestore não configurado.");
  const db = firestore;
  const ref = doc(db, collectionNames.customerRequests, id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new RouteError("Solicitação não encontrada.", 404);

  const request: AnyRecord = { id, ...(snapshot.data() as AnyRecord) };
  const customerCode = String(request.customer_code ?? DEFAULT_CUSTOMER.code);
  const now = new Date().toISOString();
  const nextStatus =
    action === "approve" ? "approved" : action === "reject" ? "rejected" : "closed";
  const requestType = String(request.type ?? "").toLowerCase();
  const description = String(request.description ?? request.title ?? id);
  const items = normalizeRequestItems(request, description).map((item) =>
    compactPayload(item),
  );
  const quantityTotal = itemQuantityTotal(items);
  const isOutbound = requestType.includes("retirada") || requestType.includes("ajuste");
  const isInbound = requestType.includes("receb");
  let balanceRows: AnyRecord[] = [];
  const createdEntities: AnyRecord = {};

  if (action === "approve" && isOutbound) {
    if (!items.length || items.some((item) => !item.sku_code || Number(item.quantity ?? 0) <= 0)) {
      throw new RouteError("Solicitação de retirada precisa de SKU e quantidade.", 400);
    }
    const savedBalances = await readWhereEqual(
      collectionNames.stockBalances,
      "customer_code",
      customerCode,
    );
    balanceRows = savedBalances.length
      ? savedBalances
      : buildDerivedStockBalances(await readAll(collectionNames.skus)).filter(
          (balance) => String(balance.customer_code ?? DEFAULT_CUSTOMER.code) === customerCode,
        );
  }

  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    if (!currentSnapshot.exists()) {
      throw new RouteError("Solicitação não encontrada.", 404);
    }

    const current = currentSnapshot.data() as AnyRecord;
    const currentStatus = String(current.status ?? "open").toLowerCase();
    if (["approved", "rejected", "closed"].includes(currentStatus) && action !== "close") {
      throw new RouteError("Solicitação já foi decidida.", 409);
    }

    const baseId = safeDocId(id);
    const statusPayload: AnyRecord = {
      status: nextStatus,
      decided_by: currentActor(),
      decided_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };

    if (action === "approve" && isOutbound) {
      const orderId = `ord_${baseId}`;
      const orderNumber = `SOL-${baseId.slice(-8).toUpperCase()}`;
      const pickId = `pick_${safeDocId(orderId)}`;
      const productSummary = requestItemSummary(items, description);
      const reservationGroups = new Map<
        string,
        {
          ref: ReturnType<typeof doc>;
          balance: AnyRecord;
          quantity: number;
        }
      >();

      for (const item of items) {
        const balance = findBalanceForRequestItem(balanceRows, item, customerCode);
        if (!balance) {
          throw new RouteError(`Saldo não encontrado para ${item.sku_code}.`, 400);
        }
        const balanceDocId = safeDocId(String(balance._docId ?? balance.id));
        const currentGroup = reservationGroups.get(balanceDocId) ?? {
          ref: doc(db, collectionNames.stockBalances, balanceDocId),
          balance,
          quantity: 0,
        };
        currentGroup.quantity += Number(item.quantity ?? 0);
        reservationGroups.set(balanceDocId, currentGroup);
      }

      for (const [balanceDocId, group] of reservationGroups) {
        const balanceSnapshot = await transaction.get(group.ref);
        const balanceData = balanceSnapshot.exists()
          ? (balanceSnapshot.data() as AnyRecord)
          : group.balance;
        const qtyOnHand = Number(balanceData.qty_on_hand ?? group.balance.qty_on_hand ?? 0);
        const qtyReserved = Number(balanceData.qty_reserved ?? group.balance.qty_reserved ?? 0);
        const qtyAvailable = Number(
          balanceData.qty_available ?? Math.max(0, qtyOnHand - qtyReserved),
        );

        if (group.quantity > qtyAvailable) {
          throw new RouteError(
            `Saldo insuficiente para ${balanceData.sku_code ?? balanceDocId}. Disponível: ${qtyAvailable}.`,
            409,
          );
        }

        transaction.set(
          group.ref,
          {
            ...compactPayload(group.balance),
            id: group.balance.id ?? balanceDocId,
            qty_reserved: qtyReserved + group.quantity,
            qty_available: Math.max(0, qtyAvailable - group.quantity),
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
      }

      transaction.set(
        doc(db, collectionNames.orders, orderId),
        {
          id: orderId,
          customer_code: customerCode,
          cod_cliente: customerCode,
          num_pedido: orderNumber,
          canal: "Portal do cliente",
          produto: productSummary,
          qtd_solic: quantityTotal,
          qtd_sep: 0,
          status: "PENDENTE",
          item_count: items.length,
          customer_request_id: id,
          destination: request.destination ?? null,
          data_solic: now,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      transaction.set(
        doc(db, collectionNames.pickTasks, pickId),
        {
          id: pickId,
          customer_code: customerCode,
          order_id: orderId,
          order_number: orderNumber,
          status: "planned",
          priority: request.priority ?? "normal",
          total_lines: items.length,
          total_units: quantityTotal,
          picked_units: 0,
          source: "customer_request",
          customer_request_id: id,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      items.forEach((item, index) => {
        const lineNumber = index + 1;
        const lineId = `${safeDocId(orderId)}_${String(lineNumber).padStart(2, "0")}`;
        const itemPayload = {
          customer_code: customerCode,
          order_id: orderId,
          order_number: orderNumber,
          line_number: lineNumber,
          sku_code: item.sku_code,
          client_item_code: item.client_item_code ?? null,
          product_name: item.product_name ?? item.sku_code,
          location_id: item.location_id ?? null,
          requested_qty: Number(item.quantity ?? 0),
          allocated_qty: Number(item.quantity ?? 0),
          picked_qty: 0,
          status: "open",
          source: "customer_request",
          customer_request_id: id,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        };

        transaction.set(
          doc(db, collectionNames.orderItems, `oit_${lineId}`),
          { id: `oit_${lineId}`, ...itemPayload },
          { merge: true },
        );
        transaction.set(
          doc(db, collectionNames.stockReservations, `res_${lineId}`),
          {
            id: `res_${lineId}`,
            ...itemPayload,
            reserved_qty: Number(item.quantity ?? 0),
            status: "reserved",
          },
          { merge: true },
        );
        transaction.set(
          doc(db, collectionNames.pickLines, `pli_${lineId}`),
          {
            id: `pli_${lineId}`,
            customer_code: customerCode,
            pick_task_id: pickId,
            order_id: orderId,
            order_number: orderNumber,
            line_number: lineNumber,
            sku_code: item.sku_code,
            client_item_code: item.client_item_code ?? null,
            product_name: item.product_name ?? item.sku_code,
            location_id: item.location_id ?? null,
            qty_to_pick: Number(item.quantity ?? 0),
            qty_picked: 0,
            status: "open",
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
      });

      Object.assign(createdEntities, {
        order_id: orderId,
        order_number: orderNumber,
        pick_task_id: pickId,
        item_count: items.length,
        quantity_total: quantityTotal,
      });
    } else if (action === "approve" && isInbound) {
      if (!items.length) {
        throw new RouteError("Solicitação de recebimento precisa de ao menos um item.", 400);
      }
      const inboundId = `inb_${baseId}`;
      const receiptNumber = `SOL-${baseId.slice(-8).toUpperCase()}`;
      transaction.set(
        doc(db, collectionNames.inboundReceipts, inboundId),
        {
          id: inboundId,
          customer_code: customerCode,
          receipt_number: receiptNumber,
          status: "created",
          item_count: items.length,
          qty_expected: quantityTotal,
          qty_received: 0,
          customer_request_id: id,
          source: "customer_request",
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      items.forEach((item, index) => {
        const lineNumber = index + 1;
        const lineId = `${safeDocId(inboundId)}_${String(lineNumber).padStart(2, "0")}`;
        transaction.set(
          doc(db, collectionNames.inboundItems, `inbi_${lineId}`),
          {
            id: `inbi_${lineId}`,
            customer_code: customerCode,
            receipt_id: inboundId,
            receipt_number: receiptNumber,
            line_number: lineNumber,
            sku_code: item.sku_code ?? null,
            client_item_code: item.client_item_code ?? null,
            product_name: item.product_name ?? item.sku_code ?? "Item recebido",
            expected_qty: Number(item.quantity ?? 0),
            received_qty: 0,
            status: "expected",
            source: "customer_request",
            customer_request_id: id,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
      });

      Object.assign(createdEntities, {
        inbound_id: inboundId,
        receipt_number: receiptNumber,
        item_count: items.length,
        quantity_total: quantityTotal,
      });
    }

    if (Object.keys(createdEntities).length) {
      statusPayload.created_entities = createdEntities;
      statusPayload.item_count = items.length;
      statusPayload.quantity_total = quantityTotal;
    }

    transaction.set(ref, statusPayload, { merge: true });
  });

  const eventType =
    action === "approve"
      ? "customer_request.approved"
      : action === "reject"
        ? "customer_request.rejected"
        : "customer_request.closed";
  await emitEvent({
    type: eventType,
    title:
      action === "approve"
        ? "Solicitação aprovada"
        : action === "reject"
          ? "Solicitação rejeitada"
          : "Solicitação encerrada",
    description: String(request.description ?? request.title ?? id),
    severity: action === "approve" ? "attention" : "info",
    entity_type: "solicitacao_cliente",
    entity_id: id,
    customer_code: customerCode,
    payload: compactPayload({
      action,
      type: request.type,
      priority: request.priority,
      item_count: items.length,
      quantity_total: quantityTotal,
      ...createdEntities,
    }),
  });

  if (createdEntities.order_id) {
    await emitEvent({
      type: "order.created",
      title: "Pedido criado a partir do portal",
      description: String(request.description ?? request.title ?? id),
      severity: "attention",
      entity_type: "pedido",
      entity_id: createdEntities.order_id,
      customer_code: customerCode,
      payload: compactPayload({
        customer_request_id: id,
        pick_task_id: createdEntities.pick_task_id,
        item_count: createdEntities.item_count,
        quantity_total: createdEntities.quantity_total,
      }),
    });
    await emitEvent({
      type: "stock.reserved",
      title: "Estoque reservado para pedido",
      description: requestItemSummary(items, description),
      severity: "attention",
      entity_type: "reserva_estoque",
      entity_id: createdEntities.order_id,
      customer_code: customerCode,
      payload: compactPayload({
        customer_request_id: id,
        order_id: createdEntities.order_id,
        quantity_total: createdEntities.quantity_total,
      }),
    });
    await emitEvent({
      type: "picking.created",
      title: "Picking criado a partir do portal",
      description: requestItemSummary(items, description),
      severity: "attention",
      entity_type: "tarefa_picking",
      entity_id: createdEntities.pick_task_id,
      customer_code: customerCode,
      payload: compactPayload({
        customer_request_id: id,
        order_id: createdEntities.order_id,
        item_count: createdEntities.item_count,
      }),
    });
  }

  if (createdEntities.inbound_id) {
    await emitEvent({
      type: "inbound.created",
      title: "Recebimento criado a partir do portal",
      description: String(request.description ?? request.title ?? id),
      severity: "attention",
      entity_type: "recebimento",
      entity_id: createdEntities.inbound_id,
      customer_code: customerCode,
      payload: compactPayload({
        customer_request_id: id,
        item_count: createdEntities.item_count,
        quantity_total: createdEntities.quantity_total,
      }),
    });
  }

  return { ok: true, id, status: nextStatus, ...createdEntities };
}

function laneTask(input: {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  status: string;
  customer_code?: string;
  units?: number;
  priority?: string;
  source?: string;
  updated_at?: unknown;
  due_at?: unknown;
  location?: string;
  items?: AnyRecord[];
  timeline?: AnyRecord[];
  blocked_reason?: string;
  exception_count?: number;
  customer_request_id?: string;
  order_id?: string;
  inbound_id?: string;
}) {
  return {
    task_uid: `${input.type}:${input.id}`,
    id: input.id,
    type: input.type,
    title: input.title,
    subtitle: input.subtitle ?? "",
    status: input.status,
    customer_code: input.customer_code ?? DEFAULT_CUSTOMER.code,
    units: Number(input.units ?? 0),
    priority: input.priority ?? "normal",
    source: input.source ?? "firestore",
    updated_at: toIso(input.updated_at),
    due_at: toIso(input.due_at),
    location: input.location,
    items: input.items ?? [],
    timeline: input.timeline ?? [],
    blocked_reason: input.blocked_reason,
    exception_count: Number(input.exception_count ?? 0),
    customer_request_id: input.customer_request_id,
    order_id: input.order_id,
    inbound_id: input.inbound_id,
  };
}

async function getWarehouseOps() {
  const [
    skus,
    movements,
    orders,
    savedLocations,
    savedBalances,
    inboundReceipts,
    inboundItems,
    putawayTasks,
    qualityExceptions,
    orderItems,
    stockReservations,
    pickTasks,
    pickLines,
    packTasks,
    shipments,
    inbox,
  ] = (await Promise.all([
    readAll(collectionNames.skus),
    readAll(collectionNames.movements),
    readAll(collectionNames.orders),
    readAll(collectionNames.locations),
    readAll(collectionNames.stockBalances),
    readAll(collectionNames.inboundReceipts),
    readAll(collectionNames.inboundItems),
    readAll(collectionNames.putawayTasks),
    readAll(collectionNames.qualityExceptions),
    readAll(collectionNames.orderItems),
    readAll(collectionNames.stockReservations),
    readAll(collectionNames.pickTasks),
    readAll(collectionNames.pickLines),
    readAll(collectionNames.packTasks),
    readAll(collectionNames.shipments),
    readAll(collectionNames.agentInbox),
  ])) as AnyRecord[][];

  const locations: AnyRecord[] = savedLocations.length
    ? savedLocations
    : buildDerivedLocations(skus);
  const balances: AnyRecord[] = savedBalances.length
    ? savedBalances
    : buildDerivedStockBalances(skus);
  const derivedReceipts: AnyRecord[] = inboundReceipts.length
    ? inboundReceipts
    : buildDerivedInboundReceipts(movements);
  const derivedPickTasks: AnyRecord[] = pickTasks.length
    ? pickTasks
    : buildDerivedPickTasks(orders);
  const derivedPackTasks: AnyRecord[] = packTasks.length
    ? packTasks
    : buildDerivedPackTasks(orders);
  const derivedShipments: AnyRecord[] = shipments.length
    ? shipments
    : orders
        .filter((order) =>
          ["FATURADO", "ENTREGUE"].includes(String(order.status ?? "").toUpperCase()),
        )
        .map((order) => ({
          id: `ship_${safeDocId(String(order.id ?? order.num_pedido))}`,
          customer_code: DEFAULT_CUSTOMER.code,
          order_id: String(order.id),
          order_number: String(order.num_pedido ?? order.id),
          status:
            String(order.status ?? "").toUpperCase() === "ENTREGUE"
              ? "delivered"
              : "ready_to_dispatch",
          destination: order.destino ?? order.canal ?? "Destino a confirmar",
          total_units: Number(order.qtd_sep ?? order.qtd_solic ?? 0),
          source: "derived_from_orders",
        }));
  const derivedPutawayTasks: AnyRecord[] = putawayTasks.length
    ? putawayTasks
    : locations.slice(0, 12).map((location) => ({
        id: `put_${safeDocId(String(location.id))}`,
        customer_code: location.customer_code ?? DEFAULT_CUSTOMER.code,
        location_id: location.id,
        status: "completed",
        title: location.label ?? `${location.aisle}/${location.shelf}/${location.bin}`,
        total_units: Number(location.qty_on_hand ?? 0),
        source: "derived_from_locations",
      }));
  const inboundItemsByReceipt = groupByField(inboundItems, "receipt_id");
  const pickLinesByTask = groupByField(pickLines, "pick_task_id");
  const orderItemsByOrder = groupByField(orderItems, "order_id");
  const reservationsByOrder = groupByField(stockReservations, "order_id");

  const exceptionCountFor = (...ids: Array<string | undefined>) => {
    const idSet = new Set(ids.filter(Boolean).map(String));
    if (!idSet.size) return 0;
    return qualityExceptions.filter((exception) =>
      [
        exception.id,
        exception.entity_id,
        exception.receipt_id,
        exception.pick_task_id,
        exception.order_id,
        exception.customer_request_id,
      ].some((value) => value != null && idSet.has(String(value))),
    ).length;
  };

  const timelineForTask = (task: AnyRecord, createdTitle: string): AnyRecord[] =>
    ([
      task.created_at || task.received_at
        ? {
            id: `${task.id}_created`,
            title: createdTitle,
            status: "created",
            occurred_at: toIso(task.created_at ?? task.received_at),
          }
        : null,
      task.updated_at
        ? {
            id: `${task.id}_updated`,
            title: "Atualização operacional",
            status: task.status ?? "updated",
            occurred_at: toIso(task.updated_at),
          }
        : null,
    ].filter(Boolean) as AnyRecord[]);

  const receivingItemsFor = (receipt: AnyRecord) =>
    (inboundItemsByReceipt.get(String(receipt.id)) ?? []).map((item) => ({
      id: item.id,
      sku: item.sku_code,
      name: item.product_name,
      quantity: Number(item.expected_qty ?? item.quantity ?? 0),
      expected_quantity: Number(item.expected_qty ?? item.quantity ?? 0),
      picked_quantity: Number(item.received_qty ?? 0),
      status: item.status,
      location: item.location_id,
    }));

  const pickingItemsFor = (task: AnyRecord) => {
    const lines =
      pickLinesByTask.get(String(task.id)) ??
      orderItemsByOrder.get(String(task.order_id ?? "")) ??
      [];
    return lines.map((line) => ({
      id: line.id,
      sku: line.sku_code,
      name: line.product_name,
      quantity: Number(line.qty_to_pick ?? line.requested_qty ?? 0),
      expected_quantity: Number(line.qty_to_pick ?? line.requested_qty ?? 0),
      picked_quantity: Number(line.qty_picked ?? line.picked_qty ?? 0),
      status: line.status,
      location: line.location_id,
    }));
  };

  const lanes = [
    {
      id: "receiving",
      title: "Receiving",
      description: "Entradas por NF/remessa",
      items: derivedReceipts.map((receipt) => {
        const receiptItems = receivingItemsFor(receipt);
        const expectedUnits = receiptItems.length
          ? receiptItems.reduce((sum, item) => sum + Number(item.expected_quantity ?? 0), 0)
          : Number(receipt.qty_expected ?? receipt.qty_received ?? 0);
        const receivedUnits = receiptItems.length
          ? receiptItems.reduce((sum, item) => sum + Number(item.picked_quantity ?? 0), 0)
          : Number(receipt.qty_received ?? 0);
        const exceptions = exceptionCountFor(
          String(receipt.id),
          String(receipt.customer_request_id ?? ""),
        );
        return laneTask({
          id: String(receipt.id),
          type: "receiving",
          title: String(receipt.receipt_number ?? receipt.id),
          subtitle: `${receiptItems.length || Number(receipt.item_count ?? 0)} linha(s) · ${expectedUnits} un. esperadas`,
          status: String(receipt.status ?? "received"),
          customer_code: receipt.customer_code,
          units: expectedUnits || receivedUnits,
          source: receipt.source,
          updated_at: receipt.updated_at ?? receipt.received_at,
          due_at: receipt.due_at,
          items: receiptItems,
          timeline: timelineForTask(receipt, "Recebimento criado"),
          exception_count: exceptions,
          blocked_reason: exceptions ? "Há divergência de recebimento para tratar." : undefined,
          customer_request_id: receipt.customer_request_id,
          inbound_id: String(receipt.id),
        });
      }),
    },
    {
      id: "putaway",
      title: "Putaway",
      description: "Guarda e endereçamento",
      items: derivedPutawayTasks.map((task) =>
        laneTask({
          id: String(task.id),
          type: "putaway",
          title: String(task.title ?? task.location_id ?? task.id),
          subtitle: String(task.location_id ?? "Endereço físico"),
          status: String(task.status ?? "planned"),
          customer_code: task.customer_code,
          units: Number(task.total_units ?? 0),
          source: task.source,
          updated_at: task.updated_at,
          location: String(task.location_id ?? ""),
          timeline: timelineForTask(task, "Putaway criado"),
          exception_count: exceptionCountFor(String(task.id)),
        }),
      ),
    },
    {
      id: "picking",
      title: "Picking",
      description: "Separação por pedido",
      items: derivedPickTasks.map((task) => {
        const taskItems = pickingItemsFor(task);
        const reserved = reservationsByOrder.get(String(task.order_id ?? "")) ?? [];
        const totalUnits = taskItems.length
          ? taskItems.reduce((sum, item) => sum + Number(item.expected_quantity ?? 0), 0)
          : Number(task.total_units ?? 0);
        const pickedUnits = taskItems.length
          ? taskItems.reduce((sum, item) => sum + Number(item.picked_quantity ?? 0), 0)
          : Number(task.picked_units ?? 0);
        const exceptions = exceptionCountFor(
          String(task.id),
          String(task.order_id ?? ""),
          String(task.customer_request_id ?? ""),
        );
        return laneTask({
          id: String(task.id),
          type: "picking",
          title: String(task.order_number ?? task.id),
          subtitle: `${pickedUnits} / ${totalUnits} un. · ${taskItems.length || Number(task.total_lines ?? 0)} linha(s)`,
          status: String(task.status ?? "planned"),
          customer_code: task.customer_code,
          units: totalUnits,
          priority: task.priority,
          source: task.source,
          updated_at: task.updated_at,
          items: taskItems,
          timeline: timelineForTask(task, "Picking criado"),
          exception_count: exceptions,
          customer_request_id: task.customer_request_id,
          order_id: task.order_id,
          location: taskItems[0]?.location,
          due_at: task.due_at,
          blocked_reason:
            exceptions
              ? "Há exceção aberta para este picking."
              : reserved.length && !taskItems.length
                ? "Reserva existe, mas nenhuma linha de picking foi criada."
                : undefined,
        });
      }),
    },
    {
      id: "packing",
      title: "Packing",
      description: "Conferência e volumes",
      items: derivedPackTasks.map((task) =>
        laneTask({
          id: String(task.id),
          type: "packing",
          title: String(task.order_number ?? task.id),
          subtitle: `${Number(task.packed_units ?? 0)} un. separadas`,
          status: String(task.status ?? "ready"),
          customer_code: task.customer_code,
          units: Number(task.packed_units ?? 0),
          source: task.source,
          updated_at: task.updated_at,
          timeline: timelineForTask(task, "Packing criado"),
          exception_count: exceptionCountFor(String(task.id), String(task.order_id ?? "")),
          order_id: task.order_id,
        }),
      ),
    },
    {
      id: "shipping",
      title: "Expedição",
      description: "Despacho e entrega",
      items: derivedShipments.map((task) =>
        laneTask({
          id: String(task.id),
          type: "shipping",
          title: String(task.order_number ?? task.id),
          subtitle: String(task.destination ?? "Destino a confirmar"),
          status: String(task.status ?? "ready_to_dispatch"),
          customer_code: task.customer_code,
          units: Number(task.total_units ?? 0),
          source: task.source,
          updated_at: task.updated_at,
          location: String(task.destination ?? ""),
          timeline: timelineForTask(task, "Expedição criada"),
          exception_count: exceptionCountFor(String(task.id), String(task.order_id ?? "")),
          order_id: task.order_id,
        }),
      ),
    },
  ];

  const allTasks = lanes.flatMap((lane) => lane.items);
  const activeTasks = allTasks.filter(
    (task) => !["completed", "delivered", "received"].includes(task.status),
  );
  const totalUnits = balances.reduce<number>(
    (sum, item) => sum + Number(item.qty_on_hand ?? 0),
    0,
  );

  return {
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metrics: {
      pending_total: activeTasks.length,
      due_soon: 0,
      critical: inbox.filter((item) => item.priority === "critical").length,
      throughput_today: allTasks.filter((task) =>
        ["completed", "delivered", "received"].includes(String(task.status)),
      ).length,
      avg_sla_minutes: 180,
      lanes: lanes.length,
      active_tasks: activeTasks.length,
      total_tasks: allTasks.length,
      locations: locations.length,
      stock_balances: balances.length,
      total_units: totalUnits,
      agent_alerts: inbox.filter((item) => item.status !== "resolved").length,
    },
    lanes,
    queues: Object.fromEntries(
      lanes.map((lane) => {
        const queueKey = lane.id === "shipping" ? "expedition" : lane.id;
        const tasks = lane.items.slice(0, 12).map((task) => ({
          id: task.task_uid,
          title: task.title,
          reference: task.id,
          sku: task.items[0]?.sku ?? task.subtitle,
          customer: task.customer_code,
          location: task.location || task.items[0]?.location || (task.type === "putaway" ? task.subtitle : undefined),
          quantity: task.units,
          priority: task.priority,
          status: task.status,
          due_at: task.due_at || task.updated_at || undefined,
          next_action:
            task.status === "completed" || task.status === "delivered" || task.status === "received"
              ? "Fluxo registrado. Acompanhar documentação e billing."
              : "Avançar para a próxima etapa operacional.",
          notes: task.blocked_reason
            ? task.blocked_reason
            : task.source === "derived_from_orders" || task.source === "derived_from_skus"
              ? "Tarefa derivada dos dados atuais até virar operação nativa."
              : task.items.length
                ? `${task.items.length} linha(s) operacionais vinculadas.`
                : undefined,
          blocked_reason: task.blocked_reason,
          exception_count: task.exception_count,
          items: task.items,
          timeline: task.timeline,
          customer_request_id: task.customer_request_id,
          can_advance:
            !String(task.source ?? "").startsWith("derived_from_") &&
            !["completed", "delivered", "received"].includes(String(task.status)),
          progress:
            task.status === "completed" || task.status === "delivered" || task.status === "received"
              ? 100
              : task.status === "in_progress" || task.status === "dispatched"
                ? 55
                : 15,
        }));
        return [
          queueKey,
          {
            key: queueKey,
            name: lane.title,
            pending: tasks.filter(
              (task) => !["completed", "delivered", "received"].includes(String(task.status)),
            ).length,
            in_progress: tasks.filter((task) =>
              ["in_progress", "checking", "dispatched"].includes(String(task.status)),
            ).length,
            completed_today: tasks.filter((task) =>
              ["completed", "delivered", "received"].includes(String(task.status)),
            ).length,
            sla_minutes: 180,
            utilization: tasks.length
              ? (tasks.filter((task) =>
                  ["completed", "delivered", "received"].includes(String(task.status)),
                ).length /
                  tasks.length) *
                100
              : 0,
            next_action: lane.items[0]
              ? "Executar a primeira tarefa pendente da fila."
              : "Fila limpa no momento.",
            tasks,
          },
        ];
      }),
    ),
    alerts: sortByDateDesc(
      inbox.filter((item) => item.status !== "resolved").map(insightView),
      "created_at",
    ).slice(0, 8),
    agent_summary: activeTasks.length
      ? `${activeTasks.length} tarefa(s) ainda precisam de avanço operacional.`
      : "Filas sem pendências críticas neste momento.",
  };
}

function nextTaskStatus(type: string, status: string) {
  const normalized = status.toLowerCase();
  const flows: Record<string, string[]> = {
    receiving: ["created", "checking", "received"],
    putaway: ["planned", "in_progress", "completed"],
    picking: ["planned", "in_progress", "completed"],
    packing: ["ready", "in_progress", "completed"],
    shipping: ["ready_to_dispatch", "dispatched", "delivered"],
  };
  const flow = flows[type] ?? ["planned", "in_progress", "completed"];
  const index = flow.indexOf(normalized);
  return flow[Math.min(index < 0 ? 1 : index + 1, flow.length - 1)];
}

async function registerWarehouseException(taskUid: string, data: AnyRecord = {}) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const db = firestore;
  const [type, ...idParts] = taskUid.split(":");
  const id = idParts.join(":");
  if (!type || !id) throw new RouteError("Tarefa inválida.", 400);

  const name = warehouseTaskCollection(type);
  if (!name) throw new RouteError("Tipo de tarefa não suportado.", 400);

  const ref = doc(db, name, safeDocId(id));
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new RouteError("Tarefa operacional não encontrada.", 404);
  }

  const task = snapshot.data() as AnyRecord;
  const note =
    optionalString(data.note ?? data.description ?? data.reason) ??
    optionalString(task.blocked_reason) ??
    "Exceção registrada na bancada WMS.";
  const severity: EventSeverity =
    data.severity === "critical" || task.priority === "critical" || task.blocked_reason
      ? "critical"
      : "attention";
  const exceptionId = newDocId("wex");
  const customerCode = String(task.customer_code ?? task.customer ?? DEFAULT_CUSTOMER.code);
  const batch = writeBatch(db);

  batch.set(
    doc(db, collectionNames.qualityExceptions, safeDocId(exceptionId)),
    compactPayload({
      id: exceptionId,
      task_uid: taskUid,
      task_type: type,
      task_id: id,
      task_collection: name,
      customer_code: customerCode,
      order_id: task.order_id,
      order_number: task.order_number,
      receipt_id: type === "receiving" ? id : task.receipt_id,
      reference: task.reference ?? task.order_number ?? task.receipt_number,
      note,
      severity,
      status: "open",
      source: data.source ?? "warehouse_ops",
      payload: data.payload ?? {},
      created_by: currentActor(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }),
  );

  batch.set(
    ref,
    {
      exception_count: Number(task.exception_count ?? 0) + 1,
      blocked_reason: note,
      last_exception_id: exceptionId,
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();

  const event = await emitEvent({
    type: `${type}.exception_found`,
    title: "Exceção operacional registrada",
    description: note,
    severity,
    entity_type: collectionLabel(name),
    entity_id: id,
    customer_code: customerCode,
    payload: compactPayload({
      exception_id: exceptionId,
      task_uid: taskUid,
      status: task.status,
      order_id: task.order_id,
      receipt_id: type === "receiving" ? id : task.receipt_id,
      customer_request_id: task.customer_request_id,
    }),
  });

  return {
    ok: true,
    exception_id: exceptionId,
    event_id: event?.id,
    task_uid: taskUid,
  };
}

async function advanceWarehouseTask(taskUid: string) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const db = firestore;
  const [type, ...idParts] = taskUid.split(":");
  const id = idParts.join(":");
  if (!type || !id) throw new RouteError("Tarefa inválida.", 400);

  const name = warehouseTaskCollection(type);
  if (!name) throw new RouteError("Tipo de tarefa não suportado.", 400);

  const ref = doc(db, name, safeDocId(id));
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new RouteError("Tarefa operacional não encontrada.", 404);
  }
  const before = snapshot.data() as AnyRecord;
  if (isTerminalWarehouseTask(type, before.status)) {
    throw new RouteError("Tarefa operacional já finalizada.", 409);
  }
  const nextStatus = nextTaskStatus(type, String(before.status ?? ""));
  const batch = writeBatch(db);
  const createdEntities: AnyRecord = {};
  const lineUpdates: AnyRecord = {};
  let stockConsumed = 0;

  batch.set(
    ref,
    {
      id,
      status: nextStatus,
      advanced_by: currentActor(),
      advanced_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );

  if (type === "receiving" && nextStatus === "received") {
    const customerCode = String(before.customer_code ?? DEFAULT_CUSTOMER.code);
    const [items, balancesForCustomer] = await Promise.all([
      readWhereEqual(collectionNames.inboundItems, "receipt_id", id),
      readWhereEqual(collectionNames.stockBalances, "customer_code", customerCode),
    ]);
    const balanceStates = new Map<
      string,
      {
        balance: AnyRecord;
        qtyOnHand: number;
        qtyReserved: number;
      }
    >();
    const receivedQty = items.reduce(
      (sum, item) => sum + Number(item.expected_qty ?? item.received_qty ?? 0),
      0,
    );

    for (const item of items) {
      const quantity = Number(item.expected_qty ?? item.received_qty ?? 0);
      const locationId = optionalString(
        item.location_id ?? before.location_id ?? before.receiving_location,
      ) ?? "RECEBIMENTO";
      const stockItem: AnyRecord = {
        ...item,
        location_id: locationId,
      };
      const matchedBalance =
        findBalanceForRequestItem(balancesForCustomer, stockItem, customerCode) ??
        findBalanceForRequestItem(
          balancesForCustomer,
          { ...stockItem, location_id: undefined },
          customerCode,
        );
      const balanceDocId = safeDocId(
        String(matchedBalance?._docId ?? matchedBalance?.id ?? stockBalanceDocId(customerCode, stockItem)),
      );
      const state =
        balanceStates.get(balanceDocId) ??
        {
          balance: matchedBalance ?? {},
          qtyOnHand: Number(matchedBalance?.qty_on_hand ?? 0),
          qtyReserved: Number(matchedBalance?.qty_reserved ?? 0),
        };
      const beforeQty = state.qtyOnHand;
      const afterQty = beforeQty + quantity;
      state.qtyOnHand = afterQty;
      balanceStates.set(balanceDocId, state);

      batch.set(
        doc(db, collectionNames.inboundItems, safeDocId(String(item._docId ?? item.id))),
        {
          received_qty: quantity,
          location_id: locationId,
          status: "received",
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );

      if (quantity > 0) {
        batch.set(
          doc(db, collectionNames.stockBalances, balanceDocId),
          compactPayload({
            ...state.balance,
            id: state.balance.id ?? balanceDocId,
            customer_code: customerCode,
            sku_code: stockItem.sku_code ?? state.balance.sku_code,
            client_item_code: stockItem.client_item_code ?? state.balance.client_item_code,
            product_name: stockItem.product_name ?? state.balance.product_name,
            location_id: locationId,
            qty_on_hand: afterQty,
            qty_reserved: state.qtyReserved,
            qty_available: Math.max(0, afterQty - state.qtyReserved),
            unit_cost: Number(stockItem.unit_cost ?? state.balance.unit_cost ?? 0),
            status: afterQty > 0 ? "available" : "empty",
            source: "wms_receiving",
            updated_at: serverTimestamp(),
          }),
          { merge: true },
        );

        const movement = buildMovementPayload({
          type: "ENTRADA",
          sign: 1,
          quantity,
          item: stockItem,
          customerCode,
          productName: stockItem.product_name,
          beforeQty,
          afterQty,
          source: "wms_receiving",
          entity: {
            receipt_id: id,
            receipt_number: before.receipt_number,
            inbound_item_id: item.id,
            destino: locationId,
          },
        });
        batch.set(doc(db, collectionNames.movements, safeDocId(String(movement.id))), movement);
      }
    }

    batch.set(
      ref,
      {
        item_count: items.length || Number(before.item_count ?? 0),
        qty_received: receivedQty || Number(before.qty_received ?? 0),
        received_at: serverTimestamp(),
      },
      { merge: true },
    );
    lineUpdates.received_lines = items.length;
    lineUpdates.received_qty = receivedQty;
  }

  if (type === "picking" && nextStatus === "completed") {
    const orderId = String(before.order_id ?? "").trim();
    const [pickLinesForTask, orderItemsForOrder, reservationsForOrder] = await Promise.all([
      readWhereEqual(collectionNames.pickLines, "pick_task_id", id),
      orderId ? readWhereEqual(collectionNames.orderItems, "order_id", orderId) : Promise.resolve([]),
      orderId
        ? readWhereEqual(collectionNames.stockReservations, "order_id", orderId)
        : Promise.resolve([]),
    ]);
    const pickedUnits = pickLinesForTask.length
      ? pickLinesForTask.reduce((sum, line) => sum + Number(line.qty_to_pick ?? 0), 0)
      : Number(before.total_units ?? 0);

    for (const line of pickLinesForTask) {
      batch.set(
        doc(db, collectionNames.pickLines, safeDocId(String(line._docId ?? line.id))),
        {
          qty_picked: Number(line.qty_to_pick ?? line.qty_picked ?? 0),
          status: "completed",
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const item of orderItemsForOrder) {
      batch.set(
        doc(db, collectionNames.orderItems, safeDocId(String(item._docId ?? item.id))),
        {
          picked_qty: Number(item.requested_qty ?? item.allocated_qty ?? item.picked_qty ?? 0),
          status: "picked",
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
    }

    for (const reservation of reservationsForOrder) {
      batch.set(
        doc(db, collectionNames.stockReservations, safeDocId(String(reservation._docId ?? reservation.id))),
        {
          status: "picked",
          picked_qty: Number(reservation.reserved_qty ?? reservation.requested_qty ?? 0),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (orderId) {
      const packId = `pack_${safeDocId(orderId)}`;
      batch.set(
        doc(db, collectionNames.orders, safeDocId(orderId)),
        {
          status: "SEPARACAO",
          qtd_sep: pickedUnits,
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      batch.set(
        doc(db, collectionNames.packTasks, packId),
        {
          id: packId,
          customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
          order_id: orderId,
          order_number: before.order_number ?? null,
          status: "ready",
          picked_units: pickedUnits,
          packed_units: 0,
          package_count: 0,
          source: "picking_completed",
          customer_request_id: before.customer_request_id ?? null,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      createdEntities.pack_task_id = packId;
    }

    batch.set(ref, { picked_units: pickedUnits }, { merge: true });
    lineUpdates.picked_lines = pickLinesForTask.length;
    lineUpdates.picked_units = pickedUnits;
  }

  if (type === "packing" && nextStatus === "completed") {
    const orderId = String(before.order_id ?? "").trim();
    const packedUnits = Number(before.picked_units ?? before.packed_units ?? before.total_units ?? 0);
    const packageId = `pkg_${safeDocId(id)}_001`;
    const orderItemsForOrder = orderId
      ? await readWhereEqual(collectionNames.orderItems, "order_id", orderId)
      : [];
    batch.set(
      doc(db, collectionNames.packages, packageId),
      {
        id: packageId,
        customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
        pack_task_id: id,
        order_id: orderId || null,
        order_number: before.order_number ?? null,
        status: "packed",
        volume_number: 1,
        packed_units: packedUnits,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );

    let shipmentId = "";
    if (orderId) {
      shipmentId = `ship_${safeDocId(orderId)}`;
      batch.set(
        doc(db, collectionNames.shipments, shipmentId),
        {
          id: shipmentId,
          customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
          order_id: orderId,
          order_number: before.order_number ?? null,
          status: "ready_to_dispatch",
          destination: before.destination ?? "Destino a confirmar",
          total_units: packedUnits,
          source: "packing_completed",
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      createdEntities.package_id = packageId;
      createdEntities.shipment_id = shipmentId;
    }

    orderItemsForOrder.forEach((item, index) => {
      const quantity = Number(item.picked_qty ?? item.allocated_qty ?? item.requested_qty ?? 0);
      if (quantity <= 0) return;
      const lineNumber = Number(item.line_number ?? index + 1);
      const lineId = `${safeDocId(packageId)}_${String(lineNumber).padStart(2, "0")}`;
      const linePayload = compactPayload({
        customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
        order_id: orderId,
        order_number: before.order_number ?? item.order_number,
        package_id: packageId,
        shipment_id: shipmentId || undefined,
        line_number: lineNumber,
        sku_code: item.sku_code,
        client_item_code: item.client_item_code,
        product_name: item.product_name,
        qty_packed: quantity,
        status: "packed",
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      batch.set(
        doc(db, collectionNames.packageItems, `pki_${lineId}`),
        { id: `pki_${lineId}`, ...linePayload },
        { merge: true },
      );
      if (shipmentId) {
        batch.set(
          doc(db, collectionNames.shipmentItems, `shi_${safeDocId(shipmentId)}_${String(lineNumber).padStart(2, "0")}`),
          {
            id: `shi_${safeDocId(shipmentId)}_${String(lineNumber).padStart(2, "0")}`,
            ...linePayload,
            status: "ready_to_dispatch",
          },
          { merge: true },
        );
      }
    });

    batch.set(
      ref,
      {
        packed_units: packedUnits,
        package_count: Math.max(1, Number(before.package_count ?? 1)),
      },
      { merge: true },
    );
    lineUpdates.packed_units = packedUnits;
  }

  if (type === "shipping" && nextStatus === "delivered") {
    const orderId = String(before.order_id ?? "").trim();
    if (orderId) {
      const [reservationsForOrder, balancesForCustomer] = await Promise.all([
        readWhereEqual(collectionNames.stockReservations, "order_id", orderId),
        readWhereEqual(
          collectionNames.stockBalances,
          "customer_code",
          String(before.customer_code ?? DEFAULT_CUSTOMER.code),
        ),
      ]);

      for (const reservation of reservationsForOrder) {
        if (String(reservation.status ?? "") === "consumed") continue;
        const quantity = Number(reservation.reserved_qty ?? reservation.requested_qty ?? 0);
        if (quantity <= 0) continue;

        const balance = findBalanceForRequestItem(
          balancesForCustomer,
          {
            sku_code: reservation.sku_code,
            client_item_code: reservation.client_item_code,
            location_id: reservation.location_id,
          },
          String(before.customer_code ?? DEFAULT_CUSTOMER.code),
        );

        if (balance) {
          const previousOnHand = Number(balance.qty_on_hand ?? 0);
          const nextOnHand = Math.max(0, previousOnHand - quantity);
          const nextReserved = Math.max(0, Number(balance.qty_reserved ?? 0) - quantity);
          batch.set(
            doc(db, collectionNames.stockBalances, safeDocId(String(balance._docId ?? balance.id))),
            {
              qty_on_hand: nextOnHand,
              qty_reserved: nextReserved,
              qty_available: Math.max(0, nextOnHand - nextReserved),
              status: nextOnHand > 0 ? "available" : "empty",
              updated_at: serverTimestamp(),
            },
            { merge: true },
          );
          const movement = buildMovementPayload({
            type: "SAIDA",
            sign: -1,
            quantity,
            item: reservation,
            customerCode: String(before.customer_code ?? DEFAULT_CUSTOMER.code),
            productName: reservation.product_name,
            beforeQty: previousOnHand,
            afterQty: nextOnHand,
            source: "wms_shipping",
            entity: {
              order_id: orderId,
              order_number: before.order_number,
              shipment_id: id,
              origem: reservation.location_id,
              destino: before.destination,
            },
          });
          batch.set(doc(db, collectionNames.movements, safeDocId(String(movement.id))), movement);
        }

        batch.set(
          doc(db, collectionNames.stockReservations, safeDocId(String(reservation._docId ?? reservation.id))),
          {
            status: "consumed",
            consumed_qty: quantity,
            consumed_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
        stockConsumed += quantity;
      }

      batch.set(
        doc(db, collectionNames.orders, safeDocId(orderId)),
        {
          status: "ENTREGUE",
          delivered_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
    }

    batch.set(ref, { delivered_at: serverTimestamp() }, { merge: true });
  }

  await batch.commit();

  const eventTypeByTask: Record<string, string> = {
    receiving: nextStatus === "received" ? "inbound.checked" : "inbound.created",
    putaway: nextStatus === "completed" ? "putaway.completed" : "putaway.created",
    picking: nextStatus === "completed" ? "picking.completed" : "picking.started",
    packing: nextStatus === "completed" ? "packing.completed" : "packing.started",
    shipping: nextStatus === "delivered" ? "shipment.delivered" : "shipment.dispatched",
  };

  await emitEvent({
    type: eventTypeByTask[type] ?? `${type}.advanced`,
    title: "Tarefa operacional avançada",
    description: `${type} ${id} avançou para ${nextStatus}`,
    severity: nextStatus === "completed" || nextStatus === "delivered" || nextStatus === "received" ? "info" : "attention",
    entity_type: collectionLabel(name),
    entity_id: id,
    customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
    payload: compactPayload({
      before_status: before.status,
      after_status: nextStatus,
      type,
      ...lineUpdates,
      ...createdEntities,
      stock_consumed: stockConsumed || undefined,
    }),
  });

  if (createdEntities.pack_task_id) {
    await emitEvent({
      type: "packing.created",
      title: "Packing criado após picking",
      description: `${before.order_number ?? before.order_id ?? id} pronto para conferência.`,
      severity: "attention",
      entity_type: "tarefa_packing",
      entity_id: createdEntities.pack_task_id,
      customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
      payload: compactPayload({
        pick_task_id: id,
        order_id: before.order_id,
        picked_units: lineUpdates.picked_units,
      }),
    });
  }

  if (createdEntities.shipment_id) {
    await emitEvent({
      type: "shipment.created",
      title: "Expedição criada após packing",
      description: `${before.order_number ?? before.order_id ?? id} pronto para despacho.`,
      severity: "attention",
      entity_type: "expedicao",
      entity_id: createdEntities.shipment_id,
      customer_code: before.customer_code ?? DEFAULT_CUSTOMER.code,
      payload: compactPayload({
        pack_task_id: id,
        package_id: createdEntities.package_id,
        order_id: before.order_id,
        packed_units: lineUpdates.packed_units,
      }),
    });
  }

  return { ok: true, task_uid: taskUid, status: nextStatus, ...createdEntities };
}

async function readOperationalFoundationInput() {
  const [
    customers,
    customerAccounts,
    locations,
    stockBalances,
    inboundReceipts,
    orderItems,
    pickTasks,
    packTasks,
    shipments,
    documents,
    skus,
    movements,
    orders,
    users,
  ] = await Promise.all([
    readAll(collectionNames.customers),
    readAll(collectionNames.customerAccounts),
    readAll(collectionNames.locations),
    readAll(collectionNames.stockBalances),
    readAll(collectionNames.inboundReceipts),
    readAll(collectionNames.orderItems),
    readAll(collectionNames.pickTasks),
    readAll(collectionNames.packTasks),
    readAll(collectionNames.shipments),
    readAll(collectionNames.documents),
    readAll(collectionNames.skus),
    readAll(collectionNames.movements),
    readAll(collectionNames.orders),
    readAll(collectionNames.users),
  ]);

  return {
    customers,
    customerAccounts,
    locations,
    stockBalances,
    inboundReceipts,
    orderItems,
    pickTasks,
    packTasks,
    shipments,
    documents,
    skus,
    movements,
    orders,
    users,
  };
}

async function getOperationalFoundation() {
  return buildOperationalFoundationSnapshot(await readOperationalFoundationInput());
}

async function commitOperationalRecords(name: string, records: AnyRecord[]) {
  if (!firestore) throw new Error("Firestore não configurado.");
  if (records.length === 0) return { collection: name, count: 0, batches: 0 };

  let batch = writeBatch(firestore);
  let pendingWrites = 0;
  let batches = 0;

  for (const record of records) {
    const id = safeDocId(String(record._docId ?? record.id ?? newDocId("sync")));
    batch.set(
      doc(firestore, name, id),
      {
        ...record,
        id: record.id ?? id,
        updated_at: serverTimestamp(),
        synced_at: serverTimestamp(),
      },
      { merge: true },
    );
    pendingWrites += 1;

    if (pendingWrites >= 450) {
      await batch.commit();
      batches += 1;
      batch = writeBatch(firestore);
      pendingWrites = 0;
    }
  }

  if (pendingWrites > 0) {
    await batch.commit();
    batches += 1;
  }

  return { collection: name, count: records.length, batches };
}

async function syncRealOperationalFoundation() {
  const input = await readOperationalFoundationInput();
  const customer = {
    id: DEFAULT_CUSTOMER.id,
    code: DEFAULT_CUSTOMER.code,
    name: DEFAULT_CUSTOMER.name,
    status: "active",
    source: "derived_from_real_btg_operation",
  };
  const customerAccounts = buildDerivedCustomerAccounts(input.users);
  const locations = buildDerivedLocations(input.skus);
  const stockBalances = buildDerivedStockBalances(input.skus);
  const inboundReceipts = buildDerivedInboundReceipts(input.movements);
  const orderItems = buildDerivedOrderItems(input.orders);
  const pickTasks = buildDerivedPickTasks(input.orders);
  const packTasks = buildDerivedPackTasks(input.orders);

  const writes = await Promise.all([
    commitOperationalRecords(collectionNames.customers, [customer]),
    commitOperationalRecords(collectionNames.customerAccounts, customerAccounts),
    commitOperationalRecords(collectionNames.locations, locations),
    commitOperationalRecords(collectionNames.stockBalances, stockBalances),
    commitOperationalRecords(collectionNames.inboundReceipts, inboundReceipts),
    commitOperationalRecords(collectionNames.orderItems, orderItems),
    commitOperationalRecords(collectionNames.pickTasks, pickTasks),
    commitOperationalRecords(collectionNames.packTasks, packTasks),
  ]);

  const inserted = writes.reduce((sum, item) => sum + item.count, 0);
  await emitEvent({
    type: "foundation.real_data_synced",
    title: "Coleções operacionais preparadas",
    description: `${inserted.toLocaleString("pt-BR")} registro(s) derivados da operação BTG foram sincronizados para a fundação operacional.`,
    severity: "attention",
    entity_type: "fundacao_operacional",
    entity_id: DEFAULT_CUSTOMER.id,
    customer_code: DEFAULT_CUSTOMER.code,
    payload: compactPayload({
      customer_accounts: customerAccounts.length,
      locations: locations.length,
      stock_balances: stockBalances.length,
      inbound_receipts: inboundReceipts.length,
      order_items: orderItems.length,
      pick_tasks: pickTasks.length,
      pack_tasks: packTasks.length,
    }),
  });

  return {
    ok: true,
    writes,
    snapshot: await getOperationalFoundation(),
  };
}

async function getBillingConfig() {
  if (!firestore) throw new Error("Firestore não configurado.");
  const ref = doc(firestore, "billing_config", "default");
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return { id: 1, ...snapshot.data() };
  return {
    id: 1,
    cliente_nome: "BTG Pactual",
    cliente_email: "",
    ad_valorem_rate: 0.005,
  };
}

async function getBillingPeriod(competencia: string) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const periodRef = doc(firestore, collectionNames.periods, competencia);
  const periodSnapshot = await getDoc(periodRef);
  const saved = periodSnapshot.exists() ? periodSnapshot.data() : {};
  const config = await getBillingConfig();
  const [products, movements, priceList, manualSnapshot] = await Promise.all([
    readAll(collectionNames.products),
    readAll(collectionNames.movements),
    readAll(collectionNames.priceList),
    getDoc(doc(firestore, collectionNames.manual, competencia)),
  ]);

  const manual = manualSnapshot.exists() ? manualSnapshot.data().items ?? [] : [];
  const custoEstoque = products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0);
  const saidas = movements
    .filter((mov) => toIso(mov.data).startsWith(competencia))
    .filter((mov) => Number(mov.sinal ?? 0) < 0)
    .reduce((sum, mov) => sum + Number(mov.qtde ?? 0), 0);

  const itens = priceList
    .filter((item) => item.ativo !== false)
    .map((item) => {
      const manualItem = manual.find((entry: AnyRecord) => entry.price_list_id === item.id);
      const autoSource = item.auto_source;
      const qtde =
        autoSource === "ad_valorem"
          ? custoEstoque
          : autoSource === "mov_saida_pecas"
            ? saidas
            : Number(manualItem?.qtde ?? 0);
      const valorUnit =
        autoSource === "ad_valorem"
          ? Number(config.ad_valorem_rate ?? 0.005)
          : Number(item.valor_unit ?? 0);
      return {
        price_list_id: item.id,
        item: item.item,
        unidade: item.unidade,
        qtde,
        valor_unit: valorUnit,
        total: qtde * valorUnit,
        observacao: manualItem?.observacao ?? "",
        auto: Boolean(autoSource),
      };
    });

  const gruposMap = new Map<string, AnyRecord>();
  for (const item of itens) {
    const price = priceList.find((entry) => entry.id === item.price_list_id);
    const grupo = price?.grupo || "outros";
    const group = gruposMap.get(grupo) ?? {
      grupo,
      label: grupo.replace(/_/g, " "),
      total: 0,
      itens: [],
    };
    group.total += item.total;
    group.itens.push(item);
    gruposMap.set(grupo, group);
  }

  return {
    competencia,
    status: saved.status ?? "aberto",
    custo_estoque: custoEstoque,
    ad_valorem_rate: Number(config.ad_valorem_rate ?? 0.005),
    grupos: [...gruposMap.values()],
    total: [...gruposMap.values()].reduce((sum, group) => sum + group.total, 0),
    emitido_em: saved.emitido_em ?? null,
    email_enviado_em: saved.email_enviado_em ?? null,
    pago_em: saved.pago_em ?? null,
  };
}

function sortByDateDesc(items: AnyRecord[], field: string) {
  return [...items].sort((a, b) => toIso(b[field]).localeCompare(toIso(a[field])));
}

function eventView(event: AnyRecord) {
  return {
    ...event,
    occurred_at: toIso(event.occurred_at) || event.occurred_at || "",
    created_at: toIso(event.created_at) || event.created_at || "",
  };
}

function insightView(insight: AnyRecord) {
  return {
    ...insight,
    created_at: toIso(insight.created_at) || insight.created_at || "",
    updated_at: toIso(insight.updated_at) || insight.updated_at || "",
  };
}

function memoryView(memory: AnyRecord) {
  return {
    ...memory,
    updated_at: toIso(memory.updated_at) || memory.updated_at || "",
  };
}

function knowledgeMemoryView(item: AnyRecord) {
  return {
    id: `knowledge_${item.id ?? item._docId}`,
    scope_type: "knowledge",
    scope_id: item.document_type ?? item.id ?? "documento",
    title: item.title ?? item.file_name ?? "Documento de conhecimento",
    event_count: Number(item.chunk_count ?? item.pages ?? 1),
    last_event_title:
      item.summary ??
      item.source_file_name ??
      "Documento real na base de conhecimento do Agent Dute",
    last_event_at: toIso(item.ingested_at) || item.ingested_at || "",
    summary:
      item.summary ??
      `Documento real vinculado ao cliente ${item.customer_code ?? "BTG Pactual"}.`,
  };
}

function derivedEventFromMovement(movement: AnyRecord) {
  const positive = Number(movement.sinal ?? 0) > 0;
  return {
    id: `derived_movement_${movement.id}`,
    type: positive ? "inventory.received" : "inventory.shipped",
    title: positive ? "Produto recebido no estoque" : "Produto saiu do estoque",
    description: `${Number(movement.qtde ?? 0).toLocaleString("pt-BR")} un. de ${movement.produto || movement.cod_sku}`,
    severity: "info",
    source: "derived_from_existing_data",
    entity_type: "movimentacao",
    entity_id: String(movement.id),
    customer_code: movement.cod_cliente ?? null,
    payload: compactPayload({
      cod_sku: movement.cod_sku,
      tipo_mov: movement.tipo_mov,
      doc_nf: movement.doc_nf,
      responsavel: movement.responsavel,
    }),
    occurred_at: toIso(movement.data),
  };
}

function deriveAgentInsights({
  products,
  skus,
  orders,
  periods,
  movements,
}: {
  products: AnyRecord[];
  skus: AnyRecord[];
  orders: AnyRecord[];
  periods: AnyRecord[];
  movements: AnyRecord[];
}) {
  const missingCostProducts = products.filter(
    (product) =>
      Number(product.estoque_btg ?? 0) > 0 &&
      (Number(product.preco_unit ?? 0) <= 0 || Number(product.custo_total ?? 0) <= 0),
  );
  const openOrders = orders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  );
  const zeroStockSkus = skus.filter((sku) => Number(sku.estoque_atual ?? 0) <= 0);
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentBilling = periods.find((period) => period.competencia === currentPeriod);
  const latestMovement = sortByDateDesc(movements, "data")[0];

  return [
    missingCostProducts.length
      ? {
          id: "derived_missing_costs",
          title: "Produtos com custo pendente",
          message: `${missingCostProducts.length} produto(s) com estoque ainda sem custo válido. Isso afeta Ad Valorem e relatórios financeiros.`,
          priority: "high",
          status: "open",
          entity_type: "produto",
          entity_id: null,
          customer_code: "BTG Pactual",
          created_at: new Date().toISOString(),
        }
      : null,
    openOrders.length
      ? {
          id: "derived_open_orders",
          title: "Pedidos em andamento",
          message: `${openOrders.length} pedido(s) ainda em status operacional. O agente deve acompanhar separação, expedição e faturamento.`,
          priority: "normal",
          status: "open",
          entity_type: "pedido",
          entity_id: null,
          customer_code: "BTG Pactual",
          created_at: new Date().toISOString(),
        }
      : null,
    zeroStockSkus.length
      ? {
          id: "derived_zero_stock",
          title: "SKUs zerados",
          message: `${zeroStockSkus.length} SKU(s) estão com saldo zerado ou negativo e merecem revisão operacional.`,
          priority: "normal",
          status: "open",
          entity_type: "sku",
          entity_id: null,
          customer_code: "BTG Pactual",
          created_at: new Date().toISOString(),
        }
      : null,
    currentBilling?.status === "aberto"
      ? {
          id: "derived_open_billing",
          title: "Competência aberta",
          message: `A fatura de ${currentPeriod} está aberta. O agente deve monitorar movimentos do mês antes da emissão.`,
          priority: "normal",
          status: "open",
          entity_type: "fatura",
          entity_id: currentPeriod,
          customer_code: "BTG Pactual",
          created_at: new Date().toISOString(),
        }
      : null,
    !latestMovement
      ? {
          id: "derived_no_movements",
          title: "Sem movimentações registradas",
          message: "Ainda não encontrei movimentações para montar histórico operacional.",
          priority: "normal",
          status: "open",
          entity_type: "movimentacao",
          entity_id: null,
          customer_code: "BTG Pactual",
          created_at: new Date().toISOString(),
        }
      : null,
  ].filter(Boolean);
}

async function getAiOverview() {
  const [products, skus, movements, orders, periods, events, inbox, memory, knowledge] =
    await Promise.all([
      readAll(collectionNames.products),
      readAll(collectionNames.skus),
      readAll(collectionNames.movements),
      readAll(collectionNames.orders),
      readAll(collectionNames.periods),
      readAll(collectionNames.events),
      readAll(collectionNames.agentInbox),
      readAll(collectionNames.agentMemory),
      readAll(collectionNames.agentKnowledge),
    ]);

  const inventoryValue = products.reduce(
    (sum, product) => sum + Number(product.custo_total ?? 0),
    0,
  );
  const totalPieces = skus.reduce(
    (sum, sku) => sum + Number(sku.estoque_atual ?? 0),
    0,
  );
  const missingCostCount = products.filter(
    (product) =>
      Number(product.estoque_btg ?? 0) > 0 &&
      (Number(product.preco_unit ?? 0) <= 0 || Number(product.custo_total ?? 0) <= 0),
  ).length;
  const openOrderCount = orders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  ).length;
  const actualEvents = sortByDateDesc(events.map(eventView), "occurred_at");
  const derivedTimeline = sortByDateDesc(movements, "data")
    .slice(0, 12)
    .map(derivedEventFromMovement);
  const timeline = actualEvents.length ? actualEvents.slice(0, 80) : derivedTimeline;
  const persistentInsights = sortByDateDesc(
    inbox.filter((item) => item.status !== "resolved").map(insightView),
    "created_at",
  );
  const derivedInsights = deriveAgentInsights({
    products,
    skus,
    orders,
    periods,
    movements,
  });
  const latestMovement = sortByDateDesc(movements, "data")[0];
  const latestEvent = timeline[0];
  const memoryItems = [
    {
      id: "derived_btg",
      scope_type: "cliente",
      scope_id: "BTG Pactual",
      title: "BTG Pactual",
      event_count: movements.length + orders.length + periods.length + events.length,
      last_event_title: latestEvent?.title ?? "Base importada",
      last_event_at: latestEvent?.occurred_at ?? toIso(latestMovement?.data),
      summary: `${products.length.toLocaleString("pt-BR")} produto(s), ${skus.length.toLocaleString("pt-BR")} SKU(s), ${totalPieces.toLocaleString("pt-BR")} peça(s) em acompanhamento.`,
    },
    {
      id: "derived_inventory",
      scope_type: "estoque",
      scope_id: "BTG",
      title: "Estoque BTG",
      event_count: movements.length + events.filter((event) => String(event.type).startsWith("inventory.")).length,
      last_event_title: latestMovement
        ? `${latestMovement.tipo_mov} - ${latestMovement.cod_sku}`
        : "Sem movimentação",
      last_event_at: toIso(latestMovement?.data),
      summary: `Valor monitorado de ${inventoryValue.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}.`,
    },
    ...sortByDateDesc(knowledge.map(knowledgeMemoryView), "last_event_at").slice(0, 12),
    ...sortByDateDesc(memory.map(memoryView), "updated_at").slice(0, 18),
  ];

  return {
    snapshot: {
      total_events: events.length,
      derived_events: actualEvents.length ? 0 : derivedTimeline.length,
      open_insights: persistentInsights.length + derivedInsights.length,
      inventory_value: inventoryValue,
      total_pieces: totalPieces,
      missing_costs: missingCostCount,
      open_orders: openOrderCount,
      last_event_at: latestEvent?.occurred_at ?? null,
    },
    inbox: [...derivedInsights, ...persistentInsights].slice(0, 30),
    events: timeline,
    memory: memoryItems,
    sources: [
      "products",
      "skus",
      "movements",
      "orders",
      "billing_periods",
      "events",
      "ai_agent_knowledge",
      "ai_agent_knowledge_chunks",
      "ai_agent_knowledge_files",
    ],
  };
}

async function route(pathname: string, method: HttpMethod, searchParams: URLSearchParams, init?: RequestInit) {
  if (!firestore) return json({ message: "Firebase não configurado." }, 503);

  if (pathname === "/api/healthz") return json({ ok: true });
  if (pathname === "/api/dashboard") return json(await getDashboard());
  if (pathname === "/api/ai/overview" && method === "GET") {
    return json(await getAiOverview());
  }
  if (pathname === "/api/operational/foundation" && method === "GET") {
    return json(await getOperationalFoundation());
  }
  if (pathname === "/api/operational/sync-real-foundation" && method === "POST") {
    return json(await syncRealOperationalFoundation(), 201);
  }
  if (pathname === "/api/client/overview" && method === "GET") {
    return json(await getClientOverview());
  }
  if (pathname === "/api/agent-dute/chat" && method === "GET") {
    return json(await getAgentDuteChat(searchParams.get("conversation_id") ?? undefined));
  }
  if (pathname === "/api/agent-dute/chat" && method === "POST") {
    return json(await chatWithAgentDute(await readBody(init)), 201);
  }
  if (pathname === "/api/client/requests" && method === "POST") {
    return json(await createCustomerRequest(await readBody(init)), 201);
  }
  const requestActionMatch = pathname.match(/^\/api\/customer-requests\/([^/]+)\/(approve|reject|close)$/);
  if (requestActionMatch && method === "POST") {
    return json(
      await transitionCustomerRequest(
        decodeURIComponent(requestActionMatch[1]),
        requestActionMatch[2] as "approve" | "reject" | "close",
      ),
    );
  }
  if (pathname === "/api/warehouse/ops" && method === "GET") {
    return json(await getWarehouseOps());
  }
  const advanceTaskMatch = pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/advance$/);
  if (advanceTaskMatch && method === "POST") {
    return json(await advanceWarehouseTask(decodeURIComponent(advanceTaskMatch[1])));
  }
  const exceptionTaskMatch = pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/exception$/);
  if (exceptionTaskMatch && method === "POST") {
    return json(
      await registerWarehouseException(
        decodeURIComponent(exceptionTaskMatch[1]),
        await readBody(init),
      ),
      201,
    );
  }
  if (pathname === "/api/ai/events" && method === "POST") {
    const body = await readBody(init);
    const event = await emitEvent({
      type: String(body.type ?? "operator.note"),
      title: String(body.title ?? "Anotação operacional"),
      description: String(body.description ?? ""),
      severity: (body.severity as EventSeverity) ?? "info",
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      customer_code: body.customer_code,
      customer_name: body.customer_name,
      payload: body.payload ?? {},
      source: body.source ?? "manual",
    });
    return json(event, 201);
  }

  const inboxMatch = pathname.match(/^\/api\/ai\/inbox\/([^/]+)$/);
  if (inboxMatch && (method === "PATCH" || method === "PUT")) {
    const body = await readBody(init);
    const id = decodeURIComponent(inboxMatch[1]);
    await updateDoc(doc(firestore, collectionNames.agentInbox, id), {
      status: body.status ?? "resolved",
      resolved_by: currentActor(),
      resolved_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    return json({ ok: true });
  }

  if (pathname === "/api/products/stats") {
    return json(categoryStats(await readAll(collectionNames.products)));
  }

  const listRoutes: Array<[RegExp, string, string[], string[]]> = [
    [/^\/api\/customers$/, collectionNames.customers, ["status"], ["code", "name"]],
    [/^\/api\/customer-accounts$/, collectionNames.customerAccounts, ["customer_code", "status"], ["email", "name", "user_id"]],
    [/^\/api\/customer-requests$/, collectionNames.customerRequests, ["customer_code", "status", "priority"], ["title", "description", "type"]],
    [/^\/api\/products$/, collectionNames.products, ["categoria", "grupo", "genero"], ["cod_cliente", "produto", "categoria", "grupo"]],
    [/^\/api\/skus$/, collectionNames.skus, ["cod_cliente", "rua", "prateleira", "estoque_tipo"], ["cod_btg", "cod_cliente", "produto"]],
    [/^\/api\/locations$/, collectionNames.locations, ["warehouse_code", "aisle", "shelf", "status"], ["label", "aisle", "shelf", "bin"]],
    [/^\/api\/stock-balances$/, collectionNames.stockBalances, ["customer_code", "sku_code", "location_id", "status"], ["sku_code", "client_item_code", "product_name", "location_id"]],
    [/^\/api\/movements$/, collectionNames.movements, ["cod_sku", "tipo_mov", "responsavel"], ["cod_sku", "produto", "doc_nf"]],
    [/^\/api\/inbound$/, collectionNames.inboundReceipts, ["customer_code", "status"], ["receipt_number"]],
    [/^\/api\/putaway\/tasks$/, collectionNames.putawayTasks, ["customer_code", "status", "location_id"], ["location_id", "title"]],
    [/^\/api\/orders$/, collectionNames.orders, ["status", "num_pedido", "solicitante"], ["num_pedido", "produto", "solicitante"]],
    [/^\/api\/order-items$/, collectionNames.orderItems, ["customer_code", "status", "order_number"], ["order_number", "sku_code", "product_name"]],
    [/^\/api\/picking\/tasks$/, collectionNames.pickTasks, ["customer_code", "status", "order_number"], ["order_number", "assigned_to"]],
    [/^\/api\/packing\/tasks$/, collectionNames.packTasks, ["customer_code", "status", "order_number"], ["order_number"]],
    [/^\/api\/shipments$/, collectionNames.shipments, ["customer_code", "status"], ["order_number", "destination"]],
    [/^\/api\/documents$/, collectionNames.documents, ["customer_code", "entity_type"], ["file_name", "entity_id"]],
    [/^\/api\/billing\/price-list$/, collectionNames.priceList, [], ["item", "grupo"]],
    [/^\/api\/billing\/users$/, collectionNames.users, [], ["nome", "email"]],
  ];

  for (const [regex, name, filters, searchFields] of listRoutes) {
    if (regex.test(pathname) && method === "GET") {
      const rows = await readAll(name);
      const orderedRows =
        name === collectionNames.movements
          ? rows.sort((a, b) => toIso(b.data).localeCompare(toIso(a.data)))
          : rows;
      return json(filterAndPage(orderedRows, searchParams, filters, searchFields));
    }
  }

  if (pathname === "/api/warehouse/map") return json(await getWarehouseMap());

  if (pathname === "/api/reports/export") {
    const type = searchParams.get("type");
    const name =
      type === "orders"
        ? collectionNames.orders
        : type === "movements"
          ? collectionNames.movements
          : collectionNames.products;
    return json({ generated_at: new Date().toISOString(), data: await readAll(name) });
  }

  if (pathname === "/api/billing/me") {
    const config = await getBillingConfig();
    return json({ cliente_nome: config.cliente_nome, role: "cliente" });
  }

  if (pathname === "/api/billing/config") {
    if (method === "GET") return json(await getBillingConfig());
    const body = await readBody(init);
    await setDoc(doc(firestore, "billing_config", "default"), {
      ...body,
      updated_at: serverTimestamp(),
    }, { merge: true });
    return json(await getBillingConfig());
  }

  if (pathname === "/api/billing/periods" && method === "GET") {
    const periods = await readAll(collectionNames.periods);
    return json({ items: periods });
  }

  const periodMatch = pathname.match(/^\/api\/billing\/periods\/([^/]+)(?:\/([^/]+))?$/);
  if (periodMatch) {
    const competencia = decodeURIComponent(periodMatch[1]);
    const action = periodMatch[2];
    if (!action && method === "GET") return json(await getBillingPeriod(competencia));
    if (action === "manual" && method === "PUT") {
      const body = await readBody(init);
      await setDoc(doc(firestore, collectionNames.manual, competencia), {
        items: body.items ?? [],
        updated_at: serverTimestamp(),
      });
      await emitEvent({
        type: "billing.manual_quantities_saved",
        title: "Quantidades manuais do faturamento salvas",
        description: `Competência ${competencia}`,
        entity_type: "fatura",
        entity_id: competencia,
        customer_code: "BTG Pactual",
        payload: { competencia, items_count: (body.items ?? []).length },
      });
      return json(await getBillingPeriod(competencia));
    }
    if (action === "emit" && method === "POST") {
      const period = await getBillingPeriod(competencia);
      await setDoc(doc(firestore, collectionNames.periods, competencia), {
        competencia,
        status: "emitido",
        total: period.total,
        emitido_em: new Date().toISOString(),
        updated_at: serverTimestamp(),
      }, { merge: true });
      await emitEvent({
        type: "billing.invoice_emitted",
        title: "Fatura emitida",
        description: `Fatura de ${competencia} emitida no valor de ${period.total.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })}`,
        severity: "attention",
        entity_type: "fatura",
        entity_id: competencia,
        customer_code: "BTG Pactual",
        payload: { competencia, total: period.total },
      });
      return json({ ok: true, email: { sent: false } });
    }
    if (action === "pay" && method === "POST") {
      await setDoc(doc(firestore, collectionNames.periods, competencia), {
        competencia,
        status: "pago",
        pago_em: new Date().toISOString(),
        updated_at: serverTimestamp(),
      }, { merge: true });
      await emitEvent({
        type: "billing.invoice_paid",
        title: "Fatura marcada como paga",
        description: `Competência ${competencia}`,
        entity_type: "fatura",
        entity_id: competencia,
        customer_code: "BTG Pactual",
        payload: { competencia },
      });
      return json(await getBillingPeriod(competencia));
    }
  }

  if (pathname === "/api/billing/me/current") {
    return json(await getBillingPeriod(new Date().toISOString().slice(0, 7)));
  }

  if (pathname === "/api/billing/me/invoices") {
    return json({ items: await readAll(collectionNames.periods) });
  }

  if (pathname === "/api/import" && method === "POST") {
    const body = await readBody(init);
    const batches = [
      [collectionNames.products, body.products ?? []],
      [collectionNames.skus, body.skus ?? []],
      [collectionNames.movements, body.movements ?? []],
      [collectionNames.orders, body.orders ?? []],
    ] as const;
    let inserted = 0;
    for (const [name, items] of batches) {
      for (const item of items) {
        await createItem(name, item, { silent: true });
        inserted += 1;
      }
    }
    await emitEvent({
      type: "data.imported",
      title: "Importação de dados concluída",
      description: `${inserted.toLocaleString("pt-BR")} registro(s) importado(s) para o sistema.`,
      severity: "attention",
      entity_type: "importacao",
      entity_id: Date.now(),
      customer_code: "BTG Pactual",
      payload: compactPayload({
        products: body.products?.length,
        skus: body.skus?.length,
        movements: body.movements?.length,
        orders: body.orders?.length,
      }),
    });
    return json({ ok: true, inserted, errors: [] });
  }

  const operationalEntityCollections: Record<string, string> = {
    customers: collectionNames.customers,
    "customer-accounts": collectionNames.customerAccounts,
    "customer-requests": collectionNames.customerRequests,
    locations: collectionNames.locations,
    "stock-balances": collectionNames.stockBalances,
    inbound: collectionNames.inboundReceipts,
    "putaway/tasks": collectionNames.putawayTasks,
    "order-items": collectionNames.orderItems,
    "picking/tasks": collectionNames.pickTasks,
    "packing/tasks": collectionNames.packTasks,
    shipments: collectionNames.shipments,
    documents: collectionNames.documents,
  };
  const operationalEntityMatch = pathname.match(/^\/api\/(customers|customer-accounts|customer-requests|locations|stock-balances|inbound|putaway\/tasks|order-items|picking\/tasks|packing\/tasks|shipments|documents)(?:\/([^/]+))?$/);
  if (operationalEntityMatch) {
    const name = operationalEntityCollections[operationalEntityMatch[1]];
    const id = operationalEntityMatch[2];

    if (method === "POST") return json(await createItem(name, await readBody(init)), 201);
    if (id && (method === "PATCH" || method === "PUT")) return json(await updateItem(name, id, await readBody(init)));
    if (id && method === "DELETE") {
      await deleteItem(name, id);
      return json(null, 204);
    }
  }

  const entityMatch = pathname.match(/^\/api\/(products|skus|orders|billing\/price-list|billing\/users)(?:\/([^/]+))?$/);
  if (entityMatch) {
    const segment = entityMatch[1];
    const id = entityMatch[2];
    const name =
      segment === "billing/price-list"
        ? collectionNames.priceList
        : segment === "billing/users"
          ? collectionNames.users
          : collectionNames[segment as "products" | "skus" | "orders"];

    if (method === "POST") return json(await createItem(name, await readBody(init)), 201);
    if (id && (method === "PATCH" || method === "PUT")) return json(await updateItem(name, id, await readBody(init)));
    if (id && method === "DELETE") {
      await deleteItem(name, id);
      return json(null, 204);
    }
  }

  const roleMatch = pathname.match(/^\/api\/billing\/users\/([^/]+)\/role$/);
  if (roleMatch && method === "PATCH") {
    return json(await updateItem(collectionNames.users, roleMatch[1], await readBody(init)));
  }

  if (pathname === "/api/movements" && method === "POST") {
    return json(await createMovement(await readBody(init)), 201);
  }

  return json({ message: "Rota Firebase não implementada", pathname }, 404);
}

export function installCloudApi() {
  if (window.__duteCloudApiInstalled) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString(),
      window.location.origin,
    );

    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);

    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() as HttpMethod;
      if (shouldUseFunctionsApi(url.pathname, method)) {
        const functionsResponse = await callFunctionsApi(url.pathname, method, init);
        if (functionsResponse) return functionsResponse;
      }

      return await route(url.pathname, method, url.searchParams, init);
    } catch (error) {
      return json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Erro ao acessar o Firebase.",
        },
        error instanceof RouteError ? error.status : 500,
      );
    }
  };

  window.__duteCloudApiInstalled = true;
}

declare global {
  interface Window {
    __duteCloudApiInstalled?: boolean;
  }
}
