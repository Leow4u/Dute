import {
  FieldPath,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { LEGACY_CUSTOMER_CODE } from "./customer-scope.js";

/**
 * Valor de mercadoria fora das coleções que a operação lê
 * (products, skus, stock_balances, client_inventory).
 * Quem lê: owner, admin, financeiro e o cliente, só o próprio.
 */
export const CATALOG_PRICES = "catalog_prices";

export const PUBLISHED_MONEY_FIELDS = [
  "preco_unit",
  "unit_cost",
  "custo_unit",
  "custo_total",
  "total_cost",
  "total_value",
] as const;

export const CATALOG_PRICE_ROLES = ["owner", "admin", "financeiro"] as const;

const PUBLISHED_COLLECTIONS = [
  "products",
  "skus",
  "stock_balances",
  "client_inventory",
] as const;

export function canSeeCatalogPrice(role: string): boolean {
  return (CATALOG_PRICE_ROLES as readonly string[]).includes(role);
}

/** Valor da mercadoria do cliente: o financeiro e o próprio cliente. */
export function canSeeMerchandiseValue(role: string): boolean {
  return role === "cliente" || canSeeCatalogPrice(role);
}

export function catalogPriceId(customerCode: string, skuCode: string): string {
  return `cprice_${customerCode}__${skuCode}`
    .replace(/[^\w.-]/g, "_")
    .slice(0, 900);
}

export function publishedMoneyDeletes(): Record<string, FieldValue> {
  return Object.fromEntries(
    PUBLISHED_MONEY_FIELDS.map((field) => [field, FieldValue.delete()]),
  );
}

export function hasPublishedMoney(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return PUBLISHED_MONEY_FIELDS.some((field) => data[field] !== undefined && data[field] !== null);
}

/** Preço unitário gravado, ou custo total dividido pela quantidade. */
export function unitPriceOf(data: Record<string, unknown> | undefined): number | undefined {
  if (!data) return undefined;
  const direct = Number(data.preco_unit ?? data.unit_cost ?? data.custo_unit);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const total = Number(data.custo_total ?? data.total_cost);
  const qty = Number(
    data.qty_on_hand ?? data.estoque_atual ?? data.estoque_btg ?? 0,
  );
  if (Number.isFinite(total) && total > 0 && Number.isFinite(qty) && qty > 0) {
    return Math.round((total / qty) * 10000) / 10000;
  }
  return undefined;
}

export function rememberCatalogPrice(
  transaction: Transaction,
  db: Firestore,
  input: {
    customerCode: string;
    skuCode: string;
    itemCode?: string;
    unitCost?: number;
    /** Valor absoluto da mercadoria deste SKU. */
    totalCost?: number;
    /** Soma ou subtrai do valor já gravado. */
    totalDelta?: number;
  },
) {
  const unitCost = Number(input.unitCost);
  const customerCode = input.customerCode.trim();
  const skuCode = input.skuCode.trim();
  const hasUnit = Number.isFinite(unitCost) && unitCost > 0;
  const hasTotal = input.totalCost !== undefined && Number.isFinite(input.totalCost);
  const hasDelta = input.totalDelta !== undefined && Number.isFinite(input.totalDelta) && input.totalDelta !== 0;
  if (!customerCode || !skuCode || (!hasUnit && !hasTotal && !hasDelta)) return;
  const id = catalogPriceId(customerCode, skuCode);
  const payload: Record<string, unknown> = {
    id,
    customer_code: customerCode,
    sku_code: skuCode,
    item_code: input.itemCode?.trim() || skuCode,
    updated_at: FieldValue.serverTimestamp(),
  };
  if (hasUnit) payload.preco_unit = unitCost;
  if (hasTotal) payload.total_cost = input.totalCost;
  else if (hasDelta) payload.total_cost = FieldValue.increment(input.totalDelta as number);
  transaction.set(db.collection(CATALOG_PRICES).doc(id), payload, { merge: true });
}

type InventoryRow = {
  sku_code?: unknown;
  client_item_code?: unknown;
  qty_on_hand?: unknown;
  total_cost?: unknown;
};

type PriceRow = {
  sku_code?: unknown;
  item_code?: unknown;
  preco_unit?: unknown;
  total_cost?: unknown;
};

/** O preço unitário gravado, só quando positivo. */
function unitOf(price: PriceRow | undefined): number | null {
  const unit = Number(price?.preco_unit);
  return Number.isFinite(unit) && unit > 0 ? unit : null;
}

/**
 * O valor da mercadoria: o saldo de cada SKU vezes o preço unitário dele.
 * O total gravado só vale para o SKU sem preço unitário: quem muda o saldo
 * nem sempre sabe o custo (o pedido do portal não leva, e o saldo não
 * guarda), e o total ficava zerado ou velho. Sem preço nenhum, usa o
 * total_cost legado do estoque.
 */
export function merchandiseValue(inventory: InventoryRow[], prices: PriceRow[]): number {
  const bySku = new Map<string, PriceRow>();
  const byItem = new Map<string, PriceRow>();
  for (const price of prices) {
    if (typeof price.sku_code === "string" && price.sku_code) bySku.set(price.sku_code, price);
    if (typeof price.item_code === "string" && price.item_code) byItem.set(price.item_code, price);
  }
  const covered = new Set<string>();
  let sum = 0;
  for (const price of prices) {
    const total = Number(price.total_cost);
    const sku = typeof price.sku_code === "string" ? price.sku_code : "";
    if (sku && unitOf(price) === null && Number.isFinite(total)) {
      sum += total;
      covered.add(sku);
    }
  }
  for (const row of inventory) {
    const sku = typeof row.sku_code === "string" ? row.sku_code : "";
    if (sku && covered.has(sku)) continue;
    const item = typeof row.client_item_code === "string" ? row.client_item_code : "";
    const unit = unitOf((sku && bySku.get(sku)) || (item && byItem.get(item)) || undefined);
    const qty = Number(row.qty_on_hand ?? 0);
    if (unit !== null && Number.isFinite(qty)) {
      sum += qty * unit;
      continue;
    }
    const legacy = Number(row.total_cost ?? 0);
    if (Number.isFinite(legacy)) sum += legacy;
  }
  return sum;
}

/**
 * Copia preço ainda grudado no catálogo/saldo para catalog_prices e apaga
 * o campo. Uma leva por chamada; repetir até `done`.
 */
export async function splitCatalogPriceBatch(
  db: Firestore,
  pageSize = 200,
): Promise<{ updated: number; done: boolean }> {
  let updated = 0;
  let reachedCap = false;
  for (const name of PUBLISHED_COLLECTIONS) {
    let last: QueryDocumentSnapshot | undefined;
    let scanned = 0;
    while (scanned < 2000) {
      let query = db
        .collection(name)
        .orderBy(FieldPath.documentId())
        .limit(pageSize);
      if (last) query = query.startAfter(last);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const batch = db.batch();
      let writes = 0;
      for (const document of snapshot.docs) {
        const data = document.data();
        if (!hasPublishedMoney(data)) continue;
        const unit = unitPriceOf(data);
        const customerCode =
          String(data.customer_code ?? LEGACY_CUSTOMER_CODE).trim() || LEGACY_CUSTOMER_CODE;
        const skuCode = String(
          data.sku_code ?? data.cod_btg ?? data.cod_cliente ?? document.id,
        ).trim();
        const itemCode = String(
          data.client_item_code ?? data.cod_cliente ?? skuCode,
        ).trim();
        if (unit && skuCode) {
          const id = catalogPriceId(customerCode, skuCode);
          const total = Number(data.custo_total ?? data.total_cost);
          const price: Record<string, unknown> = {
            id,
            customer_code: customerCode,
            sku_code: skuCode,
            item_code: itemCode || skuCode,
            preco_unit: unit,
            updated_at: FieldValue.serverTimestamp(),
          };
          // Saldo de uma posição não substitui o total do SKU.
          if (name !== "stock_balances" && Number.isFinite(total) && total > 0) {
            price.total_cost = total;
          }
          batch.set(db.collection(CATALOG_PRICES).doc(id), price, { merge: true });
          writes += 1;
        }
        batch.update(document.ref, publishedMoneyDeletes());
        writes += 1;
        updated += 1;
      }
      if (writes > 0) await batch.commit();
      last = snapshot.docs[snapshot.docs.length - 1];
      scanned += snapshot.size;
      if (snapshot.size < pageSize) break;
      if (scanned >= 2000) {
        reachedCap = true;
        break;
      }
    }
  }
  return { updated, done: !reachedCap };
}
