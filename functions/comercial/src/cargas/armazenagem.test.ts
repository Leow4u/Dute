import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BILLING_PERIODS,
  BILLING_PRICE_LIST,
  CLIENTE_DO_ID_ANTIGO,
  ErroDaArmazenagem,
  competenciasAEmitir,
  itensDaCobranca,
  lerArgumentos,
  planejarExportacao,
  planejarLigacao,
  precoDoNumero,
  tabelaDaArmazenagemLida,
} from "./armazenagem.js";
import { lerTabelaCsv } from "./tabela.js";

/** Levar a LPU de cobrança do WMS ao Comercial (parte 7.3b). Dados sintéticos. */

const wms = (caminho: string) => readFileSync(fileURLToPath(new URL(`../../../wms/src/${caminho}`, import.meta.url)), "utf8");

const BTG = "BTG Pactual";
const LPU = [
  { id: "btg_1", dados: { id: 1, customer_code: BTG, grupo: "Armazenagem", item: "Ad valorem", valor_unit: 0, auto_source: "ad_valorem" } },
  { id: "btg_2", dados: { id: 2, customer_code: BTG, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1.25, auto_source: "mov_entrada_pecas" } },
  { id: "btg_4", dados: { id: 4, grupo: "Movimentação", item: "Movimento", valor_unit: 0.5, auto_source: "mov_count" } },
  { id: "btg_7", dados: { id: 7, customer_code: BTG, grupo: "Serviços", item: "Hora  extra", unidade: "h", valor_unit: 3.333 } },
  { id: "btg_8", dados: { id: 8, customer_code: BTG, grupo: "Serviços", item: "Inativo", valor_unit: 99, ativo: false } },
  { id: "safra_1", dados: { id: 1, customer_code: "Banco Safra", grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1 } },
];

describe("levar a cobrança do WMS ao Comercial", () => {
  it("as cópias do WMS são literais", () => {
    const indice = wms("index.ts");
    assert.match(indice, new RegExp(`\\n  billingPriceList: "${BILLING_PRICE_LIST}",\\n`));
    assert.match(indice, new RegExp(`\\n  periods: "${BILLING_PERIODS}",\\n`));
    assert.match(wms("domain/billing-scope.ts"), new RegExp(`export const LEGACY_BILLING_CUSTOMER = "${CLIENTE_DO_ID_ANTIGO}";`));
    assert.match(wms("billing.ts"), /adValorem: "ad_valorem",/);
  });

  it("lê os argumentos: um modo, o cliente, o projeto e a tabela do --ligar", () => {
    assert.deepEqual(lerArgumentos(["--cliente", BTG, "--projeto", "dute-homolog", "--exportar"]), { modo: "exportar", cliente: BTG, projeto: "dute-homolog", tabela: null, executar: false, por: null });
    assert.equal(lerArgumentos(["--ligar", "--tabela", "pt_0123456789abcdef", "--cliente", BTG, "--projeto", "dute-homolog", "--executar"]).executar, true);
    for (const [argv, mensagem] of [
      [["--cliente", BTG, "--projeto", "dute-homolog"], /--exportar ou --ligar/],
      [["--cliente", BTG, "--projeto", "dute-homolog", "--ligar"], /exige --tabela/],
      [["--cliente", BTG, "--exportar"], /Falta --projeto/],
      [["--cliente", BTG, "--projeto", "dute-homolog", "--exportar", "--executar"], /só lê/],
      [["--cliente", "a/b", "--projeto", "dute-homolog", "--exportar"], /barra/],
    ] as Array<[string[], RegExp]>) {
      assert.throws(() => lerArgumentos(argv), (erro: unknown) => erro instanceof ErroDaArmazenagem && mensagem.test(erro.message), argv.join(" "));
    }
  });

  it("o preço do WMS vira texto decimal exato, até 4 casas", () => {
    assert.deepEqual([1.25, 2.1, 3.333, 15, 0.5, 0].map(precoDoNumero), ["1.25", "2.1", "3.333", "15", "0.5", "0"]);
    assert.deepEqual([0.12345, -1, Number.NaN, 1e-7].map(precoDoNumero), [null, null, null, null]);
  });

  it("os itens são os ativos do cliente, sem o ad valorem; o sem cliente é da BTG", () => {
    const itens = itensDaCobranca(BTG, LPU);
    assert.deepEqual(itens.map((item) => [item.id, item.item, item.grupo, item.unidade, item.preco]), [
      ["2", "Entrada por peça", "Movimentação", "UN", "1.25"],
      ["4", "Movimento", "Movimentação", "UN", "0.5"],
      ["7", "Hora extra", "Serviços", "h", "3.333"],
    ]);
    assert.deepEqual(itensDaCobranca("Banco Safra", LPU).map((item) => item.doc_id), ["safra_1"]);
  });

  it("o CSV exportado é o da carga de tabela, com o código WMS- e a categoria Armazenagem", () => {
    const plano = planejarExportacao(itensDaCobranca(BTG, LPU));
    assert.deepEqual(plano.erros, []);
    const lido = lerTabelaCsv(new TextEncoder().encode(plano.linhas.join("\n")));
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.itens.map((item) => [item.codigo, item.categoria, item.servico, item.preco, item.orcavel]), [
      ["WMS-2", "Armazenagem", "Movimentação", "1.25", false],
      ["WMS-4", "Armazenagem", "Movimentação", "0.5", false],
      ["WMS-7", "Armazenagem", "Serviços", "3.333", false],
    ]);
    assert.match(planejarExportacao([{ id: "9", doc_id: "x", item: "Caro", grupo: "G", unidade: "UN", preco: null, lpu_item_id: null }]).erros[0], /4 casas/);
    assert.match(planejarExportacao([]).erros[0], /não tem item ativo/);
  });

  const TABELA = (extra: Record<string, unknown> = {}) =>
    tabelaDaArmazenagemLida("pt_aaaa0000", {
      customer_code: BTG,
      variante: "Armazenagem",
      vigente_de: "2026-09-01",
      vigente_ate: null,
      precos: {
        lpu_entrada: { codigo: "WMS-2", preco: "1.2500" },
        lpu_mov: { codigo: "WMS-4", preco: "0.5" },
        lpu_hora: { codigo: "WMS-7", preco: "3.333" },
      },
      ...extra,
    });

  it("liga cada item ao da tabela do mesmo código, com o mesmo valor (1.25 é 1.2500)", () => {
    const plano = planejarLigacao(BTG, TABELA(), itensDaCobranca(BTG, LPU), ["2026-09", "2026-10"]);
    assert.deepEqual(plano.erros, []);
    assert.deepEqual(plano.ligar.map((ligacao) => [ligacao.doc_id, ligacao.lpu_item_id]), [["btg_2", "lpu_entrada"], ["btg_4", "lpu_mov"], ["btg_7", "lpu_hora"]]);
    const jaLigado = LPU.map((doc) => (doc.id === "btg_2" ? { ...doc, dados: { ...doc.dados, lpu_item_id: "lpu_entrada" } } : doc));
    const deNovo = planejarLigacao(BTG, TABELA(), itensDaCobranca(BTG, jaLigado), ["2026-10"]);
    assert.deepEqual([deNovo.ligar.length, deNovo.ja_ligados], [2, 1]);
  });

  it("recusa o outro cliente, a outra variante, o item fora da tabela, o preço diferente e o já ligado a outro item", () => {
    const itens = itensDaCobranca(BTG, LPU);
    assert.match(planejarLigacao(BTG, TABELA({ customer_code: "Banco Safra" }), itens, []).erros.join(" "), /é de Banco Safra, não de BTG Pactual/);
    assert.match(planejarLigacao(BTG, TABELA({ variante: "Comercial" }), itens, []).erros.join(" "), /variante Comercial/);
    const semHora = TABELA({ precos: { lpu_entrada: { codigo: "WMS-2", preco: "1.25" }, lpu_mov: { codigo: "WMS-4", preco: "0.5" } } });
    assert.match(planejarLigacao(BTG, semHora, itens, []).erros.join(" "), /Hora extra \(WMS-7\) não está na tabela/);
    const outroPreco = TABELA({ precos: { lpu_entrada: { codigo: "WMS-2", preco: "1.30" }, lpu_mov: { codigo: "WMS-4", preco: "0.5" }, lpu_hora: { codigo: "WMS-7", preco: "3.333" } } });
    assert.match(planejarLigacao(BTG, outroPreco, itens, []).erros.join(" "), /no WMS \(1\.25\) não é o da tabela \(1\.30\)/);
    const ligadoAOutro = itensDaCobranca(BTG, LPU.map((doc) => (doc.id === "btg_2" ? { ...doc, dados: { ...doc.dados, lpu_item_id: "lpu_velho" } } : doc)));
    assert.match(planejarLigacao(BTG, TABELA(), ligadoAOutro, []).erros.join(" "), /já está ligado a outro item do catálogo \(lpu_velho\)/);
  });

  it("a tabela tem de valer em toda competência que ainda se emite", () => {
    const desdeOutubro = TABELA({ vigente_de: "2026-10-01" });
    const erros = planejarLigacao(BTG, desdeOutubro, itensDaCobranca(BTG, LPU), ["2026-09", "2026-10"]).erros;
    assert.equal(erros.length, 1);
    assert.match(erros[0], /não cobre a competência 09\/2026, que ainda se emite/);
    assert.deepEqual(planejarLigacao(BTG, desdeOutubro, itensDaCobranca(BTG, LPU), ["2026-10"]).erros, []);
  });

  it("as competências que ainda se emitem: a anterior e a atual sem emitir, e as abertas", () => {
    const agora = new Date("2026-10-23T15:00:00.000Z");
    assert.deepEqual(competenciasAEmitir(agora, []), ["2026-09", "2026-10"]);
    assert.deepEqual(competenciasAEmitir(agora, [{ competencia: "2026-09", status: "emitido" }]), ["2026-10"]);
    assert.deepEqual(competenciasAEmitir(agora, [{ competencia: "2026-07", status: "aberto" }, { competencia: "2026-09", status: "pago" }]), ["2026-07", "2026-10"]);
    // 01/11 às 01h em UTC ainda é 31/10 em São Paulo.
    assert.deepEqual(competenciasAEmitir(new Date("2026-11-01T01:00:00.000Z"), []), ["2026-09", "2026-10"]);
  });
});
