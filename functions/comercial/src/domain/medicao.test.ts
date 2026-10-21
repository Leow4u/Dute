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
  precificarLinhaDaMedicao,
  problemaDaAcaoNaMedicao,
  problemaDaCompetencia,
  problemaDaDemandaNaMedicao,
  problemaDaEdicao,
  problemaDasDatasDaLinha,
  problemaDoDiaTipo,
  somarQuantidades,
  tabelaDaLinha,
  totalDaMedicao,
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
        envio_ate: "2026-09-01",
        dias_de_atraso: 61,
      },
      {
        medicao_id: "safra-2026_2026-10",
        contrato_id: "safra-2026",
        customer_code: "SAFRA",
        competencia: "2026-10",
        envio_ate: "2026-11-01",
        dias_de_atraso: 0,
      },
    ]);
    assert.equal(alertaMedicaoNaoEnviada(em("2026-11-05T12:00:00.000Z"), medicoes)[1].dias_de_atraso, 4);
    assert.deepEqual(alertaMedicaoNaoEnviada(em("2026-11-05T12:00:00.000Z"), []), []);
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
  const ativa = { customer_code: "SAFRA", contrato_id: "safra-2026", etapa: "execucao_a_orcar" };

  it("a demanda entra só na medição do contrato dela, ativa e em uma medição só", () => {
    assert.equal(problemaDaDemandaNaMedicao("10031", ativa, medicao), null);
    assert.equal(problemaDaDemandaNaMedicao("10031", { ...ativa, medicao_id: medicao.id }, medicao), null);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, customer_code: "ITAU" }, medicao)), /outro cliente/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, contrato_id: null }, medicao)), /não é do contrato/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, etapa: "perdida", perda: { motivo: "preco" } }, medicao)), /perdida/);
    assert.match(String(problemaDaDemandaNaMedicao("10031", { ...ativa, medicao_id: "safra-2026_2026-09" }, medicao)), /já está na medição safra-2026_2026-09/);
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
    assert.deepEqual(
      destinoNaAprovacaoDaMedicao({ etapa: "aguardando_autorizacao", validacao: { rv: 0, etapa: "aguardando_autorizacao" } }, enviada(0), execucao),
      { tipo: "autorizar" },
    );
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
      ["proposta sem fechamento", { etapa: "aguardando_cliente" }, enviada(0), /sem fechamento/],
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
  it("uma linha por OS, em ordem de execução, nas colunas do Diário; o solicitante é a área", () => {
    const a = precificarLinhaDaMedicao(
      linha({ id: "ml_a", os: "OS 502", executada_em: "2026-10-16", solicitada_em: "2026-10-13", area_solicitante: "Infraestrutura" }),
      CONTEXTO,
    );
    const b = precificarLinhaDaMedicao(
      linha({
        id: "ml_b",
        os: "OS 501",
        executada_em: "2026-10-03",
        solicitada_em: "2026-10-02",
        janela: "noturna",
        itens: [
          { origem: "tabela", lpu_item_id: "lpu_aj_sab", quantidade: "3" },
          { origem: "tabela", lpu_item_id: "lpu_truck", quantidade: "1" },
          { origem: "tabela", lpu_item_id: "lpu_vuc", quantidade: "2" },
        ],
      }),
      CONTEXTO,
    );
    const diario = exportarDiarioDeBordo({ linhas: [a, b] }, V1);
    assert.equal(COLUNAS_DO_DIARIO.length, 12);
    assert.deepEqual([...COLUNAS_DO_DIARIO], [
      "OS",
      "Data da solicitação",
      "Solicitante",
      "Data do frete",
      "Tipo de veículo",
      "Qtd. de veículos",
      "Horário",
      "Qtd. de ajudantes",
      "Origem",
      "Destino",
      "Mercadoria",
      "Valor",
    ]);
    assert.deepEqual(
      diario.map((row) => row.colunas),
      [
        ["OS 501", "02/10/2026", "Facilities", "03/10/2026", "Truck + VUC", "3", "Noturno (sábado)", "3", "Sede", "Agência Centro", "18 caixas de arquivo", "3.682,00"],
        ["OS 502", "13/10/2026", "Infraestrutura", "16/10/2026", "VUC", "1", "Diurno (seg–sex)", "2", "Sede", "Agência Centro", "18 caixas de arquivo", "1.180,00"],
      ],
    );
    assert.deepEqual(diario.map((row) => row.valor_cents), [368_200, 118_000]);
    assert.ok(diario.every((row) => row.colunas.length === COLUNAS_DO_DIARIO.length));
    assert.deepEqual(exportarDiarioDeBordo({ linhas: [] }, null), []);
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
