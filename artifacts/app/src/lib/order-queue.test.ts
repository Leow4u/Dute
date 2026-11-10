import { describe, expect, it } from "vitest";

import {
  buildOrderQueue,
  chaveDaPrincipal,
  isAwaitingDecision,
  linhaDoParaQuando,
  ordersGroupEmpty,
  paraQuandoDoPedido,
  textoDoParaQuando,
  textoDoParaQuandoComAno,
} from "./order-queue";
import type { OrderGroup } from "./warehouse-ops/orders";
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

  it("o pedido cancelado sai das filas, antes ou depois da separação (pergunta 59)", () => {
    const cancelados = {
      queues: {
        picking: {
          key: "picking",
          tasks: [
            task({ id: "p6", reference: "pick_ord_6", title: "PED-6", status: "cancelled" }),
            task({ id: "p7", reference: "pick_ord_7", title: "PED-7", status: "completed" }),
            task({ id: "p8", reference: "pick_ord_8", title: "PED-8" }),
          ],
        },
        packing: {
          key: "packing",
          tasks: [task({ id: "k7", reference: "pack_ord_7", title: "PED-7", status: "completed" })],
        },
        expedition: {
          key: "expedition",
          tasks: [task({ id: "s7", reference: "ship_ord_7", title: "PED-7", status: "cancelled" })],
        },
      },
    } as unknown as WarehouseOpsResponse;
    const queue = buildOrderQueue({ ops: cancelados });
    expect(queue.pick.map((order) => order.orderNumber)).toEqual(["PED-8"]);
    expect([...queue.deliver, ...queue.delivered]).toEqual([]);
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
  it("o grupo vazio diz o dado, sem ensinar o fluxo", () => {
    expect(ordersGroupEmpty("approve")).toBe("Nenhum pedido para aprovar.");
    expect(ordersGroupEmpty("pick")).toBe("Nenhum pedido para separar.");
    expect(ordersGroupEmpty("deliver")).toBe("Nenhum pedido para entregar.");
  });
});

describe("a ação principal da tela (v3)", () => {
  const pedido = (key: string) => ({ key }) as OrderGroup;

  it("é a da primeira linha da fila: aprovar (para quem decide), separar e entregar", () => {
    const fila = { approve: [{ id: "req_1" }], pick: [pedido("PED-1"), pedido("PED-2")], deliver: [pedido("PED-3")] };
    expect(chaveDaPrincipal(fila, true)).toBe("approve:req_1");
    expect(chaveDaPrincipal(fila, false)).toBe("pick:PED-1");
    expect(chaveDaPrincipal({ ...fila, pick: [] }, false)).toBe("deliver:PED-3");
    expect(chaveDaPrincipal({ approve: [], pick: [], deliver: [] }, true)).toBeNull();
  });
});

// No teste de ponta a ponta de 01/11/2026, o "Para quando" ficava gravado na
// solicitação (due_at), mas a coordenação não via a data em Pedidos.
describe("o Para quando que o cliente pediu", () => {
  it("vem no horário de São Paulo, no formato da linha da entrega", () => {
    expect(textoDoParaQuando("2026-11-05T12:00:00.000Z")).toBe("Qui 05/11 09:00");
    // 01:30 em UTC ainda é o dia anterior em São Paulo.
    expect(textoDoParaQuando("2026-11-06T01:30:00.000Z")).toBe("Qui 05/11 22:30");
    expect(textoDoParaQuando({ seconds: Date.parse("2026-11-05T12:00:00.000Z") / 1000 })).toBe("Qui 05/11 09:00");
    expect(textoDoParaQuando(new Date("2026-11-05T12:00:00.000Z"))).toBe("Qui 05/11 09:00");
  });

  it("no papel que fica guardado, a mesma data com o ano", () => {
    expect(textoDoParaQuandoComAno("2026-11-16T14:36:00.000Z")).toBe("Seg 16/11/2026 11:36");
    // 01:30 em UTC do dia 1º de janeiro ainda é o ano anterior em São Paulo.
    expect(textoDoParaQuandoComAno("2027-01-01T01:30:00.000Z")).toBe("Qui 31/12/2026 22:30");
    expect(textoDoParaQuandoComAno({ seconds: Date.parse("2026-11-05T12:00:00.000Z") / 1000 })).toBe("Qui 05/11/2026 09:00");
    expect(textoDoParaQuandoComAno("amanhã")).toBe("");
    expect(textoDoParaQuandoComAno(null)).toBe("");
  });

  it("sem data válida, nada", () => {
    expect(textoDoParaQuando(undefined)).toBe("");
    expect(textoDoParaQuando("")).toBe("");
    expect(textoDoParaQuando("amanhã")).toBe("");
    expect(linhaDoParaQuando(null)).toBeUndefined();
  });

  it("a linha leva o rótulo; o pedido em separação ou entrega usa o da solicitação que o originou", () => {
    expect(linhaDoParaQuando("2026-11-05T12:00:00.000Z")).toBe("Para quando Qui 05/11 09:00");
    const solicitacoes = [{ id: "r1", due_at: "2026-11-05T12:00:00.000Z" }, { id: "r2" }];
    expect(paraQuandoDoPedido({ requestId: "r1" }, solicitacoes)).toBe("Para quando Qui 05/11 09:00");
    expect(paraQuandoDoPedido({ requestId: "r2" }, solicitacoes)).toBeUndefined();
    expect(paraQuandoDoPedido({ requestId: "r3" }, solicitacoes)).toBeUndefined();
    expect(paraQuandoDoPedido({}, solicitacoes)).toBeUndefined();
    expect(paraQuandoDoPedido({ requestId: "r1" }, undefined)).toBeUndefined();
  });
});
