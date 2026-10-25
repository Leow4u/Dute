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
import { buildOrderQueue } from "./order-queue";
import type { WarehouseOpsResponse } from "./warehouse-ops/model";

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

describe("a fila leva toda tarefa aberta", () => {
  type Fila = { pending: number; tasks: Array<{ reference: string }> };
  type Etapa = [status: string, updatedAt: string];
  const lerAsFilas = async () =>
    (await (await window.fetch("/api/warehouse/ops")).json()) as WarehouseOpsResponse & { queues: Record<string, Fila> };
  // O Firestore devolve cada fila da atualização mais recente para a mais antiga.
  const servir = (porColecao: Record<string, ReturnType<typeof document>[]>) =>
    readDocs.mockImplementation(async (alvo: { target?: { path?: string }; path?: string }) => ({
      docs: [...(porColecao[alvo.target?.path ?? alvo.path ?? ""] ?? [])].sort((esquerda, direita) =>
        String(direita.get("updated_at") ?? "").localeCompare(String(esquerda.get("updated_at") ?? "")),
      ),
    }));
  const tarefa = (id: string, dados: Record<string, unknown>) => document(id, { id, customer_code: "BTG Pactual", ...dados });
  /** As etapas do pedido que existem, com o status e a hora de cada uma. */
  const pedido = (nome: string, etapas: { pick: Etapa; pack?: Etapa; ship?: Etapa }) => {
    const doPedido = (prefixo: string, [status, updatedAt]: Etapa) =>
      tarefa(`${prefixo}_ord_${nome}`, { order_id: `ord_${nome}`, order_number: `PED-${nome}`, status, updated_at: updatedAt });
    return {
      pick_tasks: [doPedido("pick", etapas.pick)],
      pack_tasks: etapas.pack ? [doPedido("pack", etapas.pack)] : [],
      shipments: etapas.ship ? [doPedido("ship", etapas.ship)] : [],
    };
  };
  const juntar = (...partes: Array<Record<string, ReturnType<typeof document>[]>>) => {
    const colecoes: Record<string, ReturnType<typeof document>[]> = {};
    for (const parte of partes) {
      for (const [nome, docs] of Object.entries(parte)) colecoes[nome] = [...(colecoes[nome] ?? []), ...docs];
    }
    return colecoes;
  };
  const hora = (minuto: number) => `2026-10-24T${String(10 + Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}:00.000Z`;
  /** Doze pedidos entregues, todos mais recentes que os do teste. */
  const entregues = () =>
    Array.from({ length: 12 }, (_, i) =>
      pedido(`E${i}`, { pick: ["completed", hora(100 + i)], pack: ["completed", hora(120 + i)], ship: ["delivered", hora(140 + i)] }),
    );
  const referencias = (fila: Fila) => fila.tasks.map((tarefa) => tarefa.reference);

  it("o pedido e a guarda antigos em aberto aparecem depois de doze pedidos entregues mais recentes", async () => {
    servir(
      juntar(...entregues(), pedido("ANTIGO", { pick: ["planned", hora(0)] }), {
        putaway_tasks: [
          ...Array.from({ length: 12 }, (_, i) =>
            tarefa(`put_${i}`, { sku_code: `BTG-0001${String(i).padStart(2, "0")}`, quantity: 5, status: "completed", updated_at: hora(100 + i) }),
          ),
          tarefa("put_antigo", { sku_code: "BTG-000200", quantity: 3, status: "planned", updated_at: hora(0) }),
        ],
      }),
    );

    const ops = await lerAsFilas();
    expect(referencias(ops.queues.picking!)).toContain("pick_ord_ANTIGO");
    expect(ops.queues.picking!.pending).toBe(1);
    expect(referencias(ops.queues.putaway!)).toContain("put_antigo");
    expect(ops.queues.putaway!.pending).toBe(1);
    // Em Pedidos, é o pedido para separar.
    const fila = buildOrderQueue({ ops });
    expect(fila.pick.map((item) => item.orderNumber)).toEqual(["PED-ANTIGO"]);
    expect(fila.delivered).toHaveLength(12);
  });

  it("as etapas encerradas do pedido que ainda não saiu ficam com ele", async () => {
    // Separado e embalado há tempo; a entrega ainda espera.
    servir(
      juntar(...entregues(), pedido("ESPERA", { pick: ["completed", hora(1)], pack: ["completed", hora(2)], ship: ["ready_to_dispatch", hora(3)] })),
    );

    const ops = await lerAsFilas();
    const paraEntregar = buildOrderQueue({ ops }).deliver;
    expect(paraEntregar.map((item) => item.orderNumber)).toEqual(["PED-ESPERA"]);
    expect(paraEntregar[0]!.pick?.reference).toBe("pick_ord_ESPERA");
  });

  it("o pedido encerrado entra inteiro ou não entra: o entregue não volta para Para separar", async () => {
    // Separado depois dos outros, mas entregue antes deles.
    servir(
      juntar(...entregues(), pedido("RAPIDO", { pick: ["completed", hora(133)], pack: ["completed", hora(134)], ship: ["delivered", hora(135)] })),
    );

    const ops = await lerAsFilas();
    const fila = buildOrderQueue({ ops });
    expect(fila.pick).toEqual([]);
    expect(fila.delivered.map((item) => item.orderNumber).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `PED-E${i}`).sort(),
    );
    expect(fila.delivered.every((item) => item.pick && item.pack && item.ship)).toBe(true);
  });
});
