/**
 * Eventos do portal: o que vai para um evento que se repete, onde é e como a
 * Dutelog leva, monta e traz de volta. O evento é só um modelo de pedido:
 * "Usar no pedido" preenche o pedido no Estoque e o pedido segue o caminho de
 * sempre. Aqui ficam as contas da tela (o que falta, data da entrega, ordem),
 * sem React, para teste. Quem grava é o backend (saveClientEventTemplate).
 */

export type ClientEventItem = {
  sku_code: string;
  client_item_code: string | null;
  product_name: string;
  quantity: number;
};

export type ClientEvent = {
  id: string;
  name: string;
  description: string | null;
  venue: string;
  address: string | null;
  /** Dia da próxima edição (AAAA-MM-DD). */
  next_date: string | null;
  schedule: string | null;
  logistics: string | null;
  items: ClientEventItem[];
  updated_by_name?: string | null;
  updated_at?: string | null;
};

export type ClientEventInput = Omit<ClientEvent, "id" | "updated_by_name" | "updated_at"> & {
  id?: string;
  idempotency_key?: string;
};

/** O pedaço do produto do Estoque que o evento precisa. */
export type EventStockProduct = {
  key: string;
  sku: string;
  clientItemCode?: string | null;
  available: number;
  total: number;
  value: number;
  photoUrl?: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");

function localDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-20" como data local (new Date("2026-11-20") seria meia-noite UTC). */
function parseDay(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return Number.isNaN(date.getTime()) || localDay(date) !== value ? null : date;
}

/** Produto do Estoque para a linha: o mesmo código do cliente primeiro, depois o SKU com mais saldo. */
export function productForEventItem<T extends EventStockProduct>(item: ClientEventItem, products: T[]): T | undefined {
  const sameSku = products.filter((product) => product.sku === item.sku_code);
  if (!sameSku.length) return undefined;
  if (item.client_item_code) {
    const exact = sameSku.find((product) => (product.clientItemCode ?? null) === item.client_item_code);
    if (exact) return exact;
  }
  return [...sameSku].sort((left, right) => right.available - left.available)[0];
}

export type EventShortage = { name: string; need: number; have: number };

/** O que falta no saldo livre de hoje para levar o evento inteiro. */
export function eventShortages(event: Pick<ClientEvent, "items">, products: EventStockProduct[]): EventShortage[] {
  const need = new Map<string, EventShortage>();
  for (const item of event.items) {
    const product = productForEventItem(item, products);
    const key = product?.key ?? `sem-estoque:${item.sku_code}:${item.client_item_code ?? ""}`;
    const current = need.get(key) ?? { name: item.product_name, need: 0, have: product?.available ?? 0 };
    current.need += item.quantity;
    need.set(key, current);
  }
  return [...need.values()].filter((entry) => entry.have < entry.need);
}

/** Valor das peças pelo custo médio do estoque (base do seguro de transporte); 0 se não houver custo. */
export function eventPiecesValue(event: Pick<ClientEvent, "items">, products: EventStockProduct[]) {
  return event.items.reduce((sum, item) => {
    const product = productForEventItem(item, products);
    if (!product || product.total <= 0 || product.value <= 0) return sum;
    return sum + item.quantity * (product.value / product.total);
  }, 0);
}

/** Carrinho do Estoque com o evento: até o saldo livre; o resto vai em "missing". */
export function cartFromEvent(event: Pick<ClientEvent, "items">, products: EventStockProduct[]) {
  const cart: Record<string, number> = {};
  const missing: string[] = [];
  for (const item of event.items) {
    const product = productForEventItem(item, products);
    const room = product ? product.available - (cart[product.key] ?? 0) : 0;
    if (!product || room <= 0) {
      missing.push(item.product_name);
      continue;
    }
    if (item.quantity > room) missing.push(item.product_name);
    cart[product.key] = (cart[product.key] ?? 0) + Math.min(item.quantity, room);
  }
  return { cart, missing };
}

/**
 * "Para quando" do pedido: véspera do evento às 7h, no formato do campo
 * datetime-local. Evento de hoje ou que já passou não preenche (a data
 * precisa ser atualizada em Eventos).
 */
export function eventDueAt(nextDate: string | null | undefined, today = new Date()) {
  const date = parseDay(nextDate);
  if (!date || nextDate! <= localDay(today)) return "";
  date.setDate(date.getDate() - 1);
  return `${localDay(date)}T07:00`;
}

/** Inverso de eventDueAt: a entrega é na véspera, então o evento é no dia seguinte. */
export function eventDateFromDueAt(dueAt: string) {
  const date = parseDay(dueAt.slice(0, 10));
  if (!date) return "";
  date.setDate(date.getDate() + 1);
  return localDay(date);
}

export function isUpcoming(event: Pick<ClientEvent, "next_date">, today = new Date()) {
  return Boolean(parseDay(event.next_date) && event.next_date! >= localDay(today));
}

/** Os próximos primeiro, pela data; depois os sem data ou já passados, pelo nome. */
export function sortEvents<T extends Pick<ClientEvent, "name" | "next_date">>(events: T[], today = new Date()) {
  return [...events].sort((left, right) => {
    const leftNext = isUpcoming(left, today);
    const rightNext = isUpcoming(right, today);
    if (leftNext !== rightNext) return leftNext ? -1 : 1;
    if (leftNext && left.next_date !== right.next_date) return left.next_date! < right.next_date! ? -1 : 1;
    return left.name.localeCompare(right.name, "pt-BR");
  });
}

/** "20 nov" (e o ano, se não for o deste ano). */
export function eventDateLabel(nextDate: string | null | undefined, today = new Date()) {
  const date = parseDay(nextDate);
  if (!date) return null;
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === today.getFullYear() ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" };
  return date.toLocaleDateString("pt-BR", options).replace(/\./g, "").replace(/ de /g, " ");
}

/** Campo "Entregar em" do pedido. */
export function eventDestination(event: Pick<ClientEvent, "venue" | "address">) {
  return [event.venue, event.address].map((part) => part?.trim()).filter(Boolean).join(" · ");
}

/** Observações do pedido: montagem e transporte. */
export function eventNotes(event: Pick<ClientEvent, "schedule" | "logistics">) {
  return [event.schedule, event.logistics].map((part) => part?.trim()).filter(Boolean).join(" · ");
}
