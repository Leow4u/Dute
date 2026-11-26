import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STATUS_DA_EDICAO,
  TIPOS_DE_MOMENTO,
  edicaoAberta,
  labelPadrao,
  naoVoltaram,
  podeTransitar,
  problemaDoCronograma,
  type MomentoPrevisto,
  type StatusDaEdicao,
} from "./dominio.js";

/**
 * O domínio dos Eventos no WMS (eventos, parte 1), sem o banco: cópia literal
 * de lib/dominio/src/eventos.ts (as Functions não importam lib/dominio). Roda
 * os mesmos casos de lib/dominio/src/eventos.casos.json que o vitest do app
 * roda contra o original, e a trava confere que a cópia é idêntica (o padrão
 * de areas-de-passagem.test.ts).
 */

// Compilado em functions/wms/lib/domain/eventos/dominio.test.js: um nível a mais que domain/.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../../lib/dominio/src/eventos.ts";
const COPIA = "../../../src/domain/eventos/dominio.ts";
const CASOS = "../../../../../lib/dominio/src/eventos.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/eventos\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type Casos = {
  transicoes: { de: StatusDaEdicao; para: StatusDaEdicao; pode: boolean }[];
  cronogramas: {
    caso: string;
    momentos: MomentoPrevisto[];
    contexto: { comItensDoEstoque: boolean; comColeta: boolean };
    problema: string | null;
  }[];
  retornos: { caso: string; foi: number; voltou: number; avariadas: number; naoVoltaram: number }[];
  labels: { caso: string; momentos: MomentoPrevisto[]; label: string | null }[];
};

const casos = JSON.parse(read(CASOS)) as Casos;

describe("eventos no WMS: a cópia é a de lib/dominio", () => {
  it("functions/wms/src/domain/eventos/dominio.ts é idêntico a lib/dominio/src/eventos.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/eventos.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/eventos.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/eventos.ts (não edite aqui).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/areas-de-passagem.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/eventos.ts\n`), original);
  });
});

describe("eventos no WMS: casos de referência", () => {
  it("os status e os tipos de momento são os da spec, e o JSON foi lido", () => {
    assert.deepEqual([...STATUS_DA_EDICAO], ["rascunho", "enviado", "confirmado", "separado", "no_evento", "retornado", "fechado", "cancelado"]);
    assert.deepEqual([...TIPOS_DE_MOMENTO], ["coleta_no_cliente", "entrega_no_local", "montagem", "evento", "desmontagem", "retorno_ao_estoque", "entrega_de_volta", "outro"]);
    assert.ok(casos.transicoes.length >= 12);
    assert.ok(casos.cronogramas.length >= 12);
  });

  for (const caso of casos.transicoes) {
    it(`transição: ${caso.de} → ${caso.para}`, () => assert.equal(podeTransitar(caso.de, caso.para), caso.pode));
  }
  for (const caso of casos.cronogramas) {
    it(`cronograma: ${caso.caso}`, () => assert.equal(problemaDoCronograma(caso.momentos, caso.contexto), caso.problema));
  }
  for (const caso of casos.retornos) {
    it(`não voltaram: ${caso.caso}`, () => assert.equal(naoVoltaram(caso.foi, caso.voltou, caso.avariadas), caso.naoVoltaram));
  }
  for (const caso of casos.labels) {
    it(`label: ${caso.caso}`, () => assert.equal(labelPadrao(caso.momentos), caso.label));
  }

  it("edicaoAberta é verdadeiro de rascunho a retornado", () => {
    assert.deepEqual(STATUS_DA_EDICAO.map(edicaoAberta), [true, true, true, true, true, true, false, false]);
  });

  it("edicaoAberta é falso para o que não é status da edição", () => {
    assert.deepEqual([undefined, null, "", "arquivado", "RASCUNHO", 1].map(edicaoAberta), [false, false, false, false, false, false]);
  });
});
