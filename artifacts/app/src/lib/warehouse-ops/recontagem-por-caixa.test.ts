import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";

import type { LinhaDeEntrada } from "./caixas-da-separacao";
import { prateleirasDaContagem } from "./contagem-por-caixa";
import {
  CONTAGEM_EM_BRANCO,
  bancadaDaPrateleira,
  bloqueioDaPrateleira,
  buscarProdutos,
  comRecontagensLocais,
  contagemCompleta,
  contagemDaCaixaVazia,
  contagemVazia,
  entradaDaRecontagem,
  hrefDaPrateleira,
  itensComDiferenca,
  linhaRecontada,
  posicaoDaBusca,
  problemaDaQuantidade,
  produtosDoCliente,
  proximaPorContar,
  recontagemDaResposta,
  recontagensDasLinhas,
  resumoDaBancada,
  resumoDaRua,
  rodadaDaContagem,
  rodadaDoDia,
  seloDaPrateleira,
  seloDaRecontagem,
  soAlgarismos,
  textoDaCaixaFechada,
  textoDaOrigem,
  textoDaPrateleiraNaBancada,
  textoDoProgresso,
  tituloDaCaixa,
  type ContagemDigitada,
  type Recontagem,
} from "./recontagem-por-caixa";

/**
 * A recontagem por caixa (diagnóstico da Contagem cíclica, seção 6, item 4):
 * a bancada da prateleira, a rodada e a entrada da callable
 * `recountWarehouseBox`. Antes, a tela só gravava o total do SKU na
 * prateleira, e o registro das caixas ficava errado (achado F01). Dados
 * sintéticos.
 */

const BTG = "BTG Pactual";
const AGORA = new Date("2026-11-17T12:30:00.000Z"); // 09:30 em São Paulo
const RODADA = "recontagem-2026-11-17";

const posicao = (code: string, sequence: number) => ({ code, aisle: code.split("-")[0], shelf: Number(code.split("-")[1]), sequence, customer_code: BTG });
const POSICOES = [posicao("A-03", 3), posicao("A-04", 4), posicao("B-09", 20)];

const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 0, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const P = { sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P" };
const M = { sku_code: "BTG-000123", client_item_code: "A.01.0806.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" };
const GG = { sku_code: "BTG-000125", client_item_code: "A.01.0806.005.GG", product_name: "Polo Masculino Piquet Preto", size: "GG" };

// A-03: a CX-000010 da abertura (60 P, 20 reservadas), a CX-000011 do recebimento (60 M) e a CX-000012 da abertura,
// com 60 M de que a separação tirou 10 e uma GG que já saiu toda (a lista dela é só a M).
const CAIXAS = [
  caixa("CX-000012", "A-03", { unit_count: 62, taken_lines: [{ sku_code: M.sku_code, qty: 10 }, { sku_code: GG.sku_code, qty: 2 }], taken_units: 12 }),
  caixa("CX-000010", "A-03", { unit_count: 60 }),
  caixa("CX-000011", "A-03", {
    unit_count: 60,
    origin: { kind: "receipt", receipt_id: "rcv_1", receipt_number: "AVL-7C21A9F0" },
    lines: [{ ...M, counted_qty: 60 }],
  }),
];
const ABERTURA: LinhaDeEntrada[] = [
  { box_code: "CX-000010", ...P, counted_qty: 60 },
  { box_code: "CX-000012", ...M, counted_qty: 60 },
  { box_code: "CX-000012", ...GG, counted_qty: 2 },
];
const SALDOS = [
  { location_id: "A-03", sku_code: P.sku_code, qty_on_hand: 60, qty_reserved: 20, customer_code: BTG, ...P },
  { location_id: "A-03", sku_code: M.sku_code, qty_on_hand: 110, qty_reserved: 0, customer_code: BTG, ...M },
];
const RESERVAS = [
  { sku_code: P.sku_code, location_id: "A-03", status: "reserved", order_number: "PED-0002", customer_code: BTG },
  // A reserva consumida não conta.
  { sku_code: M.sku_code, location_id: "A-03", status: "consumed", order_number: "PED-0001", customer_code: BTG },
];

const dados = (extra: Partial<Parameters<typeof bancadaDaPrateleira>[0]> = {}) => ({
  cliente: BTG,
  posicao: "a-03",
  posicoes: POSICOES,
  caixas: CAIXAS,
  abertura: ABERTURA,
  saldos: SALDOS,
  reservas: RESERVAS,
  guardas: [],
  recontagens: [],
  rodada: RODADA,
  ...extra,
});

/** Uma linha de `cycle_counts` como box-recount.ts grava. */
function linhaGravada(id: string, extra: Record<string, unknown>) {
  return linhaRecontada(id, {
    customer_code: BTG,
    location_id: "A-03",
    mode: "box",
    round_id: RODADA,
    actor: { uid: "u1", name: "Guilherme Dantas" },
    occurred_at: "2026-11-17T12:11:00.000Z",
    ...extra,
  })!;
}

const RECONTAGEM_DA_011 = recontagensDasLinhas(
  [linhaGravada("cc_1", { box_recount_id: "brc_011", box_code: "CX-000011", ...M, qty_before: 60, counted_qty: 55, adjustment_delta: -5 })],
  BTG,
);

describe("a rodada do dia", () => {
  it("é o dia em São Paulo: a madrugada em UTC ainda é o dia anterior", () => {
    expect(rodadaDoDia(AGORA)).toBe(RODADA);
    expect(rodadaDoDia(new Date("2026-11-18T02:30:00.000Z"))).toBe(RODADA);
    expect(rodadaDoDia(new Date("2026-11-18T03:00:00.000Z"))).toBe("recontagem-2026-11-18");
  });

  it("a prateleira vai na busca em maiúsculas", () => {
    expect(hrefDaPrateleira("a-03")).toBe("/estoque/contagem/prateleira?posicao=A-03");
    expect(posicaoDaBusca("posicao=a-03")).toBe("A-03");
    expect(posicaoDaBusca("")).toBeNull();
  });
});

describe("a bancada da prateleira", () => {
  it("as caixas por código, cada uma com a lista que o servidor confere: o esperado maior que zero, a conta e a reserva", () => {
    const bancada = bancadaDaPrateleira(dados())!;
    expect(bancada.caixas.map((item) => [item.code, item.estado, item.esperado])).toEqual([
      ["CX-000010", "por_contar", 60],
      ["CX-000011", "por_contar", 60],
      ["CX-000012", "por_contar", 50],
    ]);
    // A GG que a separação tirou toda não está na lista: achada, ela é item fora da lista.
    expect(bancada.caixas[2].itens).toEqual([
      { sku: M.sku_code, codigo: M.client_item_code, nome: "Polo Masculino Piquet Preto · M", esperado: 50, entrou: 60, saiu: 10, reservado: 0, pedidos: [], separados: [] },
    ]);
    expect(bancada.caixas[0].itens[0]).toMatchObject({ reservado: 20, pedidos: ["PED-0002"], separados: [] });
    expect(bancada).toMatchObject({ posicao: "A-03", rua: "A", itens: 2, saldo: 170, nasCaixas: 170, reservadas: 20, bloqueio: null, total: 3, confirmadas: 0 });
    expect(resumoDaBancada(bancada)).toBe("Rua A · 3 caixas · 2 itens");
    expect(textoDoProgresso(bancada)).toBe("0 de 3 caixas");
    expect(textoDaPrateleiraNaBancada(bancada)).toBe("saldo da prateleira 170 · caixas 170 · reservadas 20");
    expect(textoDaCaixaFechada(bancada.caixas[0])).toBe("60 esperadas · 20 reservadas · PED-0002");
    expect(tituloDaCaixa(bancada.caixas[0])).toBe("Polo Masculino Piquet Preto · P");
  });

  it("a caixa recontada nesta rodada sai confirmada, com o esperado de quando foi contada", () => {
    const bancada = bancadaDaPrateleira(dados({ recontagens: RECONTAGEM_DA_011 }))!;
    const confirmada = bancada.caixas.find((item) => item.code === "CX-000011")!;
    expect(confirmada.estado).toBe("confirmada");
    expect(seloDaRecontagem(confirmada.recontagem!)).toBe("confirmada 09:11 · 55 · −5");
    expect(textoDaCaixaFechada(confirmada)).toBe("60 esperadas");
    expect(bancada).toMatchObject({ total: 3, confirmadas: 1, esperadasConfirmadas: 60, contadasConfirmadas: 55, diferencaConfirmadas: -5 });
    // A de outra rodada, ou de outra prateleira, não confirma a caixa daqui.
    expect(bancadaDaPrateleira(dados({ recontagens: RECONTAGEM_DA_011.map((item) => ({ ...item, posicao: "A-04" })) }))!.confirmadas).toBe(0);
  });

  it("a caixa a caminho fica fora do progresso e impede a prateleira; a guarda aberta também", () => {
    const comACaminho = bancadaDaPrateleira(dados({ caixas: [...CAIXAS, caixa("CX-000099", "A-03", { status: "committing", unit_count: 4 })] }))!;
    expect(comACaminho.caixas.find((item) => item.code === "CX-000099")?.estado).toBe("a_caminho");
    expect(comACaminho.total).toBe(3);
    expect(comACaminho.bloqueio).toBe("caixa a caminho · CX-000099");
    const comGuarda = bancadaDaPrateleira(dados({ guardas: [{ status: "planned", customer_code: BTG, destination_location_id: "A-03", receipt_number: "AVL-7C21A9F0" }] }))!;
    expect(comGuarda.bloqueio).toBe("guarda aberta · AVL-7C21A9F0");
    // A guarda concluída e a de outra prateleira não impedem.
    expect(bloqueioDaPrateleira("A-03", CAIXAS, [{ status: "completed", destination_location_id: "A-03" }, { status: "in_progress", source_location_id: "A-04" }])).toBeNull();
    expect(bloqueioDaPrateleira("A-03", CAIXAS, [{ status: "IN_PROGRESS", source_location_id: "a-03" }])).toBe("guarda aberta");
  });

  it("o item separado esperando a entrega impede a caixa até a entrega", () => {
    const bancada = bancadaDaPrateleira(dados({ reservas: [...RESERVAS, { sku_code: P.sku_code, location_id: "A-03", status: "picked", order_number: "PED-0003", customer_code: BTG }] }))!;
    expect(bancada.caixas[0].itens[0]).toMatchObject({ pedidos: ["PED-0002"], separados: ["PED-0003"] });
    expect(proximaPorContar(bancada, "CX-000099")).toBe("CX-000011");
  });

  it("a caixa que a rodada esvaziou continua na bancada, vazia; a esvaziada antes da rodada, não", () => {
    const vazia = caixa("CX-000013", "A-03", { status: "emptied", last_recount_id: "brc_013", last_recount_round_id: RODADA });
    const antiga = caixa("CX-000014", "A-03", { status: "emptied", last_recount_round_id: "recontagem-2026-11-16" });
    const recontagens = recontagensDasLinhas([linhaGravada("cc_9", { box_recount_id: "brc_013", box_code: "CX-000013", ...GG, qty_before: 4, counted_qty: 0, adjustment_delta: -4 })], BTG);
    const bancada = bancadaDaPrateleira(dados({ caixas: [...CAIXAS, vazia, antiga], recontagens }))!;
    expect(bancada.caixas.map((item) => item.code)).toEqual(["CX-000010", "CX-000011", "CX-000012", "CX-000013"]);
    const daRodada = bancada.caixas[3];
    expect(daRodada).toMatchObject({ estado: "vazia", itens: [], esperado: 0 });
    expect(seloDaRecontagem(daRodada.recontagem!)).toBe("confirmada 09:11 · vazia · −4");
    expect(tituloDaCaixa(daRodada)).toBe("Polo Masculino Piquet Preto · GG");
    expect(bancada).toMatchObject({ total: 4, confirmadas: 1 });
  });

  it("sem o cliente, ou sem nada do cliente na prateleira, não há bancada", () => {
    expect(bancadaDaPrateleira(dados({ cliente: "" }))).toBeNull();
    expect(bancadaDaPrateleira(dados({ posicao: "Z-99" }))).toBeNull();
    // A caixa de outro cliente na mesma prateleira não entra.
    expect(bancadaDaPrateleira(dados({ caixas: CAIXAS.map((item) => ({ ...item, customer_code: "Itau" })), saldos: [] }))!.caixas).toEqual([]);
  });
});

describe("o que se digita e a chamada da callable", () => {
  const bancada = bancadaDaPrateleira(dados())!;
  const cx12 = bancada.caixas[2];
  const contexto = { cliente: BTG, posicao: "a-03", rodada: RODADA };

  it("o campo fica com os algarismos; o teto e o fora da lista sem peça têm a frase", () => {
    expect(soAlgarismos(" 4,8 un")).toBe("48");
    expect(soAlgarismos("12345678")).toBe("123456");
    expect(problemaDaQuantidade("100000", false)).toBeNull();
    expect(problemaDaQuantidade("100001", false)).toBe("Até 100.000 un.");
    expect(problemaDaQuantidade("0", false)).toBeNull();
    expect(problemaDaQuantidade("0", true)).toBe("1 un. ou mais");
    expect(problemaDaQuantidade("", true)).toBeNull();
  });

  it("sem contar todos os itens, não há chamada", () => {
    expect(contagemCompleta(cx12, CONTAGEM_EM_BRANCO)).toBe(false);
    expect(entradaDaRecontagem(contexto, cx12, CONTAGEM_EM_BRANCO)).toBeNull();
    const semPeca: ContagemDigitada = { contados: { [M.sku_code]: "48" }, foraDaLista: [{ sku: GG.sku_code, codigo: GG.client_item_code, nome: "GG", contado: "0" }] };
    expect(entradaDaRecontagem(contexto, cx12, semPeca)).toBeNull();
  });

  it("todos os itens da lista com o contado, o fora da lista só quando há, a rodada, e nenhum campo vazio", () => {
    const so: ContagemDigitada = { contados: { [M.sku_code]: "48" }, foraDaLista: [] };
    const entrada = entradaDaRecontagem(contexto, cx12, so)!;
    expect(entrada).toEqual({ customer_code: BTG, box_code: "CX-000012", location_id: "A-03", lines: [{ sku_code: M.sku_code, counted_qty: 48 }], round_id: RODADA });
    expect("extra_lines" in entrada).toBe(false);
    const comFora: ContagemDigitada = { contados: { [M.sku_code]: "48" }, foraDaLista: [{ sku: GG.sku_code, codigo: GG.client_item_code, nome: "GG", contado: "2" }] };
    const completa = entradaDaRecontagem(contexto, cx12, comFora)!;
    expect(completa.extra_lines).toEqual([{ sku_code: GG.sku_code, counted_qty: 2 }]);
    // O SDK do Firebase manda undefined como null, e o servidor recusa null: nenhum campo vazio, em nível nenhum.
    expect(JSON.stringify(completa, (_chave, valor) => (valor === undefined ? "INDEFINIDO" : valor))).not.toContain("INDEFINIDO");
  });

  it("\"Caixa vazia\" zera a lista e tira o fora da lista; confirmar assim esvazia a caixa", () => {
    const vazia = contagemDaCaixaVazia(cx12);
    expect(vazia).toEqual({ contados: { [M.sku_code]: "0" }, foraDaLista: [] });
    expect(contagemVazia(cx12, vazia)).toBe(true);
    expect(entradaDaRecontagem(contexto, cx12, vazia)?.lines).toEqual([{ sku_code: M.sku_code, counted_qty: 0 }]);
    // A caixa sem nada na lista se confirma vazia, sem digitar nada.
    expect(entradaDaRecontagem(contexto, { code: "CX-000020", itens: [] }, CONTAGEM_EM_BRANCO)).toEqual({ customer_code: BTG, box_code: "CX-000020", location_id: "A-03", lines: [], round_id: RODADA });
  });
});

describe("a recontagem gravada e a resposta", () => {
  it("as linhas de cycle_counts viram uma recontagem por chamada, a mais recente primeiro, com a origem da peça a mais", () => {
    const linhas = [
      linhaGravada("cc_1", { box_recount_id: "brc_012", box_code: "CX-000012", out_of_list: true, ...GG, qty_before: 0, counted_qty: 2, adjustment_delta: 2, origins: [{ kind: "loose", qty: 1 }, { kind: "box", box_code: "cx-000014", qty: 1 }] }),
      linhaGravada("cc_2", { box_recount_id: "brc_012", box_code: "CX-000012", ...M, qty_before: 50, counted_qty: 48, adjustment_delta: -2 }),
      linhaGravada("cc_3", { box_recount_id: "brc_010", box_code: "CX-000010", ...P, qty_before: 60, counted_qty: 60, adjustment_delta: 0, occurred_at: "2026-11-17T12:02:00.000Z" }),
      // A cíclica de sempre (sem caixa) e a de outro cliente não entram.
      linhaRecontada("cc_4", { customer_code: BTG, location_id: "A-03", sku_code: M.sku_code, counted_qty: 3 }),
      linhaGravada("cc_5", { customer_code: "Itau", box_recount_id: "brc_x", box_code: "CX-000500", sku_code: "ITAU-1", counted_qty: 1 }),
    ].filter((linha): linha is NonNullable<typeof linha> => linha !== null);
    const recontagens = recontagensDasLinhas(linhas, BTG);
    expect(recontagens.map((item) => [item.id, item.caixa, item.esperado, item.contado, item.diferenca])).toEqual([
      ["brc_012", "CX-000012", 50, 50, 0],
      ["brc_010", "CX-000010", 60, 60, 0],
    ]);
    // A lista primeiro, o fora da lista depois.
    expect(recontagens[0].itens.map((item) => [item.nome, item.foraDaLista])).toEqual([
      ["Polo Masculino Piquet Preto · M", false],
      ["Polo Masculino Piquet Preto · GG", true],
    ]);
    expect(itensComDiferenca(recontagens[0]).map((item) => item.texto)).toEqual(["−2", "+2 · fora da lista · 1 do saldo sem caixa · 1 de CX-000014"]);
    expect(seloDaRecontagem(recontagens[0])).toBe("confirmada 09:11 · 50 · sem diferença");
  });

  it("as três origens da peça a mais", () => {
    expect(textoDaOrigem({ tipo: "solto", qty: 1 }, "A-03")).toBe("1 do saldo sem caixa");
    expect(textoDaOrigem({ tipo: "caixa", caixa: "CX-000014", qty: 2 }, "A-03")).toBe("2 de CX-000014");
    expect(textoDaOrigem({ tipo: "entrada", qty: 3 }, "A-03")).toBe("entrada de 3 em A-03");
  });

  it("a resposta da callable vira a recontagem da caixa, para a bancada mostrar antes da leitura voltar", () => {
    const recontagem = recontagemDaResposta(
      {
        ok: true,
        box_recount_id: "brc_012",
        box_code: "CX-000012",
        location_id: "A-03",
        round_id: RODADA,
        status: "stored",
        lines: [
          { ...M, expected: 50, counted: 48, difference: -2, shelf_delta: -2 },
          { ...GG, out_of_list: true, expected: 0, counted: 2, difference: 2, shelf_delta: 2, origins: [{ kind: "entry", qty: 2 }] },
        ],
      },
      { quem: "Guilherme Dantas", quando: "2026-11-17T12:15:00.000Z" },
    );
    expect(recontagem).toMatchObject({ id: "brc_012", caixa: "CX-000012", posicao: "A-03", rodada: RODADA, esperado: 50, contado: 50, diferenca: 0, vazia: false });
    expect(itensComDiferenca(recontagem).map((item) => item.texto)).toEqual(["−2", "+2 · fora da lista · entrada de 2 em A-03"]);

    const bancada = bancadaDaPrateleira(dados())!;
    const comLocal = comRecontagensLocais(bancada, [recontagem], new Set())!;
    expect(comLocal.caixas[2]).toMatchObject({ code: "CX-000012", estado: "confirmada", ultimaRecontagem: "brc_012" });
    expect(comLocal).toMatchObject({ confirmadas: 1, esperadasConfirmadas: 50, contadasConfirmadas: 50 });
    // Quando a leitura ao vivo traz a mesma recontagem, a local sai.
    expect(comRecontagensLocais(bancada, [recontagem], new Set(["brc_012"]))).toBe(bancada);
    // A vazia sai vazia.
    const vazia = { ...recontagem, contado: 0, vazia: true };
    expect(comRecontagensLocais(bancada, [vazia], new Set())!.caixas[2]).toMatchObject({ estado: "vazia", itens: [] });
  });

  it("depois de confirmar, abre a próxima caixa por contar; sem ela, a primeira por contar; sem nenhuma, nada", () => {
    const bancada = bancadaDaPrateleira(dados({ recontagens: RECONTAGEM_DA_011 }))!;
    expect(proximaPorContar(bancada, "CX-000010")).toBe("CX-000012");
    expect(proximaPorContar(bancada, "CX-000012")).toBe("CX-000010");
    const todas = comRecontagensLocais(bancada, ["CX-000010", "CX-000012"].map((code) => ({ ...RECONTAGEM_DA_011[0], id: `brc_${code}`, caixa: code })), new Set())!;
    expect(proximaPorContar(todas, "CX-000012")).toBeNull();
  });
});

describe("o item fora da lista", () => {
  const ROWS = [
    { id: "BTG-000125", cod_btg: "BTG-000125", cod_cliente: "A.01.0806.005.GG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", customer_code: BTG, barcode: "7891234567890" },
    { id: "BTG-000126", cod_btg: "BTG-000126", cod_cliente: "A.01.0806.005.XG", produto: "Polo Masculino Piquet Preto", tamanho: "XG", customer_code: BTG, status: "archived" },
    { id: "BTG-000300", cod_btg: "BTG-000300", cod_cliente: "B.0572.003.U.B", produto: "Copo Beercup em Inox", customer_code: BTG },
    // O produto sem customer_code é do legado (a BTG); o do Itaú não entra.
    { id: "BTG-000001", cod_btg: "BTG-000001", cod_cliente: "A.02.0001.001.U", produto: "Caneca Térmica" },
    { id: "ITAU-000001", cod_btg: "ITAU-000001", cod_cliente: "I.01", produto: "Polo Itaú", customer_code: "Itau" },
  ];

  it("os produtos do cliente, o arquivado também (o servidor o reativa)", () => {
    expect(produtosDoCliente(ROWS, BTG).map((produto) => produto.sku)).toEqual(["BTG-000001", "BTG-000300", "BTG-000125", "BTG-000126"]);
    expect(produtosDoCliente(ROWS, "")).toEqual([]);
  });

  it("a busca pelo código do cliente, pelo SKU, pelo código de barras ou pelo nome; sem os da caixa", () => {
    const produtos = produtosDoCliente(ROWS, BTG);
    expect(buscarProdutos(produtos, "005.gg", new Set()).map((produto) => produto.sku)).toEqual(["BTG-000125"]);
    expect(buscarProdutos(produtos, "7891234567890", new Set()).map((produto) => produto.sku)).toEqual(["BTG-000125"]);
    expect(buscarProdutos(produtos, "piquet preto", new Set(["BTG-000125"])).map((produto) => produto.nome)).toEqual(["Polo Masculino Piquet Preto · XG"]);
    expect(buscarProdutos(produtos, "termica", new Set()).map((produto) => produto.sku)).toEqual(["BTG-000001"]);
    // O código igual vem antes do que só contém.
    expect(buscarProdutos(produtos, "BTG-000125", new Set())[0].sku).toBe("BTG-000125");
    expect(buscarProdutos(produtos, "  ", new Set())).toEqual([]);
  });
});

describe("a rodada por prateleira", () => {
  const PRATELEIRAS = prateleirasDaContagem({
    cliente: BTG,
    posicoes: POSICOES,
    caixas: [...CAIXAS, caixa("CX-000020", "A-04", { unit_count: 30 }), caixa("CX-000030", "B-09", { unit_count: 16 })],
    abertura: [...ABERTURA, { box_code: "CX-000020", ...GG, counted_qty: 30 }, { box_code: "CX-000030", ...P, counted_qty: 16 }],
    saldos: [...SALDOS, { location_id: "A-04", sku_code: GG.sku_code, qty_on_hand: 30, customer_code: BTG }, { location_id: "B-09", sku_code: P.sku_code, qty_on_hand: 16, customer_code: BTG }],
  });
  const recontada = (code: string, posicaoDaCaixa: string, quando: string, diferenca = 0): Recontagem => ({
    id: `brc_${code}`,
    caixa: code,
    posicao: posicaoDaCaixa,
    rodada: RODADA,
    quando,
    quem: "Guilherme Dantas",
    esperado: 60,
    contado: 60 + diferenca,
    diferenca,
    vazia: false,
    itens: [],
  });

  it("o estado de cada prateleira nesta rodada, o que impede recontá-la e os números da rodada", () => {
    const caixas = [
      ...CAIXAS,
      caixa("CX-000020", "A-04", { unit_count: 30, last_recounted_at: "2026-11-16T18:00:00.000Z", last_recount_round_id: "recontagem-2026-11-16" }),
      caixa("CX-000030", "B-09", { unit_count: 16 }),
    ];
    const rodada = rodadaDaContagem({
      cliente: BTG,
      prateleiras: PRATELEIRAS,
      caixas,
      recontagens: [recontada("CX-000010", "A-03", "2026-11-17T11:10:00.000Z"), recontada("CX-000011", "A-03", "2026-11-17T12:11:00.000Z", -5)],
      guardas: [],
      reservas: [{ sku_code: P.sku_code, location_id: "B-09", status: "picked", order_number: "PED-0002", customer_code: BTG }],
      rodada: RODADA,
      agora: AGORA,
    });
    expect(rodada).toMatchObject({
      titulo: "Recontagem · 17/11/2026",
      comeco: { quando: "2026-11-17T11:10:00.000Z", quem: "Guilherme Dantas" },
      prateleiras: 3,
      prateleirasContadas: 0,
      caixas: 5,
      caixasConfirmadas: 2,
      caixasComDiferenca: 1,
      diferenca: -5,
      continuar: "A-03",
    });
    const [a03, a04] = rodada.ruas[0].prateleiras;
    expect(seloDaPrateleira(a03)).toBe("em contagem · Guilherme Dantas · 2 de 3 caixas");
    expect(a04.estado).toBe("contada_antes");
    expect(seloDaPrateleira(a04)).toBe("contada 16/11");
    const b09 = rodada.ruas[1].prateleiras[0];
    expect(b09.bloqueio).toBe("em separação · PED-0002");
    expect(rodada.ruas.map((rua) => [rua.rua, resumoDaRua(rua)])).toEqual([
      ["A", "2 prateleiras · 1 em contagem"],
      ["B", "1 prateleira · por contar"],
    ]);
  });

  it("a prateleira com todas as caixas confirmadas está contada; sem nenhuma em contagem, continua na primeira por contar livre", () => {
    const rodada = rodadaDaContagem({
      cliente: BTG,
      prateleiras: PRATELEIRAS,
      caixas: [...CAIXAS, caixa("CX-000020", "A-04", { unit_count: 30 }), caixa("CX-000030", "B-09", { unit_count: 16 })],
      recontagens: ["CX-000010", "CX-000011", "CX-000012"].map((code, indice) => recontada(code, "A-03", `2026-11-17T11:4${indice}:00.000Z`, indice === 1 ? -3 : 0)),
      guardas: [{ status: "planned", customer_code: BTG, destination_location_id: "A-04", receipt_number: "AVL-7C21A9F0" }],
      reservas: [],
      rodada: RODADA,
      agora: AGORA,
    });
    const [a03, a04] = rodada.ruas[0].prateleiras;
    expect(seloDaPrateleira(a03)).toBe("contada 08:42 · 1 diferença · −3 un.");
    expect(a04.bloqueio).toBe("guarda aberta · AVL-7C21A9F0");
    // A A-04 tem a guarda aberta: a próxima livre é a B-09.
    expect(rodada.continuar).toBe("B-09");
    expect(rodada.prateleirasContadas).toBe(1);
  });

  it("a recontagem de outra rodada não conta nesta", () => {
    const rodada = rodadaDaContagem({
      cliente: BTG,
      prateleiras: PRATELEIRAS,
      caixas: CAIXAS,
      recontagens: [{ ...recontada("CX-000010", "A-03", "2026-11-16T11:10:00.000Z"), rodada: "recontagem-2026-11-16" }],
      guardas: [],
      reservas: [],
      rodada: RODADA,
      agora: AGORA,
    });
    expect(rodada.caixasConfirmadas).toBe(0);
    expect(rodada.comeco).toBeNull();
  });
});
