import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserCartStorage,
  cartStorageKey,
  emptyStoredCart,
  patchStoredCart,
  readStoredCart,
  writeStoredCart,
} from "./client-cart";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const draft = {
  cart: { "sku-1": 2 },
  orderName: "Abastecimento",
  destination: "Agência Faria Lima",
  dueAt: "2026-10-27T07:00",
  notes: "Portaria",
};

describe("pedido do portal neste aparelho", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("volta igual depois de gravar e ler", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-ana");
    writeStoredCart(storage, key, draft);
    expect(readStoredCart(storage, key)).toEqual(draft);
    expect(readStoredCart(storage, cartStorageKey("outro", "uid-ana"))).toEqual(emptyStoredCart());
  });

  it("outra pessoa do mesmo cliente não abre o pedido de quem usou antes", () => {
    const storage = memory();
    writeStoredCart(storage, cartStorageKey("BTG Pactual", "uid-ana"), draft);
    expect(readStoredCart(storage, cartStorageKey("BTG Pactual", "uid-bruno"))).toEqual(emptyStoredCart());
  });

  it("sem cliente ou sem pessoa, não lê nem grava", () => {
    const storage = memory();
    expect(cartStorageKey("BTG Pactual", "")).toBe("");
    expect(cartStorageKey("", "uid-ana")).toBe("");
    writeStoredCart(storage, cartStorageKey("BTG Pactual", ""), draft);
    patchStoredCart(storage, cartStorageKey("", "uid-ana"), { notes: "x" });
    expect(storage.data.size).toBe(0);
    expect(readStoredCart(storage, "")).toEqual(emptyStoredCart());
  });

  it("um campo novo não apaga o resto", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-ana");
    writeStoredCart(storage, key, {
      cart: { "sku-1": 2 },
      orderName: "",
      destination: "Faria Lima",
      dueAt: "",
      notes: "",
    });
    const next = patchStoredCart(storage, key, { notes: "Receber na doca" });
    expect(next.destination).toBe("Faria Lima");
    expect(next.cart).toEqual({ "sku-1": 2 });
    expect(next.notes).toBe("Receber na doca");
  });

  it("ignora quantidade inválida e texto corrompido", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-ana");
    storage.setItem(key, "{");
    expect(readStoredCart(storage, key)).toEqual(emptyStoredCart());
    storage.setItem(key, JSON.stringify({ cart: { a: 0, b: 1.9, c: "x" }, destination: 4 }));
    expect(readStoredCart(storage, key)).toEqual({
      ...emptyStoredCart(),
      cart: { b: 1 },
    });
  });

  it("storage que falha não derruba a tela: o pedido fica nesta visita", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    };
    const key = cartStorageKey("BTG Pactual", "uid-falha");
    expect(readStoredCart(blocked, key)).toEqual(emptyStoredCart());
    expect(() => writeStoredCart(blocked, key, draft)).not.toThrow();
    expect(readStoredCart(blocked, key)).toEqual(draft);
    expect(patchStoredCart(blocked, key, { notes: "Doca 2" }).notes).toBe("Doca 2");
    expect(readStoredCart(blocked, key)).toEqual({ ...draft, notes: "Doca 2" });
  });

  it("storage cheio não devolve o pedido antigo", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-cheio");
    writeStoredCart(storage, key, draft);
    const full = {
      getItem: storage.getItem,
      setItem: () => {
        throw new DOMException("cheio", "QuotaExceededError");
      },
    };
    expect(() => patchStoredCart(full, key, { destination: "Paulista" })).not.toThrow();
    expect(readStoredCart(full, key).destination).toBe("Paulista");
  });

  it("navegador que bloqueia o localStorage: sem storage, sem erro", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("bloqueado", "SecurityError");
      },
    });
    const storage = browserCartStorage();
    expect(storage).toBeNull();
    const key = cartStorageKey("BTG Pactual", "uid-privada");
    expect(() => writeStoredCart(storage, key, draft)).not.toThrow();
    expect(readStoredCart(storage, key)).toEqual(draft);
  });

  it("com localStorage, devolve o do navegador", () => {
    const storage = memory();
    vi.stubGlobal("window", { localStorage: storage });
    expect(browserCartStorage()).toBe(storage);
  });
});
