import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O Início do Comercial e o catálogo das medições sem rede (carregamento v2,
 * parte 13i): as leituras iam ao Firestore pelo `getDocs` direto, que sem
 * rede responde com o cache, vazio na primeira visita, e o Início dizia que
 * não havia nada para aprovar. Agora passam pelo `lerDocsDoServidor` do `lib/cloud-api.ts`: a
 * leitura só do cache é a falta de conexão. Dados sintéticos; o Firestore é
 * de mentira.
 */

const { lerDocs, lerDoc } = vi.hoisted(() => ({ lerDocs: vi.fn(), lerDoc: vi.fn() }));

vi.mock("../firebase", () => ({ firebaseAuth: null, firestore: {} }));
vi.mock("../functions-api", () => ({ callFunctionsApi: vi.fn(async () => null) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...original,
    collection: vi.fn((_store: unknown, ...caminho: string[]) => ({ caminho })),
    query: vi.fn((alvo: unknown) => alvo),
    where: () => ({}),
    doc: vi.fn((_store: unknown, ...caminho: string[]) => ({ caminho })),
    getDocs: lerDocs,
    getDoc: lerDoc,
  };
});

import { SemConexao } from "../conexao";
import { lerDevolvidos, lerItensDoCatalogo, lerOrcamentosParaAprovar } from "./inicio";

let semRede = false;

beforeEach(() => {
  semRede = false;
  vi.stubGlobal("navigator", {
    get onLine() {
      return !semRede;
    },
  });
  lerDocs.mockReset();
  lerDoc.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("o Início do Comercial sem rede", () => {
  it("a leitura que só achou o cache é a falta de conexão, e não 'nada para aprovar'", async () => {
    semRede = true;
    lerDocs.mockResolvedValue({ docs: [], metadata: { fromCache: true } });
    await expect(lerOrcamentosParaAprovar()).rejects.toBeInstanceOf(SemConexao);
  });

  it("com a resposta do servidor, lê como antes", async () => {
    lerDocs.mockResolvedValue({ docs: [], metadata: { fromCache: false } });
    await expect(lerOrcamentosParaAprovar()).resolves.toEqual([]);
  });

  it("os devolvidos também", async () => {
    semRede = true;
    lerDocs.mockResolvedValue({ docs: [], metadata: { fromCache: true } });
    await expect(lerDevolvidos("uid_1")).rejects.toBeInstanceOf(SemConexao);
  });

  it("o catálogo das medições também: sem rede, não é o catálogo vazio", async () => {
    semRede = true;
    lerDocs.mockResolvedValue({ docs: [], metadata: { fromCache: true } });
    await expect(lerItensDoCatalogo()).rejects.toBeInstanceOf(SemConexao);
    semRede = false;
    lerDocs.mockResolvedValue({ docs: [{ id: "lpu_1", data: () => ({ item: "Cadeira", unidade: "UN" }) }], metadata: { fromCache: false } });
    expect([...(await lerItensDoCatalogo()).keys()]).toEqual(["lpu_1"]);
  });
});
