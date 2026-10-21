import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CUSTOMER_STAGES, customerStage, isProspect } from "./cadastro-estagio.js";
import { ESTAGIOS_CADASTRO } from "./events.js";

/**
 * O estágio do cadastro é regra do WMS (parte 5) copiada no Comercial. Esta
 * trava lê functions/wms/src/domain/customer-profile.ts e exige as mesmas
 * funções, letra por letra.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// Compilado em functions/comercial/lib/domain/.
const wms = read("../../../wms/src/domain/customer-profile.ts");
const copia = read("../../src/domain/cadastro-estagio.ts");

/** A função inteira, da declaração ao fecha-chaves da primeira coluna. */
function funcao(source: string, name: string): string {
  const match = source.match(new RegExp(`^(?:export )?function ${name}\\([^]*?\\n\\}`, "m"));
  assert.ok(match, `function ${name} não encontrada`);
  return match[0].replace(/\r\n/g, "\n");
}

function lista(source: string, name: string): string[] {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(match, `${name} não encontrado`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("estágio do cadastro: cópia literal do WMS", () => {
  it("text, customerStage e isProspect iguais aos de customer-profile.ts", () => {
    for (const name of ["text", "customerStage", "isProspect"]) {
      assert.equal(funcao(copia, name), funcao(wms, name), name);
    }
  });

  it("a lista de estágios é a do WMS e a dos eventos", () => {
    assert.deepEqual(lista(wms, "CUSTOMER_STAGES"), [...CUSTOMER_STAGES]);
    assert.deepEqual([...ESTAGIOS_CADASTRO], [...CUSTOMER_STAGES]);
  });

  it("sem o campo é cliente; prospect em qualquer caixa", () => {
    assert.equal(customerStage(undefined), "cliente");
    assert.equal(customerStage(" Prospect "), "prospect");
    assert.equal(customerStage("lead"), "cliente");
    assert.equal(isProspect({ stage: "PROSPECT" }), true);
    assert.equal(isProspect({}), false);
    assert.equal(isProspect(null), false);
  });
});
