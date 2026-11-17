import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ajusteParaOContado, conferirCaixasInformadas, retiradoCom, saldoDaCaixa, sugerirCaixas, unidadesAjustadas, unidadesDaCaixa } from "./saldo-da-caixa.mjs";

/**
 * A cópia em JavaScript da regra do saldo da caixa (saldo-da-caixa.mjs, gerada
 * de lib/dominio/src/saldo-da-caixa.ts) roda os mesmos casos de
 * saldo-da-caixa.casos.json que o vitest do app e o WMS rodam contra o
 * original e a cópia literal. Caso novo entra no JSON, nunca só aqui.
 */
const casos = JSON.parse(readFileSync(fileURLToPath(new URL("../../lib/dominio/src/saldo-da-caixa.casos.json", import.meta.url)), "utf8"));

describe("saldo da caixa nas ferramentas: casos de referência", () => {
  it("o JSON de casos foi lido, com os ajustes da recontagem", () => {
    assert.ok(casos.saldos.length >= 12);
    assert.ok(casos.saldos.some((caso) => (caso.ajustes ?? []).length > 0));
    assert.ok(casos.ajustadas.length >= 3);
    assert.ok(casos.paraOContado.length >= 6);
  });

  for (const caso of casos.saldos) {
    it(`saldo: ${caso.caso}`, () => {
      const saldo = saldoDaCaixa(caso.entrada, caso.retirado, caso.ajustes ?? []);
      assert.deepEqual(saldo, caso.saldo);
      assert.equal(unidadesDaCaixa(saldo), caso.unidades);
    });
  }
  for (const caso of casos.ajustadas) {
    it(`ajustadas: ${caso.caso}`, () => assert.equal(unidadesAjustadas(caso.ajustes), caso.unidades));
  }
  for (const caso of casos.paraOContado) {
    it(`para o contado: ${caso.caso}`, () => assert.equal(ajusteParaOContado(caso.entrada, caso.retirado, caso.ajustes, caso.sku_code, caso.contado), caso.ajuste));
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
});
