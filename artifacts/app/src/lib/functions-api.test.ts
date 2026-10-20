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

describe("faturas", () => {
  it("baixar planilha do relatório vai para exportBillingReport com o período", async () => {
    const route = functionRoute("/api/client/billing/report", "POST");
    expect(route?.name).toBe("exportBillingReport");
    expect(await route?.payload("/api/client/billing/report", { method: "POST", body: JSON.stringify({ from: "2026-07", to: "2026-09" }) })).toEqual({
      from: "2026-07",
      to: "2026-09",
    });
  });
});

describe("pedidos", () => {
  it("cancelar pedido vai para cancelCustomerOrder com o id e o motivo", async () => {
    const route = functionRoute("/api/client/orders/creq_9/cancel", "POST");
    expect(route?.name).toBe("cancelCustomerOrder");
    expect(await route?.payload("/api/client/orders/creq_9/cancel", { method: "POST", body: JSON.stringify({ reason: " adiado " }) })).toEqual({
      request_id: "creq_9",
      reason: "adiado",
    });
  });

  it("numerar solicitações antigas só grava com apply true", async () => {
    const route = functionRoute("/api/system/request-numbers", "POST");
    expect(route?.name).toBe("assignRequestNumbers");
    expect(await route?.payload("/api/system/request-numbers", { method: "POST", body: JSON.stringify({}) })).toEqual({ apply: false });
    expect(await route?.payload("/api/system/request-numbers", { method: "POST", body: JSON.stringify({ apply: true }) })).toEqual({ apply: true });
  });
});

describe("documentos da operação", () => {
  it("o arquivo sobe por uploadOperationalDocument com o conteúdo em base64", async () => {
    const route = functionRoute("/api/documents/upload", "POST");
    expect(route?.name).toBe("uploadOperationalDocument");
    const body = { customer_code: "BTG Pactual", file_name: "contrato.pdf", content_type: "application/pdf", data_base64: "JVBERi0=", document_type: "contrato" };
    expect(await route?.payload("/api/documents/upload", { method: "POST", body: JSON.stringify(body) })).toEqual(body);
  });
});

describe("envios para a Dutelog", () => {
  it("anexo do aviso sobe por uploadShipmentAttachment, não por URL assinada", async () => {
    const route = functionRoute("/api/client/shipments/attachments", "POST");
    expect(route?.name).toBe("uploadShipmentAttachment");
    expect(
      await route?.payload("/api/client/shipments/attachments", {
        method: "POST",
        body: JSON.stringify({ file_name: "nf.pdf", content_type: "application/pdf", data_base64: "JVBERi0=", entity_id: "draft_1" }),
      }),
    ).toEqual({ file_name: "nf.pdf", content_type: "application/pdf", data_base64: "JVBERi0=", entity_id: "draft_1" });
  });

  it("ler itens da nota vai para readShipmentInvoice com o arquivo enviado", async () => {
    const route = functionRoute("/api/client/shipments/read-invoice", "POST");
    expect(route?.name).toBe("readShipmentInvoice");
    expect(
      await route?.payload("/api/client/shipments/read-invoice", {
        method: "POST",
        body: JSON.stringify({ storage_path: "operational-documents/BTG_Pactual/2026-10/1-nf.pdf", content_type: "application/pdf" }),
      }),
    ).toEqual({ storage_path: "operational-documents/BTG_Pactual/2026-10/1-nf.pdf", content_type: "application/pdf" });
  });

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

describe("anotações do Agent Dute", () => {
  it("lista e decide pela callable, com o id e a ação da rota", async () => {
    expect(functionRoute("/api/agent-dute/notes", "GET")?.name).toBe("listAgentNotes");
    const route = functionRoute("/api/agent-dute/notes/note_abc/approve", "POST");
    expect(route?.name).toBe("decideAgentNote");
    expect(
      await route?.payload("/api/agent-dute/notes/note_abc/approve", {
        method: "POST",
        body: JSON.stringify({ text: "Entregas só de manhã", visibility: "equipe", id: "outro", action: "x" }),
      }),
    ).toEqual({ text: "Entregas só de manhã", visibility: "equipe", id: "note_abc", action: "approve" });
    expect(
      await route?.payload("/api/agent-dute/notes/note_abc/approve", { method: "POST", body: JSON.stringify({ visibility: "todos" }) }),
    ).toEqual({ visibility: "todos", id: "note_abc", action: "approve" });
    expect(functionRoute("/api/agent-dute/notes/note_abc/apagar", "POST")).toBeNull();
  });
});
