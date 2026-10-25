import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readDocs, readDoc, countDocs } = vi.hoisted(() => ({
  readDocs: vi.fn(),
  readDoc: vi.fn(),
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
    doc: vi.fn((_store: unknown, path: string, id: string) => ({ path, id })),
    getDoc: readDoc,
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
  readDoc.mockReset();
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

describe("leitura de um registro operacional", () => {
  it("devolve a solicitação pelo id e 404 quando ela não existe", async () => {
    readDoc.mockResolvedValueOnce({
      id: "req-9",
      exists: () => true,
      data: () => ({ id: "req-9", request_number: "ENV-0009", status: "rejected" }),
    });
    const response = await window.fetch("/api/customer-requests/req-9");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "req-9", request_number: "ENV-0009", status: "rejected" });
    expect(readDoc).toHaveBeenCalledWith({ path: "customer_requests", id: "req-9" });

    readDoc.mockResolvedValueOnce({ id: "sumiu", exists: () => false, data: () => undefined });
    const missing = await window.fetch("/api/customer-requests/sumiu");
    expect(missing.status).toBe(404);
  });
});

describe("exceção resolvida não deixa a tarefa com exceção", () => {
  it("as filas contam só a exceção em aberto, como o servidor", async () => {
    const porColecao: Record<string, ReturnType<typeof document>[]> = {
      pick_tasks: [
        document("pick_1", { id: "pick_1", order_id: "ord_1", order_number: "PED-1", status: "planned", customer_code: "Itaú" }),
      ],
      quality_exceptions: [
        document("exc_1", { id: "exc_1", pick_task_id: "pick_1", status: "resolved" }),
        document("exc_2", { id: "exc_2", order_id: "ord_1", status: "cancelled" }),
      ],
    };
    readDocs.mockImplementation(async (alvo: { target?: { path?: string }; path?: string }) => ({
      docs: porColecao[alvo.target?.path ?? alvo.path ?? ""] ?? [],
    }));

    const separacao = async () => (await (await window.fetch("/api/warehouse/ops")).json()).queues.picking.tasks[0];
    const semAberta = await separacao();
    expect(semAberta.exception_count).toBe(0);
    expect(semAberta.blocked_reason).toBeUndefined();

    porColecao.quality_exceptions!.push(
      document("exc_3", { id: "exc_3", order_id: "ord_1", status: "in_review" }),
      document("exc_4", { id: "exc_4", pick_task_id: "pick_1" }),
    );
    expect(await separacao()).toMatchObject({ exception_count: 2, blocked_reason: "Há exceção aberta para este picking." });
  });
});
