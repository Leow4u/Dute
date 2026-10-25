import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { sentidoDoMovimento, type SentidoDoMovimento } from "./sentido-do-movimento.js";

/**
 * O sentido do movimento no WMS: trecho literal de lib/dominio/src/parados.ts
 * (as Functions não importam lib/dominio; functions/core copia o arquivo
 * inteiro). O resumo de movimentações do Agent Dute conta por ele só a
 * entrada e a saída de verdade. Roda os mesmos casos de
 * lib/dominio/src/parados.casos.json que o vitest do app roda no original.
 */

// Compilado em functions/wms/lib/domain/sentido-do-movimento.test.js.
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const ORIGINAL = "../../../../lib/dominio/src/parados.ts";
const COPIA = "../../src/domain/sentido-do-movimento.ts";
const CASOS = "../../../../lib/dominio/src/parados.casos.json";

/** A única linha que o trecho tem a mais: o comentário de origem, na primeira linha. */
const LINHA_DE_ORIGEM = /^\/\/ Trecho literal de lib\/dominio\/src\/parados\.ts\b.*\n/;

type Casos = {
  sentidos: { caso: string; origem: string | null; tipo_mov: string | null; sentido: SentidoDoMovimento | null }[];
};

describe("o sentido do movimento no WMS é o de lib/dominio", () => {
  it("domain/sentido-do-movimento.ts está, letra por letra, em lib/dominio/src/parados.ts", () => {
    const copia = read(COPIA);
    assert.match(copia, LINHA_DE_ORIGEM);
    const trecho = copia.replace(LINHA_DE_ORIGEM, "");
    assert.ok(trecho.includes("export function sentidoDoMovimento"), "o trecho não tem a regra");
    assert.ok(
      read(ORIGINAL).includes(trecho),
      "o trecho mudou: copie de lib/dominio/src/parados.ts de novo, sem editar aqui",
    );
  });

  it("roda os casos de parados.casos.json", () => {
    const { sentidos } = JSON.parse(read(CASOS)) as Casos;
    assert.ok(sentidos.length > 0);
    for (const caso of sentidos) {
      assert.equal(sentidoDoMovimento(caso.origem, caso.tipo_mov), caso.sentido, caso.caso);
    }
  });
});
