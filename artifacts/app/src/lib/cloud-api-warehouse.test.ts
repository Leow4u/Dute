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
    // Legíveis, para o Firestore de mentira das linhas filtrar, ordenar e cortar.
    where: (campo: unknown, op: string, valor: unknown) => ({ tipo: "where", campo: String(campo), op, valor }),
    orderBy: (campo: unknown, direcao: "asc" | "desc" = "asc") => ({ tipo: "orderBy", campo: String(campo), direcao }),
    limit: (n: number) => ({ tipo: "limit", n }),
    startAfter: () => ({ tipo: "outra" }),
    documentId: () => "__name__",
    getDoc: readDoc,
    getDocs: readDocs,
    getCountFromServer: countDocs,
  };
});

import { installCloudApi } from "./cloud-api";
import { buildOrderQueue } from "./order-queue";
import type { WarehouseOpsResponse, WarehouseTask } from "./warehouse-ops/model";

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

describe("as linhas das tarefas da fila chegam inteiras", () => {
  type Documento = ReturnType<typeof document>;
  type Colecoes = Record<string, Documento[]>;
  type Restricao =
    | { tipo: "where"; campo: string; op: string; valor: unknown }
    | { tipo: "orderBy"; campo: string; direcao: "asc" | "desc" }
    | { tipo: "limit"; n: number }
    | { tipo: "outra" };
  type Item = { id: string; quantity?: number; expected_quantity?: number; picked_quantity?: number; location?: string };
  type Fila = { tasks: Array<{ reference: string; items?: Item[] }> };

  /** O que as consultas devolveram, por coleção. */
  let devolvidos: Colecoes = {};
  const valorDe = (documento: Documento, campo: string) => (campo === "__name__" ? documento.id : documento.get(campo));
  /** Texto ASCII, na ordem dos bytes, como o Firestore compara. */
  const comparar = (esquerda: unknown, direita: unknown) => {
    const [a, b] = [String(esquerda), String(direita)];
    return a < b ? -1 : a > b ? 1 : 0;
  };
  /**
   * Responde como o Firestore: filtra (`==` e `in`, este com até 30 valores),
   * só devolve quem tem o campo da ordem, ordena (sem orderBy, pelo id) e
   * corta no limite.
   */
  const comoOFirestore = (colecoes: Colecoes) => {
    devolvidos = {};
    readDocs.mockImplementation(async ({ target, constraints }: { target: { path: string }; constraints: Restricao[] }) => {
      const filtros = constraints.flatMap((restricao) => (restricao.tipo === "where" ? [restricao] : []));
      const ordens = constraints.flatMap((restricao) => (restricao.tipo === "orderBy" ? [restricao] : []));
      const limite = constraints.flatMap((restricao) => (restricao.tipo === "limit" ? [restricao.n] : []))[0];
      const aceita = (documento: Documento) =>
        filtros.every(({ campo, op, valor }) => {
          if (op === "==") return valorDe(documento, campo) === valor;
          if (op !== "in") throw new Error(`O filtro ${op} não está no Firestore de mentira.`);
          if (!Array.isArray(valor) || valor.length > 30) throw new Error("O filtro in aceita até 30 valores.");
          return valor.includes(valorDe(documento, campo));
        });
      const docs = (colecoes[target.path] ?? [])
        .filter(aceita)
        .filter((documento) => ordens.every(({ campo }) => valorDe(documento, campo) !== undefined))
        .sort((esquerdo, direito) => {
          for (const { campo, direcao } of ordens) {
            const diferenca = comparar(valorDe(esquerdo, campo), valorDe(direito, campo));
            if (diferenca) return direcao === "desc" ? -diferenca : diferenca;
          }
          return (ordens.at(-1)?.direcao === "desc" ? -1 : 1) * comparar(esquerdo.id, direito.id);
        })
        .slice(0, limite);
      devolvidos[target.path] = [...(devolvidos[target.path] ?? []), ...docs];
      return { docs };
    });
  };

  const hora = (minuto: number) => new Date(Date.UTC(2026, 9, 1, 8) + minuto * 60_000).toISOString();
  const numeros = (quantos: number) => Array.from({ length: quantos }, (_, indice) => indice + 1);
  const dois = (numero: number) => String(numero).padStart(2, "0");
  const juntar = (...partes: Colecoes[]) => {
    const colecoes: Colecoes = {};
    for (const parte of partes) {
      for (const [nome, docs] of Object.entries(parte)) colecoes[nome] = [...(colecoes[nome] ?? []), ...docs];
    }
    return colecoes;
  };
  /** O registro com o id dentro, como as Functions gravam. */
  const registro = (id: string, dados: Record<string, unknown>) => document(id, { id, customer_code: "BTG Pactual", ...dados });
  /**
   * O pedido do portal como a aprovação o cria (`ord_creq_<hash>`): uma
   * tarefa por etapa e, por linha, a da separação, o item do pedido e a reserva.
   */
  const pedido = (hash: string, etapas: { pick: string; pack?: string; ship?: string }, linhas: number, minuto: number): Colecoes => {
    const orderId = `ord_creq_${hash}`;
    const doPedido = { order_id: orderId, order_number: `PED-${hash}` };
    const tarefa = (prefixo: string, status: string, depois: number) =>
      registro(`${prefixo}_${orderId}`, { ...doPedido, status, updated_at: hora(minuto + depois) });
    const porLinha = (prefixo: string, dados: (numero: number) => Record<string, unknown>) =>
      numeros(linhas).map((numero) =>
        registro(`${prefixo}_${orderId}_${dois(numero)}`, {
          ...doPedido,
          line_number: numero,
          sku_code: `BTG-${hash}-${dois(numero)}`,
          product_name: `Camisa ${numero}`,
          location_id: "A-01-01",
          ...dados(numero),
        }),
      );
    return {
      pick_tasks: [tarefa("pick", etapas.pick, 0)],
      pack_tasks: etapas.pack ? [tarefa("pack", etapas.pack, 1)] : [],
      shipments: etapas.ship ? [tarefa("ship", etapas.ship, 2)] : [],
      pick_lines: porLinha("pli", (numero) => ({ pick_task_id: `pick_${orderId}`, qty_to_pick: numero, qty_picked: 0, status: "open" })),
      order_items: porLinha("oit", (numero) => ({ requested_qty: numero, picked_qty: etapas.pick === "completed" ? numero : 0, status: "open" })),
      stock_reservations: porLinha("res", (numero) => ({ reserved_qty: numero, status: "reserved" })),
    };
  };
  /** A chegada (`inb_creq_<hash>`) com os itens a conferir. */
  const chegada = (hash: string, status: string, itens: number, minuto: number): Colecoes => {
    const receiptId = `inb_creq_${hash}`;
    return {
      inbound_receipts: [registro(receiptId, { receipt_number: `NF-${hash}`, status, created_at: hora(minuto), updated_at: hora(minuto) })],
      inbound_items: numeros(itens).map((numero) =>
        registro(`inbi_${receiptId}_${dois(numero)}`, {
          receipt_id: receiptId,
          line_number: numero,
          sku_code: `BTG-${hash}-${dois(numero)}`,
          product_name: `Calça ${numero}`,
          expected_qty: numero,
          received_qty: 0,
          status: "expected",
        }),
      ),
    };
  };
  /**
   * Sessenta pedidos entregues e sessenta chegadas recebidas, de dez linhas:
   * 600 linhas de separação, itens, reservas e itens de chegada, todos antes
   * dos novos na ordem do id (o hash deles começa por 0).
   */
  const historico = () =>
    numeros(60).flatMap((numero) => {
      const hash = `0${numero.toString(16).padStart(3, "0")}`;
      return [
        pedido(hash, { pick: "completed", pack: "completed", ship: "delivered" }, 10, numero * 3),
        chegada(hash, "received", 10, numero * 3),
      ];
    });
  const lerAsFilas = async () =>
    (await (await window.fetch("/api/warehouse/ops")).json()) as WarehouseOpsResponse & { queues: Record<string, Fila> };

  it("a separação do pedido novo chega com as linhas, depois de 600 linhas antigas na ordem do id", async () => {
    comoOFirestore(juntar(...historico(), pedido("f3c9e1", { pick: "planned" }, 2, 1000)));

    const paraSeparar = buildOrderQueue({ ops: await lerAsFilas() }).pick;
    expect(paraSeparar.map((item) => item.orderNumber)).toEqual(["PED-f3c9e1"]);
    // O "Separado" manda estas linhas (picking_lines); sem elas, o servidor recusa.
    expect(paraSeparar[0]!.pick!.items).toEqual([
      expect.objectContaining({ id: "pli_ord_creq_f3c9e1_01", quantity: 1, location: "A-01-01" }),
      expect.objectContaining({ id: "pli_ord_creq_f3c9e1_02", quantity: 2, location: "A-01-01" }),
    ]);
  });

  it("a embalagem do pedido separado chega com os itens do pedido", async () => {
    comoOFirestore(juntar(...historico(), pedido("e7a2b4", { pick: "completed", pack: "ready" }, 3, 1000)));

    const [separado] = buildOrderQueue({ ops: await lerAsFilas() }).pick;
    expect(separado?.orderNumber).toBe("PED-e7a2b4");
    // O "Separado" embala com estes itens (packing_lines, um por item do pedido).
    expect(separado!.pack!.items!.map((item) => [item.id, item.picked_quantity])).toEqual([
      ["oit_ord_creq_e7a2b4_01", 1],
      ["oit_ord_creq_e7a2b4_02", 2],
      ["oit_ord_creq_e7a2b4_03", 3],
    ]);
  });

  it("a chegada nova chega com os itens para conferir", async () => {
    comoOFirestore(juntar(...historico(), chegada("d4b8a0", "created", 2, 1000)));

    const ops = await lerAsFilas();
    const nova = ops.queues.receiving!.tasks.find((tarefa) => tarefa.reference === "inb_creq_d4b8a0");
    expect(nova?.items?.map((item) => [item.id, item.expected_quantity])).toEqual([
      ["inbi_inb_creq_d4b8a0_01", 1],
      ["inbi_inb_creq_d4b8a0_02", 2],
    ]);
  });

  it("o pedido sem linha de separação mostra a reserva que ficou", async () => {
    const semLinha = pedido("c1d2e3", { pick: "planned" }, 2, 1000);
    comoOFirestore(juntar(...historico(), { ...semLinha, pick_lines: [], order_items: [] }));

    const [paraSeparar] = buildOrderQueue({ ops: await lerAsFilas() }).pick;
    expect(paraSeparar).toMatchObject({
      orderNumber: "PED-c1d2e3",
      blockedReason: "Reserva existe, mas nenhuma linha de picking foi criada.",
    });
  });

  it("com mais de 30 pedidos abertos, as linhas de todos chegam", async () => {
    const abertos = numeros(45).map((numero) => pedido(`f${numero.toString(16).padStart(3, "0")}`, { pick: "planned" }, 2, 1000 + numero));
    comoOFirestore(juntar(...historico(), ...abertos));

    const paraSeparar = buildOrderQueue({ ops: await lerAsFilas() }).pick;
    expect(paraSeparar).toHaveLength(45);
    expect(paraSeparar.filter((item) => item.pick?.items?.length !== 2).map((item) => item.orderNumber)).toEqual([]);
  });

  it("lê só as linhas das tarefas da fila: as abertas e as dos doze pedidos encerrados mais recentes", async () => {
    comoOFirestore(juntar(...historico(), pedido("f3c9e1", { pick: "planned" }, 2, 1000), chegada("d4b8a0", "created", 2, 1000)));

    const ops = await lerAsFilas();
    // Os entregues que a fila mostra seguem com as linhas.
    const entregues = buildOrderQueue({ ops }).delivered;
    expect(entregues).toHaveLength(12);
    expect(entregues.filter((item) => item.pick?.items?.length !== 10 || item.pack?.items?.length !== 10)).toEqual([]);

    const lidos = (colecao: string, campo: string) => new Set((devolvidos[colecao] ?? []).map((documento) => documento.get(campo)));
    const naFila = (fila: string) => new Set(ops.queues[fila]!.tasks.map((tarefa) => tarefa.reference));
    const pedidosDaSeparacao = new Set([...naFila("picking")].map((id) => id.replace(/^pick_/, "")));
    expect(naFila("picking").size).toBe(13);
    expect(lidos("pick_lines", "pick_task_id")).toEqual(naFila("picking"));
    expect(lidos("order_items", "order_id")).toEqual(pedidosDaSeparacao);
    expect(lidos("stock_reservations", "order_id")).toEqual(pedidosDaSeparacao);
    expect(naFila("receiving").size).toBe(13);
    expect(lidos("inbound_items", "receipt_id")).toEqual(naFila("receiving"));
  });
  it("a chegada por caixa chega com as caixas e as linhas com o que está nelas, e a guarda com a caixa (recebimento com caixas, parte 5)", async () => {
    const receiptId = "inb_avulso_caixa1";
    const linhaDaCaixa = (item: string, numero: number, sku: string, quantidade: number) => ({
      inbound_item_id: item,
      line_number: numero,
      sku_code: sku,
      client_item_code: `A.01.0806.004.${numero === 1 ? "XG" : "GG"}`,
      product_name: `POLO ${numero === 1 ? "XG" : "GG"}`,
      size: numero === 1 ? "XG" : "GG",
      counted_qty: quantidade,
    });
    const doCliente = (id: string, dados: Record<string, unknown>) => document(id, { customer_code: "BTG Pactual", ...dados });
    const porCaixa: Colecoes = {
      inbound_receipts: [
        registro(receiptId, {
          receipt_number: "AVL-CX1",
          invoice_number: "48230",
          status: "checking",
          conference_mode: "per_box",
          created_at: hora(1000),
          updated_at: hora(1000),
        }),
      ],
      inbound_items: [
        registro(`${receiptId}_01`, {
          receipt_id: receiptId,
          line_number: 1,
          sku_code: "BTG-000086",
          product_name: "POLO XG",
          expected_qty: 41,
          received_qty: 0,
          boxed_qty: 29,
          box_codes: ["CX-000131"],
          shortage: { qty: 12, boxed_qty: 29, expected_qty: 41, reason: "falta", detail: "Volume 3" },
          status: "expected",
        }),
        registro(`${receiptId}_02`, {
          receipt_id: receiptId,
          line_number: 2,
          sku_code: "BTG-000087",
          product_name: "POLO GG",
          expected_qty: 30,
          received_qty: 0,
          boxed_qty: 30,
          box_codes: ["CX-000131", "CX-000132"],
          status: "expected",
        }),
      ],
      warehouse_boxes: [
        doCliente("CX-000132", {
          code: "CX-000132",
          status: "counting",
          receipt_id: receiptId,
          location_id: "",
          lines: [linhaDaCaixa(`${receiptId}_02`, 2, "BTG-000087", 18)],
          draft_unit_count: 18,
          unit_count: 0,
          conference_revision: 3,
          refusals: [],
        }),
        doCliente("CX-000131", {
          code: "CX-000131",
          status: "committing",
          receipt_id: receiptId,
          location_id: "B-02",
          lines: [linhaDaCaixa(`${receiptId}_01`, 1, "BTG-000086", 29), linhaDaCaixa(`${receiptId}_02`, 2, "BTG-000087", 12)],
          draft_unit_count: 41,
          unit_count: 0,
          length_m: 0.48,
          width_m: 0.38,
          height_m: 0.3,
          gross_weight_kg: 9.4,
          allow_tilt: true,
          allow_stacking: false,
          conference_revision: 7,
          refusals: [{ position: "b-03", reason: "Cheia" }],
        }),
        // A caixa da abertura não é de chegada nenhuma.
        doCliente("CX-000020", { code: "CX-000020", status: "stored", location_id: "A-01", lines: [] }),
      ],
      putaway_tasks: [
        registro("put_box_abc", {
          receipt_id: receiptId,
          receipt_number: "AVL-CX1",
          box_code: "CX-000131",
          lines: [linhaDaCaixa(`${receiptId}_01`, 1, "BTG-000086", 29), linhaDaCaixa(`${receiptId}_02`, 2, "BTG-000087", 12)],
          sku_codes: ["BTG-000086", "BTG-000087"],
          quantity: 41,
          total_units: 41,
          status: "planned",
          source_location_id: "RECEBIMENTO",
          destination_location_id: "B-02",
          updated_at: hora(1001),
        }),
      ],
    };
    comoOFirestore(juntar(...historico(), porCaixa, chegada("d4b8a0", "created", 2, 1000)));

    const ops = await lerAsFilas();
    const tarefa = ops.queues.receiving!.tasks.find((candidata) => candidata.reference === receiptId) as WarehouseTask;
    expect(tarefa).toMatchObject({ conference_mode: "per_box", receipt_number: "AVL-CX1", invoice_number: "48230" });
    // As caixas pelo código, com a revisão que a próxima escrita manda.
    expect(tarefa.boxes!.map((item) => [item.code, item.status, item.location_id, item.unit_count, item.conference_revision])).toEqual([
      ["CX-000131", "committing", "B-02", 41, 7],
      ["CX-000132", "counting", "", 18, 3],
    ]);
    expect(tarefa.boxes![0]).toMatchObject({
      length_m: 0.48,
      gross_weight_kg: 9.4,
      allow_tilt: true,
      allow_stacking: false,
      refused_positions: ["B-03"],
    });
    expect(tarefa.boxes![1]!.lines).toEqual([linhaDaCaixa(`${receiptId}_02`, 2, "BTG-000087", 18)]);
    // A linha da NF com o que está nas caixas e a falta marcada.
    expect(tarefa.items!.map((item) => [item.line_number, item.boxed_qty, item.box_codes, (item.shortage as { qty?: number } | undefined)?.qty])).toEqual([
      [1, 29, ["CX-000131"], 12],
      [2, 30, ["CX-000131", "CX-000132"], undefined],
    ]);

    // A chegada por linha não ganha caixas, e só as caixas da chegada por caixa são lidas.
    const porLinha = ops.queues.receiving!.tasks.find((candidata) => candidata.reference === "inb_creq_d4b8a0") as WarehouseTask;
    expect(porLinha.conference_mode).toBeUndefined();
    expect(porLinha.boxes).toBeUndefined();
    expect((devolvidos.warehouse_boxes ?? []).map((documento) => documento.id).sort()).toEqual(["CX-000131", "CX-000132"]);

    // A guarda da caixa leva a caixa, a chegada e o conteúdo.
    const guarda = ops.queues.putaway!.tasks.find((candidata) => candidata.reference === "put_box_abc") as WarehouseTask;
    expect(guarda).toMatchObject({ box_code: "CX-000131", receipt_id: receiptId, receipt_number: "AVL-CX1" });
    expect(guarda.box_lines!.map((item) => [item.product_name, item.counted_qty])).toEqual([
      ["POLO XG", 29],
      ["POLO GG", 12],
    ]);
  });

  it("a chegada por caixa recebida traz quando a entrada foi concluída, e a guarda aberta no Estoque diz de onde veio (parte 5e)", async () => {
    const receiptId = "inb_avulso_caixa2";
    const filas: Colecoes = {
      inbound_receipts: [
        registro(receiptId, {
          receipt_number: "AVL-CX2",
          invoice_number: "48231",
          status: "received",
          conference_mode: "per_box",
          putaway_status: "pending",
          box_count: 2,
          boxes_stored: 0,
          created_at: hora(1000),
          received_at: hora(1100),
          updated_at: hora(1100),
        }),
      ],
      putaway_tasks: [
        registro("put_area_1", {
          title: "Guardar CALÇA SOCIAL 42",
          sku_code: "BTG-000092",
          quantity: 6,
          total_units: 6,
          status: "planned",
          source: "wms_area_putaway",
          source_location_id: "RECEBIMENTO",
          updated_at: hora(1101),
        }),
      ],
    };
    comoOFirestore(juntar(...historico(), filas, chegada("d4b8a0", "received", 2, 1000)));

    const ops = await lerAsFilas();
    const recebida = ops.queues.receiving!.tasks.find((candidata) => candidata.reference === receiptId) as WarehouseTask;
    expect(recebida).toMatchObject({ conference_mode: "per_box", putaway_status: "pending", box_count: 2, boxes_stored: 0 });
    expect(recebida.received_at).toBe(new Date(hora(1100)).toISOString());
    // A chegada por linha não leva a data: a fila dela não mudou.
    const porLinha = ops.queues.receiving!.tasks.find((candidata) => candidata.reference === "inb_creq_d4b8a0") as WarehouseTask;
    expect(porLinha.received_at).toBeUndefined();
    const daArea = ops.queues.putaway!.tasks.find((candidata) => candidata.reference === "put_area_1") as WarehouseTask;
    expect(daArea.source).toBe("wms_area_putaway");
  });
});
