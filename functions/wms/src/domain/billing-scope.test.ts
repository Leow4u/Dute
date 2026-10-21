import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  billingCustomerCode,
  billingDocumentId,
  legacyBillingDocumentId,
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
});
