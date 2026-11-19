import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZAP_RETENCAO_DIAS, instanteLimite } from "./retencao.js";

describe("retenção do Zap", () => {
  it("o prazo é de 180 dias, contados para trás", () => {
    assert.equal(ZAP_RETENCAO_DIAS, 180);
    const agora = new Date("2026-11-19T03:30:00.000Z");
    const limite = instanteLimite(agora);
    assert.equal(limite.toISOString(), "2026-05-23T03:30:00.000Z");
  });

  it("prazo inválido não apaga com uma conta furada", () => {
    assert.throws(() => instanteLimite(new Date(), 0));
  });
});
