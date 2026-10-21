import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readDocs, countDocs } = vi.hoisted(() => ({
  readDocs: vi.fn(),
  countDocs: vi.fn(),
}));

vi.mock("./firebase", () => ({ firebaseAuth: null, firestore: {} }));
vi.mock("./functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...original,
    collection: vi.fn((_store: unknown, path: string) => ({ path })),
    query: vi.fn((target: unknown, ...constraints: unknown[]) => ({ target, constraints })),
    getDocs: readDocs,
    getCountFromServer: countDocs,
  };
});

import { installCloudApi } from "./cloud-api";

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, get: (field: string) => data[field] };
}

// A BTG como pode estar no dute-prod: sem sigla e sem o campo stage.
const customers = [
  document("ACME", { code: "ACME", name: "Acme Ltda", stage: "prospect", status: "active" }),
  document("BTG_Pactual", { code: "BTG Pactual", name: "BTG Pactual", status: "active" }),
  document("Ita_", { code: "Itaú", name: "Itaú Unibanco", sku_prefix: "ITAU", stage: "cliente", status: "active" }),
  document("Antigo", { code: "Antigo", name: "Antigo", status: "archived", archived: true }),
];

beforeEach(() => {
  readDocs.mockReset();
  countDocs.mockReset();
  countDocs.mockResolvedValue({ data: () => ({ count: customers.length }) });
  readDocs.mockResolvedValue({ docs: customers });
  vi.stubGlobal("window", {
    fetch: vi.fn(),
    location: { origin: "https://dute.test" },
  });
  installCloudApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function codes(path: string): Promise<string[]> {
  const response = await window.fetch(path);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Array<{ code: string }> };
  return body.items.map((item) => item.code);
}

describe("lista de clientes do WMS", () => {
  it("esconde o prospect do Comercial (Configurações › Clientes, convite e Posições)", async () => {
    expect(await codes("/api/customers?limit=500")).toEqual(["BTG Pactual", "Itaú"]);
    expect(await codes("/api/customers?status=active&limit=250")).toEqual(["BTG Pactual", "Itaú"]);
  });

  it("mostra o prospect só com include_prospects=true", async () => {
    expect(await codes("/api/customers?limit=500&include_prospects=true")).toEqual(["ACME", "BTG Pactual", "Itaú"]);
    expect(await codes("/api/customers?limit=500&include_prospects=true&include_archived=true")).toEqual([
      "ACME",
      "BTG Pactual",
      "Itaú",
      "Antigo",
    ]);
  });

  it("o filtro de prospect vale só para a lista de clientes", async () => {
    readDocs.mockResolvedValue({ docs: [document("p1", { code: "P1", stage: "prospect" })] });
    expect(await codes("/api/client-profiles?limit=500")).toEqual(["P1"]);
  });
});
