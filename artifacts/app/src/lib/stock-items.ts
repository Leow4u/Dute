/**
 * Uma linha por item do estoque, juntando o que antes estava espalhado:
 * cadastro (skus/products), saldo por endereço (stock_balances) e foto.
 * A foto pode ter sido gravada em qualquer um dos três (recebimento,
 * contagem ou addCatalogPhotos); vale a primeira que existir.
 */

type AnyRecord = Record<string, unknown>;

export type StockLocation = { id: string; qty: number };

export type StockItem = {
  key: string;
  id?: number | string;
  skuCode: string;
  clientCode?: string;
  name: string;
  detail: string;
  onHand: number;
  reserved: number;
  available: number;
  unitCost?: number;
  /** Mínimo cadastrado na ficha; sem ele o item nunca é "baixo". */
  minimum?: number;
  locations: StockLocation[];
  photos: string[];
  low: boolean;
  zero: boolean;
  sku: AnyRecord;
};

export type StockFilter = "all" | "low" | "reserved" | "no-photo" | "zero";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function photosOf(record: AnyRecord | undefined) {
  if (!record) return [];
  const list = Array.isArray(record.photo_urls)
    ? (record.photo_urls as unknown[]).map(text).filter(Boolean)
    : [];
  const primary = text(record.primary_photo_url);
  return primary && !list.includes(primary) ? [primary, ...list] : list;
}

function optionalNum(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function buildStockItems({
  skus,
  balances,
  products,
}: {
  skus?: AnyRecord[];
  balances?: AnyRecord[];
  products?: AnyRecord[];
}): StockItem[] {
  const balancesBySku = new Map<string, AnyRecord[]>();
  for (const balance of balances ?? []) {
    for (const key of unique([text(balance.sku_code), text(balance.client_item_code)])) {
      if (!key) continue;
      const list = balancesBySku.get(key) ?? [];
      list.push(balance);
      balancesBySku.set(key, list);
    }
  }
  const productsByClient = new Map<string, AnyRecord>();
  for (const product of products ?? []) {
    const key = text(product.cod_cliente);
    if (key && !productsByClient.has(key)) productsByClient.set(key, product);
  }

  return (skus ?? [])
    .filter((sku) => sku.archived !== true && text(sku.status) !== "archived")
    .map((sku) => {
      const skuCode = text(sku.cod_btg) || text(sku.sku_code);
      const clientCode = text(sku.cod_cliente) || undefined;
      const product = clientCode ? productsByClient.get(clientCode) : undefined;
      const skuBalances =
        balancesBySku.get(skuCode) ??
        (clientCode ? balancesBySku.get(clientCode) : undefined) ??
        [];

      const byLocation = new Map<string, number>();
      for (const balance of skuBalances) {
        const id = text(balance.location_id);
        if (!id) continue;
        byLocation.set(id, (byLocation.get(id) ?? 0) + num(balance.qty_on_hand));
      }
      const legacyLocation =
        text(sku.endereco) ||
        [sku.rua && `R${text(sku.rua)}`, sku.prateleira && `P${text(sku.prateleira)}`, sku.caixa && `C${text(sku.caixa)}`]
          .filter(Boolean)
          .join(" ");
      const locations: StockLocation[] = byLocation.size
        ? [...byLocation.entries()]
            .map(([id, qty]) => ({ id, qty }))
            .sort((left, right) => right.qty - left.qty)
        : legacyLocation
          ? [{ id: legacyLocation, qty: num(sku.estoque_atual) }]
          : [];

      const onHand = num(sku.estoque_atual);
      const reserved = num(sku.estoque_reservado);
      const available =
        sku.estoque_disponivel !== undefined && sku.estoque_disponivel !== null
          ? num(sku.estoque_disponivel)
          : Math.max(0, onHand - reserved);
      const unitCost =
        num(sku.preco_unit) ||
        num(sku.unit_cost) ||
        num(product?.preco_unit) ||
        num(skuBalances[0]?.unit_cost) ||
        undefined;

      const minimum = optionalNum(sku.estoque_minimo);

      const photos = unique([
        ...photosOf(sku),
        ...photosOf(product),
        ...skuBalances.flatMap((balance) => photosOf(balance)),
      ]).slice(0, 8);

      const detail = [
        text(sku.categoria),
        text(sku.cor),
        text(sku.tamanho),
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        key: skuCode || String(sku.id),
        id: sku.id as number | string | undefined,
        skuCode,
        clientCode,
        name: text(sku.produto) || text(product?.produto) || skuCode,
        detail,
        onHand,
        reserved,
        available,
        unitCost,
        minimum,
        locations,
        photos,
        // Baixo = tem mínimo e está nele ou abaixo. Zerado é outro estado.
        low: minimum !== undefined && onHand > 0 && onHand <= minimum,
        zero: onHand <= 0,
        sku,
      };
    })
    .sort((left, right) => (left.clientCode ?? left.skuCode).localeCompare(right.clientCode ?? right.skuCode, "pt-BR"));
}

export function matchesFilter(item: StockItem, filter: StockFilter) {
  if (filter === "low") return item.low;
  if (filter === "zero") return item.zero;
  if (filter === "reserved") return item.reserved > 0;
  if (filter === "no-photo") return item.photos.length === 0;
  return true;
}

export function matchesSearch(item: StockItem, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [item.skuCode, item.clientCode, item.name, item.detail, ...item.locations.map((location) => location.id)]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}
