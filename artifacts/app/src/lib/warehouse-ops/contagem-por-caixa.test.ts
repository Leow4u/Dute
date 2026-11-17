import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";

import {
  catalogoDaContagem,
  contagemLida,
  contagensDoCliente,
  folhaDeContagem,
  horaEmTexto,
  hrefDaFolha,
  inicioDoDiaEmSaoPaulo,
  prateleiraDifere,
  prateleirasDaContagem,
  prateleirasDaRua,
  relatorioCaixasSaldo,
  resumoDaPrateleira,
  resumoDoRelatorio,
  rodadaEmTexto,
  ruaDaBusca,
  ruaDoCodigo,
  ruasDaContagem,
  textoCaixasSaldo,
  textoDaDiferenca,
  textoDasPrateleiras,
  textoDosItensDiferentes,
  type LinhaDaFolha,
} from "./contagem-por-caixa";
import type { LinhaDeEntrada } from "./caixas-da-separacao";

/**
 * A contagem por caixa, só leitura (diagnóstico da Contagem cíclica, seção 6,
 * item 1): a conta por prateleira, caixas × saldo, com a caixa da abertura, a
 * do recebimento e a caixa aberta pela separação. Antes, nada no app
 * confrontava o conteúdo das caixas com o razão (achado F04). Dados sintéticos.
 */

const BTG = "BTG";
const AGORA = new Date("2026-11-17T10:55:00.000Z"); // 07:55 em São Paulo

const posicao = (code: string, sequence: number, customer_code = BTG) => ({
  code,
  aisle: code.split("-")[0],
  shelf: Number(code.split("-")[1]),
  sequence,
  customer_code,
});

// A zona da BTG (A e B) e uma prateleira da zona do Itaú, sem nada da BTG.
const POSICOES = [posicao("A-01", 1), posicao("A-02", 2), posicao("A-03", 3), posicao("A-04", 4), posicao("B-05", 20), posicao("B-06", 21), posicao("C-01", 30, "Itau")];

const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 0, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const CAMISETA_MESCLA = { sku_code: "BTG-000064", client_item_code: "A.01.0821.003.GG", product_name: "Camiseta Mescla Masculino Preta", size: "GG" };

const CAIXAS = [
  // A-01: duas caixas da abertura e uma do recebimento (o conteúdo na própria caixa).
  caixa("CX-000002", "A-01", { unit_count: 4 }),
  caixa("CX-000001", "A-01", { unit_count: 4 }),
  caixa("CX-000004", "A-01", { unit_count: 3, origin: { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" }, lines: [{ ...CAMISETA_MESCLA, counted_qty: 3 }] }),
  // A-02: a CX-000006 foi aberta pela separação (saíram 5).
  caixa("CX-000005", "A-02", { unit_count: 30 }),
  caixa("CX-000006", "A-02", { unit_count: 40, taken_lines: [{ sku_code: "btg-000141", qty: 5 }], taken_units: 5, balance_at: "2026-11-16T12:00:00.000Z" }),
  // A caixa de que a separação tirou tudo saiu da prateleira: não entra.
  caixa("CX-000007", "A-02", { status: "emptied", unit_count: 10, taken_units: 10 }),
  // A-03: uma guardada e uma com o destino confirmado, ainda a caminho.
  caixa("CX-000010", "A-03", { unit_count: 60 }),
  caixa("CX-000230", "A-03", { status: "committing", stored_at: null, unit_count: 10, origin: { kind: "receipt", receipt_id: "inb_2", invoice_number: "48.401" }, lines: [{ ...CAMISETA_MESCLA, counted_qty: 10 }] }),
  // B-05: uma caixa do recebimento com dois produtos.
  caixa("CX-000050", "B-05", {
    unit_count: 15,
    origin: { kind: "receipt", receipt_id: "inb_3", invoice_number: "48.390" },
    lines: [
      { sku_code: "BTG-000301", client_item_code: "B.0791.005.U", product_name: "Copo Café", size: null, counted_qty: 5 },
      { sku_code: "BTG-000300", client_item_code: "C.0734.003.U", product_name: "Caneca Térmica", size: null, counted_qty: 10 },
    ],
  }),
  // B-06: a caixa cadastrada à mão, sem conteúdo registrado.
  caixa("CX-000077", "B-06", { origin: { kind: "manual" } }),
  // A caixa de outro cliente na mesma prateleira não entra.
  caixa("CX-000099", "A-01", { customer_code: "Itau", unit_count: 9 }),
];

const PIMA = { client_item_code: "A.02.0813.005.G", product_name: "Camiseta Pima Masculino Preta", size: "G" };

const ABERTURA: LinhaDeEntrada[] = [
  { box_code: "CX-000001", sku_code: "BTG-000061", counted_qty: 4, ...PIMA },
  { box_code: "CX-000002", sku_code: "BTG-000061", counted_qty: 4, ...PIMA },
  { box_code: "CX-000005", sku_code: "BTG-000140", counted_qty: 30, client_item_code: "A.01.0809.002.P", product_name: "Polo Masculino Piquet Cinza", size: "P" },
  { box_code: "CX-000006", sku_code: "BTG-000141", counted_qty: 40, client_item_code: "A.01.0809.002.M", product_name: "Polo Masculino Piquet Cinza", size: "M" },
  // Sem nome na linha: o nome vem do catálogo.
  { box_code: "CX-000010", sku_code: "BTG-000122", counted_qty: 60 },
];

const SALDOS = [
  { location_id: "A-01", sku_code: "BTG-000061", qty_on_hand: 8, qty_reserved: 0, customer_code: BTG },
  { location_id: "A-01", sku_code: "BTG-000064", qty_on_hand: 3, qty_reserved: 0, customer_code: BTG },
  { location_id: "A-02", sku_code: "BTG-000140", qty_on_hand: 30, customer_code: BTG },
  // As caixas dizem 35: o razão tem 32.
  { location_id: "A-02", sku_code: "BTG-000141", qty_on_hand: 32, customer_code: BTG },
  { location_id: "A-03", sku_code: "BTG-000122", qty_on_hand: 60, qty_reserved: 20, customer_code: BTG },
  // Saldo sem caixa que o tenha (a guarda por linha).
  { location_id: "A-04", sku_code: "BTG-000200", qty_on_hand: 12, customer_code: BTG, product_name: "Mochila Executiva", client_item_code: "C.0900.001.U" },
  // B-05 fecha no total (15) e não por SKU: as caixas têm 10 e 5, o razão 5 e 10.
  { location_id: "B-05", sku_code: "BTG-000300", qty_on_hand: 5, customer_code: BTG },
  { location_id: "B-05", sku_code: "BTG-000301", qty_on_hand: 10, customer_code: BTG },
  // A área de passagem não é prateleira.
  { location_id: "RECEBIMENTO", sku_code: "BTG-000064", qty_on_hand: 10, customer_code: BTG },
  // O local fora do cadastro entra, depois das prateleiras.
  { location_id: "DEVOLUCAO", sku_code: "BTG-000301", qty_on_hand: 1, customer_code: BTG },
  // O saldo de outro cliente não entra.
  { location_id: "A-01", sku_code: "ITAU-000001", qty_on_hand: 9, customer_code: "Itau" },
];

const CATALOGO = catalogoDaContagem([
  { cod_btg: "BTG-000122", produto: "Polo Masculino Piquet Preto", cod_cliente: "A.01.0806.005.P" },
  // O nome do catálogo não ganha do nome da linha da caixa.
  { cod_btg: "BTG-000064", produto: "Outro Nome", cod_cliente: "X" },
]);

const PRATELEIRAS = prateleirasDaContagem({ cliente: BTG, posicoes: POSICOES, caixas: CAIXAS, abertura: ABERTURA, saldos: SALDOS, catalogo: CATALOGO });
const prateleira = (posicao: string) => PRATELEIRAS.find((item) => item.posicao === posicao)!;

const linha = (sku: string, codigo: string, nome: string, entrou: number | null, saiu: number | null, esperado: number, reserva = 0): LinhaDaFolha => ({ sku, codigo, nome, entrou, saiu, esperado, reserva });

describe("as prateleiras da contagem por caixa", () => {
  it("as prateleiras do cliente na ordem de caminhada, as fora do cadastro depois; a zona de outro cliente e as áreas de passagem ficam de fora", () => {
    expect(PRATELEIRAS.map((item) => [item.posicao, item.rua, item.cadastrada])).toEqual([
      ["A-01", "A", true],
      ["A-02", "A", true],
      ["A-03", "A", true],
      ["A-04", "A", true],
      ["B-05", "B", true],
      ["B-06", "B", true],
      ["DEVOLUCAO", "", false],
    ]);
    expect(prateleirasDaContagem({ cliente: null, posicoes: POSICOES, caixas: CAIXAS, abertura: ABERTURA, saldos: SALDOS })).toEqual([]);
  });

  it("a caixa da abertura lê as linhas da sessão e a do recebimento o próprio conteúdo: caixas 11 · saldo 11", () => {
    const a01 = prateleira("A-01");
    expect(a01.caixas.map((item) => item.code)).toEqual(["CX-000001", "CX-000002", "CX-000004"]);
    expect(a01.caixas[0].linhas).toEqual([linha("BTG-000061", "A.02.0813.005.G", "Camiseta Pima Masculino Preta · G", 4, 0, 4)]);
    expect(a01.caixas[2].linhas).toEqual([linha("BTG-000064", "A.01.0821.003.GG", "Camiseta Mescla Masculino Preta · GG", 3, 0, 3)]);
    expect(a01).toMatchObject({ guardadas: 3, aCaminho: 0, itens: 2, unidades: 11, saldo: 11, diferenca: 0, itensDiferentes: 0, semCaixa: [] });
    expect(prateleiraDifere(a01)).toBe(false);
  });

  it("a caixa aberta pela separação: entrou 40, saiu 5, esperado 35; a prateleira dá caixas 65 · saldo 62", () => {
    const a02 = prateleira("A-02");
    expect(a02.caixas.map((item) => [item.code, item.esperado])).toEqual([
      ["CX-000005", 30],
      ["CX-000006", 35],
    ]);
    expect(a02.caixas[1].linhas).toEqual([linha("BTG-000141", "A.01.0809.002.M", "Polo Masculino Piquet Cinza · M", 40, 5, 35)]);
    expect(a02).toMatchObject({ guardadas: 2, itens: 2, unidades: 65, saldo: 62, diferenca: 3, itensDiferentes: 1 });
    expect(prateleiraDifere(a02)).toBe(true);
  });

  it("a caixa a caminho entra marcada e fora das somas; a reserva é a do saldo da prateleira para o SKU; o nome sem linha vem do catálogo", () => {
    const a03 = prateleira("A-03");
    expect(a03.caixas.map((item) => [item.code, item.aCaminho, item.esperado])).toEqual([
      ["CX-000010", false, 60],
      ["CX-000230", true, 10],
    ]);
    expect(a03.caixas[0].linhas).toEqual([linha("BTG-000122", "A.01.0806.005.P", "Polo Masculino Piquet Preto · P", 60, 0, 60, 20)]);
    expect(a03.caixas[1].linhas).toEqual([linha("BTG-000064", "A.01.0821.003.GG", "Camiseta Mescla Masculino Preta · GG", 10, 0, 10)]);
    expect(a03).toMatchObject({ guardadas: 1, aCaminho: 1, itens: 1, unidades: 60, saldo: 60, diferenca: 0, itensDiferentes: 0 });
  });

  it("o saldo sem caixa que o tenha vira linha própria, com o saldo no esperado, e a prateleira difere", () => {
    const a04 = prateleira("A-04");
    expect(a04.caixas).toEqual([]);
    expect(a04.semCaixa).toEqual([linha("BTG-000200", "C.0900.001.U", "Mochila Executiva", null, null, 12)]);
    expect(a04).toMatchObject({ guardadas: 0, itens: 0, unidades: 0, saldo: 12, diferenca: -12, itensDiferentes: 1 });
  });

  it("a prateleira que fecha no total e não por SKU conta os itens que diferem; as linhas da caixa vêm pelo nome", () => {
    const b05 = prateleira("B-05");
    expect(b05.caixas[0].linhas.map((item) => [item.nome, item.esperado])).toEqual([
      ["Caneca Térmica", 10],
      ["Copo Café", 5],
    ]);
    expect(b05).toMatchObject({ unidades: 15, saldo: 15, diferenca: 0, itensDiferentes: 2 });
    expect(prateleiraDifere(b05)).toBe(true);
  });

  it("a caixa sem conteúdo registrado fica sem linhas e vale o que ela diz ter", () => {
    const b06 = prateleira("B-06");
    expect(b06.caixas).toEqual([{ code: "CX-000077", aCaminho: false, linhas: [], esperado: 0 }]);
    expect(b06).toMatchObject({ guardadas: 1, itens: 0, unidades: 0, saldo: 0, diferenca: 0, itensDiferentes: 0 });
  });

  it("o local fora do cadastro entra com o saldo; sem nome em lugar nenhum, fica o SKU", () => {
    const devolucao = prateleira("DEVOLUCAO");
    expect(devolucao.semCaixa).toEqual([linha("BTG-000301", "", "BTG-000301", null, null, 1)]);
    expect(devolucao).toMatchObject({ saldo: 1, diferenca: -1, itensDiferentes: 1 });
  });

  it("a prateleira da zona do cliente sem nada entra vazia; a de outro cliente, não", () => {
    const vazias = prateleirasDaContagem({ cliente: BTG, posicoes: POSICOES, caixas: [], abertura: [], saldos: [] });
    expect(vazias.map((item) => item.posicao)).toEqual(["A-01", "A-02", "A-03", "A-04", "B-05", "B-06"]);
    expect(vazias[0]).toMatchObject({ caixas: [], semCaixa: [], guardadas: 0, unidades: 0, saldo: 0, diferenca: 0, itensDiferentes: 0 });
  });
});

describe("os textos da folha e do relatório", () => {
  it("o cabeçalho da prateleira: as caixas, os itens, as unidades e a regra de ouro", () => {
    expect(resumoDaPrateleira(prateleira("A-01"))).toBe("3 caixas · 2 itens · 11 un.");
    expect(resumoDaPrateleira(prateleira("A-03"))).toBe("1 caixa · 1 item · 60 un. · 1 a caminho");
    expect(resumoDaPrateleira(prateleira("A-04"))).toBe("sem caixa");
    expect(resumoDaPrateleira(prateleira("B-06"))).toBe("1 caixa · 0 itens · 0 un.");
    expect(textoCaixasSaldo(prateleira("A-02"))).toBe("caixas 65 · saldo 62");
    expect(textoDaDiferenca(3)).toBe("+3");
    expect(textoDaDiferenca(-12)).toBe("−12");
    expect(textoDaDiferenca(0)).toBe("0");
    expect(textoDosItensDiferentes(prateleira("B-05"))).toBe("2 itens diferem");
    expect(textoDosItensDiferentes(prateleira("A-02"))).toBe("1 item difere");
    expect(textoDosItensDiferentes(prateleira("A-01"))).toBe("");
  });

  it("as ruas na ordem de caminhada, a folha de uma rua e o cabeçalho dela", () => {
    expect(ruasDaContagem(PRATELEIRAS)).toEqual(["A", "B"]);
    expect(prateleirasDaRua(PRATELEIRAS, "a").map((item) => item.posicao)).toEqual(["A-01", "A-02", "A-03", "A-04"]);
    expect(textoDasPrateleiras(prateleirasDaRua(PRATELEIRAS, "A"))).toBe("A-01 a A-04 · 6 caixas");
    expect(textoDasPrateleiras(prateleirasDaRua(PRATELEIRAS, "B").slice(1))).toBe("B-06 · 1 caixa");
    expect(textoDasPrateleiras([])).toBe("—");
    expect(rodadaEmTexto(AGORA)).toBe("Recontagem · 17/11/2026");
    const folha = folhaDeContagem({ rua: "a", prateleiras: PRATELEIRAS, cliente: "BTG Pactual", por: "Guilherme Dantas", agora: AGORA });
    expect(folha).toMatchObject({ rua: "A", titulo: "Rua A", cliente: "BTG Pactual", rodada: "Recontagem · 17/11/2026", prateleiras: "A-01 a A-04 · 6 caixas", impressaEm: "17/11/2026 07:55", por: "Guilherme Dantas" });
    expect(folha.grupos.map((item) => item.posicao)).toEqual(["A-01", "A-02", "A-03", "A-04"]);
  });

  it("o relatório: as diferentes primeiro, pela diferença, e depois as iguais na ordem de caminhada", () => {
    const relatorio = relatorioCaixasSaldo(PRATELEIRAS);
    expect(relatorio.linhas.map((item) => item.posicao)).toEqual(["A-04", "A-02", "DEVOLUCAO", "B-05", "A-01", "A-03", "B-06"]);
    expect(resumoDoRelatorio(relatorio)).toBe("3 prateleiras iguais · 4 diferentes");
    expect(resumoDoRelatorio({ iguais: 1, diferentes: 1 })).toBe("1 prateleira igual · 1 diferente");
  });

  it("a rua do local e o endereço da folha", () => {
    expect(ruaDoCodigo("A-03")).toBe("A");
    expect(ruaDoCodigo("b-12")).toBe("B");
    expect(ruaDoCodigo("DEVOLUCAO")).toBe("");
    expect(ruaDoCodigo("LOC-1")).toBe("");
    expect(hrefDaFolha("a")).toBe("/estoque/contagem/folha?rua=A");
    expect(hrefDaFolha()).toBe("/estoque/contagem/folha");
    expect(ruaDaBusca("?rua=b")).toBe("B");
    expect(ruaDaBusca("rua=c")).toBe("C");
    expect(ruaDaBusca("")).toBeNull();
  });
});

describe("as contagens do dia", () => {
  const registro = {
    customer_code: BTG,
    location_id: "a-02",
    sku_code: "BTG-000141",
    client_item_code: "A.01.0809.002.M",
    product_name: "Polo Masculino Piquet Cinza",
    size: "M",
    counted_qty: 32,
    qty_before: 35,
    adjustment_delta: -3,
    actor: { uid: "u1", name: "Guilherme Dantas", email: "g@dutelog.com.br" },
    occurred_at: "2026-11-17T11:41:00.000Z",
  };

  it("lê a contagem como o servidor a grava: a prateleira, o item, antes, contado, a diferença, quem e quando", () => {
    expect(contagemLida("cc_1", registro)).toEqual({
      id: "cc_1",
      cliente: "BTG",
      posicao: "A-02",
      sku: "BTG-000141",
      codigo: "A.01.0809.002.M",
      nome: "Polo Masculino Piquet Cinza · M",
      caixa: null,
      antes: 35,
      contado: 32,
      diferenca: -3,
      quem: "Guilherme Dantas",
      quando: "2026-11-17T11:41:00.000Z",
    });
    // Sem a diferença gravada, a conta; sem o nome do ator, o e-mail; a caixa quando há.
    expect(contagemLida("cc_2", { ...registro, adjustment_delta: undefined, actor: { email: "g@dutelog.com.br" }, box_code: "cx-000006" })).toMatchObject({ diferenca: -3, quem: "g@dutelog.com.br", caixa: "CX-000006" });
    expect(contagemLida("cc_3", { ...registro, location_id: "" })).toBeNull();
    expect(horaEmTexto("2026-11-17T11:41:00.000Z")).toBe("08:41");
    expect(horaEmTexto("")).toBe("—");
  });

  it("só as do cliente ativo, a mais recente primeiro", () => {
    const contagens = [
      contagemLida("cc_1", registro)!,
      contagemLida("cc_2", { ...registro, occurred_at: "2026-11-17T12:10:00.000Z" })!,
      contagemLida("cc_3", { ...registro, customer_code: "Itau" })!,
    ];
    expect(contagensDoCliente(contagens, BTG).map((item) => item.id)).toEqual(["cc_2", "cc_1"]);
    expect(contagensDoCliente(contagens, null)).toEqual([]);
  });

  it("o dia começa à meia-noite de São Paulo", () => {
    expect(inicioDoDiaEmSaoPaulo(AGORA)).toBe("2026-11-17T03:00:00.000Z");
    // 22:30 de 16/11 em São Paulo.
    expect(inicioDoDiaEmSaoPaulo(new Date("2026-11-17T01:30:00.000Z"))).toBe("2026-11-16T03:00:00.000Z");
  });
});

/** A caixa recontada (contagem por caixa, diagnóstico da Contagem cíclica, seção 6, item 4). */
describe("a folha depois da recontagem", () => {
  // A CX-000005 entrou com 30 polos P; a recontagem achou 28 e uma polo M fora da lista, e o razão acompanhou.
  const recontada = caixa("CX-000005", "A-02", {
    unit_count: 30,
    count_adjustments: [
      { recount_id: "brc_1", sku_code: "BTG-000140", qty: -2 },
      { recount_id: "brc_1", sku_code: "BTG-000142", qty: 1, client_item_code: "A.01.0809.002.G", product_name: "Polo Masculino Piquet Cinza", size: "G" },
    ],
    balance_at: "2026-11-17T12:00:00.000Z",
  });
  const dados = {
    cliente: BTG,
    posicoes: POSICOES,
    caixas: [recontada],
    abertura: ABERTURA,
    saldos: [
      { location_id: "A-02", sku_code: "BTG-000140", qty_on_hand: 28, customer_code: BTG },
      { location_id: "A-02", sku_code: "BTG-000142", qty_on_hand: 1, customer_code: BTG },
    ],
    catalogo: CATALOGO,
  };

  it("o esperado é o contado, e entrou menos saiu fecha com ele", () => {
    // Antes, a folha seguia esperando as 30 polos P e não listava a polo G achada.
    const a02 = prateleirasDaContagem(dados).find((prateleira) => prateleira.posicao === "A-02")!;
    expect(a02.caixas[0]!.linhas.map((linha) => [linha.sku, linha.nome, linha.entrou, linha.saiu, linha.esperado])).toEqual([
      ["BTG-000140", "Polo Masculino Piquet Cinza · P", 30, 2, 28],
      ["BTG-000142", "Polo Masculino Piquet Cinza · G", 1, 0, 1],
    ]);
    expect(a02.caixas[0]!.esperado).toBe(29);
    // Caixas × saldo: a recontagem gravou a caixa e o razão juntos.
    expect([a02.unidades, a02.saldo, a02.diferenca, a02.itensDiferentes]).toEqual([29, 29, 0, 0]);
    expect(prateleiraDifere(a02)).toBe(false);
  });
});
