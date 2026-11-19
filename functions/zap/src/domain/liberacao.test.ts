import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOME_DO_SEGREDO } from "./ingestao.js";
import { RETENCAO_AMBIENTES_LIBERADOS, ZAP_AMBIENTES_LIBERADOS, ZAP_PROJETOS_COM_SEGREDO, retencaoLiberada, segredosDoZap, zapLiberado } from "./liberacao.js";

describe("liberação do Zap", () => {
  it("o painel atende homologação e produção, e o btg fica de fora", () => {
    assert.deepEqual(ZAP_AMBIENTES_LIBERADOS, ["dute-homolog", "dute-prod"]);
    assert.equal(zapLiberado("dute-homolog"), true);
    assert.equal(zapLiberado("dute-prod"), true);
    assert.equal(zapLiberado("dute-btg"), false);
    assert.equal(zapLiberado(""), false);
  });

  it("a retenção só está ligada na homologação", () => {
    assert.deepEqual(RETENCAO_AMBIENTES_LIBERADOS, ["dute-homolog"]);
    assert.equal(retencaoLiberada("dute-homolog"), true);
    assert.equal(retencaoLiberada("dute-prod"), false);
  });

  it("o segredo entra só na homologação", () => {
    assert.deepEqual(ZAP_PROJETOS_COM_SEGREDO, ["dute-homolog"]);
    assert.deepEqual(segredosDoZap("dute-homolog"), [NOME_DO_SEGREDO]);
    assert.deepEqual(segredosDoZap("dute-prod"), []);
    assert.deepEqual(segredosDoZap("dute-btg"), []);
  });
});
