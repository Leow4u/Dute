import { describe, expect, it } from "vitest";

import { parsePastedItems, shipmentStage, shipmentView, splitShipments } from "./shipments";

const base = { type: "recebimento", supplier: "Gráfica Alfa", invoice_number: "48213", item_count: 4, quantity_total: 1200 };

describe("etapa do envio", () => {
  it.each([
    [{ status: "open", operational_status: "awaiting_review" }, "notified"],
    [{ status: "approved" }, "confirmed"],
    [{ status: "closed", operational_status: "received" }, "arrived"],
    [{ status: "rejected", decision_reason: "mercadoria de outro cliente" }, "rejected"],
    [{ status: "cancelled", operational_status: "cancelled" }, "cancelled"],
  ])("%o → %s", (request, stage) => {
    expect(shipmentStage(request)).toBe(stage);
  });
});

describe("como o envio aparece", () => {
  it("a caminho: título, previsão, resumo e só cancela enquanto não confirmado", () => {
    const view = shipmentView({ ...base, id: "r1", status: "open", due_at: "2026-10-02T12:00:00Z", attachment_count: 1, requested_by_name: "Cristiane Souza", created_at: "2026-09-29T13:00:00Z" });
    expect(view).toMatchObject({ title: "Gráfica Alfa · NF 48213", summary: "4 itens · 1.200 peças", attachments: 1, detail: "avisado por Cristiane em 29/09", canCancel: true });
    expect(view.arrival).toBe("sex, 02/10");
    expect(shipmentView({ ...base, status: "approved" }).canCancel).toBe(false);
  });

  it("chegou: quanto chegou de verdade e o que veio diferente", () => {
    const view = shipmentView({
      ...base, status: "closed", operational_status: "received", received_at: "2026-09-22T15:00:00Z",
      qty_expected: 120, qty_received: 118,
      received_differences: [{ code: "A.01.0594.005.M", expected: 20, received: 18 }],
    });
    expect(view.received).toEqual({ label: "118 de 120 peças", tone: "short", differences: ["2 peças a menos em A.01.0594.005.M"] });
    expect(view.detail).toBe("chegou e foi conferido em 22/09 · 2 peças a menos em A.01.0594.005.M");
  });

  it("recusado e cancelado mostram o motivo e quem cancelou", () => {
    expect(shipmentView({ ...base, status: "rejected", decision_reason: "mercadoria de outro cliente", updated_at: "2026-09-15T12:00:00Z" }).detail).toBe(
      "recusado em 15/09: mercadoria de outro cliente",
    );
    expect(shipmentView({ ...base, status: "cancelled", updated_at: "2026-09-16T12:00:00Z" }).detail).toBe("cancelado por você em 16/09");
  });

  it("separa a caminho (por data de chegada) do histórico, só com envios", () => {
    const { onTheWay, history } = splitShipments([
      { ...base, id: "late", status: "open", due_at: "2026-10-06T12:00:00Z", created_at: "2026-10-01T10:00:00Z" },
      { ...base, id: "soon", status: "approved", due_at: "2026-10-02T12:00:00Z", created_at: "2026-09-29T10:00:00Z" },
      { ...base, id: "done", status: "closed", operational_status: "received", created_at: "2026-09-20T10:00:00Z" },
      { id: "pedido", type: "retirada", status: "open", created_at: "2026-10-01T11:00:00Z" },
    ]);
    expect(onTheWay.map((view) => view.id)).toEqual(["soon", "late"]);
    expect(history.map((view) => view.id)).toEqual(["done"]);
  });
});

describe("colar da planilha", () => {
  it("lê código e quantidade do Excel, da nota ou com ponto e vírgula", () => {
    const { lines, ignored } = parsePastedItems(
      "Código\tQuantidade\nA.01.0114.004.G\t300\nA.01.0114.004.GG;200\nK.0220.001.U    1.500\nA.01.0114.004.G 20\n\nsem quantidade\n",
    );
    expect(lines).toEqual([
      { code: "A.01.0114.004.G", quantity: 320 },
      { code: "A.01.0114.004.GG", quantity: 200 },
      { code: "K.0220.001.U", quantity: 1500 },
    ]);
    expect(ignored).toBe(2);
  });
});

describe("itens lidos da nota", () => {
  it("viram linhas para conferir: casadas trazem o código da BTG, as outras pedem código", async () => {
    const { invoiceDraft } = await import("./shipments");
    const draft = invoiceDraft({
      supplier: "Gráfica Alfa",
      invoice_number: "48213",
      issue_date: "2026-09-28",
      items: [
        { supplier_code: "A.01.0114.004.G", description: "CAMISETA G", quantity: 300, unit: "UN", match: { client_item_code: "A.01.0114.004.G", sku_code: "S1", product_name: "CAMISETA", by: "codigo" } },
        { supplier_code: "77", description: "ECOBAG LONA", quantity: 500, unit: "UN", match: null },
      ],
    });
    expect(draft).toEqual([
      { key: "nf0", include: true, invoiceText: "A.01.0114.004.G · CAMISETA G", code: "A.01.0114.004.G", name: "CAMISETA", quantity: "300", matchedBy: "codigo" },
      { key: "nf1", include: true, invoiceText: "77 · ECOBAG LONA", code: "", name: "ECOBAG LONA", quantity: "500", matchedBy: null },
    ]);
  });
});
