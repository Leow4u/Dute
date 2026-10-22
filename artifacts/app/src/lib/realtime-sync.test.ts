import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = {
  path: string;
  filters: Array<{ field: string; op: string; value: unknown }>;
  next: (snapshot: { docChanges: () => unknown[] }) => void;
};

const { listeners, invalidateQueries, appUser } = vi.hoisted(() => ({
  listeners: [] as Listener[],
  invalidateQueries: vi.fn(),
  appUser: {
    current: null as null | {
      uid: string;
      publicMetadata: { role: string; customer_code?: string };
    },
  },
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

  it("a equipe interna não assina a trava de saída do portal", () => {
    appUser.current = { uid: "wms-a", publicMetadata: { role: "wms" } };
    RealtimeSyncBridge();

    expect(listeners.length).toBeGreaterThan(0);
    expect(listenerOf("client_portal_status")).toHaveLength(0);
  });
});
