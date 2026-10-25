export type StoredCart = {
  cart: Record<string, number>;
  orderName: string;
  destination: string;
  dueAt: string;
  notes: string;
  /**
   * A mensagem do Agent Dute de onde o pedido saiu ("Abrir no Estoque"): o
   * envio leva o id dela (agent_message_id), e o servidor liga o pedido ao
   * cartão da conversa, que deixa de oferecer o próprio envio.
   */
  mensagemDoAgente?: string;
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

function parseStoredCart(raw: string | null | undefined): StoredCart {
  if (!raw) return emptyStoredCart();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    const mensagem = text(parsed.mensagemDoAgente);
    return {
      cart: quantities(parsed.cart),
      orderName: text(parsed.orderName),
      destination: text(parsed.destination),
      dueAt: text(parsed.dueAt),
      notes: text(parsed.notes),
      ...(mensagem ? { mensagemDoAgente: mensagem } : {}),
    };
  } catch {
    return emptyStoredCart();
  }
}

export function readStoredCart(storage: Pick<Storage, "getItem"> | null, key: string): StoredCart {
  if (!key) return emptyStoredCart();
  try {
    return parseStoredCart(visit.get(key) ?? storage?.getItem(key));
  } catch {
    return emptyStoredCart();
  }
}

/** O pedido está gravado no storage, e não só na cópia desta visita. */
export function isStoredCartSaved(storage: CartStorage | null, key: string) {
  return Boolean(key && storage) && !visit.has(key);
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
  // O pedido vazio (enviado ou esvaziado) não fica ligado ao cartão do agente: o próximo é outro pedido.
  if (!Object.keys(next.cart).length) delete next.mensagemDoAgente;
  writeStoredCart(storage, key, next);
  return next;
}

type CartStorageEvent = Pick<StorageEvent, "key" | "newValue" | "storageArea">;

/**
 * Outra aba mudou ou apagou este pedido: o pedido guardado agora, ou null
 * quando o evento é de outra coisa. Lê o storage, não o `newValue`: um evento
 * atrasado não traz de volta um pedido que já mudou de novo.
 */
export function storedCartFromStorageEvent(
  event: CartStorageEvent,
  storage: CartStorage | null,
  key: string,
): StoredCart | null {
  if (!key || !storage || event.storageArea !== storage) return null;
  // Sem chave, a outra aba limpou o storage inteiro.
  if (event.key !== null && event.key !== key) return null;
  // A outra aba gravou no storage: a cópia desta visita ficou velha.
  visit.delete(key);
  return readStoredCart(storage, key);
}

/** Ouve as outras abas; devolve como parar. Sem storage ou sem chave, não ouve nada. */
export function watchStoredCart(
  target: EventTarget | null,
  storage: CartStorage | null,
  key: string,
  onChange: (draft: StoredCart) => void,
): () => void {
  if (!target || !storage || !key) return () => undefined;
  const listener = (event: Event) => {
    try {
      const next = storedCartFromStorageEvent(event as StorageEvent, storage, key);
      if (next) onChange(next);
    } catch {
      // Evento que não dá para ler não derruba a tela.
    }
  };
  target.addEventListener("storage", listener);
  return () => target.removeEventListener("storage", listener);
}
