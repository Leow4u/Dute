import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
      [true, false, false, false, false],
    );
  });
});
