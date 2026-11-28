// A regra da ferramenta, sem banco. As contas da cobrança são as do WMS
// (functions/wms/lib, compilado pelo build); os números esperados saem à mão.
//
//   node --test "tools/tirar-chegada-da-cobranca/*.test.mjs"

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CASO } from "./caso.mjs";
import {
  comMarca,
  diferenca,
  entradaDaPrevia,
  eventoDaRetirada,
  marcaDoMovimento,
  movimentosDaChegada,
  recusas,
  tabelaDoCliente,
} from "./regras.mjs";
import { WMS } from "./wms.mjs";

const BTG = "BTG Pactual";

/** A chegada repetida como `inbound_receipts` a guarda (a chegada avulsa por caixa). */
const RECEBIMENTO = {
  id: "inb_avulso_0c4d2e7fb1fe59a8",
  customer_code: BTG,
  receipt_number: "AVL-B1FE59A8",
  invoice_number: "046143",
  conference_mode: "per_box",
  status: "received",
  source: "wms_unplanned_receipt",
};

/** O movimento como `createMovement` (functions/wms/src/domain/operations.ts) o grava. */
function movimento(id, campos) {
  const tipo = campos.tipo_mov ?? "ENTRADA";
  const sinal = tipo === "ENTRADA" ? 1 : -1;
  const qtde = campos.qtde;
  return {
    id,
    data: campos.occurred_at,
    occurred_at: campos.occurred_at,
    type: tipo === "ENTRADA" ? "inventory.received" : "inventory.shipped",
    tipo_mov: tipo,
    sign: sinal,
    sinal,
    quantity: qtde,
    qtde,
    customer_code: campos.customer_code ?? BTG,
    cod_cliente: campos.customer_code ?? BTG,
    sku_code: campos.sku_code,
    cod_sku: campos.sku_code,
    client_item_code: campos.client_item_code,
    product_name: "Polo Masculino Piquet Preto",
    produto: "Polo Masculino Piquet Preto",
    location_id: campos.location_id ?? "RECEBIMENTO",
    qty_before: 0,
    estoque_anterior: 0,
    qty_after: qtde,
    estoque_resultante: qtde,
    saldo_delta: sinal * qtde,
    source: campos.source,
    actor: { uid: "op1", role: "wms", name: "Operação" },
    ...(campos.extra ?? {}),
  };
}

/** A ENTRADA da chegada leva o número dela; a guarda da caixa, só o id. */
const entradaDaRepetida = (item) => ({ receipt_id: RECEBIMENTO.id, receipt_number: RECEBIMENTO.receipt_number, inbound_item_id: item, destino: "RECEBIMENTO" });
const guardaDaCaixa = (kind, destino) => ({ putaway_task_id: "put_cx227", box_code: "CX-000227", receipt_id: RECEBIMENTO.id, origem: "RECEBIMENTO", destino, movement_kind: kind });

/**
 * Novembro da BTG: a chegada repetida (GG 30 e XGG 41, mais a guarda da caixa),
 * a de 30/10 que ela repetiu (outubro), outra chegada de novembro (12), a
 * entrega do PED-0001 (100), o ajuste do acerto (fora da cobrança) e uma
 * entrada de outro cliente.
 */
function novembro() {
  return [
    movimento("a1", { source: "wms_receiving", sku_code: "BTG-000090", client_item_code: "A.01.0806.005.GG", qtde: 30, occurred_at: "2026-11-06T17:10:00.000Z", extra: entradaDaRepetida("inbi_1") }),
    movimento("a2", { source: "wms_receiving", sku_code: "BTG-000181", client_item_code: "A.01.0806.005.XGG", qtde: 41, occurred_at: "2026-11-06T17:10:00.000Z", extra: entradaDaRepetida("inbi_2") }),
    movimento("g1", { source: "wms_putaway", tipo_mov: "SAIDA", sku_code: "BTG-000090", qtde: 30, occurred_at: "2026-11-06T18:00:00.000Z", extra: guardaDaCaixa("putaway_transfer_out", "B-02") }),
    movimento("g2", { source: "wms_putaway", sku_code: "BTG-000090", qtde: 30, location_id: "B-02", occurred_at: "2026-11-06T18:00:00.000Z", extra: guardaDaCaixa("putaway_transfer_in", "B-02") }),
    movimento("o1", { source: "wms_receiving", sku_code: "BTG-000090", qtde: 30, location_id: "B-02", occurred_at: "2026-10-30T15:00:00.000Z", extra: { receipt_id: "inb_avulso_77aa0d0e620b", receipt_number: "AVL-0D0E620B" } }),
    movimento("r1", { source: "wms_receiving", sku_code: "BTG-000186", qtde: 12, occurred_at: "2026-11-05T14:00:00.000Z", extra: { receipt_id: "inb_avulso_9938450703", receipt_number: "AVL-38450703" } }),
    movimento("s1", { source: "wms_shipping", tipo_mov: "SAIDA", sku_code: "BTG-000090", qtde: 100, location_id: "B-02", occurred_at: "2026-11-16T23:25:00.000Z", extra: { order_number: "PED-0001" } }),
    movimento("j1", { source: "functions_inventory_movement", tipo_mov: "SAIDA", sku_code: "BTG-000090", qtde: 30, location_id: "B-02", occurred_at: "2026-11-16T20:00:00.000Z" }),
    movimento("x1", { customer_code: "Safra", source: "wms_receiving", sku_code: "SAF-000001", qtde: 50, occurred_at: "2026-11-10T13:00:00.000Z", extra: { receipt_id: "inb_avulso_55safra", receipt_number: "AVL-55SAFRA0" } }),
  ];
}

const ids = (lista) => lista.map((m) => m.id);
const trocar = (lista, id, campos) => lista.map((m) => (m.id === id ? { ...m, ...campos } : m));
const achar = (movimentos = novembro()) => movimentosDaChegada(movimentos, CASO, RECEBIMENTO, WMS);

describe("as entradas da chegada", () => {
  it("pega só o recebimento da chegada no mês; a guarda da caixa não se cobra", () => {
    const achados = achar();
    assert.deepEqual(ids(achados.cobrados), ["a1", "a2"]);
    assert.deepEqual(ids(achados.semCobranca), ["g1", "g2"]);
    assert.deepEqual(ids(achados.jaFora), []);
    assert.deepEqual(ids(achados.foraDoMes), []);
  });

  it("a entrada já fora da cobrança não volta a ser tirada", () => {
    const achados = achar(trocar(novembro(), "a1", { billable: false }));
    assert.deepEqual(ids(achados.cobrados), ["a2"]);
    assert.deepEqual(ids(achados.jaFora), ["a1"]);
  });

  it("o mês é o de São Paulo: 23h30 de 30/11 é novembro, 00h30 de 01/12 é dezembro", () => {
    const tarde = achar(trocar(novembro(), "a2", { occurred_at: "2026-12-01T02:30:00.000Z", data: "2026-12-01T02:30:00.000Z" }));
    assert.deepEqual(ids(tarde.cobrados), ["a1", "a2"]);
    const virou = achar(trocar(novembro(), "a2", { occurred_at: "2026-12-01T03:30:00.000Z", data: "2026-12-01T03:30:00.000Z" }));
    assert.deepEqual(ids(virou.cobrados), ["a1"]);
    assert.deepEqual(ids(virou.foraDoMes), ["a2"]);
  });
});

describe("as recusas", () => {
  const limpo = { recebimento: RECEBIMENTO, periodo: null, foto: null };

  it("nenhuma com a chegada como o caso descreve, o mês aberto e sem a foto do uso", () => {
    assert.deepEqual(recusas({ caso: CASO, achados: achar(), ...limpo }), []);
    assert.deepEqual(recusas({ caso: CASO, achados: achar(), ...limpo, periodo: { status: "aberto", competencia: "2026-11" } }), []);
  });

  it("outra conta de peças recusa", () => {
    const [recusa, ...resto] = recusas({ caso: CASO, achados: achar(trocar(novembro(), "a2", { qtde: 40, quantity: 40 })), ...limpo });
    assert.equal(resto.length, 0);
    assert.match(recusa, /70 peças/);
    assert.match(recusa, /71/);
  });

  it("sem a chegada, ou com outra NF, recusa", () => {
    const [semChegada] = recusas({ caso: CASO, achados: achar([]), ...limpo, recebimento: null });
    assert.match(semChegada, /AVL-B1FE59A8/);
    const [outraNf] = recusas({ caso: CASO, achados: achar(), ...limpo, recebimento: { ...RECEBIMENTO, invoice_number: "046144" } });
    assert.match(outraNf, /046144/);
  });

  it("sem entrada da chegada no mês, recusa", () => {
    const semAsEntradas = novembro().filter((m) => !["a1", "a2"].includes(m.id));
    const [recusa] = recusas({ caso: CASO, achados: achar(semAsEntradas), ...limpo });
    assert.match(recusa, /AVL-B1FE59A8/);
  });

  it("a entrada da chegada em outro mês recusa", () => {
    const achados = achar(trocar(novembro(), "a2", { occurred_at: "2026-12-02T13:00:00.000Z", data: "2026-12-02T13:00:00.000Z" }));
    assert.ok(recusas({ caso: CASO, achados, ...limpo }).some((recusa) => /fora de 11\/2026/.test(recusa)));
  });

  it("a competência emitida recusa: a fatura emitida não muda", () => {
    const periodo = { status: "emitido", competencia: "2026-11", emitido_em: "2026-12-01T12:00:00.000Z", invoice_snapshot: { total_cents: 1 } };
    const [recusa] = recusas({ caso: CASO, achados: achar(), ...limpo, periodo });
    assert.match(recusa, /emitida/);
  });

  it("o uso já congelado recusa: marcar o movimento não muda mais a cobrança", () => {
    const [recusa] = recusas({ caso: CASO, achados: achar(), ...limpo, foto: { mode: "frozen", usage: { entradas_pecas: 83 } } });
    assert.match(recusa, /congelad/);
  });
});

/** Os documentos que a prévia do WMS lê, como o Firestore devolve (id do documento e dados). */
function leitura(movimentos = novembro()) {
  return {
    competencia: "2026-11",
    cliente: BTG,
    clientePadrao: BTG,
    precos: [
      { id: "btg_1", data: { id: 1, customer_code: BTG, grupo: "Armazenagem", item: "Ad valorem", valor_unit: 0, auto_source: "ad_valorem", ordem: 1 } },
      { id: "btg_2", data: { id: 2, customer_code: BTG, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 0.35, auto_source: "mov_entrada_pecas", ordem: 2 } },
      { id: "btg_3", data: { id: 3, customer_code: BTG, grupo: "Movimentação", item: "Saída por peça", valor_unit: 0.45, auto_source: "mov_saida_pecas", ordem: 3 } },
      // Sem cliente: vale para a BTG.
      { id: "btg_4", data: { id: 4, grupo: "Movimentação", item: "Movimento", valor_unit: 2, auto_source: "mov_count", ordem: 4 } },
      { id: "btg_5", data: { id: 5, customer_code: BTG, grupo: "Armazenagem", item: "Posição", unidade: "posição", valor_unit: 100, auto_source: null, ordem: 5 } },
      { id: "btg_6", data: { id: 6, customer_code: BTG, grupo: "Serviços", item: "Inativo", valor_unit: 99, auto_source: "mov_count", ordem: 6, ativo: false } },
      { id: "safra_1", data: { id: 7, customer_code: "Safra", grupo: "Movimentação", item: "Entrada por peça", valor_unit: 9, auto_source: "mov_entrada_pecas", ordem: 1 } },
    ],
    tabelas: [],
    manual: { items: [{ price_list_id: 5, qtde: 3 }] },
    config: { ad_valorem_rate: 0.004 },
    estoque: [{ customer_code: BTG, sku_code: "BTG-000090", qty_on_hand: 100 }],
    precosDoCatalogo: [{ customer_code: BTG, sku_code: "BTG-000090", preco_unit: 25 }],
    movimentos,
  };
}

const marcados = () => comMarca(novembro(), ["a1", "a2"], marcaDoMovimento(CASO, "op_x"));

describe("a prévia de novembro, antes e depois", () => {
  it("o uso do mês conta o recebimento e a entrega do cliente, como o WMS", () => {
    const { usage } = entradaDaPrevia(leitura(), WMS);
    assert.deepEqual(usage, { custo_estoque: 2500, entradas_pecas: 83, saidas_pecas: 100, movimentacoes: 4 });
  });

  it("com a marca, a chegada repetida sai do uso: 71 peças e 2 movimentos", () => {
    const { usage } = entradaDaPrevia(leitura(marcados()), WMS);
    assert.deepEqual(usage, { custo_estoque: 2500, entradas_pecas: 12, saidas_pecas: 100, movimentacoes: 2 });
  });

  it("as linhas que mudam e o total, à mão", () => {
    const antes = WMS.calculateBillingPeriod(entradaDaPrevia(leitura(), WMS));
    const depois = WMS.calculateBillingPeriod(entradaDaPrevia(leitura(marcados()), WMS));
    // Ad valorem 2500 × 0,004 = 10,00; entradas 83 × 0,35 = 29,05; saídas 100 × 0,45 = 45,00;
    // movimentos 4 × 2 = 8,00; posição 3 × 100 = 300,00. Depois: entradas 12 × 0,35 = 4,20 e movimentos 2 × 2 = 4,00.
    assert.deepEqual(diferenca(antes, depois), {
      linhas: [
        { price_list_id: 2, item: "Entrada por peça", antes: { qtde: 83, valor_unit: 0.35, total_cents: 2905 }, depois: { qtde: 12, valor_unit: 0.35, total_cents: 420 } },
        { price_list_id: 4, item: "Movimento", antes: { qtde: 4, valor_unit: 2, total_cents: 800 }, depois: { qtde: 2, valor_unit: 2, total_cents: 400 } },
      ],
      total_antes_cents: 39205,
      total_depois_cents: 36320,
      delta_cents: -2885,
    });
  });

  it("o item ligado ao Comercial tira o preço da tabela vigente no último dia do mês", () => {
    const dados = leitura();
    dados.precos[1] = { ...dados.precos[1], data: { ...dados.precos[1].data, lpu_item_id: "entrada_peca" } };
    dados.tabelas = [
      { id: "tab_out", data: { customer_code: BTG, vigente_de: "2026-10-01", vigente_ate: "2026-11-15", precos: { entrada_peca: { preco: "0.30" } } } },
      { id: "tab_nov", data: { customer_code: BTG, vigente_de: "2026-11-16", vigente_ate: null, precos: { entrada_peca: { preco: "0.40" } } } },
    ];
    const linha = WMS.calculateBillingPeriod(entradaDaPrevia(dados, WMS)).linhas.find((l) => l.price_list_id === 2);
    assert.deepEqual([linha.qtde, linha.valor_unit, linha.total_cents, linha.tabela_id], [83, 0.4, 3320, "tab_nov"]);
  });

  it("a Tabela de preços do cliente traz o item sem cliente e o inativo, e não o de outro cliente", () => {
    const itens = tabelaDoCliente(leitura(), WMS).map((item) => [item.id, item.auto_source, item.ativo]);
    assert.deepEqual(itens, [
      [1, "ad_valorem", true],
      [2, "mov_entrada_pecas", true],
      [3, "mov_saida_pecas", true],
      [4, "mov_count", true],
      [5, null, true],
      [6, "mov_count", false],
    ]);
  });

  it("o item ligado sem preço numa tabela vigente recusa, como a prévia do WMS", () => {
    const dados = leitura();
    dados.precos[1] = { ...dados.precos[1], data: { ...dados.precos[1].data, lpu_item_id: "entrada_peca" } };
    assert.throws(() => entradaDaPrevia(dados, WMS), /Entrada por peça não tem preço numa tabela do Comercial vigente em 30\/11\/2026/);
  });
});

describe("o que a gravação deixa", () => {
  it("o evento é de faturamento, da competência e do cliente, e não leva valor", () => {
    const evento = eventoDaRetirada(CASO, achar(), "op_x");
    // `billing.*`: o financeiro lê o evento de faturamento (firestore.rules, isBillingEventType).
    assert.match(evento.type, /^billing\./);
    assert.deepEqual([evento.entity_type, evento.entity_id, evento.customer_code], ["fatura", "2026-11", BTG]);
    assert.equal(evento.payload.pecas, 71);
    assert.deepEqual(evento.payload.movimentos.map((m) => [m.id, m.qtde]), [["a1", 30], ["a2", 41]]);
    // interno, wms e suporte leem os eventos e não o faturamento.
    assert.doesNotMatch(JSON.stringify(evento), /R\$/);
    const chaves = [];
    const coletar = (valor) => {
      if (!valor || typeof valor !== "object") return;
      for (const [chave, dentro] of Object.entries(valor)) {
        chaves.push(chave);
        coletar(dentro);
      }
    };
    coletar(evento);
    const dinheiro = new Set(["valor", "valores", "total", "preco", "precos", "price", "cents", "custo", "cost"]);
    assert.deepEqual(chaves.filter((chave) => chave.toLowerCase().split("_").some((parte) => dinheiro.has(parte))), []);
  });
});
