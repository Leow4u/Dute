import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELOGIO_VAZIO,
  diaEmSaoPaulo,
  diasCorridos,
  idadeDoItem,
  marcarMovimento,
  regraDoModelo,
  rotuloDaEtiqueta,
  sentidoDoMovimento,
  type EtiquetaDeParado,
  type IdadeDoItem,
  type RegraDeParado,
  type RelogioDoItem,
  type SentidoDoMovimento,
} from "./parados.js";

/**
 * Os dias parado no núcleo: cópia literal de lib/dominio/src/parados.ts (as
 * Functions não importam lib/dominio). Roda os mesmos casos de
 * lib/dominio/src/parados.casos.json que o vitest do app roda contra o
 * original, e a trava confere que a cópia é idêntica (o padrão do
 * contratos-datas.test.ts do Comercial).
 */

// Compilado em functions/core/lib/domain/parados.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/parados.ts";
const COPIA = "../../src/domain/parados.ts";
const CASOS = "../../../../lib/dominio/src/parados.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/parados\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type Casos = {
  regras: { caso: string; modelo: string | null; regra: RegraDeParado }[];
  sentidos: { caso: string; origem: string | null; tipo_mov: string | null; sentido: SentidoDoMovimento | null }[];
  relogios: { caso: string; movimentos: { sentido: SentidoDoMovimento; em: string | null }[]; relogio: RelogioDoItem }[];
  dias: { caso: string; instante: string; dia: string | null }[];
  dias_corridos: { caso: string; de: string; ate: string; dias?: number; erro?: boolean }[];
  idades: { caso: string; relogio: RelogioDoItem; saldo: number; modelo: string; hoje?: string; idade?: IdadeDoItem; erro?: boolean }[];
  rotulos: { caso: string; etiqueta: EtiquetaDeParado; modelo: string; rotulo: string }[];
};

const HOJE = "2026-10-20";
const casos = JSON.parse(read(CASOS)) as Casos;

describe("dias parado no núcleo: a cópia é a de lib/dominio", () => {
  it("functions/core/src/domain/parados.ts é idêntico a lib/dominio/src/parados.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/parados.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/parados.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/parados.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/dinheiro.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/parados.ts\n`), original);
  });
});

describe("dias parado no núcleo: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.idades.length >= 10);
    assert.ok(casos.sentidos.length >= 10);
  });

  for (const caso of casos.regras) {
    it(`regra: ${caso.caso}`, () => assert.deepEqual(regraDoModelo(caso.modelo), caso.regra));
  }

  for (const caso of casos.sentidos) {
    it(`sentido: ${caso.caso}`, () => assert.equal(sentidoDoMovimento(caso.origem, caso.tipo_mov), caso.sentido));
  }

  for (const caso of casos.relogios) {
    it(`relógio: ${caso.caso}`, () => {
      const relogio = caso.movimentos.reduce((atual, movimento) => marcarMovimento(atual, movimento.sentido, movimento.em), RELOGIO_VAZIO);
      assert.deepEqual(relogio, caso.relogio);
    });
  }

  for (const caso of casos.dias) {
    it(`dia: ${caso.caso}`, () => assert.equal(diaEmSaoPaulo(caso.instante), caso.dia));
  }

  for (const caso of casos.dias_corridos) {
    it(`dias corridos: ${caso.caso}`, () => {
      if (caso.erro) assert.throws(() => diasCorridos(caso.de, caso.ate));
      else assert.equal(diasCorridos(caso.de, caso.ate), caso.dias);
    });
  }

  for (const caso of casos.idades) {
    it(`idade: ${caso.caso}`, () => {
      const calcular = () => idadeDoItem(caso.relogio, caso.saldo, regraDoModelo(caso.modelo), caso.hoje ?? HOJE);
      if (caso.erro) assert.throws(calcular);
      else assert.deepEqual(calcular(), caso.idade);
    });
  }

  for (const caso of casos.rotulos) {
    it(`rótulo: ${caso.caso}`, () => assert.equal(rotuloDaEtiqueta(caso.etiqueta, regraDoModelo(caso.modelo)), caso.rotulo));
  }
});
