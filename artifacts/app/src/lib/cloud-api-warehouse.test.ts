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

beforeEach(() => {
  readDocs.mockReset();
  countDocs.mockReset();
  countDocs.mockResolvedValue({ data: () => ({ count: 2 }) });
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

describe("leituras de ocupação do armazém", () => {
  it.each([
    "/api/warehouse/positions?limit=2000",
    "/api/warehouse/boxes?limit=5000",
  ])("não transforma consulta falha em lista parcial com sucesso: %s", async (path) => {
    readDocs
      .mockRejectedValueOnce(new Error("Consulta do armazém indisponível"))
      .mockResolvedValueOnce({ docs: [document("parcial", { code: "PARCIAL" })] });

    const response = await window.fetch(path);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Consulta do armazém indisponível" });
    expect(readDocs).toHaveBeenCalledTimes(1);
  });

  it("preserva cursor e has_more para buscar todas as páginas de caixas", async () => {
    readDocs.mockResolvedValueOnce({
      docs: [
        document("CX-000002", { code: "CX-000002", status: "stored" }),
        document("CX-000001", { code: "CX-000001", status: "stored" }),
      ],
    });
    const response = await window.fetch("/api/warehouse/boxes?limit=1");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items.map((item: { code: string }) => item.code)).toEqual(["CX-000002"]);
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toEqual(expect.any(String));
    expect(body.total).toBe(2);

    readDocs.mockRejectedValueOnce(new Error("Página seguinte indisponível"));
    const next = await window.fetch(`/api/warehouse/boxes?limit=1&cursor=${encodeURIComponent(body.next_cursor)}`);
    expect(next.status).toBe(500);
    expect(readDocs).toHaveBeenCalledTimes(2);
  });

  it("mantém o fallback das outras listas", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    readDocs
      .mockRejectedValueOnce(new Error("Índice indisponível"))
      .mockResolvedValueOnce({ docs: [document("produto-1", { product_name: "Produto cadastrado" })] });
    const response = await window.fetch("/api/products?limit=1");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].product_name).toBe("Produto cadastrado");
    expect(readDocs).toHaveBeenCalledTimes(2);
  });
});
