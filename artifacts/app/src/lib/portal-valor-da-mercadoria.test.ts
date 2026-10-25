// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * O valor da mercadoria que o portal mostra é a mesma conta da fatura
 * (merchandiseValue, functions/wms/src/domain/catalog-prices.ts): o saldo
 * vezes o preço unitário; o total gravado só vale para o SKU sem preço
 * unitário. Firestore falso.
 */

vi.mock("./firebase", () => ({
  firestore: { falso: true },
  firebaseAuth: { currentUser: { uid: "cliente-1", email: "c@example.com", displayName: "Cliente" } },
}));

vi.mock("./functions-api", () => ({ callFunctionsApi: async () => null }));

const DOCS: Record<string, Array<Record<string, unknown>>> = {
  client_profiles: [{ customer_code: "ACME", modules: ["wms"] }],
  client_inventory: [
    // A entrega levou 6 de 10: o total gravado (250) ficou o de antes.
    { customer_code: "ACME", sku_code: "ACME-000001", product_name: "Camisa", qty_on_hand: 4, qty_available: 4 },
    // Sem preço unitário: vale o total gravado.
    { customer_code: "ACME", sku_code: "ACME-000002", product_name: "Caneca", qty_on_hand: 2, qty_available: 2 },
  ],
  catalog_prices: [
    { customer_code: "ACME", sku_code: "ACME-000001", preco_unit: 25, total_cost: 250 },
    { customer_code: "ACME", sku_code: "ACME-000002", total_cost: 90 },
  ],
};

vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  collection: (_db: unknown, nome: string) => ({ nome }),
  doc: (_db: unknown, nome: string, id: string) => ({ nome, id }),
  query: (alvo: { nome: string }) => alvo,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  getDoc: async () => ({ exists: () => true, id: "cliente-1", data: () => ({ role: "cliente", customer_code: "ACME" }) }),
  getDocs: async (alvo: { nome: string }) => {
    const docs = (DOCS[alvo.nome] ?? []).map((data, indice) => ({ id: `${alvo.nome}-${indice}`, data: () => data }));
    return { docs, empty: docs.length === 0, size: docs.length };
  },
}));

import { installCloudApi } from "./cloud-api";

beforeAll(() => {
  installCloudApi();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("o valor da mercadoria no portal", () => {
  it("é o saldo vezes o preço unitário, e o total gravado só sem preço unitário", async () => {
    const resposta = await fetch("/api/client/overview");
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { inventory: { inventory_value: number } };
    expect(corpo.inventory.inventory_value).toBe(4 * 25 + 90);
  });
});
