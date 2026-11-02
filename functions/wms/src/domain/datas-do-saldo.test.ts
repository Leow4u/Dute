import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Timestamp } from "firebase-admin/firestore";

import {
  chaveDoLocal,
  datasDoSaldo,
  datasLivresPorLocal,
  diaDeSaoPaulo,
  diaLivreMaisAntigo,
  entradasDoRazao,
  ordenarCandidatos,
  precisaDasDatas,
  skusQuePrecisamDasDatas,
  type Abertura,
  type DataDoSaldo,
  type Entrada,
  type ItemDoPedido,
  type SaldoDoLocal,
} from "./datas-do-saldo.js";

/**
 * FIFO por data (docs/plataforma/fifo-por-data.md, parte 4), sem o banco: a
 * conta das datas de cada local (seção 3.1) e a ordem do pedido (seção 3.2).
 * Os casos ficam em datas-do-saldo.casos.json, ao lado do módulo.
 */

// Compilado em functions/wms/lib/domain/datas-do-saldo.test.js; o JSON fica em src.
const CASOS = fileURLToPath(new URL("../../src/domain/datas-do-saldo.casos.json", import.meta.url));

type Casos = {
  dias: { caso: string; instante: unknown; dia: string | null }[];
  contas: { caso: string; saldo: SaldoDoLocal; entradas: Entrada[]; fisicas: DataDoSaldo[]; livres: DataDoSaldo[] }[];
  ordens: { caso: string; candidatos: string[]; datas_livres: Record<string, DataDoSaldo[]>; ordem: string[] }[];
  pedidos: {
    caso: string;
    saldos: { location_id: string; qty_on_hand: number; qty_reserved: number }[];
    entradas: Record<string, Entrada[]>;
    livres: Record<string, DataDoSaldo[]>;
    ordem: string[];
  }[];
  razao: { caso: string; abertura: Abertura; movimentos: unknown[]; entradas: Record<string, Entrada[]> }[];
  leituras: { caso: string; saldos: SaldoDoLocal[]; le: boolean }[];
  skus_lidos: { caso: string; itens: ItemDoPedido[]; saldos: Record<string, SaldoDoLocal[]>; skus: string[] }[];
};

const casos = JSON.parse(readFileSync(CASOS, "utf8")) as Casos;

const soma = (partes: readonly DataDoSaldo[]) => partes.reduce((total, parte) => total + parte.quantidade, 0);

describe("datas do saldo: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.dias.length >= 10);
    assert.ok(casos.contas.length >= 10);
    assert.ok(casos.ordens.length >= 8);
    assert.ok(casos.pedidos.length >= 3);
    assert.ok(casos.razao.length >= 4);
    assert.ok(casos.leituras.length >= 4);
    assert.ok(casos.skus_lidos.length >= 6);
  });

  for (const caso of casos.dias) {
    it(`dia: ${caso.caso}`, () => assert.equal(diaDeSaoPaulo(caso.instante), caso.dia));
  }

  for (const caso of casos.contas) {
    it(`conta: ${caso.caso}`, () => {
      const datas = datasDoSaldo(caso.saldo, caso.entradas);
      assert.deepEqual(datas, { fisicas: caso.fisicas, livres: caso.livres });
      // O total físico fecha sempre com o saldo, e o livre com o saldo sem o reservado.
      const fisico = Math.max(0, Number(caso.saldo.qty_on_hand));
      assert.equal(soma(datas.fisicas), fisico);
      assert.equal(soma(datas.livres), Math.max(0, fisico - Math.max(0, Number(caso.saldo.qty_reserved))));
    });
  }

  for (const caso of casos.ordens) {
    it(`ordem: ${caso.caso}`, () => {
      const candidatos = caso.candidatos.map((location_id) => ({ location_id }));
      const ordem = ordenarCandidatos(candidatos, caso.datas_livres).map((candidato) => candidato.location_id);
      assert.deepEqual(ordem, caso.ordem);
      // O mesmo resultado com o mapa (como o alocador chama) e com os candidatos em outra ordem.
      const mapa = new Map(Object.entries(caso.datas_livres));
      assert.deepEqual(ordenarCandidatos([...candidatos].reverse(), mapa).map((candidato) => candidato.location_id), caso.ordem);
    });
  }

  for (const caso of casos.pedidos) {
    it(`pedido: ${caso.caso}`, () => {
      const livres = datasLivresPorLocal(caso.saldos, caso.entradas);
      assert.deepEqual(Object.fromEntries(livres), caso.livres);
      assert.deepEqual(
        ordenarCandidatos(caso.saldos, livres).map((saldo) => saldo.location_id),
        caso.ordem,
      );
    });
  }

  for (const caso of casos.razao) {
    it(`razão: ${caso.caso}`, () => {
      assert.deepEqual(Object.fromEntries(entradasDoRazao(caso.movimentos, caso.abertura)), caso.entradas);
    });
  }

  for (const caso of casos.leituras) {
    it(`leitura: ${caso.caso}`, () => assert.equal(precisaDasDatas(caso.saldos), caso.le));
  }

  for (const caso of casos.skus_lidos) {
    it(`SKUs cujo razão o pedido lê: ${caso.caso}`, () => {
      assert.deepEqual(skusQuePrecisamDasDatas(caso.itens, caso.saldos), caso.skus);
      // O mesmo com o mapa de saldos por SKU, como o alocador chama.
      assert.deepEqual(skusQuePrecisamDasDatas(caso.itens, new Map(Object.entries(caso.saldos))), caso.skus);
    });
  }

  it("a chave do local é a do alocador: o location_id sem o espaço das pontas, com maiúscula e acento", () => {
    assert.equal(chaveDoLocal(" a-01 "), "a-01");
    assert.notEqual(chaveDoLocal("A-01"), chaveDoLocal("a-01"));
    assert.notEqual(chaveDoLocal("DEVOLUÇÃO"), chaveDoLocal("DEVOLUCAO"));
    assert.equal(chaveDoLocal("A  01"), "A  01");
  });
});

describe("datas do saldo: o instante do Firestore e o que não é data", () => {
  it("o Timestamp do servidor (created_at) vale o dia de São Paulo", () => {
    assert.equal(diaDeSaoPaulo(Timestamp.fromDate(new Date("2026-10-04T01:30:00.000Z"))), "2026-10-03");
    assert.equal(diaDeSaoPaulo(Timestamp.fromDate(new Date("2026-10-04T03:00:00.000Z"))), "2026-10-04");
    assert.equal(diaDeSaoPaulo(new Date("2026-08-05T15:00:00.000Z")), "2026-08-05");
  });

  it("instante inválido, infinito ou que falha ao ler fica sem data, sem lançar erro", () => {
    assert.equal(diaDeSaoPaulo(new Date("ontem")), null);
    assert.equal(diaDeSaoPaulo(Number.POSITIVE_INFINITY), null);
    assert.equal(diaDeSaoPaulo(Number.NaN), null);
    assert.equal(diaDeSaoPaulo({ toDate: () => { throw new Error("quebrado"); } }), null);
    assert.equal(diaDeSaoPaulo({ toDate: () => "2026-08-05" }), null);
    assert.equal(diaDeSaoPaulo({ toMillis: () => "abc" }), null);
    assert.equal(diaDeSaoPaulo(Symbol("instante")), null);
    assert.equal(diaDeSaoPaulo(8.64e15 + 1), null);
  });
});

describe("datas do saldo: nunca lança erro", () => {
  it("entradas, saldos, candidatos e movimentos estranhos dão um resultado vazio ou sem data", () => {
    const estranho = null as unknown as never;
    assert.deepEqual(datasDoSaldo(estranho, estranho), { fisicas: [], livres: [] });
    assert.deepEqual(
      datasDoSaldo({ qty_on_hand: 5, qty_reserved: {} }, [null, undefined, 5, "x", { dia: 20260805, quantidade: 3 }] as unknown as Entrada[]),
      { fisicas: [{ dia: null, quantidade: 5 }], livres: [{ dia: null, quantidade: 5 }] },
    );
    assert.equal(diaLivreMaisAntigo(estranho), null);
    assert.deepEqual(ordenarCandidatos(estranho, estranho), []);
    assert.deepEqual(ordenarCandidatos([null, { location_id: 7 }, {}], {}), [null, {}, { location_id: 7 }]);
    assert.deepEqual([...datasLivresPorLocal(estranho, estranho)], []);
    assert.deepEqual([...entradasDoRazao(estranho, estranho)], []);
    assert.equal(precisaDasDatas(estranho), false);
    assert.deepEqual(skusQuePrecisamDasDatas(estranho, estranho), []);
    assert.deepEqual(skusQuePrecisamDasDatas([null, 5, { sku_code: {} }, { sku_code: "S" }] as never, { S: null, X: 5 } as never), []);
    assert.equal(chaveDoLocal(undefined), "");
  });

  it("o total físico fecha com o saldo e o livre com o saldo sem o reservado, em qualquer combinação", () => {
    const dias = ["2026-08-05", "2026-09-20", "2026-10-03", null];
    for (const fisico of [0, 1, 7, 30, 120, 301]) {
      for (const reservado of [0, 1, 6, 30, 500]) {
        for (let tamanho = 0; tamanho <= 4; tamanho += 1) {
          const entradas = Array.from({ length: tamanho }, (_, i) => ({ dia: dias[(i * 3 + fisico) % dias.length]!, quantidade: (i + 1) * 13 }));
          const datas = datasDoSaldo({ qty_on_hand: fisico, qty_reserved: reservado }, entradas);
          assert.equal(soma(datas.fisicas), fisico);
          assert.equal(soma(datas.livres), Math.max(0, fisico - reservado));
          // Do mais antigo ao mais novo, um por dia, o sem data primeiro.
          const ordem = datas.fisicas.map((parte) => parte.dia ?? "");
          assert.deepEqual(ordem, [...new Set(ordem)].sort());
        }
      }
    }
  });
});
