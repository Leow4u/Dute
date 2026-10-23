// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Parte 2.7: o portal lê só as projeções dos módulos contratados. As regras
 * do Firestore já negam o resto; aqui o teste conta o que o portal pede, com
 * o Firestore espionado.
 */

const estado = vi.hoisted(() => ({
  lidas: [] as string[],
  modules: undefined as unknown,
}));

vi.mock("./firebase", () => ({
  firestore: { falso: true },
  firebaseAuth: { currentUser: { uid: "cliente-1", email: "c@example.com", displayName: "Cliente" } },
}));

vi.mock("./functions-api", () => ({ callFunctionsApi: async () => null }));

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
    estado.lidas.push(alvo.nome);
    const docs =
      alvo.nome === "client_profiles" && estado.modules !== null
        ? [{ id: "ACME", data: () => ({ customer_code: "ACME", modules: estado.modules }) }]
        : [];
    return { docs, empty: docs.length === 0, size: docs.length };
  },
}));

import { installCloudApi } from "./cloud-api";

const PROJECOES = ["client_inventory", "client_order_tracking", "client_request_status", "client_invoices", "client_documents"];

beforeAll(() => {
  installCloudApi();
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  estado.lidas.length = 0;
});

async function projecoesLidas(modules: unknown) {
  estado.modules = modules;
  const resposta = await fetch("/api/client/overview");
  expect(resposta.status).toBe(200);
  return PROJECOES.filter((nome) => estado.lidas.includes(nome));
}

describe("o portal lê só o que o contrato abre", () => {
  it("só com a Operação: nenhuma projeção do armazém nem fatura", async () => {
    expect(await projecoesLidas(["operacao"])).toEqual([]);
    expect(estado.lidas).toEqual(["client_profiles"]);
  });

  it("armazenagem sem financeiro: o armazém, sem as faturas", async () => {
    expect(await projecoesLidas(["wms", "operacao"])).toEqual([
      "client_inventory",
      "client_order_tracking",
      "client_request_status",
      "client_documents",
    ]);
  });

  it("só o financeiro: as faturas", async () => {
    expect(await projecoesLidas(["financeiro"])).toEqual(["client_invoices"]);
  });

  it("sem o campo no perfil, o padrão da BTG: armazenagem e faturas", async () => {
    expect(await projecoesLidas(undefined)).toEqual(PROJECOES);
  });
});
