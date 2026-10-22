export type StoredCart = {
  cart: Record<string, number>;
  orderName: string;
  destination: string;
  dueAt: string;
  notes: string;
};

export type CartStorage = Pick<Storage, "getItem" | "setItem">;

// Sem storage (aba privada, bloqueado ou cheio), o pedido vale só nesta visita.
const visit = new Map<string, string>();

export function emptyStoredCart(): StoredCart {
  return { cart: {}, orderName: "", destination: "", dueAt: "", notes: "" };
}

/** O localStorage, ou null quando o navegador bloqueia até chegar nele. */
export function browserCartStorage(): CartStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Por cliente e por pessoa: quem entra depois no mesmo aparelho não abre o pedido de outro. */
export function cartStorageKey(customerCode: string, uid: string) {
  return customerCode && uid ? `dute.portal.pedido.${customerCode}.${uid}` : "";
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

export function readStoredCart(storage: Pick<Storage, "getItem"> | null, key: string): StoredCart {
  if (!key) return emptyStoredCart();
  try {
    const raw = visit.get(key) ?? storage?.getItem(key);
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

export function writeStoredCart(storage: Pick<Storage, "setItem"> | null, key: string, draft: StoredCart) {
  if (!key) return;
  const raw = JSON.stringify(draft);
  visit.set(key, raw);
  try {
    if (!storage) return;
    storage.setItem(key, raw);
    visit.delete(key);
  } catch {
    // Storage bloqueado ou cheio: fica a cópia desta visita.
  }
}

export function patchStoredCart(storage: CartStorage | null, key: string, patch: Partial<StoredCart>): StoredCart {
  const next = { ...readStoredCart(storage, key), ...patch };
  writeStoredCart(storage, key, next);
  return next;
}
