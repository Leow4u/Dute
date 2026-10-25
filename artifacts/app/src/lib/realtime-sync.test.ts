import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = {
  path: string;
  filters: Array<{ field: string; op: string; value: unknown }>;
  next: (snapshot: { docChanges: () => unknown[] }) => void;
};

const { listeners, invalidateQueries, appUser, perfil } = vi.hoisted(() => ({
  listeners: [] as Listener[],
  invalidateQueries: vi.fn(),
  appUser: {
    current: null as null | {
      uid: string;
      publicMetadata: { role: string; customer_code?: string };
    },
  },
  // O contrato do cliente (useOperationProfile); null é o perfil ainda carregando.
  perfil: { modules: ["wms", "financeiro"] as string[] | null },
}));

// Sem DOM nos testes: os efeitos rodam na hora em que o componente é chamado.
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useEffect: (effect: () => unknown) => {
      effect();
    },
    useRef: <T>(initial: T) => ({ current: initial }),
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("./auth", () => ({
  useAppUser: () => ({ user: appUser.current, isLoaded: true }),
}));
vi.mock("./firebase", () => ({ firebaseAuth: null, firestore: {} }));
vi.mock("./operation-profile", () => ({
  useOperationProfile: () => ({ profile: perfil.modules ? { modules: perfil.modules } : null, isLoading: !perfil.modules }),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_store: unknown, path: string) => ({ path, filters: [] })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, direction: string) => ({ orderBy: field, direction })),
  limit: vi.fn((count: number) => ({ limit: count })),
  query: vi.fn((target: { path: string }, ...constraints: Array<Record<string, unknown>>) => ({
    path: target.path,
    filters: constraints.filter((constraint) => "field" in constraint),
  })),
  onSnapshot: vi.fn(
    (target: Omit<Listener, "next">, next: Listener["next"]) => {
      listeners.push({ ...target, next });
      return () => undefined;
    },
  ),
}));

import { RealtimeSyncBridge } from "./realtime-sync";

function listenerOf(path: string) {
  return listeners.filter((listener) => listener.path === path);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  listeners.length = 0;
  invalidateQueries.mockReset();
  perfil.modules = ["wms", "financeiro"];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tempo real do portal do cliente", () => {
  it("acompanha só a própria trava de saída da abertura, pela mesma consulta das regras", () => {
    appUser.current = {
      uid: "client-a",
      publicMetadata: { role: "cliente", customer_code: "Itaú" },
    };
    RealtimeSyncBridge();

    const portalStatus = listenerOf("client_portal_status");
    expect(portalStatus).toHaveLength(1);
    expect(portalStatus[0].filters).toEqual([
      { field: "customer_code", op: "==", value: "Itaú" },
    ]);
  });

  it("a trava de saída que muda atualiza o resumo do portal sem recarregar a página", () => {
    appUser.current = {
      uid: "client-a",
      publicMetadata: { role: "cliente", customer_code: "Itaú" },
    };
    RealtimeSyncBridge();
    const [portalStatus] = listenerOf("client_portal_status");

    // O primeiro retrato é o estado já carregado: não refaz a leitura.
    portalStatus.next({ docChanges: () => [{ type: "added" }] });
    vi.runAllTimers();
    expect(invalidateQueries).not.toHaveBeenCalled();

    portalStatus.next({ docChanges: () => [{ type: "modified" }] });
    vi.runAllTimers();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["client-portal-overview"] });
  });

  it("os documentos pedem só o publicado (customer_visible), como a regra exige", () => {
    appUser.current = { uid: "client-a", publicMetadata: { role: "cliente", customer_code: "Itaú" } };
    RealtimeSyncBridge();

    expect(listenerOf("client_documents")).toHaveLength(1);
    expect(listenerOf("client_documents")[0].filters).toEqual([
      { field: "customer_code", op: "==", value: "Itaú" },
      { field: "customer_visible", op: "==", value: true },
    ]);
  });

  it("assina só o que o contrato abre: sem armazenagem, nem estoque, pedidos, solicitações e documentos; sem faturas, nem as faturas", () => {
    appUser.current = { uid: "client-a", publicMetadata: { role: "cliente", customer_code: "Itaú" } };
    perfil.modules = ["operacao"];
    RealtimeSyncBridge();

    for (const colecao of ["client_inventory", "client_order_tracking", "client_request_status", "client_documents", "client_invoices"]) {
      expect(listenerOf(colecao), colecao).toHaveLength(0);
    }
    expect(listenerOf("client_portal_status")).toHaveLength(1);
    expect(listenerOf("agent_conversations")).toHaveLength(1);
  });

  it("com o perfil ainda carregando, o cliente espera para assinar", () => {
    appUser.current = { uid: "client-a", publicMetadata: { role: "cliente", customer_code: "Itaú" } };
    perfil.modules = null;
    RealtimeSyncBridge();

    expect(listeners).toHaveLength(0);
  });

  it("a equipe interna não assina a trava de saída do portal", () => {
    appUser.current = { uid: "wms-a", publicMetadata: { role: "wms" } };
    RealtimeSyncBridge();

    expect(listeners.length).toBeGreaterThan(0);
    expect(listenerOf("client_portal_status")).toHaveLength(0);
  });
});

describe("tempo real da equipe interna", () => {
  it("o financeiro assina os documentos de faturamento, como a regra exige, e não a coleção inteira", () => {
    appUser.current = { uid: "finance-a", publicMetadata: { role: "financeiro" } };
    RealtimeSyncBridge();

    const documentos = listenerOf("documents");
    expect(documentos).toHaveLength(1);
    expect(documentos[0].filters).toEqual([{ field: "entity_type", op: "==", value: "fatura" }]);

    // O primeiro retrato é o estado já carregado; o documento novo atualiza a tela Documentos.
    documentos[0].next({ docChanges: () => [{ type: "added" }] });
    documentos[0].next({ docChanges: () => [{ type: "added" }] });
    vi.runAllTimers();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["operational-documents"] });
  });

  it("a operação segue com o sinal de mudança da coleção inteira", () => {
    appUser.current = { uid: "wms-a", publicMetadata: { role: "wms" } };
    RealtimeSyncBridge();

    const documentos = listenerOf("documents");
    expect(documentos).toHaveLength(1);
    expect(documentos[0].filters).toEqual([]);
    expect(listenerOf("ai_agent_inbox")).toHaveLength(1);
  });

  it("o financeiro só assina o que a regra deixa ele ler: nem a caixa do agente, nem as coleções da operação", () => {
    appUser.current = { uid: "finance-a", publicMetadata: { role: "financeiro" } };
    RealtimeSyncBridge();

    for (const colecao of ["ai_agent_inbox", "customer_requests", "inbound_receipts", "pick_tasks", "shipments"]) {
      expect(listenerOf(colecao), colecao).toHaveLength(0);
    }
    expect(listenerOf("billing_periods")).toHaveLength(1);
    expect(listenerOf("ops_aggregates")).toHaveLength(1);
  });
});
