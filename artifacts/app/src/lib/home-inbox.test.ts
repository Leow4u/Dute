import { readFileSync } from "node:fs";

import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import { alertasParaOInicio, contratoDoRegistro, type Contrato } from "./comercial/contratos";
import { alertasDeMedicaoParaOInicio, alertaMedicaoNaoEnviada } from "./comercial/medicoes";
import { buildHomeInbox, isAwaitingTriage, veAprovacoesNoInicio, veContratosNoInicio, veMedicoesNoInicio } from "./home-inbox";
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

describe("orçamentos para aprovar no Início (parte 12a)", () => {
  const LIBERADO = true;
  const DESLIGADO = false;
  const PARA_APROVAR = [
    { numero: "10045", cliente: "Itaú Unibanco" },
    { numero: "10052", cliente: "Grupo SBF" },
    { numero: "10053", cliente: "Safra" },
  ];
  const doComercial = (role: Papel, liberado: boolean) =>
    buildHomeInbox({ role, paraAprovar: PARA_APROVAR, comercialLiberado: liberado }).items.filter(
      (item) => item.id === "comercial:aprovar",
    );

  it("o owner vê quantos esperam por ele, levando à tela de aprovar", () => {
    expect(doComercial("owner", LIBERADO)).toEqual([
      {
        id: "comercial:aprovar",
        tone: "attention",
        title: "3 orçamentos para aprovar",
        detail: "10045 · Itaú Unibanco · 10052 · Grupo SBF e mais 1",
        href: "/comercial/aprovar",
        actionLabel: "Aprovar",
      },
    ]);
    expect(buildHomeInbox({ role: "owner", paraAprovar: PARA_APROVAR.slice(0, 1), comercialLiberado: LIBERADO }).items[0].title).toBe(
      "1 orçamento para aprovar",
    );
    expect(veAprovacoesNoInicio("owner", LIBERADO)).toBe(true);
  });

  it.each(PAPEIS.filter((role) => role !== "owner"))("%s não vê nem consulta (só o owner aprova)", (role) => {
    expect(doComercial(role, LIBERADO)).toEqual([]);
    expect(veAprovacoesNoInicio(role, LIBERADO)).toBe(false);
  });

  it("fora da liberação do Comercial, nem o owner", () => {
    expect(doComercial("owner", DESLIGADO)).toEqual([]);
    expect(veAprovacoesNoInicio("owner", DESLIGADO)).toBe(false);
    expect(veAprovacoesNoInicio(null, LIBERADO)).toBe(false);
  });

  it("nada para aprovar: o Início fica como era", () => {
    expect(buildHomeInbox({ role: "owner", ops: busyOps, requests, paraAprovar: [], comercialLiberado: LIBERADO })).toEqual(
      buildHomeInbox({ role: "owner", ops: busyOps, requests }),
    );
  });

  it("entra depois das solicitações e antes dos contratos e da fila de pedidos", () => {
    const ids = buildHomeInbox({ role: "owner", ops: busyOps, requests, paraAprovar: PARA_APROVAR, comercialLiberado: LIBERADO }).items.map(
      (item) => item.id,
    );
    expect(ids.slice(0, 3)).toEqual(["blocked:ord_3", "triage", "comercial:aprovar"]);
  });

  it("a página só consulta para quem vê (enabled): para os outros papéis, nenhuma leitura sai", () => {
    const home = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
    expect(home).toMatch(/const seesApprovals = veAprovacoesNoInicio\(role\);/);
    expect(home).toMatch(/queryFn: \(\) => lerOrcamentosParaAprovar\(\),\s*enabled: seesApprovals,/);
    expect(home).toMatch(/paraAprovar: approvals\.data/);
  });
});

describe("medição não enviada no Início (parte 16b)", () => {
  const LIBERADO = true;
  const DESLIGADO = false;
  const SAFRA = contratoDoRegistro("safra", {
    customer_code: "BANCO-SAFRA",
    nome: "LPU de transporte",
    vigente_de: "2025-05-12",
    vigente_ate: null,
    regime_padrao: "medicao_mensal",
    regimes: [],
    status: "vigente",
  })!;
  const nomes = new Map([["BANCO-SAFRA", "Banco Safra"]]);
  const alertasEm = (hoje: string, medicoes: Parameters<typeof alertaMedicaoNaoEnviada>[1] = []) =>
    alertasDeMedicaoParaOInicio(
      alertaMedicaoNaoEnviada(hoje, medicoes, [{ id: "safra", ...SAFRA.dados, vigencias_anteriores: [] }]),
      [SAFRA],
      nomes,
    );
  const doInicio = (role: Papel, liberado: boolean, hoje = "2026-10-04") =>
    buildHomeInbox({ role, medicoes: alertasEm(hoje), comercialLiberado: liberado }).items.filter((item) => item.id.startsWith("medicao:"));

  it("a medição do mês que passou, sem envio, alerta e leva à medição daquela competência", () => {
    expect(doInicio("owner", LIBERADO)).toEqual([
      {
        id: "medicao:safra_2026-09",
        tone: "critical",
        title: "Medição de setembro/2026 não enviada · Banco Safra",
        detail: "LPU de transporte · ainda não aberta · 3 dias de atraso",
        href: "/comercial/medicoes?contrato=safra&competencia=2026-09",
        actionLabel: "Abrir medição",
      },
    ]);
  });

  it("no dia da virada do mês, o prazo é hoje e o tom é de atenção; em rascunho diz isso", () => {
    expect(doInicio("admin", LIBERADO, "2026-10-01")[0]).toMatchObject({ tone: "attention", detail: "LPU de transporte · ainda não aberta · prazo hoje" });
    const rascunho = alertasDeMedicaoParaOInicio(
      alertaMedicaoNaoEnviada("2026-10-02", [{ id: "safra_2026-09", contrato_id: "safra", competencia: "2026-09", status: "rascunho" }]),
      [SAFRA],
      nomes,
    );
    expect(buildHomeInbox({ role: "comercial", medicoes: rascunho, comercialLiberado: LIBERADO }).items[0].detail).toBe(
      "LPU de transporte · em rascunho · 1 dia de atraso",
    );
  });

  it.each(["owner", "admin", "comercial"] as Papel[])("%s vê só com a liberação do Comercial", (role) => {
    expect(doInicio(role, LIBERADO)).toHaveLength(1);
    expect(doInicio(role, DESLIGADO)).toEqual([]);
    expect(veMedicoesNoInicio(role, LIBERADO)).toBe(true);
    expect(veMedicoesNoInicio(role, DESLIGADO)).toBe(false);
  });

  it.each(PAPEIS.filter((role) => !["owner", "admin", "comercial"].includes(role)))("%s nunca vê nem consulta a medição", (role) => {
    expect(doInicio(role, LIBERADO)).toEqual([]);
    expect(veMedicoesNoInicio(role, LIBERADO)).toBe(false);
  });

  it("sem papel, nada; sem alerta, o Início fica como era", () => {
    expect(veMedicoesNoInicio(null, LIBERADO)).toBe(false);
    expect(buildHomeInbox({ role: null, medicoes: alertasEm("2026-10-04"), comercialLiberado: LIBERADO }).items).toEqual([]);
    expect(buildHomeInbox({ role: "admin", ops: busyOps, requests, medicoes: [], comercialLiberado: LIBERADO })).toEqual(
      buildHomeInbox({ role: "admin", ops: busyOps, requests }),
    );
  });

  it("entra depois dos alertas de contrato e antes da fila de pedidos", () => {
    const ids = buildHomeInbox({
      role: "admin",
      ops: busyOps,
      requests,
      medicoes: alertasEm("2026-10-04"),
      comercialLiberado: LIBERADO,
    }).items.map((item) => item.id);
    expect(ids).toEqual(["blocked:ord_3", "triage", "medicao:safra_2026-09", "to-pick", "to-ship", "receipts", "agent"]);
  });

  it("a página só consulta para quem vê (enabled): para os outros papéis, nenhuma leitura sai", () => {
    const home = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
    expect(home).toMatch(/const seesMeasurements = veMedicoesNoInicio\(role\);/);
    expect(home).toMatch(/queryFn: \(\) => lerAlertasDeMedicao\(\),\s*enabled: seesMeasurements,/);
    expect(home).toMatch(/medicoes: measurements.data/);
  });
});
