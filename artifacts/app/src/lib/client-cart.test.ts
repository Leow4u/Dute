import { describe, expect, it } from "vitest";

import { emptyStoredCart, patchStoredCart, readStoredCart, writeStoredCart } from "./client-cart";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("pedido do portal neste aparelho", () => {
  it("volta igual depois de gravar e ler", () => {
    const storage = memory();
    const draft = {
      cart: { "sku-1": 2 },
      orderName: "Abastecimento",
      destination: "Agência Faria Lima",
      dueAt: "2026-10-27T07:00",
      notes: "Portaria",
    };
    writeStoredCart(storage, "BTG Pactual", draft);
    expect(readStoredCart(storage, "BTG Pactual")).toEqual(draft);
    expect(readStoredCart(storage, "outro")).toEqual(emptyStoredCart());
  });

  it("um campo novo não apaga o resto", () => {
    const storage = memory();
    writeStoredCart(storage, "BTG Pactual", {
      cart: { "sku-1": 2 },
      orderName: "",
      destination: "Faria Lima",
      dueAt: "",
      notes: "",
    });
    const next = patchStoredCart(storage, "BTG Pactual", { notes: "Receber na doca" });
    expect(next.destination).toBe("Faria Lima");
    expect(next.cart).toEqual({ "sku-1": 2 });
    expect(next.notes).toBe("Receber na doca");
  });

  it("ignora quantidade inválida e texto corrompido", () => {
    const storage = memory();
    storage.setItem("dute.portal.pedido.BTG Pactual", "{");
    expect(readStoredCart(storage, "BTG Pactual")).toEqual(emptyStoredCart());
    storage.setItem(
      "dute.portal.pedido.BTG Pactual",
      JSON.stringify({ cart: { a: 0, b: 1.9, c: "x" }, destination: 4 }),
    );
    expect(readStoredCart(storage, "BTG Pactual")).toEqual({
      ...emptyStoredCart(),
      cart: { b: 1 },
    });
  });
});
