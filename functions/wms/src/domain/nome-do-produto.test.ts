import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  familiaDoCodigo,
  nomeComTamanho,
  nomeSemTamanho,
  padronizarNome,
  problemaDoNome,
  sufixoDoCodigo,
  tamanhoDoCodigo,
  type NomePadronizado,
  type ProblemaDoNome,
} from "./nome-do-produto.js";

/**
 * O padrão do nome do produto no WMS (decisões de 06/11/2026): cópia literal
 * de lib/dominio/src/nome-do-produto.ts (as Functions não importam
 * lib/dominio). Roda os mesmos casos de lib/dominio/src/nome-do-produto.casos.json
 * que o vitest do app roda contra o original, e a trava confere que a cópia é
 * idêntica (o padrão de areas-de-passagem.test.ts).
 */

// Compilado em functions/wms/lib/domain/nome-do-produto.test.js.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGINAL = "../../../../lib/dominio/src/nome-do-produto.ts";
const COPIA = "../../src/domain/nome-do-produto.ts";
const CASOS = "../../../../lib/dominio/src/nome-do-produto.casos.json";

/** A única linha que a cópia pode ter a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Cópia literal de lib\/dominio\/src\/nome-do-produto\.ts\b.*$/;

function semLinhaDeOrigem(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (LINHA_DE_ORIGEM.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n");
}

type Entrada = { nome: string; codigo: string; tamanho: string };

type Casos = {
  sufixos: { caso: string; codigo: string; sufixo: string | null }[];
  tamanhos_do_codigo: { caso: string; codigo: string; tamanho: string | null }[];
  familias: { caso: string; codigo: string; familia: string }[];
  nomes: (Entrada & { caso: string; genero: string; esperado: NomePadronizado })[];
  exibicao: (Entrada & { caso: string; sem_tamanho: string; com_tamanho: string })[];
  problemas: (Entrada & { caso: string; problema: ProblemaDoNome | null })[];
};

const casos = JSON.parse(read(CASOS)) as Casos;

describe("padrão do nome no WMS: a cópia é a de lib/dominio", () => {
  it("functions/wms/src/domain/nome-do-produto.ts é idêntico a lib/dominio/src/nome-do-produto.ts", () => {
    const original = read(ORIGINAL).replace(/\r\n/g, "\n");
    const copia = semLinhaDeOrigem(read(COPIA));
    assert.ok(original.length > 1000, "lib/dominio/src/nome-do-produto.ts não encontrado");
    assert.equal(copia, original, "a cópia mudou: copie lib/dominio/src/nome-do-produto.ts de novo, sem editar aqui");
  });

  it("a trava ignora só o comentário de origem na primeira linha", () => {
    const original = "export const A = 1;\n";
    assert.equal(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/nome-do-produto.ts (não edite).\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`// Cópia literal de lib/dominio/src/parados.ts\n${original}`), original);
    assert.notEqual(semLinhaDeOrigem(`${original}// Cópia literal de lib/dominio/src/nome-do-produto.ts\n`), original);
  });
});

describe("padrão do nome no WMS: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    assert.ok(casos.nomes.length >= 20);
    assert.ok(casos.problemas.length >= 10);
  });

  for (const caso of casos.sufixos) {
    it(`sufixo: ${caso.caso}`, () => assert.equal(sufixoDoCodigo(caso.codigo), caso.sufixo));
  }
  for (const caso of casos.tamanhos_do_codigo) {
    it(`tamanho do código: ${caso.caso}`, () => assert.equal(tamanhoDoCodigo(caso.codigo), caso.tamanho));
  }
  for (const caso of casos.familias) {
    it(`família: ${caso.caso}`, () => assert.equal(familiaDoCodigo(caso.codigo), caso.familia));
  }
  for (const caso of casos.nomes) {
    it(`nome: ${caso.caso}`, () => assert.deepEqual(padronizarNome(caso), caso.esperado));
  }
  for (const caso of casos.exibicao) {
    it(`exibição: ${caso.caso}`, () => {
      assert.equal(nomeSemTamanho(caso), caso.sem_tamanho);
      assert.equal(nomeComTamanho(caso), caso.com_tamanho);
    });
  }
  for (const caso of casos.problemas) {
    it(`problema: ${caso.caso}`, () => assert.deepEqual(problemaDoNome(caso), caso.problema));
  }
});
