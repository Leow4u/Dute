import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AREAS_DE_PASSAGEM,
  areaDePassagem,
  livreParaOCliente,
  problemaDoLocalDoPedido,
  type SaldoDoLocal,
} from "./areas-de-passagem.js";

/**
 * Só prateleira para o cliente (recebimento com caixas, decisão 10 e parte 7),
 * sem o banco: cópia literal de lib/dominio/src/areas-de-passagem.ts (as
 * Functions não importam lib/dominio). Roda os mesmos casos de
 * lib/dominio/src/areas-de-passagem.casos.json que o vitest do app roda contra
 * o original, e a trava confere que a cópia é idêntica (o padrão de
 * parados.test.ts do núcleo).
 */

// Compilado em functions/wms/lib/domain/areas-de-passagem.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/areas-de-passagem.ts";
const COPIA = "../../src/domain/areas-de-passagem.ts";
const CASOS = "../../../../lib/dominio/src/areas-de-passagem.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/areas-de-passagem\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type Casos = {
  areas: { caso: string; local: unknown; area: string | null }[];
  problemas: { caso: string; local: unknown; problema: string | null }[];
  livres: { caso: string; saldos: SaldoDoLocal[]; livre: { qty_available: number; qty_receiving: number } }[];
};

const casos = JSON.parse(read(CASOS)) as Casos;

describe("áreas de passagem no WMS: a cópia é a de lib/dominio", () => {
  it("functions/wms/src/domain/areas-de-passagem.ts é idêntico a lib/dominio/src/areas-de-passagem.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/areas-de-passagem.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/areas-de-passagem.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/areas-de-passagem.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/parados.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/areas-de-passagem.ts\n`), original);
  });
});

describe("áreas de passagem no WMS: casos de referência", () => {
  it("as áreas são o RECEBIMENTO e a EXPEDICAO, e o JSON de casos foi lido", () => {
    assert.deepEqual([...AREAS_DE_PASSAGEM], ["RECEBIMENTO", "EXPEDICAO"]);
    assert.ok(casos.areas.length >= 10);
    assert.ok(casos.livres.length >= 3);
  });

  for (const caso of casos.areas) {
    it(`área: ${caso.caso}`, () => assert.equal(areaDePassagem(caso.local), caso.area));
  }
  for (const caso of casos.problemas) {
    it(`local do pedido: ${caso.caso}`, () => assert.equal(problemaDoLocalDoPedido(caso.local), caso.problema));
  }
  for (const caso of casos.livres) {
    it(`livre do cliente: ${caso.caso}`, () => assert.deepEqual(livreParaOCliente(caso.saldos), caso.livre));
  }
});
