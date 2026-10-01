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

describe("rotas de pessoas e acessos", () => {
  it("remover/devolver acesso vai para setUserAccess com o id da pessoa", async () => {
    const route = functionRoute("/api/billing/users/uid-123/access", "POST");
    expect(route?.name).toBe("setUserAccess");
    const payload = await route?.payload("/api/billing/users/uid-123/access", {
      method: "POST",
      body: JSON.stringify({ active: false, reason: "Saiu" }),
    });
    expect(payload).toEqual({ active: false, reason: "Saiu", user_id: "uid-123" });
  });

  it("cancelar convite arquiva o convite pelo token", async () => {
    const route = functionRoute("/api/invites/tok-1", "DELETE");
    expect(route?.name).toBe("mutateManagedEntity");
    expect(await route?.payload("/api/invites/tok-1")).toMatchObject({
      resource: "invites",
      action: "archive",
      id: "tok-1",
    });
  });
});

describe("rota do Sistema", () => {
  it("a verificação do servidor chama getSystemHealth (não um ok fixo do navegador)", async () => {
    const route = functionRoute("/api/system/health", "GET");
    expect(route?.name).toBe("getSystemHealth");
    expect(await route?.payload("/api/system/health")).toEqual({});
    expect(functionRoute("/api/system/health", "POST")).toBeNull();
  });
});

describe("rota de arquivar item do portal", () => {
  it("vai para setClientItemArchived com o id da projeção", async () => {
    const route = functionRoute("/api/client/inventory/cinv_BTG_Pactual__SKU1/archive", "POST");
    expect(route?.name).toBe("setClientItemArchived");
    expect(
      await route?.payload("/api/client/inventory/cinv_BTG_Pactual__SKU1/archive", {
        method: "POST",
        body: JSON.stringify({ archived: true }),
      }),
    ).toEqual({ inventory_id: "cinv_BTG_Pactual__SKU1", archived: true });
  });
});

describe("envios para a Dutelog", () => {
  it("cancelar aviso vai para cancelShipmentNotice com o id e o motivo", async () => {
    const route = functionRoute("/api/client/shipments/creq_1/cancel", "POST");
    expect(route?.name).toBe("cancelShipmentNotice");
    expect(
      await route?.payload("/api/client/shipments/creq_1/cancel", {
        method: "POST",
        body: JSON.stringify({ reason: " fornecedor atrasou " }),
      }),
    ).toEqual({ request_id: "creq_1", reason: "fornecedor atrasou" });
  });
});
