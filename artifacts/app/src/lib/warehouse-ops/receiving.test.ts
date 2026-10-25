import { describe, expect, it } from "vitest";

import { getAdvanceGate, normalizeQueues, type WarehouseOpsResponse, type WarehouseTask } from "./model";
import {
  buildReceivingBoard,
  linhasDivergentesDoRecebimento,
  linkedShipmentNotice,
  noticeLinkChoice,
  openShipmentNotices,
  pedeJustificativaDoRecebimento,
  problemaDaJustificativaDoRecebimento,
  putawayRowMeta,
  receivingArrivalMeta,
  receivingRowMeta,
  tarefaPrincipal,
  unlinkedShipmentNotices,
} from "./receiving";

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
    // A chegada aprovada nasce "created": a situação sai em português.
    expect(receivingRowMeta({ ...checking, status: "created", items: [{ id: "i1", quantity: 1000 }], quantity: 1000 })).toBe(
      "Prevista · a conferir · 1 linha · 1.000 un.",
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

  it("a ação principal da tela (v3) é a da primeira a conferir, senão a primeira a guardar", () => {
    expect(tarefaPrincipal(board)).toBe("r4");
    expect(tarefaPrincipal({ check: [], store: board.store })).toBe("p1");
    expect(tarefaPrincipal({ check: [], store: [] })).toBeNull();
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

  it("aviso já vinculado a uma chegada do quadro não vira linha própria, salvo na ficha dessa chegada", () => {
    const notice = (id: string) => ({ id, customer_code: "BTG Pactual", number: id, supplier: "", invoice: "", units: 0 });
    const notices = [notice("req-1"), notice("req-2"), notice("req-3")];
    const tasks = [
      task({ id: "avl-1", reference: "inb_avulso_1", customer_request_id: "req-1" }),
      task({ id: "avl-2", reference: "inb_avulso_2", status: "received", customer_request_id: "req-3" }),
      task({ id: "r1", reference: "inb_creq_9" }),
    ];
    expect(unlinkedShipmentNotices(notices, tasks).map((item) => item.id)).toEqual(["req-2"]);
    expect(unlinkedShipmentNotices(notices, tasks, "req-1").map((item) => item.id)).toEqual(["req-1", "req-2"]);
    expect(unlinkedShipmentNotices(notices, []).map((item) => item.id)).toEqual(["req-1", "req-2", "req-3"]);
  });
});

describe("aviso na ficha da chegada avulsa", () => {
  const open = [
    { id: "req-1", customer_code: "BTG Pactual", number: "ENV-0001", supplier: "Camisaria Alfa", invoice: "1842", units: 10 },
    { id: "req-2", customer_code: "BTG Pactual", number: "ENV-0002", supplier: "", invoice: "", units: 0 },
  ];
  const openOptions = [
    { id: "req-1", title: "ENV-0001 · Camisaria Alfa", detail: "NF 1842 · aguardando aprovação" },
    { id: "req-2", title: "ENV-0002", detail: "aguardando aprovação" },
  ];
  const none = { id: "", title: "Sem aviso", detail: "" };

  it("lê número, status e a chegada da aprovação do aviso vinculado", () => {
    expect(
      linkedShipmentNotice({
        id: "req-9",
        request_number: "ENV-0009",
        status: "approved",
        created_entities: { inbound_id: "inb_avulso_1" },
      }),
    ).toEqual({ id: "req-9", number: "ENV-0009", status: "approved", inbound_id: "inb_avulso_1" });
    expect(linkedShipmentNotice({ id: "req-9", status: "rejected" })).toEqual({
      id: "req-9",
      number: "",
      status: "rejected",
      inbound_id: "",
    });
  });

  it("chegada avulsa aberta escolhe entre sem aviso e os avisos abertos", () => {
    expect(noticeLinkChoice(task({ id: "inb_avulso_1" }), open)).toEqual({
      editable: true,
      selectedId: "",
      options: [none, ...openOptions],
    });
    expect(noticeLinkChoice(task({ id: "inb_avulso_1", customer_request_id: "req-1" }), open)).toEqual({
      editable: true,
      selectedId: "req-1",
      options: [none, ...openOptions],
    });
    // Chegada prevista nasce do aviso aprovado: sem seletor.
    expect(noticeLinkChoice(task({ id: "inb_req-7", reference: "inb_creq_7" }), open)).toBeNull();
  });

  it("aviso vinculado recusado ou cancelado aparece selecionado pelo número e a chegada ainda troca", () => {
    const arrival = task({ id: "receiving:inb_avulso_1", reference: "inb_avulso_1", status: "checking", customer_request_id: "req-9" });
    // Enquanto o aviso vinculado carrega, a ficha não oferece troca.
    expect(noticeLinkChoice(arrival, open)).toBeNull();
    for (const [status, label] of [["rejected", "recusado"], ["cancelled", "cancelado"]]) {
      expect(
        noticeLinkChoice(arrival, open, { id: "req-9", number: "ENV-0009", status, inbound_id: "" }),
      ).toEqual({
        editable: true,
        selectedId: "req-9",
        options: [none, { id: "req-9", title: "ENV-0009", detail: label }, ...openOptions],
      });
    }
    // Sem conseguir ler o aviso, o vínculo aparece pelo id e o desvínculo continua possível.
    expect(noticeLinkChoice(arrival, open, null)).toEqual({
      editable: true,
      selectedId: "req-9",
      options: [none, { id: "req-9", title: "req-9", detail: "" }, ...openOptions],
    });
  });

  it("chegada de outro cliente só mostra o vínculo", () => {
    const arrival = task({ id: "inb_avulso_3", customer: "Outro Cliente" });
    expect(noticeLinkChoice(arrival, open, undefined, "BTG Pactual")).toBeNull();
    expect(noticeLinkChoice({ ...arrival, customer_request_id: "req-8" }, open, { id: "req-8", number: "ENV-0008", status: "open", inbound_id: "" }, "BTG Pactual")).toEqual({
      editable: false,
      selectedId: "req-8",
      options: [{ id: "req-8", title: "ENV-0008", detail: "" }],
    });
    expect(noticeLinkChoice(task({ id: "inb_avulso_3", customer: "BTG Pactual" }), open, undefined, "BTG Pactual")?.editable).toBe(true);
  });

  it("aviso aprovado com a chegada e chegada concluída só mostram o vínculo", () => {
    const linked = { id: "req-9", number: "ENV-0009", status: "approved", inbound_id: "inb_avulso_1" };
    const arrival = task({ id: "receiving:inb_avulso_1", reference: "inb_avulso_1", customer_request_id: "req-9" });
    expect(noticeLinkChoice(arrival, open, linked)).toEqual({
      editable: false,
      selectedId: "req-9",
      options: [{ id: "req-9", title: "ENV-0009", detail: "aprovado" }],
    });
    expect(noticeLinkChoice(task({ id: "inb_avulso_1", customer_request_id: "req-9" }), open, linked)?.editable).toBe(false);
    for (const status of ["received", "completed", "cancelled"]) {
      expect(noticeLinkChoice(task({ id: "inb_avulso_2", status, customer_request_id: "req-1" }), open)).toEqual({
        editable: false,
        selectedId: "req-1",
        options: [openOptions[0]],
      });
      expect(noticeLinkChoice(task({ id: "inb_avulso_2", status }), open)).toBeNull();
    }
  });
});

describe("nomes das filas", () => {
  const labelsOf = (input: WarehouseOpsResponse["queues"]) => normalizeQueues(input).map((queue) => queue.label);

  it("são os de antes, só a guarda mudou", () => {
    expect(labelsOf(undefined)).toEqual(["Receiving", "Guarda", "Picking", "Packing", "Shipping"]);
    // O que o getWarehouseOps manda no name de cada fila; a guarda vale também com o nome antigo.
    for (const putaway of ["Guarda", "Putaway"]) {
      expect(
        labelsOf({
          receiving: { key: "receiving", name: "Receiving", tasks: [] },
          putaway: { key: "putaway", name: putaway, tasks: [] },
          picking: { key: "picking", name: "Picking", tasks: [] },
          packing: { key: "packing", name: "Packing", tasks: [] },
          expedition: { key: "expedition", name: "Expedição", tasks: [] },
        }),
      ).toEqual(["Receiving", "Guarda", "Picking", "Packing", "Expedição"]);
    }
  });

  it("mantêm os nomes que a demo manda", () => {
    expect(
      labelsOf({
        receiving: { key: "receiving", name: "Recebimento", tasks: [] },
        putaway: { key: "putaway", name: "Guarda", tasks: [] },
        picking: { key: "picking", name: "Separação", tasks: [] },
        packing: { key: "packing", name: "Embalagem", tasks: [] },
        expedition: { key: "expedition", name: "Expedição", tasks: [] },
      }),
    ).toEqual(["Recebimento", "Guarda", "Separação", "Embalagem", "Expedição"]);
  });
});

describe("gate da guarda", () => {
  it("não pede conferência de linha e o selo diz Guarda", () => {
    const queues = normalizeQueues({
      putaway: {
        key: "putaway",
        name: "Putaway",
        tasks: [task({ id: "p1", status: "in_progress", can_advance: true, items: [{ id: "linha", quantity: 10 }] })],
      },
    });
    const queue = queues.find((entry) => entry.key === "putaway")!;
    const gate = getAdvanceGate(queue, queue.tasks[0]!, {
      total: 1,
      pending: 1,
      confirmed: 0,
      shortage: 0,
      damaged: 0,
    });
    expect(queue.label).toBe("Guarda");
    expect(gate.canAdvance).toBe(true);
    expect(gate.blockedReason).toBeNull();
    expect(gate.label).toBe("Concluir guarda");
  });
});

describe("justificativa da divergência na chegada", () => {
  const items = [
    { id: "ok", expected_quantity: 10, received_qty: 10, conference_status: "ok" },
    { id: "falta", expected_quantity: 10, received_qty: 8 },
    { id: "sobra", difference_qty: 2 },
    { id: "avaria", expected_quantity: 5, received_qty: 5, conference_status: "short" },
  ];

  it("as linhas com falta, sobra ou divergência na conferência salva", () => {
    expect(linhasDivergentesDoRecebimento(task({ id: "r", items })).map((item) => item.id)).toEqual(["falta", "sobra", "avaria"]);
    expect(linhasDivergentesDoRecebimento(task({ id: "r", items: [items[0]!] }))).toEqual([]);
  });

  it("pede a justificativa só para concluir a chegada em conferência com divergência", () => {
    expect(pedeJustificativaDoRecebimento(task({ id: "r", status: "checking", items }))).toBe(true);
    expect(pedeJustificativaDoRecebimento(task({ id: "r", status: "created", items }))).toBe(false);
    expect(pedeJustificativaDoRecebimento(task({ id: "r", status: "checking", items: [items[0]!] }))).toBe(false);
  });

  it("a justificativa tem ao menos 12 caracteres, sem contar os espaços das pontas", () => {
    expect(problemaDaJustificativaDoRecebimento("")).toBe("Justifique a divergência física antes de concluir o recebimento.");
    expect(problemaDaJustificativaDoRecebimento("  Falta 2 cx  ")).toBe("Justifique a divergência física antes de concluir o recebimento.");
    expect(problemaDaJustificativaDoRecebimento("Faltaram 2 caixas")).toBeNull();
  });
});
