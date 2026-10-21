import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { centavosDaLinha, formatarReais, totalEmCentavos } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import {
  ITEM_AVULSO_MAXIMO,
  MOTIVO_MAXIMO,
  SINCRONIA_INICIAL,
  VARIANTES,
  acoesDoOrcamento,
  adicionarAjuste,
  adicionarAvulsa,
  adicionarDaTabela,
  adicionarSugestao,
  avisoDeRecalculo,
  buscaNaTabela,
  buscarItensDaTabela,
  catalogoDaTabela,
  classificarErro,
  dataHoraLocal,
  desatualizado,
  ehAtalhoDeSalvar,
  entradasDasLinhas,
  formDoOrcamento,
  formSujo,
  formatarDecimal,
  instanteComFuso,
  linhaAvulsa,
  linhaDeAjuste,
  linhaDoServidor,
  origemDaLinha,
  paraDecimal,
  payloadAvancar,
  payloadCriar,
  payloadDuplicar,
  payloadSalvar,
  pendenciasParaEnviar,
  previaDosTotais,
  problemasDaLinha,
  problemasDoFormulario,
  removerLinha,
  saidaPedeConfirmacao,
  servicosIrmaos,
  situacaoDoCabecalho,
  sincronia,
  teclaNaBusca,
  type FormOrcamento,
  type ItemDoCatalogoDoc,
  type LinhaForm,
  type Sincronia,
} from "./montar";

const here = dirname(fileURLToPath(import.meta.url));
const quotesDoComercial = readFileSync(resolve(here, "../../../../../functions/comercial/src/domain/quotes.ts"), "utf8");

/**
 * Montar orçamento (docs/mockups/ComOrcamento.dc.html; parte 11 de
 * docs/plataforma/fase-6-comercial.md): a grade no jeito do Excel, a prévia
 * dos totais pela conta de lib/dominio, a linha alterada, avulsa e de ajuste
 * com motivo, e as chamadas de saveQuote e advanceQuote (functions/comercial,
 * domain/quotes.ts, entrada `.strict()`).
 */

const E = "Estação de trabalho em L 1,40 m";

const PRECOS = {
  lpu_est_desm: { codigo: "3.01", descricao_cliente: `${E} – desmontagem`, preco: "38.5" },
  lpu_est_tran: { codigo: "3.02", descricao_cliente: `${E} – transporte`, preco: "21" },
  lpu_est_mont: { codigo: "3.03", descricao_cliente: `${E} – montagem`, preco: "46" },
  lpu_cad_tran: { codigo: "4.12", descricao_cliente: "Cadeira giratória – transporte", preco: "11.4" },
  lpu_mon_tran: { codigo: "5.03", descricao_cliente: "Monitor até 27\" – transporte", preco: "14.8" },
  lpu_arm: { codigo: "9.90", descricao_cliente: "Armazenagem de mobiliário", preco: "100" },
  lpu_velho: { codigo: "9.99", descricao_cliente: "Item desativado", preco: "1" },
};

const ITENS = new Map<string, ItemDoCatalogoDoc>([
  ["lpu_est_desm", { item: E, categoria: "Mobiliário", servico: "Desmontagem", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
  ["lpu_est_tran", { item: E, categoria: "Mobiliário", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
  ["lpu_est_mont", { item: E, categoria: "Mobiliário", servico: "Montagem", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
  ["lpu_cad_tran", { item: "Cadeira giratória", categoria: "Mobiliário", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
  ["lpu_mon_tran", { item: "Monitor até 27\"", categoria: "Informática", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
  ["lpu_arm", { item: "Armazenagem", categoria: "Armazenagem", servico: "Armazenagem", unidade: "M3", descricao: "", orcavel: false, ativo: true }],
  ["lpu_velho", { item: "Item desativado", categoria: "Outros", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: false }],
]);

const CATALOGO = catalogoDaTabela(PRECOS, ITENS);
const porId = (id: string) => CATALOGO.find((item) => item.lpuItemId === id)!;

function tabela(chave: string, id: string, quantidade: string, extra: Partial<LinhaForm> = {}): LinhaForm {
  return { ...adicionarDaTabela([], porId(id), chave, quantidade).linhas[0], ...extra };
}

describe("números como a pessoa digita", () => {
  it.each([
    ["24", "24"],
    ["1,5", "1.5"],
    [" 0,335 ", "0.335"],
    ["1.234,56", "1234.56"],
    ["R$ 1.250,00", "1250.00"],
    ["38.50", "38.50"],
    ["1.234", "1234"],
    [",5", "0.5"],
    ["-400", "-400"],
    ["−400,00", "-400.00"],
  ])("%j vira %j", (digitado, decimal) => {
    expect(paraDecimal(digitado)).toBe(decimal);
  });

  it.each(["", "  ", "abc", "1,2,3", "5,", "1.2.3,4,5", "--1"])("%j não é número", (digitado) => {
    expect(paraDecimal(digitado)).toBeNull();
  });

  it("mostra em pt-BR, com as casas mínimas", () => {
    expect(formatarDecimal("38.5", 2)).toBe("38,50");
    expect(formatarDecimal("1234.5", 2)).toBe("1.234,50");
    expect(formatarDecimal("1250.0000", 2)).toBe("1.250,00");
    expect(formatarDecimal("21.1234", 2)).toBe("21,1234");
    expect(formatarDecimal("24", 0)).toBe("24");
    expect(formatarDecimal("0.335", 0)).toBe("0,335");
    expect(formatarDecimal("-400", 2)).toBe("-400,00");
  });
});

describe("catálogo da tabela e busca de item", () => {
  it("só itens orçáveis e ativos, com o código e o preço da tabela", () => {
    expect(CATALOGO.map((item) => item.codigo)).toEqual(["3.01", "3.02", "3.03", "4.12", "5.03"]);
    expect(porId("lpu_est_tran")).toMatchObject({ item: E, servico: "Transporte", unidade: "UN", preco: "21" });
  });

  it("item que o catálogo ainda não leu entra com a descrição da tabela", () => {
    const [sozinho] = catalogoDaTabela({ lpu_x: { codigo: "1.01", descricao_cliente: "Caixa de arquivo", preco: "3" } }, new Map());
    expect(sozinho).toMatchObject({ lpuItemId: "lpu_x", item: "Caixa de arquivo", servico: "", unidade: "", preco: "3" });
  });

  const achados = (termo: string) => buscarItensDaTabela(CATALOGO, termo).map((item) => item.codigo);

  it("pelo código, pelo item sem acento e pelo serviço; várias palavras", () => {
    expect(achados("3.0")).toEqual(["3.01", "3.02", "3.03"]);
    expect(achados("estacao")).toEqual(["3.01", "3.02", "3.03"]);
    expect(achados("estacao montagem")).toEqual(["3.03"]);
    expect(achados("transporte")).toEqual(["3.02", "4.12", "5.03"]);
    expect(achados("cadeira")).toEqual(["4.12"]);
  });

  it("sem termo, nada; armazenagem e item inativo nunca aparecem", () => {
    expect(achados("")).toEqual([]);
    expect(achados("armazenagem")).toEqual([]);
    expect(achados("desativado")).toEqual([]);
  });

  it("o código que começa com o termo vem antes", () => {
    expect(buscarItensDaTabela(CATALOGO, "5").map((item) => item.codigo)[0]).toBe("5.03");
  });

  it("limita a lista", () => {
    expect(buscarItensDaTabela(CATALOGO, "transporte", 2)).toHaveLength(2);
  });

  it("diz quantos itens acharam além dos que a lista mostra", () => {
    expect(buscaNaTabela(CATALOGO, "transporte", 2)).toMatchObject({ total: 3 });
    expect(buscaNaTabela(CATALOGO, "transporte", 2).itens.map((item) => item.codigo)).toEqual(["3.02", "4.12"]);
    expect(buscaNaTabela(CATALOGO, "inexistente")).toEqual({ itens: [], total: 0 });
    expect(buscaNaTabela(CATALOGO, "  ")).toEqual({ itens: [], total: 0 });
  });

  describe("medida com vírgula, como se digita (LPU real: DTL-0002-T)", () => {
    const STAFF = "Estação de Trabalho Staff";
    const REAIS = catalogoDaTabela(
      {
        lpu_120_t: { codigo: "DTL-0002-T", descricao_cliente: `${STAFF} 1,20x1,20m`, preco: "38" },
        lpu_120_m: { codigo: "DTL-0002-M", descricao_cliente: `${STAFF} 1,20x1,20m`, preco: "52" },
        lpu_140_t: { codigo: "DTL-0003-T", descricao_cliente: `${STAFF} 1,40x1,20m`, preco: "41" },
        lpu_mesa: { codigo: "DTL-0010-T", descricao_cliente: "Mesa de reunião 2,40m", preco: "60" },
      },
      new Map([
        ["lpu_120_t", { item: `${STAFF} 1,20x1,20m`, categoria: "Mobiliário", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
        ["lpu_120_m", { item: `${STAFF} 1,20x1,20m`, categoria: "Mobiliário", servico: "Montagem", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
        ["lpu_140_t", { item: `${STAFF} 1,40x1,20m`, categoria: "Mobiliário", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
        ["lpu_mesa", { item: "Mesa de reunião 2,40m", categoria: "Mobiliário", servico: "Transporte", unidade: "UN", descricao: "", orcavel: true, ativo: true }],
      ]),
    );
    const codigos = (termo: string) => buscarItensDaTabela(REAIS, termo).map((item) => item.codigo);

    it("acha pela medida com vírgula, sozinha ou com o nome", () => {
      expect(codigos("estacao staff")).toEqual(["DTL-0002-M", "DTL-0002-T", "DTL-0003-T"]);
      expect(codigos("estacao 1,20")).toEqual(["DTL-0002-M", "DTL-0002-T", "DTL-0003-T"]);
      expect(codigos("1,40")).toEqual(["DTL-0003-T"]);
      expect(codigos("mesa 2,40")).toEqual(["DTL-0010-T"]);
    });

    it("a medida inteira (1,20x1,20) separa as estações", () => {
      expect(codigos("1,20x1,20")).toEqual(["DTL-0002-M", "DTL-0002-T"]);
      expect(codigos("1,40x1,20")).toEqual(["DTL-0003-T"]);
      expect(codigos("staff 1,40x1,20 transporte")).toEqual(["DTL-0003-T"]);
    });

    it("o código inteiro, com hífen, continua achando o item", () => {
      expect(codigos("DTL-0002-T")[0]).toBe("DTL-0002-T");
      expect(codigos("dtl-0003")).toEqual(["DTL-0003-T"]);
    });
  });
});

describe("grade no jeito do Excel", () => {
  it("setas andam pela lista (dando a volta), Enter adiciona e Esc fecha", () => {
    expect(teclaNaBusca("ArrowDown", { destacado: 0, total: 3 })).toEqual({ destacado: 1, acao: null });
    expect(teclaNaBusca("ArrowDown", { destacado: 2, total: 3 })).toEqual({ destacado: 0, acao: null });
    expect(teclaNaBusca("ArrowUp", { destacado: 0, total: 3 })).toEqual({ destacado: 2, acao: null });
    expect(teclaNaBusca("Enter", { destacado: 1, total: 3 })).toEqual({ destacado: 1, acao: "adicionar" });
    expect(teclaNaBusca("Enter", { destacado: 0, total: 0 })).toEqual({ destacado: 0, acao: null });
    expect(teclaNaBusca("Escape", { destacado: 1, total: 3 })).toEqual({ destacado: 0, acao: "fechar" });
    expect(teclaNaBusca("a", { destacado: 1, total: 3 })).toEqual({ destacado: 1, acao: null });
  });

  it("Enter adiciona o item destacado com quantidade 1 e o foco vai para a quantidade dele", () => {
    const encontrados = buscarItensDaTabela(CATALOGO, "estacao");
    const passo = teclaNaBusca("Enter", { destacado: 1, total: encontrados.length });
    const { linhas, foco } = adicionarDaTabela([tabela("a", "lpu_cad_tran", "60")], encontrados[passo.destacado], "nova-1");
    expect(foco).toBe("nova-1");
    expect(linhas.map((linha) => linha.chave)).toEqual(["a", "nova-1"]);
    expect(linhas[1]).toMatchObject({
      id: null,
      origem: "tabela",
      lpuItemId: "lpu_est_tran",
      codigo: "3.02",
      item: E,
      servico: "Transporte",
      unidade: "UN",
      quantidade: "1",
      preco: "21,00",
      precoTabela: "21",
      motivo: "",
    });
  });

  it("sugere os outros serviços do mesmo item que estão na tabela e ainda não entraram", () => {
    const linhas = [tabela("a", "lpu_est_tran", "24")];
    expect(servicosIrmaos(porId("lpu_est_tran"), CATALOGO, linhas).map((item) => item.servico)).toEqual(["Desmontagem", "Montagem"]);
    const comMontagem = [...linhas, tabela("b", "lpu_est_mont", "24")];
    expect(servicosIrmaos(porId("lpu_est_tran"), CATALOGO, comMontagem).map((item) => item.servico)).toEqual(["Desmontagem"]);
    expect(servicosIrmaos(porId("lpu_cad_tran"), CATALOGO, [])).toEqual([]);
  });

  it("a sugestão entra logo depois do item, com a mesma quantidade", () => {
    const linhas = [tabela("a", "lpu_est_tran", "24"), tabela("b", "lpu_cad_tran", "60")];
    const primeiro = adicionarSugestao(linhas, "a", porId("lpu_est_mont"), "nova-1");
    expect(primeiro.foco).toBe("nova-1");
    expect(primeiro.linhas.map((linha) => [linha.chave, linha.codigo, linha.quantidade])).toEqual([
      ["a", "3.02", "24"],
      ["nova-1", "3.03", "24"],
      ["b", "4.12", "60"],
    ]);
    const segundo = adicionarSugestao(primeiro.linhas, "a", porId("lpu_est_desm"), "nova-2");
    expect(segundo.linhas.map((linha) => linha.chave)).toEqual(["a", "nova-1", "nova-2", "b"]);
  });

  it("remove a linha", () => {
    expect(removerLinha([tabela("a", "lpu_est_tran", "1"), tabela("b", "lpu_cad_tran", "1")], "a").map((l) => l.chave)).toEqual(["b"]);
  });

  it("item avulso e ajuste entram no fim e o foco vai para a descrição da linha nova", () => {
    const linhas = [tabela("a", "lpu_est_tran", "1")];
    const avulsa = adicionarAvulsa(linhas, "nova-1");
    expect(avulsa).toMatchObject({ foco: "nova-1", campo: "descricao" });
    expect(avulsa.linhas.map((linha) => [linha.chave, linha.origem])).toEqual([
      ["a", "tabela"],
      ["nova-1", "avulso"],
    ]);
    const ajuste = adicionarAjuste(avulsa.linhas, "nova-2");
    expect(ajuste).toMatchObject({ foco: "nova-2", campo: "descricao" });
    expect(ajuste.linhas.at(-1)).toMatchObject({ chave: "nova-2", origem: "ajuste", quantidade: "1" });
  });
});

describe("prévia dos totais pela conta de lib/dominio", () => {
  it("igual ao total de lib/dominio, arredondado por linha (três linhas de 1 × 0,335 = 1,02; uma de 3 × 0,335 = 1,01)", () => {
    const alterada = (chave: string, quantidade: string) =>
      tabela(chave, "lpu_est_tran", quantidade, { preco: "0,335", motivo: "Preço combinado" });
    const linhas = [
      alterada("a1", "1"),
      alterada("a2", "1"),
      alterada("a3", "1"),
      alterada("a4", "3"),
      tabela("b", "lpu_cad_tran", "60"),
      { ...linhaAvulsa("c"), descricao: "Içamento por escada", quantidade: "1", preco: "1.250,00", motivo: "Fora da LPU" },
      { ...linhaDeAjuste("d"), preco: "400", motivo: "Mesma equipe" },
    ];
    const previa = previaDosTotais(linhas);
    const esperado = totalEmCentavos([
      { quantidade: "1", preco: "0.335" },
      { quantidade: "1", preco: "0.335" },
      { quantidade: "1", preco: "0.335" },
      { quantidade: "3", preco: "0.335" },
      { quantidade: "60", preco: "11.4" },
      { quantidade: "1", preco: "1250.00" },
      { quantidade: "1", preco: "-400", ajuste: true },
    ]);
    expect(previa.porLinha).toEqual({
      a1: centavosDaLinha("1", "0.335"),
      a2: 34,
      a3: 34,
      a4: 101,
      b: 68_400,
      c: 125_000,
      d: -40_000,
    });
    expect(previa.subtotalCents).toBe(102 + 101 + 68_400 + 125_000);
    expect(previa.ajustesCents).toBe(-40_000);
    expect(previa.totalCents).toBe(esperado);
    expect(previa.completa).toBe(true);
  });

  it("linha com número inválido fica sem valor e a prévia, incompleta", () => {
    const previa = previaDosTotais([tabela("a", "lpu_est_tran", "2"), tabela("b", "lpu_cad_tran", "1,")]);
    expect(previa.porLinha).toEqual({ a: 4_200, b: null });
    expect(previa.completa).toBe(false);
  });

  it("sem linha, zero", () => {
    expect(previaDosTotais([])).toEqual({ porLinha: {}, subtotalCents: 0, ajustesCents: 0, totalCents: 0, completa: true });
  });
});

describe("linha alterada, avulsa e de ajuste", () => {
  it("o mesmo preço da tabela, escrito de outro jeito, continua de tabela", () => {
    expect(origemDaLinha(tabela("a", "lpu_est_desm", "1"))).toBe("tabela");
    expect(origemDaLinha(tabela("a", "lpu_est_desm", "1", { preco: "38,5" }))).toBe("tabela");
    expect(origemDaLinha(tabela("a", "lpu_est_desm", "1", { preco: "38.5000" }))).toBe("tabela");
  });

  it("preço diferente da tabela marca a linha como alterada", () => {
    expect(origemDaLinha(tabela("a", "lpu_cad_tran", "60", { preco: "8,50" }))).toBe("alterado");
  });

  it("avulso e ajuste são o que são", () => {
    expect(origemDaLinha(linhaAvulsa("x"))).toBe("avulso");
    expect(origemDaLinha(linhaDeAjuste("y"))).toBe("ajuste");
  });

  it("linha alterada pede motivo", () => {
    expect(problemasDaLinha(tabela("a", "lpu_cad_tran", "60", { preco: "8,50" }))).toEqual([
      "Informe o motivo do preço diferente da tabela.",
    ]);
    expect(problemasDaLinha(tabela("a", "lpu_cad_tran", "60", { preco: "8,50", motivo: "Volume acima de 50 un." }))).toEqual([]);
    expect(problemasDaLinha(tabela("a", "lpu_cad_tran", "60"))).toEqual([]);
  });

  it("avulso pede item, valor e motivo", () => {
    expect(problemasDaLinha(linhaAvulsa("x"))).toEqual(["Informe o item.", "Informe o valor.", "Informe o motivo do item avulso."]);
    expect(
      problemasDaLinha({ ...linhaAvulsa("x"), descricao: "Içamento", preco: "1250", motivo: "Fora da LPU" }),
    ).toEqual([]);
  });

  it("ajuste pede valor e motivo, e é sempre desconto", () => {
    expect(problemasDaLinha(linhaDeAjuste("y"))).toEqual(["Informe o valor do ajuste.", "Informe o motivo do ajuste."]);
    expect(problemasDaLinha({ ...linhaDeAjuste("y"), preco: "0", motivo: "x" })).toEqual(["Informe o valor do ajuste."]);
    expect(problemasDaLinha({ ...linhaDeAjuste("y"), preco: "-400", motivo: "Mesma equipe" })).toEqual([]);
  });

  it("o item avulso cabe no limite do servidor (item até 200 caracteres)", () => {
    const avulsa = (descricao: string) => ({ ...linhaAvulsa("x"), descricao, preco: "10", motivo: "Fora da LPU" });
    expect(problemasDaLinha(avulsa("a".repeat(ITEM_AVULSO_MAXIMO)))).toEqual([]);
    expect(problemasDaLinha(avulsa("a".repeat(ITEM_AVULSO_MAXIMO + 1)))).toEqual([
      `O item avulso aceita até ${ITEM_AVULSO_MAXIMO} caracteres.`,
    ]);
    const [entrada] = entradasDasLinhas([avulsa("a".repeat(ITEM_AVULSO_MAXIMO))]);
    expect(String(entrada.item)).toHaveLength(ITEM_AVULSO_MAXIMO);
  });

  it("os limites são os do schema da saveQuote (functions/comercial, quotes.ts)", () => {
    const inicio = quotesDoComercial.indexOf("const linhaEntrada");
    const linhaEntrada = quotesDoComercial.slice(inicio, quotesDoComercial.indexOf(".strict();", inicio));
    expect(inicio).toBeGreaterThan(-1);
    expect(linhaEntrada).toMatch(new RegExp(`\\bitem: z\\.string\\(\\)\\.trim\\(\\)\\.max\\(${ITEM_AVULSO_MAXIMO}\\)`));
    expect(linhaEntrada).toMatch(new RegExp(`\\bmotivo: z\\.string\\(\\)\\.trim\\(\\)\\.max\\(${MOTIVO_MAXIMO},`));
  });

  it("quantidade precisa ser maior que zero", () => {
    expect(problemasDaLinha(tabela("a", "lpu_est_tran", "0"))).toEqual(["Quantidade inválida."]);
    expect(problemasDaLinha(tabela("a", "lpu_est_tran", "x"))).toEqual(["Quantidade inválida."]);
  });

  it("o ajuste não pode passar do valor dos itens", () => {
    const form = formDoOrcamento(DEMANDA, ORCAMENTO);
    const linhas = [tabela("a", "lpu_est_tran", "1"), { ...linhaDeAjuste("d"), preco: "100", motivo: "x" }];
    expect(problemasDoFormulario({ ...form, linhas })).toContain("O ajuste passa do valor dos itens.");
    expect(problemasDoFormulario(form)).toEqual([]);
  });
});

// --- Formulário e chamadas --------------------------------------------------------------

const DEMANDA = {
  numero: "10045",
  customer_code: "ITAU-UNIBANCO",
  customer_name: "Itaú Unibanco",
  contrato_id: "ct-itau",
  titulo: "Remanejamento do 12º andar",
  ref_cliente: "CE8977",
  solicitante: { contato_id: "ct_renata", empresa: "Souza & Lopes" },
  recebida_em: "2026-10-14T12:42:00.000Z",
  email_assunto: "RES: CE8977 · Remanejamento 12º andar",
  email_link: "https://outlook.office.com/mail/id/AAA",
  origem: { local_id: "loc_os", complemento: "Torre A · 12º andar" },
  destino: { local_id: "loc_conc", complemento: null },
  execucao: { datas: [], de: "2026-10-24", ate: "2026-10-25", a_definir: false, visita_tecnica: "2026-10-17" },
  etapa: "em_montagem",
};

const ORCAMENTO = {
  numero: "10045",
  rotulo: "10045",
  rv: 0,
  tipo_rv: "proposta",
  status: "rascunho",
  edicao: 4,
  data_base: "2026-10-14",
  tabela: { id: "pt_itau_com", nome: "LPU Itaú v2.0", variante: "Comercial" },
  linhas: [
    { id: "ln_1", lpu_item_id: "lpu_est_tran", codigo: "3.02", item: E, descricao: "x", servico: "Transporte", unidade: "UN", quantidade: "24", preco: "21", preco_tabela: "21", origem: "tabela", motivo: null, origem_local: null, destino_local: null, total_cents: 50_400, preco_anterior: null },
    { id: "ln_2", lpu_item_id: "lpu_cad_tran", codigo: "4.12", item: "Cadeira giratória", descricao: "x", servico: "Transporte", unidade: "UN", quantidade: "60", preco: "8.5", preco_tabela: "11.4", origem: "alterado", motivo: "Volume acima de 50 un.", origem_local: "loc_os", destino_local: null, total_cents: 51_000, preco_anterior: null },
    { id: "ln_3", lpu_item_id: null, codigo: null, item: "Içamento de divisória de vidro", descricao: "Içamento de divisória de vidro", servico: "Içamento", unidade: "VB", quantidade: "1", preco: "1250", preco_tabela: null, origem: "avulso", motivo: "Fora da LPU", origem_local: null, destino_local: null, total_cents: 125_000, preco_anterior: null },
    { id: "ln_4", lpu_item_id: null, codigo: null, item: "Execução junto com a CE8971", descricao: "Execução junto com a CE8971", servico: null, unidade: null, quantidade: "1", preco: "-400", preco_tabela: null, origem: "ajuste", motivo: "Mesma equipe e veículo", origem_local: null, destino_local: null, total_cents: -40_000, preco_anterior: null },
  ],
  subtotal_cents: 226_400,
  ajustes_cents: -40_000,
  total_cents: 186_400,
  condicoes: "Valores pela LPU Itaú v2.0.",
  observacoes_internas: "Elevador reservado.",
  autor_uid: "u-gui",
};

describe("formulário do orçamento", () => {
  const form = formDoOrcamento(DEMANDA, ORCAMENTO);

  it("abre com o que está gravado, no formato da tela", () => {
    expect(form).toMatchObject({
      contatoId: "ct_renata",
      refCliente: "CE8977",
      titulo: "Remanejamento do 12º andar",
      recebidaEm: "2026-10-14T09:42",
      emailAssunto: "RES: CE8977 · Remanejamento 12º andar",
      emailLink: "https://outlook.office.com/mail/id/AAA",
      execucao: { modo: "intervalo", data: "", de: "2026-10-24", ate: "2026-10-25", visitaTecnica: "2026-10-17" },
      origem: { localId: "loc_os", complemento: "Torre A · 12º andar" },
      destino: { localId: "loc_conc", complemento: "" },
      condicoes: "Valores pela LPU Itaú v2.0.",
      observacoes: "Elevador reservado.",
    });
    expect(form.linhas.map((linha) => [linha.chave, linha.origem, linha.quantidade, linha.preco, linha.precoTabela])).toEqual([
      ["ln_1", "tabela", "24", "21,00", "21"],
      ["ln_2", "tabela", "60", "8,50", "11.4"],
      ["ln_3", "avulso", "1", "1.250,00", null],
      ["ln_4", "ajuste", "1", "400,00", null],
    ]);
    expect(origemDaLinha(form.linhas[1])).toBe("alterado");
  });

  it("a linha do servidor guarda o id e os locais", () => {
    expect(linhaDoServidor(ORCAMENTO.linhas[1])).toMatchObject({ id: "ln_2", chave: "ln_2", origemLocal: "loc_os", motivo: "Volume acima de 50 un." });
  });

  it("execução: uma data, intervalo ou a definir", () => {
    const data = formDoOrcamento({ ...DEMANDA, execucao: { datas: ["2026-10-24"], de: null, ate: null, a_definir: false, visita_tecnica: null } }, ORCAMENTO);
    expect(data.execucao).toEqual({ modo: "data", data: "2026-10-24", de: "", ate: "", visitaTecnica: "" });
    const tbd = formDoOrcamento({ ...DEMANDA, execucao: null }, ORCAMENTO);
    expect(tbd.execucao.modo).toBe("a_definir");
  });

  it("as linhas voltam como a callable recebe: preço só na alterada, na avulsa e no ajuste", () => {
    expect(entradasDasLinhas(form.linhas)).toEqual([
      { id: "ln_1", origem: "tabela", lpu_item_id: "lpu_est_tran", quantidade: "24", origem_local: null, destino_local: null },
      { id: "ln_2", origem: "alterado", lpu_item_id: "lpu_cad_tran", quantidade: "60", preco: "8.50", motivo: "Volume acima de 50 un.", origem_local: "loc_os", destino_local: null },
      { id: "ln_3", origem: "avulso", lpu_item_id: null, quantidade: "1", preco: "1250.00", motivo: "Fora da LPU", descricao: "Içamento de divisória de vidro", item: "Içamento de divisória de vidro", servico: "Içamento", unidade: "VB", origem_local: null, destino_local: null },
      { id: "ln_4", origem: "ajuste", quantidade: "1", preco: "-400.00", motivo: "Mesma equipe e veículo", descricao: "Execução junto com a CE8971", origem_local: null, destino_local: null },
    ]);
  });

  it("linha nova vai sem id: o servidor dá o id", () => {
    const [nova] = entradasDasLinhas(adicionarDaTabela([], porId("lpu_est_mont"), "nova-1").linhas);
    expect(nova).toEqual({ origem: "tabela", lpu_item_id: "lpu_est_mont", quantidade: "1", origem_local: null, destino_local: null });
  });
});

describe("saveQuote e advanceQuote", () => {
  const original = formDoOrcamento(DEMANDA, ORCAMENTO);
  const base = { numero: "10045", edicao: 4, chave: "req-1" };

  it("salvar sem mudança manda só a edição esperada", () => {
    expect(payloadSalvar({ ...base, original, form: original })).toEqual({
      action: "update",
      request_id: "req-1",
      numero: "10045",
      expected_edicao: 4,
    });
    expect(formSujo(original, original)).toBe(false);
  });

  it("salvar manda só o que mudou; as linhas, só quando mudaram", () => {
    const form = {
      ...original,
      titulo: "Remanejamento do 12º e 8º andares",
      refCliente: "",
      recebidaEm: "2026-10-14T10:00",
      execucao: { ...original.execucao, modo: "a_definir" as const },
      destino: { localId: "", complemento: "" },
      observacoes: "Elevador reservado com a Renata.",
    };
    expect(formSujo(original, form)).toBe(true);
    expect(payloadSalvar({ ...base, original, form })).toEqual({
      action: "update",
      request_id: "req-1",
      numero: "10045",
      expected_edicao: 4,
      titulo: "Remanejamento do 12º e 8º andares",
      ref_cliente: null,
      recebida_em: "2026-10-14T10:00-03:00",
      execucao: { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: "2026-10-17" },
      destino: null,
      observacoes_internas: "Elevador reservado com a Renata.",
    });
    const comLinha = { ...original, linhas: original.linhas.map((linha) => (linha.chave === "ln_1" ? { ...linha, quantidade: "30" } : linha)) };
    const payload = payloadSalvar({ ...base, original, form: comLinha });
    expect(Object.keys(payload)).toEqual(["action", "request_id", "numero", "expected_edicao", "linhas"]);
    expect((payload.linhas as Array<Record<string, unknown>>)[0]).toMatchObject({ id: "ln_1", quantidade: "30" });
  });

  it("trocar a variante (Comercial | Noturna) vai junto, sem mandar as linhas", () => {
    expect(VARIANTES).toEqual(["Comercial", "Noturna"]);
    expect(payloadSalvar({ ...base, original, form: original, variante: "Noturna" })).toEqual({
      action: "update",
      request_id: "req-1",
      numero: "10045",
      expected_edicao: 4,
      variante: "Noturna",
    });
  });

  it("execução de uma data e locais com complemento", () => {
    const form = {
      ...original,
      execucao: { modo: "data" as const, data: "2026-10-24", de: "", ate: "", visitaTecnica: "" },
      origem: { localId: "loc_os", complemento: "Torre B" },
      contatoId: "ct_paula",
    };
    expect(payloadSalvar({ ...base, original, form })).toMatchObject({
      contato_id: "ct_paula",
      execucao: { datas: ["2026-10-24"], de: null, ate: null, a_definir: false, visita_tecnica: null },
      origem: { local_id: "loc_os", complemento: "Torre B" },
    });
  });

  it("o canal do pedido (e-mail, telefone, WhatsApp) vai quando muda", () => {
    expect(original.canal).toBe("email");
    expect(formDoOrcamento({ ...DEMANDA, canal: "telefone" }, ORCAMENTO).canal).toBe("telefone");
    expect(payloadSalvar({ ...base, original, form: { ...original, canal: "telefone" } })).toEqual({
      action: "update",
      request_id: "req-1",
      numero: "10045",
      expected_edicao: 4,
      canal: "telefone",
    });
    expect(formSujo(original, { ...original, canal: "whatsapp" })).toBe(true);
  });

  it("data de execução em branco vira a definir", () => {
    const form = { ...original, execucao: { modo: "intervalo" as const, data: "", de: "", ate: "", visitaTecnica: "" } };
    expect(payloadSalvar({ ...base, original, form }).execucao).toEqual({ datas: [], de: null, ate: null, a_definir: true, visita_tecnica: null });
  });

  it("criar: cliente, contrato opcional e a variante", () => {
    expect(payloadCriar({ customerCode: "ITAU-UNIBANCO", contratoId: "ct-itau", variante: "Noturna" }, "req-2")).toEqual({
      action: "create",
      request_id: "req-2",
      customer_code: "ITAU-UNIBANCO",
      contrato_id: "ct-itau",
      variante: "Noturna",
    });
    expect(payloadCriar({ customerCode: "GRUPO-SBF", contratoId: null, variante: "Comercial" }, "req-3").contrato_id).toBeNull();
  });

  it("avançar leva a situação e a edição que a tela viu", () => {
    expect(payloadAvancar("submit", { numero: "10045", status: "rascunho", edicao: 5 }, "req-4")).toEqual({
      action: "submit",
      request_id: "req-4",
      numero: "10045",
      expected_status: "rascunho",
      expected_edicao: 5,
    });
    expect(payloadAvancar("return", { numero: "10045", status: "para_aprovar", edicao: 5 }, "req-5", "  Rever a cadeira ")).toMatchObject({
      action: "return",
      nota: "Rever a cadeira",
    });
  });

  it("duplicar pelo número de origem", () => {
    expect(payloadDuplicar("10045", "req-6")).toEqual({ action: "duplicate", request_id: "req-6", origem_numero: "10045" });
  });

  it("recebido em: a hora de São Paulo com o fuso, e de volta", () => {
    expect(instanteComFuso("2026-10-14T09:42")).toBe("2026-10-14T09:42-03:00");
    expect(instanteComFuso("")).toBeNull();
    expect(dataHoraLocal("2026-10-14T12:42:00.000Z")).toBe("2026-10-14T09:42");
    expect(dataHoraLocal(null)).toBe("");
  });

  it("enviar para aprovação pede Para, título e uma linha, como o servidor", () => {
    expect(pendenciasParaEnviar(original)).toEqual([]);
    expect(pendenciasParaEnviar({ ...original, contatoId: "", titulo: " ", linhas: [] })).toEqual(["Para", "título", "uma linha"]);
  });
});

describe("ações da tela por situação e papel", () => {
  const de = (status: string, role: string, uid = "u-gui") => acoesDoOrcamento({ status, role, uid, autorUid: "u-gui" });

  it("rascunho: Enviar para aprovação é a principal; Salvar e Duplicar ao lado; o documento é a prévia", () => {
    expect(de("rascunho", "comercial")).toEqual({
      editavel: true,
      principal: "enviar",
      secundarias: ["salvar", "duplicar"],
      documento: "previa",
    });
  });

  it("para aprovar: só leitura; o owner aprova, devolve ou aprova e envia; quem montou puxa de volta com Editar", () => {
    expect(de("para_aprovar", "owner", "u-leo")).toEqual({
      editavel: false,
      principal: "aprovar",
      secundarias: ["devolver", "aprovar_e_enviar", "duplicar"],
      documento: "previa",
    });
    expect(de("para_aprovar", "comercial")).toEqual({ editavel: false, principal: null, secundarias: ["editar", "duplicar"], documento: "previa" });
    expect(de("para_aprovar", "owner")).toEqual({
      editavel: false,
      principal: "aprovar",
      secundarias: ["editar", "aprovar_e_enviar", "duplicar"],
      documento: "previa",
    });
    expect(de("para_aprovar", "admin", "u-ana")).toEqual({ editavel: false, principal: null, secundarias: ["duplicar"], documento: "previa" });
  });

  it("aprovado: Enviar ao cliente é a principal, para qualquer papel do Comercial; Editar volta ao rascunho", () => {
    for (const role of ["comercial", "admin", "owner"]) {
      expect(de("aprovado", role, "u-ana"), role).toEqual({
        editavel: false,
        principal: "enviar_cliente",
        secundarias: ["editar", "duplicar"],
        documento: "previa",
      });
    }
  });

  it("enviado: só leitura, com o PDF da RV enviada", () => {
    expect(de("enviado", "owner")).toEqual({ editavel: false, principal: null, secundarias: ["duplicar"], documento: "enviado" });
  });

  it("RV de execução com a aprovação dispensada pelo servidor: Enviar ao cliente direto, com a marca", () => {
    const execucao = { status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui", tipoRv: "execucao", dispensada: true };
    expect(acoesDoOrcamento(execucao)).toEqual({
      editavel: true,
      principal: "enviar_dispensado",
      secundarias: ["salvar", "duplicar"],
      documento: "previa",
      aprovacaoDispensada: true,
    });
    // Sem a dispensa do servidor, ou em RV que não é de execução, passa pela aprovação.
    expect(acoesDoOrcamento({ ...execucao, dispensada: false }).principal).toBe("enviar");
    expect(acoesDoOrcamento({ ...execucao, tipoRv: "proposta" }).principal).toBe("enviar");
    expect(acoesDoOrcamento({ ...execucao, tipoRv: "aditivo" })).not.toHaveProperty("aprovacaoDispensada");
    // A dispensa só vale em rascunho: aprovado e enviado seguem os seus caminhos.
    expect(acoesDoOrcamento({ ...execucao, status: "aprovado" }).principal).toBe("enviar_cliente");
    expect(acoesDoOrcamento({ ...execucao, status: "enviado" }).principal).toBeNull();
  });

  it("Descartar RV aparece na RV seguinte ainda não enviada, antes de Duplicar", () => {
    expect(acoesDoOrcamento({ status: "rascunho", role: "comercial", uid: "u-gui", autorUid: "u-gui", descartavel: true }).secundarias).toEqual([
      "salvar",
      "descartar_rv",
      "duplicar",
    ]);
    expect(acoesDoOrcamento({ status: "aprovado", role: "comercial", uid: "u-gui", autorUid: "u-gui", descartavel: true }).secundarias).toEqual([
      "editar",
      "descartar_rv",
      "duplicar",
    ]);
    expect(acoesDoOrcamento({ status: "para_aprovar", role: "owner", uid: "u-leo", autorUid: "u-gui", descartavel: true }).secundarias).toEqual([
      "devolver",
      "aprovar_e_enviar",
      "descartar_rv",
      "duplicar",
    ]);
    expect(acoesDoOrcamento({ status: "enviado", role: "comercial", uid: "u-gui", autorUid: "u-gui", descartavel: true }).secundarias).toEqual(["duplicar"]);
  });

  it("perdida: nada anda, nem o envio do aprovado", () => {
    expect(acoesDoOrcamento({ status: "aprovado", role: "owner", uid: "u-leo", autorUid: "u-gui", etapa: "perdida" })).toEqual({
      editavel: false,
      principal: null,
      secundarias: ["duplicar"],
      documento: "previa",
    });
  });
});

describe("situação no cabeçalho", () => {
  it("para aprovar: com o aprovador desde quando foi enviado (como no mockup)", () => {
    expect(situacaoDoCabecalho({ status: "para_aprovar", passoEm: "2026-10-21T12:05:00.000Z", aprovacao: null, aprovador: null })).toBe(
      "Com o aprovador · 21/10 09:05",
    );
  });

  it("aprovado: por quem, quando quem lê pode ver o nome", () => {
    const aprovacao = { em: "2026-10-21T11:50:00.000Z" };
    expect(situacaoDoCabecalho({ status: "aprovado", passoEm: null, aprovacao, aprovador: "Leonardo" })).toBe("Aprovado por Leonardo · 21/10 08:50");
    expect(situacaoDoCabecalho({ status: "aprovado", passoEm: null, aprovacao, aprovador: null })).toBe("Aprovado · 21/10 08:50");
    expect(situacaoDoCabecalho({ status: "rascunho", passoEm: null, aprovacao: null, aprovador: null })).toBeNull();
  });

  it("enviado: a data do envio ao cliente", () => {
    expect(
      situacaoDoCabecalho({
        status: "enviado",
        passoEm: "2026-10-21T13:30:00.000Z",
        aprovacao: { em: "2026-10-21T11:50:00.000Z" },
        aprovador: "Leonardo",
        envio: { em: "2026-10-21T13:02:00.000Z" },
      }),
    ).toBe("Enviado · 21/10 10:02");
  });
});

describe("erros do servidor", () => {
  const erro = (codigo: string, mensagem: string) => Object.assign(new Error(mensagem), { codigo });

  // As mensagens de quotes.ts como o servidor as monta (o teste abaixo trava os modelos).
  const MUDOU_NO_SALVAR = "O orçamento mudou desde que foi aberto (edição 5, não 4). Abra de novo para não perder a mudança.";
  const MUDOU_NO_AVANCO = "O orçamento mudou desde que foi aberto (edição 5, não 4). Abra de novo.";
  const SITUACAO_NO_AVANCO = "O orçamento 10045 mudou: está Para aprovar, não Rascunho. Abra de novo.";
  const SITUACAO_NO_SALVAR = "O orçamento 10045 está Para aprovar: só o rascunho se edita.";
  const SUMIU = "Orçamento 10045 não encontrado.";

  it("situação divergente, edição velha e orçamento sumido recarregam o orçamento", () => {
    for (const mensagem of [MUDOU_NO_SALVAR, MUDOU_NO_AVANCO, SITUACAO_NO_AVANCO, SITUACAO_NO_SALVAR]) {
      expect(classificarErro(erro("failed-precondition", mensagem)), mensagem).toEqual({ mensagem, recarregar: true });
    }
    expect(classificarErro(erro("not-found", SUMIU))).toEqual({ mensagem: SUMIU, recarregar: true });
  });

  it("os modelos dessas mensagens são os de quotes.ts", () => {
    expect(quotesDoComercial).toContain("`O orçamento mudou desde que foi aberto (edição ${edicao}, não ${input.expected_edicao}). Abra de novo para não perder a mudança.`");
    expect(quotesDoComercial).toContain("`O orçamento mudou desde que foi aberto (edição ${edicao}, não ${input.expected_edicao}). Abra de novo.`");
    expect(quotesDoComercial).toContain("`O orçamento ${numero} mudou: está ${SITUACAO_ROTULO[status] ?? status}, não ");
    expect(quotesDoComercial).toContain("`O orçamento ${numero} está ${SITUACAO_ROTULO[status] ?? status}: só o rascunho se edita.`");
    expect(quotesDoComercial).toContain('throw new HttpsError("not-found", `Orçamento ${numero} não encontrado.`)');
  });

  it("outra recusa do servidor, mesmo failed-precondition, mostra a mensagem e mantém o que a pessoa digitou", () => {
    for (const [codigo, mensagem] of [
      ["failed-precondition", "O contato está inativo."],
      ["failed-precondition", "Mais de uma tabela vale em 2026-10-14 para o contrato ct-itau (Noturna)."],
      ["failed-precondition", "A tabela pt_itau do orçamento não existe mais. Confira as tabelas antes de editar."],
      ["failed-precondition", "Falta Para para enviar para aprovação."],
      ["not-found", "Contato ct_renata não encontrado."],
      ["not-found", "Local loc_os não encontrado."],
      ["aborted", "Muitas gravações ao mesmo tempo. Tente de novo."],
      ["invalid-argument", "Linha 2: o preço diferente da tabela pede um motivo."],
    ]) {
      expect(classificarErro(erro(codigo, mensagem)), mensagem).toEqual({ mensagem, recarregar: false });
    }
    expect(classificarErro("x").recarregar).toBe(false);
  });

  it("o servidor recalculou: avisa com o valor que vale", () => {
    expect(avisoDeRecalculo(186_400, 186_400)).toBeNull();
    expect(avisoDeRecalculo(null, 186_400)).toBeNull();
    expect(avisoDeRecalculo(186_400, 190_000)).toBe(
      `O servidor recalculou o total: ${formatarReais(190_000)} (a prévia era ${formatarReais(186_400)}).`,
    );
    expect(formatarReais(190_000)).toMatch(/^R\$\s1\.900,00$/);
  });
});

describe("o formulário e o servidor ao vivo (onSnapshot)", () => {
  const v = (edicao: number, status = "rascunho", mudanca: Partial<FormOrcamento> = {}) => ({
    versao: `${edicao}|${status}|em_montagem`,
    edicao,
    status,
    original: { ...formDoOrcamento(DEMANDA, { ...ORCAMENTO, edicao, status }), ...mudanca },
  });
  const aberto = (edicao = 3): Sincronia => sincronia(SINCRONIA_INICIAL, { tipo: "servidor", servidor: v(edicao) });
  const editado = (estado: Sincronia) =>
    sincronia(estado, { tipo: "editar", muda: (form) => ({ ...form, titulo: "Remanejamento do 12º e 8º andares" }) });
  const salvar = (estado: Sincronia) =>
    payloadSalvar({ original: estado.base!.original, form: estado.form!, numero: "10045", edicao: estado.base!.edicao, chave: "req" });

  it("abre com o que chegou do servidor", () => {
    const estado = aberto();
    expect(estado.base?.edicao).toBe(3);
    expect(estado.form).toEqual(v(3).original);
    expect(desatualizado(estado)).toBe(false);
  });

  it("sem mudança na tela, a gravação de outra pessoa entra no formulário", () => {
    const estado = sincronia(aberto(), { tipo: "servidor", servidor: v(4, "rascunho", { titulo: "Título de B" }) });
    expect(estado.base?.edicao).toBe(4);
    expect(estado.form?.titulo).toBe("Título de B");
    expect(desatualizado(estado)).toBe(false);
  });

  it("no meio de uma mudança, a gravação de outra pessoa não troca o formulário e a edição enviada é a do formulário", () => {
    const estado = sincronia(editado(aberto(3)), { tipo: "servidor", servidor: v(4, "rascunho", { titulo: "Título de B" }) });
    expect(estado.form?.titulo).toBe("Remanejamento do 12º e 8º andares");
    expect(estado.base?.edicao).toBe(3);
    expect(estado.servidor?.edicao).toBe(4);
    expect(desatualizado(estado)).toBe(true);
    // O servidor recusa a edição 3 (edição velha) em vez de gravar por cima da de B.
    expect(salvar(estado)).toMatchObject({ expected_edicao: 3, titulo: "Remanejamento do 12º e 8º andares" });
  });

  it("a recarga depois do erro usa o último que chegou, mesmo que tenha chegado durante a chamada", () => {
    // A clicou em Salvar na edição 3; a gravação de B (edição 4) chegou enquanto a callable respondia com erro.
    const durante = sincronia(editado(aberto(3)), { tipo: "servidor", servidor: v(4, "rascunho", { titulo: "Título de B" }) });
    const recarregado = sincronia(durante, { tipo: "recarregar" });
    expect(recarregado.base?.edicao).toBe(4);
    expect(recarregado.form?.titulo).toBe("Título de B");
    expect(desatualizado(recarregado)).toBe(false);
    expect(salvar(editado(recarregado))).toMatchObject({ expected_edicao: 4 });
  });

  it("a própria gravação: espera o onSnapshot e então o formulário volta ao que está gravado", () => {
    const enviado = editado(aberto(3));
    const esperando = sincronia(enviado, { tipo: "gravou", edicao: 4, status: "rascunho" });
    expect(esperando.aguardar).toEqual({ edicao: 4, status: "rascunho" });
    expect(esperando.form?.titulo).toBe("Remanejamento do 12º e 8º andares");
    expect(desatualizado(esperando)).toBe(false);
    const chegou = sincronia(esperando, {
      tipo: "servidor",
      servidor: v(4, "rascunho", { titulo: "Remanejamento do 12º e 8º andares" }),
    });
    expect(chegou.aguardar).toBeNull();
    expect(chegou.base?.edicao).toBe(4);
    expect(formSujo(chegou.base!.original, chegou.form!)).toBe(false);
  });

  it("o onSnapshot chegou antes da resposta da callable: a resposta já recarrega", () => {
    const antes = sincronia(editado(aberto(3)), {
      tipo: "servidor",
      servidor: v(4, "rascunho", { titulo: "Remanejamento do 12º e 8º andares" }),
    });
    const respondeu = sincronia(antes, { tipo: "gravou", edicao: 4, status: "rascunho" });
    expect(respondeu.aguardar).toBeNull();
    expect(respondeu.base?.edicao).toBe(4);
  });

  it("avanço (a edição não muda, a situação sim): espera a situação nova", () => {
    const esperando = sincronia(aberto(5), { tipo: "gravou", edicao: 5, status: "para_aprovar" });
    expect(esperando.aguardar).toEqual({ edicao: 5, status: "para_aprovar" });
    const chegou = sincronia(esperando, { tipo: "servidor", servidor: v(5, "para_aprovar") });
    expect(chegou.aguardar).toBeNull();
    expect(chegou.base?.status).toBe("para_aprovar");
  });
});

describe("sair sem salvar e Ctrl+S", () => {
  const aqui = { origin: "https://app.dutelog.com.br", pathname: "/comercial/orcamento", search: "?numero=10045" };

  it("link para outra tela do app pede confirmação", () => {
    expect(saidaPedeConfirmacao("/comercial", aqui)).toBe(true);
    expect(saidaPedeConfirmacao("/comercial/clientes", aqui)).toBe(true);
    expect(saidaPedeConfirmacao("/comercial/orcamento?numero=10046", aqui)).toBe(true);
    expect(saidaPedeConfirmacao("https://app.dutelog.com.br/comercial/contratos?id=ct-itau", aqui)).toBe(true);
  });

  it("a mesma tela, link externo ou sem endereço não pedem", () => {
    expect(saidaPedeConfirmacao("/comercial/orcamento?numero=10045", aqui)).toBe(false);
    expect(saidaPedeConfirmacao("https://outlook.office.com/mail/id/AAA", aqui)).toBe(false);
    expect(saidaPedeConfirmacao(null, aqui)).toBe(false);
    expect(saidaPedeConfirmacao("#itens", aqui)).toBe(false);
  });

  it("Ctrl+S (ou Cmd+S) é o Salvar", () => {
    expect(ehAtalhoDeSalvar({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(ehAtalhoDeSalvar({ key: "S", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(ehAtalhoDeSalvar({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
    expect(ehAtalhoDeSalvar({ key: "s", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBe(false);
    expect(ehAtalhoDeSalvar({ key: "p", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
  });
});
