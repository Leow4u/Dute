import { describe, expect, it } from "vitest";

import { functionRoute } from "./functions-api";

describe("rotas de faturamento", () => {
  it("prévia da competência vem do servidor, com o cálculo da emissão", async () => {
    const route = functionRoute("/api/billing/periods/2026-09", "GET");
    expect(route?.name).toBe("getBillingPreview");
    expect(await route?.payload("/api/billing/periods/2026-09")).toEqual({
      competencia: "2026-09",
    });
  });

  it("lista e evidências continuam fora da prévia", () => {
    expect(functionRoute("/api/billing/periods", "GET")).toBeNull();
    expect(functionRoute("/api/billing/periods/2026-09/evidence", "GET")).toBeNull();
    expect(functionRoute("/api/billing/periods/2026-09/emit", "POST")?.name).toBe(
      "emitBillingInvoice",
    );
  });
});
