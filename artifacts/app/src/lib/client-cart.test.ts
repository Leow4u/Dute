import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserCartStorage,
  cartStorageKey,
  emptyStoredCart,
  isStoredCartSaved,
  patchStoredCart,
  readStoredCart,
  storedCartFromStorageEvent,
  watchStoredCart,
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

describe("pedido mudado em outra aba", () => {
  const key = cartStorageKey("BTG Pactual", "uid-ana");

  function storageEvent(storageArea: unknown, eventKey: string | null, newValue: string | null) {
    return Object.assign(new Event("storage"), { key: eventKey, newValue, storageArea });
  }

  it("outra aba enviou e limpou o pedido: esta aba fica sem os itens já enviados", () => {
    const storage = memory();
    const sent = { ...emptyStoredCart(), cart: {} };
    storage.setItem(key, JSON.stringify(sent));
    expect(storedCartFromStorageEvent(storageEvent(storage, key, JSON.stringify(sent)), storage, key)).toEqual(
      emptyStoredCart(),
    );
    storage.setItem(key, JSON.stringify(draft));
    expect(storedCartFromStorageEvent(storageEvent(storage, key, JSON.stringify(draft)), storage, key)).toEqual(draft);
  });

  it("evento atrasado não traz de volta um pedido que já mudou de novo", () => {
    const storage = memory();
    const first = { ...emptyStoredCart(), cart: { "sku-1": 1 } };
    const second = { ...emptyStoredCart(), cart: { "sku-1": 2 } };
    storage.setItem(key, JSON.stringify(second));
    expect(storedCartFromStorageEvent(storageEvent(storage, key, JSON.stringify(first)), storage, key)).toEqual(second);
  });

  it("pedido apagado ou storage limpo na outra aba: volta vazio", () => {
    const storage = memory();
    expect(storedCartFromStorageEvent(storageEvent(storage, key, null), storage, key)).toEqual(emptyStoredCart());
    expect(storedCartFromStorageEvent(storageEvent(storage, null, null), storage, key)).toEqual(emptyStoredCart());
  });

  it("ignora o que não é este pedido", () => {
    const storage = memory();
    const raw = JSON.stringify(draft);
    expect(storedCartFromStorageEvent(storageEvent(storage, cartStorageKey("BTG Pactual", "uid-bruno"), raw), storage, key)).toBeNull();
    expect(storedCartFromStorageEvent(storageEvent(memory(), key, raw), storage, key)).toBeNull();
    expect(storedCartFromStorageEvent(storageEvent(storage, key, raw), null, key)).toBeNull();
    expect(storedCartFromStorageEvent(storageEvent(storage, key, raw), storage, "")).toBeNull();
  });

  it("a gravação da outra aba vale mais que a cópia desta visita", () => {
    const storage = memory();
    const full = {
      getItem: storage.getItem,
      setItem: () => {
        throw new DOMException("cheio", "QuotaExceededError");
      },
    };
    writeStoredCart(full, key, draft);
    const other = { ...emptyStoredCart(), cart: { "sku-9": 1 } };
    storage.setItem(key, JSON.stringify(other));
    expect(storedCartFromStorageEvent(storageEvent(full, key, JSON.stringify(other)), full, key)).toEqual(other);
    expect(readStoredCart(full, key)).toEqual(other);
  });

  it("ouve só este pedido, para de ouvir no fim e nunca derruba a tela", () => {
    const storage = memory();
    const target = new EventTarget();
    const seen: unknown[] = [];
    const stop = watchStoredCart(target, storage, key, (next) => seen.push(next));
    target.dispatchEvent(storageEvent(storage, cartStorageKey("outro", "uid-ana"), "{}"));
    target.dispatchEvent(storageEvent(storage, key, "{"));
    storage.setItem(key, JSON.stringify(draft));
    target.dispatchEvent(storageEvent(storage, key, JSON.stringify(draft)));
    expect(seen).toEqual([emptyStoredCart(), draft]);
    const failing = watchStoredCart(target, storage, key, () => {
      throw new Error("falhou");
    });
    expect(() => target.dispatchEvent(storageEvent(storage, key, null))).not.toThrow();
    failing();
    stop();
    target.dispatchEvent(storageEvent(storage, key, null));
    expect(seen).toHaveLength(3);
  });

  it("sem storage, sem pessoa ou sem janela, não ouve nada", () => {
    const target = new EventTarget();
    const listen = vi.spyOn(target, "addEventListener");
    const onChange = vi.fn();
    watchStoredCart(target, null, key, onChange)();
    watchStoredCart(target, memory(), "", onChange)();
    watchStoredCart(null, memory(), key, onChange)();
    expect(listen).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("aviso de pedido salvo neste aparelho", () => {
  it("só quando o pedido foi gravado no storage", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-salvo");
    writeStoredCart(storage, key, draft);
    expect(isStoredCartSaved(storage, key)).toBe(true);
    expect(isStoredCartSaved(storage, "")).toBe(false);
    expect(isStoredCartSaved(null, key)).toBe(false);
  });

  it("sem storage ou com storage cheio, o pedido vale só nesta visita", () => {
    const key = cartStorageKey("BTG Pactual", "uid-visita");
    writeStoredCart(null, key, draft);
    expect(isStoredCartSaved(null, key)).toBe(false);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("cheio", "QuotaExceededError");
      },
    };
    writeStoredCart(full, key, draft);
    expect(isStoredCartSaved(full, key)).toBe(false);
    const storage = memory();
    writeStoredCart(storage, key, draft);
    expect(isStoredCartSaved(storage, key)).toBe(true);
  });
});

describe("o pedido que saiu de um cartão do Agent Dute", () => {
  it("fica ligado à mensagem do cartão enquanto tem itens", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-ana");
    patchStoredCart(storage, key, { ...draft, mensagemDoAgente: "msg_agent_1" });
    expect(readStoredCart(storage, key).mensagemDoAgente).toBe("msg_agent_1");
    // Mais um item: continua o mesmo pedido.
    patchStoredCart(storage, key, { cart: { "sku-1": 2, "sku-2": 1 } });
    expect(readStoredCart(storage, key).mensagemDoAgente).toBe("msg_agent_1");
  });

  it("enviado ou esvaziado, perde a ligação: o próximo pedido é outro", () => {
    const storage = memory();
    const key = cartStorageKey("BTG Pactual", "uid-ana");
    patchStoredCart(storage, key, { ...draft, mensagemDoAgente: "msg_agent_1" });
    patchStoredCart(storage, key, { cart: {} });
    expect(readStoredCart(storage, key)).not.toHaveProperty("mensagemDoAgente");
  });
});

