// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O painel do Agent Dute lê a base operacional (/api/operational/foundation)
 * direto do Firestore. A lista de usuários é só de quem administra o acesso
 * (canManageAccess, owner e admin, nas regras): para o interno e o suporte,
 * que também abrem o painel, a consulta dela é negada e derrubaria a base
 * inteira. Aqui o Firestore falso nega como a regra.
 */

const estado = vi.hoisted(() => ({ papel: "interno", lidas: [] as string[] }));

vi.mock("./firebase", () => ({
  firestore: { falso: true },
  firebaseAuth: { currentUser: { uid: "pessoa-1", email: "p@example.com", displayName: "Pessoa" } },
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
  getDoc: async () => ({ exists: () => true, id: "pessoa-1", data: () => ({ role: estado.papel }) }),
  getDocs: async (alvo: { nome: string }) => {
    estado.lidas.push(alvo.nome);
    if (alvo.nome === "users" && !["owner", "admin"].includes(estado.papel)) {
      throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    }
    return { docs: [], empty: true, size: 0 };
  },
}));

import { installCloudApi } from "./cloud-api";

beforeAll(() => {
  installCloudApi();
});

beforeEach(() => {
  estado.lidas.length = 0;
});

describe("a base operacional do painel do agente", () => {
  it.each(["interno", "suporte"])("abre para o %s sem pedir a lista de usuários", async (papel) => {
    estado.papel = papel;
    const resposta = await fetch("/api/operational/foundation");
    expect(resposta.status).toBe(200);
    expect(estado.lidas).not.toContain("users");
    expect(estado.lidas).toContain("customer_accounts");
  });

  it.each(["owner", "admin"])("o %s lê também os usuários, para as contas de cliente", async (papel) => {
    estado.papel = papel;
    const resposta = await fetch("/api/operational/foundation");
    expect(resposta.status).toBe(200);
    expect(estado.lidas).toContain("users");
  });
});
