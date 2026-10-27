import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADITIVOS_COM_VIGENCIA,
  REGIMES_COBRANCA,
  TIPOS_ADITIVO,
  TIPOS_AUTORIZACAO,
  TIPOS_NUMERO_CONTRATO,
  aditivoDoForm,
  aditivoDoRegistro,
  aditivosEmOrdem,
  alertasParaOInicio,
  condicoesDoContrato,
  contarFiltros,
  contratoDoForm,
  contratoDoRegistro,
  contratoEscolhido,
  dataBaseDaTela,
  dataBaseParaTela,
  formDoContrato,
  formNovoAditivo,
  linhaDoAditivo,
  linkDoDocumento,
  listaDeContratos,
  numerosDoContrato,
  payloadAditivo,
  payloadEdicaoContrato,
  payloadNovoContrato,
  periodoDaTabela,
  proximaFaixa,
  seloDoContrato,
  situacaoDaTabela,
  tabelaDoRegistro,
  tabelasEmOrdem,
  textoDoAlerta,
  ultimoAditivo,
  vencimentoDoContrato,
  vigenciaDoContrato,
  type Aditivo,
  type Contrato,
  type FormAditivo,
  type TabelaDoContrato,
} from "./contratos";

/**
 * Aba Contratos do Comercial (parte 14): leitura de `contracts`, selo e ordem
 * da lista, ficha, alertas do Início e as entradas de saveContract e
 * recordAditivo. Contratos sintéticos, sem número real de cliente.
 */

const HOJE = "2026-10-21";
const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, "../../../../..", relative), "utf8").replace(/\r\n/g, "\n");

const FAIXAS = [
  { de: 1, ate: 10, dia: 30, mes: "mesmo" },
  { de: 11, ate: 20, dia: 10, mes: "seguinte" },
  { de: 21, ate: 31, dia: 30, mes: "seguinte" },
];

/** Um contrato completo, como saveContract grava. */
const DOC_ITAU: Record<string, unknown> = {
  customer_code: "ITAU-UNIBANCO",
  nome: "Gestão de Mudanças",
  numeros: [
    { tipo: "contrato", numero: "CT-0003" },
    { tipo: "sistema_cliente", numero: "SC-0001" },
  ],
  objeto: "Mudanças, transporte, montagem e desmontagem de mobiliário.",
  vigente_de: "2026-07-01",
  vigente_ate: "2027-06-30",
  renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null },
  reajuste: { tipo: "negociado", indice: null, data_base: null },
  regimes: [
    { servico: "Mudança", regime: "por_demanda" },
    { servico: "Equipe fixa", regime: "medicao_mensal" },
  ],
  regime_padrao: "por_demanda",
  autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: 60 },
  pagamento: { tipo: "faixas_do_dia_da_nf", faixas: FAIXAS, dias: null, texto: null },
  impostos: { inclusos: true, texto: "ISS 5%" },
  codigo_servico: "1602",
  documentos: [{ nome: "Contrato assinado", referencia: "OneDrive/Contratos/itau.pdf" }],
  status: "vigente",
  edicao: 3,
  id: "itau-2026",
  created_at: { seconds: 1 },
};

function contrato(id: string, data: Record<string, unknown>): Contrato {
  const lido = contratoDoRegistro(id, { ...DOC_ITAU, ...data });
  if (!lido) throw new Error(`contrato ${id} não foi lido`);
  return lido;
}

const ITAU = contrato("itau-2026", {});
const SAFRA = contrato("safra", {
  customer_code: "BANCO-SAFRA",
  nome: "LPU de Transporte",
  vigente_de: "2025-05-12",
  vigente_ate: null,
  renovacao: { tipo: "indeterminado", aviso_dias: null, oposicao_ate_dias: null },
});
const BTG = contrato("btg-2026", {
  customer_code: "BTG_Pactual",
  nome: "Armazenagem e serviços",
  vigente_de: "2026-01-01",
  vigente_ate: "2026-12-31",
  renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 0 },
});
const VENCIDO = contrato("vencido", { customer_code: "ALFA", nome: "Contrato Alfa", vigente_de: "2025-01-01", vigente_ate: "2026-09-30" });
const URGENTE = contrato("urgente", { customer_code: "BETA", nome: "Contrato Beta", vigente_de: "2025-11-16", vigente_ate: "2026-11-15" });
const FUTURO = contrato("futuro", { customer_code: "GAMA", nome: "Contrato Gama", vigente_de: "2027-01-01", vigente_ate: "2027-12-31" });
const ENCERRADO_RECENTE = contrato("rfq-2021", { nome: "RFQ 2021", vigente_de: "2021-07-01", vigente_ate: "2026-06-29", status: "encerrado" });
const ENCERRADO_ANTIGO = contrato("antigo", { customer_code: "BANCO-SAFRA", nome: "Antigo", vigente_de: "2020-01-01", vigente_ate: "2022-12-31", status: "encerrado" });
/** Fora de TODOS: aviso de denúncia de 180 dias, maior que o primeiro marco (120). */
const AVISO_LONGO = contrato("aviso-longo", {
  customer_code: "DELTA",
  nome: "Contrato Delta",
  vigente_de: "2026-01-01",
  vigente_ate: "2027-03-20",
  renovacao: { tipo: "aditivo", aviso_dias: 180, oposicao_ate_dias: null },
});

const TODOS = [ITAU, SAFRA, BTG, VENCIDO, URGENTE, FUTURO, ENCERRADO_RECENTE, ENCERRADO_ANTIGO];

const NOMES = new Map([
  ["ITAU-UNIBANCO", "Itaú Unibanco"],
  ["BANCO-SAFRA", "Banco Safra"],
  ["BTG_Pactual", "BTG Pactual"],
  ["ALFA", "Alfa Engenharia"],
  ["BETA", "Beta Seguros"],
  ["GAMA", "Gama Varejo"],
  ["DELTA", "Delta Logística"],
]);

/** Lista literal `export const NOME = [ ... ]` de um arquivo das Functions. */
function listaDoBackend(source: string, nome: string): string[] {
  const match = new RegExp(`export const ${nome}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`${nome} não encontrado`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g), ([, item]) => item);
}

describe("listas iguais às da callable (functions/comercial)", () => {
  const contratosTs = read("functions/comercial/src/domain/contratos.ts");
  const eventsTs = read("functions/comercial/src/domain/events.ts");

  it("tipos de número, de autorização, regimes, tipos de aditivo e os que mudam a vigência", () => {
    expect(listaDoBackend(contratosTs, "TIPOS_NUMERO_CONTRATO")).toEqual([...TIPOS_NUMERO_CONTRATO]);
    // Desde a parte 16a a lista mora em events.ts (vai no evento da autorização); contratos.ts reexporta.
    expect(listaDoBackend(eventsTs, "TIPOS_AUTORIZACAO")).toEqual([...TIPOS_AUTORIZACAO]);
    expect(contratosTs).toMatch(/export \{ TIPOS_AUTORIZACAO \}/);
    expect(listaDoBackend(contratosTs, "ADITIVOS_COM_VIGENCIA")).toEqual([...ADITIVOS_COM_VIGENCIA]);
    expect(listaDoBackend(eventsTs, "REGIMES_COBRANCA")).toEqual([...REGIMES_COBRANCA]);
    expect(listaDoBackend(eventsTs, "TIPOS_ADITIVO")).toEqual([...TIPOS_ADITIVO]);
  });

  it("o contrato enviado tem exatamente os campos de CONTRATO_DADOS (a entrada é .strict())", () => {
    const bloco = /export const CONTRATO_DADOS = z\s*\.object\(\{([\s\S]*?)\n {2}\}\)\s*\.strict\(\)/.exec(contratosTs)?.[1] ?? "";
    // "nome: z...", ou só "renovacao," quando o schema tem o mesmo nome do campo.
    const campos = Array.from(bloco.matchAll(/^ {4}(\w+)[:,]/gm), ([, campo]) => campo);
    expect(campos.length).toBeGreaterThan(10);
    const enviado = contratoDoForm(formDoContrato(ITAU));
    expect(enviado.ok && Object.keys(enviado.valor).sort()).toEqual([...campos].sort());
  });

  it("o aditivo enviado tem exatamente os campos de ADITIVO_DADOS", () => {
    const bloco = /export const ADITIVO_DADOS = z\s*\.object\(\{([\s\S]*?)\n {2}\}\)\s*\.strict\(\)/.exec(contratosTs)?.[1] ?? "";
    const campos = Array.from(bloco.matchAll(/^ {4}(\w+)[:,]/gm), ([, campo]) => campo);
    const enviado = aditivoDoForm({ ...formNovoAditivo(ITAU, []), vigenteAte: "2028-06-30" }, []);
    expect(campos.length).toBeGreaterThan(5);
    expect(enviado.ok && Object.keys(enviado.valor).sort()).toEqual([...campos].sort());
  });
});

describe("contrato lido do Firestore", () => {
  it("os dados no formato de saveContract, a edição e o id do documento", () => {
    expect(ITAU.id).toBe("itau-2026");
    expect(ITAU.edicao).toBe(3);
    expect(ITAU.dados).toMatchObject({
      customer_code: "ITAU-UNIBANCO",
      vigente_ate: "2027-06-30",
      renovacao: { tipo: "aditivo", aviso_dias: 30, oposicao_ate_dias: null },
      pagamento: { tipo: "faixas_do_dia_da_nf", faixas: FAIXAS, dias: null, texto: null },
      codigo_servico: "1602",
    });
    expect(Object.keys(ITAU.dados)).not.toContain("created_at");
  });

  it("sem cliente ou sem início válido fica fora; vigência sem fim é prazo indeterminado", () => {
    expect(contratoDoRegistro("x", { ...DOC_ITAU, customer_code: "" })).toBeNull();
    expect(contratoDoRegistro("x", { ...DOC_ITAU, vigente_de: "01/07/2026" })).toBeNull();
    expect(SAFRA.dados.vigente_ate).toBeNull();
  });

  it("valor fora da lista vira o padrão, e faixa quebrada sai", () => {
    const lido = contratoDoRegistro("x", {
      customer_code: "X",
      vigente_de: "2026-01-01",
      renovacao: { tipo: "outra" },
      pagamento: { tipo: "faixas_do_dia_da_nf", faixas: [{ de: 1, ate: "10" }, FAIXAS[0]] },
    })!;
    expect(lido.dados.renovacao.tipo).toBe("aditivo");
    expect(lido.dados.pagamento.faixas).toEqual([FAIXAS[0]]);
    expect(lido.dados.nome).toBe("x");
    expect(lido.edicao).toBe(1);
  });

  it("os números com o tipo na frente; o número no sistema do cliente leva o nome dele", () => {
    expect(numerosDoContrato(ITAU.dados, "Itaú Unibanco")).toEqual(["Contrato CT-0003", "Nº Itaú Unibanco SC-0001"]);
    expect(numerosDoContrato(ITAU.dados)).toEqual(["Contrato CT-0003", "Nº no cliente SC-0001"]);
  });

  it("documento só vira link com endereço https", () => {
    expect(linkDoDocumento("https://dutelog.sharepoint.com/:b:/s/comercial/itau.pdf")).toBe(
      "https://dutelog.sharepoint.com/:b:/s/comercial/itau.pdf",
    );
    expect(linkDoDocumento("OneDrive/Contratos/itau.pdf")).toBeNull();
    expect(linkDoDocumento("http://exemplo.com/a.pdf")).toBeNull();
    expect(linkDoDocumento("javascript:alert(1)")).toBeNull();
    expect(linkDoDocumento(" https://exemplo.com/a.pdf")).toBeNull();
  });
});

describe("selo e ordem da lista", () => {
  it.each([
    ["itau-2026", ITAU, "Vigente", "ok"],
    ["safra (sem prazo)", SAFRA, "Vigente", "ok"],
    ["btg-2026 (automática, fim a 71 dias)", BTG, "Renovação em 71 dias", "atencao"],
    ["urgente (aviso perdido)", URGENTE, "Renovação em 25 dias", "critico"],
    ["vencido", VENCIDO, "Vencido", "critico"],
    ["futuro", FUTURO, "A iniciar", "neutro"],
    ["rfq-2021", ENCERRADO_RECENTE, "Encerrado", "neutro"],
  ] as const)("%s: %s", (_, item, rotulo, tom) => {
    expect(seloDoContrato(item.dados, HOJE)).toMatchObject({ rotulo, tom });
  });

  it("a renovação aparece a 120 dias do prazo e conta até a data mais próxima que não passou", () => {
    // Aviso de 30 dias: prazo em 31/05/2027, a 120 dias em 31/01/2027.
    expect(seloDoContrato(ITAU.dados, "2027-01-30").rotulo).toBe("Vigente");
    expect(seloDoContrato(ITAU.dados, "2027-01-31").rotulo).toBe("Renovação em 120 dias");
    expect(seloDoContrato(ITAU.dados, "2027-05-31")).toMatchObject({ rotulo: "Renovação hoje", tom: "critico" });
    // Prazo de aviso perdido: conta até o fim e fica crítico.
    expect(seloDoContrato(ITAU.dados, "2027-06-01")).toMatchObject({ rotulo: "Renovação em 29 dias", tom: "critico" });
    expect(seloDoContrato(ITAU.dados, "2027-06-29").rotulo).toBe("Renovação em 1 dia");
    expect(seloDoContrato(ITAU.dados, "2027-07-01").rotulo).toBe("Vencido");
  });

  it("aviso maior que 120 dias já perdido, com o fim ainda longe: renovação crítica, contando até o fim", () => {
    // Aviso de 180 dias: prazo em 21/09/2026 (há 30 dias); o fim, a 150 dias, ainda não entrou nos alertas.
    expect(seloDoContrato(AVISO_LONGO.dados, HOJE)).toMatchObject({ rotulo: "Renovação em 150 dias", tom: "critico" });
    expect(seloDoContrato({ ...AVISO_LONGO.dados, renovacao: { tipo: "automatica", aviso_dias: null, oposicao_ate_dias: 180 } }, HOJE)).toMatchObject({
      rotulo: "Renovação em 150 dias",
      tom: "critico",
    });
  });

  it("o que pede ação vem antes: a renovação crítica passa na frente da que só pede atenção", () => {
    const lista = listaDeContratos([ITAU, BTG, AVISO_LONGO], NOMES, "vigentes", HOJE);
    expect(lista.map((item) => [item.contrato.id, item.selo.rotulo, item.selo.tom])).toEqual([
      ["aviso-longo", "Renovação em 150 dias", "critico"],
      ["btg-2026", "Renovação em 71 dias", "atencao"],
      ["itau-2026", "Vigente", "ok"],
    ]);
  });

  it("renovação automática depois do fim: renovou, falta registrar o novo período", () => {
    const depois = "2027-01-05";
    expect(seloDoContrato(BTG.dados, depois)).toMatchObject({ rotulo: "Renovação a registrar", tom: "critico" });
    expect(vencimentoDoContrato(BTG.dados, depois)).toBe("renovou 31/12/2026");
    expect(vigenciaDoContrato(BTG.dados, depois).restante).toBe("renovou há 5 dias");
    // Os outros tipos continuam vencendo.
    expect(seloDoContrato(ITAU.dados, "2027-07-01").rotulo).toBe("Vencido");
    expect(vencimentoDoContrato(ITAU.dados, "2027-07-01")).toBe("venceu 30/06/2027");
    const lista = listaDeContratos([ITAU, BTG, VENCIDO], NOMES, "vigentes", depois);
    expect(lista.map((item) => [item.contrato.id, item.selo.rotulo, item.vencimento])).toEqual([
      ["vencido", "Vencido", "venceu 30/09/2026"],
      ["btg-2026", "Renovação a registrar", "renovou 31/12/2026"],
      ["itau-2026", "Vigente", "vence 30/06/2027"],
    ]);
  });

  it("o reajuste não muda o selo", () => {
    const comIndice = contrato("idx", { ...SAFRA.dados, reajuste: { tipo: "indice", indice: "IPCA", data_base: "11-01" } });
    expect(seloDoContrato(comIndice.dados, HOJE).rotulo).toBe("Vigente");
  });

  it("vigentes: vencido, renovação mais próxima, vencimento mais próximo, sem prazo e a iniciar", () => {
    const lista = listaDeContratos(TODOS, NOMES, "vigentes", HOJE);
    expect(lista.map((item) => [item.cliente, item.selo.rotulo, item.vencimento])).toEqual([
      ["Alfa Engenharia", "Vencido", "venceu 30/09/2026"],
      ["Beta Seguros", "Renovação em 25 dias", "vence 15/11/2026"],
      ["BTG Pactual", "Renovação em 71 dias", "renova 31/12/2026"],
      ["Itaú Unibanco", "Vigente", "vence 30/06/2027"],
      ["Banco Safra", "Vigente", "sem prazo"],
      ["Gama Varejo", "A iniciar", "vence 31/12/2027"],
    ]);
  });

  it("encerrados: o fim mais recente primeiro", () => {
    const lista = listaDeContratos(TODOS, NOMES, "encerrados", HOJE);
    expect(lista.map((item) => [item.contrato.id, item.cliente, item.vencimento])).toEqual([
      ["rfq-2021", "Itaú Unibanco", "até 29/06/2026"],
      ["antigo", "Banco Safra", "até 31/12/2022"],
    ]);
  });

  it("empate: pelo nome do cliente, sem diferenciar acento; cliente sem cadastro aparece pelo código", () => {
    const a = contrato("a", { customer_code: "ZETA" });
    const b = contrato("b", { customer_code: "ITAU-UNIBANCO" });
    expect(listaDeContratos([a, b], NOMES, "vigentes", HOJE).map((item) => item.cliente)).toEqual(["Itaú Unibanco", "ZETA"]);
  });

  it("contagem dos dois filtros", () => {
    expect(contarFiltros(TODOS)).toEqual({ vigentes: 6, encerrados: 2 });
  });

  it("a ficha abre o contrato da URL, mesmo encerrado; sem ele, o primeiro da lista", () => {
    const lista = listaDeContratos(TODOS, NOMES, "vigentes", HOJE);
    expect(contratoEscolhido(lista, TODOS, "rfq-2021")?.id).toBe("rfq-2021");
    expect(contratoEscolhido(lista, TODOS, "nao-existe")?.id).toBe("vencido");
    expect(contratoEscolhido(lista, TODOS, null)?.id).toBe("vencido");
    expect(contratoEscolhido([], [], null)).toBeNull();
  });

  it("vencimento: renova na automática, vence nas outras", () => {
    expect(vencimentoDoContrato(BTG.dados, HOJE)).toBe("renova 31/12/2026");
    expect(vencimentoDoContrato(ITAU.dados, HOJE)).toBe("vence 30/06/2027");
    expect(vencimentoDoContrato({ ...ENCERRADO_RECENTE.dados, vigente_ate: null }, HOJE)).toBe("encerrado");
  });
});

describe("vigência na ficha", () => {
  it("período, quanto falta, hoje e o prazo de renovação na barra", () => {
    expect(vigenciaDoContrato(ITAU.dados, HOJE)).toEqual({
      periodo: "01/07/2026 – 30/06/2027",
      restante: "faltam 252 dias",
      hoje: 30.8,
      renovacao: { data: "2027-05-31", posicao: 91.8, rotulo: "Aviso" },
    });
  });

  it("prazo indeterminado não tem barra", () => {
    expect(vigenciaDoContrato(SAFRA.dados, HOJE)).toEqual({
      periodo: "Desde 12/05/2025",
      restante: "prazo indeterminado",
      hoje: null,
      renovacao: null,
    });
  });

  it("vencido, a iniciar, último dia e encerrado", () => {
    expect(vigenciaDoContrato(VENCIDO.dados, HOJE)).toMatchObject({ restante: "venceu há 21 dias", hoje: 100 });
    expect(vigenciaDoContrato(FUTURO.dados, HOJE)).toMatchObject({ restante: "começa em 72 dias", hoje: 0 });
    expect(vigenciaDoContrato(ITAU.dados, "2027-06-29").restante).toBe("falta 1 dia");
    expect(vigenciaDoContrato(ITAU.dados, "2027-06-30").restante).toBe("vence hoje");
    expect(vigenciaDoContrato(ENCERRADO_RECENTE.dados, HOJE).restante).toBe("encerrado");
  });

  it("renovação automática sem prazo de oposição não marca a barra; com prazo, marca a oposição", () => {
    expect(vigenciaDoContrato(BTG.dados, HOJE).renovacao).toBeNull();
    const comOposicao = { ...BTG.dados, renovacao: { tipo: "automatica" as const, aviso_dias: null, oposicao_ate_dias: 30 } };
    expect(vigenciaDoContrato(comOposicao, HOJE).renovacao).toEqual({ data: "2026-12-01", posicao: 91.8, rotulo: "Oposição" });
  });
});

describe("condições na ficha", () => {
  it("renovação, aviso, reajuste, regimes, autorização, código de serviço e impostos", () => {
    expect(condicoesDoContrato(ITAU.dados, HOJE).campos).toEqual([
      ["Renovação", "Por aditivo"],
      ["Aviso de denúncia", "30 dias antes do fim"],
      ["Reajuste", "Negociado na renovação"],
      ["Regime de cobrança", "Por demanda"],
      ["Regime por serviço", "Mudança: por demanda · Equipe fixa: medição mensal"],
      ["Autorização de faturamento", "Pedido e aceite"],
      ["Prazo de perda", "60 dias"],
      ["Código de serviço", "1602"],
      ["Impostos", "Inclusos no preço · ISS 5%"],
    ]);
  });

  it("o portal é o de compras do cliente (portal do fornecedor), não o Portal do cliente do Dute", () => {
    const campos = condicoesDoContrato({ ...ITAU.dados, autorizacao: { tipo: "portal", prazo_perda_dias: 90 } }, HOJE).campos;
    expect(campos).toContainEqual(["Autorização de faturamento", "Portal do fornecedor"]);
    expect(campos).toContainEqual(["Prazo de perda", "90 dias"]);
  });

  it("regime por serviço em minúscula, sem estragar a sigla", () => {
    const campos = condicoesDoContrato({ ...ITAU.dados, regimes: [{ servico: "Armazenagem", regime: "wms" }] }, HOJE).campos;
    expect(campos).toContainEqual(["Regime por serviço", "Armazenagem: fatura do WMS"]);
  });

  it("automática mostra a oposição; reajuste por índice mostra o índice e o dia", () => {
    const campos = condicoesDoContrato(
      { ...BTG.dados, reajuste: { tipo: "indice", indice: "IPCA", data_base: "07-01" }, regimes: [], impostos: { inclusos: null, texto: null }, codigo_servico: null },
      HOJE,
    ).campos;
    expect(campos.slice(0, 3)).toEqual([
      ["Renovação", "Automática"],
      ["Oposição", "Até o fim"],
      ["Reajuste", "IPCA em 01/07"],
    ]);
    expect(campos).toContainEqual(["Código de serviço", "—"]);
    expect(campos).toContainEqual(["Impostos", "—"]);
    expect(campos.map(([rotulo]) => rotulo)).not.toContain("Regime por serviço");
  });

  it("pagamento por faixas do dia da NF, com a previsão de uma NF recebida hoje", () => {
    expect(condicoesDoContrato(ITAU.dados, HOJE).pagamento).toEqual({
      faixas: [
        { quando: "NF recebida dia 1 a 10", paga: "Paga dia 30" },
        { quando: "NF recebida dia 11 a 20", paga: "Paga dia 10 do mês seguinte" },
        { quando: "NF recebida dia 21 a 31", paga: "Paga dia 30 do mês seguinte" },
      ],
      regra: null,
      previsto: "30/11/2026",
    });
  });

  it("pagamento em dias depois da NF ou em texto", () => {
    const dias = { ...ITAU.dados, pagamento: { tipo: "dias_apos_nf" as const, faixas: [], dias: 30, texto: null } };
    expect(condicoesDoContrato(dias, HOJE).pagamento).toEqual({ faixas: [], regra: "30 dias depois de receber a NF", previsto: "20/11/2026" });
    const texto = { ...ITAU.dados, pagamento: { tipo: "texto" as const, faixas: [], dias: null, texto: "Conforme portal." } };
    expect(condicoesDoContrato(texto, HOJE).pagamento).toEqual({ faixas: [], regra: "Conforme portal.", previsto: null });
  });

  it("data-base do reajuste: MM-DD no servidor, dia/mês na tela", () => {
    expect(dataBaseParaTela("07-01")).toBe("01/07");
    expect(dataBaseParaTela(null)).toBe("");
    expect(dataBaseDaTela("01/07")).toBe("07-01");
    expect(dataBaseDaTela("1/7")).toBe("07-01");
    expect(dataBaseDaTela("29/02")).toBe("02-29");
    expect(dataBaseDaTela("31/04")).toBeNull();
    expect(dataBaseDaTela("07-01")).toBeNull();
  });
});

describe("tabelas de preço ligadas", () => {
  const tabela = (id: string, data: Record<string, unknown>) => tabelaDoRegistro(id, { contract_id: "itau-2026", ...data })!;
  const TABELAS: TabelaDoContrato[] = [
    tabela("rfq", { nome: "RFQ 2021", variante: "Comercial", vigente_de: "2021-07-01", vigente_ate: "2026-06-29", status: "encerrada", precos: { a: {}, b: {} } }),
    tabela("noturna", { nome: "LPU v2.0", variante: "Noturna", vigente_de: "2026-07-01", vigente_ate: null, status: "ativa", precos: { a: {}, b: {}, c: {} } }),
    tabela("comercial", { nome: "LPU v2.0", variante: "Comercial", vigente_de: "2026-07-01", vigente_ate: null, status: "ativa", precos: { a: {}, b: {}, c: {} } }),
    tabela("v3", { nome: "LPU v3.0", variante: "Comercial", vigente_de: "2027-07-01", vigente_ate: null, status: "ativa", precos: {} }),
  ];

  it("nome, variante, vigência, situação e quantidade de itens, sem os preços", () => {
    const lida = TABELAS.find((item) => item.id === "comercial")!;
    expect(lida).toEqual({ id: "comercial", nome: "LPU v2.0", codigo: "", variante: "Comercial", vigenteDe: "2026-07-01", vigenteAte: null, encerrada: false, itens: 3 });
    expect(Object.keys(lida)).not.toContain("precos");
  });

  it("vigentes primeiro, depois a que vai começar e as encerradas", () => {
    expect(tabelasEmOrdem(TABELAS, HOJE).map((item) => [item.id, situacaoDaTabela(item, HOJE).rotulo, periodoDaTabela(item)])).toEqual([
      ["comercial", "Vigente", "desde 01/07/2026"],
      ["noturna", "Vigente", "desde 01/07/2026"],
      ["v3", "A partir de 01/07/2027", "desde 01/07/2027"],
      ["rfq", "Encerrada em 29/06/2026", "01/07/2021 – 29/06/2026"],
    ]);
  });

  it("tabela ativa com o fim no passado também está encerrada", () => {
    const vencida = tabela("x", { nome: "X", vigente_de: "2020-01-01", vigente_ate: "2020-12-31", status: "ativa" });
    expect(situacaoDaTabela(vencida, HOJE)).toMatchObject({ rotulo: "Encerrada em 31/12/2020", tom: "neutro" });
  });
});

describe("aditivos na linha do tempo", () => {
  const ADITIVOS = [
    aditivoDoRegistro("0", { numero: 0, tipo: "formalizacao", assinado_em: "2021-07-01", documento: { nome: "Termo assinado", referencia: "r" } })!,
    aditivoDoRegistro("4", {
      numero: 4,
      tipo: "preco",
      assinado_em: "2026-06-29",
      vigente_de: "2026-07-01",
      vigente_ate: "2027-06-30",
      tabela_ids: ["comercial", "noturna"],
      documento: { nome: "Aditivo 4 assinado", referencia: "https://exemplo.com/aditivo-4.pdf" },
      observacao: "LPU v2.0",
    })!,
    aditivoDoRegistro("3", { numero: 3, tipo: "prorrogacao", assinado_em: null, vigente_de: "2024-07-01", vigente_ate: "2026-06-30", documento: null })!,
  ];

  it("o mais novo em cima, com o tipo, a vigência, as tabelas e o documento", () => {
    expect(aditivosEmOrdem(ADITIVOS).map(linhaDoAditivo)).toEqual([
      {
        titulo: "Aditivo 4",
        tipo: "Preço e vigência",
        detalhes: ["assinado 29/06/2026", "vigência 01/07/2026 – 30/06/2027", "2 tabelas"],
        documento: { nome: "Aditivo 4 assinado", href: "https://exemplo.com/aditivo-4.pdf" },
        observacao: "LPU v2.0",
      },
      {
        titulo: "Aditivo 3",
        tipo: "Prorrogação",
        detalhes: ["sem data de assinatura", "vigência 01/07/2024 – 30/06/2026", "documento não localizado"],
        documento: null,
        observacao: "",
      },
      {
        titulo: "Termo de formalização",
        tipo: "Contrato",
        detalhes: ["assinado 01/07/2021"],
        documento: { nome: "Termo assinado", href: null },
        observacao: "",
      },
    ]);
  });

  it("o número vem do documento ou do id; sem nenhum, fica fora", () => {
    expect(aditivoDoRegistro("7", { tipo: "escopo" })?.numero).toBe(7);
    expect(aditivoDoRegistro("abc", { tipo: "escopo" })).toBeNull();
  });

  it("o selo da ficha é o último aditivo, sem a formalização", () => {
    expect(ultimoAditivo(ADITIVOS)?.numero).toBe(4);
    expect(ultimoAditivo([ADITIVOS[0]])).toBeNull();
  });
});

describe("alertas da ficha e do Início", () => {
  it("a data do aviso tem o nome dele: aviso de denúncia, ou oposição na automática", () => {
    expect(textoDoAlerta({ tipo: "renovacao", data: "2027-05-31", dias: 220, marco: 120 }, { ...ITAU.dados, renovacao: { tipo: "novo_documento", aviso_dias: 30, oposicao_ate_dias: null } }).titulo).toBe(
      "Aviso de denúncia até 31/05/2027",
    );
  });

  it("renovação automática depois do fim: registrar a renovação, crítico", () => {
    expect(textoDoAlerta({ tipo: "fim_vigencia", data: "2026-12-31", dias: -5, marco: 0 }, BTG.dados)).toEqual({
      titulo: "Registrar a renovação de 31/12/2026",
      quando: "há 5 dias",
      tom: "critico",
    });
    // Antes do fim, é o fim da vigência.
    expect(textoDoAlerta({ tipo: "fim_vigencia", data: "2026-12-31", dias: 71, marco: 90 }, BTG.dados).titulo).toBe("Fim da vigência em 31/12/2026");
  });

  it("o texto diz a data e o que fazer; crítico com a data passada ou a 30 dias", () => {
    expect(textoDoAlerta({ tipo: "renovacao", data: "2027-05-31", dias: 91, marco: 120 }, ITAU.dados)).toEqual({
      titulo: "Aviso de denúncia até 31/05/2027",
      quando: "em 91 dias",
      tom: "atencao",
    });
    expect(textoDoAlerta({ tipo: "renovacao", data: "2026-11-01", dias: 11, marco: 30 }, BTG.dados)).toMatchObject({
      titulo: "Oposição à renovação até 01/11/2026",
      tom: "critico",
    });
    expect(textoDoAlerta({ tipo: "fim_vigencia", data: "2026-09-30", dias: -21, marco: 0 }, VENCIDO.dados)).toEqual({
      titulo: "Fim da vigência em 30/09/2026",
      quando: "há 21 dias",
      tom: "critico",
    });
    const comIndice = { ...SAFRA.dados, reajuste: { tipo: "indice" as const, indice: "IGP-M", data_base: "11-01" } };
    expect(textoDoAlerta({ tipo: "reajuste", data: "2026-11-01", dias: 0, marco: 30 }, comIndice)).toMatchObject({
      titulo: "Reajuste IGP-M em 01/11/2026",
      quando: "hoje",
    });
  });

  it("Início: os alertas de todos os contratos, o mais próximo primeiro, sem os encerrados", () => {
    const itens = alertasParaOInicio(TODOS, NOMES, HOJE);
    expect(itens.map((item) => [item.contratoId, item.tipo, item.titulo, item.cliente, item.quando, item.tom])).toEqual([
      ["vencido", "fim_vigencia", "Fim da vigência em 30/09/2026", "Alfa Engenharia", "há 21 dias", "critico"],
      ["urgente", "renovacao", "Aviso de denúncia até 16/10/2026", "Beta Seguros", "há 5 dias", "critico"],
      ["urgente", "fim_vigencia", "Fim da vigência em 15/11/2026", "Beta Seguros", "em 25 dias", "critico"],
      ["btg-2026", "fim_vigencia", "Fim da vigência em 31/12/2026", "BTG Pactual", "em 71 dias", "atencao"],
    ]);
  });
});

describe("Registrar aditivo (recordAditivo)", () => {
  const ADITIVOS: Aditivo[] = [aditivoDoRegistro("3", { numero: 3, tipo: "prorrogacao" })!];
  const form = (mudancas: Partial<FormAditivo> = {}): FormAditivo => ({ ...formNovoAditivo(ITAU, ADITIVOS), ...mudancas });

  it("o próximo número e, na prorrogação, a vigência a partir do dia seguinte ao fim", () => {
    expect(formNovoAditivo(ITAU, ADITIVOS)).toMatchObject({ numero: "4", tipo: "prorrogacao", vigenteDe: "2027-07-01", vigenteAte: "" });
    expect(formNovoAditivo(SAFRA, []).numero).toBe("1");
    expect(formNovoAditivo(SAFRA, []).vigenteDe).toBe("");
  });

  it("prorrogação com vigência e documento", () => {
    const conferido = aditivoDoForm(
      form({ vigenteAte: "2028-06-30", assinadoEm: "2027-06-15", documentoNome: "Aditivo 4", documentoReferencia: "OneDrive/a4.pdf" }),
      ADITIVOS,
    );
    expect(conferido).toEqual({
      ok: true,
      valor: {
        numero: 4,
        assinado_em: "2027-06-15",
        tipo: "prorrogacao",
        vigente_de: "2027-07-01",
        vigente_ate: "2028-06-30",
        tabela_ids: [],
        documento: { nome: "Aditivo 4", referencia: "OneDrive/a4.pdf" },
        observacao: "",
      },
    });
    expect(payloadAditivo("itau-2026", conferido.ok ? conferido.valor : (null as never), "k1")).toEqual({
      idempotency_key: "k1",
      contrato_id: "itau-2026",
      aditivo: conferido.ok ? conferido.valor : null,
    });
  });

  it.each([
    [{ numero: "3" }, "já está no histórico"],
    [{ numero: "1000" }, "0 a 999"],
    [{ numero: "4.5" }, "0 a 999"],
    [{ vigenteAte: "" }, "início e fim"],
    [{ vigenteDe: "", vigenteAte: "" }, "Prorrogação precisa da vigência nova"],
    [{ vigenteAte: "2027-01-01" }, "vem antes do início"],
    [{ tipo: "preco" as const, vigenteDe: "", vigenteAte: "" }, "ao menos uma tabela"],
    [{ vigenteAte: "2028-06-30", documentoNome: "Aditivo 4" }, "nome e a referência"],
    [{ vigenteAte: "2028-06-30", assinadoEm: "2027-02-30" }, "assinatura inválida"],
  ])("recusa %o", (mudancas, problema) => {
    const conferido = aditivoDoForm(form(mudancas), ADITIVOS);
    expect(conferido.ok).toBe(false);
    expect(conferido.ok ? "" : conferido.problema).toContain(problema);
  });

  it("vigência e tabelas só onde a callable aceita", () => {
    const escopo = aditivoDoForm(form({ tipo: "escopo", vigenteAte: "2028-06-30", tabelaIds: ["comercial"] }), ADITIVOS);
    expect(escopo).toMatchObject({ ok: true, valor: { vigente_de: null, vigente_ate: null, tabela_ids: [] } });
    const preco = aditivoDoForm(form({ tipo: "preco", vigenteDe: "", vigenteAte: "", tabelaIds: ["comercial", "comercial", "noturna"] }), ADITIVOS);
    expect(preco).toMatchObject({ ok: true, valor: { vigente_de: null, vigente_ate: null, tabela_ids: ["comercial", "noturna"] } });
  });
});

describe("Novo contrato e Editar (saveContract)", () => {
  it("ida e volta: o formulário do contrato devolve os mesmos dados", () => {
    for (const item of [ITAU, SAFRA, BTG]) {
      expect(contratoDoForm(formDoContrato(item))).toEqual({ ok: true, valor: item.dados });
    }
  });

  it("editar leva o contrato inteiro, o id e a edição lida (o estado esperado); o cliente não muda", () => {
    const form = { ...formDoContrato(ITAU), objeto: "Novo objeto", customerCode: "OUTRO" };
    const conferido = contratoDoForm(form);
    expect(conferido.ok).toBe(true);
    const payload = payloadEdicaoContrato(ITAU, conferido.ok ? conferido.valor : ITAU.dados, "k2");
    expect(Object.keys(payload).sort()).toEqual(["acao", "contrato", "contrato_id", "edicao", "idempotency_key"]);
    expect(payload).toMatchObject({ acao: "atualizar", contrato_id: "itau-2026", edicao: 3, idempotency_key: "k2" });
    expect(payload.contrato).toMatchObject({ customer_code: "ITAU-UNIBANCO", objeto: "Novo objeto" });
  });

  it("novo contrato: sem id nem edição, sempre vigente", () => {
    const form = {
      ...formDoContrato(null, "BANCO-SAFRA"),
      nome: "Transporte",
      vigenteDe: "2026-11-01",
      vigenteAte: "2027-10-31",
      pagamentoTexto: "Conforme portal.",
    };
    const conferido = contratoDoForm(form);
    expect(conferido).toMatchObject({
      ok: true,
      valor: {
        customer_code: "BANCO-SAFRA",
        renovacao: { tipo: "aditivo", aviso_dias: null, oposicao_ate_dias: null },
        reajuste: { tipo: "negociado", indice: null, data_base: null },
        pagamento: { tipo: "texto", faixas: [], dias: null, texto: "Conforme portal." },
        impostos: { inclusos: null, texto: null },
      },
    });
    const payload = payloadNovoContrato(conferido.ok ? conferido.valor : ITAU.dados, "k3");
    expect(Object.keys(payload).sort()).toEqual(["acao", "contrato", "idempotency_key"]);
    expect(payload).toMatchObject({ acao: "criar", contrato: { status: "vigente" } });
  });

  it("linhas vazias de números, regimes e documentos saem; oposição só na automática; campos do pagamento só do tipo", () => {
    const form = {
      ...formDoContrato(ITAU),
      numeros: [...formDoContrato(ITAU).numeros, { tipo: "outro" as const, numero: "  " }],
      regimes: [{ servico: " ", regime: "wms" as const }],
      documentos: [{ nome: "", referencia: "" }],
      oposicaoDias: "15",
      pagamento: "dias_apos_nf" as const,
      pagamentoDias: "30",
      pagamentoTexto: "sobra",
    };
    const conferido = contratoDoForm(form);
    expect(conferido).toMatchObject({
      ok: true,
      valor: {
        numeros: ITAU.dados.numeros,
        regimes: [],
        documentos: [],
        renovacao: { oposicao_ate_dias: null },
        pagamento: { tipo: "dias_apos_nf", faixas: [], dias: 30, texto: null },
      },
    });
  });

  it.each([
    [{ customerCode: "" }, "Escolha o cliente"],
    [{ nome: " " }, "nome do contrato"],
    [{ vigenteDe: "" }, "início da vigência"],
    [{ vigenteAte: "" }, "prazo indeterminado"],
    [{ vigenteAte: "2026-01-01" }, "vem antes do início"],
    [{ avisoDias: "-1" }, "Aviso: dias inteiros"],
    [{ reajuste: "indice" as const, indice: "", dataBase: "01/07" }, "índice do reajuste"],
    [{ reajuste: "indice" as const, indice: "IPCA", dataBase: "31/02" }, "Data-base"],
    [{ regimes: [{ servico: "Mudança", regime: "wms" as const }, { servico: "mudança", regime: "por_demanda" as const }] }, "Serviço repetido"],
    [{ faixas: [{ de: "1", ate: "10", dia: "30", mes: "mesmo" as const }] }, "não cobrem o dia 11"],
    [{ faixas: [{ de: "1", ate: "31", dia: "0", mes: "mesmo" as const }] }, "Faixa 1: dias de 1 a 31"],
    [{ pagamento: "dias_apos_nf" as const, pagamentoDias: "" }, "dias depois da NF"],
    [{ pagamento: "texto" as const, pagamentoTexto: " " }, "Descreva a regra"],
    [{ codigoServico: "16.02" }, "Código de serviço"],
    [{ documentos: [{ nome: "Contrato", referencia: "" }] }, "Documento 1"],
  ])("recusa %o", (mudancas, problema) => {
    const conferido = contratoDoForm({ ...formDoContrato(ITAU), ...mudancas });
    expect(conferido.ok).toBe(false);
    expect(conferido.ok ? "" : conferido.problema).toContain(problema);
  });

  it("a próxima faixa começa depois da última", () => {
    expect(proximaFaixa([])).toEqual({ de: "1", ate: "31", dia: "", mes: "seguinte" });
    expect(proximaFaixa([{ de: "1", ate: "10", dia: "30", mes: "mesmo" }])).toMatchObject({ de: "11", ate: "31" });
  });
});
