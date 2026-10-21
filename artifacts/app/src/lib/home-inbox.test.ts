import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { alertasParaOInicio, contratoDoRegistro, type Contrato } from "./comercial/contratos";
import { buildHomeInbox, isAwaitingTriage, veContratosNoInicio } from "./home-inbox";
import type { WarehouseOpsResponse, WarehouseTask } from "./warehouse-ops/model";

function task(overrides: Partial<WarehouseTask> & { id: string }): WarehouseTask {
  return { status: "planned", can_advance: true, exception_count: 0, ...overrides };
}

function ops(queues: Record<string, WarehouseTask[]>, extra: Partial<WarehouseOpsResponse> = {}) {
  return {
    queues: Object.fromEntries(
      Object.entries(queues).map(([key, tasks]) => [key, { key, tasks }]),
    ),
    ...extra,
  } as WarehouseOpsResponse;
}

const busyOps = ops(
  {
    picking: [
      task({ id: "p1", reference: "pick_ord_1", title: "PED-1" }),
      task({ id: "p2", reference: "pick_ord_2", title: "PED-2" }),
      task({
        id: "p3",
        reference: "pick_ord_3",
        title: "PED-3",
        blocked_reason: "Falta física na rua B",
      }),
      // Legado derivado: não avança, fica fora da fila.
      task({ id: "p4", reference: "pick_ord_4", title: "PED-4", can_advance: false }),
    ],
    expedition: [
      task({ id: "s1", reference: "ship_ord_1", title: "PED-1", status: "ready_to_dispatch" }),
      task({ id: "s5", reference: "ship_ord_5", title: "PED-5", status: "dispatched" }),
      task({ id: "s6", reference: "ship_ord_6", title: "PED-6", status: "delivered" }),
    ],
    receiving: [
      task({ id: "r1", title: "NF 88213", status: "expected" }),
      task({ id: "r2", title: "NF 88100", status: "received" }),
    ],
  },
  {
    metrics: { agent_alerts: 2 },
    alerts: [{ id: "a1", title: "Saldo divergente em 3 SKUs" }],
  },
);

const requests = [
  { id: "q1", status: "submitted", title: "Retirada 40 un" },
  { id: "q2", status: undefined, title: "Recebimento NF 9" },
  { id: "q3", status: "approved", title: "Já aprovada" },
  { id: "q4", status: "Rejeitada", title: "Recusada" },
];

describe("buildHomeInbox", () => {
  it("lista o que precisa de ação para o admin, bloqueios primeiro", () => {
    const { items, summary } = buildHomeInbox({
      role: "admin",
      ops: busyOps,
      requests,
    });

    expect(items.map((item) => [item.id, item.title, item.href])).toEqual([
      ["blocked:ord_3", "Pedido PED-3 com exceção", "/pedidos"],
      ["triage", "2 solicitações para aprovar", "/solicitacoes"],
      ["to-pick", "1 pedido para separar", "/pedidos"],
      ["to-ship", "2 pedidos para entregar", "/pedidos"],
      ["receipts", "1 recebimento para conferir", "/wms/receber"],
      ["agent", "2 avisos para revisar", "/agente/painel"],
    ]);
    expect(items[0].detail).toBe("Falta física na rua B");
    expect(items[1].detail).toBe("Retirada 40 un · Recebimento NF 9");
    expect(items[5].detail).toBe("Saldo divergente em 3 SKUs e mais 1");
    expect(summary).toEqual({ toPick: 2, toShip: 1, inTransit: 1, openReceipts: 1 });
  });

  it("fica vazia quando não há nada parado", () => {
    expect(buildHomeInbox({ role: "admin", ops: ops({}), requests: [] })).toEqual({
      items: [],
      summary: { toPick: 0, toShip: 0, inTransit: 0, openReceipts: 0 },
    });
  });

  it("não quebra sem dados carregados", () => {
    expect(buildHomeInbox({ role: "admin" }).items).toEqual([]);
  });

  it("só mostra itens cuja tela o papel consegue abrir", () => {
    const financeiro = buildHomeInbox({ role: "financeiro", ops: busyOps, requests });
    expect(financeiro.items.map((item) => item.id)).toEqual(["agent"]);

    const wms = buildHomeInbox({ role: "wms", ops: busyOps, requests });
    expect(wms.items.map((item) => item.id)).toEqual([
      "blocked:ord_3",
      "to-pick",
      "to-ship",
      "receipts",
    ]);
  });

  it("mostra no máximo 3 pedidos bloqueados", () => {
    const blockedOps = ops({
      picking: [1, 2, 3, 4, 5].map((n) =>
        task({ id: `p${n}`, reference: `pick_ord_${n}`, title: `PED-${n}`, exception_count: 1 }),
      ),
    });
    const { items } = buildHomeInbox({ role: "admin", ops: blockedOps });
    expect(items.filter((item) => item.tone === "critical")).toHaveLength(3);
    expect(items[0].detail).toBe("1 exceção aberta");
  });
});

describe("isAwaitingTriage", () => {
  it.each([
    [undefined, true],
    ["open", true],
    ["Enviada", true],
    ["em análise", true],
    ["approved", false],
    ["Encerrada", false],
    ["concluído", false],
  ])("%s → %s", (status, expected) => {
    expect(isAwaitingTriage(status)).toBe(expected);
  });
});

describe("alertas de contrato do Comercial no Início (parte 14)", () => {
  const HOJE = "2026-10-21";
  const base = {
    customer_code: "BTG_Pactual",
    nome: "Armazenagem e serviços",
    vigente_de: "2026-01-01",
    vigente_ate: "2026-12-31",
    renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 60 },
    reajuste: { tipo: "indice", indice: "IPCA", data_base: "11-01" },
    status: "vigente",
  };
  const contratos = [
    contratoDoRegistro("btg-2026", base),
    contratoDoRegistro("antigo", { ...base, customer_code: "ALFA", nome: "Antigo", status: "encerrado" }),
    contratoDoRegistro("longe", { ...base, customer_code: "BETA", vigente_ate: "2028-12-31", reajuste: { tipo: "negociado" } }),
  ].filter((contrato): contrato is Contrato => contrato !== null);
  const alertas = alertasParaOInicio(contratos, new Map([["BTG_Pactual", "BTG Pactual"]]), HOJE);

  const LIBERADO = true;
  const DESLIGADO = false;
  const QUEM_VE: Papel[] = ["owner", "admin", "comercial"];

  const doContrato = (role: Papel, liberado: boolean) =>
    buildHomeInbox({ role, contratos: alertas, comercialLiberado: liberado }).items.filter((item) =>
      item.id.startsWith("contrato:"),
    );

  it("um item por alerta (oposição à renovação, reajuste e fim), levando à ficha do contrato", () => {
    expect(doContrato("owner", LIBERADO)).toEqual([
      {
        id: "contrato:btg-2026:renovacao",
        tone: "critical",
        title: "Oposição à renovação até 01/11/2026 · BTG Pactual",
        detail: "Armazenagem e serviços · em 11 dias",
        href: "/comercial/contratos?id=btg-2026",
        actionLabel: "Abrir contrato",
      },
      {
        id: "contrato:btg-2026:reajuste",
        tone: "critical",
        title: "Reajuste IPCA em 01/11/2026 · BTG Pactual",
        detail: "Armazenagem e serviços · em 11 dias",
        href: "/comercial/contratos?id=btg-2026",
        actionLabel: "Abrir contrato",
      },
      {
        id: "contrato:btg-2026:fim_vigencia",
        tone: "attention",
        title: "Fim da vigência em 31/12/2026 · BTG Pactual",
        detail: "Armazenagem e serviços · em 71 dias",
        href: "/comercial/contratos?id=btg-2026",
        actionLabel: "Abrir contrato",
      },
    ]);
  });

  it.each(QUEM_VE)("%s vê os alertas só com a liberação do Comercial", (role) => {
    expect(doContrato(role, LIBERADO)).toHaveLength(3);
    expect(doContrato(role, DESLIGADO)).toEqual([]);
    expect(veContratosNoInicio(role, LIBERADO)).toBe(true);
    expect(veContratosNoInicio(role, DESLIGADO)).toBe(false);
  });

  it.each(PAPEIS.filter((role) => !QUEM_VE.includes(role)))("%s nunca vê nem consulta os contratos", (role) => {
    expect(doContrato(role, LIBERADO)).toEqual([]);
    expect(veContratosNoInicio(role, LIBERADO)).toBe(false);
    expect(veContratosNoInicio(role, DESLIGADO)).toBe(false);
  });

  it("sem papel, nada", () => {
    expect(veContratosNoInicio(null, LIBERADO)).toBe(false);
    expect(buildHomeInbox({ role: null, contratos: alertas, comercialLiberado: LIBERADO }).items).toEqual([]);
  });

  it("os alertas entram depois das solicitações e antes da fila de pedidos", () => {
    const { items } = buildHomeInbox({ role: "admin", ops: busyOps, requests, contratos: alertas, comercialLiberado: LIBERADO });
    expect(items.map((item) => item.id)).toEqual([
      "blocked:ord_3",
      "triage",
      "contrato:btg-2026:renovacao",
      "contrato:btg-2026:reajuste",
      "contrato:btg-2026:fim_vigencia",
      "to-pick",
      "to-ship",
      "receipts",
      "agent",
    ]);
  });

  it("sem alertas, o Início fica como era", () => {
    const sem = buildHomeInbox({ role: "admin", ops: busyOps, requests, contratos: [], comercialLiberado: LIBERADO });
    expect(sem).toEqual(buildHomeInbox({ role: "admin", ops: busyOps, requests }));
  });
});
