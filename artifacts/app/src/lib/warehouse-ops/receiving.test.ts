import { describe, expect, it } from "vitest";

import { normalizeQueues, type WarehouseOpsResponse, type WarehouseTask } from "./model";
import { buildReceivingBoard, openShipmentNotices, putawayRowMeta, receivingArrivalMeta, receivingRowMeta } from "./receiving";

function task(overrides: Partial<WarehouseTask> & { id: string }): WarehouseTask {
  return { status: "planned", can_advance: true, exception_count: 0, ...overrides };
}

const ops = {
  queues: {
    receiving: {
      key: "receiving",
      tasks: [
        task({ id: "r1", reference: "inb_creq_1", title: "NF 1", status: "planned", created_at: "2026-10-01T10:00:00Z" }),
        task({ id: "r2", reference: "inb_creq_2", title: "NF 2", status: "checking", created_at: "2026-10-02T10:00:00Z" }),
        task({ id: "r3", reference: "inb_creq_3", title: "NF 3", status: "received", can_advance: false, created_at: "2026-09-20T10:00:00Z",
          timeline: [{ id: "e1", title: "Concluído", occurred_at: "2026-10-05T10:00:00Z" }] }),
        task({ id: "r4", reference: "inb_avulso_9", title: "Avulsa", status: "planned", blocked_reason: "Sem NF", created_at: "2026-10-03T10:00:00Z" }),
      ],
    },
    putaway: {
      key: "putaway",
      tasks: [
        task({ id: "p1", reference: "put_1", title: "Guardar canecas", status: "planned", quantity: 280, source_location_id: "RECEBIMENTO" }),
        task({ id: "p2", reference: "put_2", title: "Guardar agendas", status: "completed", can_advance: false, quantity: 50,
          timeline: [{ id: "e2", title: "Guardado", occurred_at: "2026-10-06T10:00:00Z" }] }),
      ],
    },
  },
} as unknown as WarehouseOpsResponse;

describe("quadro do Receber", () => {
  const board = buildReceivingBoard(normalizeQueues(ops.queues));

  it("separa em conferir, guardar e recebidos; bloqueio vem primeiro", () => {
    expect(board.check.map(({ task }) => task.id)).toEqual(["r4", "r1", "r2"]);
    expect(board.store.map(({ task }) => task.id)).toEqual(["p1"]);
    // Recebidos: o mais recente primeiro, misturando conferência e guarda.
    expect(board.done.map(({ task }) => task.id)).toEqual(["p2", "r3"]);
  });

  it("apoio da linha diz o tipo, o estado e o tamanho da chegada", () => {
    const checking = board.check.find(({ task }) => task.id === "r2")!.task;
    expect(receivingRowMeta({ ...checking, items: [{ id: "i1", quantity: 1000 }], quantity: 1000 })).toBe(
      "Prevista · em conferência · 1 linha · 1.000 un.",
    );
    const unplanned = board.check.find(({ task }) => task.id === "r4")!.task;
    expect(receivingRowMeta(unplanned)).toBe("Avulsa · qtde aberta");
  });

  it("apoio da guarda diz onde está e para onde vai", () => {
    const putaway = board.store[0].task;
    expect(putawayRowMeta(putaway)).toBe("280 un. · está em RECEBIMENTO");
    expect(putawayRowMeta({ ...putaway, destination_location_id: "A-03-2" })).toBe(
      "280 un. · está em RECEBIMENTO · guardar em A-03-2",
    );
  });

  it("não quebra sem filas", () => {
    expect(buildReceivingBoard(normalizeQueues(undefined))).toEqual({ check: [], store: [], done: [] });
  });
});

describe("avisos de envio no Receber", () => {
  it("lista só o aviso de recebimento ainda aberto e mostra o vínculo na chegada", () => {
    const notices = openShipmentNotices([
      {
        id: "req-1",
        customer_code: "BTG Pactual",
        type: "recebimento",
        status: "open",
        request_number: "ENV-0001",
        supplier: "Camisaria Alfa",
        invoice_number: "1842",
        items: [{ quantity: 10 }],
      },
      { id: "req-2", type: "retirada", status: "open", request_number: "PED-1" },
      { id: "req-3", type: "recebimento", status: "approved", request_number: "ENV-0002" },
    ]);
    expect(notices).toEqual([
      {
        id: "req-1",
        customer_code: "BTG Pactual",
        number: "ENV-0001",
        supplier: "Camisaria Alfa",
        invoice: "1842",
        units: 10,
      },
    ]);
    expect(receivingArrivalMeta(task({ id: "avl", reference: "inb_avulso_1" }), notices[0])).toBe(
      "ENV-0001 · Camisaria Alfa · NF 1842 · Avulsa · qtde aberta",
    );
  });
});
