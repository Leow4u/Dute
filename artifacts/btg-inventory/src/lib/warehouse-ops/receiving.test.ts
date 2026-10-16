import { describe, expect, it } from "vitest";

import { normalizeQueues, type WarehouseOpsResponse, type WarehouseTask } from "./model";
import { buildReceivingBoard, parseQuantity, putawayRowMeta, receiptLinesFromInvoice, receivingRowMeta } from "./receiving";

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

describe("chegada avulsa pela nota", () => {
  const emptyLine = () => ({ sku: "", clientCode: "", product: "", quantity: "1", unitCost: "", createNew: false, category: "" });
  const lookup = (code: string) =>
    code.toUpperCase() === "A.01" ? { skuCode: "SKU-A01", clientCode: "A.01", productName: "CAMISETA G", unitCost: 12.5 } : undefined;

  it("item casado entra com o cadastro; item sem código entra para o operador ler a etiqueta", () => {
    const lines = receiptLinesFromInvoice(
      [emptyLine()],
      [
        { code: "a.01", name: "CAMISETA", quantity: "300" },
        { code: "", name: "ECOBAG LONA", quantity: "1.200" },
        { code: "", name: "", quantity: "4" },
      ],
      { emptyLine, lookup },
    );
    expect(lines).toEqual([
      { ...emptyLine(), sku: "SKU-A01", clientCode: "A.01", product: "CAMISETA G", unitCost: "12.5", quantity: "300" },
      { ...emptyLine(), product: "ECOBAG LONA", quantity: "1200" },
    ]);
  });

  it("código repetido soma com a linha que já estava; sem nada lido fica uma linha vazia", () => {
    const typed = { ...emptyLine(), clientCode: "B.02", product: "CANECA", quantity: "10" };
    expect(receiptLinesFromInvoice([typed, emptyLine()], [{ code: "b.02", name: "Caneca", quantity: "5" }], { emptyLine, lookup })).toEqual([
      { ...typed, quantity: "15" },
    ]);
    expect(receiptLinesFromInvoice([emptyLine()], [], { emptyLine, lookup })).toEqual([emptyLine()]);
  });

  it("quantidade no formato brasileiro, no formato numérico e inválida", () => {
    expect(parseQuantity("1.200")).toBe(1200);
    expect(parseQuantity("1.200,5")).toBe(1200.5);
    expect(parseQuantity("1200.5")).toBe(1200.5);
    expect(parseQuantity("1,5")).toBe(1.5);
    expect(parseQuantity("abc")).toBe(0);
    expect(parseQuantity(-3)).toBe(0);
  });
});
