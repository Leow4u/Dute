import { PAPEIS, type Papel } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import type { ItemDoInicio } from "../inicio-do-modulo";
import type { PendenciasDoInicio } from "./autorizacoes";
import { alertasParaOInicio, contratoDoRegistro, type Contrato } from "./contratos";
import { alertasDeMedicaoParaOInicio, alertaMedicaoNaoEnviada } from "./medicoes";
import {
  DIAS_SEM_RESPOSTA,
  ETAPAS_DO_RESUMO,
  competenciaDoInstante,
  contagemPorEtapa,
  demandaDoResumo,
  devolvidosDe,
  diaDoInstante,
  inicioDaCompetencia,
  numerosDoMes,
  pendenciasDoComercial,
  propostasSemResposta,
  veAprovacoesNoInicio,
  veAutorizacoesNoInicio,
  veContratosNoInicio,
  veDevolvidosNoInicio,
  veMedicoesNoInicio,
  veSemRespostaNoInicio,
  type DemandaDoResumo,
  type OrcamentoDevolvido,
  type PropostaSemResposta,
} from "./pendencias";

const LIBERADO = true;
const DESLIGADO = false;
const QUEM_ABRE: Papel[] = ["owner", "admin", "comercial"];
const semIcone = (itens: ItemDoInicio[]) => itens.map(({ icon: _icon, ...resto }) => resto);

const BASE_DO_CONTRATO = {
  customer_code: "BTG_Pactual",
  nome: "Armazenagem e serviços",
  vigente_de: "2026-01-01",
  vigente_ate: "2026-12-31",
  renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 60 },
  reajuste: { tipo: "indice", indice: "IPCA", data_base: "11-01" },
  status: "vigente",
};
const CONTRATOS = [
  contratoDoRegistro("btg-2026", BASE_DO_CONTRATO),
  contratoDoRegistro("antigo", { ...BASE_DO_CONTRATO, customer_code: "ALFA", nome: "Antigo", status: "encerrado" }),
  contratoDoRegistro("longe", { ...BASE_DO_CONTRATO, customer_code: "BETA", vigente_ate: "2028-12-31", reajuste: { tipo: "negociado" } }),
].filter((contrato): contrato is Contrato => contrato !== null);
const ALERTAS_DE_CONTRATO = alertasParaOInicio(CONTRATOS, new Map([["BTG_Pactual", "BTG Pactual"]]), "2026-10-21");

const PARA_APROVAR = [
  { numero: "10045", cliente: "Itaú Unibanco" },
  { numero: "10052", cliente: "Grupo SBF" },
  { numero: "10053", cliente: "Safra" },
];

const AUTORIZACOES: PendenciasDoInicio = {
  esperandoMaisDe30: [
    { numero: "10029", rotulo: "10029 – RV02", cliente: "Itaú Unibanco", dias: 70 },
    { numero: "10031", rotulo: "10031 – RV02", cliente: "Itaú Unibanco", dias: 49 },
    { numero: "10036", rotulo: "10036 – RV02", cliente: "Itaú Unibanco", dias: 36 },
    { numero: "10041", rotulo: "10041 – RV02", cliente: "BTG Pactual", dias: 112 },
  ],
  prazos: [
    { numero: "10041", rotulo: "10041 – RV02", cliente: "BTG Pactual", limite: "2026-09-29", restantes: -22, vencido: true, critico: true },
    { numero: "10040", rotulo: "10040 – RV02", cliente: "BTG Pactual", limite: "2026-11-18", restantes: 28, vencido: false, critico: false },
  ],
};

const SAFRA = contratoDoRegistro("safra", {
  customer_code: "BANCO-SAFRA",
  nome: "LPU de transporte",
  vigente_de: "2025-05-12",
  vigente_ate: null,
  regime_padrao: "medicao_mensal",
  regimes: [],
  status: "vigente",
})!;
const medicoesEm = (hoje: string, medicoes: Parameters<typeof alertaMedicaoNaoEnviada>[1] = []) =>
  alertasDeMedicaoParaOInicio(
    alertaMedicaoNaoEnviada(hoje, medicoes, [{ id: "safra", ...SAFRA.dados, vigencias_anteriores: [] }]),
    [SAFRA],
    new Map([["BANCO-SAFRA", "Banco Safra"]]),
  );

const DEVOLVIDOS: OrcamentoDevolvido[] = [
  { numero: "10046", rotulo: "10046 – RV01", nota: "Confirme a quantidade de lockers", em: "2026-10-22T18:10:00.000Z" },
];
const SEM_RESPOSTA: PropostaSemResposta[] = [{ numero: "10052", cliente: "Clínica Vida Plena", enviadaEm: "2026-10-17", dias: 6 }];

describe("pendências do Início do Comercial", () => {
  it("o owner vê os orçamentos que esperam por ele, levando à tela de aprovar", () => {
    expect(semIcone(pendenciasDoComercial({ role: "owner", paraAprovar: PARA_APROVAR, comercialLiberado: LIBERADO }))).toEqual([
      {
        id: "comercial:aprovar",
        tone: "attention",
        title: "3 orçamentos para aprovar",
        detail: "10045 · Itaú Unibanco · 10052 · Grupo SBF e mais 1",
        href: "/comercial/aprovar",
        actionLabel: "Aprovar",
      },
    ]);
    expect(pendenciasDoComercial({ role: "owner", paraAprovar: PARA_APROVAR.slice(0, 1), comercialLiberado: LIBERADO })[0].title).toBe(
      "1 orçamento para aprovar",
    );
  });

  it.each(PAPEIS.filter((role) => role !== "owner"))("%s não vê nem consulta os orçamentos para aprovar", (role) => {
    expect(pendenciasDoComercial({ role, paraAprovar: PARA_APROVAR, comercialLiberado: LIBERADO })).toEqual([]);
    expect(veAprovacoesNoInicio(role, LIBERADO)).toBe(false);
  });

  it("um item por alerta de contrato, levando à ficha", () => {
    expect(semIcone(pendenciasDoComercial({ role: "comercial", contratos: ALERTAS_DE_CONTRATO, comercialLiberado: LIBERADO }))).toEqual([
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

  it("o prazo de perda e os executados esperando há mais de 30 dias levam às Autorizações", () => {
    expect(semIcone(pendenciasDoComercial({ role: "admin", autorizacoes: AUTORIZACOES, comercialLiberado: LIBERADO }))).toEqual([
      {
        id: "autorizacoes:prazo:10041",
        tone: "critical",
        title: "Prazo de faturamento vencido em 29/09/2026 · BTG Pactual",
        detail: "10041 – RV02 · há 22 dias",
        href: "/comercial/autorizacoes",
        actionLabel: "Abrir autorizações",
      },
      {
        id: "autorizacoes:prazo:10040",
        tone: "attention",
        title: "Faturar até 18/11/2026 · BTG Pactual",
        detail: "10040 – RV02 · em 28 dias",
        href: "/comercial/autorizacoes",
        actionLabel: "Abrir autorizações",
      },
      {
        id: "autorizacoes:mais-de-30",
        tone: "attention",
        title: "4 executados esperando autorização há mais de 30 dias",
        detail: "10029 – RV02 · 10031 – RV02 · 10036 – RV02 e mais 1",
        href: "/comercial/autorizacoes",
        actionLabel: "Abrir autorizações",
      },
    ]);
    const um = { esperandoMaisDe30: AUTORIZACOES.esperandoMaisDe30.slice(0, 1), prazos: [] };
    expect(pendenciasDoComercial({ role: "owner", autorizacoes: um, comercialLiberado: LIBERADO }).map((item) => item.title)).toEqual([
      "1 executado esperando autorização há mais de 30 dias",
    ]);
  });

  it("a medição do mês que passou sem envio leva à medição daquela competência", () => {
    expect(semIcone(pendenciasDoComercial({ role: "owner", medicoes: medicoesEm("2026-10-04"), comercialLiberado: LIBERADO }))).toEqual([
      {
        id: "medicao:safra_2026-09",
        tone: "critical",
        title: "Medição de setembro/2026 não enviada · Banco Safra",
        detail: "LPU de transporte · ainda não aberta · 3 dias de atraso",
        href: "/comercial/medicoes?contrato=safra&competencia=2026-09",
        actionLabel: "Abrir medição",
      },
    ]);
    const rascunho = alertasDeMedicaoParaOInicio(
      alertaMedicaoNaoEnviada("2026-10-02", [{ id: "safra_2026-09", contrato_id: "safra", competencia: "2026-09", status: "rascunho" }]),
      [SAFRA],
      new Map([["BANCO-SAFRA", "Banco Safra"]]),
    );
    expect(pendenciasDoComercial({ role: "comercial", medicoes: rascunho, comercialLiberado: LIBERADO })[0].detail).toBe(
      "LPU de transporte · em rascunho · 1 dia de atraso",
    );
    expect(pendenciasDoComercial({ role: "admin", medicoes: medicoesEm("2026-10-01"), comercialLiberado: LIBERADO })[0]).toMatchObject({
      tone: "attention",
      detail: "LPU de transporte · ainda não aberta · prazo hoje",
    });
  });

  it("o orçamento devolvido leva à montagem, com a nota de quem devolveu", () => {
    expect(semIcone(pendenciasDoComercial({ role: "comercial", devolvidos: DEVOLVIDOS, comercialLiberado: LIBERADO }))).toEqual([
      {
        id: "devolvido:10046",
        tone: "attention",
        title: "Orçamento 10046 – RV01 devolvido",
        detail: "“Confirme a quantidade de lockers” · 22/10 15:10",
        href: "/comercial/orcamento?numero=10046",
        actionLabel: "Abrir orçamento",
      },
    ]);
    const semNota = [{ ...DEVOLVIDOS[0], nota: null }];
    expect(pendenciasDoComercial({ role: "comercial", devolvidos: semNota, comercialLiberado: LIBERADO })[0].detail).toBe("22/10 15:10");
  });

  it("a proposta sem resposta leva ao orçamento, com o cliente e o dia do envio", () => {
    expect(semIcone(pendenciasDoComercial({ role: "admin", semResposta: SEM_RESPOSTA, comercialLiberado: LIBERADO }))).toEqual([
      {
        id: "sem-resposta:10052",
        tone: "info",
        title: "10052 aguardando o cliente há 6 dias",
        detail: "Clínica Vida Plena · enviado 17/10/2026",
        href: "/comercial/orcamento?numero=10052",
        actionLabel: "Abrir orçamento",
      },
    ]);
  });

  it("o mais urgente primeiro; no mesmo tom, aprovar, devolvidos, contratos, autorizações, medições e sem resposta", () => {
    const ids = pendenciasDoComercial({
      role: "owner",
      paraAprovar: PARA_APROVAR,
      devolvidos: DEVOLVIDOS,
      contratos: ALERTAS_DE_CONTRATO,
      autorizacoes: AUTORIZACOES,
      medicoes: medicoesEm("2026-10-04"),
      semResposta: SEM_RESPOSTA,
      comercialLiberado: LIBERADO,
    }).map((item) => item.id);
    expect(ids).toEqual([
      "contrato:btg-2026:renovacao",
      "contrato:btg-2026:reajuste",
      "autorizacoes:prazo:10041",
      "medicao:safra_2026-09",
      "comercial:aprovar",
      "devolvido:10046",
      "contrato:btg-2026:fim_vigencia",
      "autorizacoes:prazo:10040",
      "autorizacoes:mais-de-30",
      "sem-resposta:10052",
    ]);
  });

  it.each(QUEM_ABRE)("%s vê devolvidos, contratos, autorizações, medições e sem resposta só com a liberação", (role) => {
    const tudo = {
      role,
      devolvidos: DEVOLVIDOS,
      contratos: ALERTAS_DE_CONTRATO,
      autorizacoes: AUTORIZACOES,
      medicoes: medicoesEm("2026-10-04"),
      semResposta: SEM_RESPOSTA,
    };
    expect(pendenciasDoComercial({ ...tudo, comercialLiberado: LIBERADO })).toHaveLength(9);
    expect(pendenciasDoComercial({ ...tudo, comercialLiberado: DESLIGADO })).toEqual([]);
    for (const ve of [veDevolvidosNoInicio, veContratosNoInicio, veAutorizacoesNoInicio, veMedicoesNoInicio, veSemRespostaNoInicio]) {
      expect(ve(role, LIBERADO)).toBe(true);
      expect(ve(role, DESLIGADO)).toBe(false);
    }
  });

  it.each(PAPEIS.filter((role) => !QUEM_ABRE.includes(role)))("%s nunca vê nem consulta o Comercial", (role) => {
    const tudo = {
      role,
      paraAprovar: PARA_APROVAR,
      devolvidos: DEVOLVIDOS,
      contratos: ALERTAS_DE_CONTRATO,
      autorizacoes: AUTORIZACOES,
      medicoes: medicoesEm("2026-10-04"),
      semResposta: SEM_RESPOSTA,
    };
    expect(pendenciasDoComercial({ ...tudo, comercialLiberado: LIBERADO })).toEqual([]);
    for (const ve of [veAprovacoesNoInicio, veDevolvidosNoInicio, veContratosNoInicio, veAutorizacoesNoInicio, veMedicoesNoInicio, veSemRespostaNoInicio]) {
      expect(ve(role, LIBERADO)).toBe(false);
    }
  });

  it("sem papel, nada; sem dados, lista vazia", () => {
    expect(pendenciasDoComercial({ role: null, paraAprovar: PARA_APROVAR, comercialLiberado: LIBERADO })).toEqual([]);
    expect(pendenciasDoComercial({ role: "owner", comercialLiberado: LIBERADO })).toEqual([]);
  });
});

const demanda = (
  etapa: DemandaDoResumo["etapa"],
  marcos: Array<[string, string]>,
  perdaEm: string | null = null,
  extra: Partial<DemandaDoResumo> = {},
): DemandaDoResumo => ({
  numero: "10000",
  cliente: "Cliente",
  etapa,
  etapaDesde: null,
  marcos: marcos.map(([etapaDoMarco, em]) => ({ etapa: etapaDoMarco, em })),
  perdaEm,
  ...extra,
});

describe("resumo do Comercial: orçamentos por etapa e o mês", () => {
  it("lê a demanda do Firestore só com o que o resumo usa", () => {
    expect(
      demandaDoResumo(
        "10031",
        {
          etapa: "perdida",
          customer_name: "Itaú Unibanco",
          etapa_desde: "2026-10-09T15:00:00.000Z",
          marcos: [{ etapa: "em_montagem", em: "2026-10-02T12:00:00.000Z", por_uid: "u" }, { etapa: 3 }],
          perda: { em: "2026-10-09T15:00:00.000Z" },
        },
        ["perdida"],
      ),
    ).toEqual({
      numero: "10031",
      cliente: "Itaú Unibanco",
      etapa: "perdida",
      etapaDesde: "2026-10-09T15:00:00.000Z",
      marcos: [{ etapa: "em_montagem", em: "2026-10-02T12:00:00.000Z" }],
      perdaEm: "2026-10-09T15:00:00.000Z",
    });
    expect(demandaDoResumo("1", { etapa: "aguardando_cliente", customer_code: "SAFRA" }, ETAPAS_DO_RESUMO)).toMatchObject({ cliente: "SAFRA", etapaDesde: null });
    // A demanda direta ainda na Operação (parte 3.4c) não conta para o Comercial.
    expect(demandaDoResumo("2", { etapa: "para_planejar", entrada: "direta", customer_code: "ITAU" }, ETAPAS_DO_RESUMO)).toBeNull();
    expect(demandaDoResumo("3", { etapa: "para_planejar", entrada: "comercial", customer_code: "ITAU" }, ETAPAS_DO_RESUMO)?.etapa).toBe("para_planejar");
    expect(demandaDoResumo("1", { etapa: "cancelada" }, ETAPAS_DO_RESUMO)).toBeNull();
    expect(demandaDoResumo("1", {}, ETAPAS_DO_RESUMO)).toBeNull();
  });

  it("conta as demandas de cada etapa ativa; perdida e cancelada não entram", () => {
    const contagem = contagemPorEtapa([
      demanda("em_montagem", []),
      demanda("em_montagem", []),
      demanda("aguardando_cliente", []),
      demanda("a_faturar", []),
      demanda("perdida", []),
    ]);
    expect(contagem).toEqual({
      em_montagem: 2,
      para_aprovar: 0,
      para_enviar: 0,
      aguardando_cliente: 1,
      para_planejar: 0,
      execucao_a_orcar: 0,
      aguardando_autorizacao: 0,
      a_faturar: 1,
    });
  });

  it("no mês: primeiro envio, primeiro fechamento e perdas, no fuso de São Paulo", () => {
    const demandas = [
      // Enviada e fechada em outubro.
      demanda("para_planejar", [["aguardando_cliente", "2026-10-05T13:00:00.000Z"], ["para_planejar", "2026-10-09T13:00:00.000Z"]]),
      // Enviada em setembro; uma RV de execução enviada de novo em outubro não conta outra vez.
      demanda("aguardando_cliente", [["aguardando_cliente", "2026-09-28T13:00:00.000Z"], ["aguardando_cliente", "2026-10-15T13:00:00.000Z"]]),
      // 01/10 01:00 UTC ainda é 30/09 em São Paulo.
      demanda("aguardando_cliente", [["aguardando_cliente", "2026-10-01T01:00:00.000Z"]]),
      // Perdida em outubro.
      demanda("perdida", [["aguardando_cliente", "2026-10-02T13:00:00.000Z"], ["perdida", "2026-10-20T13:00:00.000Z"]], "2026-10-20T13:00:00.000Z"),
    ];
    expect(numerosDoMes(demandas, "2026-10")).toEqual({ enviados: 2, fechados: 1, perdidos: 1 });
    expect(numerosDoMes(demandas, "2026-09")).toEqual({ enviados: 2, fechados: 0, perdidos: 0 });
  });

  it("a competência e o dia do instante e o início do mês usam o fuso de São Paulo", () => {
    expect(diaDoInstante("2026-10-18T02:00:00.000Z")).toBe("2026-10-17");
    expect(diaDoInstante("x")).toBeNull();
    expect(competenciaDoInstante("2026-10-01T02:59:00.000Z")).toBe("2026-09");
    expect(competenciaDoInstante("2026-10-01T03:00:00.000Z")).toBe("2026-10");
    expect(competenciaDoInstante("x")).toBeNull();
    expect(inicioDaCompetencia("2026-10").toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("propostas sem resposta", () => {
  const aguardando = (numero: string, etapaDesde: string | null, etapa: DemandaDoResumo["etapa"] = "aguardando_cliente") =>
    demanda(etapa, [], null, { numero, cliente: `Cliente ${numero}`, etapaDesde });

  it(`entram depois de ${DIAS_SEM_RESPOSTA} dias corridos aguardando o cliente, a mais antiga primeiro`, () => {
    const demandas = [
      aguardando("10050", "2026-10-18T13:00:00.000Z"), // 5 dias: ainda não
      aguardando("10052", "2026-10-17T13:00:00.000Z"), // 6 dias
      aguardando("10040", "2026-10-01T13:00:00.000Z"), // 22 dias
      aguardando("10041", "2026-10-01T13:00:00.000Z", "para_planejar"), // fechada
      aguardando("10042", null), // sem etapa_desde
    ];
    expect(propostasSemResposta(demandas, "2026-10-23")).toEqual([
      { numero: "10040", cliente: "Cliente 10040", enviadaEm: "2026-10-01", dias: 22 },
      { numero: "10052", cliente: "Cliente 10052", enviadaEm: "2026-10-17", dias: 6 },
    ]);
  });

  it("o dia do envio é o de São Paulo: 18/10 02:00 UTC ainda é 17/10", () => {
    expect(propostasSemResposta([aguardando("10060", "2026-10-18T02:00:00.000Z")], "2026-10-23")).toEqual([
      { numero: "10060", cliente: "Cliente 10060", enviadaEm: "2026-10-17", dias: 6 },
    ]);
  });
});

describe("orçamentos devolvidos", () => {
  const quote = (id: string, data: Record<string, unknown>) => ({ id, data });

  it("só os rascunhos devolvidos que a pessoa montou, o mais recente primeiro", () => {
    const quotes = [
      quote("10046", { status: "rascunho", rv: 1, rotulo: "10046 – RV01", autor_uid: "gui", devolucao: { nota: " Confirme os lockers ", em: "2026-10-22T18:10:00.000Z" } }),
      quote("10047", { status: "rascunho", rv: 0, autor_uid: "gui", devolucao: { em: "2026-10-23T10:00:00.000Z" } }),
      quote("10048", { status: "rascunho", rv: 0, autor_uid: "outra", devolucao: { em: "2026-10-23T10:00:00.000Z" } }),
      quote("10049", { status: "para_aprovar", rv: 0, autor_uid: "gui", devolucao: { em: "2026-10-23T10:00:00.000Z" } }),
      quote("10050", { status: "rascunho", rv: 0, autor_uid: "gui" }),
      quote("10051", { status: "rascunho", rv: 0, autor_uid: "gui", devolucao: { nota: "sem data" } }),
    ];
    expect(devolvidosDe(quotes, "gui")).toEqual([
      { numero: "10047", rotulo: "10047", nota: null, em: "2026-10-23T10:00:00.000Z" },
      { numero: "10046", rotulo: "10046 – RV01", nota: "Confirme os lockers", em: "2026-10-22T18:10:00.000Z" },
    ]);
    expect(devolvidosDe(quotes, "ninguem")).toEqual([]);
  });
});
