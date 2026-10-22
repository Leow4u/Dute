export type StoredCart = {
  cart: Record<string, number>;
  orderName: string;
  destination: string;
  dueAt: string;
  notes: string;
};

export type CartStorage = Pick<Storage, "getItem" | "setItem">;

export function emptyStoredCart(): StoredCart {
  return { cart: {}, orderName: "", destination: "", dueAt: "", notes: "" };
}

export function cartStorageKey(customerCode: string) {
  return `dute.portal.pedido.${customerCode}`;
}

function quantities(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const cart: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(quantity);
    if (!key || !Number.isFinite(parsed) || parsed <= 0) continue;
    cart[key] = Math.floor(parsed);
  }
  return cart;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function readStoredCart(storage: Pick<Storage, "getItem">, customerCode: string): StoredCart {
  try {
    const raw = storage.getItem(cartStorageKey(customerCode));
    if (!raw) return emptyStoredCart();
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    return {
      cart: quantities(parsed.cart),
      orderName: text(parsed.orderName),
      destination: text(parsed.destination),
      dueAt: text(parsed.dueAt),
      notes: text(parsed.notes),
    };
  } catch {
    return emptyStoredCart();
  }
}

export function writeStoredCart(storage: Pick<Storage, "setItem">, customerCode: string, draft: StoredCart) {
  storage.setItem(cartStorageKey(customerCode), JSON.stringify(draft));
}

export function patchStoredCart(
  storage: CartStorage,
  customerCode: string,
  patch: Partial<StoredCart>,
): StoredCart {
  const next = { ...readStoredCart(storage, customerCode), ...patch };
  writeStoredCart(storage, customerCode, next);
  return next;
}
