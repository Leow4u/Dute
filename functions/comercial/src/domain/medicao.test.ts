import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIPOS_AUTORIZACAO as TIPOS_DO_CONTRATO } from "./contratos.js";
import { TIPOS_AUTORIZACAO } from "./events.js";
import {
  COLUNAS_DO_DIARIO,
  ErroMedicao,
  acaoDaMedicaoJaFeita,
  alertaMedicaoNaoEnviada,
  classificarItem,
  competenciaAtual,
  conferenciaDaDiaria,
  contratoComMedicaoMensal,
  destinoNaAprovacaoDaMedicao,
  diaTipoDaData,
  diariaEsperada,
  entradaDaLinhaGravada,
  envioAte,
  execucaoNasLinhas,
  exportarDiarioDeBordo,
  itensDaTabela,
  linhasReprecificadas,
  medicaoId,
  periodosDosAditivos,
  precificarLinhaDaMedicao,
  problemaDaAcaoNaMedicao,
  problemaDaCompetencia,
  problemaDaDemandaNaAprovacao,
  problemaDaDemandaNaMedicao,
  problemaDaEdicao,
  problemaDasDatasDaLinha,
  problemaDoDiaTipo,
  somarQuantidades,
  tabelaDaLinha,
  totalDaMedicao,
  type AtributosDoItem,
  type ContextoDaMedicao,
  type ItemDoCatalogoDaMedicao,
  type LinhaEntradaDaMedicao,
  type TabelaDaMedicao,
} from "./medicao.js";

/**
 * Medição mensal no domínio (parte 16a): a competência e o alerta da virada
 * do mês, o dia da tarifa, a diária que não bate com o dia da execução, o
 * preço pela data da solicitação (com a troca de tabela no meio do mês), as
 * marcas, as transições, o que a aprovação faz com cada demanda e o Diário de
 * Bordo. Dados sintéticos: nenhum preço ou OS de contrato real.
 */

/** Em outubro de 2026: 01/10 é quinta; 03/10 sábado; 04/10 domingo; 12/10 segunda (feriado). */
const em = (iso: string) => new Date(iso);

function item(id: string, campos: Partial<ItemDoCatalogoDaMedicao>): [string, ItemDoCatalogoDaMedicao] {
  return [
    id,
    { id, item: "", descricao: "", servico: "", unidade: "UN", orcavel: true, ativo: true, categoria: null, ...campos },
  ];
}

const CATALOGO = new Map<string, ItemDoCatalogoDaMedicao>([
  item("lpu_aj_util", { categoria: "Diárias", item: "Ajudante", servico: "Diária seg–sex", descricao: "Diária de ajudante", unidade: "DIA" }),
  item("lpu_aj_sab", { categoria: "Diárias", item: "Ajudante", servico: "Diária sábado", descricao: "Diária de ajudante", unidade: "DIA" }),
  item("lpu_aj_dom", { categoria: "Diárias", item: "Ajudante", servico: "Diária domingo e feriado", descricao: "Diária de ajudante", unidade: "DIA" }),
  item("lpu_mot_sab", { categoria: "Diárias", item: "Motorista", servico: "Diária sábado", descricao: "Diária de motorista", unidade: "DIA" }),
  item("lpu_vuc", { categoria: "Viagens", item: "VUC", servico: "Viagem", descricao: "Viagem de VUC", unidade: "VG" }),
  item("lpu_truck", { categoria: "Viagens", item: "Truck", servico: "Viagem", descricao: "Viagem de truck", unidade: "VG" }),
  item("lpu_34", { categoria: "Viagens", item: "3/4", servico: "Viagem", descricao: "Viagem de 3/4", unidade: "VG" }),
]);

function precos(valores: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(valores).map(([id, preco]) => [id, { codigo: `SF-${id}`, descricao_cliente: CATALOGO.get(id)?.descricao ?? id, preco }]),
  );
}

const V1: TabelaDaMedicao = {
  id: "pt_safra_v1",
  customer_code: "SAFRA",
  contract_id: "safra-2026",
  variante: "Comercial",
  vigente_de: "2026-01-01",
  vigente_ate: "2026-10-14",
  status: "encerrada",
  precos: precos({ lpu_aj_util: "280.00", lpu_aj_sab: "364.00", lpu_aj_dom: "476.00", lpu_vuc: "620.00", lpu_truck: "1350.00" }),
};
const V2: TabelaDaMedicao = {
  ...V1,
  id: "pt_safra_v2",
  vigente_de: "2026-10-15",
  vigente_ate: null,
  status: "ativa",
  precos: precos({ lpu_aj_util: "290.00", lpu_aj_sab: "377.00", lpu_aj_dom: "493.00", lpu_vuc: "640.00", lpu_truck: "1400.00" }),
};
/** A Padrão Dutelog tem o 3/4; a medição nunca usa a Padrão. */
const PADRAO: TabelaDaMedicao = {
  id: "pt_padrao",
  customer_code: null,
  contract_id: null,
  variante: "Comercial",
  vigente_de: "2025-01-01",
  vigente_ate: null,
  status: "ativa",
  precos: precos({ lpu_34: "900.00", lpu_vuc: "700.00" }),
};

const CONTEXTO: ContextoDaMedicao = {
  customer_code: "SAFRA",
  contrato_id: "safra-2026",
  variante: "Comercial",
  tabelas: [V1, V2, PADRAO],
  catalogo: CATALOGO,
};

function linha(campos: Partial<LinhaEntradaDaMedicao & { id: string }> = {}): LinhaEntradaDaMedicao & { id: string } {
  return {
    id: "ml_1",
    demanda_numero: null,
    os: "OS 501",
    solicitada_em: "2026-10-13",
    area_solicitante: "Facilities",
    executada_em: "2026-10-16",
    janela: "diurna",
    origem: "Sede",
    destino: "Agência Centro",
    mercadoria: "18 caixas de arquivo",
    itens: [
      { origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2" },
      { origem: "tabela", lpu_item_id: "lpu_vuc", quantidade: "1" },
    ],
    anexo: { nome: "OS 501.pdf", referencia: "pasta da medição/OS 501.pdf" },
    ...campos,
  };
}

describe("competência e alerta da virada do mês", () => {
  it("a competência é a do dia em São Paulo", () => {
    assert.equal(competenciaAtual(em("2026-10-20T13:00:00.000Z")), "2026-10");
    // 31/10 às 23:30 em São Paulo já é 01/11 em UTC.
    assert.equal(competenciaAtual(em("2026-11-01T02:30:00.000Z")), "2026-10");
    assert.equal(competenciaAtual(em("2026-11-01T03:30:00.000Z")), "2026-11");
  });

  it("o prazo de envio é o primeiro dia do mês seguinte; dezembro vira janeiro", () => {
    assert.equal(envioAte("2026-10"), "2026-11-01");
    assert.equal(envioAte("2026-12"), "2027-01-01");
  });

  it("alerta a medição de competência anterior ainda em rascunho, a partir da virada do mês", () => {
    const medicoes = [
      { id: "safra-2026_2026-10", contrato_id: "safra-2026", customer_code: "SAFRA", competencia: "2026-10", status: "rascunho" },
      { id: "safra-2026_2026-09", contrato_id: "safra-2026", customer_code: "SAFRA", competencia: "2026-09", status: "enviada" },
      { id: "safra-2026_2026-08", contrato_id: "safra-2026", customer_code: "SAFRA", competencia: "2026-08", status: "rascunho" },
      { id: "safra-2026_2026-07", contrato_id: "safra-2026", customer_code: "SAFRA", competencia: "2026-07", status: "contestada" },
    ];
    // Ainda em outubro: a de outubro está no prazo; a de agosto, esquecida, já alerta.
    assert.deepEqual(
      alertaMedicaoNaoEnviada(em("2026-10-31T15:00:00.000Z"), medicoes).map((alerta) => alerta.competencia),
      ["2026-08"],
    );
    const virada = alertaMedicaoNaoEnviada(em("2026-11-01T12:00:00.000Z"), medicoes);
    assert.deepEqual(virada, [
      {
        medicao_id: "safra-2026_2026-08",
        contrato_id: "safra-2026",
        customer_code: "SAFRA",
        competencia: "2026-08",
        situacao: "rascunho",
        envio_ate: "2026-09-01",
        dias_de_atraso: 61,
      },
      {
        medicao_id: "safra-2026_2026-10",
        contrato_id: "safra-2026",
        customer_code: "SAFRA",
        competencia: "2026-10",
        situacao: "rascunho",
        envio_ate: "2026-11-01",
        dias_de_atraso: 0,
      },
    ]);
    assert.equal(alertaMedicaoNaoEnviada(em("2026-11-05T12:00:00.000Z"), medicoes)[1].dias_de_atraso, 4);
    assert.deepEqual(alertaMedicaoNaoEnviada(em("2026-11-05T12:00:00.000Z"), []), []);
  });

  it("alerta também o contrato por medição mensal sem a medição do mês que passou, inclusive no mês da renovação", () => {
    const safra = {
      id: "safra-2026",
      customer_code: "SAFRA",
      status: "vigente",
      regime_padrao: "medicao_mensal",
      // Renovado em 01/11: a vigência anterior está no aditivo de prorrogação.
      vigente_de: "2026-11-01",
      vigente_ate: "2027-10-31",
      vigencias_anteriores: [{ de: "2025-11-01", ate: "2026-10-31" }],
    };
    const itau = { id: "itau-2026", customer_code: "ITAU", status: "vigente", regime_padrao: "por_demanda", vigente_de: "2026-01-01", vigente_ate: null };
    const encerrado = { ...safra, id: "safra-antigo", status: "encerrado" };
    const novo = { ...safra, id: "safra-novo", vigente_de: "2026-11-01", vigencias_anteriores: [] };
    const virada = em("2026-11-03T12:00:00.000Z");
    assert.deepEqual(alertaMedicaoNaoEnviada(virada, [], [safra, itau, encerrado, novo]), [
      {
        medicao_id: "safra-2026_2026-10",
        contrato_id: "safra-2026",
        customer_code: "SAFRA",
        competencia: "2026-10",
        situacao: "nao_aberta",
        envio_ate: "2026-11-01",
        dias_de_atraso: 2,
      },
    ]);
    // Aberta (em qualquer situação), não alerta como "não aberta"; o rascunho alerta como rascunho.
    const aberta = [{ id: "safra-2026_2026-10", contrato_id: "safra-2026", customer_code: "SAFRA", competencia: "2026-10", status: "rascunho" }];
    assert.deepEqual(alertaMedicaoNaoEnviada(virada, aberta, [safra]).map((alerta) => alerta.situacao), ["rascunho"]);
    const enviada = [{ ...aberta[0], status: "enviada" }];
    assert.deepEqual(alertaMedicaoNaoEnviada(virada, enviada, [safra]), []);
    // Só a competência anterior: o mês sem serviço não alerta para sempre.
    assert.deepEqual(alertaMedicaoNaoEnviada(em("2026-12-03T12:00:00.000Z"), enviada, [safra]).map((alerta) => alerta.competencia), ["2026-11"]);
  });

  it("id da medição: contrato e competência; competência fora do formato é recusada", () => {
    assert.equal(medicaoId("safra-2026", "2026-10"), "safra-2026_2026-10");
    for (const ruim of ["2026-13", "2026-1", "10/2026", ""]) assert.throws(() => medicaoId("safra-2026", ruim), ErroMedicao, ruim);
  });

  it("só contrato com medição mensal (no regime padrão ou de um serviço) tem medição", () => {
    assert.equal(contratoComMedicaoMensal({ regime_padrao: "medicao_mensal" }), true);
    assert.equal(contratoComMedicaoMensal({ regime_padrao: "por_demanda", regimes: [{ servico: "Equipe fixa", regime: "medicao_mensal" }] }), true);
    assert.equal(contratoComMedicaoMensal({ regime_padrao: "por_demanda", regimes: [{ servico: "Mudança", regime: "por_demanda" }] }), false);
    assert.equal(contratoComMedicaoMensal({ regime_padrao: "wms" }), false);
  });

  it("competência futura ou fora da vigência do contrato é recusada", () => {
    const hoje = em("2026-10-20T13:00:00.000Z");
    const contrato = { vigente_de: "2026-03-10", vigente_ate: "2027-03-09" };
    assert.equal(problemaDaCompetencia(contrato, "2026-10", hoje), null);
    assert.equal(problemaDaCompetencia(contrato, "2026-03", hoje), null, "o mês em que o contrato começa");
    assert.match(String(problemaDaCompetencia(contrato, "2026-11", hoje)), /ainda não começou/);
    assert.match(String(problemaDaCompetencia(contrato, "2026-02", hoje)), /fora da vigência/);
    assert.match(String(problemaDaCompetencia({ vigente_de: "2025-01-01", vigente_ate: "2026-08-31" }, "2026-09", hoje)), /fora da vigência/);
    assert.equal(problemaDaCompetencia({ vigente_de: "2025-01-01", vigente_ate: null }, "2026-09", hoje), null);
  });

  it("depois do aditivo de prorrogação, a medição do último mês do período anterior ainda abre", () => {
    const hoje = em("2026-11-02T13:00:00.000Z");
    // registrarAditivo reescreve a vigência do contrato para o período novo.
    const renovado = { vigente_de: "2026-11-01", vigente_ate: "2027-10-31" };
    const aditivos = [
      { tipo: "prorrogacao", vigente_de: "2026-11-01", vigente_ate: "2027-10-31", vigencia_anterior: { de: "2025-11-01", ate: "2026-10-31" } },
      // O aditivo antigo, registrado depois, entra só no histórico (sem vigencia_anterior).
      { tipo: "prorrogacao", vigente_de: "2024-11-01", vigente_ate: "2025-10-31", vigencia_anterior: null },
      { tipo: "escopo", vigente_de: null, vigente_ate: null, vigencia_anterior: null },
    ];
    const anteriores = periodosDosAditivos(aditivos);
    assert.deepEqual(anteriores, [
      { de: "2025-11-01", ate: "2026-10-31" },
      { de: "2026-11-01", ate: "2027-10-31" },
      { de: "2024-11-01", ate: "2025-10-31" },
    ]);
    assert.match(String(problemaDaCompetencia(renovado, "2026-10", hoje)), /fora da vigência/, "só com a vigência atual");
    assert.equal(problemaDaCompetencia(renovado, "2026-10", hoje, anteriores), null);
    assert.equal(problemaDaCompetencia(renovado, "2025-03", hoje, anteriores), null);
    assert.match(String(problemaDaCompetencia(renovado, "2024-10", hoje, anteriores)), /fora da vigência/);
  });
});

describe("dia da tarifa", () => {
  it("o dia sai da data: sábado, domingo ou dia útil", () => {
    assert.equal(diaTipoDaData("2026-10-01"), "util");
    assert.equal(diaTipoDaData("2026-10-03"), "sabado");
    assert.equal(diaTipoDaData("2026-10-04"), "domingo_feriado");
    assert.equal(diaTipoDaData("2026-10-12"), "util");
  });

  it("feriado cabe em qualquer dia; sábado só no sábado; dia útil só de segunda a sexta", () => {
    assert.equal(problemaDoDiaTipo("2026-10-12", "domingo_feriado"), null, "feriado numa segunda");
    assert.equal(problemaDoDiaTipo("2026-10-03", "domingo_feriado"), null, "feriado num sábado");
    assert.match(String(problemaDoDiaTipo("2026-10-03", "util")), /03\/10\/2026 é sábado/);
    assert.match(String(problemaDoDiaTipo("2026-10-01", "sabado")), /seg–sex/);
    assert.match(String(problemaDoDiaTipo("2026-10-04", "util")), /dom\/feriado/);
  });

  it("a linha é do mês da competência, até hoje, e solicitada antes da execução", () => {
    const hoje = em("2026-10-20T13:00:00.000Z");
    assert.equal(problemaDasDatasDaLinha({ solicitada_em: "2026-09-29", executada_em: "2026-10-01" }, "2026-10", hoje), null);
    assert.match(String(problemaDasDatasDaLinha({ solicitada_em: "2026-09-20", executada_em: "2026-09-30" }, "2026-10", hoje)), /setembro\/2026/);
    assert.match(String(problemaDasDatasDaLinha({ solicitada_em: "2026-10-20", executada_em: "2026-10-21" }, "2026-10", hoje)), /depois de hoje/);
    assert.match(String(problemaDasDatasDaLinha({ solicitada_em: "2026-10-10", executada_em: "2026-10-09" }, "2026-10", hoje)), /antes da execução/);
  });
});

describe("diária que não bate com o dia da execução", () => {
  const daTabela = itensDaTabela(V1, CATALOGO);

  it("reconhece diária com dia e janela, veículo e ajudante pelos atributos do item", () => {
    assert.deepEqual(classificarItem(CATALOGO.get("lpu_aj_util")!), { diaria: { dias: ["util"], janelas: [] }, veiculo: false, ajudante: true });
    assert.deepEqual(classificarItem(CATALOGO.get("lpu_aj_dom")!).diaria, { dias: ["domingo_feriado"], janelas: [] });
    assert.deepEqual(classificarItem({ servico: "Diária de ajudante – segunda a sexta – noturna" }).diaria, { dias: ["util"], janelas: ["noturna"] });
    assert.deepEqual(classificarItem({ servico: "Diária sábados, domingos e feriados" }).diaria, { dias: ["sabado", "domingo_feriado"], janelas: [] });
    assert.deepEqual(classificarItem(CATALOGO.get("lpu_vuc")!), { diaria: null, veiculo: true, ajudante: false });
    assert.equal(classificarItem(CATALOGO.get("lpu_34")!).veiculo, true);
    assert.deepEqual(classificarItem({ item: "Utilitário", servico: "Montagem de mesa" }), { diaria: null, veiculo: true, ajudante: false });
    assert.deepEqual(classificarItem({ item: "Mesa", servico: "Montagem" }), { diaria: null, veiculo: false, ajudante: false });
  });

  /**
   * O formato de uma tabela de ajudante por dia e horário, sem a palavra
   * "diária" (como a carga grava: o serviço no item e a chave curta do
   * cliente na descrição). Horários e textos sintéticos.
   */
  const POR_HORARIO: Array<AtributosDoItem & { lpu_item_id: string }> = [
    ["h_util_dia", "Ajudante de Segunda a Sexta das 08:00 ás 17:00 hrs", "Seg. Sex. | 08h às 17h"],
    ["h_util_noite", "Ajudante de Segunda a Sexta das 18:00 ás 24:00 hrs", "Seg. Sex. | 18h às 24h"],
    ["h_sab_dia", "Ajudante de Sabado das 08:00 ás 17:00 hrs", "Sab. | 08h às 17h"],
    ["h_sab_noite", "Ajudante de Sabado das 18:00 ás 24:00 hrs", "Sab. | 18h às 24h"],
    ["h_dom_dia", "Ajudante de Domingo e Feriado das 08:00 ás 17:00 hrs", "Dom. Fer. | 08h às 17h"],
    ["h_dom_noite", "Ajudante de Domingo e Feriado das 18:00 ás 24:00 hrs", "Dom. Fer. | 18h às 24h"],
  ].map(([lpu_item_id, item, descricao_cliente]) => ({
    lpu_item_id,
    categoria: "Ajudante de apoio",
    item,
    servico: "Prestação de serviço",
    unidade: "UN",
    descricao: descricao_cliente,
    descricao_cliente,
  }));

  it("reconhece a tarifa de ajudante pelo dia e pelo horário, sem a palavra diária", () => {
    const porId = new Map(POR_HORARIO.map((item) => [item.lpu_item_id, item]));
    assert.deepEqual(classificarItem(porId.get("h_util_dia")!), { diaria: { dias: ["util"], janelas: ["diurna"] }, veiculo: false, ajudante: true });
    assert.deepEqual(classificarItem(porId.get("h_util_noite")!).diaria, { dias: ["util"], janelas: ["noturna"] });
    assert.deepEqual(classificarItem(porId.get("h_sab_dia")!).diaria, { dias: ["sabado"], janelas: ["diurna"] });
    assert.deepEqual(classificarItem(porId.get("h_dom_noite")!).diaria, { dias: ["domingo_feriado"], janelas: ["noturna"] });
    // Só a chave curta do cliente, como no Diário de Bordo.
    assert.deepEqual(classificarItem({ item: "Ajudante", descricao_cliente: "Seg. Sex. | 18h às 24h" }).diaria, { dias: ["util"], janelas: ["noturna"] });
    assert.deepEqual(classificarItem({ item: "Ajudante", descricao_cliente: "Sáb. | 08h às 17h" }).diaria, { dias: ["sabado"], janelas: ["diurna"] });
    // Pela unidade: a pessoa por dia, com o dia da tarifa.
    assert.deepEqual(classificarItem({ item: "Equipe de apoio", servico: "Sábado", unidade: "Dia" }), {
      diaria: { dias: ["sabado"], janelas: [] },
      veiculo: false,
      ajudante: true,
    });
    assert.equal(classificarItem({ item: "Equipe de apoio", servico: "Sábado", unidade: "UN" }).diaria, null);
    // Turno que passa da meia-noite é noturno; o que cobre o dia e a noite, os dois.
    assert.deepEqual(classificarItem({ item: "Ajudante", servico: "Segunda a sexta, 22h às 06h" }).diaria, { dias: ["util"], janelas: ["noturna"] });
    assert.deepEqual(classificarItem({ item: "Ajudante", servico: "Sábado, 08h às 22h" }).diaria, { dias: ["sabado"], janelas: ["diurna", "noturna"] });
    // Sem o dia, o ajudante não é diária; "2 a 4 ajudantes" não é horário; veículo não vira diária pelo dia.
    assert.equal(classificarItem({ item: "Ajudante", servico: "Hora extra" }).diaria, null);
    assert.deepEqual(classificarItem({ item: "Ajudante", servico: "Sábado, de 2 a 4 ajudantes" }).diaria, { dias: ["sabado"], janelas: [] });
    assert.equal(classificarItem({ item: "Caminhão VUC", servico: "Transporte aos sábados" }).diaria, null);
  });

  it("na tabela por horário, o sábado na tarifa de dia útil aponta a de sábado da mesma janela; a noturna num serviço diurno, a diurna", () => {
    const util = POR_HORARIO[0];
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "diurna" }, util, POR_HORARIO), { dia_nao_bate: true, trocar_por: "h_sab_dia" });
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "noturna" }, util, POR_HORARIO), { dia_nao_bate: true, trocar_por: "h_sab_noite" });
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "util", janela: "diurna" }, util, POR_HORARIO), { dia_nao_bate: false, trocar_por: null });
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "util", janela: "diurna" }, POR_HORARIO[1], POR_HORARIO), { dia_nao_bate: true, trocar_por: "h_util_dia" });
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "domingo_feriado", janela: "diurna" }, util, POR_HORARIO), { dia_nao_bate: true, trocar_por: "h_dom_dia" });
  });

  it("aponta a diária do dia e da janela, da mesma família; empate ou nenhuma é null", () => {
    const ajudante = CATALOGO.get("lpu_aj_util")!;
    assert.equal(diariaEsperada({ dia_tipo: "sabado", janela: "diurna" }, daTabela, ajudante), "lpu_aj_sab");
    assert.equal(diariaEsperada({ dia_tipo: "domingo_feriado", janela: "diurna" }, daTabela, ajudante), "lpu_aj_dom");
    assert.equal(diariaEsperada({ dia_tipo: "util", janela: "noturna" }, daTabela, ajudante), "lpu_aj_util", "a tabela não separa a janela");
    // A diária de motorista de sábado é de outra família: não vale para o ajudante.
    const comMotorista = itensDaTabela({ ...V1, precos: { ...V1.precos, ...precos({ lpu_mot_sab: "400.00" }) } }, CATALOGO);
    assert.equal(diariaEsperada({ dia_tipo: "sabado", janela: "diurna" }, comMotorista, ajudante), "lpu_aj_sab");
    // Sem saber a família, duas diárias de sábado empatam: ninguém aponta.
    assert.equal(diariaEsperada({ dia_tipo: "sabado", janela: "diurna" }, comMotorista), null);
    // Duas tarifas de sábado para o ajudante: empate, sem segurança.
    const duasDeSabado = [...daTabela, { lpu_item_id: "lpu_aj_sab_2", item: "Ajudante", servico: "Diária aos sábados" }];
    assert.equal(diariaEsperada({ dia_tipo: "sabado", janela: "diurna" }, duasDeSabado, ajudante), null);
    assert.equal(diariaEsperada({ dia_tipo: "sabado", janela: "diurna" }, [], ajudante), null);
  });

  it("sábado na tarifa de dia útil: marca e aponta a de sábado, sem trocar o item", () => {
    const ajudante = { lpu_item_id: "lpu_aj_util", ...CATALOGO.get("lpu_aj_util")! };
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "diurna" }, ajudante, daTabela), {
      dia_nao_bate: true,
      trocar_por: "lpu_aj_sab",
    });
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "util", janela: "diurna" }, ajudante, daTabela), { dia_nao_bate: false, trocar_por: null });
    // Sem a tarifa certa na tabela: só marca.
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "diurna" }, ajudante, itensDaTabela({ ...V1, precos: precos({ lpu_aj_util: "280.00" }) }, CATALOGO)), {
      dia_nao_bate: true,
      trocar_por: null,
    });
    // Veículo não é diária: nunca marca.
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "diurna" }, { lpu_item_id: "lpu_vuc", ...CATALOGO.get("lpu_vuc")! }, daTabela), {
      dia_nao_bate: false,
      trocar_por: null,
    });
    // A diária genérica num sábado em que a tabela tem a de sábado: marca e aponta.
    const generica = { lpu_item_id: "lpu_aj_gen", item: "Ajudante", servico: "Diária" };
    assert.deepEqual(conferenciaDaDiaria({ dia_tipo: "sabado", janela: "diurna" }, generica, [...daTabela, generica]), {
      dia_nao_bate: true,
      trocar_por: "lpu_aj_sab",
    });
  });
});

describe("preço da linha pela data da solicitação", () => {
  it("vale a tabela do contrato vigente na solicitação, mesmo com a troca de tabela no meio da competência", () => {
    // Executadas no mesmo dia (16/10); a primeira foi pedida antes da v2 entrar (15/10).
    const antes = precificarLinhaDaMedicao(linha({ id: "ml_a", solicitada_em: "2026-10-13" }), CONTEXTO);
    const depois = precificarLinhaDaMedicao(linha({ id: "ml_b", solicitada_em: "2026-10-15" }), CONTEXTO);
    assert.equal(antes.tabela_id, "pt_safra_v1");
    assert.deepEqual(antes.itens.map((i) => [i.preco, i.total_cents]), [["280.00", 56_000], ["620.00", 62_000]]);
    assert.equal(antes.total_cents, 118_000);
    assert.equal(depois.tabela_id, "pt_safra_v2");
    assert.deepEqual(depois.itens.map((i) => [i.preco, i.total_cents]), [["290.00", 58_000], ["640.00", 64_000]]);
    assert.equal(depois.total_cents, 122_000);
    assert.equal(totalDaMedicao([antes, depois]), 240_000);
    assert.equal(antes.dia_tipo, "util");
    assert.deepEqual(antes.marcas, []);
    assert.equal(antes.itens[0].codigo, "SF-lpu_aj_util");
    assert.equal(antes.itens[0].categoria, "Diárias");
  });

  it("nunca usa a Padrão Dutelog: sem tabela do contrato na data, só item avulso", () => {
    assert.equal(tabelaDaLinha(CONTEXTO, "2025-12-31"), null);
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ solicitada_em: "2025-12-20" }), CONTEXTO),
      (error: unknown) =>
        error instanceof ErroMedicao && /OS 501, item 1: não há tabela do contrato na data da solicitação/.test(error.message),
    );
    // O 3/4 está na Padrão, mas não na tabela do contrato.
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ itens: [{ origem: "tabela", lpu_item_id: "lpu_34", quantidade: "1" }] }), CONTEXTO),
      (error: unknown) => error instanceof ErroMedicao && /fora da tabela; use item avulso/.test(error.message),
    );
  });

  it("sábado na tarifa de dia útil fica marcado, com o item de sábado apontado e o preço do item usado", () => {
    const sabado = precificarLinhaDaMedicao(
      linha({ executada_em: "2026-10-03", solicitada_em: "2026-10-02", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "3" }] }),
      CONTEXTO,
    );
    assert.equal(sabado.dia_tipo, "sabado");
    assert.deepEqual(sabado.marcas, ["dia_nao_bate_tarifa"]);
    assert.deepEqual(
      sabado.itens.map((i) => [i.lpu_item_id, i.preco, i.dia_nao_bate, i.trocar_por]),
      [["lpu_aj_util", "280.00", true, "lpu_aj_sab"]],
    );
    // A classe que o servidor calculou fica no item: a tela monta "Sábado na tarifa de dia útil" e "Aplicar sábado" sem repetir a conta.
    assert.deepEqual(sabado.itens[0].classe, { diaria: { dias: ["util"], janelas: [] }, veiculo: false, ajudante: true });
    assert.deepEqual(sabado.itens[0].trocar_por_diaria, { dias: ["sabado"], janelas: [] });
    // Aplicado o sábado, a marca sai.
    const aplicado = precificarLinhaDaMedicao(
      linha({ executada_em: "2026-10-03", solicitada_em: "2026-10-02", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_sab", quantidade: "3" }] }),
      CONTEXTO,
    );
    assert.deepEqual(aplicado.marcas, []);
    assert.equal(aplicado.total_cents, 109_200);
    // Feriado numa segunda, informado pela pessoa, com a tarifa de domingo e feriado.
    const feriado = precificarLinhaDaMedicao(
      linha({ executada_em: "2026-10-12", solicitada_em: "2026-10-08", dia_tipo: "domingo_feriado", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_dom", quantidade: "4" }] }),
      CONTEXTO,
    );
    assert.deepEqual(feriado.marcas, []);
    // Dia útil num sábado é recusado.
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ executada_em: "2026-10-03", solicitada_em: "2026-10-02", dia_tipo: "util" }), CONTEXTO),
      (error: unknown) => error instanceof ErroMedicao && /é sábado/.test(error.message),
    );
  });

  it("a linha noturna usa a tabela Noturna do contrato quando ela existe na data; sem ela, a da medição", () => {
    const NOTURNA: TabelaDaMedicao = {
      ...V1,
      id: "pt_safra_noturna",
      variante: "Noturna",
      vigente_de: "2026-10-01",
      vigente_ate: null,
      status: "ativa",
      precos: precos({ lpu_aj_util: "350.00", lpu_vuc: "700.00" }),
    };
    const contexto = { ...CONTEXTO, tabelas: [V1, V2, NOTURNA, PADRAO] };
    const noturna = precificarLinhaDaMedicao(linha({ janela: "noturna" }), contexto);
    assert.equal(noturna.tabela_id, "pt_safra_noturna");
    assert.equal(noturna.total_cents, 70_000 + 70_000);
    assert.equal(precificarLinhaDaMedicao(linha({ janela: "diurna" }), contexto).tabela_id, "pt_safra_v1");
    // Pedida antes de a Noturna valer: a da medição.
    assert.equal(precificarLinhaDaMedicao(linha({ janela: "noturna", solicitada_em: "2026-09-30", executada_em: "2026-10-01" }), contexto).tabela_id, "pt_safra_v1");
    // Sem tabela Noturna no contrato: a da medição.
    assert.equal(precificarLinhaDaMedicao(linha({ janela: "noturna" }), CONTEXTO).tabela_id, "pt_safra_v1");
    assert.equal(tabelaDaLinha(contexto, "2026-10-13", "noturna")?.id, "pt_safra_noturna");
  });

  it("item avulso fica marcado como rota fora da tabela; sem o pedido anexo, também", () => {
    const avulso = precificarLinhaDaMedicao(
      linha({
        anexo: null,
        itens: [
          { origem: "avulso", quantidade: "1", preco: "1904.00", motivo: "Rota intermunicipal fora da LPU", descricao: "Truck Sede → Arquivo Jundiaí" },
          { origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "4" },
        ],
      }),
      CONTEXTO,
    );
    assert.deepEqual(avulso.marcas, ["rota_fora_da_tabela", "sem_pedido_anexo"]);
    assert.deepEqual(avulso.itens.map((i) => [i.origem, i.preco_tabela, i.total_cents]), [["avulso", null, 190_400], ["tabela", "280.00", 112_000]]);
    assert.equal(avulso.total_cents, 302_400);
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ itens: [{ origem: "avulso", quantidade: "1", preco: "1904.00", descricao: "Truck" }] }), CONTEXTO),
      (error: unknown) => error instanceof ErroMedicao && /item 1: o item avulso pede um motivo/.test(error.message),
    );
  });

  it("preço diferente da tabela vira alterado, com o preço da tabela ao lado e motivo; o servidor recalcula o total", () => {
    const alterado = precificarLinhaDaMedicao(
      linha({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2", preco: "300.00", motivo: "Ajudante extra acordado" }] }),
      CONTEXTO,
    );
    assert.deepEqual(alterado.itens.map((i) => [i.origem, i.preco, i.preco_tabela, i.total_cents]), [["alterado", "300.00", "280.00", 60_000]]);
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "2", preco: "300.00" }] }), CONTEXTO),
      /motivo/,
    );
    assert.throws(() => precificarLinhaDaMedicao(linha({ itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "1.5555" }] }), CONTEXTO), ErroMedicao);
    assert.throws(() => precificarLinhaDaMedicao(linha({ itens: [] }), CONTEXTO), /ao menos um item/);
  });

  it("a linha gravada volta como entrada e é precificada de novo pela tabela que vale na data", () => {
    // Sem a v2 carregada, a solicitação de 15/10 não tem tabela do contrato.
    assert.throws(
      () => precificarLinhaDaMedicao(linha({ id: "ml_x", solicitada_em: "2026-10-15" }), { ...CONTEXTO, tabelas: [V1] }),
      /não há tabela do contrato/,
    );
    const comV1 = precificarLinhaDaMedicao(linha({ id: "ml_y", solicitada_em: "2026-10-14" }), CONTEXTO);
    const outraVez = precificarLinhaDaMedicao(entradaDaLinhaGravada(comV1), CONTEXTO);
    assert.deepEqual(outraVez, comV1);
    // A v2 começando antes (carga corrigida): a mesma linha muda de tabela.
    const corrigida = precificarLinhaDaMedicao(entradaDaLinhaGravada(comV1), {
      ...CONTEXTO,
      tabelas: [{ ...V1, vigente_ate: "2026-10-09" }, { ...V2, vigente_de: "2026-10-10" }],
    });
    assert.equal(corrigida.tabela_id, "pt_safra_v2");
    assert.equal(linhasReprecificadas([comV1], [corrigida]), 1);
    assert.equal(linhasReprecificadas([comV1], [outraVez]), 0);
  });
});

describe("situação da medição", () => {
  it("rascunho → enviada → aprovada; enviada → contestada → rascunho", () => {
    assert.equal(problemaDaAcaoNaMedicao("send", "rascunho", { linhas: 3 }), null);
    assert.match(String(problemaDaAcaoNaMedicao("send", "rascunho", { linhas: 0 })), /sem linhas/);
    assert.equal(problemaDaAcaoNaMedicao("approve", "enviada", { linhas: 3 }), null);
    assert.equal(problemaDaAcaoNaMedicao("contest", "enviada", { linhas: 3 }), null);
    assert.equal(problemaDaAcaoNaMedicao("reopen", "contestada", { linhas: 3 }), null);
    for (const [acao, status] of [
      ["send", "enviada"],
      ["send", "aprovada"],
      ["approve", "rascunho"],
      ["approve", "contestada"],
      ["approve", "aprovada"],
      ["contest", "rascunho"],
      ["contest", "aprovada"],
      ["reopen", "enviada"],
      ["reopen", "rascunho"],
      ["reopen", "aprovada"],
    ] as const) {
      assert.match(String(problemaDaAcaoNaMedicao(acao, status, { linhas: 3 })), /A medição está/, `${acao} em ${status}`);
    }
  });

  it("a ação repetida sobre o que a tela viu é reconhecida como já feita", () => {
    assert.equal(acaoDaMedicaoJaFeita("send", "rascunho", "enviada"), true);
    assert.equal(acaoDaMedicaoJaFeita("approve", "enviada", "aprovada"), true);
    assert.equal(acaoDaMedicaoJaFeita("approve", "enviada", "contestada"), false);
    assert.equal(acaoDaMedicaoJaFeita("contest", "rascunho", "contestada"), false);
  });

  it("só o rascunho se edita", () => {
    assert.equal(problemaDaEdicao("rascunho"), null);
    assert.match(String(problemaDaEdicao("contestada")), /reabra/);
    assert.match(String(problemaDaEdicao("enviada")), /só o rascunho/);
    assert.match(String(problemaDaEdicao("aprovada")), /só o rascunho/);
  });
});

describe("demandas da medição", () => {
  const medicao = { id: "safra-2026_2026-10", customer_code: "SAFRA", contrato_id: "safra-2026" };
  const ativa = { customer_code: "SAFRA", contrato_id: "safra-2026", cobranca: "medicao_mensal", etapa: "execucao_a_orcar" };

  it("a demanda entra só na medição do contrato dela, cobrada por medição, ativa e em uma medição só", () => {
    assert.equal(problemaDaDemandaNaMedicao("10031", ativa, medicao), null);
    // O contrato misto: a demanda cobrada por demanda espera o pedido e aceite dele, nunca a medição.
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, cobranca: "por_demanda" }, medicao)), /cobrada por demanda/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, cobranca: "wms" }, medicao)), /não é cobrada por medição mensal/);
    assert.equal(problemaDaDemandaNaMedicao("10031", { ...ativa, medicao_id: medicao.id }, medicao), null);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, customer_code: "ITAU" }, medicao)), /outro cliente/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, contrato_id: null }, medicao)), /não é do contrato/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, etapa: "perdida", perda: { motivo: "preco" } }, medicao)), /perdida/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, medicao_id: "safra-2026_2026-09" }, medicao)), /já está na medição safra-2026_2026-09/);
  });

  it("na aprovação, a demanda é conferida de novo: cliente, contrato, a medição e a cobrança", () => {
    const presa = { ...ativa, medicao_id: medicao.id };
    assert.equal(problemaDaDemandaNaAprovacao(presa, medicao), null);
    assert.equal(problemaDaDemandaNaAprovacao({ ...presa, customer_code: "ITAU" }, medicao), "demanda de outro cliente");
    assert.equal(problemaDaDemandaNaAprovacao({ ...presa, contrato_id: "safra-eventos" }, medicao), "demanda de outro contrato");
    assert.equal(problemaDaDemandaNaAprovacao({ ...presa, medicao_id: null }, medicao), "demanda fora desta medição");
    assert.equal(problemaDaDemandaNaAprovacao({ ...presa, cobranca: "por_demanda" }, medicao), "demanda cobrada fora da medição");
  });

  it("o período executado de uma demanda sai das linhas dela", () => {
    const linhas = [
      { demanda_numero: "10031", executada_em: "2026-10-16" },
      { demanda_numero: "10031", executada_em: "2026-10-02" },
      { demanda_numero: "10034", executada_em: "2026-10-03" },
      { demanda_numero: null, executada_em: "2026-10-01" },
    ];
    assert.deepEqual(execucaoNasLinhas("10031", linhas), { de: "2026-10-02", ate: "2026-10-16" });
    assert.equal(execucaoNasLinhas("10099", linhas), null);
  });

  it("a aprovação leva a a faturar o que o cliente já fechou; o resto fica pendente, com o motivo", () => {
    const enviada = (rv: number, tipo_rv = "proposta") => ({ status: "enviado", tipo_rv, rv });
    const execucao = { de: "2026-10-02", ate: "2026-10-03" };
    assert.deepEqual(destinoNaAprovacaoDaMedicao({ etapa: "a_faturar", validacao: { rv: 0, etapa: "a_faturar" } }, enviada(0), execucao), {
      tipo: "ja_a_faturar",
    });
    // Fechada e executada, sem RV de execução: a medição aprovada valida a RV fechada.
    assert.deepEqual(
      destinoNaAprovacaoDaMedicao({ etapa: "execucao_a_orcar", escopo_rv: 0, executado_de: "2026-10-02" }, enviada(0), execucao),
      { tipo: "validar", rv: 0, registrar_execucao: null },
    );
    // Fechada e ainda sem a execução registrada: a medição registra a execução pelas linhas.
    assert.deepEqual(destinoNaAprovacaoDaMedicao({ etapa: "para_planejar", escopo_rv: 0 }, enviada(0), execucao), {
      tipo: "validar",
      rv: 0,
      registrar_execucao: execucao,
    });
    // A RV de execução enviada, esperando o cliente: a medição aprovada é a validação.
    assert.deepEqual(
      destinoNaAprovacaoDaMedicao({ etapa: "aguardando_cliente", escopo_rv: 0, executado_de: "2026-10-02" }, enviada(1, "execucao"), execucao),
      { tipo: "validar", rv: 1, registrar_execucao: null },
    );
    for (const [caso, demanda, orcamento, motivo] of [
      ["perdida", { etapa: "perdida", perda: { motivo: "cancelado_cliente" } }, enviada(0), /perdida/],
      ["proposta sem fechamento", { etapa: "aguardando_cliente" }, enviada(0), /^proposta sem fechamento$/],
      // A cobrança por medição nunca espera o pedido e aceite: a medição não faz as vezes da autorização do contrato.
      ["aguardando autorização", { etapa: "aguardando_autorizacao", validacao: { rv: 0, etapa: "aguardando_autorizacao" } }, enviada(0), /aguardando autorização/],
      // O aditivo enviado e sem resposta não é validado pela medição, executada ou não.
      ["aditivo enviado, executada", { etapa: "aguardando_cliente", escopo_rv: 0, executado_de: "2026-10-05" }, enviada(1, "aditivo"), /^aditivo em negociação$/],
      ["aditivo enviado, sem execução", { etapa: "aguardando_cliente", escopo_rv: 0 }, enviada(1, "aditivo"), /^aditivo em negociação$/],
      ["aditivo em montagem", { etapa: "em_montagem", escopo_rv: 0 }, { status: "rascunho", tipo_rv: "aditivo", rv: 1 }, /^aditivo em negociação$/],
      ["RV de execução em montagem", { etapa: "execucao_a_orcar", escopo_rv: 0, executado_de: "2026-10-02" }, { status: "rascunho", tipo_rv: "execucao", rv: 1 }, /RV em montagem/],
      ["em montagem", { etapa: "em_montagem" }, { status: "rascunho", tipo_rv: "proposta", rv: 0 }, /RV em montagem/],
    ] as const) {
      const destino = destinoNaAprovacaoDaMedicao(demanda as never, orcamento, execucao);
      assert.equal(destino.tipo, "pendente", caso);
      assert.match((destino as { motivo: string }).motivo, motivo, caso);
    }
  });
});

describe("Diário de Bordo", () => {
  /** A descrição do cliente na tabela é a chave do Diário (o veículo e o dia e horário do ajudante). Sintético. */
  const CHAVES: TabelaDaMedicao = {
    ...V1,
    id: "pt_safra_chaves",
    vigente_ate: null,
    status: "ativa",
    precos: {
      lpu_aj_util: { codigo: "1.1", descricao_cliente: "Seg. Sex. | 08h às 17h", preco: "280.00" },
      lpu_aj_sab: { codigo: "1.3", descricao_cliente: "Sab. | 08h às 17h", preco: "364.00" },
      lpu_vuc: { codigo: "2.1", descricao_cliente: "VUC", preco: "620.00" },
      lpu_truck: { codigo: "2.3", descricao_cliente: "Caminhão Truck", preco: "1350.00" },
    },
  };
  const COM_CHAVES: ContextoDaMedicao = { ...CONTEXTO, tabelas: [CHAVES, PADRAO] };

  it("as colunas e o cabeçalho do arquivo do cliente, em ordem de execução; o solicitante é a área; a chave sai vazia", () => {
    assert.deepEqual([...COLUNAS_DO_DIARIO], [
      "OS",
      "Data Solic.",
      "Solicitante",
      "Data Frete",
      "Veículo",
      "Veículo Quant.",
      "Custo (R$)",
      "Horário Ajudante",
      "Ajudante Quant.",
      "Custo (R$)",
      "Custo Total (R$)",
      "Local Origem",
      "Local Destino",
      "Descrição Mercadoria",
      "Chave",
    ]);
    const a = precificarLinhaDaMedicao(
      linha({ id: "ml_a", os: "OS 502", executada_em: "2026-10-16", solicitada_em: "2026-10-13", area_solicitante: "Infraestrutura" }),
      COM_CHAVES,
    );
    const b = precificarLinhaDaMedicao(
      linha({
        id: "ml_b",
        os: "OS 501",
        executada_em: "2026-10-03",
        solicitada_em: "2026-10-02",
        itens: [
          { origem: "tabela", lpu_item_id: "lpu_aj_sab", quantidade: "3" },
          { origem: "tabela", lpu_item_id: "lpu_truck", quantidade: "1" },
          { origem: "tabela", lpu_item_id: "lpu_vuc", quantidade: "2" },
          { origem: "avulso", quantidade: "1", preco: "50.00", motivo: "Embalagem pedida na hora", descricao: "Embalagem de proteção" },
        ],
      }),
      COM_CHAVES,
    );
    const c = precificarLinhaDaMedicao(
      linha({ id: "ml_c", os: "OS 503", executada_em: "2026-10-20", solicitada_em: "2026-10-19", itens: [{ origem: "tabela", lpu_item_id: "lpu_aj_util", quantidade: "1" }] }),
      COM_CHAVES,
    );
    const diario = exportarDiarioDeBordo({ linhas: [a, c, b] });
    const lugar = ["Sede", "Agência Centro", "18 caixas de arquivo", ""];
    assert.deepEqual(
      diario.map((row) => row.colunas),
      [
        // Dois tipos de veículo: uma linha do Diário por veículo; os ajudantes e o avulso na primeira.
        ["OS 501", "02/10/2026", "Facilities", "03/10/2026", "Caminhão Truck", "1", "1.350,00", "Sab. | 08h às 17h", "3", "1.092,00", "2.492,00", ...lugar],
        ["OS 501", "02/10/2026", "Facilities", "03/10/2026", "VUC", "2", "1.240,00", "", "0", "0,00", "1.240,00", ...lugar],
        ["OS 502", "13/10/2026", "Infraestrutura", "16/10/2026", "VUC", "1", "620,00", "Seg. Sex. | 08h às 17h", "2", "560,00", "1.180,00", ...lugar],
        ["OS 503", "19/10/2026", "Facilities", "20/10/2026", "", "0", "0,00", "Seg. Sex. | 08h às 17h", "1", "280,00", "280,00", ...lugar],
      ],
    );
    assert.ok(diario.every((row) => row.colunas.length === COLUNAS_DO_DIARIO.length));
    // A soma das linhas do Diário é o total de cada linha da medição.
    assert.deepEqual(diario.map((row) => [row.linha_id, row.valor_cents]), [["ml_b", 249_200], ["ml_b", 124_000], ["ml_a", 118_000], ["ml_c", 28_000]]);
    assert.equal(b.total_cents, 249_200 + 124_000);
    assert.deepEqual(exportarDiarioDeBordo({ linhas: [] }, null), []);
    // A linha gravada antes da classe no item: a tabela completa a descrição para classificar.
    const semClasse = { ...a, itens: a.itens.map(({ classe: _classe, ...item }) => item) } as unknown as typeof a;
    assert.deepEqual(exportarDiarioDeBordo({ linhas: [semClasse] }, CHAVES)[0].colunas, diario[2].colunas);
  });

  it("quantidades somadas sem float", () => {
    assert.equal(somarQuantidades(["1.5", "2"]), "3,5");
    assert.equal(somarQuantidades(["0.1", "0.2"]), "0,3");
    assert.equal(somarQuantidades(["2", "1"]), "3");
  });
});

describe("listas", () => {
  it("os tipos de autorização do evento são os do contrato", () => {
    assert.deepEqual([...TIPOS_AUTORIZACAO], [...TIPOS_DO_CONTRATO]);
    assert.ok(TIPOS_AUTORIZACAO.includes("medicao_aprovada"));
  });
});
