import {
  Timestamp,
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";

import { PAPEIS_DO_WMS, estagioDoCadastro, isPapel, modulosContratados } from "@workspace/dominio";
import { clienteDaChamada, LEGACY_CUSTOMER_CODE } from "./active-customer";
import { periodBelongsToCustomer } from "./billing-scope";
import { leiturasDoPortal } from "./operations";
import { canListUsers, canSeeCatalogPrice, canSeeMerchandiseValue } from "./permissions";
import { firebaseAuth, firestore } from "./firebase";
import { callFunctionsApi } from "./functions-api";
import {
  type CursorOrderValue,
  decodeOrderValue,
  encodeOrderValue,
  fromBase64,
  pageWindow,
  prefixRangeEnd,
  toBase64,
} from "./list-pagination";
import {
  DEFAULT_CUSTOMER,
  buildDerivedInboundReceipts,
  buildDerivedLocations,
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
  warehousePositions: "warehouse_positions",
  warehouseBoxes: "warehouse_boxes",
  stockBalances: "stock_balances",
  clientInventory: "client_inventory",
  clientOrderTracking: "client_order_tracking",
  clientRequestStatus: "client_request_status",
  clientInvoices: "client_invoices",
  clientDocuments: "client_documents",
  clientProfiles: "client_profiles",
  clientPortalStatus: "client_portal_status",
  inboundReceipts: "inbound_receipts",
  inboundItems: "inbound_items",
  returns: "returns",
  returnItems: "return_items",
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
  users: "users",
  events: "events",
  agentInbox: "ai_agent_inbox",
  operationalNotifications: "operational_notifications",
  agentMemory: "ai_agent_memory",
  agentKnowledge: "ai_agent_knowledge",
  agentKnowledgeChunks: "ai_agent_knowledge_chunks",
  agentKnowledgeFiles: "ai_agent_knowledge_files",
  agentKnowledgeFileChunks: "ai_agent_knowledge_file_chunks",
  agentConversations: "agent_conversations",
  agentMessages: "agent_messages",
  opsAggregates: "ops_aggregates",
  catalogPrices: "catalog_prices",
};

const PUBLISHED_MONEY_FIELDS = [
  "preco_unit",
  "unit_cost",
  "custo_unit",
  "custo_total",
  "total_cost",
  "total_value",
] as const;

function stripPublishedMoney(row: AnyRecord): AnyRecord {
  const next = { ...row };
  for (const field of PUBLISHED_MONEY_FIELDS) delete next[field];
  return next;
}

type CatalogPricePoint = { unit?: number; total?: number };

async function readCatalogPriceIndex(customerCode?: string) {
  const index = new Map<string, CatalogPricePoint>();
  if (!firestore) return index;
  const constraints: QueryConstraint[] = [];
  if (customerCode) constraints.push(where("customer_code", "==", customerCode));
  constraints.push(fsLimit(CATALOG_READ_CAP));
  try {
    const snapshot = await getDocs(
      query(collection(firestore, collectionNames.catalogPrices), ...constraints),
    );
    for (const priceDoc of snapshot.docs) {
      const data = priceDoc.data();
      const unit = Number(data.preco_unit);
      const total = Number(data.total_cost);
      const point: CatalogPricePoint = {};
      if (Number.isFinite(unit)) point.unit = unit;
      if (Number.isFinite(total)) point.total = total;
      if (point.unit === undefined && point.total === undefined) continue;
      const store = (key: string) => index.set(key, point);
      if (typeof data.sku_code === "string" && data.sku_code) store(`sku:${data.sku_code}`);
      if (typeof data.item_code === "string" && data.item_code) store(`item:${data.item_code}`);
    }
  } catch {
    return index;
  }
  return index;
}

function pricePoint(
  index: Map<string, CatalogPricePoint>,
  skuCode: unknown,
  itemCode: unknown,
) {
  if (typeof skuCode === "string") {
    const sku = index.get(`sku:${skuCode}`);
    if (sku) return sku;
  }
  return typeof itemCode === "string" ? index.get(`item:${itemCode}`) : undefined;
}

function unitFromPriceIndex(
  index: Map<string, CatalogPricePoint>,
  skuCode: unknown,
  itemCode: unknown,
) {
  return pricePoint(index, skuCode, itemCode)?.unit;
}

const DEFAULT_LIST_LIMIT = 50;
const HARD_LIST_CAP = 200;
// Lista de clientes sem prospects: leituras extras quando a página vem cheia
// de prospects. 20 leituras e 5.000 documentos cobrem 10x o hardCap de 500
// (milhares de prospects de carga em lote) sem deixar uma tela abrir
// varredura ilimitada no Firestore.
const CUSTOMER_SCAN_MAX_READS = 20;
const CUSTOMER_SCAN_MAX_DOCS = 5000;
const CUSTOMER_SCAN_MIN_PAGE = 100;
const CATALOG_READ_CAP = 2000;
const OPS_TASK_READ_CAP = 500;
/** As encerradas de cada fila do armazém; as abertas entram todas. */
const OPS_CLOSED_TASKS_IN_QUEUE = 12;
const OPS_CLOSED_TASK_STATUSES = new Set(["completed", "delivered", "received", "closed", "cancelled", "canceled"]);
const RECENT_MOVEMENTS_CAP = 300;
const RECENT_EVENTS_CAP = 80;
const EXPORT_HARD_CAP = 5000;
/** Teto por consulta escopada em um cliente (portal). */
const PORTAL_READ_CAP = 500;
/** Teto do histórico de chat carregado de uma vez. */
const CHAT_HISTORY_CAP = 100;

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
    return new Date(
      (value as { seconds: number }).seconds * 1000,
    ).toISOString();
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

function safeDocId(value: string) {
  return value.replace(/[^\w.-]/g, "_").slice(0, 900);
}

function compactPayload(payload: AnyRecord = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
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


/** Capped collection read — never downloads unbounded history. */
async function readLimited(
  name: string,
  maxDocs: number,
  orderField?: string,
  direction: "asc" | "desc" = "desc",
): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const constraints: QueryConstraint[] = [];
  if (orderField) constraints.push(orderBy(orderField, direction));
  constraints.push(fsLimit(Math.max(1, Math.min(maxDocs, 5000))));
  const snapshot = await getDocs(query(collection(firestore, name), ...constraints));
  return snapshot.docs.map(normalizeDoc);
}

async function readCollectionCount(name: string): Promise<number> {
  if (!firestore) return 0;
  try {
    const snapshot = await getCountFromServer(collection(firestore, name));
    return snapshot.data().count;
  } catch {
    return 0;
  }
}

async function readOpsAggregate(id: string): Promise<AnyRecord | null> {
  if (!firestore) return null;
  try {
    const snapshot = await getDoc(doc(firestore, collectionNames.opsAggregates, id));
    if (!snapshot.exists()) return null;
    return normalizeDoc(snapshot);
  } catch {
    return null;
  }
}

type ReadPagedOptions = {
  orderByField: string;
  direction?: "asc" | "desc";
  equalityFilters?: Array<{ field: string; value: string }>;
  /** Soft search fields applied in memory after the Firestore page (narrow pages only). */
  searchFields?: string[];
  /** Campo com busca por prefixo no servidor (faixa >= termo, < termo+sentinela). */
  prefixSearchField?: string;
  /** Campos filtrados em memória depois da página — invalidam o total exato. */
  inMemoryFilterFields?: string[];
  params: URLSearchParams;
  /** Max page size when client omits limit. */
  defaultLimit?: number;
  hardCap?: number;
  /** Ocupação exige consulta paginável completa; não aceita scan limitado. */
  requireIndexedRead?: boolean;
};

/**
 * O shim roda no mesmo contexto JS das páginas, então o snapshot da última
 * linha da página pode ser reaproveitado — startAfter(snapshot) é a forma
 * canônica e resolve tipos e empates sozinha. O envelope serializado fica
 * como fallback para quando o cache não tem o token (reload, aba nova).
 */
const cursorSnapshotCache = new Map<string, DocumentSnapshot>();
const CURSOR_CACHE_LIMIT = 64;

function rememberCursorSnapshot(token: string, snapshot: DocumentSnapshot) {
  if (cursorSnapshotCache.size >= CURSOR_CACHE_LIMIT) {
    const oldest = cursorSnapshotCache.keys().next().value;
    if (oldest) cursorSnapshotCache.delete(oldest);
  }
  cursorSnapshotCache.set(token, snapshot);
}

function encodeCursor(snapshot: DocumentSnapshot, orderByField: string): string {
  const data = snapshot.data() as AnyRecord | undefined;
  const token = toBase64(
    JSON.stringify({
      id: snapshot.id,
      o: encodeOrderValue(data?.[orderByField]),
    }),
  );
  rememberCursorSnapshot(token, snapshot);
  return token;
}

function decodeCursor(
  cursor: string,
): { snapshot?: DocumentSnapshot; id: string; orderValue: unknown } | null {
  const cached = cursorSnapshotCache.get(cursor);
  if (cached) {
    return { snapshot: cached, id: cached.id, orderValue: undefined };
  }
  try {
    const parsed = JSON.parse(fromBase64(cursor)) as {
      id?: string;
      o?: CursorOrderValue;
    };
    if (!parsed?.id) return null;
    return { id: parsed.id, orderValue: decodeOrderValue(parsed.o) };
  } catch {
    return null;
  }
}

/**
 * Pushes limit/orderBy/equality filters into Firestore. Text search and
 * date range still apply in memory on the fetched page only (not the whole
 * collection). Returns has_more / next_cursor for cursor pagination.
 */
async function readPaged(
  name: string,
  options: ReadPagedOptions,
): Promise<{
  items: AnyRecord[];
  total: number;
  has_more: boolean;
  next_cursor?: string;
}> {
  if (!firestore) {
    if (options.requireIndexedRead) throw new Error("Firestore não configurado.");
    return { items: [], total: 0, has_more: false };
  }

  const hardCap = options.hardCap ?? HARD_LIST_CAP;
  const requestedLimit = Number(
    options.params.get("limit") ?? options.defaultLimit ?? DEFAULT_LIST_LIMIT,
  );
  const pageSize = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_LIST_LIMIT,
      hardCap,
    ),
  );
  const offset = Math.max(0, Number(options.params.get("offset") ?? 0) || 0);
  const cursorParam = options.params.get("cursor");
  const direction = options.direction ?? "desc";

  const activeFilters = (options.equalityFilters ?? []).filter(
    (filter) => filter.value,
  );
  // Firestore rejeita orderBy no mesmo campo de um filtro de igualdade — e a
  // ordenação seria irrelevante, já que todos os resultados têm o mesmo valor.
  const orderByIsFiltered = activeFilters.some(
    (filter) => filter.field === options.orderByField,
  );

  const searchTerm = (options.params.get("search") ?? "").trim();
  // Busca por prefixo no servidor: sem isso, `search` só encontra o que já
  // está na página baixada — digitar um código antigo devolvia zero linhas.
  // A faixa exige que a primeira ordenação seja o próprio campo do range.
  const prefixField =
    searchTerm && options.prefixSearchField && !orderByIsFiltered
      ? options.prefixSearchField
      : undefined;
  const effectiveOrderField = prefixField ?? options.orderByField;
  const effectiveDirection: "asc" | "desc" = prefixField ? "asc" : direction;

  const constraints: QueryConstraint[] = [];
  for (const filter of activeFilters) {
    constraints.push(where(filter.field, "==", filter.value));
  }
  if (prefixField) {
    constraints.push(where(prefixField, ">=", searchTerm));
    constraints.push(where(prefixField, "<", prefixRangeEnd(searchTerm)));
    constraints.push(orderBy(prefixField, "asc"));
  } else if (!orderByIsFiltered) {
    constraints.push(orderBy(options.orderByField, direction));
  }
  // Desempate estável: sem ele, startAfter pula todas as linhas que
  // compartilham o valor de ordenação na fronteira da página.
  constraints.push(orderBy(documentId(), effectiveDirection));

  // Offset best-effort for shallow pages only (avoids full-collection scan).
  const fetchCount =
    !cursorParam && offset > 0
      ? Math.min(offset + pageSize + 1, hardCap + 1)
      : pageSize + 1;

  if (cursorParam) {
    const decoded = decodeCursor(cursorParam);
    if (decoded?.snapshot) {
      constraints.push(startAfter(decoded.snapshot));
    } else if (decoded) {
      constraints.push(
        orderByIsFiltered
          ? startAfter(decoded.id)
          : startAfter(decoded.orderValue ?? null, decoded.id),
      );
    }
  }

  constraints.push(fsLimit(fetchCount));

  let snapshot;
  try {
    snapshot = await getDocs(
      query(collection(firestore, name), ...constraints),
    );
  } catch (error) {
    // Uma lista parcial de caixas faria o espaço livre parecer maior.
    if (options.requireIndexedRead) throw error;
    console.warn(
      `[readPaged] query failed for ${name}, falling back to capped scan.`,
      error,
    );
    const rows = await readLimited(name, hardCap, options.orderByField, direction);
    // O fallback precisa reaplicar os filtros que a query teria feito no
    // servidor; sem isso a lista volta sem filtro nenhum e parece dado errado.
    return filterAndPageExtended(rows, options.params, pageSize, offset, {
      equalityFilters: activeFilters,
      searchFields: options.searchFields,
    });
  }

  let docs = snapshot.docs;
  if (!cursorParam && offset > 0) {
    docs = docs.slice(offset);
  }

  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
  let items = pageDocs.map(normalizeDoc);

  // Com prefixo no servidor a página já vem filtrada; reaplicar em memória
  // sobre os demais campos só descartaria linhas válidas.
  if (searchTerm && !prefixField && options.searchFields?.length) {
    items = items.filter((row) =>
      options.searchFields!.some((field) => includes(row[field], searchTerm)),
    );
  }

  const from = options.params.get("date_from");
  const to = options.params.get("date_to");
  if (from) {
    items = items.filter((row) => toIso(row.data ?? row.data_solic) >= from);
  }
  if (to) {
    items = items.filter((row) => toIso(row.data ?? row.data_solic) <= to);
  }

  const lastDoc = pageDocs[pageDocs.length - 1];
  const nextCursor =
    hasMore && lastDoc ? encodeCursor(lastDoc, effectiveOrderField) : undefined;

  // Total real na primeira página (getCountFromServer é agregação indexada,
  // não baixa documentos). Só vale quando nada é filtrado em memória depois:
  // senão o contador reportaria a coleção inteira sob uma lista já reduzida.
  const narrowedInMemory =
    Boolean(from) ||
    Boolean(to) ||
    (Boolean(searchTerm) && !prefixField) ||
    (options.inMemoryFilterFields ?? []).some((field) =>
      Boolean(options.params.get(field)),
    );
  let total = offset + items.length + (hasMore ? 1 : 0);
  try {
    if (offset === 0 && !cursorParam && !narrowedInMemory) {
      const countConstraints: QueryConstraint[] = activeFilters.map((filter) =>
        where(filter.field, "==", filter.value),
      );
      if (prefixField) {
        countConstraints.push(where(prefixField, ">=", searchTerm));
        countConstraints.push(where(prefixField, "<", prefixRangeEnd(searchTerm)));
      }
      const countSnap = await getCountFromServer(
        query(collection(firestore, name), ...countConstraints),
      );
      total = countSnap.data().count;
    }
  } catch {
    // keep estimate
  }

  return {
    items,
    total,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

function filterAndPageExtended(
  rows: AnyRecord[],
  params: URLSearchParams,
  pageSize: number,
  offset: number,
  applied?: {
    equalityFilters?: Array<{ field: string; value: string }>;
    searchFields?: string[];
  },
): {
  items: AnyRecord[];
  total: number;
  has_more: boolean;
  next_cursor?: string;
} {
  // Igualdade exata para os campos que a query faria no servidor.
  let source = rows;
  for (const filter of applied?.equalityFilters ?? []) {
    source = source.filter(
      (row) => String(row[filter.field] ?? "") === filter.value,
    );
  }
  // filterAndPage já aplica offset/limit vindos de params — cortar de novo
  // aqui pularia offset duas vezes e devolveria página vazia.
  const paged = filterAndPage(source, params, [], applied?.searchFields ?? []);
  const sliced = pageWindow(paged.items, 0, pageSize);
  return {
    items: sliced,
    total: paged.total,
    has_more: offset + sliced.length < paged.total,
  };
}

type WhereEqualOptions = {
  maxDocs?: number;
  orderByField?: string;
  direction?: "asc" | "desc";
  /**
   * Igualdades extras que a REGRA do Firestore exige. Não é filtro cosmético:
   * uma consulta de lista só é aceita se conseguir provar que todo resultado
   * satisfaz a regra de leitura — sem repetir a condição aqui, o Firestore
   * nega a consulta inteira com permission-denied.
   */
  extraEquals?: Array<{ field: string; value: string | number | boolean }>;
};

async function readWhereEqual(
  name: string,
  field: string,
  value: string | number | boolean,
  options: WhereEqualOptions = {},
): Promise<AnyRecord[]> {
  if (!firestore) return [];
  const constraints: QueryConstraint[] = [where(field, "==", value)];
  for (const extra of options.extraEquals ?? []) {
    constraints.push(where(extra.field, "==", extra.value));
  }
  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.direction ?? "desc"));
  }
  constraints.push(
    fsLimit(
      Math.max(1, Math.min(options.maxDocs ?? PORTAL_READ_CAP, CATALOG_READ_CAP)),
    ),
  );
  const snapshot = await getDocs(
    query(collection(firestore, name), ...constraints),
  );
  return snapshot.docs.map(normalizeDoc);
}

async function readOptionalWhereEqual(
  name: string,
  field: string,
  value: string | number | boolean,
  options: WhereEqualOptions = {},
): Promise<AnyRecord[]> {
  try {
    return await readWhereEqual(name, field, value, options);
  } catch (error) {
    console.warn(`[portal] ${name} não pôde ser carregado.`, error);
    // orderBy exige índice composto; sem ele, cai para a leitura só com
    // igualdade e limite (ainda limitada, nunca coleção inteira).
    // extraEquals é preservado: sem ele a regra nega a consulta de novo.
    if (options.orderByField) {
      try {
        return await readWhereEqual(name, field, value, {
          maxDocs: options.maxDocs,
          extraEquals: options.extraEquals,
        });
      } catch {
        return [];
      }
    }
    return [];
  }
}

function includes(value: unknown, needle: string): boolean {
  return String(value ?? "")
    .toLowerCase()
    .includes(needle.toLowerCase());
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
  if (from)
    result = result.filter((row) => toIso(row.data ?? row.data_solic) >= from);
  if (to)
    result = result.filter((row) => toIso(row.data ?? row.data_solic) <= to);

  const total = result.length;
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? total);
  return { items: result.slice(offset, offset + limit), total };
}

async function readItem(name: string, id: string) {
  if (!firestore) throw new Error("Firestore não configurado.");
  const snapshot = await getDoc(doc(firestore, name, id));
  if (!snapshot.exists()) throw new RouteError("Registro não encontrado.", 404);
  return normalizeDoc(snapshot);
}



function categoryStats(products: AnyRecord[]) {
  const byCategory = new Map<
    string,
    { categoria: string; total_pecas: number; custo_total: number }
  >();
  for (const product of products) {
    const categoria = product.categoria || "Sem categoria";
    const current = byCategory.get(categoria) ?? {
      categoria,
      total_pecas: 0,
      custo_total: 0,
    };
    current.total_pecas += Number(product.estoque_btg ?? 0);
    current.custo_total += Number(product.custo_total ?? 0);
    byCategory.set(categoria, current);
  }
  return [...byCategory.values()];
}

async function getDashboard() {
  const [aggregate, productCount, skuCount, orderCount, recentMovements] =
    await Promise.all([
      readOpsAggregate("dashboard"),
      readCollectionCount(collectionNames.products),
      readCollectionCount(collectionNames.skus),
      readCollectionCount(collectionNames.orders),
      readLimited(collectionNames.movements, 10, "data", "desc"),
    ]);

  const totalPecas = Number(
    aggregate?.total_pecas ?? aggregate?.totalPecas ?? 0,
  );
  const custoTotal = Number(
    aggregate?.custo_total ?? aggregate?.custoTotal ?? 0,
  );
  const byCategory = Array.isArray(aggregate?.by_category)
    ? aggregate.by_category
    : [];
  const orderStatusCounts = Array.isArray(aggregate?.order_status_counts)
    ? aggregate.order_status_counts
    : [];

  return {
    total_produtos: Number(aggregate?.total_produtos ?? productCount),
    total_skus: Number(aggregate?.total_skus ?? skuCount),
    total_pecas: totalPecas,
    custo_total: custoTotal,
    ad_valorem: custoTotal * 0.005,
    recent_movements: recentMovements,
    by_category: byCategory,
    order_status_counts: orderStatusCounts.length
      ? orderStatusCounts
      : [{ status: "TOTAL", count: orderCount }],
  };
}

/**
 * Os dias parado do cliente (docs/plataforma/fase-5-memoria.md, parte 5.4c):
 * o item que a rotina do núcleo grava em `ai_stock_age`. Só o filtro do
 * cliente, sem ordenação: a tela junta pelo SKU.
 */
async function getStockAge(customerCode: string) {
  if (!firestore || !customerCode) return { items: [] };
  const snapshot = await getDocs(query(collection(firestore, "ai_stock_age"), where("customer_code", "==", customerCode)));
  return { items: snapshot.docs.map(normalizeDoc) };
}

/**
 * O alerta do item parado para aprovar (parte 5.4e): as propostas abertas de
 * todos os clientes em `ai_stock_alerts`. As regras só abrem à coordenação.
 */
async function getStockAlerts() {
  if (!firestore) return { items: [] };
  const snapshot = await getDocs(query(collection(firestore, "ai_stock_alerts"), where("status", "==", "proposta")));
  return { items: snapshot.docs.map(normalizeDoc) };
}

async function getWarehouseMap() {
  const skus = await readLimited(collectionNames.skus, CATALOG_READ_CAP);
  const ruas = new Map<string, AnyRecord>();

  for (const sku of skus) {
    const rua = sku.rua || "Sem rua";
    const prateleira = sku.prateleira || "Sem prateleira";
    const caixa = sku.caixa || "Sem caixa";

    if (!ruas.has(rua)) {
      ruas.set(rua, {
        rua,
        total_pecas: 0,
        total_skus: 0,
        total_caixas: 0,
        prateleiras: [],
      });
    }

    const ruaData = ruas.get(rua)!;
    ruaData.total_pecas += Number(sku.estoque_atual ?? 0);
    ruaData.total_skus += 1;

    let shelf = ruaData.prateleiras.find(
      (item: AnyRecord) => item.prateleira === prateleira,
    );
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

  const snapshot = await getDoc(
    doc(firestore, collectionNames.users, user.uid),
  );
  if (!snapshot.exists()) {
    throw new RouteError("Usuário sem perfil ativo.", 403);
  }

  const profile = snapshot.data() as AnyRecord;
  const role = String(profile.role ?? "");
  if (!isPapel(role)) {
    throw new RouteError("Perfil sem papel válido.", 403);
  }
  // Como nas Functions (wmsAccessProblem): estas rotas são do WMS e o papel
  // da plataforma que o WMS não atende fica de fora.
  if (!(PAPEIS_DO_WMS as readonly string[]).includes(role)) {
    throw new RouteError("Seu perfil ainda não tem acesso a esta ação.", 403);
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
  return requested > 0
    ? Math.min(100, Math.round((picked / requested) * 100))
    : 0;
}

/**
 * Perfil de operação do cliente logado: a projeção `client_profiles` que as
 * Functions gravam junto com o cadastro. Sem registro (cadastro anterior ao
 * campo), `profile` vem null e o app usa o modelo padrão (lib/operations).
 */
async function getClientProfile() {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const rows = await readOptionalWhereEqual(
    collectionNames.clientProfiles,
    "customer_code",
    customerCode,
    { maxDocs: 1 },
  );
  return { customer_code: customerCode, profile: rows[0] ?? null };
}

async function getClientOverview() {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const isClient = profile.role === "cliente";
  // O cliente lê só as projeções dos módulos contratados (parte 2.7): os
  // módulos vêm da mesma projeção client_profiles que monta o menu dele.
  const leituras = isClient
    ? leiturasDoPortal(
        modulosContratados(
          (await readOptionalWhereEqual(collectionNames.clientProfiles, "customer_code", customerCode, { maxDocs: 1 }))[0]?.modules,
        ),
      )
    : null;
  const nada = () => Promise.resolve([] as AnyRecord[]);
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
          // readOptional*: um índice ainda em construção não pode derrubar
          // as cinco seções do portal.
          leituras?.estoque
            ? readOptionalWhereEqual(
                collectionNames.clientInventory,
                "customer_code",
                customerCode,
                { maxDocs: CATALOG_READ_CAP, orderByField: "sku_code", direction: "asc" },
              )
            : nada(),
          leituras?.pedidos
            ? readOptionalWhereEqual(
                collectionNames.clientOrderTracking,
                "customer_code",
                customerCode,
                { maxDocs: PORTAL_READ_CAP, orderByField: "updated_at" },
              )
            : nada(),
          Promise.resolve([]),
          leituras?.solicitacoes
            ? readOptionalWhereEqual(
                collectionNames.clientRequestStatus,
                "customer_code",
                customerCode,
                { maxDocs: PORTAL_READ_CAP, orderByField: "updated_at" },
              )
            : nada(),
          leituras?.faturas
            ? readOptionalWhereEqual(
                collectionNames.clientInvoices,
                "customer_code",
                customerCode,
                { maxDocs: PORTAL_READ_CAP, orderByField: "competencia" },
              )
            : nada(),
          Promise.resolve([]),
          leituras?.documentos
            ? readOptionalWhereEqual(
                collectionNames.clientDocuments,
                "customer_code",
                customerCode,
                {
                  maxDocs: PORTAL_READ_CAP,
                  orderByField: "created_at",
                  // A regra exige customer_visible == true; a consulta precisa
                  // declarar isso ou o Firestore nega a lista inteira.
                  extraEquals: [{ field: "customer_visible", value: true }],
                },
              )
            : nada(),
        ]
      : [
          readLimited(collectionNames.products, CATALOG_READ_CAP),
          readLimited(collectionNames.skus, CATALOG_READ_CAP),
          readLimited(collectionNames.stockBalances, CATALOG_READ_CAP),
          readLimited(collectionNames.orders, OPS_TASK_READ_CAP, "data_solic", "desc"),
          Promise.resolve([]),
          readLimited(collectionNames.customerRequests, OPS_TASK_READ_CAP, "created_at", "desc"),
          // Tolerante: papéis internos sem canReadBilling (coordenador) não
          // derrubam a prévia do portal por causa do sinal de faturamento.
          readLimited(collectionNames.periods, 120, "competencia", "desc").catch(
            () => [] as AnyRecord[],
          ),
          readLimited(collectionNames.agentInbox, 100, "created_at", "desc"),
          readLimited(collectionNames.documents, OPS_TASK_READ_CAP, "created_at", "desc"),
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
  // Defesa em profundidade: a regra já barra a leitura de arquivados, mas a
  // tela não deve renderizar projeção obsoleta se algo escapar.
  const customerDocuments = documents.filter(
    (item) =>
      matchesCustomer(item, customerCode) && item.customer_visible !== false,
  );

  const totalPieces = balances.reduce<number>(
    (sum, item) => sum + Number(item.qty_on_hand ?? item.estoque_atual ?? 0),
    0,
  );
  const showMerchandise = canSeeMerchandiseValue(String(profile.role));
  // O valor da mercadoria é do estoque: sem armazenagem no contrato, nada a ler.
  const priceIndex = showMerchandise && (leituras?.estoque ?? true)
    ? await readCatalogPriceIndex(customerCode)
    : new Map<string, CatalogPricePoint>();
  const lineValue = (item: AnyRecord) => {
    const qty = Number(item.qty_on_hand ?? item.estoque_atual ?? 0);
    if (!showMerchandise) return 0;
    const point = pricePoint(
      priceIndex,
      item.sku_code,
      item.client_item_code ?? item.cod_cliente,
    );
    // A conta da fatura (merchandiseValue, nas Functions): o saldo vezes o
    // preço unitário; o total gravado só para o SKU sem preço unitário.
    if (point?.unit !== undefined && point.unit > 0) return qty * point.unit;
    if (point?.total !== undefined) return point.total;
    return Number(item.total_cost ?? 0);
  };
  const inventoryValueFromBalances = balances.reduce<number>(
    (sum, item) => sum + lineValue(item),
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
    current.total_cost += lineValue(balance);
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
      total_value: showMerchandise ? lineValue(item) : undefined,
      total_cost: showMerchandise ? lineValue(item) : undefined,
      unit_cost: showMerchandise
        ? (unitFromPriceIndex(
            priceIndex,
            item.sku_code,
            item.client_item_code ?? item.cod_cliente,
          ) ?? Number(item.unit_cost ?? 0))
        : undefined,
      // Fotos tiradas pelo operador na entrada/contagem — a projeção já as
      // carrega; sem repassá-las o portal só conseguia mostrar placeholder.
      primary_photo_url: item.primary_photo_url ?? item.photo_urls?.[0] ?? null,
      photo_urls: Array.isArray(item.photo_urls) ? item.photo_urls : [],
      // Mínimo da ficha e arquivamento pela BTG (domain/client-inventory.ts).
      estoque_minimo:
        typeof item.estoque_minimo === "number" ? item.estoque_minimo : undefined,
      client_archived: item.client_archived === true,
    }));
  const topItems = stockItems.slice(0, 8);

  const openOrders = customerOrders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  );
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentInvoice = periods.find(
    (period) => period.competencia === currentPeriod,
  );
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
      requested_at: toIso(
        order.requested_at ?? order.data_solic ?? order.created_at,
      ),
      data_solic: toIso(
        order.requested_at ?? order.data_solic ?? order.created_at,
      ),
      status_label: order.status_label,
      destination: order.destination,
      timeline: Array.isArray(order.timeline) ? order.timeline : [],
    }));
  // O Início do portal separa pedidos de avisos de chegada; com só 8, uma
  // semana de avisos escondia os pedidos em andamento.
  const recentRequests = sortByDateDesc(customerRequests, "created_at").slice(
    0,
    30,
  );
  const invoiceItems = sortByDateDesc(periods, "competencia").slice(0, 6);
  const alertItems = sortByDateDesc(customerAlerts, "created_at").slice(0, 6);

  let outboundBlocked = false;
  if (firestore) {
    try {
      const portalStatus = await getDoc(doc(firestore, collectionNames.clientPortalStatus, customerCode));
      outboundBlocked = portalStatus.exists() && portalStatus.data()?.outbound_blocked === true;
    } catch {
      outboundBlocked = false;
    }
  }

  return {
    updated_at: new Date().toISOString(),
    customer: {
      code: customerCode,
      name: customerCode,
      role: profile.role,
    },
    inventory: {
      outbound_blocked: outboundBlocked,
      total_skus: balances.length || skus.length,
      total_pieces: totalPieces,
      available_pieces: balances.reduce<number>(
        (sum, item) =>
          sum + Number(item.qty_available ?? item.qty_on_hand ?? 0),
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
        ["FATURADO", "ENTREGUE"].includes(
          String(order.status ?? "").toUpperCase(),
        ),
      ).length,
      recent: recentOrders,
    },
    requests: {
      open: customerRequests.filter((request) => request.status !== "closed")
        .length,
      pending: customerRequests.filter((request) =>
        ["open", "pending", "submitted"].includes(
          String(request.status ?? "").toLowerCase(),
        ),
      ).length,
      recent: recentRequests,
    },
    metrics: {
      total_products:
        products.length ||
        new Set(balances.map((item) => item.client_item_code).filter(Boolean))
          .size,
      total_skus: balances.length || skus.length,
      total_pieces: totalPieces,
      inventory_value: inventoryValue,
      open_orders: openOrders.length,
      open_requests: customerRequests.filter(
        (request) => request.status !== "closed",
      ).length,
      open_alerts: customerAlerts.filter((item) => item.status !== "resolved")
        .length,
      documents: customerDocuments.length,
      current_invoice_total: Number(currentInvoice?.total ?? 0),
    },
    stock_by_category: stockByCategory,
    recent_orders: recentOrders,
    recent_requests: recentRequests,
    // Pedidos precisa do acompanhamento completo (etapas, transportadora) e
    // do histórico inteiro; recent_* acima é o recorte do Início.
    order_tracking: customerOrders,
    invoice_history: periods,
    request_history: sortByDateDesc(customerRequests, "created_at"),
    // Documentos publicados para a BTG (client_documents); antes só a
    // contagem chegava ao portal e a tela ficava sempre vazia.
    document_history: sortByDateDesc(customerDocuments, "created_at"),
    invoices: invoiceItems,
    agent_alerts: alertItems,
    alerts: alertItems,
  };
}

function defaultAgentConversationId(
  profile: Awaited<ReturnType<typeof getCurrentProfile>>,
) {
  return safeDocId(`chat_${profile.customer_code}_${profile.uid}`);
}

async function getAgentDuteChat(conversationId?: string) {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  const id = conversationId
    ? safeDocId(conversationId)
    : defaultAgentConversationId(profile);
  if (!firestore)
    return {
      conversation: { id, customer_code: customerCode, status: "active" },
      messages: [],
    };
  // Histórico limitado às mensagens mais recentes: uma conversa cresce sem
  // limite e a tela só mostra o fim dela.
  const messagesRef = collection(firestore, collectionNames.agentMessages);
  const scopeConstraints: QueryConstraint[] = [
    where("conversation_id", "==", id),
    where("customer_code", "==", customerCode),
    where("user_id", "==", profile.uid),
  ];
  let messageSnapshot;
  try {
    messageSnapshot = await getDocs(
      query(
        messagesRef,
        ...scopeConstraints,
        orderBy("created_at_iso", "desc"),
        fsLimit(CHAT_HISTORY_CAP),
      ),
    );
  } catch (error) {
    console.warn(
      "[agent-dute] histórico sem índice composto; reduzindo o escopo mas mantendo a ordem.",
      error,
    );
    // Manter o orderBy é essencial: sem ele o Firestore devolve os 100
    // menores por __name__, e como os ids têm prefixo por papel
    // (msg_agent_* < msg_user_*) o usuário perderia as próprias mensagens.
    // customer_code é redundante aqui — user_id já isola o dono.
    messageSnapshot = await getDocs(
      query(
        messagesRef,
        where("conversation_id", "==", id),
        where("user_id", "==", profile.uid),
        orderBy("created_at_iso", "desc"),
        fsLimit(CHAT_HISTORY_CAP),
      ),
    );
  }
  const messages = messageSnapshot.docs
    .map(normalizeDoc)
    .sort((left, right) =>
      String(left.created_at_iso ?? "").localeCompare(
        String(right.created_at_iso ?? ""),
      ),
    )
    .map((message) => ({
      id: String(message.id ?? message._docId),
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
      created_at: String(message.created_at_iso ?? toIso(message.created_at)),
      source: String(message.source ?? ""),
      tools_used: Array.isArray(message.tools_used)
        ? message.tools_used.map(String)
        : [],
      draft: message.draft,
      draft_sent: message.draft_sent,
      attachments: Array.isArray(message.attachments)
        ? (message.attachments as Array<Record<string, unknown>>).map((file) => ({
            file_name: String(file.file_name ?? "anexo"),
            storage_path: String(file.storage_path ?? ""),
          }))
        : undefined,
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

const CONVERSATION_LIST_CAP = 60;

/** Conversas da pessoa com o Agent Dute, da mais recente para a mais antiga. */
async function getAgentDuteConversations() {
  const profile = await getCurrentProfile();
  const customerCode = String(profile.customer_code || DEFAULT_CUSTOMER.code);
  if (!firestore) return { conversations: [] };
  const conversationsRef = collection(firestore, collectionNames.agentConversations);
  const scope = [
    where("user_id", "==", profile.uid),
    where("customer_code", "==", customerCode),
  ];
  let snapshot;
  try {
    snapshot = await getDocs(
      query(conversationsRef, ...scope, orderBy("last_message_at", "desc"), fsLimit(CONVERSATION_LIST_CAP)),
    );
  } catch (error) {
    // Sem o índice composto (ainda não publicado), lê sem ordem e ordena aqui.
    console.warn("[agent-dute] lista de conversas sem índice composto.", error);
    snapshot = await getDocs(query(conversationsRef, ...scope, fsLimit(200)));
  }
  const conversations = snapshot.docs
    .map(normalizeDoc)
    .map((conversation) => ({
      id: String(conversation.id ?? conversation._docId),
      title: String(conversation.title ?? "").trim() || "Conversa",
      last_message_at: String(conversation.last_message_at ?? ""),
      ...(conversation.routine_id ? { routine_id: String(conversation.routine_id) } : {}),
    }))
    .filter((conversation) => conversation.last_message_at)
    .sort((left, right) => right.last_message_at.localeCompare(left.last_message_at))
    .slice(0, CONVERSATION_LIST_CAP);
  return { conversations };
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

const OPEN_QUALITY_EXCEPTION_STATUSES = new Set(["open", "in_review"]);

/** Exceção em aberto, como o servidor lê na resolução: sem status é "open". */
export function isOpenQualityException(exception: { status?: unknown }): boolean {
  return OPEN_QUALITY_EXCEPTION_STATUSES.has(String(exception.status ?? "open"));
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
    readLimited(collectionNames.skus, CATALOG_READ_CAP),
    readLimited(collectionNames.movements, RECENT_MOVEMENTS_CAP, "data", "desc"),
    readLimited(collectionNames.orders, OPS_TASK_READ_CAP, "data_solic", "desc"),
    readLimited(collectionNames.locations, CATALOG_READ_CAP),
    readLimited(collectionNames.stockBalances, CATALOG_READ_CAP),
    readLimited(collectionNames.inboundReceipts, OPS_TASK_READ_CAP, "created_at", "desc"),
    readLimited(collectionNames.inboundItems, OPS_TASK_READ_CAP),
    readLimited(collectionNames.putawayTasks, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.qualityExceptions, OPS_TASK_READ_CAP, "created_at", "desc"),
    readLimited(collectionNames.orderItems, OPS_TASK_READ_CAP),
    readLimited(collectionNames.stockReservations, OPS_TASK_READ_CAP),
    readLimited(collectionNames.pickTasks, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.pickLines, OPS_TASK_READ_CAP),
    readLimited(collectionNames.packTasks, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.shipments, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.agentInbox, 100, "created_at", "desc"),
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
          ["FATURADO", "ENTREGUE"].includes(
            String(order.status ?? "").toUpperCase(),
          ),
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
  const derivedPutawayTasks: AnyRecord[] = putawayTasks;
  const inboundItemsByReceipt = groupByField(inboundItems, "receipt_id");
  const pickLinesByTask = groupByField(pickLines, "pick_task_id");
  const orderItemsByOrder = groupByField(orderItems, "order_id");
  const reservationsByOrder = groupByField(stockReservations, "order_id");

  const isHistoricalMovementReceipt = (receipt: AnyRecord) =>
    String(receipt.source ?? "").toLowerCase() === "derived_from_movements";
  const isHistoricalLocationPutaway = (task: AnyRecord) =>
    String(task.source ?? "").toLowerCase() === "derived_from_locations";

  // Só a exceção em aberto conta: resolver ou cancelar em Qualidade tira a
  // tarefa e o pedido de "com exceção", como o servidor baixa a contagem.
  const openExceptions = qualityExceptions.filter(isOpenQualityException);
  const exceptionCountFor = (...ids: Array<string | undefined>) => {
    const idSet = new Set(ids.filter(Boolean).map(String));
    if (!idSet.size) return 0;
    return openExceptions.filter((exception) =>
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

  const timelineForTask = (
    task: AnyRecord,
    createdTitle: string,
  ): AnyRecord[] =>
    [
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
    ].filter(Boolean) as AnyRecord[];

  const receivingItemsFor = (receipt: AnyRecord) =>
    (inboundItemsByReceipt.get(String(receipt.id)) ?? []).map((item) => ({
      id: item.id,
      sku: item.sku_code,
      sku_code: item.sku_code,
      client_item_code: item.client_item_code,
      name: item.product_name,
      product_name: item.product_name,
      quantity: Number(item.expected_qty ?? item.quantity ?? 0),
      expected_quantity: Number(item.expected_qty ?? item.quantity ?? 0),
      picked_quantity: Number(item.received_qty ?? 0),
      received_qty: Number(item.received_qty ?? 0),
      difference_qty: Number(item.difference_qty ?? 0),
      conference_status: item.conference_status,
      unit_cost: Number(item.unit_cost ?? 0),
      notes: item.notes,
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
      sku_code: line.sku_code,
      client_item_code: line.client_item_code,
      name: line.product_name,
      product_name: line.product_name,
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
      items: derivedReceipts.filter((receipt) => !isHistoricalMovementReceipt(receipt)).map((receipt) => {
        const receiptItems = receivingItemsFor(receipt);
        const expectedUnits = receiptItems.length
          ? receiptItems.reduce(
              (sum, item) => sum + Number(item.expected_quantity ?? 0),
              0,
            )
          : Number(receipt.qty_expected ?? receipt.qty_received ?? 0);
        const receivedUnits = receiptItems.length
          ? receiptItems.reduce(
              (sum, item) => sum + Number(item.picked_quantity ?? 0),
              0,
            )
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
          blocked_reason: exceptions
            ? "Há divergência de recebimento para tratar."
            : undefined,
          customer_request_id: receipt.customer_request_id,
          inbound_id: String(receipt.id),
        });
      }),
    },
    {
      id: "putaway",
      title: "Guarda",
      description: "Guarda e endereçamento",
      items: derivedPutawayTasks.filter((task) => !isHistoricalLocationPutaway(task)).map((task) => {
        const quantity = Number(task.quantity ?? task.total_units ?? 0);
        const destinationLocation = String(
          task.destination_location_id ?? task.location_id ?? "",
        );
        const sourceLocation = String(task.source_location_id ?? "RECEBIMENTO");
        return laneTask({
          id: String(task.id),
          type: "putaway",
          title: String(
            task.title ?? task.product_name ?? task.location_id ?? task.id,
          ),
          subtitle: String(
            destinationLocation || sourceLocation || "Endereço físico",
          ),
          status: String(task.status ?? "planned"),
          customer_code: task.customer_code,
          units: quantity,
          source: task.source,
          updated_at: task.updated_at,
          location: destinationLocation,
          items: [
            {
              id: `${task.id}:putaway`,
              sku: task.sku_code ?? task.sku,
              sku_code: task.sku_code ?? task.sku,
              client_item_code: task.client_item_code,
              name: task.product_name ?? task.title,
              product_name: task.product_name ?? task.title,
              quantity,
              expected_quantity: quantity,
              status: task.status,
              location: destinationLocation,
              source_location_id: sourceLocation,
              destination_location_id: destinationLocation,
            },
          ],
          timeline: timelineForTask(task, "Putaway criado"),
          exception_count: exceptionCountFor(String(task.id)),
        });
      }),
    },
    {
      id: "picking",
      title: "Picking",
      description: "Separação por pedido",
      items: derivedPickTasks.map((task) => {
        const taskItems = pickingItemsFor(task);
        const reserved =
          reservationsByOrder.get(String(task.order_id ?? "")) ?? [];
        const totalUnits = taskItems.length
          ? taskItems.reduce(
              (sum, item) => sum + Number(item.expected_quantity ?? 0),
              0,
            )
          : Number(task.total_units ?? 0);
        const pickedUnits = taskItems.length
          ? taskItems.reduce(
              (sum, item) => sum + Number(item.picked_quantity ?? 0),
              0,
            )
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
          blocked_reason: exceptions
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
          // A conclusão do packing exige packing_lines com o id de cada
          // order_item; a bancada simplificada monta o payload daqui.
          items: (orderItemsByOrder.get(String(task.order_id ?? "")) ?? []).map(
            (line) => ({
              id: line.id,
              sku: line.sku_code,
              sku_code: line.sku_code,
              name: line.product_name,
              product_name: line.product_name,
              quantity: Number(line.requested_qty ?? 0),
              picked_quantity: Number(line.picked_qty ?? 0),
            }),
          ),
          timeline: timelineForTask(task, "Packing criado"),
          exception_count: exceptionCountFor(
            String(task.id),
            String(task.order_id ?? ""),
          ),
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
          exception_count: exceptionCountFor(
            String(task.id),
            String(task.order_id ?? ""),
          ),
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
  // Pedidos, Receber e o Início leem estas filas: toda tarefa aberta entra,
  // por mais antiga que seja. O pedido entra com todas as etapas ou não
  // entra (o que ainda não saiu e os encerrados mais recentes, pela última
  // etapa), para a linha do pedido entregue não ficar só com a separação e
  // aparecer em "Para separar". Das outras filas, as encerradas mais recentes.
  const isClosedTask = (task: AnyRecord) => OPS_CLOSED_TASK_STATUSES.has(String(task.status));
  const orderLanes = new Set(["picking", "packing", "shipping"]);
  const orderTasks = lanes
    .filter((lane) => orderLanes.has(lane.id))
    .flatMap((lane) => lane.items)
    .filter((task) => task.order_id);
  const openOrderIds = new Set(
    orderTasks.filter((task) => !isClosedTask(task)).map((task) => String(task.order_id)),
  );
  const closedOrderUpdates = new Map<string, string>();
  for (const task of orderTasks) {
    const orderId = String(task.order_id);
    if (openOrderIds.has(orderId)) continue;
    const updatedAt = String(task.updated_at ?? "");
    const latest = closedOrderUpdates.get(orderId);
    if (latest === undefined || updatedAt > latest) closedOrderUpdates.set(orderId, updatedAt);
  }
  const queuedOrderIds = new Set([
    ...openOrderIds,
    ...[...closedOrderUpdates]
      .sort(([, left], [, right]) => right.localeCompare(left))
      .slice(0, OPS_CLOSED_TASKS_IN_QUEUE)
      .map(([orderId]) => orderId),
  ]);
  const queueItems = (laneId: string, items: AnyRecord[]) => {
    let closed = 0;
    return items.filter((task) => {
      if (orderLanes.has(laneId) && task.order_id) return queuedOrderIds.has(String(task.order_id));
      if (!isClosedTask(task)) return true;
      closed += 1;
      return closed <= OPS_CLOSED_TASKS_IN_QUEUE;
    });
  };

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
        const tasks = queueItems(lane.id, lane.items).map((task) => ({
          id: task.task_uid,
          title: task.title,
          reference: task.id,
          sku: task.items[0]?.sku ?? task.subtitle,
          customer: task.customer_code,
          location:
            task.location ||
            task.items[0]?.location ||
            (task.type === "putaway" ? task.subtitle : undefined),
          quantity: task.units,
          priority: task.priority,
          status: task.status,
          due_at: task.due_at || task.updated_at || undefined,
          next_action:
            task.status === "completed" ||
            task.status === "delivered" ||
            task.status === "received"
              ? "Fluxo registrado. Acompanhar documentação e billing."
              : "Avançar para a próxima etapa operacional.",
          notes: task.blocked_reason
            ? task.blocked_reason
            : task.source === "derived_from_orders" ||
                task.source === "derived_from_skus"
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
            !["completed", "delivered", "received"].includes(
              String(task.status),
            ),
          progress:
            task.status === "completed" ||
            task.status === "delivered" ||
            task.status === "received"
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
              (task) =>
                !["completed", "delivered", "received"].includes(
                  String(task.status),
                ),
            ).length,
            in_progress: tasks.filter((task) =>
              ["in_progress", "checking", "dispatched"].includes(
                String(task.status),
              ),
            ).length,
            completed_today: tasks.filter((task) =>
              ["completed", "delivered", "received"].includes(
                String(task.status),
              ),
            ).length,
            sla_minutes: 180,
            utilization: tasks.length
              ? (tasks.filter((task) =>
                  ["completed", "delivered", "received"].includes(
                    String(task.status),
                  ),
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

async function readOperationalFoundationInput() {
  const viewer = await getCurrentProfile();
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
    readLimited(collectionNames.customers, 500),
    readLimited(collectionNames.customerAccounts, 500),
    readLimited(collectionNames.locations, CATALOG_READ_CAP),
    readLimited(collectionNames.stockBalances, CATALOG_READ_CAP),
    readLimited(collectionNames.inboundReceipts, OPS_TASK_READ_CAP, "created_at", "desc"),
    readLimited(collectionNames.orderItems, OPS_TASK_READ_CAP),
    readLimited(collectionNames.pickTasks, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.packTasks, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.shipments, OPS_TASK_READ_CAP, "updated_at", "desc"),
    readLimited(collectionNames.documents, OPS_TASK_READ_CAP, "created_at", "desc"),
    readLimited(collectionNames.skus, CATALOG_READ_CAP),
    readLimited(collectionNames.movements, RECENT_MOVEMENTS_CAP, "data", "desc"),
    readLimited(collectionNames.orders, OPS_TASK_READ_CAP, "data_solic", "desc"),
    // A lista de usuários é de quem administra o acesso (canManageAccess nas
    // regras). Para o interno e o suporte, a consulta seria negada e levaria a
    // base inteira: segue sem as contas de cliente derivadas dos logins.
    canListUsers(viewer.role) ? readLimited(collectionNames.users, 200) : Promise.resolve([] as AnyRecord[]),
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
  return buildOperationalFoundationSnapshot(
    await readOperationalFoundationInput(),
  );
}

async function getBillingConfig() {
  if (!firestore) throw new Error("Firestore não configurado.");
  const ref = doc(firestore, "billing_config", "default");
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return { id: 1, ...snapshot.data() };
  return {
    id: 1,
    cliente_nome: LEGACY_CUSTOMER_CODE,
    cliente_email: "",
    ad_valorem_rate: 0.005,
  };
}

function sortByDateDesc(items: AnyRecord[], field: string) {
  return [...items].sort((a, b) =>
    toIso(b[field]).localeCompare(toIso(a[field])),
  );
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
      `Documento real vinculado ao cliente ${item.customer_code ?? LEGACY_CUSTOMER_CODE}.`,
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
      (Number(product.preco_unit ?? 0) <= 0 ||
        Number(product.custo_total ?? 0) <= 0),
  );
  const openOrders = orders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  );
  const zeroStockSkus = skus.filter(
    (sku) => Number(sku.estoque_atual ?? 0) <= 0,
  );
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const currentBilling = periods.find(
    (period) => period.competencia === currentPeriod,
  );
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
          customer_code: LEGACY_CUSTOMER_CODE,
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
          customer_code: LEGACY_CUSTOMER_CODE,
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
          customer_code: LEGACY_CUSTOMER_CODE,
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
          customer_code: LEGACY_CUSTOMER_CODE,
          created_at: new Date().toISOString(),
        }
      : null,
    !latestMovement
      ? {
          id: "derived_no_movements",
          title: "Sem movimentações registradas",
          message:
            "Ainda não encontrei movimentações para montar histórico operacional.",
          priority: "normal",
          status: "open",
          entity_type: "movimentacao",
          entity_id: null,
          customer_code: LEGACY_CUSTOMER_CODE,
          created_at: new Date().toISOString(),
        }
      : null,
  ].filter(Boolean);
}

async function getAiOverview() {
  const viewer = await getCurrentProfile();
  const showMoney = canSeeCatalogPrice(viewer.role);
  const [
    aggregate,
    products,
    skus,
    movements,
    orders,
    periods,
    events,
    inbox,
    memory,
    knowledge,
  ] = await Promise.all([
    readOpsAggregate("dashboard"),
    readLimited(collectionNames.products, CATALOG_READ_CAP),
    readLimited(collectionNames.skus, CATALOG_READ_CAP),
    readLimited(collectionNames.movements, RECENT_MOVEMENTS_CAP, "data", "desc"),
    readLimited(collectionNames.orders, OPS_TASK_READ_CAP, "data_solic", "desc"),
    // Papéis sem canReadBilling (ex.: coordenador, por decisão de produto)
    // recebem permission-denied aqui; a visão geral segue de pé sem o sinal
    // de faturamento em vez de morrer no Promise.all.
    readLimited(collectionNames.periods, 120, "competencia", "desc").catch(
      () => [] as AnyRecord[],
    ),
    readLimited(collectionNames.events, RECENT_EVENTS_CAP, "occurred_at", "desc"),
    readLimited(collectionNames.agentInbox, 100, "created_at", "desc"),
    readLimited(collectionNames.agentMemory, 50, "updated_at", "desc"),
    readLimited(collectionNames.agentKnowledge, 50, "updated_at", "desc"),
  ]);

  const inventoryValue = Number(
    aggregate?.custo_total ??
      products.reduce((sum, product) => sum + Number(product.custo_total ?? 0), 0),
  );
  const totalPieces = Number(
    aggregate?.total_pecas ??
      skus.reduce((sum, sku) => sum + Number(sku.estoque_atual ?? 0), 0),
  );
  const productCount = Number(aggregate?.total_produtos ?? products.length);
  const skuCount = Number(aggregate?.total_skus ?? skus.length);
  const missingCostCount = products.filter(
    (product) =>
      Number(product.estoque_btg ?? 0) > 0 &&
      (Number(product.preco_unit ?? 0) <= 0 ||
        Number(product.custo_total ?? 0) <= 0),
  ).length;
  const openOrderCount = orders.filter((order) =>
    OPEN_ORDER_STATUSES.has(String(order.status ?? "").toUpperCase()),
  ).length;
  const actualEvents = sortByDateDesc(events.map(eventView), "occurred_at");
  const derivedTimeline = sortByDateDesc(movements, "data")
    .slice(0, 12)
    .map(derivedEventFromMovement);
  const timeline = actualEvents.length
    ? actualEvents.slice(0, 80)
    : derivedTimeline;
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
      scope_id: LEGACY_CUSTOMER_CODE,
      title: LEGACY_CUSTOMER_CODE,
      event_count:
        movements.length + orders.length + periods.length + events.length,
      last_event_title: latestEvent?.title ?? "Base importada",
      last_event_at: latestEvent?.occurred_at ?? toIso(latestMovement?.data),
      summary: `${productCount.toLocaleString("pt-BR")} produto(s), ${skuCount.toLocaleString("pt-BR")} SKU(s), ${totalPieces.toLocaleString("pt-BR")} peça(s) em acompanhamento.`,
    },
    {
      id: "derived_inventory",
      scope_type: "estoque",
      scope_id: LEGACY_CUSTOMER_CODE,
      title: `Estoque ${LEGACY_CUSTOMER_CODE}`,
      event_count:
        movements.length +
        events.filter((event) => String(event.type).startsWith("inventory."))
          .length,
      last_event_title: latestMovement
        ? `${latestMovement.tipo_mov} - ${latestMovement.cod_sku}`
        : "Sem movimentação",
      last_event_at: toIso(latestMovement?.data),
      summary: showMoney
        ? `Valor monitorado de ${inventoryValue.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })}.`
        : `${totalPieces.toLocaleString("pt-BR")} peça(s) em acompanhamento.`,
    },
    ...sortByDateDesc(
      knowledge.map(knowledgeMemoryView),
      "last_event_at",
    ).slice(0, 12),
    ...sortByDateDesc(memory.map(memoryView), "updated_at").slice(0, 18),
  ];

  return {
    snapshot: {
      total_events: events.length,
      derived_events: actualEvents.length ? 0 : derivedTimeline.length,
      open_insights: persistentInsights.length + derivedInsights.length,
      inventory_value: showMoney ? inventoryValue : null,
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

async function route(
  pathname: string,
  method: HttpMethod,
  searchParams: URLSearchParams,
  init?: RequestInit,
) {
  if (!firestore) return json({ message: "Firebase não configurado." }, 503);

  if (pathname === "/api/healthz") return json({ ok: true });
  if (pathname === "/api/dashboard") return json(await getDashboard());
  if (pathname === "/api/ai/overview" && method === "GET") {
    return json(await getAiOverview());
  }
  if (pathname === "/api/operational/foundation" && method === "GET") {
    return json(await getOperationalFoundation());
  }
  if (pathname === "/api/client/overview" && method === "GET") {
    return json(await getClientOverview());
  }
  if (pathname === "/api/client/profile" && method === "GET") {
    return json(await getClientProfile());
  }
  if (pathname === "/api/agent-dute/conversations" && method === "GET") {
    return json(await getAgentDuteConversations());
  }
  if (pathname === "/api/agent-dute/chat" && method === "GET") {
    return json(
      await getAgentDuteChat(searchParams.get("conversation_id") ?? undefined),
    );
  }
  if (pathname === "/api/warehouse/ops" && method === "GET") {
    return json(await getWarehouseOps());
  }


  if (pathname === "/api/products/stats") {
    const aggregate = await readOpsAggregate("dashboard");
    if (Array.isArray(aggregate?.by_category) && aggregate.by_category.length) {
      return json(aggregate.by_category);
    }
    return json(
      categoryStats(
        await readLimited(collectionNames.products, CATALOG_READ_CAP),
      ),
    );
  }

  type ListRouteConfig = {
    regex: RegExp;
    name: string;
    filters: string[];
    searchFields: string[];
    orderByField: string;
    direction?: "asc" | "desc";
    equalityFilterFields?: string[];
    hardCap?: number;
    requireIndexedRead?: boolean;
    /** Campo com índice que suporta busca por prefixo no servidor. */
    prefixSearchField?: string;
  };

  const listRoutes: ListRouteConfig[] = [
    // Perfis de operação publicados (cliente ativo da área interna).
    {
      regex: /^\/api\/client-profiles$/,
      name: collectionNames.clientProfiles,
      filters: [],
      searchFields: ["customer_code", "name"],
      orderByField: "name",
      direction: "asc",
      hardCap: 500,
    },
    {
      regex: /^\/api\/customers$/,
      name: collectionNames.customers,
      filters: ["status"],
      searchFields: ["code", "name"],
      orderByField: "name",
      direction: "asc",
      equalityFilterFields: ["status"],
      hardCap: 500,
    },
    {
      regex: /^\/api\/customer-accounts$/,
      name: collectionNames.customerAccounts,
      filters: ["customer_code", "status"],
      searchFields: ["email", "name", "user_id"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/customer-requests$/,
      name: collectionNames.customerRequests,
      filters: ["customer_code", "status", "priority"],
      searchFields: ["title", "description", "type"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/agent-dute\/notifications$/,
      name: collectionNames.operationalNotifications,
      filters: ["customer_code", "status", "audience", "topic"],
      searchFields: ["title", "subject", "body", "trigger_event_type"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/products$/,
      name: collectionNames.products,
      filters: ["categoria", "grupo", "genero"],
      searchFields: ["cod_cliente", "produto", "categoria", "grupo"],
      orderByField: "produto",
      equalityFilterFields: ["categoria"],
      hardCap: CATALOG_READ_CAP,
    },
    {
      regex: /^\/api\/skus$/,
      name: collectionNames.skus,
      filters: ["cod_cliente", "rua", "prateleira", "estoque_tipo"],
      searchFields: ["cod_btg", "cod_cliente", "produto"],
      orderByField: "cod_btg",
      equalityFilterFields: ["cod_cliente"],
      hardCap: CATALOG_READ_CAP,
    },
    {
      // Mapa do galpão: as prateleiras cadastradas, em ordem de caminhada.
      regex: /^\/api\/warehouse\/positions$/,
      name: collectionNames.warehousePositions,
      filters: ["aisle", "customer_code", "status"],
      searchFields: ["code", "aisle"],
      orderByField: "sequence",
      direction: "asc",
      equalityFilterFields: ["aisle", "customer_code", "status"],
      hardCap: 2000,
      requireIndexedRead: true,
    },
    {
      // Caixas guardadas: a mais recente primeiro (o código é sequencial).
      regex: /^\/api\/warehouse\/boxes$/,
      name: collectionNames.warehouseBoxes,
      filters: ["customer_code", "location_id", "status"],
      searchFields: ["code", "location_id"],
      orderByField: "code",
      direction: "desc",
      equalityFilterFields: ["customer_code", "location_id", "status"],
      hardCap: 5000,
      requireIndexedRead: true,
    },
    {
      regex: /^\/api\/locations$/,
      name: collectionNames.locations,
      filters: ["warehouse_code", "aisle", "shelf", "status"],
      searchFields: ["label", "aisle", "shelf", "bin"],
      orderByField: "label",
      equalityFilterFields: ["status", "warehouse_code"],
      hardCap: CATALOG_READ_CAP,
    },
    {
      regex: /^\/api\/stock-balances$/,
      name: collectionNames.stockBalances,
      filters: ["customer_code", "sku_code", "location_id", "status"],
      searchFields: ["sku_code", "client_item_code", "product_name", "location_id"],
      orderByField: "sku_code",
      equalityFilterFields: ["customer_code", "status", "sku_code"],
      hardCap: CATALOG_READ_CAP,
    },
    {
      regex: /^\/api\/movements$/,
      name: collectionNames.movements,
      filters: ["cod_sku", "tipo_mov", "responsavel"],
      searchFields: ["cod_sku", "produto", "doc_nf"],
      orderByField: "data",
      equalityFilterFields: ["cod_sku", "tipo_mov"],
      prefixSearchField: "cod_sku",
      hardCap: 500,
    },
    {
      regex: /^\/api\/inbound$/,
      name: collectionNames.inboundReceipts,
      filters: ["customer_code", "status"],
      searchFields: ["receipt_number"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/returns$/,
      name: collectionNames.returns,
      filters: ["customer_code", "status"],
      searchFields: ["reference", "source"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/return-items$/,
      name: collectionNames.returnItems,
      filters: ["customer_code", "status", "return_id"],
      searchFields: ["sku_code", "client_item_code", "product_name"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status", "return_id"],
    },
    {
      regex: /^\/api\/quality-exceptions$/,
      name: collectionNames.qualityExceptions,
      filters: ["customer_code", "status", "severity", "task_type"],
      searchFields: ["note", "reference", "task_uid"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/putaway\/tasks$/,
      name: collectionNames.putawayTasks,
      filters: ["customer_code", "status", "location_id"],
      searchFields: ["location_id", "title"],
      orderByField: "updated_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/orders$/,
      name: collectionNames.orders,
      filters: ["status", "num_pedido", "solicitante"],
      searchFields: ["num_pedido", "produto", "solicitante"],
      orderByField: "data_solic",
      equalityFilterFields: ["status"],
    },
    {
      regex: /^\/api\/order-items$/,
      name: collectionNames.orderItems,
      filters: ["customer_code", "status", "order_number"],
      searchFields: ["order_number", "sku_code", "product_name"],
      orderByField: "order_number",
      equalityFilterFields: ["customer_code", "status", "order_number"],
    },
    {
      regex: /^\/api\/picking\/tasks$/,
      name: collectionNames.pickTasks,
      filters: ["customer_code", "status", "order_number"],
      searchFields: ["order_number", "assigned_to"],
      orderByField: "updated_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/packing\/tasks$/,
      name: collectionNames.packTasks,
      filters: ["customer_code", "status", "order_number"],
      searchFields: ["order_number"],
      orderByField: "updated_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/shipments$/,
      name: collectionNames.shipments,
      filters: ["customer_code", "status"],
      searchFields: ["order_number", "destination"],
      orderByField: "updated_at",
      equalityFilterFields: ["customer_code", "status"],
    },
    {
      regex: /^\/api\/documents$/,
      name: collectionNames.documents,
      filters: ["customer_code", "entity_type"],
      searchFields: ["file_name", "entity_id"],
      orderByField: "created_at",
      equalityFilterFields: ["customer_code", "entity_type"],
    },
    {
      regex: /^\/api\/billing\/price-list$/,
      name: collectionNames.priceList,
      filters: [],
      searchFields: ["item", "grupo"],
      orderByField: "item",
      hardCap: 500,
    },
    {
      regex: /^\/api\/billing\/users$/,
      name: collectionNames.users,
      filters: [],
      searchFields: ["nome", "email"],
      orderByField: "email",
      hardCap: 500,
    },
  ];

  for (const routeConfig of listRoutes) {
    if (routeConfig.regex.test(pathname) && method === "GET") {
      const equalityFilters = (routeConfig.equalityFilterFields ?? [])
        .map((field) => {
          const value = searchParams.get(field);
          return value ? { field, value } : null;
        })
        .filter(Boolean) as Array<{ field: string; value: string }>;

      // Prefer a single equality filter that matches declared composite indexes.
      const preferredFilters =
        equalityFilters.length <= 1
          ? equalityFilters
          : equalityFilters.slice(0, 1);

      const readRoute = (params: URLSearchParams) =>
        readPaged(routeConfig.name, {
          orderByField: routeConfig.orderByField,
          direction: routeConfig.direction,
          equalityFilters: preferredFilters,
          searchFields: routeConfig.searchFields,
          prefixSearchField: routeConfig.prefixSearchField,
          // Filtros da rota que sobram para a memória invalidam o total exato.
          inMemoryFilterFields: routeConfig.filters.filter(
            (field) => !preferredFilters.some((filter) => filter.field === field),
          ),
          params,
          hardCap: routeConfig.hardCap,
          requireIndexedRead: routeConfig.requireIndexedRead,
        });

      // O prospect do Comercial mora em `customers` mas não é cliente do WMS:
      // some de Configurações › Clientes, do convite e de Posições. Filtro em
      // memória de propósito: cadastro sem `stage` é cliente, e um where()
      // em `stage` excluiria os legados (a BTG).
      const hideProspects =
        routeConfig.name === collectionNames.customers &&
        searchParams.get("include_prospects") !== "true";

      // Filtros que rodam em memória sobre as linhas já lidas.
      const applyMemoryFilters = (rows: AnyRecord[]): AnyRecord[] => {
        let kept = rows;
        for (const field of routeConfig.filters) {
          if (preferredFilters.some((f) => f.field === field)) continue;
          const value = searchParams.get(field);
          if (value) kept = kept.filter((row) => includes(row[field], value));
        }
        // "Excluir" arquiva o registro (mutateManagedEntity action=archive);
        // sem esconder aqui, o item continua aparecendo na lista para sempre.
        // Também em memória: um where() excluiria os documentos legados que
        // não têm o campo.
        if (searchParams.get("include_archived") !== "true") {
          kept = kept.filter(
            (row) => row.archived !== true && row.status !== "archived",
          );
        }
        if (hideProspects) {
          kept = kept.filter((row) => estagioDoCadastro(row.stage) !== "prospect");
        }
        return kept;
      };

      let result = await readRoute(searchParams);
      let items = applyMemoryFilters(result.items);

      if (hideProspects) {
        // Os filtros acima rodam depois do limite da página: com centenas de
        // prospects no começo da ordem alfabética, a página inteira podia ser
        // só prospect e os clientes reais sumiam. Continua lendo as páginas
        // seguintes (cursor) até completar o limite pedido ou acabar a
        // coleção. Teto: CUSTOMER_SCAN_MAX_READS leituras e
        // CUSTOMER_SCAN_MAX_DOCS documentos no total.
        const requested = Number(searchParams.get("limit"));
        const wanted = Math.max(
          1,
          Math.min(
            requested > 0 ? requested : DEFAULT_LIST_LIMIT,
            routeConfig.hardCap ?? HARD_LIST_CAP,
          ),
        );
        const startedAtBeginning =
          !searchParams.get("cursor") && !Number(searchParams.get("offset") ?? 0);
        let reads = 1;
        let scanned = result.items.length;
        while (
          items.length < wanted &&
          result.has_more &&
          result.next_cursor &&
          reads < CUSTOMER_SCAN_MAX_READS &&
          scanned < CUSTOMER_SCAN_MAX_DOCS
        ) {
          // Páginas de pelo menos CUSTOMER_SCAN_MIN_PAGE linhas: pedir só o
          // que falta gastaria o teto de leituras em limites pequenos.
          const next = new URLSearchParams(searchParams);
          next.set(
            "limit",
            String(Math.max(wanted - items.length, CUSTOMER_SCAN_MIN_PAGE)),
          );
          next.set("cursor", result.next_cursor);
          next.delete("offset");
          result = await readRoute(next);
          reads += 1;
          scanned += result.items.length;
          items = items.concat(applyMemoryFilters(result.items));
        }
        // A última página pode trazer mais que o faltante: corta no limite.
        // Sobrou linha, então o cursor (que apontaria para depois dela)
        // deixa de valer; nenhuma tela pagina esta lista.
        if (items.length > wanted) {
          items = items.slice(0, wanted);
          result = { ...result, has_more: true, next_cursor: undefined };
        }
        // Coleção esgotada a partir do começo: o total exato é o que sobrou.
        if (startedAtBeginning && !result.has_more) {
          result = { ...result, total: items.length };
        }
      }

      const moneyCollections = new Set<string>([
        collectionNames.products,
        collectionNames.skus,
        collectionNames.stockBalances,
        collectionNames.clientInventory,
      ]);
      if (moneyCollections.has(routeConfig.name)) {
        let showPrice = false;
        try {
          const profile = await getCurrentProfile();
          showPrice = canSeeCatalogPrice(profile.role);
        } catch {
          showPrice = false;
        }
        if (!showPrice) {
          items = items.map(stripPublishedMoney);
        } else if (routeConfig.name === collectionNames.products) {
          const prices = await readCatalogPriceIndex();
          items = items.map((product) => {
            const code = String(product.cod_cliente ?? "");
            const unit =
              unitFromPriceIndex(prices, code, code) ??
              (product.preco_unit as number | undefined);
            const numeric = Number(unit);
            const qty = Number(product.estoque_btg ?? 0);
            if (!Number.isFinite(numeric)) return product;
            return {
              ...product,
              preco_unit: numeric,
              custo_total: qty * numeric,
            };
          });
        }
      }

      return json({
        items,
        total: result.total,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      });
    }
  }

  if (pathname === "/api/warehouse/map") return json(await getWarehouseMap());
  if (pathname === "/api/stock-alerts" && method === "GET") return json(await getStockAlerts());
  if (pathname === "/api/stock-age" && method === "GET") return json(await getStockAge(searchParams.get("customer_code") ?? ""));

  // Relatórios (pages/reports.tsx): período filtrado na consulta, não na
  // tela. O ledger grava `data` em ISO; os pedidos, `created_at` Timestamp.
  if (pathname === "/api/reports/movements" && method === "GET") {
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    if (!from || !to) return json({ message: "Informe from e to." }, 400);
    if (!firestore) return json({ items: [], capped: false });
    const snapshot = await getDocs(
      query(
        collection(firestore, collectionNames.movements),
        where("data", ">=", from),
        where("data", "<", to),
        orderBy("data", "desc"),
        fsLimit(EXPORT_HARD_CAP),
      ),
    );
    return json({
      items: snapshot.docs.map(normalizeDoc),
      capped: snapshot.size >= EXPORT_HARD_CAP,
    });
  }

  if (pathname === "/api/reports/requests" && method === "GET") {
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    if (!from || !to) return json({ message: "Informe from e to." }, 400);
    if (!firestore) return json({ items: [], capped: false });
    const snapshot = await getDocs(
      query(
        collection(firestore, collectionNames.customerRequests),
        where("created_at", ">=", Timestamp.fromDate(new Date(from))),
        where("created_at", "<", Timestamp.fromDate(new Date(to))),
        orderBy("created_at", "desc"),
        fsLimit(EXPORT_HARD_CAP),
      ),
    );
    return json({
      items: snapshot.docs.map(normalizeDoc),
      capped: snapshot.size >= EXPORT_HARD_CAP,
    });
  }

  if (pathname === "/api/billing/config" && method === "GET") {
    return json(await getBillingConfig());
  }

  if (pathname === "/api/billing/periods" && method === "GET") {
    const profile = await getCurrentProfile();
    // Os meses do cliente que a tela do Faturamento mostra (lib/active-customer.ts).
    const customer =
      profile.role === "cliente" ? String(profile.customer_code) : clienteDaChamada(init);
    if (!customer) throw new RouteError("A tela não disse o cliente do faturamento.", 400);
    const periods = await readLimited(
      collectionNames.periods,
      120,
      "competencia",
      "desc",
    );
    return json({
      items: periods.filter((period) => periodBelongsToCustomer(period, customer)),
    });
  }

  // Leitura de um registro operacional pelo id. Este roteador só lê: toda
  // gravação passa pelas Cloud Functions (functions-api.ts).
  const operationalEntityCollections: Record<string, string> = {
    "customer-requests": collectionNames.customerRequests,
    locations: collectionNames.locations,
    "stock-balances": collectionNames.stockBalances,
    inbound: collectionNames.inboundReceipts,
    "putaway/tasks": collectionNames.putawayTasks,
    "order-items": collectionNames.orderItems,
    "picking/tasks": collectionNames.pickTasks,
    "packing/tasks": collectionNames.packTasks,
    shipments: collectionNames.shipments,
  };
  const operationalEntityMatch = pathname.match(
    /^\/api\/(customer-requests|locations|stock-balances|inbound|putaway\/tasks|order-items|picking\/tasks|packing\/tasks|shipments)(?:\/([^/]+))?$/,
  );
  if (operationalEntityMatch) {
    const name = operationalEntityCollections[operationalEntityMatch[1]];
    const id = operationalEntityMatch[2];

    if (id && method === "GET") return json(await readItem(name, decodeURIComponent(id)));
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
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase() as HttpMethod;
      // Rotas com backend em Cloud Functions são sempre atendidas por ele;
      // não existe fallback client-side para mutações do ledger.
      const functionsResponse = await callFunctionsApi(
        url.pathname,
        method,
        init,
      );
      if (functionsResponse) return functionsResponse;

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
