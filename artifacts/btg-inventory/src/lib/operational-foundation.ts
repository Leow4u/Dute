import {
  OPERATIONAL_MODULES,
  type OperationalModuleStatus,
} from "./operational-modules";

export type AnyOperationalRecord = Record<string, any>;

export type OperationalCollectionContract = {
  id: string;
  moduleId: string;
  title: string;
  status: OperationalModuleStatus;
  purpose: string;
  keyFields: string[];
  eventTypes: string[];
  aiFlows: string[];
  sourceOfTruth: string[];
};

export type OperationalFoundationSnapshot = {
  customer: {
    code: string;
    name: string;
    source: string;
  };
  metrics: {
    collections: number;
    modules: number;
    customers: number;
    customer_accounts: number;
    locations: number;
    stock_balances: number;
    inbound_receipts: number;
    order_items: number;
    pick_tasks: number;
    pack_tasks: number;
    shipments: number;
    documents: number;
    derived_locations: number;
    derived_stock_balances: number;
    open_orders: number;
  };
  contracts: OperationalCollectionContract[];
  derived: {
    locations: AnyOperationalRecord[];
    stock_balances: AnyOperationalRecord[];
    order_items: AnyOperationalRecord[];
    inbound_receipts: AnyOperationalRecord[];
    pick_tasks: AnyOperationalRecord[];
    pack_tasks: AnyOperationalRecord[];
  };
};

export const DEFAULT_CUSTOMER = {
  code: "BTG Pactual",
  id: "btg-pactual",
  name: "BTG Pactual",
};

export const OPERATIONAL_COLLECTION_CONTRACTS: OperationalCollectionContract[] =
  OPERATIONAL_MODULES.flatMap((module) =>
    module.collections.map((collection) => ({
      id: collection,
      moduleId: module.id,
      title: collection.replace(/_/g, " "),
      status: module.status,
      purpose: module.purpose,
      keyFields: keyFieldsForCollection(collection),
      eventTypes: module.eventTypes,
      aiFlows: module.aiFlows,
      sourceOfTruth: sourceOfTruthForCollection(collection),
    })),
  ).filter(
    (contract, index, all) =>
      all.findIndex((item) => item.id === contract.id) === index,
  );

function keyFieldsForCollection(collection: string) {
  const fields: Record<string, string[]> = {
    customers: ["code", "name", "status"],
    customer_accounts: ["customer_code", "user_id", "role"],
    customer_requests: ["customer_code", "type", "priority", "status"],
    products: ["customer_code", "client_item_code", "produto", "preco_unit"],
    skus: ["customer_code", "sku_code", "client_item_code", "produto"],
    locations: ["warehouse_code", "aisle", "shelf", "bin"],
    stock_balances: ["customer_code", "sku_code", "location_id", "qty_on_hand"],
    inbound_receipts: ["customer_code", "receipt_number", "status", "received_at"],
    inbound_items: ["receipt_id", "sku_code", "expected_qty", "received_qty"],
    putaway_tasks: ["receipt_id", "sku_code", "location_id", "status"],
    quality_exceptions: ["entity_type", "entity_id", "reason", "status"],
    orders: ["customer_code", "order_number", "status"],
    order_items: ["order_id", "sku_code", "requested_qty", "picked_qty"],
    stock_reservations: ["order_id", "sku_code", "reserved_qty"],
    pick_tasks: ["order_id", "status", "assigned_to"],
    pick_lines: ["pick_task_id", "sku_code", "location_id", "qty_to_pick"],
    pack_tasks: ["order_id", "status", "package_count"],
    packages: ["pack_task_id", "tracking_code", "status"],
    package_items: ["package_id", "sku_code", "qty_packed"],
    shipments: ["order_id", "destination", "status"],
    shipment_items: ["shipment_id", "sku_code", "qty_shipped"],
    delivery_proofs: ["shipment_id", "file_name", "signed_at"],
    documents: ["customer_code", "entity_type", "entity_id", "file_name"],
    document_links: ["document_id", "entity_type", "entity_id"],
  };
  return fields[collection] ?? ["customer_code", "status", "updated_at"];
}

function sourceOfTruthForCollection(collection: string) {
  if (["customers", "customer_accounts"].includes(collection)) return ["users", "invites"];
  if (["customer_requests"].includes(collection)) return ["portal do cliente"];
  if (["products", "skus"].includes(collection)) return ["Inventário_BTG_Consolidado.xlsx"];
  if (["locations", "stock_balances"].includes(collection)) return ["skus"];
  if (["inbound_receipts", "inbound_items", "quality_exceptions"].includes(collection)) return ["movements"];
  if (["orders", "order_items", "stock_reservations"].includes(collection)) return ["orders"];
  if (["putaway_tasks", "pick_tasks", "pick_lines", "pack_tasks", "packages", "package_items", "shipments", "shipment_items", "delivery_proofs"].includes(collection)) return ["orders", "skus"];
  if (["billing_periods", "billing_manual", "billing_price_list"].includes(collection)) return ["Armazenamento BTG_Fechamento mensal.xlsx"];
  return ["events"];
}

function slug(value: unknown) {
  return String(value ?? "sem-valor")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "sem-valor";
}

function locationParts(sku: AnyOperationalRecord) {
  const aisle = String(sku.rua || "Sem rua");
  const shelf = String(sku.prateleira || "Sem prateleira");
  const bin = String(sku.caixa || sku.endereco || "Sem caixa");
  return { aisle, shelf, bin };
}

export function locationIdFromSku(sku: AnyOperationalRecord) {
  const { aisle, shelf, bin } = locationParts(sku);
  return `loc_${slug(aisle)}_${slug(shelf)}_${slug(bin)}`;
}

export function buildDerivedLocations(skus: AnyOperationalRecord[]) {
  const byLocation = new Map<string, AnyOperationalRecord>();

  for (const sku of skus) {
    const id = locationIdFromSku(sku);
    const { aisle, shelf, bin } = locationParts(sku);
    const current = byLocation.get(id) ?? {
      id,
      warehouse_code: "DUTE-SP",
      customer_code: DEFAULT_CUSTOMER.code,
      aisle,
      shelf,
      bin,
      label: `${aisle} / ${shelf} / ${bin}`,
      sku_count: 0,
      qty_on_hand: 0,
      source: "derived_from_skus",
      status: "active",
    };
    current.sku_count += 1;
    current.qty_on_hand += Number(sku.estoque_atual ?? 0);
    byLocation.set(id, current);
  }

  return [...byLocation.values()].sort((a, b) =>
    String(a.label).localeCompare(String(b.label), "pt-BR"),
  );
}

export function buildDerivedCustomerAccounts(users: AnyOperationalRecord[]) {
  return users
    .filter((user) => String(user.role ?? "").toLowerCase() === "cliente")
    .map((user) => {
      const userId = String(user._docId ?? user.id ?? user.email ?? "");
      return {
        id: `acct_${slug(userId || user.email)}`,
        customer_code: user.customer_code ?? DEFAULT_CUSTOMER.code,
        user_id: userId,
        email: String(user.email ?? ""),
        name: String(user.nome ?? user.name ?? ""),
        role: "viewer",
        status: "active",
        source: "derived_from_users",
      };
    });
}

export function buildDerivedStockBalances(skus: AnyOperationalRecord[]) {
  return skus.map((sku) => {
    const quantity = Number(sku.estoque_atual ?? 0);
    const unitCost = Number(sku.preco_unit ?? sku.custo_unit ?? 0);
    return {
      id: `bal_${slug(sku.cod_btg ?? sku.id)}`,
      customer_code: DEFAULT_CUSTOMER.code,
      client_item_code: String(sku.cod_cliente ?? ""),
      sku_code: String(sku.cod_btg ?? sku.id),
      product_name: String(sku.produto ?? ""),
      category: sku.categoria ?? null,
      condition: sku.estado ?? null,
      location_id: locationIdFromSku(sku),
      qty_on_hand: quantity,
      qty_reserved: Number(sku.estoque_reservado ?? 0),
      qty_available: Math.max(0, quantity - Number(sku.estoque_reservado ?? 0)),
      unit_cost: unitCost,
      total_cost: quantity * unitCost,
      source: "derived_from_skus",
      status: quantity > 0 ? "available" : "empty",
    };
  });
}

export function buildDerivedOrderItems(orders: AnyOperationalRecord[]) {
  return orders.map((order) => ({
    id: `item_${slug(order.id ?? order.num_pedido)}_1`,
    customer_code: DEFAULT_CUSTOMER.code,
    order_id: String(order.id),
    order_number: String(order.num_pedido ?? order.id),
    sku_code: String(order.cod_sku ?? ""),
    product_name: String(order.produto ?? ""),
    requested_qty: Number(order.qtd_solic ?? 0),
    picked_qty: Number(order.qtd_sep ?? 0),
    status: order.status ?? "PENDENTE",
    source: "derived_from_orders",
  }));
}

export function buildDerivedInboundReceipts(movements: AnyOperationalRecord[]) {
  const byReceipt = new Map<string, AnyOperationalRecord>();

  for (const movement of movements) {
    if (Number(movement.sinal ?? 0) <= 0) continue;
    const receiptNumber = String(movement.doc_nf || `MOV-${movement.id}`);
    const id = `inb_${slug(receiptNumber)}`;
    const current = byReceipt.get(id) ?? {
      id,
      customer_code: DEFAULT_CUSTOMER.code,
      receipt_number: receiptNumber,
      status: "received",
      received_at: movement.data ?? null,
      item_count: 0,
      qty_received: 0,
      source: "derived_from_movements",
    };
    current.item_count += 1;
    current.qty_received += Number(movement.qtde ?? 0);
    byReceipt.set(id, current);
  }

  return [...byReceipt.values()].sort((a, b) =>
    String(b.received_at ?? "").localeCompare(String(a.received_at ?? "")),
  );
}

export function buildDerivedPickTasks(orders: AnyOperationalRecord[]) {
  return orders
    .filter((order) =>
      ["PENDENTE", "SEPARACAO", "ABERTO"].includes(String(order.status ?? "").toUpperCase()),
    )
    .map((order) => ({
      id: `pick_${slug(order.id ?? order.num_pedido)}`,
      customer_code: DEFAULT_CUSTOMER.code,
      order_id: String(order.id),
      order_number: String(order.num_pedido ?? order.id),
      status: String(order.status ?? "PENDENTE").toUpperCase() === "SEPARACAO" ? "in_progress" : "planned",
      priority: "normal",
      total_lines: 1,
      total_units: Number(order.qtd_solic ?? 0),
      picked_units: Number(order.qtd_sep ?? 0),
      source: "derived_from_orders",
    }));
}

export function buildDerivedPackTasks(orders: AnyOperationalRecord[]) {
  return orders
    .filter((order) => Number(order.qtd_sep ?? 0) > 0 || ["FATURADO", "ENTREGUE"].includes(String(order.status ?? "").toUpperCase()))
    .map((order) => ({
      id: `pack_${slug(order.id ?? order.num_pedido)}`,
      customer_code: DEFAULT_CUSTOMER.code,
      order_id: String(order.id),
      order_number: String(order.num_pedido ?? order.id),
      status: String(order.status ?? "").toUpperCase() === "ENTREGUE" ? "completed" : "ready",
      package_count: 0,
      packed_units: Number(order.qtd_sep ?? 0),
      source: "derived_from_orders",
    }));
}

export function buildOperationalFoundationSnapshot(input: {
  customers: AnyOperationalRecord[];
  customerAccounts: AnyOperationalRecord[];
  locations: AnyOperationalRecord[];
  stockBalances: AnyOperationalRecord[];
  inboundReceipts: AnyOperationalRecord[];
  orderItems: AnyOperationalRecord[];
  pickTasks: AnyOperationalRecord[];
  packTasks: AnyOperationalRecord[];
  shipments: AnyOperationalRecord[];
  documents: AnyOperationalRecord[];
  skus: AnyOperationalRecord[];
  movements: AnyOperationalRecord[];
  orders: AnyOperationalRecord[];
}): OperationalFoundationSnapshot {
  const derivedLocations = buildDerivedLocations(input.skus);
  const derivedStockBalances = buildDerivedStockBalances(input.skus);
  const derivedOrderItems = buildDerivedOrderItems(input.orders);
  const derivedInboundReceipts = buildDerivedInboundReceipts(input.movements);
  const derivedPickTasks = buildDerivedPickTasks(input.orders);
  const derivedPackTasks = buildDerivedPackTasks(input.orders);
  const openOrders = input.orders.filter((order) =>
    ["PENDENTE", "SEPARACAO", "ABERTO"].includes(String(order.status ?? "").toUpperCase()),
  );

  return {
    customer: {
      code: DEFAULT_CUSTOMER.code,
      name: DEFAULT_CUSTOMER.name,
      source: "derived_from_real_btg_operation",
    },
    metrics: {
      collections: OPERATIONAL_COLLECTION_CONTRACTS.length,
      modules: OPERATIONAL_MODULES.length,
      customers: input.customers.length,
      customer_accounts: input.customerAccounts.length,
      locations: input.locations.length,
      stock_balances: input.stockBalances.length,
      inbound_receipts: input.inboundReceipts.length,
      order_items: input.orderItems.length,
      pick_tasks: input.pickTasks.length,
      pack_tasks: input.packTasks.length,
      shipments: input.shipments.length,
      documents: input.documents.length,
      derived_locations: derivedLocations.length,
      derived_stock_balances: derivedStockBalances.length,
      open_orders: openOrders.length,
    },
    contracts: OPERATIONAL_COLLECTION_CONTRACTS,
    derived: {
      locations: derivedLocations.slice(0, 40),
      stock_balances: derivedStockBalances.slice(0, 80),
      order_items: derivedOrderItems.slice(0, 80),
      inbound_receipts: derivedInboundReceipts.slice(0, 40),
      pick_tasks: derivedPickTasks.slice(0, 40),
      pack_tasks: derivedPackTasks.slice(0, 40),
    },
  };
}
