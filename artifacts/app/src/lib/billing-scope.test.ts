import { describe, expect, it } from "vitest";

import { billingDocumentId, periodBelongsToCustomer } from "./billing-scope";

describe("fatura por cliente na lista", () => {
  it("não mistura o mês de dois clientes", () => {
    expect(billingDocumentId("BTG Pactual", "2026-10")).not.toBe(
      billingDocumentId("Acme", "2026-10"),
    );
  });

  it("a competência antiga sem cliente continua da BTG", () => {
    expect(
      periodBelongsToCustomer({ id: "2026-10", competencia: "2026-10" }, "BTG Pactual"),
    ).toBe(true);
    expect(
      periodBelongsToCustomer({ id: "2026-10", competencia: "2026-10" }, "Acme"),
    ).toBe(false);
    expect(
      periodBelongsToCustomer(
        { id: "Acme__2026-10", customer_code: "Acme", competencia: "2026-10" },
        "Acme",
      ),
    ).toBe(true);
  });
});
