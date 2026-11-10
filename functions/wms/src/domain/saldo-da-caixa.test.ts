import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  conferirCaixasInformadas,
  ordemDeSaida,
  retiradoCom,
  saldoDaCaixa,
  sugerirCaixas,
  unidadesDaCaixa,
  type CaixaComOItem,
  type CaixasDaLinha,
  type LinhaDaCaixa,
} from "./saldo-da-caixa.js";

/**
 * O saldo da caixa (separação com caixas, parte 3), sem o banco: cópia
 * literal de lib/dominio/src/saldo-da-caixa.ts (as Functions não importam
 * lib/dominio). Roda os mesmos casos de
 * lib/dominio/src/saldo-da-caixa.casos.json que o vitest do app roda contra o
 * original, e a trava confere que a cópia é idêntica (o padrão de
 * areas-de-passagem.test.ts).
 */

// Compilado em functions/wms/lib/domain/saldo-da-caixa.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/saldo-da-caixa.ts";
const COPIA = "../../src/domain/saldo-da-caixa.ts";
const CASOS = "../../../../lib/dominio/src/saldo-da-caixa.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/saldo-da-caixa\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type Casos = {
  saldos: { caso: string; entrada: unknown[]; retirado: unknown[]; saldo: LinhaDaCaixa[]; unidades: number }[];
  retirados: { caso: string; retirado: LinhaDaCaixa[]; sku_code: string; qty: number; resultado: LinhaDaCaixa[] }[];
  sugestoes: { caso: string; pedido: number; caixas: CaixaComOItem[]; resultado: CaixasDaLinha }[];
  informadas: { caso: string; pedido: number; informadas: { box_code: string; qty: number }[]; caixas: CaixaComOItem[]; resultado: CaixasDaLinha | { problema: string } }[];
};

const casos = JSON.parse(read(CASOS)) as Casos;

describe("saldo da caixa no WMS: a cópia é a de lib/dominio", () => {
  it("functions/wms/src/domain/saldo-da-caixa.ts é idêntico a lib/dominio/src/saldo-da-caixa.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/saldo-da-caixa.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/saldo-da-caixa.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/saldo-da-caixa.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/parados.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/saldo-da-caixa.ts\n`), original);
  });
});

describe("saldo da caixa no WMS: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.saldos.length >= 5);
    assert.ok(casos.sugestoes.length >= 8);
    assert.ok(casos.informadas.length >= 8);
  });

  for (const caso of casos.saldos) {
    it(`saldo: ${caso.caso}`, () => {
      const saldo = saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[]);
      assert.deepEqual(saldo, caso.saldo);
      assert.equal(unidadesDaCaixa(saldo), caso.unidades);
    });
  }
  for (const caso of casos.retirados) {
    it(`retirado: ${caso.caso}`, () => assert.deepEqual(retiradoCom(caso.retirado, caso.sku_code, caso.qty), caso.resultado));
  }
  for (const caso of casos.sugestoes) {
    it(`sugestão: ${caso.caso}`, () => assert.deepEqual(sugerirCaixas(caso.pedido, caso.caixas), caso.resultado));
  }
  for (const caso of casos.informadas) {
    it(`outra caixa: ${caso.caso}`, () => assert.deepEqual(conferirCaixasInformadas(caso.pedido, caso.informadas, caso.caixas), caso.resultado));
  }

  it("a ordem de saída não muda a lista que recebeu", () => {
    const caixas = [
      { code: "CX-000002", stored_at: "2026-10-22T13:00:00.000Z" },
      { code: "CX-000001", stored_at: "2026-10-22T13:00:00.000Z" },
    ];
    assert.deepEqual(ordemDeSaida(caixas).map((caixa) => caixa.code), ["CX-000001", "CX-000002"]);
    assert.deepEqual(caixas.map((caixa) => caixa.code), ["CX-000002", "CX-000001"]);
  });
});
