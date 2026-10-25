import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  billingMovementDirection,
  billingPaidInFinanceiro,
  billingCustomerCode,
  billingDocumentId,
  legacyBillingDocumentId,
  shouldFreezeCompetencia,
} from "./billing-scope.js";

describe("fatura por cliente", () => {
  it("dois clientes no mesmo mês não compartilham o documento", () => {
    const btg = billingDocumentId("BTG Pactual", "2026-10");
    const acme = billingDocumentId("Acme", "2026-10");
    assert.equal(btg, "BTG_Pactual__2026-10");
    assert.equal(acme, "Acme__2026-10");
    assert.notEqual(btg, acme);
    assert.notEqual(acme, "2026-10");
  });

  it("só a BTG ainda acha a competência antiga pelo mês", () => {
    assert.equal(legacyBillingDocumentId("BTG Pactual", "2026-10"), "2026-10");
    assert.equal(legacyBillingDocumentId("Acme", "2026-10"), null);
  });

  it("congela o mês fechado uma vez e não mexe na foto que já existe", () => {
    assert.equal(shouldFreezeCompetencia("", true), true);
    assert.equal(shouldFreezeCompetencia("frozen", true), false);
    assert.equal(shouldFreezeCompetencia("replace", true), false);
    assert.equal(shouldFreezeCompetencia("baseline", true), false);
    assert.equal(shouldFreezeCompetencia("", false), false);
  });

  it("cliente só fatura o próprio código; a equipe usa o cliente pedido", () => {
    assert.equal(
      billingCustomerCode({ role: "cliente", customer_code: "Acme" }, "BTG Pactual"),
      "Acme",
    );
    assert.equal(
      billingCustomerCode({ role: "financeiro" }, "Acme"),
      "Acme",
    );
    assert.equal(
      billingCustomerCode({ role: "financeiro" }),
      "BTG Pactual",
    );
    assert.throws(
      () => billingCustomerCode({ role: "cliente" }),
      /Cliente sem código/,
    );
  });

  it("onde o Financeiro está ligado, o WMS não marca pagamento (parte 7.2c)", () => {
    assert.deepEqual(
      ["dute-homolog", "dute-prod", "dute-btg", "demo-dute-operations", undefined].map(billingPaidInFinanceiro),
      [true, true, false, false, false],
    );
  });
});

describe("o lado de cada movimento na cobrança", () => {
  const semFoto = { snapshot: false };
  const comFoto = { snapshot: true };

  it("o recebimento é entrada e a expedição é saída, com ou sem a foto", () => {
    for (const foto of [semFoto, comFoto]) {
      assert.equal(billingMovementDirection({ source: "wms_receiving", sinal: 1 }, foto), "incoming");
      assert.equal(billingMovementDirection({ source: " WMS_Shipping ", sinal: -1 }, foto), "outgoing");
    }
  });

  it("o que o armazém faz por dentro não se cobra, nem sem a foto", () => {
    // As origens que o createMovement grava (domain/operations.ts), fora o recebimento e a expedição.
    const internas = [
      "functions_opening_inventory",
      "functions_opening_inventory_reversal",
      "functions_opening_inventory_transfer",
      "functions_cycle_count",
      "functions_manual_inventory",
      "functions_return_disposition",
      "wms_putaway",
    ];
    for (const source of internas) {
      for (const [sinal, tipo] of [[1, "ENTRADA"], [-1, "SAIDA"]] as const) {
        assert.equal(billingMovementDirection({ source, sinal, tipo_mov: tipo }, semFoto), null, source);
      }
    }
  });

  it("sem a foto, o legado sem origem conta pelo sinal e, sem sinal, pelo tipo, uma vez só", () => {
    assert.equal(billingMovementDirection({ sinal: 1 }, semFoto), "incoming");
    assert.equal(billingMovementDirection({ sign: -1 }, semFoto), "outgoing");
    assert.equal(billingMovementDirection({ tipo_mov: "entrada" }, semFoto), "incoming");
    assert.equal(billingMovementDirection({ tipo_mov: "SAIDA" }, semFoto), "outgoing");
    // Sinal e tipo que discordam contavam dos dois lados (achado 28 da auditoria de 24/07).
    assert.equal(billingMovementDirection({ sinal: 1, tipo_mov: "SAIDA" }, semFoto), "incoming");
    assert.equal(billingMovementDirection({ sinal: -1, tipo_mov: "ENTRADA" }, semFoto), "outgoing");
    assert.equal(billingMovementDirection({ sinal: 0 }, semFoto), null);
    assert.equal(billingMovementDirection({}, semFoto), null);
  });

  it("com a foto, o legado sem origem já está nela e não conta", () => {
    assert.equal(billingMovementDirection({ sinal: 1, tipo_mov: "ENTRADA" }, comFoto), null);
    assert.equal(billingMovementDirection({ sinal: -1, tipo_mov: "SAIDA" }, comFoto), null);
  });
});
