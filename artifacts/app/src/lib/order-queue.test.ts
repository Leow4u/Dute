import { describe, expect, it } from "vitest";

import { buildOrderQueue, isAwaitingDecision, ordersGroupEmpty } from "./order-queue";
import type { WarehouseOpsResponse, WarehouseTask } from "./warehouse-ops/model";

function task(overrides: Partial<WarehouseTask> & { id: string }): WarehouseTask {
  return { status: "planned", can_advance: true, exception_count: 0, ...overrides };
}

const ops = {
  queues: {
    picking: {
      key: "picking",
      tasks: [
        task({ id: "p1", reference: "pick_ord_1", title: "PED-1" }),
        task({ id: "p2", reference: "pick_ord_2", title: "PED-2", blocked_reason: "Falta física" }),
      ],
    },
    expedition: {
      key: "expedition",
      tasks: [
        task({ id: "s3", reference: "ship_ord_3", title: "PED-3", status: "ready_to_dispatch" }),
        task({ id: "s4", reference: "ship_ord_4", title: "PED-4", status: "dispatched" }),
        task({ id: "s5", reference: "ship_ord_5", title: "PED-5", status: "delivered" }),
      ],
    },
  },
} as unknown as WarehouseOpsResponse;

describe("fila de pedidos", () => {
  it("separa em aprovar, separar, entregar e entregues", () => {
    const queue = buildOrderQueue({
      ops,
      requests: [
        { id: "r-normal-velha", status: "submitted", created_at: "2026-09-29T08:00:00Z" },
        { id: "r-aprovada", status: "approved" },
        { id: "r-urgente", status: "open", priority: "urgente", created_at: "2026-09-29T12:00:00Z" },
        { id: "r-normal-nova", status: undefined, created_at: { seconds: Date.parse("2026-09-29T10:00:00Z") / 1000 } },
      ],
    });

    // Urgente primeiro; depois quem espera há mais tempo.
    expect(queue.approve.map((request) => request.id)).toEqual([
      "r-urgente",
      "r-normal-velha",
      "r-normal-nova",
    ]);
    // Exceção no topo de "Para separar".
    expect(queue.pick.map((order) => order.orderNumber)).toEqual(["PED-2", "PED-1"]);
    // Pronto para envio e em rota viram um passo só: entregar.
    expect(queue.deliver.map((order) => order.orderNumber)).toEqual(["PED-3", "PED-4"]);
    expect(queue.delivered.map((order) => order.orderNumber)).toEqual(["PED-5"]);
  });

  it("não quebra sem dados", () => {
    expect(buildOrderQueue({})).toEqual({ approve: [], pick: [], deliver: [], delivered: [] });
  });

  it.each([
    [undefined, true],
    ["Enviada", true],
    ["em análise", true],
    ["approved", false],
    ["rejected", false],
    ["closed", false],
  ])("status %s espera decisão: %s", (status, expected) => {
    expect(isAwaitingDecision(status)).toBe(expected);
  });
});

describe("pedido vazio", () => {
  it("explica que o pedido nasce no portal e entra depois da aprovação", () => {
    expect(ordersGroupEmpty("approve")).toBe(
      "O pedido nasce no portal do cliente. Quando ele enviar, a aprovação aparece aqui.",
    );
    expect(ordersGroupEmpty("pick")).toBe(
      "Nada para separar. A separação começa depois que a coordenação aprova o pedido.",
    );
    expect(ordersGroupEmpty("deliver")).toBe("Nenhum pedido esperando entrega.");
  });
});
