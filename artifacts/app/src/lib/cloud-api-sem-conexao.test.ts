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
    where: () => ({ tipo: "where" }),
    orderBy: () => ({ tipo: "orderBy" }),
    limit: (n: number) => ({ tipo: "limit", n }),
    startAfter: () => ({ tipo: "outra" }),
    documentId: () => "__name__",
    getDoc: readDoc,
    getDocs: readDocs,
    getCountFromServer: countDocs,
  };
});

import { CODIGO_SEM_CONEXAO, SEM_CONEXAO } from "./conexao";
import { installCloudApi } from "./cloud-api";

/**
 * Sem rede, o Firestore não falha: devolve com sucesso o cache da memória,
 * vazio ou pela metade (docs/plataforma/diagnostico-carregamento.md, seção 9,
 * item 1; medido no celular: /api/products com 0 itens em 4 ms, e o servidor
 * tem 6). A leitura que não veio do servidor responde "Sem conexão".
 */

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, get: (field: string) => data[field] };
}

/** O que o getDocs devolve sem rede: o que estava na memória, marcado como do cache. */
function doCache(docs: ReturnType<typeof document>[]) {
  return { docs, metadata: { fromCache: true } };
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

describe("a leitura sem rede", () => {
  it("o que só veio do cache vira 503 com o código, não a lista pela metade", async () => {
    readDocs.mockResolvedValue(doCache([document("CX-000001", { code: "CX-000001", status: "stored" })]));
    const response = await window.fetch("/api/warehouse/boxes?limit=1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("o cache vazio também: a lista não volta vazia com sucesso", async () => {
    readDocs.mockResolvedValue(doCache([]));
    const response = await window.fetch("/api/products?limit=50");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("o painel do Início não vira zeros: a contagem e o agregado sem rede sobem como falta de conexão", async () => {
    readDoc.mockRejectedValue(Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" }));
    countDocs.mockRejectedValue(Object.assign(new Error("Failed to get count result because the client is offline."), { code: "unavailable" }));
    readDocs.mockResolvedValue(doCache([]));
    const response = await window.fetch("/api/dashboard");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: SEM_CONEXAO, code: CODIGO_SEM_CONEXAO });
  });

  it("com o servidor respondendo, a leitura segue como sempre", async () => {
    readDocs.mockResolvedValue({ docs: [document("CX-000001", { code: "CX-000001", status: "stored" })], metadata: { fromCache: false } });
    const response = await window.fetch("/api/warehouse/boxes?limit=1");
    expect(response.status).toBe(200);
    expect((await response.json()).items.map((item: { code: string }) => item.code)).toEqual(["CX-000001"]);
  });
});
